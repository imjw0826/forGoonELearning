import {createRequire} from 'node:module';
import {readFileSync,readdirSync,mkdirSync} from 'node:fs';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),viteRequire=createRequire(require.resolve('vite')),wranglerRequire=createRequire(require.resolve('wrangler'));
const {rolldown}=await import(viteRequire.resolve('rolldown'));
const {Miniflare}=await import(wranglerRequire.resolve('miniflare'));
const root=process.cwd();
mkdirSync(root+'/.sites-runtime/verification',{recursive:true});
const build=await rolldown({input:root+'/tests/integration/worker.ts',external:['cloudflare:workers'],plugins:[{name:'aliases',resolveId(id){if(id.startsWith('@/'))return root+'/'+id.slice(2)+'.ts';}}]});
await build.write({file:root+'/.sites-runtime/verification/bundle.mjs',format:'esm'});await build.close();
const mf=new Miniflare({modules:true,scriptPath:root+'/.sites-runtime/verification/bundle.mjs',compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],r2Buckets:['BUCKET'],bindings:{KEY_VAULT_SECRET:'11'.repeat(32)}});
try{
 const db=await mf.getD1Database('DB');
 for(const file of readdirSync(root+'/drizzle').filter(f=>f.endsWith('.sql')).sort()){
   for(const sql of readFileSync(root+'/drizzle/'+file,'utf8').split('--> statement-breakpoint'))await db.prepare(sql.trim()).run();
   if(file.startsWith('0000')){
     await db.prepare("INSERT INTO lectures (id,owner,title,filename,bytes,duration,total,status,notes,created) VALUES ('old','user-a','이전 노트','old.mp3',64,600,1,'complete','{}',1)").run();
     await db.prepare("INSERT INTO chunks (lecture_id,ordinal,audio_key,transcript,outline) VALUES ('old',0,'old-audio','이전 전사문','이전 구간 요약')").run();
   }
 }
 const old=await db.prepare("SELECT status,notes FROM lectures WHERE id='old'").first();assert.equal(old.status,'complete');assert.equal(old.notes,'{}');
 const key='sk-unit-test-value-123456789',speech='fal-unit-test-key123456789',stt={'x-fal-key':speech},ai={'x-deepseek-key':key};
 async function call(path='',method='GET',data,who='user-a',other={}){
   const headers={'oai-authenticated-user-id':who,...other};let body=data;
   if(data&&!(data instanceof Uint8Array)){headers['Content-Type']='application/json';body=JSON.stringify(data);}
   return mf.dispatchFetch('https://test.local/api/lectures'+path,{method,headers,body});
 }
 let r=await call('','GET',undefined,'');assert.equal(r.status,401);
 r=await call('','POST',{title:'경제학개론',filename:'lecture.mp4',bytes:16*1024*1024+64});assert.equal(r.status,201);const l=await r.json();
 r=await call('/'+l.id+'/detail','GET',undefined,'user-b');assert.equal(r.status,404);
 r=await call('/'+l.id+'/finish-upload','POST');assert.equal(r.status,409);
 r=await call('/'+l.id+'/summarize','POST',undefined,'user-a',ai);assert.equal(r.status,409);
 r=await call('/'+l.id+'/cleanup-source','POST',undefined,'user-a',stt);assert.equal(r.status,409);
 r=await call('/'+l.id+'/upload-part?part=4','POST',new Uint8Array(64),'user-a',{'Content-Type':'application/octet-stream'});assert.equal(r.status,400);
 r=await call('/'+l.id+'/upload-part?part=1','POST',new Uint8Array(64),'user-a',{'Content-Type':'application/octet-stream'});assert.equal(r.status,400);
 r=await call('/'+l.id+'/upload-part?part=1','POST',new Uint8Array(8*1024*1024).fill(7),'user-a',{'Content-Type':'application/octet-stream'});assert.equal(r.status,200);
 r=await call('/'+l.id+'/detail');const partial=await r.json();assert.deepEqual(partial.parts,[1]);assert.equal(partial.uploaded_bytes,8*1024*1024);assert.equal(partial.source_ready,0);assert(!('upload_url' in partial));
 r=await call('/'+l.id+'/upload-part?part=1','POST',new Uint8Array(8*1024*1024),'user-a',{'Content-Type':'application/octet-stream'});assert.equal(r.status,200);
 r=await call('/'+l.id+'/upload-part?part=2','POST',new Uint8Array(8*1024*1024).fill(9),'user-a',{'Content-Type':'application/octet-stream'});assert.equal(r.status,200);
 r=await call('/'+l.id+'/upload-part?part=3','POST',new Uint8Array(64).fill(8),'user-a',{'Content-Type':'application/octet-stream'});assert.equal(r.status,200);
 r=await call('/'+l.id+'/finish-upload','POST');assert.equal(r.status,200);
 r=await call('/'+l.id+'/finish-upload','POST');assert.equal(r.status,200);
 r=await call('/'+l.id+'/source');assert.equal(r.status,200);let bytes=new Uint8Array(await r.arrayBuffer());assert.equal(bytes.length,16*1024*1024+64);assert.equal(bytes[0],7);assert.equal(bytes.at(-1),8);
 r=await call('/'+l.id+'/source','GET',undefined,'user-b');assert.equal(r.status,404);
 r=await call('/'+l.id+'/speech-start','POST');assert.equal(r.status,400);
 r=await call('/'+l.id+'/speech-start','POST',undefined,'user-a',{'x-fal-key':'invalid-fal-test-key123456'});assert.equal(r.status,401);
 let job=await db.prepare('SELECT lock_until FROM media_jobs WHERE lecture_id=?').bind(l.id).first();assert.equal(job.lock_until,0);
 for(const [keyValue,code] of [['redirect-fal-test-key123456',502],['timeout-fal-test-key123456',504],['network-fal-test-key123456',502]]){r=await call('/'+l.id+'/speech-start','POST',undefined,'user-a',{'x-fal-key':keyValue});assert.equal(r.status,code);const err=await r.json();assert(err.error.includes('fal 업로드 준비'));assert(!err.error.includes(keyValue));assert(!err.error.includes('evil.test'));}

 // Persist keys once, then run the entire job without client key headers.
 r=await call('/settings','GET',undefined,'');assert.equal(r.status,401);
 r=await call('/settings');assert.deepEqual((await r.json()).providers,{deepseek:false,fal:false,assemblyai:false});
 r=await call('/settings','POST',{deepseek:key,fal:speech},'user-a',{origin:'https://evil.test'});assert.equal(r.status,403);
 r=await call('/settings','POST',{deepseek:'short'});assert.equal(r.status,400);
 r=await call('/settings','POST',{deepseek:key+'\ninvalid'});assert.equal(r.status,400);
 r=await call('/settings','POST',{deepseek:key,fal:speech});assert.equal(r.status,200);const keyStatus=await r.json();assert(keyStatus.storage_ready&&keyStatus.providers.deepseek&&keyStatus.providers.fal);assert(!JSON.stringify(keyStatus).includes(key));assert(!JSON.stringify(keyStatus).includes(speech));
 let vaultRows=(await db.prepare('SELECT * FROM provider_credentials WHERE owner=?').bind('user-a').all()).results;assert.equal(vaultRows.length,2);assert(vaultRows.every(row=>row.ciphertext!==key&&row.ciphertext!==speech));assert.notEqual(vaultRows[0].iv,vaultRows[1].iv);
 r=await call('/settings','GET',undefined,'user-b');assert.deepEqual((await r.json()).providers,{deepseek:false,fal:false,assemblyai:false});
 // Replacing the same key generates a fresh IV and authenticated ciphertext.
 const previousDeepseek=vaultRows.find(row=>row.provider==='deepseek');
 r=await call('/settings','POST',{deepseek:key});assert.equal(r.status,200);
 const replacedDeepseek=await db.prepare('SELECT * FROM provider_credentials WHERE owner=? AND provider=?').bind('user-a','deepseek').first();assert.notEqual(replacedDeepseek.iv,previousDeepseek.iv);assert.notEqual(replacedDeepseek.ciphertext,previousDeepseek.ciphertext);
 // Copying a ciphertext between providers must fail closed before any API call.
 const savedFal=await db.prepare('SELECT * FROM provider_credentials WHERE owner=? AND provider=?').bind('user-a','fal').first();
 await db.prepare('UPDATE provider_credentials SET ciphertext=?,iv=? WHERE owner=? AND provider=?').bind(replacedDeepseek.ciphertext,replacedDeepseek.iv,'user-a','fal').run();
 r=await call('/'+l.id+'/speech-start','POST');assert.equal(r.status,503);
 await db.prepare('UPDATE provider_credentials SET ciphertext=?,iv=? WHERE owner=? AND provider=?').bind(savedFal.ciphertext,savedFal.iv,'user-a','fal').run();
 r=await call('/'+l.id+'/speech-start','POST');assert.equal(r.status,200);
 r=await call('/'+l.id+'/speech-start','POST');assert.equal(r.status,200);
 r=await call('/'+l.id+'/speech-poll','POST');assert.equal(r.status,200);assert.equal((await r.json()).status,'queued');
 r=await call('/'+l.id+'/speech-poll','POST');assert.equal(r.status,200);assert.equal((await r.json()).status,'processing');
 r=await call('/'+l.id+'/speech-poll','POST');assert.equal(r.status,200);assert.equal((await r.json()).status,'completed');
 r=await call('/'+l.id+'/speech-poll','POST');assert.equal(r.status,200);
 r=await call('/'+l.id+'/detail');let detail=await r.json();assert.equal(detail.total,2);assert.equal(detail.duration,605);assert.equal(detail.chunks[1].start_seconds,601);assert.equal(detail.source_ready,1);
 r=await call('/'+l.id+'/transcribe','POST',{ordinal:0},'user-a',ai);assert.equal(r.status,409);
 r=await call('/'+l.id+'/correct','POST',{ordinal:0},'user-a',{'x-deepseek-key':'sk-number-test-value123456'});assert.equal(r.status,502);
 r=await call('/'+l.id+'/correct','POST',{ordinal:0},'user-a',{'x-deepseek-key':'sk-truncated-test-value123456'});assert.equal(r.status,502);
 r=await call('/'+l.id+'/source');assert.equal(r.status,200);await r.arrayBuffer();
 r=await call('/'+l.id+'/correct','POST',{ordinal:0},'user-a',{'x-deepseek-key':'sk-invalid-test-value123456'});assert.equal(r.status,401);
 const chunk=await db.prepare('SELECT lock_until,transcript FROM chunks WHERE lecture_id=? AND ordinal=0').bind(l.id).first();assert.equal(chunk.lock_until,0);assert(chunk.transcript);
 for(let ordinal=0;ordinal<2;ordinal++){r=await call('/'+l.id+'/correct','POST',{ordinal});assert.equal(r.status,200);}
 r=await call('/'+l.id+'/correct','POST',{ordinal:0});assert.equal(r.status,200);
 r=await call('/'+l.id+'/detail');detail=await r.json();assert(detail.chunks[0].transcript.includes('가경'));assert(detail.chunks[0].corrected_transcript.includes('균형 가격'));assert(detail.chunks[0].corrected_transcript.includes('10% 증가하지 않습니다'));assert(detail.chunks[1].corrected_transcript.includes('x > 0'));assert.equal(JSON.parse(detail.chunks[0].correction_audit).changes.length,1);
 for(let ordinal=0;ordinal<2;ordinal++){r=await call('/'+l.id+'/transcribe','POST',{ordinal});assert.equal(r.status,200);}
 r=await call('/'+l.id+'/summarize','POST');assert.equal(r.status,200);assert.equal((await r.json()).notes.concepts[0].term,'균형');
 r=await call('/'+l.id+'/detail');let retained=await r.json();assert(retained.source_deleted_at);assert.equal(retained.provider_deleted_at,null);assert(retained.notes);assert(retained.chunks.every(c=>c.transcript));
 r=await call('/'+l.id+'/source');assert.equal(r.status,404);
 const bucket=await mf.getR2Bucket('BUCKET');const jobKey=await db.prepare('SELECT source_key FROM media_jobs WHERE lecture_id=?').bind(l.id).first();assert.equal(await bucket.head(jobKey.source_key),null);
 r=await call('/'+l.id+'/cleanup-source','POST',undefined,'user-b',stt);assert.equal(r.status,404);
 r=await call('/'+l.id+'/cleanup-source','POST',undefined,'user-a',{'x-fal-key':'invalid-fal-test-key123456'});assert.equal(r.status,200);assert.equal((await r.json()).cleanup.provider,'scheduled');
 r=await call('/'+l.id+'/cleanup-source','POST',undefined,'user-a',stt);assert.equal(r.status,200);assert.deepEqual((await r.json()).cleanup,{source:'deleted',provider:'scheduled'});
 r=await call('/'+l.id+'/cleanup-source','POST',undefined,'user-a',stt);assert.equal(r.status,200);
 r=await call('/'+l.id+'/summarize','POST');assert.equal(r.status,200);
 r=await call('/'+l.id+'/detail');detail=await r.json();assert.equal(detail.status,'complete');assert.equal(detail.completed,2);
 r=await call('','POST',{title:'bad',filename:'bad.mp3',bytes:64},'user-a',{origin:'https://evil.test'});assert.equal(r.status,403);
 r=await call('','POST',{title:'bad',filename:'bad.exe',bytes:64});assert.equal(r.status,400);
 r=await call('','POST',{title:'big',filename:'big.mp4',bytes:2*1024*1024*1024+1});assert.equal(r.status,400);
 // Verify the 1.5 GiB case is accepted without allocating or decoding that file.
 r=await call('','POST',{title:'대용량 한국어 강의',filename:'large.mp4',bytes:1.5*1024*1024*1024});assert.equal(r.status,201);const large=await r.json();assert.equal(large.bytes,1610612736);
 r=await call('/'+large.id+'/upload-part?part=193','POST',new Uint8Array(64),'user-a',{'Content-Type':'application/octet-stream'});assert.equal(r.status,400);
 // An external cleanup failure must keep the newly generated note and allow retry.
 await db.prepare("INSERT INTO lectures (id,owner,title,filename,bytes,duration,total,status,created) VALUES ('retry-delete','user-a','삭제 재시도','lecture2.mp4',64,600,1,'transcribed',2)").run();
 await db.prepare("INSERT INTO media_jobs (lecture_id,source_key,upload_id,media_type,ready,remote_id,remote_status) VALUES ('retry-delete','source/retry.mp4','test-upload','video/mp4',1,'remote-job-2','completed')").run();
 await db.prepare("INSERT INTO chunks (lecture_id,ordinal,audio_key,transcript,corrected_transcript,outline) VALUES ('retry-delete',0,'','보관할 전사문','보관할 전사문','핵심 개념')").run();
 await bucket.put('source/retry.mp4',new Uint8Array(64));
 r=await call('/retry-delete/summarize','POST',undefined,'user-a',{...ai,'x-assemblyai-key':'assemblyai-unit-test-key1234'});assert.equal(r.status,200);const summary=await r.json();assert(summary.notes);assert.deepEqual(summary.cleanup,{source:'deleted',provider:'pending'});
 assert.equal(await bucket.head('source/retry.mp4'),null);
 r=await call('/retry-delete/detail');retained=await r.json();assert.equal(retained.status,'complete');assert(retained.notes);assert.equal(retained.chunks[0].transcript,'보관할 전사문');
 r=await call('/retry-delete/cleanup-source','POST',undefined,'user-a',{'x-assemblyai-key':'assemblyai-unit-test-key1234'});assert.equal(r.status,200);assert.equal((await r.json()).cleanup.provider,'deleted');
 r=await call('/retry-delete/detail');assert((await r.json()).provider_deleted_at);
 r=await call('/settings','DELETE',{providers:['deepseek','fal']},'user-b');assert.equal(r.status,200);
 r=await call('/settings');assert((await r.json()).providers.deepseek);
 r=await call('/settings','DELETE',{providers:['deepseek']});assert.equal(r.status,200);const afterDelete=await r.json();assert(!afterDelete.providers.deepseek&&afterDelete.providers.fal);
 r=await call('/retry-delete/correct','POST',{ordinal:0});assert.equal(r.status,409);
 r=await call('/'+large.id+'/correct','POST',{ordinal:0});assert.equal(r.status,400);
 r=await call('/settings','DELETE',{providers:['fal']});assert.equal(r.status,200);assert(!(await r.json()).providers.fal);
 assert.equal((await db.prepare('SELECT COUNT(*) count FROM provider_credentials').first()).count,0);
 const stats=await (await mf.dispatchFetch('https://test.local/test-stats')).json();assert.deepEqual(stats,{submissions:1,polls:2,uploads:2,deletions:2,corrections:4});
 const persisted=JSON.stringify(await db.prepare('SELECT * FROM media_jobs').all());assert(!persisted.includes(speech));assert(!persisted.includes(key));
 r=await call();const saved=await r.json();assert.equal(saved.length,4);const savedComplete=saved.find(x=>x.id===l.id);assert.equal(savedComplete.status,'complete');assert.equal(savedComplete.source_ready,1);assert(savedComplete.source_deleted_at&&savedComplete.provider_expires_at);assert.equal(savedComplete.provider,'fal');
 // User-requested deletion: ownership, request origin, every related row/file, legacy media, interrupted upload.
 r=await call('/'+l.id+'/delete','DELETE',undefined,'');assert.equal(r.status,401);
 r=await call('/'+l.id+'/delete','DELETE',undefined,'user-b');assert.equal(r.status,404);
 r=await call('/'+l.id+'/delete','DELETE',undefined,'user-a',{origin:'https://evil.test'});assert.equal(r.status,403);
 await db.prepare('UPDATE chunks SET lock_until=? WHERE lecture_id=? AND ordinal=0').bind(Date.now()+60000,l.id).run();
 r=await call('/'+l.id+'/delete','DELETE');assert.equal(r.status,409);
 await db.prepare('UPDATE chunks SET lock_until=0 WHERE lecture_id=?').bind(l.id).run();
 r=await call('/'+l.id+'/delete','DELETE');assert.equal(r.status,200);assert((await r.json()).deleted);
 for(const table of ['chunks','media_jobs','upload_parts'])assert.equal((await db.prepare('SELECT COUNT(*) n FROM '+table+' WHERE lecture_id=?').bind(l.id).first()).n,0);
 r=await call('/'+l.id+'/detail');assert.equal(r.status,404);
 r=await call('/'+l.id+'/delete','DELETE');assert.equal(r.status,404);
 await bucket.put('old-audio','legacy audio');
 r=await call('/old/delete','DELETE');assert.equal(r.status,200);assert.equal(await bucket.head('old-audio'),null);
 r=await call('','POST',{title:'미완료 업로드 삭제',filename:'partial.mp3',bytes:64});assert.equal(r.status,201);const abandoned=await r.json();
 r=await call('/'+abandoned.id+'/upload-part?part=1','POST',new Uint8Array(64),'user-a',{'Content-Type':'application/octet-stream'});assert.equal(r.status,200);
 r=await call('/'+abandoned.id+'/delete','DELETE');assert.equal(r.status,200);
 r=await call('/'+abandoned.id+'/finish-upload','POST');assert.equal(r.status,404);
 // A failed local storage cleanup keeps a retryable deleting record; block new processing.
 await db.prepare("INSERT INTO lectures (id,owner,title,filename,bytes,duration,total,status,created) VALUES ('delete-retry','user-a','삭제 재시도','retry.mp3',64,0,0,'deleting',3)").run();
 r=await call('/delete-retry/speech-start','POST');assert.equal(r.status,409);
 r=await call('/delete-retry/detail');assert.equal(r.status,200);
 r=await call('/delete-retry/delete','DELETE');assert.equal(r.status,200);
 // Ready original files are removed even before notes exist.
 const readyUpload=await bucket.createMultipartUpload('delete-ready-original');await bucket.put('delete-ready-original','original');
 await db.prepare("INSERT INTO lectures (id,owner,title,filename,bytes,duration,total,status,created) VALUES ('delete-ready','user-a','전사 전 삭제','ready.mp3',8,0,0,'ready',4)").run();
 await db.prepare("INSERT INTO media_jobs (lecture_id,source_key,upload_id,media_type,provider,ready) VALUES ('delete-ready','delete-ready-original',?,'audio/mpeg','fal',1)").bind(readyUpload.uploadId).run();
 r=await call('/delete-ready/delete','DELETE');assert.equal(r.status,200);assert.equal(await bucket.head('delete-ready-original'),null);
 // Failed D1 deletion is atomic and retains the record for retry, even after R2 cleanup.
 await db.prepare("INSERT INTO lectures (id,owner,title,filename,bytes,duration,total,status,created) VALUES ('delete-fail','user-a','삭제 실패 복구','fail.mp3',8,0,1,'ready',4)").run();
 await db.prepare("INSERT INTO chunks (lecture_id,ordinal,audio_key,transcript) VALUES ('delete-fail',0,'failure-audio','보관 대본')").run();
 await bucket.put('failure-audio','audio');
 await db.prepare("CREATE TRIGGER deletion_fixture BEFORE DELETE ON lectures WHEN OLD.id='delete-fail' BEGIN SELECT RAISE(ABORT,'fixture'); END").run();
 r=await call('/delete-fail/delete','DELETE');assert.equal(r.status,503);
 assert.equal((await db.prepare("SELECT status,lock_until FROM lectures WHERE id='delete-fail'").first()).status,'deleting');
 assert.equal((await db.prepare("SELECT transcript FROM chunks WHERE lecture_id='delete-fail'").first()).transcript,'보관 대본');
 await db.prepare('DROP TRIGGER deletion_fixture').run();
 r=await call('/delete-fail/delete','DELETE');assert.equal(r.status,200);
 // Deleting an active fal job requests cancellation but does not remove saved API credentials.
 await call('/settings','POST',{fal:speech});
 await db.prepare("INSERT INTO lectures (id,owner,title,filename,bytes,duration,total,status,created) VALUES ('delete-active','user-a','전사 중 삭제','active.mp3',8,0,0,'transcribing',4)").run();
 await db.prepare("INSERT INTO media_jobs (lecture_id,source_key,upload_id,media_type,provider,ready,remote_id,remote_status,provider_expires_at) VALUES ('delete-active','active-original','test-id','audio/mpeg','fal',1,'delete-active-job','queued',?)").bind(Date.now()+86400000).run();
 await bucket.put('active-original','original');
 r=await call('/delete-active/delete','DELETE');assert.equal(r.status,200);assert.equal((await r.json()).provider_cleanup,'scheduled');
 assert.equal((await (await mf.dispatchFetch('https://test.local/test-cancels')).json()).cancellations,1);
 assert.equal(await bucket.head('active-original'),null);
 r=await call('/settings');assert((await r.json()).providers.fal);
 await call('/settings','DELETE',{providers:['fal']});
 console.log('PASS: Workers redirect mode validation, redirect blocking, connection vs timeout errors, owner-only lecture deletion, related rows and R2 media deletion, incomplete multipart abort, active-lock conflict, deleting-record retry.');
 console.log('PASS: encrypted credential persistence; no plaintext readback; no client key headers required after save; owner isolation; AES-GCM IV freshness and tamper rejection; partial replacement and deletion;  Whisper ko/v3; two bounded ranged streams to fal; private upload ACL; signed read URL; 24h expiration; separate correction and audit; raw text preserved; negation/number/formula preserved; malformed correction rejected; corrected input required for outline;  migrations preserve existing notes; real D1/R2 multipart upload and resumed part; original bytes unchanged; ownership; streamed external upload; async STT and timestamps; retry avoids duplicate jobs; provider key errors unlock safely; DeepSeek outline and final notes; cached summary; no plaintext persisted keys; size/format/origin checks. 1.5 GiB metadata accepted; Korean fixed (ko); deletion occurs after note commit; premature/foreign deletion blocked; R2 and provider deletion verified; cleanup retry preserves note/transcript. External API responses mocked.');
}finally{await mf.dispose();}
