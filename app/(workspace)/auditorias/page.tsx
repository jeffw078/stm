import { requireModuleUser } from '@/lib/auth';
import { Audits } from '@/components/audits';
export default async function Page(){return <Audits user={await requireModuleUser('5s')}/>;}
