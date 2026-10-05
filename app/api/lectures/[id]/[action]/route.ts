import { ApiError, db, bucket, owner, apiKey, speechKey, getLecture, boundedBody, jsonBody, respondError, noCache } from '@/lib/server';
import { outline, summarize, correctTranscript } from '@/lib/ai';
import { speechRequest, transcriptChunks, type SpeechResult } from '@/lib/speech';
import { UPLOAD_PART_BYTES } from '@/lib/types';
import { cleanupMedia } from '@/lib/media-cleanup';
import { advanceWhisper, falKey, pollWhisper, type WhisperJob } from '@/lib/whisper';
import { z } from 'zod';
type Context={params:Promise<{id:string;action:string}>};
type Job=WhisperJob & {provider:string;lecture_id:string;source_key:string;upload_id:string;media_type:string;ready:number;upload_url:string|null;remote_id:string|null;remote_status:string|null;lock_until:number;source_deleted_at:number|null;provider_deleted_at:number|null};
async function getJob(id:string){return db().prepare('SELECT * FROM media_jobs WHERE lecture_id=?').bind(id).first<Job>();}
async function detail(id:string,lecture:Record<string,unknown>){
  const job=await getJob(id);
  const [rows,parts]=await Promise.all([
    db().prepare('SELECT ordinal,transcript,corrected_transcript,correction_audit,outline,start_seconds FROM chunks WHERE lecture_id=? ORDER BY ordinal').bind(id).all(),
    db().prepare('SELECT part_number,bytes FROM upload_parts WHERE lecture_id=? ORDER BY part_number').bind(id).all(),
  ]);
  return {...lecture,cloud:job?1:0,provider:job?.provider,provider_expires_at:job?.provider_expires_at,source_ready:job?.ready||0,source_deleted_at:job?.source_deleted_at,provider_deleted_at:job?.provider_deleted_at,remote_status:job?.remote_status,parts:parts.results.map(p=>Number(p.part_number)),uploaded_bytes:parts.results.reduce((a,p)=>a+Number(p.bytes),0),chunks:rows.results,uploaded:rows.results.length,completed:rows.results.filter(c=>c.outline!==null).length};
}
export async function GET(request:Request,context:Context){try{
  const user=owner(request),{id,action}=await context.params,lecture=await getLecture(id,user);
  if(action==='detail')return Response.json(await detail(id,lecture),{headers:noCache});
  if(action==='source'){
    const job=await getJob(id);if(!job?.ready||job.source_deleted_at)throw new ApiError(404,'원본 파일은 삭제됐거나 아직 저장되지 않았습니다.');
    const media=await bucket().get(job.source_key);if(!media)throw new ApiError(404,'파일을 찾을 수 없습니다.');
    return new Response(media.body,{headers:{...noCache,'Content-Type':job.media_type,'Content-Length':String(media.size),'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(String(lecture.filename))}`,'X-Content-Type-Options':'nosniff'}});
  }
  // Previously saved audio remains accessible to its owner.
  if(action==='audio'){
    const ordinal=Number(new URL(request.url).searchParams.get('ordinal'));
    if(!Number.isInteger(ordinal)||ordinal<0||ordinal>=Number(lecture.total))throw new ApiError(400,'음성 구간을 확인해주세요.');
    const row=await db().prepare('SELECT audio_key FROM chunks WHERE lecture_id=? AND ordinal=?').bind(id,ordinal).first<{audio_key:string}>();
    if(!row?.audio_key)throw new ApiError(404,'음성 구간을 찾을 수 없습니다.');
    const audio=await bucket().get(row.audio_key);if(!audio)throw new ApiError(404,'음성을 찾을 수 없습니다.');
    return new Response(audio.body,{headers:{...noCache,'Content-Type':'audio/mpeg','Content-Length':String(audio.size),'X-Content-Type-Options':'nosniff'}});
  }
  throw new ApiError(404,'요청을 찾을 수 없습니다.');
}catch(e){return respondError(e);}}

export async function POST(request:Request,context:Context){try{
  const user=owner(request,true),{id,action}=await context.params,lecture=await getLecture(id,user);
  if(action==='cleanup-source')return Response.json({cleanup:await cleanupMedia(id,user,request)},{headers:noCache});
  if(action==='upload-part'){
    const job=await getJob(id);if(!job)throw new ApiError(409,'새 강의에서 원본 파일을 올려주세요.');
    if(job.ready)throw new ApiError(409,'이미 파일 저장이 완료됐습니다.');
    const part=Number(new URL(request.url).searchParams.get('part')),count=Math.ceil(Number(lecture.bytes)/UPLOAD_PART_BYTES);
    if(!Number.isInteger(part)||part<1||part>count)throw new ApiError(400,'파일 구간을 확인해주세요.');
    const existing=await db().prepare('SELECT part_number FROM upload_parts WHERE lecture_id=? AND part_number=?').bind(id,part).first();
    if(existing)return Response.json({saved:true},{headers:noCache});
    if(request.headers.get('content-type')!=='application/octet-stream')throw new ApiError(400,'파일 업로드 형식을 확인해주세요.');
    const bytes=await boundedBody(request,UPLOAD_PART_BYTES),expected=Math.min(UPLOAD_PART_BYTES,Number(lecture.bytes)-(part-1)*UPLOAD_PART_BYTES);
    if(bytes.byteLength!==expected)throw new ApiError(400,'업로드한 구간의 크기가 원본과 다릅니다. 같은 파일을 선택해주세요.');
    const uploaded=await bucket().resumeMultipartUpload(job.source_key,job.upload_id).uploadPart(part,bytes);
    await db().prepare('INSERT INTO upload_parts (lecture_id,part_number,etag,bytes) VALUES (?,?,?,?) ON CONFLICT(lecture_id,part_number) DO UPDATE SET etag=excluded.etag,bytes=excluded.bytes').bind(id,part,uploaded.etag,bytes.byteLength).run();
    return Response.json({saved:true},{headers:noCache});
  }
  if(action==='finish-upload'){
    const job=await getJob(id);if(!job)throw new ApiError(404,'업로드를 찾을 수 없습니다.');
    if(job.ready)return Response.json({saved:true},{headers:noCache});
    const lock=await db().prepare('UPDATE media_jobs SET lock_until=? WHERE lecture_id=? AND lock_until<? AND ready=0').bind(Date.now()+120000,id,Date.now()).run();
    if(!lock.meta.changes)throw new ApiError(409,'파일 저장을 완료하는 중입니다. 잠시 후 다시 시도하세요.');
    try{
      const rows=await db().prepare('SELECT part_number,etag,bytes FROM upload_parts WHERE lecture_id=? ORDER BY part_number').bind(id).all();
      const count=Math.ceil(Number(lecture.bytes)/UPLOAD_PART_BYTES);
      if(rows.results.length!==count||rows.results.reduce((a,p)=>a+Number(p.bytes),0)!==Number(lecture.bytes))throw new ApiError(409,'파일 업로드가 아직 끝나지 않았습니다. 같은 원본 파일을 선택해 이어서 올려주세요.');
      // Recover if R2 completion succeeded but saving the ready flag failed.
      const exists=await bucket().head(job.source_key);
      if(!exists)await bucket().resumeMultipartUpload(job.source_key,job.upload_id).complete(rows.results.map(p=>({partNumber:Number(p.part_number),etag:String(p.etag)})));
      await db().batch([
        db().prepare('UPDATE media_jobs SET ready=1,lock_until=0 WHERE lecture_id=?').bind(id),
        db().prepare("UPDATE lectures SET status='ready' WHERE id=?").bind(id),
      ]);
      return Response.json({saved:true},{headers:noCache});
    }finally{await db().prepare('UPDATE media_jobs SET lock_until=0 WHERE lecture_id=?').bind(id).run();}
  }
  if(action==='speech-start'){
    if(lecture.notes)return Response.json({status:'completed'},{headers:noCache});
    const job=await getJob(id);if(!job?.ready)throw new ApiError(409,'먼저 파일 업로드를 완료해주세요.');
    if(job.remote_id)return Response.json({status:job.remote_status||'processing'},{headers:noCache});
    if(job.provider==='fal')return Response.json(await advanceWhisper(job,Number(lecture.bytes),falKey(request)),{headers:noCache});
    const key=speechKey(request);
    const lock=await db().prepare('UPDATE media_jobs SET lock_until=? WHERE lecture_id=? AND lock_until<? AND remote_id IS NULL').bind(Date.now()+2100000,id,Date.now()).run();
    if(!lock.meta.changes)throw new ApiError(409,'음성 인식 요청을 이미 준비 중입니다. 잠시 후 이어서 만들기를 눌러주세요.');
    try{
      let uploadUrl=job.upload_url;
      if(!uploadUrl){
        const media=await bucket().get(job.source_key);if(!media)throw new ApiError(404,'원본 파일을 찾을 수 없습니다.');
        const upload=await speechRequest<{upload_url:string}>(key,'/upload',{method:'POST',headers:{'Content-Type':'application/octet-stream','Content-Length':String(media.size)},body:media.body});
        if(typeof upload.upload_url!=='string'||!upload.upload_url.startsWith('https://cdn.assemblyai.com/'))throw new ApiError(502,'음성 인식 서버의 파일 응답을 확인하지 못했습니다.');
        uploadUrl=upload.upload_url;
        await db().prepare('UPDATE media_jobs SET upload_url=? WHERE lecture_id=?').bind(uploadUrl,id).run();
      }
      const result=await speechRequest<SpeechResult>(key,'/transcript',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({audio_url:uploadUrl,speech_models:['universal-2'],language_code:'ko',language_detection:false,punctuate:true,format_text:true})});
      if(!result.id||!/^[a-zA-Z0-9-]+$/.test(result.id))throw new ApiError(502,'음성 인식 요청 번호를 확인하지 못했습니다.');
      await db().batch([
        db().prepare('UPDATE media_jobs SET remote_id=?,remote_status=?,lock_until=0 WHERE lecture_id=?').bind(result.id,result.status,id),
        db().prepare("UPDATE lectures SET status='transcribing' WHERE id=?").bind(id),
      ]);
      return Response.json({status:result.status},{headers:noCache});
    }finally{await db().prepare('UPDATE media_jobs SET lock_until=0 WHERE lecture_id=?').bind(id).run();}
  }
  if(action==='speech-poll'){
    const job=await getJob(id);
    if(job?.provider==='fal'&&!job.remote_id)return Response.json(await advanceWhisper(job,Number(lecture.bytes),falKey(request)),{headers:noCache});
    if(!job?.remote_id)throw new ApiError(409,'먼저 음성 인식을 시작해주세요.');
    if(job.remote_status==='completed')return Response.json({status:'completed'},{headers:noCache});
    const result=job.provider==='fal'?await pollWhisper(falKey(request),job.remote_id):await speechRequest<SpeechResult>(speechKey(request),`/transcript/${job.remote_id}`);
    if(result.status==='error'){
      await db().batch([db().prepare("UPDATE media_jobs SET remote_status='error' WHERE lecture_id=?").bind(id),db().prepare("UPDATE lectures SET status='error' WHERE id=?").bind(id)]);
      throw new ApiError(422,'외부 음성 인식이 실패했습니다. 음성 인식 API의 처리 내역을 확인한 후, 음성이 있는 지원 형식의 파일로 다시 올려주세요.');
    }
    if(result.status!=='completed')return Response.json({status:result.status},{headers:noCache});
    const chunks=transcriptChunks(result),duration=Math.ceil(result.audio_duration||0);
    const lock=await db().prepare("UPDATE media_jobs SET lock_until=? WHERE lecture_id=? AND lock_until<? AND remote_status!='completed'").bind(Date.now()+120000,id,Date.now()).run();
    if(!lock.meta.changes)return Response.json({status:'processing'},{headers:noCache});
    try{
      await db().batch([
        ...chunks.map((c,ordinal)=>db().prepare('INSERT INTO chunks (lecture_id,ordinal,audio_key,transcript,start_seconds) VALUES (?,?,?,?,?) ON CONFLICT(lecture_id,ordinal) DO NOTHING').bind(id,ordinal,'',c.text,c.start)),
        db().prepare("UPDATE lectures SET total=?,duration=?,status='transcribed' WHERE id=?").bind(chunks.length,duration,id),
        db().prepare("UPDATE media_jobs SET remote_status='completed',lock_until=0 WHERE lecture_id=?").bind(id),
      ]);
    }finally{await db().prepare('UPDATE media_jobs SET lock_until=0 WHERE lecture_id=?').bind(id).run();}
    return Response.json({status:'completed'},{headers:noCache});
  }
  if(action==='correct'){
    if(lecture.notes)throw new ApiError(409,'완성된 노트의 대본은 그대로 보관합니다.');
    const key=apiKey(request),{ordinal}=z.object({ordinal:z.number().int().min(0).max(179)}).parse(await jsonBody(request));
    const row=await db().prepare('SELECT transcript,corrected_transcript FROM chunks WHERE lecture_id=? AND ordinal=?').bind(id,ordinal).first<{transcript:string|null;corrected_transcript:string|null}>();
    if(!row?.transcript)throw new ApiError(409,'원문 전사가 완료된 뒤 교정할 수 있습니다.');
    if(row.corrected_transcript)return Response.json({done:true},{headers:noCache});
    const lock=await db().prepare('UPDATE chunks SET lock_until=? WHERE lecture_id=? AND ordinal=? AND lock_until<? AND corrected_transcript IS NULL').bind(Date.now()+600000,id,ordinal,Date.now()).run();
    if(!lock.meta.changes)throw new ApiError(409,'대본을 이미 교정 중입니다. 잠시 후 이어서 시도하세요.');
    try{
      const contextRows=await db().prepare('SELECT ordinal,transcript FROM chunks WHERE lecture_id=? AND ordinal IN (?,?)').bind(id,ordinal-1,ordinal+1).all<{ordinal:number;transcript:string}>();
      const correction=await correctTranscript(key,row.transcript,String(lecture.title),contextRows.results.find(c=>c.ordinal===ordinal-1)?.transcript||'',contextRows.results.find(c=>c.ordinal===ordinal+1)?.transcript||'');
      await db().prepare('UPDATE chunks SET corrected_transcript=?,correction_audit=?,outline=NULL,lock_until=0 WHERE lecture_id=? AND ordinal=?').bind(correction.corrected_transcript,JSON.stringify({changes:correction.changes,uncertainties:correction.uncertainties}),id,ordinal).run();
      return Response.json({done:true},{headers:noCache});
    }finally{await db().prepare('UPDATE chunks SET lock_until=0 WHERE lecture_id=? AND ordinal=?').bind(id,ordinal).run();}
  }
  if(action==='transcribe'){
    const key=apiKey(request),{ordinal}=z.object({ordinal:z.number().int().min(0).max(179)}).parse(await jsonBody(request));
    const row=await db().prepare('SELECT * FROM chunks WHERE lecture_id=? AND ordinal=?').bind(id,ordinal).first<{transcript:string|null;corrected_transcript:string|null;outline:string|null}>();
    if(!row?.transcript)throw new ApiError(409,'전사문이 준비되지 않았습니다. 이전 방식의 미완료 강의는 원본 파일을 새 강의로 올려주세요.');
    if(!row.corrected_transcript)throw new ApiError(409,'문맥 교정을 완료한 뒤 구간을 정리할 수 있습니다.');
    if(row.outline)return Response.json({done:true},{headers:noCache});
    const lock=await db().prepare('UPDATE chunks SET lock_until=? WHERE lecture_id=? AND ordinal=? AND lock_until<? AND outline IS NULL').bind(Date.now()+600000,id,ordinal,Date.now()).run();
    if(!lock.meta.changes)throw new ApiError(409,'이 구간을 이미 정리 중입니다. 잠시 후 다시 시도하세요.');
    try{
      const summary=await outline(key,row.corrected_transcript,String(lecture.title));
      await db().prepare('UPDATE chunks SET outline=?,lock_until=0 WHERE lecture_id=? AND ordinal=?').bind(summary,id,ordinal).run();
      return Response.json({done:true},{headers:noCache});
    }finally{await db().prepare('UPDATE chunks SET lock_until=0 WHERE lecture_id=? AND ordinal=?').bind(id,ordinal).run();}
  }
  if(action==='summarize'){
    if(lecture.notes)return Response.json({notes:JSON.parse(String(lecture.notes)),cleanup:await cleanupMedia(id,user,request)},{headers:noCache});
    const key=apiKey(request),rows=await db().prepare('SELECT ordinal,outline,corrected_transcript,start_seconds FROM chunks WHERE lecture_id=? ORDER BY ordinal').bind(id).all();
    if(!Number(lecture.total)||rows.results.length!==Number(lecture.total)||rows.results.some(r=>!r.outline||!r.corrected_transcript))throw new ApiError(409,'모든 전사 구간이 정리된 뒤 노트를 만들 수 있습니다.');
    const lock=await db().prepare("UPDATE lectures SET status='summarizing',lock_until=? WHERE id=? AND lock_until<? AND notes IS NULL").bind(Date.now()+600000,id,Date.now()).run();
    if(!lock.meta.changes)throw new ApiError(409,'학습 노트를 이미 생성 중입니다. 잠시 후 다시 시도하세요.');
    try{
      const notes=await summarize(key,String(lecture.title),rows.results.map(r=>({start_seconds:r.start_seconds??Number(r.ordinal)*600,outline:r.outline})));
      await db().prepare("UPDATE lectures SET notes=?,status='complete',lock_until=0 WHERE id=?").bind(JSON.stringify(notes),id).run();
      return Response.json({notes,cleanup:await cleanupMedia(id,user,request)},{headers:noCache});
    }catch(e){await db().prepare("UPDATE lectures SET status='transcribed',lock_until=0 WHERE id=? AND notes IS NULL").bind(id).run();throw e;}
  }
  throw new ApiError(404,'요청을 찾을 수 없습니다.');
}catch(e){return respondError(e);}}
