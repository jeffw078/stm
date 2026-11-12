import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './fixture';
import {withContext,ensureUnit} from '../lib/base';

test('PCM preserva isolamento, unidades explícitas e revogação da identidade compartilhada',async()=>{
 const f=await fixture();try{
  await assert.rejects(()=>withContext(f.db,f.auditor,'assets.read',async()=>true),/módulo|acesso/i);
  await assert.rejects(()=>withContext(f.db,f.requester,'assets.write',async()=>true),/permissão|restrito/i);
  await withContext(f.db,f.requester,'requests.create',async(_q,ctx)=>{ensureUnit(ctx,f.unit.id);assert.throws(()=>ensureUnit(ctx,f.otherUnit.id));});
  await f.db.query("UPDATE sm5s.module_access SET sublevel='VIEWER' WHERE user_id=$1 AND module='maintenance'",[f.technician.id]);
  await assert.rejects(()=>withContext(f.db,f.technician,'orders.execute',async()=>true),/permissão|restrito/i);
  await withContext(f.db,f.technician,'orders.read',async(_q,ctx)=>{assert.equal(ctx.role,'TECHNICIAN');});
  await f.db.query('UPDATE sm5s.users SET auth_version=auth_version+1 WHERE id=$1',[f.requester.id]);
  await assert.rejects(()=>withContext(f.db,f.requester,'requests.create',async()=>true),/revogado|expirada/i);
 }finally{await f.pg.close();}
});
