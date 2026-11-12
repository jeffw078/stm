/** Local QA only. Production always uses DATABASE_URL and npm run start. */
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { spawn } from 'node:child_process';
import { mkdirSync,readFileSync,writeFileSync,appendFileSync,readdirSync } from 'node:fs';
import { randomUUID,randomBytes } from 'node:crypto';
import { createServer,request } from 'node:http';
import { hashPassword } from '../lib/security';
import { Service } from '../lib/service';
import { Authentication } from '../lib/auth-service';
import type { Database } from '../lib/db';
async function main(){
  if(process.env.VERCEL)throw new Error('Local preview is unavailable on Vercel.');
  const pg=new PGlite();await pg.exec(readFileSync('migrations/001_initial.sql','utf8'));
  const db:Database={query:(s,v)=>pg.query(s,v) as any,transaction:fn=>pg.transaction(tx=>fn({query:(s,v)=>tx.query(s,v) as any}))};
  const password=randomBytes(18).toString('base64url')+'A1!';const hash=await hashPassword(password);
  const master={id:randomUUID(),role:'MASTER',email:'master@preview.local'},auditor={id:randomUUID(),role:'AUDITOR',email:'auditor@preview.local'};
  for(const u of [master,auditor])await pg.query('INSERT INTO sm5s.users(id,email,name,role,password_hash,must_change_password) VALUES($1,$2,$3,$4,$5,false)',[u.id,u.email,u.role==='MASTER'?'Jefferson Willian':'Auditor de teste',u.role,hash]);
  for(const name of readdirSync('migrations').filter(n=>n.endsWith('.sql')&&n!=='001_initial.sql'&&(!process.env.PCM_PREVIEW||n!=='004_maintenance_admin.sql')).sort())await pg.exec(readFileSync('migrations/'+name,'utf8'));
  const maintenance={id:randomUUID(),email:'maintenance@preview.local'};
  await pg.query("INSERT INTO sm5s.users(id,email,name,role,password_hash,must_change_password) VALUES($1,$2,'Admin de Manutenção','USER',$3,false)",[maintenance.id,maintenance.email,hash]);
  await pg.query("INSERT INTO sm5s.module_access(user_id,module,level,sublevel) VALUES($1,'maintenance','ADMIN','MANAGER')",[maintenance.id]);
  const service=new Service(db);const imported=await service.importHistory(master,readFileSync('data/historico-original.tsv','utf8'),true);
  const sector=(await db.query("SELECT s.id FROM sm5s.sectors s WHERE s.normalized_name='qualidade' LIMIT 1")).rows[0];
  const audit=await service.createAudit(master,{sectorId:sector.id,date:'2026-11-06',auditorId:auditor.id,notes:'Avaliar as condições do setor e registrar as oportunidades de melhoria.'});
  const auth=new Authentication(db);
  const sessions={master:await auth.login(master.email,password,'qa-master'),auditor:await auth.login(auditor.email,password,'qa-auditor'),maintenance:await auth.login(maintenance.email,password,'qa-maintenance')};
  mkdirSync('data/private',{recursive:true});writeFileSync('data/private/preview-access.json',JSON.stringify({master:master.email,auditor:auditor.email,auditId:audit.id,imported}),{mode:0o600});
  for(const name of readdirSync('apps/pcm/migrations').filter(n=>n.endsWith('.sql')).sort())await pg.exec(readFileSync('apps/pcm/migrations/'+name,'utf8'));
  const server=new PGLiteSocketServer({db:pg,host:'127.0.0.1',port:5439,maxConnections:10});await server.start();
  const args=process.argv.slice(2),pi=args.indexOf('--port'),port=pi>=0?args[pi+1]:(process.env.PORT??'3000');
  const internalPort=Number(port)+1;
  // The preview proxy supplies a disposable QA session. No production route or auth bypass is added.
  const proxy=createServer((req,res)=>{
    appendFileSync('data/private/preview-debug.log','REQUEST '+req.method+' '+req.url+'\n');
    if(req.url==='/__qa/master'||req.url==='/__qa/auditor'||req.url==='/__qa/maintenance'){
      const who=req.url.endsWith('maintenance')?'maintenance':req.url.endsWith('auditor')?'auditor':'master';
      res.writeHead(302,{'Set-Cookie':`sm5s_session=${sessions[who].token}; HttpOnly; SameSite=Lax; Path=/`,'Location':'/'});res.end();return;
    }
    const cookie=req.headers.cookie??'';
    const qaCookie=cookie.includes('sm5s_session=')?cookie:`${cookie}; sm5s_session=${sessions.master.token}`;
    const upstream=request({host:'127.0.0.1',port:internalPort,path:req.url,method:req.method,headers:{...req.headers,cookie:qaCookie}},response=>{
      appendFileSync('data/private/preview-debug.log','RESPONSE '+req.url+' '+response.statusCode+'\n');
      res.writeHead(response.statusCode??502,response.headers);response.pipe(res);
    });
    upstream.on('error',()=>{res.writeHead(503);res.end('Preparando a prévia local…');});req.pipe(upstream);
  });
  proxy.on('upgrade',(req,socket,head)=>{socket.on('error',()=>socket.destroy());const upstream=request({host:'127.0.0.1',port:internalPort,path:req.url,headers:req.headers});upstream.on('upgrade',(resp,target,body)=>{target.on('error',()=>{target.destroy();socket.destroy();});socket.write('HTTP/1.1 101 Switching Protocols\r\n'+Object.entries(resp.headers).map(([k,v])=>`${k}: ${v}`).join('\r\n')+'\r\n\r\n');target.write(head);socket.write(body);target.pipe(socket);socket.pipe(target);});upstream.on('error',()=>socket.destroy());upstream.end();});
  proxy.listen(Number(port),'0.0.0.0');
  console.log(`Prévia local de testes: http://127.0.0.1:${port}`);
  const child=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','--webpack','--hostname','127.0.0.1','--port',String(internalPort)],{stdio:'inherit',env:{...process.env,SM5S_LOCAL_PREVIEW:'1',DATABASE_URL:'postgresql://postgres:postgres@127.0.0.1:5439/postgres',APP_URL:process.env.QA_APP_URL??`http://127.0.0.1:${port}`}});
  let closing=false;
  const shutdown=async()=>{if(closing)return;closing=true;child.kill('SIGTERM');proxy.close();await server.stop();await pg.close();process.exit(0);};
  process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);child.on('exit',()=>shutdown());
}
main().catch(e=>{console.error('Local preview failed:',e.code??e.message);process.exitCode=1;});
