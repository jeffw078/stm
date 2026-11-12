import {test} from 'node:test';
import assert from 'node:assert/strict';
import {api} from '../../../components/shared';

test('falha da API apresenta a referência de suporte devolvida pelo servidor',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async()=>new Response(JSON.stringify({error:'Não foi possível concluir.',requestId:'f38c66e2-1507-4e27-9758-87174ebaf895'}),{status:503,headers:{'Content-Type':'application/json'}});
 try{await assert.rejects(api('pcm/catalog'),/Referência: f38c66e2-1507-4e27-9758-87174ebaf895/);}
 finally{globalThis.fetch=original;}
});
