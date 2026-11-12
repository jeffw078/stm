import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {Actor} from '../../../lib/domain';
import {AppError} from '../../../lib/domain';
import type {Database,Queryable,Row} from '../../../lib/db';
import {authorizeMutation} from '../../../lib/authorization';

export type PcmActor=Actor;
export const PERMISSIONS=['assets.read','assets.write','requests.create','requests.own','requests.all','requests.triage','orders.read','orders.assign','orders.execute','orders.close','orders.reopen','orders.cancel','orders.respond','plans.manage','costs.read','costs.write','materials.read','materials.write','imports.preview','imports.confirm','indicators.read','export','settings.manage','access.manage','documents.read','documents.write'] as const;
export const ROLES=['REQUESTER','TECHNICIAN','PLANNER','MANAGER','VIEWER'] as const;
export const ROLE_LABELS={REQUESTER:'Solicitante',TECHNICIAN:'Técnico',PLANNER:'Planejador PCM',MANAGER:'Gestor da manutenção',VIEWER:'Consulta / auditoria'};
const common=['assets.read','requests.create','requests.own','documents.read','documents.write'];
export const ROLE_PERMISSIONS:Record<string,string[]>={
 REQUESTER:common,
 TECHNICIAN:[...common,'orders.read','orders.execute','orders.respond','materials.read'],
 PLANNER:PERMISSIONS.filter(p=>!['access.manage','settings.manage','costs.write'].includes(p)),
 MANAGER:PERMISSIONS.filter(p=>p!=='access.manage'),
 VIEWER:['assets.read','requests.all','orders.read','materials.read','documents.read','indicators.read']
};
export type Context={actor:PcmActor;role:string;permissions:string[];unitIds:string[]|null;teamIds:string[];system?:boolean};
export const uid=()=>randomUUID();
export const systemContext=():Context=>({actor:{id:'system',role:'SYSTEM'},role:'SYSTEM',permissions:[...PERMISSIONS],unitIds:null,teamIds:[],system:true});
export function requirePermission(ctx:Context,permission:string){if(!ctx.permissions.includes(permission))throw new AppError('Permissão restrita para esta operação do PCM.',403);}
export function ensureUnit(ctx:Context,id:string){if(!id||ctx.unitIds!==null&&!ctx.unitIds.includes(id))throw new AppError('Unidade fora do seu escopo de acesso.',403);}
export function scopeSql(ctx:Context,column:string,values:unknown[]){if(ctx.unitIds===null)return 'TRUE';values.push(ctx.unitIds);return `${column}=ANY($${values.length}::text[])`;}
export async function getContext(q:Queryable,actor:PcmActor):Promise<Context>{
 await authorizeMutation(q,actor);
 const user=(await q.query('SELECT id,role,must_change_password FROM sm5s.users WHERE id=$1',[actor.id])).rows[0];
 if(user.must_change_password)throw new AppError('Altere a senha temporária para continuar.',428);
 const grant=(await q.query("SELECT level,sublevel FROM sm5s.module_access WHERE user_id=$1 AND module='maintenance'",[actor.id])).rows[0];
 if(user.role==='MASTER'||grant?.level==='ADMIN')return {actor,role:'ADMIN',permissions:[...PERMISSIONS],unitIds:null,teamIds:[]};
 if(!grant)throw new AppError('Você não possui acesso ao módulo de manutenção.',403);
 const member=(await q.query('SELECT * FROM pcm.memberships WHERE user_id=$1',[actor.id])).rows[0];
 if(!member)return {actor,role:'UNCONFIGURED',permissions:[],unitIds:[],teamIds:[]};
 let permissions=[...new Set([...(ROLE_PERMISSIONS[member.role]??[]),...(member.permissions as string[]).filter(p=>PERMISSIONS.includes(p as any)&&p!=='access.manage')])];
 if(grant.sublevel==='VIEWER'){const readOnly=new Set(['assets.read','requests.own','requests.all','orders.read','materials.read','documents.read','indicators.read','costs.read','export']);permissions=permissions.filter(p=>readOnly.has(p));}
 return {actor,role:member.role,permissions,unitIds:member.unit_ids,teamIds:member.team_ids};
}
export async function withContext<T>(db:Database,actor:PcmActor,permission:string,fn:(q:Queryable,ctx:Context)=>Promise<T>){return db.transaction(async q=>{const ctx=await getContext(q,actor);if(permission)requirePermission(ctx,permission);return fn(q,ctx);});}
export async function event(q:Queryable,ctx:Context,kind:string,id:string,action:string,detail:unknown={}){
 await q.query('INSERT INTO pcm.audit_events(id,actor_id,entity_kind,entity_id,action,detail) VALUES($1,$2,$3,$4,$5,$6::jsonb)',[uid(),ctx.system?null:ctx.actor.id,kind,id,action,JSON.stringify(detail)]);
}
export function revision(row:Row,expected:unknown){if(!Number.isInteger(expected)||row.revision!==expected)throw new AppError('Registro alterado em outra sessão. Recarregue antes de continuar.',409);}
export function pagination(input:Record<string,any>={}){const v=z.object({page:z.coerce.number().int().min(1).default(1),pageSize:z.coerce.number().int().min(1).max(100).default(25),search:z.string().max(160).default('')}).parse(input);return {...v,offset:(v.page-1)*v.pageSize};}
export function pageResult(rows:Row[],total:number,args:{page:number;pageSize:number}){return {rows,total:Number(total),page:args.page,pageSize:args.pageSize};}
export function csvCell(value:unknown){let s=String(value??'');if(/^\s*[=+\-@]|^[\t\r\n]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';}

export class AccessService{
 constructor(public db:Database){}
 context(actor:PcmActor){return withContext(this.db,actor,'',async(_q,ctx)=>ctx);}
 settings(actor:PcmActor){return withContext(this.db,actor,'settings.manage',async(q,ctx)=>{const values:unknown[]=[],teamValues:unknown[]=[];return {settings:(await q.query('SELECT * FROM pcm.settings WHERE '+scopeSql(ctx,'unit_id',values),values)).rows,teams:(await q.query('SELECT * FROM pcm.teams WHERE '+scopeSql(ctx,'unit_id',teamValues)+' ORDER BY name',teamValues)).rows};});}
 async members(actor:PcmActor){return withContext(this.db,actor,'access.manage',async q=>(await q.query("SELECT u.id,u.name,u.email,ma.level,m.role,m.unit_ids,m.team_ids,m.permissions,m.revision FROM sm5s.users u JOIN sm5s.module_access ma ON ma.user_id=u.id AND ma.module='maintenance' LEFT JOIN pcm.memberships m ON m.user_id=u.id WHERE u.active ORDER BY u.name")).rows);}
 saveMember(actor:PcmActor,input:unknown){const v=z.object({user_id:z.string(),role:z.enum(ROLES),unit_ids:z.array(z.string()).max(100),team_ids:z.array(z.string()).default([]),permissions:z.array(z.enum(PERMISSIONS)).default([]),revision:z.number().int().positive().optional()}).strict().parse(input);
  return withContext(this.db,actor,'access.manage',async(q,ctx)=>{
   const user=(await q.query("SELECT u.id,u.role FROM sm5s.users u JOIN sm5s.module_access ma ON ma.user_id=u.id AND ma.module='maintenance' WHERE u.id=$1 AND u.active FOR UPDATE OF u",[v.user_id])).rows[0];
   if(!user||user.role==='MASTER')throw new AppError('Usuário sem módulo de manutenção ou conta Master protegida.',403);
   const units=(await q.query('SELECT id FROM sm5s.units WHERE id=ANY($1::text[]) AND active',[v.unit_ids])).rows;
   if(new Set(v.unit_ids).size!==units.length)throw new AppError('Unidade inválida.');
   const teams=(await q.query('SELECT id,unit_id FROM pcm.teams WHERE id=ANY($1::text[]) AND active',[v.team_ids])).rows;
   if(teams.length!==new Set(v.team_ids).size||teams.some(t=>!v.unit_ids.includes(t.unit_id)))throw new AppError('Equipe incompatível com as unidades autorizadas.');
   const prior=(await q.query('SELECT * FROM pcm.memberships WHERE user_id=$1 FOR UPDATE',[v.user_id])).rows[0];if(prior)revision(prior,v.revision);
   await q.query('INSERT INTO pcm.memberships(user_id,role,unit_ids,team_ids,permissions) VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT(user_id) DO UPDATE SET role=excluded.role,unit_ids=excluded.unit_ids,team_ids=excluded.team_ids,permissions=excluded.permissions,revision=pcm.memberships.revision+1,updated_at=now()',[v.user_id,v.role,v.unit_ids,v.team_ids,JSON.stringify(v.permissions.filter(p=>p!=='access.manage'))]);
   await q.query('UPDATE sm5s.users SET auth_version=auth_version+1 WHERE id=$1',[v.user_id]);await q.query('DELETE FROM sm5s.sessions WHERE user_id=$1',[v.user_id]);
   await event(q,ctx,'access',v.user_id,'ACCESS_CHANGED',v);return {ok:true};
  });
 }
 saveTeam(actor:PcmActor,input:unknown){const v=z.object({unit_id:z.string(),name:z.string().trim().min(2).max(120),weekly_hours:z.coerce.number().min(0).max(10000).nullable().optional()}).strict().parse(input);return withContext(this.db,actor,'settings.manage',async(q,ctx)=>{ensureUnit(ctx,v.unit_id);return (await q.query('INSERT INTO pcm.teams(id,unit_id,name,weekly_hours) VALUES($1,$2,$3,$4) RETURNING *',[uid(),v.unit_id,v.name,v.weekly_hours??null])).rows[0];});}
 saveSettings(actor:PcmActor,input:unknown){const v=z.object({unit_id:z.string(),validation_required:z.boolean(),asset_code_prefix:z.string().max(20).nullable().optional(),revision:z.number().int().positive().optional()}).strict().parse(input);return withContext(this.db,actor,'settings.manage',async(q,ctx)=>{ensureUnit(ctx,v.unit_id);await q.query('SELECT id FROM pcm.integrity_lock WHERE id=1 FOR UPDATE');const prior=(await q.query('SELECT revision FROM pcm.settings WHERE unit_id=$1 FOR UPDATE',[v.unit_id])).rows[0];if(prior)revision(prior,v.revision);await q.query('INSERT INTO pcm.settings(unit_id,validation_required,asset_code_prefix) VALUES($1,$2,$3) ON CONFLICT(unit_id) DO UPDATE SET validation_required=excluded.validation_required,asset_code_prefix=excluded.asset_code_prefix,revision=pcm.settings.revision+1',[v.unit_id,v.validation_required,v.asset_code_prefix??null]);await event(q,ctx,'settings',v.unit_id,'SETTINGS_CHANGED',v);return {ok:true};});}
}
