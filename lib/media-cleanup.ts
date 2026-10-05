import { ApiError, bucket, db, getLecture, speechKey } from './server';
import { speechRequest } from './speech';
import type { MediaCleanup } from './types';

// This runs only after durable note storage. A cleanup failure never removes notes.
export async function cleanupMedia(id:string,user:string,request:Request):Promise<MediaCleanup>{
  const lecture=await getLecture(id,user);
  if(lecture.status!=='complete'||!lecture.notes)throw new ApiError(409,'학습 노트가 저장된 뒤에 원본 파일을 삭제할 수 있습니다.');
  const job=await db().prepare('SELECT * FROM media_jobs WHERE lecture_id=?').bind(id).first<{source_key:string;ready:number;source_deleted_at:number|null;provider_deleted_at:number|null;remote_id:string|null;provider:string;provider_expires_at:number|null}>();
  if(!job)return {source:'not_applicable',provider:'not_applicable'};
  const result:MediaCleanup={source:job.source_deleted_at?'deleted':'pending',provider:job.provider==='fal'&&job.provider_expires_at?'scheduled':job.provider_deleted_at?'deleted':job.remote_id?'pending':'not_applicable'};
  if(!job.source_deleted_at&&job.ready){
    try{
      await bucket().delete(job.source_key);
      await db().batch([
        db().prepare('UPDATE media_jobs SET source_deleted_at=? WHERE lecture_id=?').bind(Date.now(),id),
        db().prepare('DELETE FROM upload_parts WHERE lecture_id=?').bind(id),
      ]);
      result.source='deleted';
    }catch{/* The stored note remains usable; the owner can retry cleanup. */}
  }
  if(job.provider!=='fal'&&job.remote_id&&!job.provider_deleted_at){
    try{
      const key=await speechKey(request);
      await speechRequest(key,`/transcript/${job.remote_id}`,{method:'DELETE'});
      await db().prepare('UPDATE media_jobs SET provider_deleted_at=?,upload_url=NULL WHERE lecture_id=?').bind(Date.now(),id).run();
      result.provider='deleted';
    }catch{/* Missing/expired credentials leave a visible, retryable cleanup state. */}
  }
  return result;
}
