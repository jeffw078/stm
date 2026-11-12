import {redirect,notFound} from 'next/navigation';
import {currentUser} from '@/lib/auth';
import {moduleAccess} from '@/lib/domain';
import {getDatabase} from '@/lib/db';
import {AccessService} from '@/apps/pcm/lib/base';
import {PcmPage} from '@/apps/pcm/components/page';
export const dynamic='force-dynamic';
const sections=['ativos','solicitacoes','ordens','preventivas','agenda','materiais','indicadores','importacoes','configuracoes'];
export default async function Page({params}:{params:Promise<{path?:string[]}>}){
 const {path=[]}=await params;if(path.length>2||path[0]&&!sections.includes(path[0]))notFound();
 const target='/pcm'+(path.length?'/'+path.map(encodeURIComponent).join('/'):'');const user=await currentUser();
 if(!user)redirect('/login?next='+encodeURIComponent(target));
 if(user.must_change_password)redirect('/trocar-senha?next='+encodeURIComponent(target));
 if(!moduleAccess(user,'maintenance'))redirect('/modulos');
 const context=await new AccessService(getDatabase()).context(user);
 return <PcmPage section={path[0]} id={path[1]} ctx={{role:context.role,permissions:context.permissions,unitIds:context.unitIds,teamIds:context.teamIds,user:{id:user.id,name:user.name}}}/>;
}
