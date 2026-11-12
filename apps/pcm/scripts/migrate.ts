import {loadEnvConfig} from '@next/env';
import {getDatabase,closeDatabase} from '../../../lib/db';
import {migratePcm} from '../lib/migrations';
loadEnvConfig(process.cwd());
async function main(){
 const db=getDatabase();
 const versions=await migratePcm(db);
 console.log('Migrações PCM aplicadas:',versions.length?versions.join(', '):'nenhuma pendente');
}
main().catch(e=>{console.error('Migração PCM não concluída:',e.code??e.name);process.exitCode=1;}).finally(closeDatabase);
