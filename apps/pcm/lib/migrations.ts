import {readdirSync,readFileSync} from 'node:fs';
import type {Database} from '../../../lib/db';

export async function migratePcm(db:Database){
 await db.query('CREATE SCHEMA IF NOT EXISTS pcm');
 await db.query('CREATE TABLE IF NOT EXISTS pcm.schema_migrations(version text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())');
 return db.transaction(async q=>{
  await q.query('LOCK TABLE pcm.schema_migrations IN EXCLUSIVE MODE');
  const applied=new Set((await q.query('SELECT version FROM pcm.schema_migrations')).rows.map(r=>r.version));
  const completed:string[]=[];
  for(const file of readdirSync('apps/pcm/migrations').filter(n=>n.endsWith('.sql')).sort()){
   const version=file.split('_')[0];if(applied.has(version))continue;
   await q.query(readFileSync('apps/pcm/migrations/'+file,'utf8'));
   await q.query('INSERT INTO pcm.schema_migrations(version) VALUES($1) ON CONFLICT DO NOTHING',[version]);
   completed.push(version);
  }
  return completed;
 });
}
