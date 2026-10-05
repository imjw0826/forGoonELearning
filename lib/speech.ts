import { ApiError } from './server';

export type SpeechResult = {id:string;status:string;text?:string|null;audio_duration?:number|null;words?:{text:string;start:number;end:number}[]|null};
export async function speechRequest<T>(key:string,path:string,options:RequestInit={}):Promise<T> {
  let response:Response;
  try {
    response=await fetch(`https://api.assemblyai.com/v2${path}`,{
      ...options,headers:{...options.headers,authorization:key},
      signal:AbortSignal.timeout(path==='/upload'?1800000:60000),
    });
  } catch {throw new ApiError(504,'AssemblyAI 응답을 기다리는 시간이 초과되었습니다. 저장된 강의에서 이어서 시도하세요.');}
  if(!response.ok){
    if(response.status===401||response.status===403)throw new ApiError(401,'AssemblyAI API 키를 확인하세요. 이전과 같은 프로젝트의 키를 사용해야 합니다.');
    if(response.status===402)throw new ApiError(402,'AssemblyAI 계정의 잔액을 확인해주세요.');
    if(response.status===429)throw new ApiError(429,'AssemblyAI 사용 한도에 도달했습니다. 잠시 후 다시 시도하세요.');
    if(response.status===400||response.status===422)throw new ApiError(400,'AssemblyAI가 파일을 읽지 못했습니다. 음성이 있는 지원 형식의 파일인지 확인해주세요.');
    throw new ApiError(502,'AssemblyAI 요청을 완료하지 못했습니다. 잠시 후 다시 시도하세요.');
  }
  try{return await response.json() as T;}catch{throw new ApiError(502,'AssemblyAI 응답을 읽지 못했습니다.');}
}

// Split the remote transcript without decoding or processing any audio locally.
export function transcriptChunks(result:SpeechResult) {
  const chunks:{start:number;text:string}[]=[];
  if(result.words?.length){
    let text='',start=0;
    for(const word of result.words){
      if(!word.text?.trim())continue;
      const seconds=Math.max(0,Math.floor(word.start/1000));
      if(text&&(seconds-start>=600||text.length+word.text.length>4000)){
        chunks.push({start,text:text.trim()});text='';
      }
      if(!text)start=seconds;
      text+=`${word.text} `;
    }
    if(text.trim())chunks.push({start,text:text.trim()});
  }else if(result.text?.trim()){
    const text=result.text.trim();
    for(let offset=0;offset<text.length;offset+=4000)chunks.push({start:Math.floor((result.audio_duration||0)*offset/text.length),text:text.slice(offset,offset+4000)});
  }
  if(!chunks.length)throw new ApiError(422,'파일에서 말소리를 찾지 못했습니다. 음성이 있는 강의를 올려주세요.');
  if(chunks.length>180)throw new ApiError(413,'전사문이 너무 깁니다. 강의를 여러 파일로 나누어 올려주세요.');
  return chunks;
}
