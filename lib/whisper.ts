import { z } from 'zod';
import { advanceConversion, needsConversion, type ConversionJob, type ConverterConfig } from './audio-conversion';
import { resolveProviderKey } from './key-vault';
import { ApiError, bucket, db } from './server';
import type { SpeechResult } from './speech';

export const FAL_PART_BYTES=10*1024*1024;
const LIFECYCLE=JSON.stringify({expiration_duration_seconds:86400,initial_acl:{default:'forbid',rules:[]}});
export type WhisperJob=ConversionJob & {lecture_id:string;source_key:string;media_type:string;upload_url:string|null;remote_id:string|null;remote_status:string|null;transfer_url:string|null;transfer_parts:string|null;transfer_ready:number;provider_expires_at:number|null};
export async function falKey(request:Request){return resolveProviderKey(request,'fal','x-fal-key','fal');}
function cdnUrl(value:string){let url:URL;try{url=new URL(value);}catch{throw new ApiError(502,'Whisper 파일 주소를 확인하지 못했습니다.');}if(url.protocol!=='https:'||!/^v3[a-z0-9]*\.fal\.media$/.test(url.hostname)||url.username||url.password)throw new ApiError(502,'Whisper 파일 주소를 확인하지 못했습니다.');return url;}
async function checkedFetch(url:string,options:RequestInit={},stage='Whisper 연결',accepted:number[]=[]){
  let response:Response;
  try{
    // Workers supports only follow/manual. Manual also prevents forwarding keys on redirects.
    response=await fetch(url,{...options,redirect:'manual',signal:options.signal??AbortSignal.timeout(120000)});
  }catch(error){
    const timeout=error instanceof Error&&(error.name==='TimeoutError'||error.name==='AbortError');
    console.error('fal request failed',{stage,kind:timeout?'timeout':'connection'});
    throw new ApiError(timeout?504:502,timeout?`${stage} 응답 시간이 초과됐습니다. 이어서 만들기를 눌러주세요.`:`${stage}에 연결하지 못했습니다. 잠시 후 이어서 만들기를 눌러주세요.`);
  }
  if(accepted.includes(response.status))return response;
  if(!response.ok){
    console.error('fal request failed',{stage,status:response.status});
    if(response.status===401||response.status===403)throw new ApiError(response.status,`${stage}: fal API 키와 이용 권한을 확인해주세요. (HTTP ${response.status})`);
    if(response.status===402)throw new ApiError(402,'fal 계정의 잔액을 확인해주세요. (HTTP 402)');
    if(response.status===429)throw new ApiError(429,'fal 사용 한도에 도달했습니다. 잠시 후 이어서 시도하세요. (HTTP 429)');
    if(response.status>=300&&response.status<400)throw new ApiError(502,`${stage}: 예상하지 못한 주소 이동을 차단했습니다. (HTTP ${response.status})`);
    throw new ApiError(502,`${stage} 요청이 실패했습니다. fal 처리 내역을 확인해주세요. (HTTP ${response.status})`);
  }
  return response;
}
async function jsonRequest<T>(key:string,url:string,options:RequestInit={},stage='Whisper 연결'):Promise<T>{const response=await checkedFetch(url,{...options,headers:{...options.headers,Authorization:`Key ${key}`}},stage);try{return await response.json() as T;}catch{throw new ApiError(502,`${stage} 응답을 읽지 못했습니다.`);}}

// Follow fal's official SDK multipart protocol, but stream only one R2 range per request.
// Private CDN input and a short-lived read-only signed URL keep the site private.
export async function advanceWhisper(job:WhisperJob,bytes:number,key:string,converter?:ConverterConfig){
  if(job.remote_id)return {status:job.remote_status||'queued',request_id:job.remote_id};
  const lock=await db().prepare("UPDATE media_jobs SET lock_until=? WHERE lecture_id=? AND lock_until<? AND remote_id IS NULL AND NOT EXISTS (SELECT 1 FROM lectures WHERE id=media_jobs.lecture_id AND (status='deleting' OR paused=1))").bind(Date.now()+180000,job.lecture_id,Date.now()).run();
  if(!lock.meta.changes)throw new ApiError(409,'Whisper 전송을 준비 중입니다. 잠시 후 이어서 시도하세요.');
  try{
    if(needsConversion(job)&&!converter)throw new ApiError(400,'API 연결에서 변환 서버 주소와 연결 키를 저장해주세요.');
    let audioUrl:string|null=null;
    if(needsConversion(job)&&job.conversion_id){
      audioUrl=await advanceConversion(job,bytes,converter!);
      if(!audioUrl&&job.conversion_id)return {status:'converting',delay_ms:5000};
    }
    if(!audioUrl){
    if(job.provider_expires_at&&job.provider_expires_at<Date.now()+600000){
      job.upload_url=null;job.transfer_url=null;job.transfer_parts=null;job.transfer_ready=0;
      await db().prepare('UPDATE media_jobs SET upload_url=NULL,transfer_url=NULL,transfer_parts=NULL,transfer_ready=0,provider_expires_at=NULL WHERE lecture_id=?').bind(job.lecture_id).run();
    }
    if(!job.transfer_url){
      const initialized=await jsonRequest<{file_url:string;upload_url:string}>(key,'https://rest.fal.ai/storage/upload/initiate-multipart?storage_type=fal-cdn-v3',{method:'POST',headers:{'Content-Type':'application/json','X-Fal-Object-Lifecycle':LIFECYCLE,'X-Fal-Object-Lifecycle-Preference':LIFECYCLE},body:JSON.stringify({file_name:job.source_key.split('/').pop(),content_type:job.media_type})},'fal 업로드 준비');
      if(cdnUrl(initialized.file_url).hostname!=='v3b.fal.media')throw new ApiError(502,'비공개 파일 저장소를 확인하지 못했습니다. 원본은 전송하지 않았습니다.');
      cdnUrl(initialized.upload_url);
      job.upload_url=initialized.file_url;job.transfer_url=initialized.upload_url;job.transfer_parts='[]';job.provider_expires_at=Date.now()+86400000;
      await db().prepare("UPDATE media_jobs SET upload_url=?,transfer_url=?,transfer_parts='[]',provider_expires_at=?,remote_status='transferring' WHERE lecture_id=?").bind(job.upload_url,job.transfer_url,job.provider_expires_at,job.lecture_id).run();
    }
    const parts=JSON.parse(job.transfer_parts||'[]') as {partNumber:number;etag:string}[],count=Math.ceil(bytes/FAL_PART_BYTES);
    const url=cdnUrl(job.transfer_url);
    if(!job.transfer_ready&&parts.length<count){
      const partNumber=parts.length+1,offset=(partNumber-1)*FAL_PART_BYTES,length=Math.min(FAL_PART_BYTES,bytes-offset);
      const media=await bucket().get(job.source_key,{range:{offset,length}});if(!media)throw new ApiError(404,'원본 파일을 찾을 수 없습니다.');
      const response=await checkedFetch(`${url.origin}${url.pathname}/${partNumber}${url.search}`,{method:'PUT',headers:{'Content-Type':job.media_type,'Content-Length':String(length)},body:media.body},'fal 파일 전송');
      let etag=response.headers.get('etag');try{const result=await response.json() as {etag?:string};etag=result.etag||etag;}catch{/* Some CDN versions return the ETag only as a header. */}
      if(typeof etag!=='string'||!etag||etag.length>512)throw new ApiError(502,'Whisper 전송 결과를 확인하지 못했습니다. 이어서 시도하세요.');
      parts.push({partNumber,etag});
      await db().prepare('UPDATE media_jobs SET transfer_parts=? WHERE lecture_id=?').bind(JSON.stringify(parts),job.lecture_id).run();
      return {status:'transferring',loaded:Math.min(parts.length*FAL_PART_BYTES,bytes),total:bytes,delay_ms:50};
    }
    if(!job.transfer_ready){
      await checkedFetch(`${url.origin}${url.pathname}/complete${url.search}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({parts})},'fal 파일 전송 완료');
      await db().prepare('UPDATE media_jobs SET transfer_ready=1 WHERE lecture_id=?').bind(job.lecture_id).run();
    }
    const token=await jsonRequest<{token:string}>(key,'https://rest.fal.ai/storage/auth/token?storage_type=fal-cdn-v3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expiration_seconds:86400})},'fal 파일 인증');
    if(!token.token)throw new ApiError(502,'Whisper 파일 인증을 준비하지 못했습니다.');
    const file=cdnUrl(job.upload_url!);
    const signed=await checkedFetch(`${file.origin}${file.pathname}/sign`,{method:'POST',headers:{Authorization:`Bearer ${token.token}`,'Content-Type':'application/json'},body:JSON.stringify({duration:86400,scope:['read']})},'fal 파일 읽기 인증');
    const signedUrl=(await signed.text()).trim();cdnUrl(signedUrl);
    if(needsConversion(job)){
      audioUrl=await advanceConversion(job,bytes,converter!,signedUrl);
      if(!audioUrl)return {status:'converting',delay_ms:5000};
    }else audioUrl=signedUrl;
    }
    const active=await db().prepare('SELECT paused FROM lectures WHERE id=?').bind(job.lecture_id).first<{paused:number}>();
    if(active?.paused)throw new ApiError(409,'중단된 강의입니다. 이어서 만들기를 눌러주세요.');
    const submitted=await jsonRequest<{request_id:string}>(key,'https://queue.fal.run/fal-ai/wizper',{method:'POST',headers:{'Content-Type':'application/json','X-Fal-Store-IO':'0','X-Fal-Object-Lifecycle-Preference':LIFECYCLE},body:JSON.stringify({audio_url:audioUrl,task:'transcribe',language:'ko',version:'3',chunk_level:'segment',merge_chunks:true,max_segment_len:29})},'Whisper 전사 요청');
    if(!submitted.request_id||!/^[a-zA-Z0-9-]{1,100}$/.test(submitted.request_id))throw new ApiError(502,'Whisper 요청 번호를 확인하지 못했습니다.');
    await db().batch([db().prepare("UPDATE media_jobs SET remote_id=?,remote_status='queued',lock_until=0 WHERE lecture_id=?").bind(submitted.request_id,job.lecture_id),db().prepare("UPDATE lectures SET status='transcribing' WHERE id=?").bind(job.lecture_id)]);
    return {status:'queued',request_id:submitted.request_id};
  }finally{await db().prepare('UPDATE media_jobs SET lock_until=0 WHERE lecture_id=?').bind(job.lecture_id).run();}
}
export async function pollWhisper(key:string,id:string):Promise<SpeechResult>{
  const base=`https://queue.fal.run/fal-ai/wizper/requests/${encodeURIComponent(id)}`;
  const status=await jsonRequest<{status:string;error?:unknown}>(key,`${base}/status`,{},'Whisper 상태 확인');
  if(status.error)return {id,status:'error'};
  if(status.status!=='COMPLETED')return {id,status:status.status==='IN_QUEUE'?'queued':'processing'};
  const result=await jsonRequest<{text:string;chunks?:{text:string;timestamp:[number,number|null]}[];error?:unknown}>(key,base,{},'Whisper 결과 가져오기');
  if(result.error)return {id,status:'error'};
  const parsed=z.object({text:z.string(),chunks:z.array(z.object({text:z.string(),timestamp:z.tuple([z.number().finite().min(0),z.number().finite().min(0).nullable()])})).max(100000)}).safeParse(result);
  if(!parsed.success)throw new ApiError(502,'Whisper 전사 결과 형식을 확인하지 못했습니다. 원본은 보관되어 있습니다.');
  const segments=parsed.data.chunks;
  return {id,status:'completed',text:result.text,audio_duration:segments.reduce((max,s)=>Math.max(max,s.timestamp[1]||s.timestamp[0]),0),words:segments.map(s=>({text:s.text,start:(s.timestamp?.[0]||0)*1000,end:(s.timestamp?.[1]||s.timestamp?.[0]||0)*1000}))};
}

export async function cancelWhisper(key:string,id:string){
  await checkedFetch(`https://queue.fal.run/fal-ai/wizper/requests/${encodeURIComponent(id)}/cancel`,{method:'PUT',headers:{Authorization:`Key ${key}`},signal:AbortSignal.timeout(15000)},'Whisper 요청 취소',[400,404]);
}
