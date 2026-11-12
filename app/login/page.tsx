import { AuthForm } from '@/components/auth-form';
import { currentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import {safeReturnTo} from '@/lib/return-to';
export const dynamic='force-dynamic';
export default async function Page({searchParams}:{searchParams:Promise<{next?:string}>}){const next=safeReturnTo((await searchParams).next),user=await currentUser();if(user)redirect(user.must_change_password?'/trocar-senha'+(next==='/modulos'?'':'?next='+encodeURIComponent(next)):next);return <AuthForm/>;}
