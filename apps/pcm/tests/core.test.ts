import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './fixture';
import {CoreService} from '../lib/core-service';
import {privateStore} from '../lib/storage';
import {AccessService} from '../lib/base';

test('validação configurável encerra execução completa e origem preventiva é reservada ao job',async()=>{
 const f=await fixture();try{const s=new CoreService(f.db);
  await assert.rejects(s.createOrder(f.admin,{unit_id:f.unit.id,location:'Oficina',description:'Origem forjada',plan_version_id:'fake'}));
  await new AccessService(f.db).saveSettings(f.admin,{unit_id:f.unit.id,validation_required:false});
  let o=await s.createOrder(f.admin,{unit_id:f.unit.id,location:'Oficina',description:'Inspeção sem validação posterior',type:'INSPECTION',assignee_id:f.technician.id});
  o=await s.transitionOrder(f.technician,o.id,{to:'IN_PROGRESS',revision:o.revision});
  await assert.rejects(s.transitionOrder(f.technician,o.id,{to:'EXECUTED',revision:o.revision}));
  o=await s.transitionOrder(f.technician,o.id,{to:'EXECUTED',revision:o.revision,summary:'Inspecionado',result:'Sem anomalia',final_condition:'Operacional',action_taken:'Inspeção visual'});
  assert.equal(o.status,'CLOSED');assert.ok(o.executed_at);assert.ok(o.closed_at);
  const detail=await s.order(f.admin,o.id);assert.deepEqual(detail.status_history.map((r:any)=>r.to_status),['PLANNED','IN_PROGRESS','EXECUTED','CLOSED']);
 }finally{await f.pg.close();}
});

test('árvore profunda, ciclos, escopo e contexto histórico preservado após movimentação',async()=>{
 const f=await fixture();try{const s=new CoreService(f.db);
 const a=await s.saveAsset(f.admin,{unit_id:f.unit.id,code:'M1',name:'Máquina 1',node_type:'MACHINE'});
 const b=await s.saveAsset(f.admin,{unit_id:f.unit.id,code:'M2',name:'Máquina 2',node_type:'MACHINE'});
 await assert.rejects(s.saveAsset(f.admin,{unit_id:f.otherUnit.id,code:' m1 ',name:'Duplicata em outra unidade',node_type:'MACHINE'}),{status:409});
 let child=a;for(let i=0;i<20;i++)child=await s.saveAsset(f.admin,{unit_id:f.unit.id,parent_id:child.id,code:'C'+i,name:'Componente '+i,node_type:'COMPONENT'});
 await assert.rejects(s.moveAsset(f.admin,a.id,{parent_id:child.id,effective_date:'2026-11-12',reason:'teste ciclo',revision:a.revision}));
 const o=await s.createOrder(f.admin,{unit_id:f.unit.id,asset_id:child.id,description:'Revisar motor sintético'});
 assert.equal((await s.orders(f.admin,{search:child.code})).rows[0]?.id,o.id);
 await s.moveAsset(f.admin,child.id,{parent_id:b.id,effective_date:'2026-11-12',reason:'Troca de conjunto',revision:child.revision});
 const history=await s.assetHistory(f.admin,a.id,{include_descendants:'true'});assert.equal(history.rows.filter((r:any)=>r.id===o.id).length,1);
 assert.equal((await s.order(f.admin,o.id)).asset_snapshot.path[0].id,a.id);
 await assert.rejects(s.asset(f.outsider,a.id),{status:403});
 await assert.rejects(f.db.query('UPDATE pcm.assets SET parent_id=$1 WHERE id=$2',[child.id,b.id]));
 }finally{await f.pg.close();}
});

test('solicitações próprias, conversão idempotente, revisão e notas internas',async()=>{
 const f=await fixture();try{const s=new CoreService(f.db);const r=await s.createRequest(f.requester,{unit_id:f.unit.id,location:'Pátio',description:'Vazamento sintético'});
 await assert.rejects(s.request(f.technician,r.id),{status:403});
 const o=await s.triageRequest(f.admin,r.id,{action:'CONVERT',revision:r.revision});
 const again=await s.triageRequest(f.admin,r.id,{action:'CONVERT',revision:r.revision});assert.equal(o.id,again.id);
 await s.comment(f.admin,{request_id:r.id,body:'Nota reservada',internal:true});
 await s.comment(f.admin,{request_id:r.id,body:'Atendimento iniciado',internal:false});
 const own=await s.request(f.requester,r.id);assert.equal(own.comments.length,1);assert.equal(own.comments[0].body,'Atendimento iniciado');
 await assert.rejects(s.updateOrder(f.admin,o.id,{description:'Mudança',revision:999}),{status:409});
 }finally{await f.pg.close();}
});

test('execução atribuída, horas e custos históricos, materiais e devoluções idempotentes',async()=>{
 const f=await fixture();try{const s=new CoreService(f.db);
 const o=await s.createOrder(f.admin,{unit_id:f.unit.id,location:'Oficina',description:'Reparo sintético',assignee_id:f.technician.id});
 await s.transitionOrder(f.technician,o.id,{to:'IN_PROGRESS',revision:o.revision});
 const work=await s.work(f.technician,o.id,{action:'RECORD',started_at:'2026-11-12T12:00:00Z',ended_at:'2026-11-12T13:00:00Z'});assert.equal(Number(work.hours),1);
 await assert.rejects(s.work(f.technician,o.id,{action:'RECORD',started_at:'2026-11-12T12:30:00Z',ended_at:'2026-11-12T13:30:00Z'}));
 const m=await s.saveMaterial(f.admin,{unit_id:f.unit.id,code:'P1',name:'Peça',unit:'UN',unit_cost:'12.35'});
 const c=await s.applyMaterial(f.technician,o.id,{material_id:m.id,quantity:'2',unit:'UN',kind:'CONSUMPTION',idempotency_key:'cons-1'});
 assert.equal((await s.applyMaterial(f.technician,o.id,{material_id:m.id,quantity:'2',unit:'UN',kind:'CONSUMPTION',idempotency_key:'cons-1'})).id,c.id);
 await s.saveMaterial(f.admin,{unit_id:f.unit.id,code:'P1',name:'Peça',unit:'UN',unit_cost:'99',revision:m.revision},m.id);
 const ret=await s.applyMaterial(f.technician,o.id,{material_id:m.id,quantity:'1',unit:'UN',kind:'RETURN',corrects_id:c.id,reason:'Sobra',idempotency_key:'ret-1'});
 assert.equal(Number((await f.db.query('SELECT unit_cost FROM pcm.order_materials WHERE id=$1',[ret.id])).rows[0].unit_cost),12.35);
 await assert.rejects(s.applyMaterial(f.technician,o.id,{material_id:m.id,quantity:'2',unit:'UN',kind:'RETURN',corrects_id:c.id,reason:'Sobra',idempotency_key:'ret-2'}));
 const detail=await s.order(f.technician,o.id);assert.equal('unit_cost' in detail.materials[0],false);
 const unassigned=await s.createOrder(f.admin,{unit_id:f.unit.id,description:'Outro reparo',location:'Galpão'});await assert.rejects(s.order(f.technician,unassigned.id),{status:403});
 }finally{await f.pg.close();}
});

test('documentos privados: assinatura real, versões, ancestral identificado e revogação',async()=>{
 const f=await fixture();const keys:string[]=[];try{const s=new CoreService(f.db);const a=await s.saveAsset(f.admin,{unit_id:f.unit.id,code:'PDF1',name:'Máquina manual',node_type:'MACHINE'});
 const data={asset_id:a.id,title:'Manual sintético',kind:'MANUAL',filename:'../manual.pdf',mime_type:'application/pdf',version:'1'};
 await assert.rejects(s.addDocument(f.admin,data,Buffer.from('not a PDF')));
 const first=await s.addDocument(f.admin,data,Buffer.from('%PDF-1.7\nmanual sintético\n%%EOF'));const meta=await s.document(f.admin,first.id);keys.push(meta.storage_key);assert.equal(meta.filename,'manual.pdf');assert.equal((await privateStore().get(meta.storage_key)).subarray(0,5).toString(),'%PDF-');
 await assert.rejects(s.document(f.outsider,first.id),{status:403});await assert.rejects(s.document(f.auditor,first.id),{status:403});
 const second=await s.addDocument(f.admin,{...data,version:'2',replaces_id:first.id},Buffer.from('%PDF-1.7\nsegunda versão\n%%EOF'));keys.push((await s.document(f.admin,second.id)).storage_key);
 const child=await s.saveAsset(f.admin,{unit_id:f.unit.id,parent_id:a.id,code:'PDF2',name:'Componente manual',node_type:'COMPONENT'});
 const inherited=await s.documents(f.technician,{asset_id:child.id});assert.equal(inherited.length,2);assert.ok(inherited.every((d:any)=>d.inherited));assert.equal(inherited.filter((d:any)=>d.current).length,1);assert.equal((await s.document(f.admin,first.id)).current,false);
 await f.db.query("DELETE FROM sm5s.module_access WHERE user_id=$1 AND module='maintenance'",[f.technician.id]);await assert.rejects(s.document(f.technician,first.id),{status:403});
 }finally{for(const key of keys)await privateStore().remove(key);await f.pg.close();}
});

test('checklist técnico, encerramento e reabertura auditados e trabalho com custo congelado',async()=>{
 const f=await fixture();try{const s=new CoreService(f.db);let o=await s.createOrder(f.admin,{unit_id:f.unit.id,location:'Galpão',description:'Inspeção sintética',type:'INSPECTION',assignee_id:f.technician.id,checklist:[{title:'Verificar vedação',required:true}]});
 o=await s.transitionOrder(f.technician,o.id,{to:'IN_PROGRESS',revision:o.revision});
 await assert.rejects(s.transitionOrder(f.technician,o.id,{to:'EXECUTED',revision:o.revision,summary:'Revisado',result:'Aprovado',final_condition:'Operacional',action_taken:'Inspeção visual'}));
 o=await s.updateOrder(f.technician,o.id,{revision:o.revision,checklist:[{title:'Verificar vedação',required:true,done:true}]});
 await assert.rejects(s.updateOrder(f.technician,o.id,{revision:o.revision,assignee_id:f.admin.id}),{status:403});
 o=await s.transitionOrder(f.technician,o.id,{to:'EXECUTED',revision:o.revision,summary:'Revisado',result:'Aprovado',final_condition:'Operacional',action_taken:'Inspeção visual'});
 await assert.rejects(s.transitionOrder(f.technician,o.id,{to:'CLOSED',revision:o.revision}),{status:403});o=await s.transitionOrder(f.admin,o.id,{to:'CLOSED',revision:o.revision});
 await assert.rejects(s.transitionOrder(f.admin,o.id,{to:'IN_PROGRESS',revision:o.revision}));o=await s.transitionOrder(f.admin,o.id,{to:'IN_PROGRESS',revision:o.revision,reason:'Reavaliar vedação'});
 const work=await s.work(f.admin,o.id,{action:'RECORD',started_at:'2026-11-10T12:00:00Z',ended_at:'2026-11-10T13:00:00Z',hourly_rate:'30.15',idempotency_key:'admin-hours'});assert.equal(Number(work.cost),30.15);
 await assert.rejects(f.db.query('UPDATE pcm.work_sessions SET hourly_rate=99 WHERE id=$1',[work.id]));
 assert.equal((await s.order(f.admin,o.id)).status_history.length,5);
 }finally{await f.pg.close();}
});

test('alvo de equipamento pendente é obrigatório na conclusão e o vínculo inicial congela contexto',async()=>{
 const f=await fixture();try{const s=new CoreService(f.db);const r=await s.createRequest(f.requester,{unit_id:f.unit.id,location:'Pátio',description:'Equipamento parado',stopped:true});let o=await s.triageRequest(f.admin,r.id,{action:'CONVERT',revision:r.revision,assignee_id:f.technician.id});
 o=await s.transitionOrder(f.technician,o.id,{to:'IN_PROGRESS',revision:o.revision});const result={to:'EXECUTED',summary:'Revisado',result:'Aprovado',final_condition:'Operacional',action_taken:'Reparo',diagnosis:'Vazamento',cause_unknown_reason:'Em investigação'};
 await assert.rejects(s.transitionOrder(f.technician,o.id,{...result,revision:o.revision}));const a=await s.saveAsset(f.admin,{unit_id:f.unit.id,code:'PENDING1',name:'Equipamento identificado',node_type:'MACHINE'});
 o=await s.updateOrder(f.admin,o.id,{revision:o.revision,asset_id:a.id});assert.equal(o.asset_snapshot.path[0].id,a.id);o=await s.transitionOrder(f.technician,o.id,{...result,revision:o.revision});assert.equal(o.status,'EXECUTED');
 const list=await s.orders(f.technician,{search:'Equipamento',status:'EXECUTED',unit_id:f.unit.id});assert.equal(list.total,1);
 }finally{await f.pg.close();}
});

test('equipe autorizada atende, STOP pode ser repetido e outra unidade não atravessa FKs',async()=>{
 const f=await fixture();try{const s=new CoreService(f.db);const teamId=crypto.randomUUID();await f.db.query('INSERT INTO pcm.teams(id,unit_id,name) VALUES($1,$2,$3)',[teamId,f.unit.id,'Equipe teste']);await f.db.query('UPDATE pcm.memberships SET team_ids=$1 WHERE user_id=$2',[[teamId],f.technician.id]);let o=await s.createOrder(f.admin,{unit_id:f.unit.id,location:'Galpão',description:'Inspeção em equipe',type:'INSPECTION',team_id:teamId});o=await s.transitionOrder(f.technician,o.id,{to:'IN_PROGRESS',revision:o.revision});
 const start=await s.work(f.technician,o.id,{action:'START',started_at:'2026-11-10T12:00:00Z',idempotency_key:'start-1'});const stop={action:'STOP',ended_at:'2026-11-10T13:00:00Z',revision:start.revision,idempotency_key:'stop-1'};const stopped=await s.work(f.technician,o.id,stop);assert.equal((await s.work(f.technician,o.id,stop)).id,stopped.id);
 const a=await s.saveAsset(f.admin,{unit_id:f.otherUnit.id,code:'OUT1',name:'Outra unidade',node_type:'MACHINE'});await assert.rejects(f.db.query('UPDATE pcm.orders SET asset_id=$1 WHERE id=$2',[a.id,o.id]));
 }finally{await f.pg.close();}
});
