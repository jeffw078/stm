import { AuditDetail } from '@/components/audit-detail';
import { requireModuleUser } from '@/lib/auth';
export default async function Page({params}:{params:Promise<{id:string}>}){const [user,{id}]=await Promise.all([requireModuleUser('5s'),params]);return <AuditDetail id={id} user={user}/>;}
