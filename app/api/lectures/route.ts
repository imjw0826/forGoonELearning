import { z } from 'zod';
import { ApiError, bucket, db, owner, jsonBody, respondError, noCache } from '@/lib/server';
import { MAX_MEDIA } from '@/lib/types';
export async function GET(request:Request) {try{const user=owner(request);const rows=await db().prepare(`SELECT l.id,l.title,l.filename,l.bytes,l.duration,l.total,l.status,l.paused,l.created, CASE WHEN m.lecture_id IS NULL THEN 0 ELSE 1 END cloud, m.ready source_ready, m.source_deleted_at, m.provider_deleted_at, m.remote_status, m.provider, m.provider_expires_at, (SELECT COALESCE(SUM(bytes),0) FROM upload_parts p WHERE p.lecture_id=l.id) uploaded_bytes, (SELECT COUNT(*) FROM chunks c WHERE c.lecture_id=l.id) uploaded, (SELECT COUNT(*) FROM chunks c WHERE c.lecture_id=l.id AND c.outline IS NOT NULL) completed FROM lectures l LEFT JOIN media_jobs m ON m.lecture_id=l.id WHERE owner=? ORDER BY created DESC LIMIT 100`).bind(user).all();return Response.json(rows.results,{headers:noCache});}catch(e){return respondError(e);}}
export async function POST(request:Request) {try{
  const user=owner(request,true);
  const data=z.object({title:z.string().trim().min(1).max(160),filename:z.string().min(1).max(255),bytes:z.number().int().min(1).max(MAX_MEDIA)}).parse(await jsonBody(request));
  const extension=data.filename.split('.').pop()?.toLowerCase();
  const formats:Record<string,string>={mp4:'video/mp4',webm:'video/webm',mp3:'audio/mpeg',m4a:'audio/mp4',wav:'audio/wav'};
  if(!extension||!formats[extension])throw new ApiError(400,'MP4, WebM, MP3, M4A, WAV 파일을 선택해주세요.');
  const id=crypto.randomUUID(),created=Date.now(),sourceKey=`source/${user}/${id}/media.${extension}`;
  const upload=await bucket().createMultipartUpload(sourceKey,{httpMetadata:{contentType:formats[extension]}});
  try{await db().batch([
    db().prepare('INSERT INTO lectures (id,owner,title,filename,bytes,duration,total,status,created) VALUES (?,?,?,?,?,0,0,?,?)').bind(id,user,data.title,data.filename,data.bytes,'uploading',created),
    db().prepare("INSERT INTO media_jobs (lecture_id,source_key,upload_id,media_type,provider) VALUES (?,?,?,?,'fal')").bind(id,sourceKey,upload.uploadId,formats[extension]),
  ]);}catch(e){await upload.abort();throw e;}
  return Response.json({id,...data,duration:0,total:0,status:'uploading',created,uploaded:0,completed:0,cloud:1,provider:'fal',source_ready:0,uploaded_bytes:0,parts:[]},{status:201,headers:noCache});
}catch(e){return respondError(e);}}
