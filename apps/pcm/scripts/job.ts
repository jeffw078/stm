import {loadEnvConfig} from '@next/env';
import {getDatabase,closeDatabase} from '../../../lib/db';
import {PlanningService} from '../lib/planning-service';
loadEnvConfig(process.cwd());
new PlanningService(getDatabase()).runJob(null).then(result=>console.log(JSON.stringify(result))).catch(e=>{console.error('Job PCM não concluído:',e.code??e.name);process.exitCode=1;}).finally(closeDatabase);
