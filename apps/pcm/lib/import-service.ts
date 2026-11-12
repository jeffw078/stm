import {z} from 'zod';
import Decimal from 'decimal.js';
import type {Database,Queryable,Row} from '../../../lib/db';
import {AppError,validDate} from '../../../lib/domain';
import {withContext,ensureUnit,event,revision,pagination,pageResult,scopeSql,csvCell,uid,requirePermission,type Context,type PcmActor} from './base';
import {privateStore,type PrivateStore} from './storage';
import {readWorkbook,mapWorkbook,hash,decimalValue,MAPPING_VERSION,type MappedLine} from './workbook';

const calendar=z.string().refine(validDate,'Data inválida.');
const previewInput=z.object({unit_id:z.string().min(1).max(100),filename:z.string().min(1).max(200).refine(s=>!/[\x00-\x1f/\\]/.test(s),'Nome de arquivo inválido.'),source_date:calendar.nullable().optional(),kind:z.enum(['WORKBOOK','CATALOG','STOCK','BAIXAS','MOVEMENT','PURCHASE']).default('WORKBOOK')}).strict();
const textValue=z.string().max(4000).nullable();
const valuesSchema=z.object(Object.fromEntries(['code','name','unit','quantity','unit_cost','source_value','minimum_quantity','safety_stock','supplier','stock','open_orders','planning_balance','establishment','depot','normalized_depot','lot','location','cost_center','narrative','notes','lead_time','source_date','purchase_order','request_number','order_number','status','received_text','received_quantity','received_proposal','received_unit','movement_type','species','document','material_value','labor_value','overhead_value','asset_id','position','expected_quantity'].map(k=>[k,textValue.optional()]))).extend({overwrite_existing:z.boolean().optional()}).strict();
const reviewInput=z.object({line_id:z.string().min(1).optional(),line_ids:z.array(z.string().min(1)).min(1).max(500).optional(),selection:z.object({kind:z.enum(['MOVEMENT','BAIXAS','STOCK'])}).strict().optional(),status:z.enum(['APPROVED','REJECTED','PENDING']),values:valuesSchema.optional(),reason:z.string().trim().max(2000).optional(),revision:z.number().int().positive()}).strict().refine(v=>[v.line_id,v.line_ids,v.selection].filter(Boolean).length===1,'Informe line_id, line_ids ou selection, exclusivamente.');
const numericFields=['quantity','unit_cost','source_value','minimum_quantity','safety_stock','stock','open_orders','planning_balance','lead_time','received_quantity','received_proposal','material_value','labor_value','overhead_value','expected_quantity'];
export type ImportBatch=Row&{id:string;revision:number;status:string;sheets:Row[];warnings:string[];rows:Row[];total:number;page:number;pageSize:number;counts:Row;reused?:boolean};
function validatedValues(kind:string,values:Record<string,any>,approval:boolean){
 const result={...values};
 for(const key of numericFields)if(result[key]!==null&&result[key]!==undefined){const value=decimalValue(String(result[key]),'xml');if(value===null)throw new AppError(`Valor decimal inválido: ${key}.`);result[key]=value;}
 if(result.source_date&&!validDate(result.source_date))throw new AppError('Data de referência inválida.');
 if(approval){
  if(!result.code?.trim()||result.code.length>120)throw new AppError('Informe um código de material válido.');
  if(['CATALOG','STOCK'].includes(kind)&&(!result.unit?.trim()||result.unit.length>30))throw new AppError('Informe a unidade de medida para aprovar.');
  if(kind==='CATALOG'&&(!result.name?.trim()||result.name.length>240))throw new AppError('Informe a descrição do material.');
  if(kind==='STOCK'&&result.quantity==null)throw new AppError('Informe a quantidade do snapshot de estoque.');
  if(result.received_quantity!=null){
   if(!result.received_unit||!result.unit||result.received_unit.toUpperCase()!==result.unit.toUpperCase())throw new AppError('Unidade recebida deve corresponder à unidade pedida.');
   if(new Decimal(result.received_quantity).lt(0)||result.quantity!=null&&new Decimal(result.received_quantity).gt(result.quantity))throw new AppError('Recebimento fora da quantidade pedida.');
  }
  for(const key of ['minimum_quantity','safety_stock','unit_cost'])if(result[key]!=null&&new Decimal(result[key]).lt(0))throw new AppError(`${key} não pode ser negativo.`);
  if(result.expected_quantity!=null&&new Decimal(result.expected_quantity).lte(0))throw new AppError('Quantidade prevista deve ser positiva.');
 }
 return result;
}
function eventSignature(v:Record<string,any>){return JSON.stringify([v.code?.toUpperCase(),v.source_date,v.quantity,v.unit?.toUpperCase()]);}
async function getBatch(q:Queryable,ctx:Context,id:string,lock=false){const row=(await q.query('SELECT * FROM pcm.import_batches WHERE id=$1'+(lock?' FOR UPDATE':''),[id])).rows[0];if(!row)throw new AppError('Lote não encontrado.',404);ensureUnit(ctx,row.unit_id);return row;}
function filterLines(filters:Record<string,any>,values:unknown[]){let sql='';if(filters.status){if(!['PENDING','APPROVED','REJECTED','APPLIED'].includes(filters.status))throw new AppError('Situação de linha inválida.');if(filters.status==='APPLIED')sql+=' AND applied_at IS NOT NULL';else{values.push(filters.status);sql+=` AND status=$${values.length} AND applied_at IS NULL`;}}
 if(filters.kind){values.push(filters.kind);sql+=` AND kind=$${values.length}`;}if(filters.sheet){values.push(filters.sheet);sql+=` AND sheet=$${values.length}`;}if(filters.search){values.push('%'+String(filters.search).slice(0,160)+'%');sql+=` AND (proposed_values->>'code' ILIKE $${values.length} OR proposed_values->>'name' ILIKE $${values.length})`;}return sql;}
async function detail(q:Queryable,ctx:Context,id:string,filters:Record<string,any>={}):Promise<ImportBatch>{
 const batch=await getBatch(q,ctx,id);const args=pagination(filters);const params:unknown[]=[id];const where='batch_id=$1'+filterLines(filters,params);
 const total=(await q.query('SELECT count(*)::int AS n FROM pcm.import_lines WHERE '+where,params)).rows[0].n;
 const rows=(await q.query(`SELECT * FROM pcm.import_lines WHERE ${where} ORDER BY sheet,source_row LIMIT $${params.length+1} OFFSET $${params.length+2}`,[...params,args.pageSize,args.offset])).rows;
 const counts=(await q.query("SELECT count(*)::int AS total,count(*) FILTER(WHERE status='PENDING' AND applied_at IS NULL)::int AS pending,count(*) FILTER(WHERE status='APPROVED' AND applied_at IS NULL)::int AS approved,count(*) FILTER(WHERE status='REJECTED')::int AS rejected,count(*) FILTER(WHERE applied_at IS NOT NULL)::int AS applied FROM pcm.import_lines WHERE batch_id=$1",[id])).rows[0];
 const costKeys=['unit_cost','source_value','material_value','labor_value','overhead_value'];
 if(!ctx.permissions.includes('costs.read'))for(const row of rows){row.raw=null;for(const field of ['proposed_values','reviewed_values'])if(row[field]){row[field]={...row[field]};for(const key of costKeys)delete row[field][key];}}
 const {storage_key:privateKey,...publicBatch}=batch;void privateKey;
 return {...publicBatch,...pageResult(rows,total,args),counts} as ImportBatch;
}
/** All source artifacts stay in private object storage. The optional store is used by isolated tests. */
export class ImportService{
 constructor(public db:Database,private store?:PrivateStore){}
 async preview(actor:PcmActor,input:unknown,bytes:Buffer){
  const v=previewInput.parse(input);let cleanupKey:string|undefined;const store=this.store??privateStore();
  try{return await withContext(this.db,actor,'imports.preview',async(q,ctx)=>{
   ensureUnit(ctx,v.unit_id);if(!(await q.query('SELECT id FROM sm5s.units WHERE id=$1 AND active',[v.unit_id])).rows.length)throw new AppError('Unidade inválida.');
   const fileHash=hash(bytes);const prior=(await q.query('SELECT id FROM pcm.import_batches WHERE unit_id=$1 AND import_kind=$2 AND file_hash=$3',[v.unit_id,v.kind,fileHash])).rows[0];if(prior)return {...await detail(q,ctx,prior.id),reused:true};
   const workbook=readWorkbook(bytes,v.filename);const mapped=mapWorkbook(workbook);
   const primary=mapped.lines.filter(l=>l.kind!=='AUXILIARY'&&l.kind!=='UNKNOWN');
   if(v.kind!=='WORKBOOK'&&primary.some(l=>l.kind!==v.kind))throw new AppError('O tipo selecionado diverge do mapeamento do arquivo.');
   const catalogCodes=[...new Set(primary.filter(l=>l.kind==='CATALOG').map(l=>l.values.code.toLowerCase()))];
   const materials=catalogCodes.length?(await q.query('SELECT code,name,unit FROM pcm.materials WHERE unit_id=$1 AND lower(code)=ANY($2::text[])',[v.unit_id,catalogCodes])).rows:[];
   const materialMap=new Map(materials.map(m=>[m.code.toLowerCase(),m]));
   for(const line of primary)if(line.kind==='CATALOG'){
    const priorMaterial=materialMap.get(line.values.code.toLowerCase());
    if(priorMaterial){line.action='RECONCILE';line.issues.push('Material já cadastrado: conciliar diferenças; atualização exige autorização explícita e preserva valores confiáveis até revisão.');}
   }
   const oldLines=primary.length?(await q.query("SELECT fingerprint,proposed_values FROM pcm.import_lines WHERE unit_id=$1 AND kind IN ('MOVEMENT','BAIXAS') AND (proposed_values->>'code')=ANY($2::text[])",[v.unit_id,[...new Set(primary.map(l=>l.values.code))]])).rows:[];
   const fingerprints=new Set(oldLines.map(l=>l.fingerprint));const signatures=new Set(oldLines.map(l=>eventSignature(l.proposed_values)));
   const localSignatures=new Map<string,Set<string>>();
   for(const line of mapped.lines){
    if(v.source_date&&!line.values.source_date)line.values.source_date=v.source_date;
    if(['MOVEMENT','BAIXAS'].includes(line.kind)){
     const key=eventSignature(line.values);if(fingerprints.has(line.fingerprint)||signatures.has(key))line.issues.push('Possível sobreposição com outro arquivo/fonte: revisar; evento preservado sem deduplicação automática.');
     const kinds=localSignatures.get(key)??new Set<string>();kinds.add(line.kind);localSignatures.set(key,kinds);
    }
   }
   for(const line of mapped.lines)if(['MOVEMENT','BAIXAS'].includes(line.kind)&&(localSignatures.get(eventSignature(line.values))?.size??0)>1)line.issues.push('Possível sobreposição BAIXAS/CE0302: fontes mantidas separadas, sem somar consumo.');
   const id=uid(),key=`imports/${id}/${fileHash}.${/\.csv$/i.test(v.filename)?'csv':'xlsx'}`;cleanupKey=key;
   await store.put(key,bytes,/\.csv$/i.test(v.filename)?'text/csv':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
   const inserted=(await q.query('INSERT INTO pcm.import_batches(id,unit_id,filename,file_hash,import_kind,storage_key,source_date,mapping_version,date_system,sheets,warnings,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12) ON CONFLICT(unit_id,import_kind,file_hash) DO NOTHING RETURNING id',[id,v.unit_id,v.filename,fileHash,v.kind,key,v.source_date??null,MAPPING_VERSION,workbook.dateSystem,JSON.stringify(mapped.sheets),JSON.stringify(mapped.warnings),actor.id])).rows[0];
   if(!inserted){await store.remove(key);cleanupKey=undefined;const existing=(await q.query('SELECT id FROM pcm.import_batches WHERE unit_id=$1 AND import_kind=$2 AND file_hash=$3',[v.unit_id,v.kind,fileHash])).rows[0];return {...await detail(q,ctx,existing.id),reused:true};}
   for(let i=0;i<mapped.lines.length;i+=300){const records=mapped.lines.slice(i,i+300).map((line:MappedLine)=>({id:uid(),sheet:line.sheet,source_row:line.row,kind:line.kind,raw:line.raw,proposed_values:line.values,issues:line.issues,proposed_action:line.action,fingerprint:line.fingerprint,status:line.action==='IGNORE'?'REJECTED':'PENDING'}));
    await q.query('INSERT INTO pcm.import_lines(id,batch_id,unit_id,sheet,source_row,kind,raw,proposed_values,issues,proposed_action,fingerprint,status) SELECT x.id,$1,$2,x.sheet,x.source_row,x.kind,x.raw,x.proposed_values,x.issues,x.proposed_action,x.fingerprint,x.status FROM jsonb_to_recordset($3::jsonb) AS x(id text,sheet text,source_row integer,kind text,raw jsonb,proposed_values jsonb,issues jsonb,proposed_action text,fingerprint text,status text)',[id,v.unit_id,JSON.stringify(records)]);
   }
   await event(q,ctx,'import',id,'IMPORT_PREVIEW',{filename:v.filename,file_hash:fileHash,mapping_version:MAPPING_VERSION,records:mapped.lines.length});return detail(q,ctx,id);
  });}catch(error){if(cleanupKey)await store.remove(cleanupKey).catch(()=>{});throw error;}
 }
 batches(actor:PcmActor,filters:Record<string,any>={}){return withContext(this.db,actor,'imports.preview',async(q,ctx)=>{const args=pagination(filters);const values:unknown[]=[];let where=scopeSql(ctx,'b.unit_id',values);if(filters.unit_id){ensureUnit(ctx,filters.unit_id);values.push(filters.unit_id);where+=` AND b.unit_id=$${values.length}`;}if(args.search){values.push('%'+args.search+'%');where+=` AND b.filename ILIKE $${values.length}`;}const total=(await q.query(`SELECT count(*)::int AS n FROM pcm.import_batches b WHERE ${where}`,values)).rows[0].n;const rows=(await q.query(`SELECT b.*, (SELECT count(*)::int FROM pcm.import_lines l WHERE l.batch_id=b.id AND l.status='PENDING') AS pending FROM pcm.import_batches b WHERE ${where} ORDER BY b.created_at DESC LIMIT $${values.length+1} OFFSET $${values.length+2}`,[...values,args.pageSize,args.offset])).rows;for(const row of rows)delete row.storage_key;return pageResult(rows,total,args);});}
 batch(actor:PcmActor,id:string,filters:Record<string,any>={}){return withContext(this.db,actor,'imports.preview',(q,ctx)=>detail(q,ctx,id,filters));}
 references(actor:PcmActor,kind:'stock'|'purchases'|'movements',filters:Record<string,any>={}){
  if(!['stock','purchases','movements'].includes(kind))throw new AppError('Fonte de referência inválida.');
  return withContext(this.db,actor,'materials.read',async(q,ctx)=>{
   const table={stock:'stock_snapshots',purchases:'purchase_lines',movements:'imported_movements'}[kind];const args=pagination(filters);const values:unknown[]=[];let where=scopeSql(ctx,'s.unit_id',values);
   if(filters.unit_id){ensureUnit(ctx,filters.unit_id);values.push(filters.unit_id);where+=` AND s.unit_id=$${values.length}`;}
   if(args.search){values.push('%'+args.search+'%');where+=` AND (s.material_code ILIKE $${values.length} OR l.proposed_values->>'name' ILIKE $${values.length})`;}
   if(filters.material_code){values.push(String(filters.material_code));where+=` AND s.material_code=$${values.length}`;}
   for(const [key,operator]of [['from','>='],['to','<=']]as const)if(filters[key]){if(!validDate(filters[key]))throw new AppError('Data de filtro inválida.');values.push(filters[key]);where+=` AND s.source_date${operator}$${values.length}::date`;}
   if(kind==='movements'&&filters.type){if(!['MOVEMENT','BAIXAS'].includes(filters.type))throw new AppError('Tipo de fonte inválido.');values.push(filters.type);where+=` AND s.source_kind=$${values.length}`;}
   if(kind==='purchases'&&filters.status){values.push(String(filters.status));where+=` AND s.source_status=$${values.length}`;}
   const from=`pcm.${table} s JOIN pcm.import_lines l ON l.id=s.import_line_id AND l.unit_id=s.unit_id JOIN pcm.import_batches b ON b.id=l.batch_id AND b.unit_id=l.unit_id`;
   const total=(await q.query(`SELECT count(*)::int AS n FROM ${from} WHERE ${where}`,values)).rows[0].n;
   const extra=kind==='purchases'?",CASE WHEN s.quantity IS NOT NULL AND s.received_quantity IS NOT NULL AND upper(s.unit)=upper(s.received_unit) THEN s.quantity-s.received_quantity ELSE NULL END AS remaining_quantity":'';
   const rows=(await q.query(`SELECT s.*,l.proposed_values->>'name' AS material_name,l.sheet,l.source_row,b.id AS batch_id,b.filename AS source_filename,b.file_hash AS source_hash,b.mapping_version,b.source_date AS source_reference_date ${extra} FROM ${from} WHERE ${where} ORDER BY b.created_at DESC,l.source_row LIMIT $${values.length+1} OFFSET $${values.length+2}`,[...values,args.pageSize,args.offset])).rows;
   for(const row of rows){if(kind==='stock')row.source_kind='STOCK';if(kind==='purchases')row.source_kind='PURCHASE';
    if(!ctx.permissions.includes('costs.read')){for(const key of ['unit_cost','source_value'])delete row[key];if(row.values){row.values={...row.values};for(const key of ['unit_cost','source_value','material_value','labor_value','overhead_value'])delete row.values[key];}}
   }
   return pageResult(rows,total,args);
  });
 }
 review(actor:PcmActor,id:string,input:unknown){const v=reviewInput.parse(input);return withContext(this.db,actor,'imports.confirm',async(q,ctx)=>{
  const batch=await getBatch(q,ctx,id,true);revision(batch,v.revision);
  if(v.values&&['unit_cost','source_value','material_value','labor_value','overhead_value'].some(key=>Object.prototype.hasOwnProperty.call(v.values,key)))requirePermission(ctx,'costs.write');
  if(v.selection&&(v.status!=='APPROVED'||v.values||!v.reason||v.reason.length<5))throw new AppError('Aprovação por fonte exige motivo explícito, sem alterar valores; use revisão individual para conciliar dados.');
  const ids=v.selection?(await q.query("SELECT id FROM pcm.import_lines WHERE batch_id=$1 AND kind=$2 AND status='PENDING' AND applied_at IS NULL ORDER BY source_row LIMIT 500",[id,v.selection.kind])).rows.map(r=>r.id):[...new Set(v.line_ids??[v.line_id!])];
  const lines=(await q.query('SELECT * FROM pcm.import_lines WHERE id=ANY($1::text[]) AND batch_id=$2 ORDER BY id FOR UPDATE',[ids,id])).rows;if(lines.length!==ids.length)throw new AppError('Uma ou mais linhas não pertencem ao lote.',404);
  for(const line of lines){
   if(line.applied_at)throw new AppError('Linha já aplicada; correções precisam de novo registro auditável.',409);
   if(v.status==='APPROVED'&&['AUXILIARY','UNKNOWN'].includes(line.kind))throw new AppError('Fonte auxiliar ou desconhecida não pode virar registro de negócio.');
   const values=validatedValues(line.kind,{...line.proposed_values,...(line.reviewed_values??{}),...(v.values??{})},v.status==='APPROVED');
   if(v.status==='APPROVED'&&(line.issues.length||values.overwrite_existing||values.received_quantity!=null)&&(!v.reason||v.reason.length<5))throw new AppError('Registre o motivo da aprovação e a conciliação das pendências (mínimo 5 caracteres).');
   if(values.asset_id){const asset=(await q.query('SELECT id FROM pcm.assets WHERE id=$1 AND unit_id=$2',[values.asset_id,batch.unit_id])).rows[0];if(!asset)throw new AppError('Ativo de aplicação fora da unidade do lote.');}
   await q.query('UPDATE pcm.import_lines SET status=$2,reviewed_values=$3::jsonb,review_reason=$4,reviewed_by=$5,reviewed_at=now(),revision=revision+1 WHERE id=$1',[line.id,v.status,JSON.stringify(values),v.reason??null,actor.id]);
  }
  await q.query("UPDATE pcm.import_batches SET revision=revision+1,status='REVIEW' WHERE id=$1",[id]);
  await event(q,ctx,'import',id,'IMPORT_REVIEW',{line_ids:ids,status:v.status,reason:v.reason,values:v.values,selection:v.selection});
  const remaining=v.selection?(await q.query("SELECT count(*)::int AS n FROM pcm.import_lines WHERE batch_id=$1 AND kind=$2 AND status='PENDING' AND applied_at IS NULL",[id,v.selection.kind])).rows[0].n:undefined;
  return {...await detail(q,ctx,id),reviewed_now:ids.length,remaining_selection:remaining};
 });}
 confirm(actor:PcmActor,id:string,input:unknown){const v=z.object({revision:z.number().int().positive()}).strict().parse(input);return withContext(this.db,actor,'imports.confirm',async(q,ctx)=>{
  const batch=await getBatch(q,ctx,id,true);
  // A repeated confirmation of an already completed batch has no effects.
  if(batch.status==='CONFIRMED')return {...await detail(q,ctx,id),reused:true};revision(batch,v.revision);
  const lines=(await q.query("SELECT * FROM pcm.import_lines WHERE batch_id=$1 AND status='APPROVED' AND applied_at IS NULL ORDER BY sheet,source_row LIMIT 500 FOR UPDATE",[id])).rows;
  for(const line of lines){const values=validatedValues(line.kind,line.reviewed_values??line.proposed_values,true);const entityId=await apply(q,ctx,batch,line,values);await q.query('UPDATE pcm.import_lines SET applied_at=now(),applied_entity_id=$2 WHERE id=$1',[line.id,entityId]);}
  const counts=(await q.query("SELECT count(*) FILTER(WHERE status='PENDING')::int AS pending,count(*) FILTER(WHERE status='REJECTED')::int AS rejected,count(*) FILTER(WHERE status='APPROVED' AND applied_at IS NULL)::int AS approved,count(*) FILTER(WHERE applied_at IS NOT NULL)::int AS applied FROM pcm.import_lines WHERE batch_id=$1",[id])).rows[0];
  await q.query('UPDATE pcm.import_batches SET status=$2,revision=revision+1,confirmed_by=$3,confirmed_at=now() WHERE id=$1',[id,counts.pending||counts.approved?'PARTIAL':'CONFIRMED',actor.id]);await event(q,ctx,'import',id,'IMPORT_CONFIRMED',{...counts,applied_now:lines.length});return {...await detail(q,ctx,id),applied_now:lines.length};
 });}
 report(actor:PcmActor,id:string){return withContext(this.db,actor,'imports.preview',async(q,ctx)=>{requirePermission(ctx,'export');const b=await getBatch(q,ctx,id);const rows=(await q.query('SELECT sheet,source_row,kind,status,proposed_values,reviewed_values,issues,review_reason,applied_at FROM pcm.import_lines WHERE batch_id=$1 ORDER BY sheet,source_row',[id])).rows;const header=['arquivo','hash','data_referencia','versao_mapeamento','aba','linha','tipo','situacao','codigo','problemas','revisao','valores_revisados','aplicado_em'];return '\uFEFF'+[header,...rows.map(r=>{const reviewed={...(r.reviewed_values??{})};if(!ctx.permissions.includes('costs.read'))for(const key of ['unit_cost','source_value','material_value','labor_value','overhead_value'])delete reviewed[key];return [b.filename,b.file_hash,b.source_date??'',b.mapping_version,r.sheet,r.source_row,r.kind,r.status,r.proposed_values.code??'',r.issues.join(' | '),r.review_reason??'',JSON.stringify(reviewed),r.applied_at??''];})].map(row=>row.map(csvCell).join(';')).join('\r\n');});}
}
async function apply(q:Queryable,ctx:Context,batch:Row,line:Row,v:Record<string,any>):Promise<string>{
 const id=uid(),unit=batch.unit_id,ref=v.source_date??batch.source_date??null;
 if(line.kind==='CATALOG'){
  requirePermission(ctx,'materials.write');if(v.unit_cost!=null)requirePermission(ctx,'costs.write');
  let material=(await q.query('SELECT * FROM pcm.materials WHERE unit_id=$1 AND lower(code)=lower($2) FOR UPDATE',[unit,v.code.trim()])).rows[0];
  if(!material){material=(await q.query('INSERT INTO pcm.materials(id,unit_id,code,name,description,supplier,unit,minimum_quantity,safety_stock,unit_cost,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT DO NOTHING RETURNING *',[id,unit,v.code.trim(),v.name,v.narrative??null,v.supplier??null,v.unit,v.minimum_quantity??null,v.safety_stock??null,v.unit_cost??null,v.notes??null])).rows[0];if(!material)material=(await q.query('SELECT * FROM pcm.materials WHERE unit_id=$1 AND lower(code)=lower($2) FOR UPDATE',[unit,v.code.trim()])).rows[0];}
  const comparisons:[string,unknown][]=[['name',v.name],['unit',v.unit],['supplier',v.supplier],['minimum_quantity',v.minimum_quantity],['safety_stock',v.safety_stock],['unit_cost',v.unit_cost]];
  const differs=comparisons.some(([key,value])=>value!=null&&(numericFields.includes(key)?material[key]==null||!new Decimal(String(material[key])).eq(String(value)):String(material[key]??'')!==String(value)));
  if(differs){if(!v.overwrite_existing||!line.review_reason)throw new AppError(`Conflito no catálogo ${v.code}: revise os valores e autorize explicitamente a atualização.`,409);requirePermission(ctx,'materials.write');if(v.unit_cost!=null)requirePermission(ctx,'costs.write');
   await q.query('UPDATE pcm.materials SET name=$2,unit=$3,supplier=COALESCE($4,supplier),minimum_quantity=COALESCE($5,minimum_quantity),safety_stock=COALESCE($6,safety_stock),unit_cost=COALESCE($7,unit_cost),revision=revision+1,updated_at=now() WHERE id=$1',[material.id,v.name,v.unit,v.supplier??null,v.minimum_quantity??null,v.safety_stock??null,v.unit_cost??null]);await event(q,ctx,'material',material.id,'IMPORT_MATERIAL_RECONCILED',{line_id:line.id,reason:line.review_reason,previous:material});
  }
  if(v.asset_id){requirePermission(ctx,'materials.write');const asset=(await q.query('SELECT id FROM pcm.assets WHERE id=$1 AND unit_id=$2 FOR SHARE',[v.asset_id,unit])).rows[0];if(!asset)throw new AppError('Aplicação de material fora da unidade.');await q.query("INSERT INTO pcm.material_applications(id,unit_id,asset_id,material_id,position,expected_quantity) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(asset_id,material_id,position) DO NOTHING",[uid(),unit,v.asset_id,material.id,v.position??'',v.expected_quantity??null]);}
  return material.id;
 }
 if(line.kind==='STOCK'){await q.query('INSERT INTO pcm.stock_snapshots(id,unit_id,import_line_id,material_code,establishment,depot,normalized_depot,lot,unit,quantity,unit_cost,source_value,source_date) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',[id,unit,line.id,v.code,v.establishment??null,v.depot??null,v.depot?.toUpperCase()??null,v.lot??null,v.unit,v.quantity,v.unit_cost??null,v.source_value??null,ref]);return id;}
 if(['MOVEMENT','BAIXAS'].includes(line.kind)){await q.query('INSERT INTO pcm.imported_movements(id,unit_id,import_line_id,source_kind,material_code,quantity,unit,source_date,establishment,depot,lot,species,movement_type,document,request_number,cost_center,source_value,values) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb)',[id,unit,line.id,line.kind,v.code,v.quantity??null,v.unit??null,ref,v.establishment??null,v.depot??null,v.lot??null,v.species??null,v.movement_type??null,v.document??null,v.request_number??null,v.cost_center??null,v.source_value??null,JSON.stringify(v)]);return id;}
 if(line.kind==='PURCHASE'){await q.query('INSERT INTO pcm.purchase_lines(id,unit_id,import_line_id,material_code,purchase_order,order_number,quantity,unit,source_date,source_status,received_text,received_quantity,received_unit) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',[id,unit,line.id,v.code,v.purchase_order??null,v.order_number??null,v.quantity??null,v.unit??null,ref,v.status??null,v.received_text??null,v.received_quantity??null,v.received_unit??null]);return id;}
 throw new AppError('Tipo de linha não aplicável.');
}
