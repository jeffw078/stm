import { Pool } from 'pg';
export type Row=Record<string,any>;
export interface Queryable {query<T extends Row=Row>(text:string,values?:unknown[]):Promise<{rows:T[];rowCount?:number|null}>;}
export interface Database extends Queryable{transaction<T>(fn:(q:Queryable)=>Promise<T>):Promise<T>;}
let pool:Pool|undefined;
export function getDatabase():Database{
  if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL não configurada no servidor.');
  // PGlite's preview socket multiplexes a single backend. Keep complete transactions
  // on one client there; production PostgreSQL retains the normal pool.
  const localPreview=process.env.NODE_ENV!=='production'&&process.env.SM5S_LOCAL_PREVIEW==='1';
  pool??=new Pool({connectionString:process.env.DATABASE_URL,max:localPreview?1:3,idleTimeoutMillis:10000,connectionTimeoutMillis:15000});
  const p=pool;
  return {query:(text,values)=>p.query(text,values),transaction:async fn=>{
    const c=await p.connect();
    try{await c.query('BEGIN');const result=await fn(c);await c.query('COMMIT');return result;}
    catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  }};
}
export async function closeDatabase(){if(pool){await pool.end();pool=undefined;}}
