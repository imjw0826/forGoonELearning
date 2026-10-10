import { env } from 'cloudflare:workers';
import { ApiError, db, owner } from './server';
import type { KeySettings, KeyProvider } from './types';

export const KEY_PROVIDERS:KeyProvider[]=['deepseek','fal','assemblyai','converter','converter_url'];
const encoder=new TextEncoder();
function secret(){return (env as unknown as {KEY_VAULT_SECRET?:string}).KEY_VAULT_SECRET;}
export function vaultReady(){return /^[a-f0-9]{64}$/i.test(secret()||'');}
async function encryptionKey(){
  if(!vaultReady())throw new ApiError(503,'키 저장소가 준비되지 않았습니다. 잠시 후 다시 시도하세요.');
  const bytes=Uint8Array.from(secret()!.match(/.{2}/g)!,hex=>parseInt(hex,16));
  return crypto.subtle.importKey('raw',bytes,{name:'AES-GCM'},false,['encrypt','decrypt']);
}
function encode(bytes:Uint8Array){return btoa(String.fromCharCode(...bytes));}
function decode(value:string){return Uint8Array.from(atob(value),c=>c.charCodeAt(0));}
function aad(user:string,provider:KeyProvider){return encoder.encode(JSON.stringify({version:1,owner:user,provider}));}
export function validateKey(key:string,label:string,min=20){
  const value=key.trim();
  if(value.length<min||value.length>4096||/[\u0000-\u0020\u007f]/.test(value))throw new ApiError(400,`${label} API 키를 확인해주세요.`);
  return value;
}
export async function keySettings(user:string):Promise<KeySettings>{
  const rows=await db().prepare('SELECT provider FROM provider_credentials WHERE owner=?').bind(user).all<{provider:string}>();
  return {storage_ready:vaultReady(),providers:{deepseek:rows.results.some(r=>r.provider==='deepseek'),fal:rows.results.some(r=>r.provider==='fal'),assemblyai:rows.results.some(r=>r.provider==='assemblyai'),converter:rows.results.some(r=>r.provider==='converter'),converter_url:rows.results.some(r=>r.provider==='converter_url')}};
}
export async function saveKeys(user:string,keys:Partial<Record<KeyProvider,string>>){
  const master=await encryptionKey();
  const statements:D1PreparedStatement[]=[];
  for(const provider of KEY_PROVIDERS){
    if(!keys[provider])continue;
    const plaintext=validateKey(keys[provider]!,provider,provider==='converter_url'?10:provider==='converter'?32:20),iv=crypto.getRandomValues(new Uint8Array(12));
    const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad(user,provider),tagLength:128},master,encoder.encode(plaintext));
    statements.push(db().prepare('INSERT INTO provider_credentials (owner,provider,ciphertext,iv,version,updated) VALUES (?,?,?,?,1,?) ON CONFLICT(owner,provider) DO UPDATE SET ciphertext=excluded.ciphertext,iv=excluded.iv,version=excluded.version,updated=excluded.updated').bind(user,provider,encode(new Uint8Array(ciphertext)),encode(iv),Date.now()));
  }
  if(!statements.length)throw new ApiError(400,'저장할 API 키를 입력해주세요.');
  await db().batch(statements);
}
// Plaintext is only used inside the server for the corresponding provider request.
// AAD binds ciphertext to both owner and provider; it cannot be copied between accounts.
export async function resolveProviderKey(request:Request,provider:KeyProvider,header:string,label:string){
  const user=owner(request),override=request.headers.get(header)?.trim();
  if(override)return validateKey(override,label,provider==='converter_url'?10:provider==='converter'?32:20);
  const row=await db().prepare('SELECT ciphertext,iv,version FROM provider_credentials WHERE owner=? AND provider=?').bind(user,provider).first<{ciphertext:string;iv:string;version:number}>();
  if(!row)throw new ApiError(400,`API 연결에서 ${label} API 키를 한 번 저장해주세요.`);
  const master=await encryptionKey();
  try{
    if(row.version!==1)throw new Error('Unsupported credential version');
    const bytes=await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(row.iv),additionalData:aad(user,provider),tagLength:128},master,decode(row.ciphertext));
    return validateKey(new TextDecoder().decode(bytes),label,provider==='converter_url'?10:provider==='converter'?32:20);
  }catch{throw new ApiError(503,`${label}의 저장된 키를 읽지 못했습니다. API 연결에서 새 키로 교체해주세요.`);}
}
