import { requireModuleUser } from '@/lib/auth';
import { canViewDashboard,isManager } from '@/lib/domain';
import { redirect } from 'next/navigation';
import { Dashboard } from '@/components/dashboard';
export default async function Page(){const u=await requireModuleUser('5s');if(!canViewDashboard(u))redirect('/auditorias');return <Dashboard manager={isManager(u)}/>;}
