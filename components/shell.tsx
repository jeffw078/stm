'use client';
import { useState } from 'react';
import Link from 'next/link';
import { usePathname,useRouter } from 'next/navigation';
import { LayoutDashboard,ClipboardCheck,Upload,Building2,Users,LogOut,Menu,X,ChevronRight,Leaf,LockKeyhole,Layers3,Wrench } from 'lucide-react';
import { moduleAccess,canViewDashboard,type User } from '@/lib/domain';
import { api,useData } from './shared';
import { useUnsavedGuard } from './unsaved-guard';
const fiveSLinks=[{href:'/dashboard',label:'Visão geral 5S',icon:LayoutDashboard},{href:'/auditorias',label:'Auditorias',icon:ClipboardCheck},{href:'/importacao',label:'Importar histórico',icon:Upload},{href:'/cadastros',label:'Unidades e setores',icon:Building2}];
const pcmLinks=[{href:'/pcm',label:'Visão operacional',icon:LayoutDashboard,permissions:[]},{href:'/pcm/solicitacoes',label:'Solicitações',icon:ClipboardCheck,permissions:['requests.own','requests.all']},{href:'/pcm/ordens',label:'Ordens de manutenção',icon:Wrench,permissions:['orders.read']},{href:'/pcm/ativos',label:'Ativos e componentes',icon:Building2,permissions:['assets.read']},{href:'/pcm/preventivas',label:'Planos preventivos',icon:ClipboardCheck,permissions:['assets.read']},{href:'/pcm/agenda',label:'Agenda preventiva',icon:LayoutDashboard,permissions:['assets.read']},{href:'/pcm/materiais',label:'Materiais e aplicações',icon:Building2,permissions:['materials.read']},{href:'/pcm/indicadores',label:'Indicadores',icon:LayoutDashboard,permissions:['indicators.read']},{href:'/pcm/importacoes',label:'Importações PCM',icon:Upload,permissions:['imports.preview']},{href:'/pcm/configuracoes',label:'Configurações PCM',icon:Users,permissions:['access.manage','settings.manage','plans.manage']}];
export function Shell({user,children}:{user:User;children:React.ReactNode}){
  const pathname=usePathname(),router=useRouter();const [open,setOpen]=useState(false),[leaving,setLeaving]=useState(false);
  const inFiveS=fiveSLinks.some(l=>pathname.startsWith(l.href));const inPcm=pathname==='/pcm'||pathname.startsWith('/pcm/');const inMaintenance=pathname.startsWith('/manutencao')||inPcm;
  const pcm=useData<{permissions:string[]}>(inPcm?'pcm/context':null);
  const context=inFiveS?'Auditoria 5S':inMaintenance?'Manutenção':'Painel da empresa';
  const links=[{href:'/modulos',label:'Painel da empresa',icon:Layers3},...(inFiveS&&moduleAccess(user,'5s')?fiveSLinks.filter(l=>l.href==='/dashboard'?canViewDashboard(user):['/cadastros','/importacao'].includes(l.href)?user.role==='MASTER':true):[]),...(inPcm?pcmLinks.filter(l=>!l.permissions.length||l.permissions.some(p=>pcm.data?.permissions.includes(p))):inMaintenance?[{href:'/manutencao',label:'Manutenção',icon:Wrench}]:[]),...(user.role==='MASTER'?[{href:'/usuarios',label:'Usuários e acessos',icon:Users}]:[])];
  const active=(href:string)=>href==='/pcm'?pathname==='/pcm':pathname.startsWith(href);
  const current=links.find(l=>active(l.href));
  const guard=useUnsavedGuard();
  async function logout(){if(!guard.confirmLeave())return;setLeaving(true);try{await api('auth/logout',{});guard.setDirty(false);router.push('/login');router.refresh();}catch{setLeaving(false);}}
  return <div className={'app-frame'+(inPcm?' pcm-frame':'')}>
    {open&&<button className="nav-shade" aria-label="Fechar menu" onClick={()=>setOpen(false)}/>}
    <aside className={'sidebar '+(open?'open':'')}>
      <Link href="/modulos" className="brand"><img src="/logo.svg" alt="SteelMast" width="172" height="32"/><span>PLATAFORMA DE GESTÃO</span></Link>
      <div className="product"><span className="product-symbol">{inFiveS?'5S':inMaintenance?<Wrench size={24}/>:<Layers3 size={24}/>}</span><div><strong>{context}</strong><span>{inFiveS?'Organizar. Cuidar. Evoluir.':'Pessoas. Processos. Resultados.'}</span></div></div>
      <div className="nav-caption">ESPAÇO DE TRABALHO</div>
      <nav aria-label="Navegação principal">{links.map(l=><Link key={l.href} href={l.href} onClick={()=>setOpen(false)} className={active(l.href)?'active':''}><l.icon size={19}/>{l.label}{active(l.href)&&<ChevronRight size={15} className="nav-arrow"/>}</Link>)}</nav>
      <div className="sidebar-bottom"><div className="culture"><Leaf size={22}/><strong>A excelência começa aqui.</strong><p>Pequenas atitudes.<br/>Evolução todos os dias.</p></div><div className="user-box"><span className="avatar">{user.name.split(' ').map(s=>s[0]).slice(0,2).join('')}</span><div><strong>{user.name}</strong><span>{user.role==='MASTER'?'Master':'Usuário da plataforma'}</span></div><button onClick={logout} disabled={leaving} title="Sair" aria-label="Sair"><LogOut size={18}/></button></div></div>
    </aside>
    <div className="app-main"><header className="topbar"><button className="mobile-menu" aria-label="Abrir menu" onClick={()=>setOpen(!open)}>{open?<X size={23}/>:<Menu size={23}/>}</button><div className="breadcrumb">SteelMast <ChevronRight size={13}/><span>{current?.label??context}</span></div><div className="topbar-right"><span className="workspace-tag"><span/>{context}</span><Link href="/trocar-senha" aria-label="Alterar minha senha" title="Alterar minha senha" className="topbar-lock"><LockKeyhole size={18}/></Link></div></header><main className="page-content">{children}</main><footer className="app-footer"><span>STEELMAST · Gestão e melhoria contínua</span><span>{context}</span></footer></div>
  </div>;
}
