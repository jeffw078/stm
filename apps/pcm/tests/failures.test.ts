import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pcmInfrastructureFailure} from '../lib/failures';
test('banco ainda sem migrações da Manutenção informa ativação pendente, sem expor detalhes internos',()=>{
 for(const code of ['42P01','3F000','42703']){
  const result=pcmInfrastructureFailure({code,message:'private SQL and credentials'},'reference-1');
  assert.equal(result.status,503);assert.equal(result.body.code,'PCM_SETUP_REQUIRED');
  assert.match(result.body.error,/ativação|atualização/i);assert.equal(result.body.requestId,'reference-1');
  assert.doesNotMatch(JSON.stringify(result),/private SQL|credentials/);
 }
 assert.equal(pcmInfrastructureFailure(new Error('private SQL'),'reference-2').body.code,'PCM_UNAVAILABLE');
});
