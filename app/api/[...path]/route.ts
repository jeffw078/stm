import { NextRequest,NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { getDatabase } from '@/lib/db';
import { Authentication } from '@/lib/auth-service';
import { Service,type Filters } from '@/lib/service';
import { EvidenceService } from '@/lib/evidence-service';
import { AppError,requireMaster,requireManager } from '@/lib/domain';
import { parseHistory } from '@/lib/history-import';
import { COOKIE } from '@/lib/auth';
import { tokenHash } from '@/lib/security';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const filters=(req:NextRequest):Filters=>Object.fromEntries(['from','to','unit','sector','sense','status','search'].map(k=>[k,req.nextUrl.searchParams.get(k)||undefined]));
async function run(req:NextRequest,ctx:{params:Promise<{path:string[]}>}){
  try{
    const path=(await ctx.params).path;const endpoint=path.join('/');const mutation=req.method!=='GET';
    if(mutation){
      const origin=req.headers.get('origin');const expected=process.env.APP_URL?new URL(process.env.APP_URL).origin:req.nextUrl.origin;
      if(!origin||origin!==expected)throw new AppError('Origem da requisição inválida.',403);
      if(Number(req.headers.get('content-length')??0)>3_500_000)throw new AppError('Arquivo ou requisição muito grande.',413);
    }
    const db=getDatabase();const auth=new Authentication(db);const service=new Service(db);const evidence=new EvidenceService(db);
    const jar=await cookies();const token=jar.get(COOKIE)?.value;
    const setSession=(session:{token:string;maxAge:number})=>jar.set(COOKIE,session.token,{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',path:'/',maxAge:session.maxAge});
    const body=async()=>{
      if(!req.headers.get('content-type')?.includes('application/json'))throw new AppError('Formato JSON esperado.',415);
      const text=await req.text();if(Buffer.byteLength(text)>3_000_000)throw new AppError('Requisição muito grande.',413);
      try{return JSON.parse(text);}catch{throw new AppError('JSON inválido.');}
    };
    if(endpoint==='auth/login'&&req.method==='POST'){
      const v=z.object({email:z.email().max(254),password:z.string().min(1).max(128)}).parse(await body());
      const result=await auth.login(v.email,v.password,req.headers.get('x-vercel-forwarded-for')?.split(',')[0]??req.headers.get('x-forwarded-for')?.split(',')[0]??'unknown');
      setSession(result);return json({mustChangePassword:result.mustChangePassword});
    }
    if(endpoint==='auth/logout'&&req.method==='POST'){
      if(token)await auth.logout(token);jar.delete(COOKIE);return json({ok:true});
    }
    const user=await auth.getUser(token);if(!user)throw new AppError('Entre novamente para continuar.',401);
    if(endpoint==='auth/change-password'&&req.method==='POST'){
      const v=z.object({currentPassword:z.string().max(128),password:z.string().max(128)}).parse(await body());
      const result=await auth.changePassword(token!,v.currentPassword,v.password);setSession(result);return json({ok:true});
    }
    const actor={...user,session:{hash:tokenHash(token!)}};
    if(user.must_change_password)throw new AppError('Altere a senha temporária para continuar.',428);
    if(endpoint==='me'&&req.method==='GET')return json(user);
    if(endpoint==='users'&&req.method==='GET')return json(await service.listUsers(user));
    if(path[0]==='users'&&path.length===3&&path[2]==='access'&&req.method==='POST')return json(await service.setUserAccess(actor,path[1],await body()));
    if(endpoint==='catalog'&&req.method==='GET')return json(await service.catalog(user));
    if(endpoint==='dashboard'&&req.method==='GET')return json(await service.dashboard(user,filters(req)));
    if(endpoint==='audits'&&req.method==='GET')return json(await service.listAudits(user,filters(req)));
    if(endpoint==='audits'&&req.method==='POST')return json(await service.createAudit(actor,await body()),201);
    if(path[0]==='audits'&&path.length===2&&req.method==='GET')return json(await service.getAudit(user,path[1]));
    if(path[0]==='audits'&&path[2]==='answers'&&req.method==='POST')return json(await service.saveAnswers(actor,path[1],await body()));
    if(path[0]==='audits'&&path[2]==='transition'&&req.method==='POST'){
      const v=z.object({revision:z.number().int().positive(),to:z.enum(['REVIEW','IN_PROGRESS','FINALIZED']),reason:z.string().max(5000).default('')}).parse(await body());
      return json(await service.transition(actor,path[1],v.revision,v.to,v.reason));
    }
    if(path[0]==='audits'&&path[2]==='evidence'&&req.method==='POST'){
      if(!req.headers.get('content-type')?.includes('multipart/form-data'))throw new AppError('Envie uma foto.');
      const form=await req.formData();const file=form.get('file');if(!(file instanceof File)||file.size>460800)throw new AppError('Compacte a foto para até 450 KiB.');
      return json(await evidence.add(actor,path[1],Number(form.get('sense')),Buffer.from(await file.arrayBuffer()),String(form.get('description')??'').slice(0,501)),201);
    }
    if(path[0]==='evidence'&&path.length===2){
      if(req.method==='DELETE')return json(await evidence.remove(actor,path[1]));
      if(req.method==='GET'){const e=await evidence.read(user,path[1]);return new NextResponse(new Uint8Array(e.data),{headers:{'Content-Type':e.mime_type,'Content-Length':String(e.size),'Cache-Control':'private, no-store','Content-Disposition':'inline; filename="evidencia.webp"','X-Content-Type-Options':'nosniff'}});}
    }
    if(endpoint==='imports/preview'&&req.method==='POST'){requireMaster(user);const v=z.object({text:z.string().max(3_000_000)}).parse(await body());return json(parseHistory(v.text));}
    if(endpoint==='imports/commit'&&req.method==='POST'){requireMaster(user);const v=z.object({text:z.string().max(3_000_000),validOnly:z.boolean()}).parse(await body());return json(await service.importHistory(actor,v.text,v.validOnly));}
    if(endpoint==='users'&&req.method==='POST')return json(await service.createUser(actor,await body()),201);
    if(path[0]==='users'&&path[2]==='reset'&&req.method==='POST'){const v=z.object({password:z.string()}).parse(await body());return json(await service.resetPassword(actor,path[1],v.password));}
    if(path[0]==='users'&&path[2]==='active'&&req.method==='POST'){const v=z.object({active:z.boolean()}).parse(await body());return json(await service.setUserActive(actor,path[1],v.active));}
    if(endpoint==='units'&&req.method==='POST'){const v=z.object({name:z.string()}).parse(await body());return json(await service.createUnit(actor,v.name),201);}
    if(endpoint==='sectors'&&req.method==='POST'){const v=z.object({name:z.string(),unitId:z.string()}).parse(await body());return json(await service.createSector(actor,v.unitId,v.name),201);}
    if(['units','sectors'].includes(path[0])&&path.length===2&&req.method==='POST'){const v=z.object({active:z.boolean()}).parse(await body());return json(await service.setCatalogActive(actor,path[0]==='units'?'unit':'sector',path[1],v.active));}
    if(endpoint==='export'&&req.method==='GET'){
      requireManager(user);const rows=await service.listAudits(user,filters(req));
      const csv=(v:unknown)=>{let s=String(v??'');if(/^[=+\-@\t\r]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
      const data=[['Data','Unidade','Setor','Auditor','Etapa','Origem','Pontuação'],...rows.map(a=>[a.date,a.unit,a.sector,a.auditor_name,a.status,a.source,a.overall])].map(r=>r.map(csv).join(';')).join('\r\n');
      return new NextResponse('\uFEFF'+data,{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="auditorias-5s.csv"','Cache-Control':'private, no-store'}});
    }
    throw new AppError('Recurso não encontrado.',404);
  }catch(err){
    if(err instanceof AppError)return json({error:err.message},err.status);
    if(err instanceof z.ZodError)return json({error:'Confira os campos informados. '+(err.issues[0]?.message??'')},400);
    const code=(err as {code?:string})?.code;
    if(code==='23505')return json({error:'Já existe um registro com estes dados (ou auditoria para este setor e data).'},409);
    if(code==='23503')return json({error:'O registro relacionado não está disponível.'},400);
    console.error('SM5S_REQUEST_FAILED',{code:code??'INTERNAL'});
    return json({error:'Não foi possível concluir. Verifique a configuração e a conexão com o banco no servidor.'},503);
  }
}
function json(value:unknown,status=200){return NextResponse.json(value,{status,headers:{'Cache-Control':'private, no-store'}});}
export {run as GET,run as POST,run as DELETE};
