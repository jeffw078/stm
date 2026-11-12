import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { randomUUID } from 'node:crypto';
import { Service } from '../lib/service';
import { Authentication } from '../lib/auth-service';
import { hashPassword } from '../lib/security';
import { QUESTIONS } from '../lib/questions';
import { EvidenceService } from '../lib/evidence-service';
import sharp from 'sharp';
import type { Database,Queryable } from '../lib/db';

async function fixture(){
  const pg=new PGlite();await pg.exec(readFileSync('migrations/001_initial.sql','utf8'));
  const db:Database={query:(s,v)=>pg.query(s,v) as any,transaction:fn=>pg.transaction(tx=>fn({query:(s,v)=>tx.query(s,v) as any}))};
  const master={id:randomUUID(),role:'MASTER',email:'master@test.local',name:'Master',active:true,must_change_password:false} as const;
  const auditor={id:randomUUID(),role:'AUDITOR',email:'auditor@test.local',name:'Auditor',active:true,must_change_password:false} as const;
  const outsider={...auditor,id:randomUUID(),email:'other@test.local'};
  const hash=await hashPassword('Senha-para-teste-123!');
  for(const u of [master,auditor,outsider])await db.query('INSERT INTO sm5s.users(id,email,name,role,password_hash,must_change_password) VALUES($1,$2,$3,$4,$5,false)',[u.id,u.email,u.name,u.role,hash]);
  await pg.exec(readFileSync('migrations/003_module_access.sql','utf8'));
  const service=new Service(db);const unit=await service.createUnit(master,'Administrativo');const sector=await service.createSector(master,unit.id,'Qualidade');
  return {pg,db,master,auditor,outsider,sector,service,auth:new Authentication(db)};
}

test('permissões por módulo isolam leituras, planejamento e evidências do 5S',async()=>{
  const f=await fixture();try{
    const user=await f.service.createUser(f.master,{name:'Manutenção',email:'maintenance@test.local',role:'USER',password:'TemporariaSegura123!',modules:{maintenance:{level:'ADMIN',sublevel:'MANAGER'}}});
    await f.db.query('UPDATE sm5s.users SET must_change_password=false WHERE id=$1',[user.id]);
    const login=await f.auth.login(user.email,'TemporariaSegura123!','maintenance');
    const actor=(await f.auth.getUser(login.token))!;
    const audit=await f.service.createAudit(f.master,{sectorId:f.sector.id,date:'2026-11-12',auditorId:f.auditor.id});
    await assert.rejects(()=>f.service.listAudits(actor),/acesso/i);
    await assert.rejects(()=>f.service.catalog(actor),/acesso/i);
    await assert.rejects(()=>f.service.dashboard(actor,{}),/acesso|gestão/i);
    await assert.rejects(()=>f.service.getAudit(actor,audit.id),/acesso/i);
    await assert.rejects(()=>f.service.createAudit(f.master,{sectorId:f.sector.id,date:'2026-11-13',auditorId:actor.id}),/auditor/i);
    const photo=await new EvidenceService(f.db).add(f.auditor,audit.id,1,await sharp({create:{width:20,height:20,channels:3,background:'red'}}).png().toBuffer(),'Teste');
    await assert.rejects(()=>new EvidenceService(f.db).read(actor,photo.id),/Evidência|acesso/i);
  }finally{await f.pg.close();}
});

test('alterar módulos revoga sessões e bloqueia requisições capturadas',async()=>{
  const f=await fixture();try{
    const audit=await f.service.createAudit(f.master,{sectorId:f.sector.id,date:'2026-11-12',auditorId:f.auditor.id});
    const login=await f.auth.login(f.auditor.email,'Senha-para-teste-123!','captured');
    const actor=(await f.auth.getUser(login.token))!;
    await f.service.setUserAccess(f.master,f.auditor.id,{});
    assert.equal(await f.auth.getUser(login.token),null);
    await assert.rejects(()=>f.service.saveAnswers(actor,audit.id,{revision:1,answers:[],senseNotes:{}}),/revogado|expirada/i);
    await assert.rejects(()=>f.service.setUserAccess(f.auditor,f.outsider.id,{}),/Master/);
    await assert.rejects(()=>f.service.setUserAccess(f.master,f.master.id,{}),/protegido|Master/);
    await f.pg.exec(readFileSync('migrations/003_module_access.sql','utf8'));
    assert.equal((await f.db.query("SELECT * FROM sm5s.module_access WHERE user_id=$1",[f.auditor.id])).rows.length,0);
  }finally{await f.pg.close();}
});

test('consulta do 5S não pode alterar auditoria ou planejar',async()=>{
  const f=await fixture();try{
    await f.service.setUserAccess(f.master,f.auditor.id,{'5s':{level:'USER',sublevel:'VIEWER'}});
    const login=await f.auth.login(f.auditor.email,'Senha-para-teste-123!','viewer');
    const actor=(await f.auth.getUser(login.token))!;
    const a=await f.service.createAudit(f.master,{sectorId:f.sector.id,date:'2026-11-12',auditorId:f.outsider.id});
    assert.equal((await f.service.getAudit(actor,a.id)).editable,false);
    await f.service.dashboard(actor,{});
    await assert.rejects(()=>f.service.saveAnswers(actor,a.id,{revision:1,answers:[],senseNotes:{}}),/alterar/);
    await assert.rejects(()=>f.service.createAudit(actor,{sectorId:f.sector.id,date:'2026-11-13',auditorId:f.outsider.id}),/gestão/);
  }finally{await f.pg.close();}
});
test('fluxo integral: controle de acesso, versão concorrente, envio, devolução e finalização',async()=>{
  const f=await fixture();try{
    const a=await f.service.createAudit(f.master,{sectorId:f.sector.id,date:'2026-11-06',auditorId:f.auditor.id,notes:'Verificar organização'});
    await assert.rejects(()=>f.service.getAudit(f.outsider,a.id),/Acesso/);
    const answers=QUESTIONS.map(q=>({questionId:q.id,score:100,note:''}));
    await assert.rejects(()=>f.service.transition(f.auditor,a.id,1,'REVIEW',''),/23/);
    const saved=await f.service.saveAnswers(f.auditor,a.id,{revision:1,answers,senseNotes:{'1':'Observação'}});
    await assert.rejects(()=>f.service.saveAnswers(f.auditor,a.id,{revision:1,answers,senseNotes:{}}),/alterada/);
    const sent=await f.service.transition(f.auditor,a.id,saved.revision,'REVIEW','');
    const returned=await f.service.transition(f.master,a.id,sent.revision,'IN_PROGRESS','Rever foto');
    const resent=await f.service.transition(f.auditor,a.id,returned.revision,'REVIEW','');
    await f.service.transition(f.master,a.id,resent.revision,'FINALIZED','Revisado');
    const detail=await f.service.getAudit(f.master,a.id);assert.equal(detail.audit.overall,100);assert.equal(detail.events.length,6);
    await assert.rejects(()=>f.service.saveAnswers(f.auditor,a.id,{revision:detail.audit.revision,answers,senseNotes:{}}),/alterar/);
  } finally{await f.pg.close();}
});
test('importação é idempotente, bloqueia conflito e compara somente mês anterior',async()=>{
  const f=await fixture();try{
    const text='data;mes;ano;senso;pontuacao;setor;unidade;auditor\n21/10/2026;OUTUBRO;2026;Seiri;67;Qualidade;Administrativo;Joice';
    const first=await f.service.importHistory(f.master,text,false);assert.equal(first.inserted,1);
    const again=await f.service.importHistory(f.master,text,false);assert.equal(again.alreadyImported,true);
    await assert.rejects(()=>f.service.importHistory(f.master,text.replace(';67;',';75;'),false),/Conflito/);
    const a=await f.service.createAudit(f.master,{sectorId:f.sector.id,date:'2026-11-06',auditorId:f.auditor.id,notes:''});
    const detail=await f.service.getAudit(f.auditor,a.id);assert.equal(detail.previous.summaries[0].score,67);assert.deepEqual(detail.previous.answers,[]);
    const b=await f.service.createAudit(f.master,{sectorId:f.sector.id,date:'2026-12-06',auditorId:f.auditor.id,notes:''});
    assert.equal((await f.service.getAudit(f.auditor,b.id)).previous.audit,null);
    assert.equal((await f.db.query('SELECT score FROM sm5s.summaries')).rows[0].score,67);
  }finally{await f.pg.close();}
});
test('troca obrigatória, expiração, redefinição e desativação revogam sessões',async()=>{
  const f=await fixture();try{
    await f.db.query("UPDATE sm5s.users SET must_change_password=true,temporary_expires_at=now()+interval '72 hours' WHERE id=$1",[f.auditor.id]);
    const logged=await f.auth.login(f.auditor.email,'Senha-para-teste-123!','local');
    assert.equal((await f.auth.getUser(logged.token))?.must_change_password,true);
    await f.auth.changePassword(logged.token,'Senha-para-teste-123!','OutraSenhaForte123!');
    assert.equal(await f.auth.getUser(logged.token),null);
    const next=await f.auth.login(f.auditor.email,'OutraSenhaForte123!','local');
    await f.service.resetPassword(f.master,f.auditor.id,'TemporariaNova123!');
    assert.equal(await f.auth.getUser(next.token),null);
    await f.db.query("UPDATE sm5s.users SET temporary_expires_at=now()-interval '1 second' WHERE id=$1",[f.auditor.id]);
    await assert.rejects(()=>f.auth.login(f.auditor.email,'TemporariaNova123!','local'),/temporária/);
    await f.service.setUserActive(f.master,f.auditor.id,false);
    await assert.rejects(()=>f.auth.login(f.auditor.email,'TemporariaNova123!','local'),/inválidos/);
  }finally{await f.pg.close();}
});
test('requisições já autenticadas não gravam depois de redefinição ou desativação',async()=>{
  const f=await fixture();try{
    const a=await f.service.createAudit(f.master,{sectorId:f.sector.id,date:'2026-11-06',auditorId:f.auditor.id,notes:''});
    const session=await f.auth.login(f.auditor.email,'Senha-para-teste-123!','pending');
    const captured=await f.auth.getUser(session.token);
    await f.service.resetPassword(f.master,f.auditor.id,'NovaSenhaTemporaria123!');
    await assert.rejects(()=>f.service.saveAnswers(captured!,a.id,{revision:1,answers:[],senseNotes:{}}),/Sessão|Acesso/);
    await f.service.setUserActive(f.master,f.auditor.id,false);
    await assert.rejects(()=>f.service.saveAnswers(f.auditor,a.id,{revision:1,answers:[],senseNotes:{}}),/Sessão|Acesso/);
    assert.equal((await f.service.getAudit(f.master,a.id)).audit.revision,1);
  }finally{await f.pg.close();}
});
test('observação parcial persiste sem pontuação e não satisfaz envio para revisão',async()=>{
  const f=await fixture();try{
    const a=await f.service.createAudit(f.master,{sectorId:f.sector.id,date:'2026-11-06',auditorId:f.auditor.id,notes:''});
    const saved=await f.service.saveAnswers(f.auditor,a.id,{revision:1,answers:[{questionId:'s1q1',score:null,note:'Verificar identificação'}],senseNotes:{}});
    const detail=await f.service.getAudit(f.auditor,a.id);assert.equal(detail.answers[0].note,'Verificar identificação');assert.equal(detail.answers[0].score,null);
    assert.equal(detail.audit.overall,null);
    await assert.rejects(()=>f.service.transition(f.auditor,a.id,saved.revision,'REVIEW',''),/23/);
  }finally{await f.pg.close();}
});
test('histórico real é importado em lote com 1925 notas, 391 auditorias e repetição segura',async()=>{
  const f=await fixture();try{
    const text=readFileSync('data/historico-original.tsv','utf8');
    const report=await f.service.importHistory(f.master,text,true);
    assert.equal(report.inserted,1925);assert.equal(report.audits,391);
    assert.equal((await f.db.query('SELECT count(*)::integer AS n FROM sm5s.summaries')).rows[0].n,1925);
    assert.equal((await f.service.importHistory(f.master,text,true)).alreadyImported,true);
    const dashboard=await f.service.dashboard(f.master,{from:'2025-01',to:'2026-06'});
    assert.equal(dashboard.finalized,391);assert.equal(dashboard.senses.length,5);assert.ok(dashboard.partial>0);
  }finally{await f.pg.close();}
});
test('evidências respeitam autoria, limite por senso e imutabilidade após envio',async()=>{
  const f=await fixture();try{
    const a=await f.service.createAudit(f.master,{sectorId:f.sector.id,date:'2026-11-06',auditorId:f.auditor.id,notes:''});
    const evidence=new EvidenceService(f.db);const image=await sharp({create:{width:60,height:60,channels:3,background:'#95c11f'}}).png().toBuffer();
    const e=await evidence.add(f.auditor,a.id,1,image,'Identificação dos materiais');
    await assert.rejects(()=>evidence.read(f.outsider,e.id),/encontrada/);
    await assert.rejects(()=>evidence.remove(f.outsider,e.id),/Acesso/);
    await evidence.add(f.auditor,a.id,1,image,'Foto 2');await evidence.add(f.auditor,a.id,1,image,'Foto 3');
    await assert.rejects(()=>evidence.add(f.auditor,a.id,1,image,'Foto 4'),/Limite/);
    const saved=await f.service.saveAnswers(f.auditor,a.id,{revision:1,answers:QUESTIONS.map(q=>({questionId:q.id,score:100,note:''})),senseNotes:{}});
    await f.service.transition(f.auditor,a.id,saved.revision,'REVIEW','');
    await assert.rejects(()=>evidence.remove(f.auditor,e.id),/Acesso/);
    assert.equal((await evidence.read(f.master,e.id)).mime_type,'image/webp');
  }finally{await f.pg.close();}
});
