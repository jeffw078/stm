import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {privateStore} from '../lib/storage';
test('variável de diretório vazia mantém arquivos de desenvolvimento no diretório privado ignorado pelo Git',async()=>{
 const oldDir=process.env.PCM_STORAGE_DIR,oldBucket=process.env.PCM_STORAGE_BUCKET;
 process.env.PCM_STORAGE_DIR='';delete process.env.PCM_STORAGE_BUCKET;
 const store=privateStore(),key='tests/'+randomUUID(),bytes=Buffer.from('private-test-only');
 try{await store.put(key,bytes,'application/octet-stream');assert.deepEqual(await readFile(resolve('data/private/pcm-files',key)),bytes);assert.deepEqual(await store.get(key),bytes);}
 finally{await store.remove(key);if(oldDir===undefined)delete process.env.PCM_STORAGE_DIR;else process.env.PCM_STORAGE_DIR=oldDir;if(oldBucket===undefined)delete process.env.PCM_STORAGE_BUCKET;else process.env.PCM_STORAGE_BUCKET=oldBucket;}
});
