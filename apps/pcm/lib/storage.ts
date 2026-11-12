import {mkdir,readFile,writeFile,unlink} from 'node:fs/promises';
import {resolve,dirname,relative,isAbsolute} from 'node:path';
import {S3Client,PutObjectCommand,GetObjectCommand,DeleteObjectCommand} from '@aws-sdk/client-s3';
import {AppError} from '../../../lib/domain';

export interface PrivateStore{put(key:string,bytes:Buffer,mime:string):Promise<void>;get(key:string):Promise<Buffer>;remove(key:string):Promise<void>;}
function checkKey(key:string){if(!/^[a-zA-Z0-9][a-zA-Z0-9/_-]*(?:\.[a-zA-Z0-9]{1,8})?$/.test(key)||key.includes('..')||key.length>250)throw new AppError('Identificador de arquivo inválido.');}
export function privateStore():PrivateStore{
 const bucket=process.env.PCM_STORAGE_BUCKET;
 if(bucket){
  const endpoint=process.env.PCM_STORAGE_ENDPOINT||undefined;
  if(endpoint&&process.env.NODE_ENV==='production'&&new URL(endpoint).protocol!=='https:')throw new AppError('Armazenamento privado requer HTTPS.',503);
  const accessKeyId=process.env.PCM_STORAGE_ACCESS_KEY_ID,secretAccessKey=process.env.PCM_STORAGE_SECRET_ACCESS_KEY;
  if(!accessKeyId||!secretAccessKey)throw new AppError('Configure as credenciais do armazenamento privado PCM.',503);
  const client=new S3Client({region:process.env.PCM_STORAGE_REGION||'us-east-1',endpoint,forcePathStyle:Boolean(endpoint),credentials:{accessKeyId,secretAccessKey}});
  return {
   async put(key,bytes,mime){checkKey(key);await client.send(new PutObjectCommand({Bucket:bucket,Key:'pcm/'+key,Body:bytes,ContentType:mime,ServerSideEncryption:'AES256',IfNoneMatch:'*'}));},
   async get(key){checkKey(key);const r=await client.send(new GetObjectCommand({Bucket:bucket,Key:'pcm/'+key}));if(!r.Body)throw new AppError('Arquivo não encontrado.',404);return Buffer.from(await r.Body.transformToByteArray());},
   async remove(key){checkKey(key);await client.send(new DeleteObjectCommand({Bucket:bucket,Key:'pcm/'+key}));}
  };
 }
 if(process.env.VERCEL||process.env.NODE_ENV==='production')throw new AppError('Configure o armazenamento privado durável do PCM antes de enviar arquivos.',503);
 // Runtime development files are never bundled; production uses private S3.
 const root=resolve(/* turbopackIgnore: true */ process.env.PCM_STORAGE_DIR||'data/private/pcm-files');
 const pathFor=(key:string)=>{checkKey(key);const target=resolve(root,key),part=relative(root,target);if(part.startsWith('..')||isAbsolute(part))throw new AppError('Caminho de arquivo inválido.');return target;};
 return {async put(key,bytes){const path=pathFor(key);await mkdir(dirname(path),{recursive:true});await writeFile(path,bytes,{flag:'wx',mode:0o600});},async get(key){try{return await readFile(/* turbopackIgnore: true */ pathFor(key));}catch(err){if((err as NodeJS.ErrnoException).code==='ENOENT')throw new AppError('Arquivo não encontrado.',404);throw err;}},async remove(key){try{await unlink(pathFor(key));}catch(err){if((err as NodeJS.ErrnoException).code!=='ENOENT')throw err;}}};
}
