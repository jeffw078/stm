import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Database,Queryable,Row } from './db';
import { AppError,calculateScores,canEdit,canRead,assertTransition,requireManager,requireMaster,requireModule,fiveSRole,canViewDashboard,previousMonth,validDate,type Actor } from './domain';
import { QUESTIONS } from './questions';
import { parseHistory,normalize } from './history-import';
import { hashPassword,tokenHash } from './security';
import { authorizeMutation } from './authorization';
import { grantsSchema,grantsSelect,writeGrants } from './module-access';
const uid=()=>randomUUID();
const nameSchema=z.string().trim().min(2).max(160);
const dateSchema=z.string().refine(validDate,'Data inválida.');
const planSchema=z.object({sectorId:z.string().min(1),date:dateSchema,auditorId:z.string().min(1),notes:z.string().max(5000).default('')});
const saveSchema=z.object({revision:z.number().int().positive(),answers:z.array(z.object({questionId:z.string(),score:z.number().refine(n=>[0,25,50,75,100].includes(n)).nullable(),note:z.string().max(2000).default('')})).max(23),senseNotes:z.record(z.string().regex(/^[1-5]$/),z.string().max(5000)).default({})});
const selectAudit=`SELECT a.*,a.date::text AS date,s.name AS sector,u.name AS unit,u.id AS unit_id FROM sm5s.audits a JOIN sm5s.sectors s ON s.id=a.sector_id JOIN sm5s.units u ON u.id=s.unit_id`;
async function event(q:Queryable,actor:Actor,auditId:string|null,action:string,detail=''){await q.query('INSERT INTO sm5s.events(id,audit_id,actor_id,action,detail) VALUES($1,$2,$3,$4,$5)',[uid(),auditId,actor.id,action,detail]);}
async function locked(q:Queryable,id:string){const {rows}=await q.query('SELECT *,date::text AS date FROM sm5s.audits WHERE id=$1 FOR UPDATE',[id]);if(!rows[0])throw new AppError('Auditoria não encontrada.',404);return rows[0];}
function version(a:Row,revision:number){if(a.revision!==revision)throw new AppError('Auditoria alterada em outra sessão. Recarregue antes de continuar.',409);}
export type Filters={from?:string;to?:string;unit?:string;sector?:string;sense?:string;status?:string;search?:string};
export class Service{
  constructor(public db:Database){}
  private transaction<T>(actor:Actor,fn:(q:Queryable)=>Promise<T>){return this.db.transaction(async q=>{await authorizeMutation(q,actor);return fn(q);});}
  async catalog(actor:Actor){
    requireModule(actor,'5s');
    const units=(await this.db.query('SELECT * FROM sm5s.units ORDER BY name')).rows;
    const sectors=(await this.db.query('SELECT s.*,u.name AS unit FROM sm5s.sectors s JOIN sm5s.units u ON u.id=s.unit_id ORDER BY u.name,s.name')).rows;
    const users=fiveSRole(actor)==='AUDITOR'||fiveSRole(actor)==='VIEWER'?[]:(await this.db.query(`SELECT u.id,u.name,u.email,u.role,u.active,u.must_change_password,${grantsSelect} FROM sm5s.users u ORDER BY u.name`)).rows.filter(u=>['MASTER','ADMIN','AUDITOR'].includes(fiveSRole(u as Actor)??''));
    const {rows}=await this.db.query("SELECT max(date)::text AS latest FROM sm5s.audits WHERE status='FINALIZED'");
    return {units,sectors,users,latestPeriod:rows[0]?.latest?.slice(0,7)??new Date().toISOString().slice(0,7)};
  }
  async createUnit(actor:Actor,name:string){requireMaster(actor);const n=nameSchema.parse(name);return this.transaction(actor,async q=>(await q.query('INSERT INTO sm5s.units(id,name,normalized_name) VALUES($1,$2,$3) RETURNING *',[uid(),n,normalize(n)])).rows[0]);}
  async createSector(actor:Actor,unitId:string,name:string){requireMaster(actor);const n=nameSchema.parse(name);return this.transaction(actor,async q=>(await q.query('INSERT INTO sm5s.sectors(id,unit_id,name,normalized_name) SELECT $1,id,$3,$4 FROM sm5s.units WHERE id=$2 AND active=true RETURNING *',[uid(),unitId,n,normalize(n)])).rows[0]??Promise.reject(new AppError('Unidade indisponível.')));}
  async setCatalogActive(actor:Actor,type:'unit'|'sector',id:string,active:boolean){requireMaster(actor);return this.transaction(actor,async q=>{await q.query(`UPDATE sm5s.${type==='unit'?'units':'sectors'} SET active=$2 WHERE id=$1`,[id,active]);return {ok:true};});}
  async createUser(actor:Actor,input:unknown){
    requireMaster(actor);
    const v=z.object({name:nameSchema,email:z.email().max(254),role:z.enum(['ADMIN','AUDITOR','USER']),password:z.string(),modules:grantsSchema.optional()}).parse(input);
    const modules=v.modules??(v.role==='USER'?{}:{'5s':{level:v.role==='ADMIN'?'ADMIN' as const:'USER' as const,sublevel:v.role==='ADMIN'?'MANAGER' as const:'OPERATOR' as const}});
    const hash=await hashPassword(v.password);
    return this.transaction(actor,async q=>{
      const result=await q.query("INSERT INTO sm5s.users(id,email,name,role,password_hash,temporary_expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '72 hours') RETURNING id,name,email,role,active,must_change_password",[uid(),v.email.trim().toLowerCase(),v.name,v.role,hash]);
      await writeGrants(q,result.rows[0].id,modules);
      await event(q,actor,null,'USER_CREATED',`${v.email} / ${v.role}`);return result.rows[0];
    });
  }
  async listUsers(actor:Actor){requireMaster(actor);return (await this.db.query(`SELECT u.id,u.name,u.email,u.role,u.active,u.must_change_password,${grantsSelect} FROM sm5s.users u ORDER BY u.name`)).rows;}
  async setUserAccess(actor:Actor,id:string,input:unknown){
    requireMaster(actor);const modules=grantsSchema.parse(input);
    return this.transaction(actor,async q=>{
      const user=(await q.query("SELECT id FROM sm5s.users WHERE id=$1 AND role<>'MASTER' FOR UPDATE",[id])).rows[0];
      if(!user)throw new AppError('Usuário não encontrado ou Master protegido.',404);
      await writeGrants(q,id,modules);
      await q.query('UPDATE sm5s.users SET auth_version=auth_version+1 WHERE id=$1',[id]);
      await q.query('DELETE FROM sm5s.sessions WHERE user_id=$1',[id]);
      await event(q,actor,null,'MODULE_ACCESS_CHANGED',JSON.stringify({userId:id,modules}));
      return {ok:true};
    });
  }
  async resetPassword(actor:Actor,id:string,password:string){
    requireMaster(actor);if(id===actor.id)throw new AppError('Use a opção de alterar sua própria senha.');
    const hash=await hashPassword(password);
    return this.transaction(actor,async q=>{
      const {rows}=await q.query("UPDATE sm5s.users SET password_hash=$2,must_change_password=true,temporary_expires_at=now()+interval '72 hours',auth_version=auth_version+1 WHERE id=$1 AND role<>'MASTER' RETURNING id",[id,hash]);
      if(!rows.length)throw new AppError('Usuário não encontrado ou protegido.',404);
      await q.query('DELETE FROM sm5s.sessions WHERE user_id=$1',[id]);await event(q,actor,null,'PASSWORD_RESET',id);return {ok:true};
    });
  }
  async setUserActive(actor:Actor,id:string,active:boolean){
    requireMaster(actor);if(id===actor.id)throw new AppError('O Master não pode desativar o próprio acesso.');
    return this.transaction(actor,async q=>{
      const {rows}=await q.query("UPDATE sm5s.users SET active=$2,auth_version=auth_version+1 WHERE id=$1 AND role<>'MASTER' RETURNING id",[id,active]);
      if(!rows.length)throw new AppError('Usuário não encontrado ou protegido.',404);
      await q.query('DELETE FROM sm5s.sessions WHERE user_id=$1',[id]);await event(q,actor,null,active?'USER_ACTIVATED':'USER_DEACTIVATED',id);return {ok:true};
    });
  }
  async createAudit(actor:Actor,input:unknown){
    requireManager(actor);const v=planSchema.parse(input);
    return this.transaction(actor,async q=>{
      const sector=(await q.query('SELECT s.id FROM sm5s.sectors s JOIN sm5s.units u ON u.id=s.unit_id WHERE s.id=$1 AND s.active AND u.active',[v.sectorId])).rows[0];
      const auditor=(await q.query(`SELECT u.id,u.name,u.role,${grantsSelect} FROM sm5s.users u WHERE u.id=$1 AND u.active FOR SHARE OF u`,[v.auditorId])).rows[0];
      if(!sector||!auditor||!['MASTER','ADMIN','AUDITOR'].includes(fiveSRole(auditor as Actor)??''))throw new AppError('Setor ou auditor indisponível.');
      const r=(await q.query("INSERT INTO sm5s.audits(id,sector_id,date,auditor_id,auditor_name,status,source,notes,questions,created_by) VALUES($1,$2,$3,$4,$5,'PLANNED','LIVE',$6,$7::jsonb,$8) RETURNING id,revision",[uid(),v.sectorId,v.date,v.auditorId,auditor.name,v.notes,JSON.stringify(QUESTIONS),actor.id])).rows[0];
      await event(q,actor,r.id,'PLANNED',v.notes);return r;
    });
  }
  async listAudits(actor:Actor,filters:Filters={}){
    requireModule(actor,'5s');
    const clauses:string[]=[];const values:unknown[]=[];
    const add=(sql:string,v:unknown)=>{values.push(v);clauses.push(sql.replace('?',`$${values.length}`));};
    if(fiveSRole(actor)==='AUDITOR')add('a.auditor_id=?',actor.id);
    if(filters.from){previousMonth(filters.from);add('a.date>=?::date',filters.from+'-01');}
    if(filters.to){previousMonth(filters.to);add("a.date<(?::date+interval '1 month')",filters.to+'-01');}
    if(filters.unit)add('u.id=?',filters.unit);if(filters.sector)add('s.id=?',filters.sector);
    if(filters.status)add('a.status=?',filters.status);
    if(filters.search)add("lower(s.name||' '||u.name||' '||a.auditor_name) LIKE ?",'%'+filters.search.toLowerCase().slice(0,160)+'%');
    return (await this.db.query(selectAudit+(clauses.length?' WHERE '+clauses.join(' AND '):'')+' ORDER BY a.date DESC,s.name LIMIT 1500',values)).rows;
  }
  async getAudit(actor:Actor,id:string){
    requireModule(actor,'5s');
    const a=(await this.db.query(selectAudit+' WHERE a.id=$1',[id])).rows[0];
    if(!a)throw new AppError('Auditoria não encontrada.',404);if(!canRead(actor,a as any))throw new AppError('Acesso não autorizado.',403);
    const answers=(await this.db.query('SELECT question_id,sense,score,note FROM sm5s.answers WHERE audit_id=$1 ORDER BY question_id',[id])).rows;
    const summaries=(await this.db.query('SELECT sense,score FROM sm5s.summaries WHERE audit_id=$1 ORDER BY sense',[id])).rows;
    const evidence=(await this.db.query('SELECT id,sense,size,width,height,description,created_at FROM sm5s.evidence WHERE audit_id=$1 ORDER BY created_at',[id])).rows;
    const events=(await this.db.query('SELECT e.*,u.name AS actor FROM sm5s.events e LEFT JOIN sm5s.users u ON u.id=e.actor_id WHERE audit_id=$1 ORDER BY e.created_at,e.id',[id])).rows;
    const prev=previousMonth(a.date.slice(0,7));
    const pa=(await this.db.query("SELECT p.*,p.date::text AS date FROM sm5s.audits p WHERE p.sector_id=$1 AND p.status='FINALIZED' AND p.date>=$2::date AND p.date<($2::date+interval '1 month') ORDER BY p.date DESC,p.created_at DESC LIMIT 1",[a.sector_id,prev+'-01'])).rows[0]??null;
    const ps=pa?(await this.db.query('SELECT sense,score FROM sm5s.summaries WHERE audit_id=$1 ORDER BY sense',[pa.id])).rows:[];
    const pans=pa?(await this.db.query('SELECT question_id,sense,score,note FROM sm5s.answers WHERE audit_id=$1',[pa.id])).rows:[];
    return {audit:a,answers,summaries,evidence,events,editable:canEdit(actor,a as any),previous:{period:prev,audit:pa,summaries:ps,answers:pans}};
  }
  async saveAnswers(actor:Actor,id:string,input:unknown){
    const v=saveSchema.parse(input);
    return this.transaction(actor,async q=>{
      const a=await locked(q,id);if(!canEdit(actor,a as any))throw new AppError('Você não pode alterar esta auditoria.',403);version(a,v.revision);
      const questions=a.questions as typeof QUESTIONS;
      const seen=new Set();
      for(const ans of v.answers){if(!questions.some(x=>x.id===ans.questionId)||seen.has(ans.questionId))throw new AppError('Pergunta inválida ou duplicada.');seen.add(ans.questionId);}
      await q.query('DELETE FROM sm5s.answers WHERE audit_id=$1',[id]);
      for(const ans of v.answers){const question=questions.find(x=>x.id===ans.questionId)!;await q.query('INSERT INTO sm5s.answers(audit_id,question_id,sense,score,note) VALUES($1,$2,$3,$4,$5)',[id,ans.questionId,question.sense,ans.score,ans.note]);}
      const scores=calculateScores(v.answers.map(ans=>({sense:questions.find(x=>x.id===ans.questionId)!.sense,score:ans.score})));
      await q.query('DELETE FROM sm5s.summaries WHERE audit_id=$1',[id]);
      for(const [sense,score] of Object.entries(scores.senses))if(score!==null)await q.query('INSERT INTO sm5s.summaries(audit_id,sense,score) VALUES($1,$2,$3)',[id,Number(sense),score]);
      const result=(await q.query("UPDATE sm5s.audits SET status='IN_PROGRESS',sense_notes=$2::jsonb,overall=$3,revision=revision+1,updated_at=now() WHERE id=$1 RETURNING id,revision",[id,JSON.stringify(v.senseNotes),v.answers.filter(a=>a.score!==null).length===questions.length?scores.overall:null])).rows[0];
      await event(q,actor,id,'SAVED',`${v.answers.length}/${questions.length} perguntas respondidas`);return result;
    });
  }
  async transition(actor:Actor,id:string,revision:number,to:string,reason:string){
    z.number().int().positive().parse(revision);z.string().max(5000).parse(reason);
    return this.transaction(actor,async q=>{
      const a=await locked(q,id);version(a,revision);assertTransition(a.status,to,actor,a.auditor_id,reason);
      if(to==='REVIEW'){
        const count=(await q.query('SELECT count(*)::integer AS n FROM sm5s.answers WHERE audit_id=$1 AND score IS NOT NULL',[id])).rows[0].n;
        if(count!==(a.questions as unknown[]).length||!count)throw new AppError(`Responda todas as ${(a.questions as unknown[]).length} perguntas antes de enviar.`);
      }
      const result=(await q.query("UPDATE sm5s.audits SET status=$2,revision=revision+1,updated_at=now(),reviewed_by=CASE WHEN $2='FINALIZED' THEN $3 ELSE reviewed_by END,finalized_at=CASE WHEN $2='FINALIZED' THEN now() ELSE finalized_at END WHERE id=$1 RETURNING id,revision",[id,to,actor.id])).rows[0];
      await event(q,actor,id,to,reason);return result;
    });
  }
  async dashboard(actor:Actor,filters:Filters){
    if(!canViewDashboard(actor))throw new AppError('Acesso restrito aos indicadores do 5S.',403);const audits=await this.listAudits(actor,filters);
    const ids=audits.filter(a=>a.status==='FINALIZED').map(a=>a.id);
    const summaries=ids.length?(await this.db.query('SELECT audit_id,sense,score FROM sm5s.summaries WHERE audit_id=ANY($1::text[])',[ids])).rows:[];
    const selectedSense=filters.sense?Number(filters.sense):null;
    const finalized:(Row&{metric:number|null})[]=audits.filter(a=>a.status==='FINALIZED').map(a=>({...a,metric:selectedSense?(summaries.find(s=>s.audit_id===a.id&&s.sense===selectedSense)?.score??null):a.overall}));
    const mean=(v:(number|null)[])=>{const n=v.filter(x=>x!==null) as number[];return n.length?Math.round(n.reduce((a,b)=>a+b,0)/n.length*100)/100:null;};
    const metrics=finalized.filter(a=>a.metric!==null);
    const months=[...new Set(audits.map(a=>a.date.slice(0,7)))].sort();
    const sectorIds=[...new Set(finalized.map(a=>a.sector_id))];
    return {
      total:audits.length,finalized:finalized.length,review:audits.filter(a=>a.status==='REVIEW').length,pending:audits.filter(a=>['PLANNED','IN_PROGRESS'].includes(a.status)).length,
      average:mean(finalized.map(a=>a.metric)),partial:finalized.length-metrics.length,
      senses:[1,2,3,4,5].map(sense=>({sense,score:mean(summaries.filter(s=>s.sense===sense).map(s=>s.score))})),
      trend:months.map(month=>({period:month,score:mean(finalized.filter(a=>a.date.startsWith(month)).map(a=>a.metric)),count:finalized.filter(a=>a.date.startsWith(month)).length})),
      sectors:sectorIds.map(id=>{const list=finalized.filter(a=>a.sector_id===id);return {id,name:list[0].sector,unit:list[0].unit,score:mean(list.map(a=>a.metric)),count:list.length};}).sort((a,b)=>(a.score??-1)-(b.score??-1)),
      recent:audits.slice(0,6)
    };
  }
  async importHistory(actor:Actor,text:string,allowValidOnly:boolean){
    requireMaster(actor);const plan=parseHistory(text);
    if(plan.errors.length&&!allowValidOnly)throw new AppError('Arquivo contém inconsistências. Corrija-as ou selecione a importação somente de registros válidos.');
    if(!plan.rows.length)throw new AppError('Não há registros válidos para importar.');
    const fileHash=tokenHash(text);
    return this.transaction(actor,async q=>{
      // Serialize importers. All queries run on the same connection / transaction.
      await q.query('LOCK TABLE sm5s.import_batches IN EXCLUSIVE MODE');
      const prior=(await q.query('SELECT report FROM sm5s.import_batches WHERE file_hash=$1',[fileHash])).rows[0];
      if(prior)return {...prior.report,alreadyImported:true};
      let inserted=0,skipped=0;const touched=new Set<string>();
      const unitInputs=[...new Map(plan.rows.map(r=>[normalize(r.unit),{id:uid(),name:r.unit,normalized_name:normalize(r.unit)}])).values()];
      await q.query("INSERT INTO sm5s.units(id,name,normalized_name) SELECT id,name,normalized_name FROM jsonb_to_recordset($1::jsonb) AS x(id text,name text,normalized_name text) ON CONFLICT(normalized_name) DO NOTHING",[JSON.stringify(unitInputs)]);
      const units=new Map((await q.query('SELECT id,normalized_name FROM sm5s.units')).rows.map(r=>[r.normalized_name,r.id]));
      const sectorInputs=[...new Map(plan.rows.map(r=>{const unit_id=units.get(normalize(r.unit));const normalized_name=normalize(r.sector);return [unit_id+'|'+normalized_name,{id:uid(),unit_id,name:r.sector,normalized_name}];})).values()];
      await q.query("INSERT INTO sm5s.sectors(id,unit_id,name,normalized_name) SELECT id,unit_id,name,normalized_name FROM jsonb_to_recordset($1::jsonb) AS x(id text,unit_id text,name text,normalized_name text) ON CONFLICT(unit_id,normalized_name) DO NOTHING",[JSON.stringify(sectorInputs)]);
      const sectors=new Map((await q.query('SELECT id,unit_id,normalized_name FROM sm5s.sectors')).rows.map(r=>[r.unit_id+'|'+r.normalized_name,r.id]));
      const getSector=(r:typeof plan.rows[number])=>sectors.get(units.get(normalize(r.unit))+'|'+normalize(r.sector));
      const auditInputs=[...new Map(plan.rows.map(r=>{const sector_id=getSector(r);return [sector_id+'|'+r.date,{id:uid(),sector_id,date:r.date,auditor_name:r.auditor}];})).values()];
      await q.query("INSERT INTO sm5s.audits(id,sector_id,date,auditor_name,status,source,created_by,finalized_at) SELECT id,sector_id,date::date,auditor_name,'FINALIZED','HISTORICAL',$2,now() FROM jsonb_to_recordset($1::jsonb) AS x(id text,sector_id text,date text,auditor_name text) ON CONFLICT(sector_id,date) DO NOTHING",[JSON.stringify(auditInputs),actor.id]);
      const storedAudits=(await q.query("SELECT a.*,a.date::text AS date FROM sm5s.audits a JOIN jsonb_to_recordset($1::jsonb) AS x(sector_id text,date text) ON a.sector_id=x.sector_id AND a.date=x.date::date FOR UPDATE OF a",[JSON.stringify(auditInputs)])).rows;
      const audits=new Map(storedAudits.map(a=>[a.sector_id+'|'+a.date,a]));
      const ids=storedAudits.map(a=>a.id);
      const existing=new Map((await q.query('SELECT audit_id,sense,score FROM sm5s.summaries WHERE audit_id=ANY($1::text[])',[ids])).rows.map(r=>[r.audit_id+'|'+r.sense,r.score]));
      const additions:{audit_id:string;sense:number;score:number}[]=[];
      for(const row of plan.rows){
        const audit=audits.get(getSector(row)+'|'+row.date)!;
        if(audit.source!=='HISTORICAL'||normalize(audit.auditor_name)!==normalize(row.auditor))throw new AppError(`Conflito na linha ${row.line}: setor/data já possuem outra auditoria ou autoria.`,409);
        const key=audit.id+'|'+row.sense;
        if(existing.has(key)){
          if(existing.get(key)!==row.score)throw new AppError(`Conflito na linha ${row.line}: nota diferente da já armazenada. Nenhum registro foi importado.`,409);skipped++;
        }else{additions.push({audit_id:audit.id,sense:row.sense,score:row.score});inserted++;touched.add(audit.id);}
      }
      if(additions.length){
        await q.query('INSERT INTO sm5s.summaries(audit_id,sense,score) SELECT audit_id,sense,score FROM jsonb_to_recordset($1::jsonb) AS x(audit_id text,sense integer,score double precision)',[JSON.stringify(additions)]);
        await q.query('UPDATE sm5s.audits a SET overall=x.overall FROM (SELECT audit_id,CASE WHEN count(*)=5 THEN round(avg(score)::numeric,2)::double precision ELSE NULL END AS overall FROM sm5s.summaries WHERE audit_id=ANY($1::text[]) GROUP BY audit_id) x WHERE a.id=x.audit_id',[[...touched]]);
        const events=[...touched].map(audit_id=>({id:uid(),audit_id}));
        await q.query("INSERT INTO sm5s.events(id,audit_id,actor_id,action,detail) SELECT id,audit_id,$2,'IMPORTED','Histórico agregado por senso; sem respostas individuais na origem.' FROM jsonb_to_recordset($1::jsonb) AS x(id text,audit_id text)",[JSON.stringify(events),actor.id]);
      }
      const report={inserted,skipped,audits:touched.size,total:plan.total,duplicates:plan.duplicates.length,rejected:plan.errors.length,warnings:plan.warnings.length,alreadyImported:false};
      await q.query('INSERT INTO sm5s.import_batches(id,actor_id,file_hash,report) VALUES($1,$2,$3,$4::jsonb)',[uid(),actor.id,fileHash,JSON.stringify(report)]);return report;
    });
  }
}
