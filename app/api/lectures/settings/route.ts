import { z } from 'zod';
import { owner, db, jsonBody, respondError, noCache } from '@/lib/server';
import { keySettings, saveKeys } from '@/lib/key-vault';

export async function GET(request:Request){try{
  return Response.json(await keySettings(owner(request)),{headers:noCache});
}catch(e){return respondError(e);}}
export async function POST(request:Request){try{
  const user=owner(request,true);
  const input=z.object({deepseek:z.string().trim().min(20).max(512).optional(),fal:z.string().trim().min(20).max(512).optional(),assemblyai:z.string().trim().min(20).max(512).optional()}).strict().parse(await jsonBody(request));
  await saveKeys(user,input);
  return Response.json(await keySettings(user),{headers:noCache});
}catch(e){return respondError(e);}}
export async function DELETE(request:Request){try{
  const user=owner(request,true);
  const {providers}=z.object({providers:z.array(z.enum(['deepseek','fal','assemblyai'])).min(1).max(3)}).strict().parse(await jsonBody(request));
  await db().batch([...new Set(providers)].map(provider=>db().prepare('DELETE FROM provider_credentials WHERE owner=? AND provider=?').bind(user,provider)));
  return Response.json(await keySettings(user),{headers:noCache});
}catch(e){return respondError(e);}}
