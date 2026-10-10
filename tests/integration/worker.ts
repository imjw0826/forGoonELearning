import {env} from 'cloudflare:workers';
import {GET as settingsGet,POST as settingsSave,DELETE as settingsDelete} from '../../app/api/lectures/settings/route';
import {GET as list,POST as create} from '../../app/api/lectures/route';
import {GET as detail,POST as action,DELETE as remove} from '../../app/api/lectures/[id]/[action]/route';
const realFetch=globalThis.fetch;
let submissions=0,polls=0,uploads=0,deletions=0,corrections=0,cancellations=0;
globalThis.fetch=async(input:RequestInfo|URL,init?:RequestInit)=>{
 const url=String(input),headers=new Headers(init?.headers);
 // Validate redirect mode in the real Workers Request implementation before mocking I/O.
 new Request(url,{redirect:init?.redirect});
 if(url.includes('api.openai.com'))throw new Error('OpenAI calls forbidden');
 if(url.startsWith('https://rest.fal.ai/')){
   if(headers.get('Authorization')==='Key redirect-fal-test-key123456')return new Response(null,{status:307,headers:{Location:'https://evil.test/steal'}});
   if(headers.get('Authorization')==='Key timeout-fal-test-key123456')throw new DOMException('timeout','TimeoutError');
   if(headers.get('Authorization')==='Key network-fal-test-key123456')throw new TypeError('network');
   if(headers.get('Authorization')==='Key invalid-fal-test-key123456')return Response.json({error:'invalid'},{status:401});
   if(!headers.get('Authorization')?.startsWith('Key '))throw new Error('Missing fal key');
   if(url.includes('initiate-multipart')){
     const lifecycle=JSON.parse(headers.get('X-Fal-Object-Lifecycle')!);
     if(lifecycle.expiration_duration_seconds!==86400||lifecycle.initial_acl.default!=='forbid')throw new Error('Private expiring upload required');
     return Response.json({upload_url:'https://v3b.fal.media/upload/abc?token=upload-only',file_url:'https://v3b.fal.media/files/b/store/media.mp4'});
   }
   return Response.json({token:'read-only-cdn-token'});
 }
 if(url.startsWith('https://v3b.fal.media/')){
   if(url.includes('/sign')){
     if(headers.get('Authorization')!=='Bearer read-only-cdn-token'||JSON.parse(init?.body as string).scope[0]!=='read')throw new Error('Invalid signing');
     return new Response('https://v3b.fal.media/files/b/store/media.mp4?identity=read-only');
   }
   if(url.includes('/complete')){
     const parts=JSON.parse(init?.body as string).parts;
     if(parts.length!==2||parts[0].partNumber!==1||parts[1].partNumber!==2)throw new Error('Invalid completion parts');
     return Response.json({});
   }
   if(!(init?.body instanceof ReadableStream))throw new Error('Media must be streamed');
   const bytes=new Uint8Array(await new Response(init.body).arrayBuffer());uploads++;
   const first=url.includes('/abc/1?');
   if(bytes.length!==(first?10*1024*1024:6*1024*1024+64)||headers.get('Content-Length')!==String(bytes.length))throw new Error('Invalid ranged stream length');
   if(bytes[0]!== (first?7:9)||bytes.at(-1)!==(first?9:8))throw new Error('Invalid range bytes');
   return Response.json({etag:`part-${first?1:2}`});
 }
 if(url.startsWith('https://queue.fal.run/')){
   if(!headers.get('Authorization')?.startsWith('Key '))throw new Error('Missing inference key');
   if(init?.method==='PUT'&&url.endsWith('/cancel')){cancellations++;return Response.json({status:'CANCELLATION_REQUESTED'},{status:202});}
   if(init?.method==='POST'){
     submissions++;const body=JSON.parse(init.body as string);
     if(body.language!=='ko'||body.version!=='3'||body.task!=='transcribe'||body.audio_url!=='https://v3b.fal.media/files/b/store/media.mp4?identity=read-only'||headers.get('X-Fal-Store-IO')!=='0')throw new Error('Invalid Whisper configuration');
     return Response.json({request_id:'remote-job-1'});
   }
   if(url.endsWith('/status')){polls++;return Response.json({status:polls===1?'IN_PROGRESS':'COMPLETED'});}
   return Response.json({text:'수요와 공급으로 균형 가경이 결정됩니다. 수요는 10% 증가하지 않습니다. 가격 변화의 영향입니다.',chunks:[{text:'수요와 공급으로 균형 가경이 결정됩니다. 수요는 10% 증가하지 않습니다.',timestamp:[0,10]},{text:'가격 변화의 영향입니다. 조건은 x > 0입니다.',timestamp:[601,605]}]});
 }
 if(url.startsWith('https://api.assemblyai.com/')){
   if(headers.get('Authorization')==='invalid-assemblyai-key1234')return Response.json({error:'invalid'},{status:401});
   if(init?.method==='DELETE'){
     const db=(env as unknown as {DB:D1Database}).DB;
     const row=await db.prepare('SELECT l.status,l.notes FROM lectures l JOIN media_jobs m ON m.lecture_id=l.id WHERE m.remote_id=?').bind(url.split('/').pop()).first<{status:string;notes:string}>();
     if(!row?.notes||row.status!=='complete')throw new Error('Deletion must follow durable note storage');
     deletions++;
     if(deletions===1)return Response.json({error:'temporary'},{status:500});
     return Response.json({is_deleted:true});
   }
   throw new Error('New STT must use Whisper');
 }
 if(url.startsWith('https://api.deepseek.com/')){
   if(headers.get('Authorization')==='Bearer sk-invalid-test-value123456')return Response.json({error:'invalid'},{status:401});
   const data=JSON.parse(init?.body as string),input=JSON.parse(data.messages[1].content);
   if(data.model!=='deepseek-flash'||data.thinking?.type!=='disabled')throw new Error('Invalid DeepSeek configuration');
   if(data.response_format&&data.response_format.type!=='json_object')throw new Error('Invalid JSON mode');
   if(input.raw_transcript){
     corrections++;
     if(!data.response_format||data.temperature!==0)throw new Error('Invalid correction configuration');
     if(input.raw_transcript.includes('가경')&&!input.next_context.includes('조건'))throw new Error('Missing neighboring raw context');
     if(input.raw_transcript.includes('조건')&&!input.previous_context.includes('가경'))throw new Error('Context must remain raw');
     const changed=input.raw_transcript.includes('가경');
     const result={corrected_transcript:input.raw_transcript.replace('가경','가격'),changes:changed?[{before:'균형 가경',after:'균형 가격',reason:'주변 문장에서 가격 변화를 설명합니다.'}]:[],uncertainties:[]};
     if(headers.get('Authorization')==='Bearer sk-number-test-value123456')result.corrected_transcript=result.corrected_transcript.replace('10%','20%');
     if(headers.get('Authorization')==='Bearer sk-truncated-test-value123456')result.corrected_transcript='요약';
     return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(result)}}]});
   }
   if(data.response_format)return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({overview:'수요와 공급을 통한 균형 가격 설명',concepts:[{term:'균형',explanation:'수요량과 공급량이 일치한다.'}],sections:[{title:'가격',body:'가격 변화의 영향'}],review:['균형의 의미'],questions:[{question:'균형은?',answer:'수요량과 공급량이 일치하는 상태'}]})}}]});
   if(!input.transcript||input.transcript.includes('가경'))throw new Error('Outline must use corrected transcript');
   return Response.json({choices:[{finish_reason:'stop',message:{content:'수요와 공급으로 균형 가격이 결정된다.'}}]});
 }
 return realFetch(input,init);
};
export default {async fetch(request:Request){
 const path=new URL(request.url).pathname;
 if(path==='/test-cancels')return Response.json({cancellations});
 if(path==='/test-stats')return Response.json({submissions,polls,uploads,deletions,corrections});
 if(path==='/api/lectures/settings')return request.method==='GET'?settingsGet(request):request.method==='DELETE'?settingsDelete(request):settingsSave(request);
 if(path==='/api/lectures')return request.method==='GET'?list(request):create(request);
 const m=path.match(/^\/api\/lectures\/([^/]+)\/([^/]+)$/);if(!m)return new Response('Not found',{status:404});
 const ctx={params:Promise.resolve({id:m[1],action:m[2]})};return request.method==='GET'?detail(request,ctx):request.method==='DELETE'?remove(request,ctx):action(request,ctx);
}};
