import { AuthForm } from '@/components/auth-form';
import { currentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import {safeReturnTo} from '@/lib/return-to';
export const dynamic='force-dynamic';
export default async function Page({searchParams}:{searchParams:Promise<{next?:string}>}){const next=safeReturnTo((await searchParams).next),u=await currentUser();if(!u)redirect('/login'+(next==='/modulos'?'':'?next='+encodeURIComponent(next)));return <AuthForm change forced={u.must_change_password}/>;}
