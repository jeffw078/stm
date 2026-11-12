import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync,readdirSync} from 'node:fs';
import type {Database} from '../../../lib/db';
import {migratePcm} from '../lib/migrations';

test('migrações PCM repetidas preservam dados e só aplicam versões pendentes',async()=>{
 const pg=new PGlite();try{
  for(const file of readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())await pg.exec(readFileSync('migrations/'+file,'utf8'));
  const db:Database={query:(s,v)=>pg.query(s,v) as any,transaction:fn=>pg.transaction(tx=>fn({query:async(s,v)=>v?tx.query(s,v) as any:(await tx.exec(s)).at(-1) as any}))};
  // The 5S schema can already exist while the maintenance catalog is unavailable.
  await assert.rejects(db.query('SELECT id FROM pcm.teams'),{code:'42P01'});
  assert.deepEqual(await migratePcm(db),['001','010','020','030','040']);
  assert.deepEqual((await db.query('SELECT id FROM pcm.teams')).rows,[]);
  await db.query("INSERT INTO pcm.audit_events(id,entity_kind,entity_id,action) VALUES('test-retained','test','1','TEST')");
  assert.deepEqual(await migratePcm(db),[]);
  assert.equal((await db.query("SELECT count(*)::int n FROM pcm.audit_events WHERE id='test-retained'")).rows[0].n,1);
  assert.equal((await db.query('SELECT count(*)::int n FROM pcm.schema_migrations')).rows[0].n,5);
 }finally{await pg.close();}
});
