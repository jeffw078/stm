import {PGlite} from '@electric-sql/pglite';
import {readFileSync,readdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import type {Database} from '../../../lib/db';

export async function fixture(){
 const pg=new PGlite();
 for(const file of readdirSync('migrations').filter(n=>n.endsWith('.sql')).sort())await pg.exec(readFileSync('migrations/'+file,'utf8'));
 for(const file of readdirSync('apps/pcm/migrations').filter(n=>n.endsWith('.sql')).sort())await pg.exec(readFileSync('apps/pcm/migrations/'+file,'utf8'));
 const db:Database={query:(s,v)=>pg.query(s,v) as any,transaction:fn=>pg.transaction(tx=>fn({query:(s,v)=>tx.query(s,v) as any}))};
 const master={id:randomUUID(),role:'MASTER',name:'Master sintético',auth_version:1};
 const admin={id:randomUUID(),role:'USER',name:'Gestor sintético',auth_version:1};
 const requester={id:randomUUID(),role:'USER',name:'Solicitante sintético',auth_version:1};
 const technician={id:randomUUID(),role:'USER',name:'Técnico sintético',auth_version:1};
 const outsider={id:randomUUID(),role:'USER',name:'Outra unidade',auth_version:1};
 const auditor={id:randomUUID(),role:'AUDITOR',name:'Auditor 5S',auth_version:1};
 for(const user of [master,admin,requester,technician,outsider,auditor])await db.query('INSERT INTO sm5s.users(id,email,name,role,password_hash,must_change_password) VALUES($1,$2,$3,$4,$5,false)',[user.id,user.id+'@pcm.test',user.name,user.role,'not-a-login-hash']);
 const unit={id:randomUUID(),name:'Unidade sintética'},otherUnit={id:randomUUID(),name:'Outra unidade sintética'};
 for(const u of [unit,otherUnit])await db.query('INSERT INTO sm5s.units(id,name,normalized_name) VALUES($1,$2,$3)',[u.id,u.name,u.id]);
 for(const u of [admin,requester,technician,outsider])await db.query("INSERT INTO sm5s.module_access(user_id,module,level,sublevel) VALUES($1,'maintenance',$2,$3)",[u.id,u.id===admin.id?'ADMIN':'USER',u.id===admin.id?'MANAGER':'OPERATOR']);
 for(const [user,role,units] of [[requester,'REQUESTER',[unit.id]],[technician,'TECHNICIAN',[unit.id]],[outsider,'TECHNICIAN',[otherUnit.id]]] as const)await db.query('INSERT INTO pcm.memberships(user_id,role,unit_ids) VALUES($1,$2,$3)',[user.id,role,units]);
 await db.query("INSERT INTO sm5s.module_access(user_id,module,level,sublevel) VALUES($1,'5s','USER','OPERATOR')",[auditor.id]);
 return {pg,db,master,admin,requester,technician,outsider,auditor,unit,otherUnit};
}
