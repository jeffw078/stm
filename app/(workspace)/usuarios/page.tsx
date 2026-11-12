import { requireUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { UserAdministration } from '@/components/user-administration';
export default async function Page(){if((await requireUser()).role!=='MASTER')redirect('/');return <UserAdministration/>;}
