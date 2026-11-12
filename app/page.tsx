import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
export const dynamic='force-dynamic';
export default async function Page(){const u=await currentUser();redirect(!u?'/login':u.must_change_password?'/trocar-senha':'/modulos');}
