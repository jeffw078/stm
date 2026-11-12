export type Role='MASTER'|'ADMIN'|'AUDITOR'|'USER';
export type ModuleId='5s'|'maintenance';
export type ModuleAccess={level:'ADMIN'|'USER';sublevel:'VIEWER'|'OPERATOR'|'MANAGER'};
export type ModuleGrants=Partial<Record<ModuleId,ModuleAccess>>;
export const MODULES=[{id:'5s',name:'Auditoria 5S',description:'Planejamento, avaliações e evolução do programa 5S.'},{id:'maintenance',name:'Manutenção',description:'Espaço para a gestão da manutenção da empresa.'}] as const;
export const SUBLEVEL_LABELS={VIEWER:'Consulta',OPERATOR:'Operação',MANAGER:'Gestão'};
export type Status='PLANNED'|'IN_PROGRESS'|'REVIEW'|'FINALIZED';
export type Actor={id:string;role:Role|string;modules?:ModuleGrants;auth_version?:number;session?:{hash:string}};
export type AuditAccess={auditor_id:string|null;status:string;source:string};
export type User=Actor & {name:string;email:string;role:Role;must_change_password:boolean;active:boolean};
export class AppError extends Error {constructor(message:string,public status=400){super(message);}}
export function moduleAccess(actor:Actor,module:ModuleId):ModuleAccess|undefined{
  if(actor.role==='MASTER')return {level:'ADMIN',sublevel:'MANAGER'};
  if(actor.modules!==undefined)return actor.modules[module];
  // Compatibility for internal legacy callers; authenticated users always load explicit grants.
  if(module==='5s'&&['ADMIN','AUDITOR'].includes(actor.role))return {level:actor.role==='ADMIN'?'ADMIN':'USER',sublevel:actor.role==='ADMIN'?'MANAGER':'OPERATOR'};
}
export function requireModule(actor:Actor,module:ModuleId){if(!moduleAccess(actor,module))throw new AppError('Você não possui acesso a este módulo.',403);}
export function fiveSRole(actor:Actor){const access=moduleAccess(actor,'5s');return !access?null:actor.role==='MASTER'?'MASTER':access.level==='ADMIN'||access.sublevel==='MANAGER'?'ADMIN':access.sublevel==='OPERATOR'?'AUDITOR':'VIEWER';}
export function isManager(actor:Actor){return ['MASTER','ADMIN'].includes(fiveSRole(actor)??'');}
export function canViewDashboard(actor:Actor){return isManager(actor)||fiveSRole(actor)==='VIEWER';}
export function accessLabel(access:ModuleAccess){return access.level==='ADMIN'?'Administrador':`Usuário · ${SUBLEVEL_LABELS[access.sublevel]}`;}
export const STATUS_LABELS:Record<string,string>={PLANNED:'Planejada',IN_PROGRESS:'Em andamento',REVIEW:'Em revisão',FINALIZED:'Finalizada'};
export function previousMonth(period:string){
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(period))throw new AppError('Período inválido.');
  const [y,m]=period.split('-').map(Number);return m===1?`${y-1}-12`:`${y}-${String(m-1).padStart(2,'0')}`;
}
export function calculateScores(answers:{sense:number;score:number|null}[]){
  const senses:Record<number,number|null>={};
  for(let s=1;s<=5;s++){
    const values=answers.filter(a=>a.sense===s&&a.score!==null).map(a=>a.score as number);
    senses[s]=values.length?Math.round(values.reduce((a,b)=>a+b,0)/values.length*100)/100:null;
  }
  const all=Object.values(senses);
  return {senses,overall:all.every(v=>v!==null)?Math.round((all as number[]).reduce((a,b)=>a+b,0)/5*100)/100:null};
}
export function canRead(actor:Actor,a:AuditAccess){const role=fiveSRole(actor);return role!==null&&(role!=='AUDITOR'||a.auditor_id===actor.id);}
export function canEdit(actor:Actor,a:AuditAccess){
  const role=fiveSRole(actor);return role!==null&&role!=='VIEWER'&&a.source==='LIVE'&&['PLANNED','IN_PROGRESS'].includes(a.status)&&(actor.role==='MASTER'||a.auditor_id===actor.id);
}
export function requireManager(actor:Actor){if(!isManager(actor))throw new AppError('Acesso restrito à gestão.',403);}
export function requireMaster(actor:Actor){if(actor.role!=='MASTER')throw new AppError('Acesso restrito ao Master.',403);}
export function assertTransition(from:string,to:string,actor:Actor,auditor:string|null,reason=''){
  requireModule(actor,'5s');
  if(fiveSRole(actor)==='VIEWER')throw new AppError('Seu acesso permite somente consulta.',403);
  if(from==='FINALIZED')throw new AppError('Auditorias finalizadas são imutáveis.',409);
  if(to==='REVIEW'&&['PLANNED','IN_PROGRESS'].includes(from)){
    if(actor.id!==auditor&&actor.role!=='MASTER')throw new AppError('Somente o auditor designado pode enviar.',403);return;
  }
  if(from==='REVIEW'&&['FINALIZED','IN_PROGRESS'].includes(to)){
    requireManager(actor);
    if(actor.id===auditor)throw new AppError('A revisão deve ser realizada por outro gestor.',403);
    if(to==='IN_PROGRESS'&&reason.trim().length<5)throw new AppError('Informe o motivo da devolução (mínimo 5 caracteres).');return;
  }
  throw new AppError('Transição de etapa inválida.',409);
}
export function scoreLabel(score:number|null|undefined){return score===null||score===undefined?'Sem avaliação':`${Number(score).toLocaleString('pt-BR',{maximumFractionDigits:1})}%`;}
export function validDate(input:string){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(input))return false;
  const d=new Date(`${input}T12:00:00Z`);return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===input;
}
export function today(){return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo'}).format(new Date());}
