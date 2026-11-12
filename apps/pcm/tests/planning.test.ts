import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fixture} from './fixture';
import {PlanningService,JOB_LIMITS} from '../lib/planning-service';

async function prepare(){const f=await fixture();const assetId=randomUUID(),materialId=randomUUID();await f.db.query("INSERT INTO pcm.assets(id,unit_id,code,name,node_type) VALUES($1,$2,'SYNTH-PLAN','Máquina sintética','MACHINE')",[assetId,f.unit.id]);await f.db.query("INSERT INTO pcm.materials(id,unit_id,code,name,unit,unit_cost) VALUES($1,$2,'SYNTH-MAT','Material sintético','UN',1.25)",[materialId,f.unit.id]);const service=new PlanningService(f.db);const input={unit_id:f.unit.id,asset_id:assetId,code:'PM-01',name:'Inspeção sintética',frequency_unit:'MONTH',frequency_count:1,start_date:'2026-01-31',lead_days:0,tolerance_days:1,tasks:[{title:'Conferir fixação',required:true}],materials:[{material_id:materialId,quantity:'2',unit:'UN'}],estimated_person_hours:2,assignee_id:f.technician.id};return {f,assetId,service,input};}

test('job concorrente é idempotente; pausa preserva atrasos, reprogramação preserva prazo e snapshots',async()=>{
 const {f,service,input}=await prepare();try{
 const plan=await service.savePlan(f.master,input);const [first,second]=await Promise.all([service.runJob(null,'2026-04-01T12:00:00Z'),service.runJob(null,'2026-04-01T12:00:00Z')]);assert.equal(first.generated+second.generated,3);assert.equal((await service.runJob(null,'2026-04-01T12:00:00Z')).generated,0);
 const agenda=await service.agenda(f.master,{from:'2026-01-01',to:'2026-12-31'});assert.deepEqual(agenda.rows.map(r=>r.original_due_date),['2026-01-31','2026-02-28','2026-03-31']);assert.equal((await f.db.query('SELECT count(*) n FROM pcm.orders')).rows[0].n,3);assert.ok((await f.db.query('SELECT created_by FROM pcm.orders')).rows.every(o=>o.created_by===null));
 const reservations=(await f.db.query('SELECT * FROM pcm.order_materials')).rows;assert.equal(reservations.length,3);assert.ok(reservations.every(r=>Number(r.cost)===2.5&&r.created_by===null&&r.kind==='RESERVATION'));
 const changed=await service.reschedule(f.master,agenda.rows[0].id,{scheduled_date:'2026-05-10',reason:'Janela da produção',revision:1});assert.equal(changed.original_due_date,'2026-01-31');assert.equal(changed.original_deadline,'2026-02-01');await assert.rejects(()=>service.reschedule(f.master,changed.id,{scheduled_date:'2026-05-11',reason:'Conflito de revisão',revision:1}),/outra sessão/i);
 const paused=await service.setPlanActive(f.master,plan.id,{active:false,reason:'Parada temporária',revision:plan.revision});assert.equal((await service.runJob(null,'2026-06-01T12:00:00Z')).generated,0);await service.setPlanActive(f.master,plan.id,{active:true,reason:'Retorno da operação',revision:paused.revision});assert.equal((await service.runJob(null,'2026-06-01T12:00:00Z')).generated,2);
 const current=await service.plan(f.master,plan.id);await service.savePlan(f.master,{...input,tasks:[{title:'Nova tarefa futura',required:true}],revision:current.revision},plan.id);const frozen=(await f.db.query('SELECT checklist FROM pcm.orders ORDER BY number')).rows;assert.ok(frozen.every(o=>o.checklist[0].title==='Conferir fixação'));assert.equal((await service.plan(f.master,plan.id)).versions.length,2);
 await assert.rejects(()=>service.plan(f.outsider,plan.id),/escopo|unidade/i);await assert.rejects(()=>service.savePlan(f.requester,input),/permissão|restrit/i);
 await f.pg.exec(readFileSync('apps/pcm/migrations/020_planning.sql','utf8'));
 }finally{await f.pg.close();}
});

test('job limita recuperação atrasada e mantém cursor observável para continuação',async()=>{
 const {f,service,input}=await prepare();try{await service.savePlan(f.master,{...input,frequency_unit:'DAY',start_date:'2020-01-01'});const first=await service.runJob(null,'2026-01-01T12:00:00Z');assert.equal(first.generated,JOB_LIMITS.max_occurrences);assert.equal(first.limited,true);const second=await service.runJob(null,'2026-01-01T12:00:00Z');assert.equal(second.generated,JOB_LIMITS.max_occurrences);assert.equal((await f.db.query('SELECT count(*) n FROM pcm.occurrences')).rows[0].n,200);const runs=(await f.db.query('SELECT * FROM pcm.job_runs')).rows;assert.ok(runs.every(r=>r.status==='SUCCEEDED'&&r.finished_at&&r.limited));}finally{await f.pg.close();}
});

test('falha de geração faz rollback e é observável; entradas de outra unidade e exposição sobreposta são rejeitadas',async()=>{
 const {f,service,input,assetId}=await prepare();try{await service.savePlan(f.master,input);await f.db.query('UPDATE sm5s.users SET active=false WHERE id=$1',[f.technician.id]);await assert.rejects(()=>service.runJob(null,'2026-02-01T12:00:00Z'),/Responsável/i);assert.equal((await f.db.query('SELECT count(*) n FROM pcm.occurrences')).rows[0].n,0);assert.equal((await f.db.query('SELECT status,error_code FROM pcm.job_runs')).rows[0].status,'FAILED');
 await assert.rejects(()=>service.failure(f.master,{unit_id:f.otherUnit.id,asset_id:assetId,started_at:'2026-01-01T01:00:00Z',ended_at:'2026-01-01T04:00:00Z',functional_loss:true,description:'Falha sintética',repair_intervals:[],downtime_intervals:[]}),/outra unidade/);
 await service.recordExposure(f.master,{unit_id:f.unit.id,asset_id:assetId,started_at:'2026-01-01T00:00:00Z',ended_at:'2026-01-02T00:00:00Z',operating_hours:12,source:'Horímetro sintético'});await assert.rejects(async()=>service.recordExposure(f.master,{unit_id:f.unit.id,asset_id:assetId,started_at:'2026-01-01T12:00:00Z',ended_at:'2026-01-02T12:00:00Z',operating_hours:12,source:'Horímetro sintético'}),/sobrepor/);
 await assert.rejects(async()=>service.recordExposure(f.master,{unit_id:f.unit.id,asset_id:assetId,started_at:'2026-01-03T00:00:00Z',ended_at:'2026-01-03T01:00:00Z',operating_hours:2,source:'Horímetro sintético'}),/incompatível/);
 assert.equal((await service.jobRuns(f.master,{status:'FAILED'})).total,1);assert.ok((await f.db.query("SELECT id FROM pcm.notifications WHERE kind='JOB_FAILED'")).rows.length>0);
 await f.db.query("INSERT INTO pcm.requests(id,unit_id,location,description,requester_id,created_at) VALUES($1,$2,'Local sem ativo','Solicitação sintética',$3,'2026-01-01T12:00Z')",[randomUUID(),f.otherUnit.id,f.master.id]);
 await f.db.query("INSERT INTO pcm.orders(id,unit_id,location,description,asset_snapshot,created_at) VALUES($1,$2,'Local sem ativo','Ordem sintética','{}','2026-01-01T12:00Z')",[randomUUID(),f.otherUnit.id]);
 const indicators=await service.indicators(f.master,{from:'2026-01-01',to:'2026-01-01',unit_id:f.otherUnit.id});assert.equal(indicators.cards.find(c=>c.key==='requests_opened')?.value,1);assert.equal(indicators.cards.find(c=>c.key==='orders_opened')?.value,1);assert.equal(indicators.reliability.length,0);
 await assert.rejects(()=>service.indicators(f.requester,{from:'2026-01-01',to:'2026-01-01'}),/permissão|restrit/i);
 }finally{await f.pg.close();}
});
