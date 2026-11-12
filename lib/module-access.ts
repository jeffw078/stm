import { z } from 'zod';
import type { Queryable } from './db';
import type { ModuleGrants } from './domain';

const accessSchema=z.object({level:z.enum(['ADMIN','USER']),sublevel:z.enum(['VIEWER','OPERATOR','MANAGER'])}).strict().refine(v=>v.level!=='ADMIN'||v.sublevel==='MANAGER','Administrador deve possuir subnível de gestão.');
export const grantsSchema=z.object({'5s':accessSchema.optional(),maintenance:accessSchema.optional()}).strict();
export const grantsSelect=`COALESCE((SELECT jsonb_object_agg(ma.module,jsonb_build_object('level',ma.level,'sublevel',ma.sublevel)) FROM sm5s.module_access ma WHERE ma.user_id=u.id),'{}'::jsonb) AS modules`;
export async function writeGrants(q:Queryable,userId:string,modules:ModuleGrants){
  await q.query('DELETE FROM sm5s.module_access WHERE user_id=$1',[userId]);
  for(const [module,access] of Object.entries(modules))if(access)await q.query('INSERT INTO sm5s.module_access(user_id,module,level,sublevel) VALUES($1,$2,$3,$4)',[userId,module,access.level,access.sublevel]);
}
