import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { verifyPassword,hashPassword } from '../lib/security';

const sql=(name:string)=>readFileSync('migrations/'+name,'utf8');
test('migrações preservam 5S e provisionam Michelli sem restaurar acessos revogados',async()=>{
  const pg=new PGlite();try{
    await pg.exec(sql('001_initial.sql'));
    await pg.query("INSERT INTO sm5s.users(id,email,name,role,password_hash,must_change_password) VALUES('admin','admin@test.local','Admin','ADMIN','original-admin',false),('auditor','auditor@test.local','Auditor','AUDITOR','original-auditor',false)");
    await pg.exec(sql('003_module_access.sql'));await pg.exec(sql('004_maintenance_admin.sql'));
    const grants=(await pg.query('SELECT * FROM sm5s.module_access ORDER BY user_id')).rows as any[];
    assert.deepEqual(grants.find(g=>g.user_id==='admin'),{user_id:'admin',module:'5s',level:'ADMIN',sublevel:'MANAGER'});
    assert.deepEqual(grants.find(g=>g.user_id==='auditor'),{user_id:'auditor',module:'5s',level:'USER',sublevel:'OPERATOR'});
    const user=(await pg.query("SELECT * FROM sm5s.users WHERE email='michelli.rudnik@steelmast.com.br'")).rows[0] as any;
    assert.equal(user.role,'USER');assert.equal(user.must_change_password,true);
    assert.equal(await verifyPassword('manut123',user.password_hash),true);
    assert.ok(new Date(user.temporary_expires_at).getTime()>Date.now()+71*3600*1000);
    assert.deepEqual(grants.filter(g=>g.user_id===user.id),[{user_id:user.id,module:'maintenance',level:'ADMIN',sublevel:'MANAGER'}]);
    await pg.query('DELETE FROM sm5s.module_access');
    await pg.query("UPDATE sm5s.users SET password_hash='changed',must_change_password=false WHERE id=$1",[user.id]);
    await pg.exec(sql('003_module_access.sql'));await pg.exec(sql('004_maintenance_admin.sql'));
    assert.equal((await pg.query('SELECT * FROM sm5s.module_access')).rows.length,0);
    assert.equal((await pg.query<{password_hash:string}>('SELECT password_hash FROM sm5s.users WHERE id=$1',[user.id])).rows[0].password_hash,'changed');
    assert.equal((await pg.query<{password_hash:string}>("SELECT password_hash FROM sm5s.users WHERE id='admin'")).rows[0].password_hash,'original-admin');
  }finally{await pg.close();}
});
test('provisionamento de manutenção preserva senha e permissões de e-mail existente',async()=>{
  const pg=new PGlite();try{
    await pg.exec(sql('001_initial.sql'));
    const hash=await hashPassword('SenhaExistenteSegura123!');
    await pg.query("INSERT INTO sm5s.users(id,email,name,role,password_hash,must_change_password) VALUES('existing','michelli.rudnik@steelmast.com.br','Michelli','AUDITOR',$1,false)",[hash]);
    await pg.exec(sql('003_module_access.sql'));await pg.exec(sql('004_maintenance_admin.sql'));
    const user=(await pg.query<{password_hash:string;must_change_password:boolean;role:string}>("SELECT * FROM sm5s.users WHERE id='existing'")).rows[0];
    assert.equal(user.password_hash,hash);assert.equal(user.must_change_password,false);assert.equal(user.role,'AUDITOR');
    assert.equal((await pg.query("SELECT * FROM sm5s.module_access WHERE user_id='existing'")).rows.length,2);
  }finally{await pg.close();}
});
