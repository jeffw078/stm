import Link from 'next/link';
import { ArrowUpRight,ClipboardCheck,Wrench,Users,Layers3 } from 'lucide-react';
import { requireUser } from '@/lib/auth';
import { MODULES,moduleAccess,accessLabel,fiveSRole } from '@/lib/domain';

export default async function Page(){
  const user=await requireUser();const modules=MODULES.filter(module=>moduleAccess(user,module.id));
  return <><div className="page-heading"><div><span className="eyebrow dark">STEELMAST · GESTÃO INTEGRADA</span><h1>Painel da empresa<span className="heading-dot">.</span></h1><p>Olá, {user.name.split(' ')[0]}. Escolha um módulo para começar.</p></div><span className="subtle-tag">{modules.length} {modules.length===1?'módulo disponível':'módulos disponíveis'}</span></div>
    <section className="company-welcome panel"><span className="company-mark"><Layers3 size={30}/></span><div><h2>Uma empresa. Todas as áreas conectadas.</h2><p>Acesse as ferramentas do seu dia a dia em um só lugar.</p></div></section>
    <div className="module-section-title"><h2>Seus módulos</h2><span>Os acessos seguem as permissões da sua conta.</span></div>
    <section className="module-grid" aria-label="Módulos disponíveis">{modules.map(module=>{
      const access=moduleAccess(user,module.id)!;const maintenance=module.id==='maintenance';const Icon=maintenance?Wrench:ClipboardCheck;
      const href=maintenance?'/pcm':fiveSRole(user)==='AUDITOR'?'/auditorias':'/dashboard';
      return <Link href={href} className={'module-card panel '+(maintenance?'maintenance':'five-s')} key={module.id}><div className="module-card-top"><span className="module-icon"><Icon size={28}/></span><span className="subtle-tag">Disponível</span></div><h2>{module.name}</h2><p>{module.description}</p><span className="module-access">{user.role==='MASTER'?'Master · Acesso completo':accessLabel(access)}</span><div className="module-card-bottom"><strong>Acessar módulo</strong><ArrowUpRight size={21}/></div></Link>;
    })}</section>
    {!modules.length&&<div className="panel module-empty"><h2>Nenhum módulo liberado</h2><p>Solicite ao Master a liberação dos módulos necessários para o seu trabalho.</p></div>}
    {user.role==='MASTER'&&<Link href="/usuarios" className="company-admin panel"><Users size={23}/><span><strong>Usuários e acessos</strong><small>Gerencie os níveis e subníveis de cada módulo.</small></span><ArrowUpRight size={20}/></Link>}
  </>;
}
