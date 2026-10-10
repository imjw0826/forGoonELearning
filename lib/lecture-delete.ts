import { ApiError, bucket, db, getLecture, speechKey } from './server';
import { cancelWhisper, falKey } from './whisper';
import { speechRequest } from './speech';

export async function deleteLecture(id:string,user:string,request:Request){
  await getLecture(id,user,true);
  const now=Date.now(),lease=now+120000;
  const lock=await db().prepare(`UPDATE lectures SET status='deleting',lock_until=?
    WHERE id=? AND owner=? AND lock_until<?
    AND NOT EXISTS (SELECT 1 FROM media_jobs WHERE lecture_id=lectures.id AND lock_until>=?)
    AND NOT EXISTS (SELECT 1 FROM chunks WHERE lecture_id=lectures.id AND lock_until>=?)`)
    .bind(lease,id,user,now,now,now).run();
  if(!lock.meta.changes)throw new ApiError(409,'현재 처리 중인 강의입니다. 잠시 후 삭제해주세요.');
  try{
    const job=await db().prepare('SELECT * FROM media_jobs WHERE lecture_id=?').bind(id).first<{source_key:string;upload_id:string;ready:number;provider:string;remote_id:string|null;remote_status:string|null;provider_deleted_at:number|null;provider_expires_at:number|null}>();
    const chunks=await db().prepare("SELECT audio_key FROM chunks WHERE lecture_id=? AND audio_key!=''").bind(id).all<{audio_key:string}>();
    // Keep the deleting record on storage failure, so cleanup remains retryable.
    if(job&&!job.ready){
      try{await bucket().resumeMultipartUpload(job.source_key,job.upload_id).abort();}
      catch(error){
        if(!(error instanceof Error)||!/NoSuchUpload|does not exist|already aborted/i.test(error.message))throw new ApiError(503,'업로드 취소를 완료하지 못했습니다. 삭제를 다시 시도해주세요.');
      }
    }
    const keys=[...new Set([...(job?[job.source_key]:[]),...chunks.results.map(c=>c.audio_key)])];
    if(keys.length)await bucket().delete(keys);
    let providerCleanup='not_applicable';
    if(job?.provider==='fal'){
      providerCleanup=job.provider_expires_at?'scheduled':'not_applicable';
      if(job.remote_id&&job.remote_status!=='completed'&&job.remote_status!=='error'){
        try{await cancelWhisper(await falKey(request),job.remote_id);}
        catch{providerCleanup='pending';}
      }
    }else if(job?.remote_id&&!job.provider_deleted_at){
      try{await speechRequest(await speechKey(request),`/transcript/${job.remote_id}`,{method:'DELETE'});providerCleanup='deleted';}
      catch{providerCleanup='pending';}
    }
    await db().batch([
      db().prepare('DELETE FROM chunks WHERE lecture_id=?').bind(id),
      db().prepare('DELETE FROM upload_parts WHERE lecture_id=?').bind(id),
      db().prepare('DELETE FROM media_jobs WHERE lecture_id=?').bind(id),
      db().prepare("DELETE FROM lectures WHERE id=? AND owner=? AND status='deleting' AND lock_until=?").bind(id,user,lease),
    ]);
    return {deleted:true,provider_cleanup:providerCleanup};
  }catch(error){
    if(error instanceof ApiError)throw error;
    throw new ApiError(503,'강의 삭제를 완료하지 못했습니다. 삭제를 다시 시도해주세요.');
  }finally{
    await db().prepare("UPDATE lectures SET lock_until=0 WHERE id=? AND owner=? AND status='deleting' AND lock_until=?").bind(id,user,lease).run();
  }
}
