'use client';
import Link from 'next/link';
import { useEffect, useRef, useState, useCallback } from 'react';
import { BookOpen, FileVideo, Upload, Plus, KeyRound, Check, FileText, Download, CircleHelp, Layers, ListChecks, LoaderCircle, Headphones, LockKeyhole, ChevronRight, Copy, Cloud, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { Toaster, toast } from 'sonner';
import { type Lecture, type Notes, type MediaCleanup, type KeySettings, type KeyProvider, MAX_MEDIA, UPLOAD_PART_BYTES, CHUNK_SECONDS, timeLabel, exportNotes } from '@/lib/types';

async function api<T>(path:string,options:RequestInit={}):Promise<T>{
 const r=await fetch(`/api/lectures${path}`,{...options,cache:'no-store'});
 const data=await r.json() as T & {error?:string};
 if(!r.ok)throw new Error(data.error||'요청을 완료하지 못했습니다. 다시 시도하세요.');
 return data;
}
const statusText:Record<string,string>={uploading:'업로드 중',ready:'파일 저장됨',transcribing:'전사 중',transcribed:'전사 완료',summarizing:'노트 생성 중',complete:'노트 완성',error:'확인 필요',deleting:'삭제 마무리 필요'};
const durationLabel=(l:Lecture)=>l.duration?`${Math.ceil(l.duration/60)}분`:'길이 확인 대기';
export default function Home(){
 const [lectures,setLectures]=useState<Lecture[]>([]),[selected,setSelected]=useState<Lecture|null>(null),[file,setFile]=useState<File|null>(null),[title,setTitle]=useState('');
 const [keyDraft,setKeyDraft]=useState(''),[speechDraft,setSpeechDraft]=useState(''),[keyOpen,setKeyOpen]=useState(false),[keySaving,setKeySaving]=useState(false),[keyError,setKeyError]=useState(''),[settings,setSettings]=useState<KeySettings|null>(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[libraryError,setLibraryError]=useState(''),[stage,setStage]=useState(''),[progress,setProgress]=useState(0),[tab,setTab]=useState('notes'),[dragging,setDragging]=useState(false),[loading,setLoading]=useState(false);
 const [deleteTarget,setDeleteTarget]=useState<Lecture|null>(null),[deleting,setDeleting]=useState(false),[deleteError,setDeleteError]=useState(''),[requestId,setRequestId]=useState('');
 const input=useRef<HTMLInputElement>(null),settingsRef=useRef<KeySettings|null>(null),busyRef=useRef(false),selectedRef=useRef<Lecture|null>(null),lifecycle=useRef<AbortController|null>(null);
 useEffect(()=>{const controller=new AbortController();lifecycle.current=controller;return()=>controller.abort();},[]);
 const refreshKeys=useCallback(async()=>{const value=await api<KeySettings>('/settings');settingsRef.current=value;setSettings(value);return value;},[]);
 useEffect(()=>{let active=true;void api<KeySettings>('/settings').then(value=>{if(active){settingsRef.current=value;setSettings(value);}}).catch(()=>{});return()=>{active=false;};},[]);
 const openKeys=useCallback(()=>{setKeyDraft('');setSpeechDraft('');setKeyError('');setKeyOpen(true);void refreshKeys().catch(e=>setKeyError(e instanceof Error?e.message:'키 설정을 불러오지 못했습니다.'));},[refreshKeys]);
 async function saveApiKeys(){
   const deepseek=keyDraft.trim(),speech=speechDraft.trim(),provider:KeyProvider=selectedRef.current?.provider==='assemblyai'?'assemblyai':'fal';
   if(!deepseek&&!speech){setKeyError('새로 저장하거나 교체할 API 키를 입력해주세요.');return;}
   if((deepseek&&(deepseek.length<20||deepseek.length>512))||(speech&&(speech.length<20||speech.length>512))){setKeyError('API 키를 확인해주세요.');return;}
   setKeySaving(true);setKeyError('');
   try{const value=await api<KeySettings>('/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...(deepseek?{deepseek}:{}),...(speech?{[provider]:speech}:{})})});settingsRef.current=value;setSettings(value);setKeyDraft('');setSpeechDraft('');setKeyOpen(false);toast.success('키를 저장했습니다. 다음 접속부터 자동으로 사용합니다.');}
   catch(e){setKeyError(e instanceof Error?e.message:'키를 저장하지 못했습니다.');}
   finally{setKeySaving(false);}
 }
 async function deleteApiKey(provider:KeyProvider){
   setKeySaving(true);setKeyError('');
   try{const value=await api<KeySettings>('/settings',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({providers:[provider]})});settingsRef.current=value;setSettings(value);if(provider==='deepseek')setKeyDraft('');else setSpeechDraft('');toast.success('저장된 키를 삭제했습니다.');}
   catch(e){setKeyError(e instanceof Error?e.message:'키를 삭제하지 못했습니다.');}
   finally{setKeySaving(false);}
 }
 const refresh=useCallback(async()=>{try{setLectures(await api<Lecture[]>(''));setLibraryError('');}catch(e){setLibraryError(e instanceof Error?e.message:'저장된 강의를 불러오지 못했습니다.');}},[]);
 useEffect(()=>{let active=true;void api<Lecture[]>('').then(data=>{if(active){setLectures(data);setLibraryError('');}}).catch(e=>{if(active)setLibraryError(e instanceof Error?e.message:'저장된 강의를 불러오지 못했습니다.');});return()=>{active=false;};},[]);
 const load=useCallback(async(id:string)=>{setLoading(true);try{const lecture=await api<Lecture>(`/${id}/detail`);setSelected(lecture);selectedRef.current=lecture;setRequestId(lecture.remote_request_id||'');setTab('notes');setError('');}finally{setLoading(false);}},[]);
 function newLecture(){if(busyRef.current)return;setSelected(null);selectedRef.current=null;setFile(null);setTitle('');setError('');setStage('');setRequestId('');setProgress(0);if(input.current)input.current.value='';}
 async function removeLecture(){
   const target=deleteTarget;if(!target||busyRef.current)return;
   busyRef.current=true;setBusy(true);setDeleting(true);setDeleteError('');
   try{
     const result=await api<{deleted:boolean;provider_cleanup:string}>(`/${target.id}/delete`,{method:'DELETE'});
     setLectures(current=>current.filter(l=>l.id!==target.id));
     if(selectedRef.current?.id===target.id){setSelected(null);selectedRef.current=null;setFile(null);setTitle('');setError('');setStage('');setProgress(0);setRequestId('');if(input.current)input.current.value='';}
     setDeleteTarget(null);
     if(result.provider_cleanup==='pending')toast.warning('강의를 삭제했습니다. 외부 API의 요청 취소·삭제 여부는 fal 또는 AssemblyAI에서 확인해주세요.');
     else toast.success('강의를 삭제했습니다.');
   }catch(e){setDeleteError(e instanceof Error?e.message:'강의를 삭제하지 못했습니다.');}
   finally{busyRef.current=false;setBusy(false);setDeleting(false);await refresh();}
 }
 function chooseFile(chosen?:File){
   if(!chosen||busyRef.current)return;
   if(!/\.(mp4|webm|m4a|mp3|wav)$/i.test(chosen.name)){setError('MP4, WebM, MP3, M4A, WAV 파일을 선택해주세요.');return;}
   if(chosen.size===0||chosen.size>MAX_MEDIA){setError('0MB보다 크고 2GB 이하인 파일을 선택해주세요.');return;}
   const saved=selectedRef.current;
   if(saved?.cloud&&!saved.source_ready){if(chosen.name!==saved.filename||chosen.size!==saved.bytes){setError('업로드를 이어가려면 이전과 같은 이름·크기의 원본 파일을 선택해주세요. 다른 파일은 새 강의로 올려주세요.');return;}setTitle(saved.title);}
   else{setSelected(null);selectedRef.current=null;setRequestId('');setTitle(chosen.name.replace(/\.[^.]+$/,''));}
   setFile(chosen);setError('');setStage('');
 }
 const processSaved=useCallback(async(lecture:Lecture)=>{
   const keys=settingsRef.current||await refreshKeys();
   if(!keys.providers.deepseek){openKeys();return;}
   let detail=await api<Lecture>(`/${lecture.id}/detail`);
   setRequestId(detail.remote_request_id||'');
   if(detail.cloud&&detail.remote_status!=='completed'){
     if(!detail.source_ready)throw new Error('원본 파일 업로드가 아직 끝나지 않았습니다. 같은 파일을 선택해 이어서 올려주세요.');
     if(!keys.providers[detail.provider==='assemblyai'?'assemblyai':'fal']){openKeys();return;}
     setStage('저장된 파일을 외부 음성 인식 서버로 전달하는 중');setProgress(40);
     const signal=lifecycle.current?.signal;
     const started=await api<{request_id?:string}>(`/${lecture.id}/speech-start`,{method:'POST',signal});
     if(started.request_id)setRequestId(started.request_id);
     setStage('외부 Whisper 서버에서 한국어 전사 중');setProgress(55);
     while(true){
       signal?.throwIfAborted();
       const result=await api<{status:string;loaded?:number;total?:number;delay_ms?:number;request_id?:string}>(`/${lecture.id}/speech-poll`,{method:'POST',signal});
       if(result.request_id)setRequestId(result.request_id);
       if(result.status==='completed')break;
       setStage(result.status==='transferring'?`Whisper 서버로 파일 전달 중 · ${Math.round((result.loaded||0)/(result.total||1)*100)}%`:result.status==='queued'?'Whisper 처리 대기 중':'Whisper 서버에서 한국어 전사 중');
       if(result.status==='transferring')setProgress(40+Math.round((result.loaded||0)/(result.total||1)*12));
       await new Promise<void>((resolve,reject)=>{const abort=()=>{clearTimeout(timer);reject(new DOMException('Aborted','AbortError'));};const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},result.delay_ms??10000);signal?.addEventListener('abort',abort,{once:true});});
     }
     detail=await api<Lecture>(`/${lecture.id}/detail`);setSelected(detail);selectedRef.current=detail;await refresh();
   }
   if(!detail.total||detail.chunks?.some(c=>!c.transcript))throw new Error('이전 방식의 미완료 강의입니다. 새 강의에서 원본 영상이나 소리 파일을 올려주세요.');
   for(const chunk of detail.chunks||[]){
     if(chunk.corrected_transcript)continue;
     setStage(`DeepSeek로 문맥 교정 중 · ${chunk.ordinal+1}/${detail.total}`);setProgress(60+Math.round(chunk.ordinal/detail.total*15));
     await api(`/${lecture.id}/correct`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ordinal:chunk.ordinal}),signal:lifecycle.current?.signal});
   }
   detail=await api<Lecture>(`/${lecture.id}/detail`);setSelected(detail);selectedRef.current=detail;
   for(const chunk of detail.chunks||[]){
     if(chunk.outline)continue;
     setStage(`DeepSeek로 구간 정리 중 · ${chunk.ordinal+1}/${detail.total}`);setProgress(76+Math.round(chunk.ordinal/detail.total*12));
     await api(`/${lecture.id}/transcribe`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ordinal:chunk.ordinal}),signal:lifecycle.current?.signal});
   }
   setStage('DeepSeek로 핵심 개념과 복습 포인트 정리 중');setProgress(90);
   const result=await api<{cleanup:MediaCleanup}>(`/${lecture.id}/summarize`,{method:'POST',signal:lifecycle.current?.signal});
   await load(lecture.id);setProgress(100);await refresh();
   if(result.cleanup.source==='pending'||result.cleanup.provider==='pending'){setStage('학습 노트 저장 완료 · 원본 삭제 마무리 필요');toast.warning('노트는 저장됐습니다. 원본 삭제 마무리 버튼을 눌러주세요.');}
   else{setStage('노트 저장 완료');toast.success('노트를 저장했습니다.');}
 },[load,refresh,openKeys,refreshKeys]);
 const resume=useCallback(async()=>{
   const lecture=selectedRef.current;if(!lecture||busyRef.current)return;
   busyRef.current=true;setBusy(true);setError('');
   try{await processSaved(lecture);}catch(e){if(!lifecycle.current?.signal.aborted)setError(e instanceof Error?e.message:'처리를 완료하지 못했습니다.');}
   finally{busyRef.current=false;setBusy(false);await refresh();}
 },[processSaved,refresh]);
 useEffect(()=>{const context=(document as Document & {modelContext?:{registerTool:(tool:unknown,options:unknown)=>Promise<void>|void}}).modelContext;if(!context?.registerTool)return;const controller=new AbortController();const register=(tool:unknown)=>{try{void Promise.resolve(context.registerTool(tool,{signal:controller.signal})).catch(()=>{});}catch{}};
 register({name:'list_saved_lectures',title:'저장된 강의 목록',description:'현재 사용자의 저장된 강의와 처리 상태를 조회합니다.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:true},execute:async()=>{const data=await api<Lecture[]>('');setLectures(data);return data.map(l=>({id:l.id,title:l.title,status:l.status}));}});
 register({name:'open_saved_lecture',title:'강의 노트 열기',description:'저장된 강의를 열어 전사문과 학습 노트를 표시합니다.',inputSchema:{type:'object',properties:{id:{type:'string'}},required:['id'],additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:true},execute:async(value:unknown)=>{if(busyRef.current)throw new Error('처리 중에는 다른 강의를 열 수 없습니다.');const id=(value as {id?:unknown})?.id;if(typeof id!=='string'||!id||id.length>80)throw new Error('유효한 강의 ID가 필요합니다.');setFile(null);await load(id);return {id,opened:true};}});return()=>controller.abort();},[load]);
 async function start(){
   if(!file||!title.trim()||busyRef.current)return;
   busyRef.current=true;setBusy(true);setError('');setProgress(0);
   try{
     let lecture=selectedRef.current;
     if(!lecture){lecture=await api<Lecture>('',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:title.trim(),filename:file.name,bytes:file.size})});setSelected(lecture);selectedRef.current=lecture;}
     let detail=await api<Lecture>(`/${lecture.id}/detail`);
     if(!detail.source_ready){
       const count=Math.ceil(file.size/UPLOAD_PART_BYTES),saved=new Set(detail.parts||[]);
       for(let part=1;part<=count;part++){
         if(saved.has(part))continue;
         setStage(`원본 파일 저장 중 · ${part}/${count}`);setProgress(Math.round((part-1)/count*35));
         await api(`/${lecture.id}/upload-part?part=${part}`,{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:file.slice((part-1)*UPLOAD_PART_BYTES,Math.min(part*UPLOAD_PART_BYTES,file.size)),signal:lifecycle.current?.signal});
       }
       await api(`/${lecture.id}/finish-upload`,{method:'POST'});
       detail=await api<Lecture>(`/${lecture.id}/detail`);setSelected(detail);selectedRef.current=detail;await refresh();
     }
     setFile(null);setStage('원본 파일이 서버에 저장됐습니다');setProgress(35);
     await processSaved(detail);
   }catch(e){if(!lifecycle.current?.signal.aborted)setError(e instanceof Error?e.message:'처리를 완료하지 못했습니다.');}
   finally{busyRef.current=false;setBusy(false);await refresh();}
 }
 async function retryCleanup(){
   const lecture=selectedRef.current;if(!lecture||busyRef.current)return;
   if(lecture.provider==='assemblyai'&&!lecture.provider_deleted_at){const keys=settingsRef.current||await refreshKeys();if(!keys.providers.assemblyai){openKeys();return;}}
   busyRef.current=true;setBusy(true);setError('');
   try{const result=await api<{cleanup:MediaCleanup}>(`/${lecture.id}/cleanup-source`,{method:'POST'});await load(lecture.id);await refresh();if(result.cleanup.source==='pending'||result.cleanup.provider==='pending')toast.warning('노트는 보관되어 있습니다. API 키와 연결 상태를 확인하고 삭제를 다시 시도하세요.');else toast.success('원본 파일을 삭제했습니다.');}
   catch(e){setError(e instanceof Error?e.message:'원본 삭제를 완료하지 못했습니다.');}
   finally{busyRef.current=false;setBusy(false);}
 }
 const notes:Notes|null=selected?.notes?JSON.parse(selected.notes):null;
 function download(){if(!selected||!notes)return;const url=URL.createObjectURL(new Blob([exportNotes(selected,notes)],{type:'text/markdown;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=`${selected.title.replace(/[<>:"/\\|?*]/g,'_')}.md`;a.click();URL.revokeObjectURL(url);}
 return <div className="workspace"><Toaster position="top-center" richColors/>
 <aside className="rail"><Link className="brand" href="/"><span className="brand-icon"><BookOpen size={23}/></span><span>강의노트<span className="brand-sub">LECTURE NOTES</span></span></Link><Button onClick={newLecture} disabled={busy} className="new-button"><Plus size={18}/>새 강의 올리기</Button><div className="library-heading">내 강의 <span>{lectures.length}</span></div><nav className="lecture-list" aria-label="저장된 강의">{lectures.map(l=><div className={`lecture-row ${selected?.id===l.id?'active':''}`} key={l.id}><button disabled={busy||loading} className="lecture-item" onClick={()=>{setFile(null);setStage('');void load(l.id).catch(e=>setError(e.message));}}><FileText size={18}/><span><strong>{l.title}</strong><small>{statusText[l.status]||'처리 대기'} · {durationLabel(l)}</small></span></button><button type="button" className="lecture-delete" disabled={busy||loading} aria-label={`${l.title} 삭제`} title="강의 삭제" onClick={()=>{setDeleteError('');setDeleteTarget(l);}}><Trash2 size={16}/></button></div>)}{lectures.length===0&&!libraryError&&<div className="library-empty">첫 강의를 올려보세요.<br/>만든 노트가 여기에 쌓입니다.</div>}{libraryError&&<div className="library-error"><p>{libraryError}</p><button onClick={()=>void refresh()}>다시 불러오기</button></div>}</nav><div className="rail-footer"><LockKeyhole size={16}/><span>나만의 학습 공간</span></div></aside>
 <div className="main"><header className="topbar"><div className="breadcrumb">내 학습 공간 <ChevronRight size={14}/><strong>{selected?'강의 노트':'새 강의'}</strong></div><Button variant="outline" className="key-button" onClick={openKeys} disabled={busy}><KeyRound size={16}/>{settings?.providers.deepseek&&settings.providers[selected?.provider==='assemblyai'?'assemblyai':'fal']?'API 연결됨':'API 연결'}</Button></header><main className="content"><div className="page-heading"><div><p className="eyebrow">CLOUD TO NOTES</p><h1>{selected?.title||'강의를 올리면, 학습 노트로.'}</h1><p>{selected?`${selected.filename} · ${durationLabel(selected)} · ${new Date(selected.created).toLocaleDateString('ko-KR')}`:'강의 파일을 올려 나만의 복습 노트를 만드세요.'}</p></div><span className="personal-badge"><Cloud size={14}/>클라우드 처리</span></div>
 <div className="work-grid"><section className="upload-panel"><div className="panel-label"><span className="step-number">01</span><h2>{selected?.source_ready?'저장된 강의':'영상 또는 소리 파일 올리기'}</h2></div>
 {(!selected||file||(selected.cloud&&!selected.source_ready))?<><input ref={input} type="file" accept=".mp4,.webm,.mp3,.m4a,.wav" className="sr-only" onChange={e=>chooseFile(e.target.files?.[0])} disabled={busy}/><button className={`dropzone ${dragging?'dragging':''} ${file?'has-file':''}`} disabled={busy} onClick={()=>input.current?.click()} onDragOver={e=>{e.preventDefault();setDragging(true);}} onDragLeave={()=>setDragging(false)} onDrop={e=>{e.preventDefault();setDragging(false);chooseFile(e.dataTransfer.files[0]);}}><span className="upload-symbol">{file?<FileVideo size={27}/>:<Upload size={27}/>}</span><strong>{file?file.name:selected?'같은 원본 파일을 다시 선택하세요':'강의 파일을 여기에 놓으세요'}</strong><span>{file?`${(file.size/1024/1024).toFixed(1)} MB · 클릭해서 파일 바꾸기`:'또는 클릭해서 파일 선택'}</span><small>MP4 · WebM · MP3 · M4A · WAV<br/>최대 2GB · 한국어 강의</small></button><div className="title-field"><Label htmlFor="lecture-title">강의 이름</Label><Input id="lecture-title" value={selected?.title||title} onChange={e=>setTitle(e.target.value)} disabled={busy||!!selected} placeholder="예: 경제학개론 3주차" maxLength={160}/></div><Button className="generate-button" disabled={!file||!title.trim()||busy} onClick={()=>void start()}>{busy?<LoaderCircle size={18} className="spin"/>:<BookOpen size={18}/>} {busy?'처리 중':selected?'이어서 업로드':'노트 만들기'}</Button></>:<div className="saved-media"><span className="saved-media-icon"><Cloud size={32}/></span><h3>{selected.filename}</h3><p>{selected.cloud?(selected.source_deleted_at?'서버의 원본 파일이 삭제됐습니다.':selected.source_ready?'원본은 노트 저장 후 자동 삭제됩니다.':'파일 업로드 대기'):`이전 방식 · ${selected.uploaded}개 음성 구간 저장됨`}</p>{selected.status!=='complete'&&selected.status!=='deleting'&&<Button className="generate-button" onClick={()=>void resume()} disabled={busy}>{busy?<LoaderCircle className="spin" size={18}/>:<BookOpen size={18}/>}학습 노트 {selected.completed?'이어서 만들기':'만들기'}</Button>}{selected.source_ready===1&&!selected.source_deleted_at&&<a className="source-download" href={`/api/lectures/${selected.id}/source`}><Download size={16}/>저장된 원본 다운로드</a>}{selected.cloud&&selected.notes&&(!selected.source_deleted_at||(selected.provider!=='fal'&&!selected.provider_deleted_at))&&<div className="cleanup-status"><p>노트는 저장됐습니다. 원본 파일 삭제가 남아 있습니다.</p><Button variant="outline" disabled={busy} onClick={()=>void retryCleanup()}>원본 삭제 마무리</Button></div>}{!selected.cloud&&selected.status!=='complete'&&<p className="fine-print">전사되지 않은 이전 강의는 원본을 새 강의로 올려주세요.</p>}</div>}
 {(busy||stage)&&<div className="processing" role="status" aria-live="polite"><div><span>{stage}</span><strong>{progress}%</strong></div><Progress value={progress}/><p>{busy?'이 창을 열어두세요. 닫아도 이어서 만들 수 있습니다.':''}</p></div>}{error&&<div className="error-box" role="alert"><strong>처리를 확인해주세요</strong><p>{error}</p>{selected?.provider==='fal'&&<div className="fal-help"><a href="https://fal.ai/models/fal-ai/wizper" target="_blank" rel="noreferrer">fal에서 확인</a>{requestId&&<p>요청 번호: <code>{requestId}</code></p>}</div>}</div>}
 <div className="pipeline"><h3>외부 서버에서 정리합니다</h3><div><span className="pipeline-node"><Cloud size={16}/>파일 저장</span><span className="pipeline-line"/><span className="pipeline-node"><Headphones size={16}/>Whisper</span><span className="pipeline-line"/><span className="pipeline-node"><BookOpen size={16}/>교정·노트</span></div></div>
 <p className="privacy-note"><LockKeyhole size={15}/>노트 자동 저장 · 완성 후 원본 자동 삭제</p><details className="storage-help"><summary>보관·요금 안내</summary><p>Whisper와 DeepSeek 이용 요금은 각 API 계정에 부과됩니다. 실패한 파일은 재시도를 위해 보관하며, fal 임시 파일은 24시간 후 만료됩니다.</p><p>원문·교정 대본·노트는 강의를 삭제할 때까지 보관합니다.</p></details></section>
 <section className="notes-panel"><div className="notes-top"><div className="panel-label"><span className="step-number yellow">02</span><h2>나의 학습 노트</h2></div>{notes&&<div className="note-actions"><Button variant="ghost" size="icon" aria-label="학습 노트 복사" onClick={()=>{if(selected)void navigator.clipboard.writeText(exportNotes(selected,notes)).then(()=>toast.success('노트를 복사했습니다.')).catch(()=>toast.error('복사할 수 없습니다. 다운로드를 이용하세요.'));}}><Copy size={17}/></Button><Button variant="outline" onClick={download}><Download size={16}/>다운로드</Button></div>}</div>
 {loading?<div className="note-empty"><LoaderCircle className="spin" size={28}/><h3>강의를 불러오는 중</h3></div>:<Tabs value={tab} onValueChange={setTab}><TabsList variant="line" className="note-tabs"><TabsTrigger value="notes">학습 노트</TabsTrigger><TabsTrigger value="corrected">교정 대본</TabsTrigger><TabsTrigger value="transcript">원문 전사</TabsTrigger></TabsList><TabsContent value="notes">{notes?<article className="note-document"><span className="complete-label"><Check size={14}/>정리 완료</span><section className="overview"><p className="section-kicker">한눈에 보는 강의</p><h3>전체 요약</h3><p>{notes.overview}</p></section><section><h3><Layers size={19}/>핵심 개념</h3><div className="concept-list">{notes.concepts.map((c,i)=><div key={i}><strong>{c.term}</strong><p>{c.explanation}</p></div>)}</div></section><section><h3><FileText size={19}/>강의 내용</h3>{notes.sections.map((s,i)=><div className="topic" key={i}><h4>{s.title}</h4><p>{s.body}</p></div>)}</section><section><h3><ListChecks size={19}/>복습 포인트</h3><ul className="review-list">{notes.review.map((r,i)=><li key={i}>{r}</li>)}</ul></section><section><h3><CircleHelp size={19}/>확인 질문</h3>{notes.questions.map((q,i)=><details className="question" key={i}><summary>{q.question}</summary><p>{q.answer}</p></details>)}</section><p className="note-disclaimer">AI 노트의 중요한 내용은 원문과 대조하세요.</p></article>:<div className="note-empty"><div className="empty-paper"><FileText size={38}/><span>NOTE</span></div><h3>{selected?'학습 노트를 만들 준비가 됐어요':'복습할 내용만, 차곡차곡.'}</h3><p>{selected?'API를 연결하고 학습 노트 만들기를 눌러주세요.':'영상이나 소리 파일을 올리면 노트가 이곳에 나타납니다.'}</p><div className="output-map"><div><span>01</span><strong>전체 요약</strong><small>강의의 큰 흐름</small></div><div><span>02</span><strong>핵심 개념</strong><small>용어와 주요 설명</small></div><div><span>03</span><strong>복습 포인트</strong><small>다시 짚어볼 내용</small></div><div><span>04</span><strong>확인 질문</strong><small>이해도 점검</small></div></div></div>}</TabsContent><TabsContent value="corrected">{selected?.chunks?.some(c=>c.corrected_transcript)?<div className="transcript"><p className="fine-print">교정 대본 · 각 구간의 수정 내역을 확인할 수 있습니다.</p>{selected.chunks.map(c=><section key={c.ordinal}><span>{timeLabel(c.start_seconds??c.ordinal*CHUNK_SECONDS)}부터 · 구간 시작 기준</span><p>{c.corrected_transcript||'아직 교정하지 않은 구간입니다.'}</p>{c.correction_audit&&<CorrectionAudit value={c.correction_audit}/>}</section>)}</div>:<div className="note-empty"><FileText size={36}/><h3>문맥을 살펴 다듬은 대본.</h3><p>교정이 끝나면 대본과 수정 내역이 표시됩니다.</p></div>}</TabsContent><TabsContent value="transcript">{selected?.chunks?.some(c=>c.transcript)?<div className="transcript">{selected.chunks.map(c=><section key={c.ordinal}><span>{timeLabel(c.start_seconds??c.ordinal*CHUNK_SECONDS)}부터 · 구간 시작 기준</span><p>{c.transcript||'아직 전사하지 않은 구간입니다.'}</p></section>)}</div>:<div className="note-empty"><Headphones size={36}/><h3>강의의 말, 그대로.</h3><p>음성 전사가 완료되면 구간별 원문을 볼 수 있습니다.</p></div>}</TabsContent></Tabs>}
 </section></div><footer className="page-footer"><span>한 강의씩, 나의 언어로 이해하기.</span><span>한국어 학습 노트 · 원문과 교정 대본 보존</span></footer></main></div>
 <Dialog open={!!deleteTarget} onOpenChange={open=>{if(!open&&!deleting){setDeleteTarget(null);setDeleteError('');}}}><DialogContent className="key-dialog"><DialogHeader><DialogTitle>강의를 삭제할까요?</DialogTitle><DialogDescription>「{deleteTarget?.title}」의 파일·대본·노트를 삭제합니다. 되돌릴 수 없습니다.</DialogDescription></DialogHeader>{deleteTarget?.provider==='fal'&&<p className="fine-print">fal 임시 파일은 기존 만료 시점에 삭제됩니다. 진행 중인 전사는 취소를 요청합니다.</p>}{deleteError&&<p className="key-error" role="alert">{deleteError}</p>}<div className="dialog-actions"><Button variant="outline" disabled={deleting} onClick={()=>setDeleteTarget(null)}>취소</Button><Button variant="destructive" disabled={deleting} onClick={()=>void removeLecture()}>{deleting?<LoaderCircle className="spin" size={16}/>:<Trash2 size={16}/>}삭제</Button></div></DialogContent></Dialog>
 <Dialog open={keyOpen} onOpenChange={open=>{if(!keySaving){setKeyOpen(open);if(!open){setKeyDraft('');setSpeechDraft('');setKeyError('');}}}}><DialogContent className="key-dialog"><DialogHeader><DialogTitle>API 연결 관리</DialogTitle><DialogDescription>키를 한 번 저장하면 다음 접속부터 자동으로 사용합니다.</DialogDescription></DialogHeader><div className="key-instructions"><p>키는 암호화해 보관합니다. 빈 입력란은 기존 키를 유지하며, 이용 요금은 각 API 계정에 부과됩니다.</p></div>
 <div className="key-field-heading"><Label htmlFor="speech-key">{selected?.provider==='assemblyai'?'이전 강의용 AssemblyAI API 키':'fal API 키 (Whisper)'}</Label>{settings?.providers[selected?.provider==='assemblyai'?'assemblyai':'fal']&&<span className="key-saved"><Check size={13}/>저장됨</span>}</div><Input id="speech-key" type="password" autoComplete="off" spellCheck={false} maxLength={512} disabled={keySaving} placeholder={settings?.providers[selected?.provider==='assemblyai'?'assemblyai':'fal']?'교체할 새 키를 입력하세요':'API 키를 입력하세요'} value={speechDraft} onChange={e=>setSpeechDraft(e.target.value)}/><div className="key-links"><a className="key-link" href={selected?.provider==='assemblyai'?'https://www.assemblyai.com/dashboard':'https://fal.ai/dashboard/keys'} target="_blank" rel="noreferrer">API 키 확인</a>{settings?.providers[selected?.provider==='assemblyai'?'assemblyai':'fal']&&<button type="button" disabled={keySaving} onClick={()=>void deleteApiKey(selected?.provider==='assemblyai'?'assemblyai':'fal')}>저장된 키 삭제</button>}</div>
 <div className="key-field-heading"><Label htmlFor="api-key">DeepSeek API 키</Label>{settings?.providers.deepseek&&<span className="key-saved"><Check size={13}/>저장됨</span>}</div><Input id="api-key" type="password" autoComplete="off" spellCheck={false} maxLength={512} disabled={keySaving} placeholder={settings?.providers.deepseek?'교체할 새 키를 입력하세요':'sk-…'} value={keyDraft} onChange={e=>setKeyDraft(e.target.value)}/><div className="key-links"><a className="key-link" href="https://platform.deepseek.com/api_keys" target="_blank" rel="noreferrer">DeepSeek API 키 확인</a>{settings?.providers.deepseek&&<button type="button" disabled={keySaving} onClick={()=>void deleteApiKey('deepseek')}>저장된 키 삭제</button>}</div>
 {keyError&&<p className="key-error" role="alert">{keyError}</p>}{settings&&!settings.storage_ready&&<p className="key-error" role="alert">서버의 키 저장소가 준비되지 않았습니다. 잠시 후 다시 시도하세요.</p>}<div className="dialog-actions"><Button variant="outline" disabled={keySaving} onClick={()=>{setKeyDraft('');setSpeechDraft('');setKeyOpen(false);}}>닫기</Button><Button disabled={keySaving||!settings?.storage_ready||(!keyDraft.trim()&&!speechDraft.trim())} onClick={()=>void saveApiKeys()}>{keySaving?<LoaderCircle className="spin" size={16}/>:<LockKeyhole size={16}/>}저장하고 연결</Button></div></DialogContent></Dialog>
 </div>;
}

function CorrectionAudit({value}:{value:string}){
 let audit:{changes:{before:string;after:string;reason:string}[];uncertainties:string[]};try{audit=JSON.parse(value);}catch{return null;}
 return <details className="question"><summary>수정 내역 {audit.changes.length}건 · 확인할 표현 {audit.uncertainties.length}건</summary><div className="correction-audit">{audit.changes.map((c,i)=><p key={i}><strong>{c.before} → {c.after}</strong><br/>{c.reason}</p>)}{audit.uncertainties.map((u,i)=><p key={`u-${i}`}>확인 필요: {u}</p>)}{!audit.changes.length&&!audit.uncertainties.length&&<p>원문 표현을 유지했습니다.</p>}</div></details>;
}
