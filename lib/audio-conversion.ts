import { z } from 'zod';
import { ApiError, db } from './server';
import { resolveProviderKey } from './key-vault';

export type ConversionJob={lecture_id:string;media_type:string;source_key:string;conversion_id:string|null;audio_url:string|null;audio_expires_at:number|null;conversion_deleted_at:number|null};
export const needsConversion=(job:Pick<ConversionJob,'media_type'|'source_key'>)=>job.media_type.startsWith('video/')||/\.(mp4|webm)$/i.test(job.source_key);
export function converterUrl(value:string){
  let url:URL;try{url=new URL(value);}catch{throw new ApiError(400,'변환 서버의 HTTPS 주소를 확인해주세요.');}
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/'||url.hostname==='localhost'||/^(127\.|169\.254\.|10\.|192\.168\.|\[)/.test(url.hostname))throw new ApiError(400,'변환 서버의 HTTPS 기본 주소를 입력해주세요.');
  return url.origin;
}
export async function converterConfig(request:Request){
  const [base,key]=await Promise.all([resolveProviderKey(request,'converter_url','x-converter-url','변환 서버 주소'),resolveProviderKey(request,'converter','x-converter-key','변환 서버 연결 키')]);
  return {base:converterUrl(base),key};
}
export type ConverterConfig=Awaited<ReturnType<typeof converterConfig>>;
const resultSchema=z.object({id:z.string().uuid(),status:z.enum(['queued','processing','completed','error','cancelled']),audio_url:z.string().optional(),expires_at:z.number().int().optional()});
async function request(config:ConverterConfig,path:string,options:RequestInit={},allow404=false){
  let response:Response;
  try{response=await fetch(config.base+path,{...options,headers:{...options.headers,Authorization:`Bearer ${config.key}`},redirect:'manual',signal:AbortSignal.timeout(30000)});}
  catch{throw new ApiError(504,'변환 서버에 연결하지 못했습니다. 주소와 서버 상태를 확인해주세요.');}
  if(allow404&&response.status===404)return response;
  if(!response.ok){
    if(response.status===401||response.status===403)throw new ApiError(response.status,'변환 서버 연결 키를 확인해주세요.');
    if(response.status===429)throw new ApiError(429,'변환 서버가 사용 중입니다. 잠시 후 이어서 시도하세요.');
    throw new ApiError(502,`음성 변환 요청이 실패했습니다. (HTTP ${response.status})`);
  }
  return response;
}
export async function deleteConversion(config:ConverterConfig,id:string){await request(config,`/jobs/${encodeURIComponent(id)}`,{method:'DELETE'},true);}
export async function cancelConversion(config:ConverterConfig,id:string){await request(config,`/jobs/${encodeURIComponent(id)}/cancel`,{method:'POST'},true);}
// Called under the media-job lease. Job IDs are persisted before POST for idempotent recovery.
export async function advanceConversion(job:ConversionJob,bytes:number,config:ConverterConfig,sourceUrl?:string):Promise<string|null>{
  if(job.audio_url&&job.audio_expires_at&&job.audio_expires_at>Date.now()+600000){
    if(new URL(job.audio_url).origin!==config.base)throw new ApiError(409,'이 강의를 변환한 서버 주소로 다시 연결해주세요.');
    return job.audio_url;
  }
  if(job.audio_url){
    if(job.conversion_id)await deleteConversion(config,job.conversion_id);
    await db().prepare('UPDATE media_jobs SET conversion_id=NULL,audio_url=NULL,audio_expires_at=NULL,conversion_deleted_at=NULL WHERE lecture_id=?').bind(job.lecture_id).run();
    job.conversion_id=null;job.audio_url=null;
  }
  let response:Response;
  if(job.conversion_id){
    response=await request(config,`/jobs/${encodeURIComponent(job.conversion_id)}`,{},true);
    if(response.status===404){if(!sourceUrl){await db().prepare('UPDATE media_jobs SET conversion_id=NULL,audio_url=NULL,audio_expires_at=NULL WHERE lecture_id=?').bind(job.lecture_id).run();job.conversion_id=null;return null;}response=await request(config,'/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:job.conversion_id,source_url:sourceUrl,bytes})});}
  }else{
    if(!sourceUrl)return null;
    job.conversion_id=crypto.randomUUID();
    await db().prepare("UPDATE media_jobs SET conversion_id=?,conversion_deleted_at=NULL,remote_status='converting' WHERE lecture_id=?").bind(job.conversion_id,job.lecture_id).run();
    response=await request(config,'/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:job.conversion_id,source_url:sourceUrl,bytes})});
  }
  const parsed=resultSchema.safeParse(await response.json());
  if(!parsed.success||parsed.data.id!==job.conversion_id)throw new ApiError(502,'음성 변환 서버의 작업 응답을 확인하지 못했습니다.');
  if(parsed.data.status==='error'||parsed.data.status==='cancelled'){
    await deleteConversion(config,job.conversion_id);
    await db().prepare('UPDATE media_jobs SET conversion_id=NULL,audio_url=NULL,audio_expires_at=NULL WHERE lecture_id=?').bind(job.lecture_id).run();
    throw new ApiError(422,'음성 변환이 중단됐거나 실패했습니다. 영상의 음성 트랙과 서버 상태를 확인한 후 이어서 시도하세요.');
  }
  if(parsed.data.status!=='completed')return null;
  let audio:URL;try{audio=new URL(parsed.data.audio_url||'');}catch{throw new ApiError(502,'변환된 MP3 파일을 확인하지 못했습니다.');}
  if(audio.origin!==config.base||audio.username||audio.password||audio.hash||audio.pathname!==`/audio/${job.conversion_id}.mp3`||!parsed.data.expires_at||parsed.data.expires_at<Date.now()+600000)throw new ApiError(502,'변환된 MP3 파일 주소 또는 유효기간을 확인하지 못했습니다.');
  await db().prepare('UPDATE media_jobs SET audio_url=?,audio_expires_at=? WHERE lecture_id=?').bind(audio.href,parsed.data.expires_at,job.lecture_id).run();
  return audio.href;
}
