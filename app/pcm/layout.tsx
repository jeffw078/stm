import {currentUser} from '@/lib/auth';
import {Shell} from '@/components/shell';
import {UnsavedProvider} from '@/components/unsaved-guard';
export const dynamic='force-dynamic';
export default async function Layout({children}:{children:React.ReactNode}){
 const user=await currentUser();
 // Pages authorize and preserve the requested destination before returning any data.
 if(!user||user.must_change_password)return <>{children}</>;
 return <UnsavedProvider><Shell user={user}>{children}</Shell></UnsavedProvider>;
}
