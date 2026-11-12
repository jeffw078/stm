import {NextRequest,NextResponse} from 'next/server';
import {cookies} from 'next/headers';
import {randomUUID,timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
import {Authentication} from '../../../lib/auth-service';
import {getDatabase} from '../../../lib/db';
import {COOKIE} from '../../../lib/auth';
import {AppError} from '../../../lib/domain';
import {tokenHash} from '../../../lib/security';
import {AccessService,csvCell} from './base';
import {CoreService} from './core-service';
import {PlanningService} from './planning-service';
import {ImportService} from './import-service';
import {privateStore} from './storage';
import {serializePcm} from './presentation';
import {pcmInfrastructureFailure} from './failures';

export const json=(value:unknown,status=200)=>NextResponse.json(serializePcm(value),{status,headers:{'Cache-Control':'private, no-store'}});
async function limitedBody(req:NextRequest,limit:number){
 if(Number(req.headers.get('content-length')??0)>limit)throw new AppError('Arquivo ou requisição acima do limite permitido.',413);
 const reader=req.body?.getReader();if(!reader)return Buffer.alloc(0);const chunks:Uint8Array[]=[];let size=0;
 while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>limit){await reader.cancel();throw new AppError('Arquivo ou requisição acima do limite permitido.',413);}chunks.push(part.value);}
 return Buffer.concat(chunks);
}
async function body(req:NextRequest){if(!req.headers.get('content-type')?.includes('application/json'))throw new AppError('Formato JSON esperado.',415);try{return JSON.parse((await limitedBody(req,1_000_000)).toString('utf8'));}catch(e){if(e instanceof AppError)throw e;throw new AppError('JSON inválido.');}}
async function upload(req:NextRequest){
 if(!req.headers.get('content-type')?.includes('multipart/form-data'))throw new AppError('Envie um arquivo.',415);
 const bytes=await limitedBody(req,20*1024*1024);const form=await new Response(new Uint8Array(bytes),{headers:{'Content-Type':req.headers.get('content-type')!}}).formData();
 const file=form.get('file');if(!(file instanceof File)||!file.size)throw new AppError('Selecione um arquivo.');
 let metadata:Record<string,any>;try{metadata=JSON.parse(String(form.get('metadata')??'{}'));}catch{throw new AppError('Dados do arquivo inválidos.');}
 return {file,metadata,bytes:Buffer.from(await file.arrayBuffer())};
}
function csvResponse(text:string,name:string){return new NextResponse('\uFEFF'+text,{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="${name}"`,'Cache-Control':'private, no-store'}});}
function jobAuthorized(req:NextRequest){const supplied=req.headers.get('authorization')??'';return [process.env.PCM_JOB_SECRET,process.env.CRON_SECRET].filter(Boolean).some(secret=>{const expected=Buffer.from('Bearer '+secret),actual=Buffer.from(supplied);return actual.length===expected.length&&timingSafeEqual(actual,expected);});}
export async function pcmRequest(req:NextRequest,ctx:{params:Promise<{path:string[]}>}){
 const requestId=randomUUID();try{
  const path=(await ctx.params).path,endpoint=path.join('/'),method=req.method;
  const db=getDatabase(),core=new CoreService(db),planning=new PlanningService(db),imports=new ImportService(db),access=new AccessService(db);
  if(endpoint==='jobs/run'&&['GET','POST'].includes(method)){if(!jobAuthorized(req))throw new AppError('Execução do agendador não autorizada.',401);return json(await planning.runJob(null));}
  if(method!=='GET'){
   const expected=process.env.APP_URL?new URL(process.env.APP_URL).origin:req.nextUrl.origin;
   if(req.headers.get('origin')!==expected)throw new AppError('Origem da requisição inválida.',403);
  }
  const token=(await cookies()).get(COOKIE)?.value,user=await new Authentication(db).getUser(token);
  if(!user)throw new AppError('Entre novamente para continuar.',401);
  if(user.must_change_password)throw new AppError('Altere a senha temporária para continuar.',428);
  const actor={...user,session:{hash:tokenHash(token!)}};
  const query=Object.fromEntries(req.nextUrl.searchParams.entries());
  if(endpoint==='context'&&method==='GET'){const c=await access.context(actor);return json({role:c.role,permissions:c.permissions,unitIds:c.unitIds,teamIds:c.teamIds,user:{id:user.id,name:user.name}});}
  if(endpoint==='catalog'&&method==='GET')return json(await core.catalog(actor));
  if(endpoint==='overview'&&method==='GET')return json(await core.overview(actor));
  if(endpoint==='notifications'&&method==='GET')return json(await core.notifications(actor));
  if(path[0]==='notifications'&&path.length===2&&method==='POST')return json(await core.markNotification(actor,path[1]));
  if(endpoint==='assets'&&method==='GET')return json(await core.assets(actor,query));
  if(endpoint==='assets'&&method==='POST')return json(await core.saveAsset(actor,await body(req)),201);
  if(endpoint==='assets/code-suggestion'&&method==='GET')return json(await core.suggestAssetCode(actor,z.string().min(1).parse(query.unit_id)));
  if(path[0]==='assets'&&path.length===2){if(method==='GET')return json(await core.asset(actor,path[1]));if(method==='POST')return json(await core.saveAsset(actor,await body(req),path[1]));}
  if(path[0]==='assets'&&path[2]==='move'&&method==='POST')return json(await core.moveAsset(actor,path[1],await body(req)));
  if(path[0]==='assets'&&path[2]==='history'&&method==='GET')return json(await core.assetHistory(actor,path[1],query));
  if(path[0]==='assets'&&path[2]==='qr'&&method==='GET'){
   await core.asset(actor,path[1]);const QRCode=await import('qrcode');const url=new URL('/pcm/ativos/'+encodeURIComponent(path[1]),process.env.APP_URL??req.nextUrl.origin).href;
   return new NextResponse(await QRCode.toString(url,{type:'svg',margin:2}),{headers:{'Content-Type':'image/svg+xml','Cache-Control':'private, no-store','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'"}});
  }
  if(endpoint==='requests'&&method==='GET')return json(await core.requests(actor,query));
  if(endpoint==='requests'&&method==='POST')return json(await core.createRequest(actor,await body(req)),201);
  if(path[0]==='requests'&&path.length===2&&method==='GET')return json(await core.request(actor,path[1]));
  if(path[0]==='requests'&&path[2]==='triage'&&method==='POST')return json(await core.triageRequest(actor,path[1],await body(req)));
  if(endpoint==='orders'&&method==='GET')return json(await core.orders(actor,query));
  if(endpoint==='orders'&&method==='POST')return json(await core.createOrder(actor,await body(req)),201);
  if(path[0]==='orders'&&path.length===2){if(method==='GET')return json(await core.order(actor,path[1]));if(method==='POST')return json(await core.updateOrder(actor,path[1],await body(req)));}
  if(path[0]==='orders'&&path[2]==='transition'&&method==='POST')return json(await core.transitionOrder(actor,path[1],await body(req)));
  if(path[0]==='orders'&&path[2]==='work'&&method==='POST')return json(await core.work(actor,path[1],await body(req)));
  if(path[0]==='orders'&&path[2]==='materials'&&method==='POST')return json(await core.applyMaterial(actor,path[1],await body(req)));
  if(endpoint==='comments'&&method==='POST')return json(await core.comment(actor,await body(req)),201);
  if(endpoint==='materials'&&method==='GET')return json(await core.materials(actor,query));
  if(endpoint==='materials'&&method==='POST')return json(await core.saveMaterial(actor,await body(req)),201);
  if(path[0]==='materials'&&path.length===2&&method==='POST')return json(await core.saveMaterial(actor,await body(req),path[1]));
  if(endpoint==='applications'&&method==='POST')return json(await core.linkMaterial(actor,await body(req)),201);
  if(endpoint==='documents'&&method==='GET')return json(await core.documents(actor,query));
  if(endpoint==='documents'&&method==='POST'){const u=await upload(req);return json(await core.addDocument(actor,{...u.metadata,filename:u.file.name,mime_type:u.file.type},u.bytes),201);}
  if(path[0]==='documents'&&path.length===2&&method==='GET'){
   const d=await core.document(actor,path[1]);if(d.external_url)return json({external_url:d.external_url});
   const bytes=await privateStore().get(d.storage_key),name=String(d.filename??'documento').replace(/[\r\n"\\/]/g,'_');
   return new NextResponse(new Uint8Array(bytes),{headers:{'Content-Type':d.mime_type,'Content-Length':String(bytes.length),'Content-Disposition':`${req.nextUrl.searchParams.get('download')==='1'?'attachment':'inline'}; filename="documento"; filename*=UTF-8''${encodeURIComponent(name)}`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
  }
  if(endpoint==='plans'&&method==='GET')return json(await planning.plans(actor,query));
  if(endpoint==='plans'&&method==='POST')return json(await planning.savePlan(actor,await body(req)),201);
  if(path[0]==='plans'&&path.length===2){if(method==='GET')return json(await planning.plan(actor,path[1]));if(method==='POST')return json(await planning.savePlan(actor,await body(req),path[1]));}
  if(path[0]==='plans'&&path[2]==='active'&&method==='POST')return json(await planning.setPlanActive(actor,path[1],await body(req)));
  if(endpoint==='agenda'&&method==='GET')return json(await planning.agenda(actor,query));
  if(endpoint==='job-runs'&&method==='GET')return json(await planning.jobRuns(actor,query));
  if(path[0]==='occurrences'&&path[2]==='reschedule'&&method==='POST')return json(await planning.reschedule(actor,path[1],await body(req)));
  if(endpoint==='failures'&&method==='POST')return json(await planning.failure(actor,await body(req)),201);
  if(endpoint==='failures'&&method==='GET')return json(await planning.failures(actor,query));
  if(path[0]==='failures'&&path.length===2&&method==='POST')return json(await planning.failure(actor,await body(req),path[1]));
  if(endpoint==='calendars'&&method==='POST')return json(await planning.saveCalendar(actor,await body(req)),201);
  if(endpoint==='exposures'&&method==='POST')return json(await planning.recordExposure(actor,await body(req)),201);
  if(endpoint==='capacity'&&method==='POST')return json(await planning.saveCapacity(actor,await body(req)));
  if(endpoint==='indicators'&&method==='GET')return json(await planning.indicators(actor,query));
  if(endpoint==='imports'&&method==='GET')return json(await imports.batches(actor,query));
  if(path[0]==='references'&&path.length===2&&method==='GET'){
   const kind=z.enum(['stock','purchases','movements']).parse(path[1]);return json(await imports.references(actor,kind,query));
  }
  if(endpoint==='imports/preview'&&method==='POST'){const u=await upload(req);return json(await imports.preview(actor,{...u.metadata,filename:u.file.name},u.bytes),201);}
  if(path[0]==='imports'&&path.length===2&&method==='GET')return json(await imports.batch(actor,path[1],query));
  if(path[0]==='imports'&&path[2]==='review'&&method==='POST')return json(await imports.review(actor,path[1],await body(req)));
  if(path[0]==='imports'&&path[2]==='confirm'&&method==='POST')return json(await imports.confirm(actor,path[1],await body(req)));
  if(path[0]==='imports'&&path[2]==='report'&&method==='GET'){const report=await imports.report(actor,path[1]);return csvResponse(typeof report==='string'?report:JSON.stringify(report),'pcm-importacao.csv');}
  if(endpoint==='members'&&method==='GET')return json(await access.members(actor));
  if(endpoint==='members'&&method==='POST')return json(await access.saveMember(actor,await body(req)));
  if(endpoint==='settings'&&method==='GET')return json(await access.settings(actor));
  if(endpoint==='settings'&&method==='POST')return json(await access.saveSettings(actor,await body(req)));
  if(endpoint==='teams'&&method==='POST')return json(await access.saveTeam(actor,await body(req)),201);
  if(endpoint==='export'&&method==='GET'){
   await withExportPermission(access,actor);const data=await core.orders(actor,{...query,page:'1',pageSize:'100'});
   if(data.total>5000)throw new AppError('A exportação admite até 5.000 ordens. Restrinja o período ou os filtros e tente novamente.',400);
   const rows=[...data.rows];for(let page=2;(page-1)*100<data.total;page++)rows.push(...(await core.orders(actor,{...query,page:String(page),pageSize:'100'})).rows);
   const text=[['Número','Tipo','Status','Descrição','Prazo','Responsável'],...rows.map((r:any)=>[r.number,r.type,r.status,r.description,r.due_at,r.assignee_name])].map(r=>r.map(csvCell).join(';')).join('\r\n');return csvResponse(text,'pcm-ordens.csv');
  }
  throw new AppError('Recurso PCM não encontrado.',404);
 }catch(e){
  if(e instanceof AppError)return json({error:e.message,requestId},e.status);
  if(e instanceof z.ZodError)return json({error:'Confira os campos. '+(e.issues[0]?.message??''),fields:e.issues.map(i=>({path:i.path.join('.'),message:i.message})),requestId},400);
  const code=(e as any)?.code;
  if(code==='23505')return json({error:'Já existe um registro com este código ou vínculo.',requestId},409);
  if(['23503','23514','P0001'].includes(code))return json({error:'Associação incompatível, ciclo ou dado inválido. Confira os campos e a unidade.',requestId},400);
  console.error('PCM_REQUEST_FAILED',{requestId,code:code??'INTERNAL'});
  const failure=pcmInfrastructureFailure(e,requestId);return json(failure.body,failure.status);
 }
}
async function withExportPermission(access:AccessService,actor:any){const ctx=await access.context(actor);if(!ctx.permissions.includes('export'))throw new AppError('Exportação não autorizada.',403);}
