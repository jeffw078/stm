'use client';
import {useState} from 'react';
import Link from 'next/link';
import {ClipboardPlus,ClipboardCheck,Wrench,Clock3,Package,ArrowRight,Bell} from 'lucide-react';
import {useData,Notice,Loading,Heading,Empty,Badge,has,type Catalog,type ClientContext} from './shared';
import {Assets,AssetDetail} from './assets';
import {Requests,RequestDetail,Orders,OrderDetail,OrderTable} from './operations';
import {Plans,PlanDetail,Agenda} from './planning';
import {Indicators} from './indicators';
import {Imports} from './imports';
import {Materials} from './materials';
import {Settings} from './settings';
import {notificationHref} from '../lib/presentation';

export const SECTIONS:Record<string,{title:string;permission:string[]}>={
 '':{title:'Manutenção',permission:[]},ativos:{title:'Ativos',permission:['assets.read']},solicitacoes:{title:'Solicitações',permission:['requests.own','requests.all']},ordens:{title:'Ordens de manutenção',permission:['orders.read']},preventivas:{title:'Preventivas',permission:['assets.read']},agenda:{title:'Agenda',permission:['assets.read']},materiais:{title:'Materiais e aplicações',permission:['materials.read']},indicadores:{title:'Indicadores',permission:['indicators.read']},importacoes:{title:'Importações',permission:['imports.preview']},configuracoes:{title:'Configurações',permission:['settings.manage','access.manage','plans.manage']}
};
export function PcmPage({section='',id,ctx}:{section?:string;id?:string;ctx:ClientContext}){
 const configured=ctx.permissions.length>0,cat=useData<Catalog>(configured?'pcm/catalog':null);
 if(!configured)return <><Heading title="Manutenção" description="Seu módulo está liberado. Falta definir o perfil e as unidades autorizadas."/><Notice kind="info">Solicite à administração da Manutenção a configuração do seu perfil e das unidades em Configurações PCM.</Notice><Link className="button secondary" href="/modulos">Voltar ao painel da empresa</Link></>;
 const entry=SECTIONS[section];if(!entry)return <Notice>Página PCM não encontrada.</Notice>;
 if(entry.permission.length&&!entry.permission.some(p=>has(ctx,p)))return <><Heading title={entry.title} description="Este recurso depende de uma permissão específica no PCM."/><Notice>Seu perfil não possui acesso a esta área.</Notice><Link className="button secondary" href="/pcm">Voltar à manutenção</Link></>;
 if(cat.error)return <><Heading title={entry.title} description="Não foi possível carregar os registros autorizados."/><Notice>{cat.error}</Notice></>;if(!cat.data)return <><Heading title={entry.title} description="Carregando os registros autorizados para seu acesso."/><Loading/></>;
 const props={ctx,cat:cat.data};
 return <div className="pcm-workspace">{section===''?<Overview {...props}/>:section==='ativos'?id?<AssetDetail {...props} id={id}/>:<Assets {...props}/>:section==='solicitacoes'?id?<RequestDetail {...props} id={id}/>:<Requests {...props}/>:section==='ordens'?id?<OrderDetail {...props} id={id}/>:<Orders {...props}/>:section==='preventivas'?id?<PlanDetail {...props} id={id}/>:<Plans {...props}/>:section==='agenda'?<Agenda {...props}/>:section==='materiais'?<Materials {...props}/>:section==='indicadores'?<Indicators {...props}/>:section==='importacoes'?<Imports {...props} id={id}/>:<Settings {...props}/>}</div>;
}
function Overview({ctx,cat}:{ctx:ClientContext;cat:Catalog|null}){
 const data=useData<any>('pcm/overview'),notifications=useData<any>('pcm/notifications'),orders=useData<any>(has(ctx,'orders.read')?'pcm/orders?pageSize=5&status=IN_PROGRESS':null),agenda=useData<any>(has(ctx,'assets.read')?'pcm/agenda?pageSize=5':null);
 const sum=(list:any[],predicate:(r:any)=>boolean)=>list?.filter(predicate).reduce((n,r)=>n+Number(r.count),0)??0;
 const d=data.data;const cards=[{name:'Solicitações abertas',value:sum(d?.requests,(r:any)=>['NEW','TRIAGED'].includes(r.status)),href:'/pcm/solicitacoes',icon:ClipboardPlus},{name:'Ordens em atendimento',value:sum(d?.orders,(r:any)=>r.status==='IN_PROGRESS'),href:'/pcm/ordens',icon:Wrench},{name:'Ativos em manutenção',value:sum(d?.assets,(r:any)=>r.lifecycle==='MAINTENANCE'),href:'/pcm/ativos',icon:Clock3},{name:'Ordens com prazo vencido',value:d?.orders?.reduce((n:number,r:any)=>n+Number(r.overdue??0),0)??0,href:'/pcm/ordens',icon:ClipboardCheck}];
 const notes=Array.isArray(notifications.data)?notifications.data:notifications.data?.rows??[];
 return <><Heading title="Manutenção" description="Solicitações, atendimento e planejamento em uma visão operacional."><Link className="button primary" href="/pcm/solicitacoes"><ClipboardPlus size={17}/>Solicitar manutenção</Link>{has(ctx,'orders.assign')&&<Link className="button secondary" href="/pcm/ordens">Planejar atendimento</Link>}</Heading>
 {data.error&&<Notice>{data.error}</Notice>}{data.loading?<Loading/>:<section className="metric-grid pcm-overview-metrics">{cards.filter(c=>c.href!=='/pcm/ordens'||has(ctx,'orders.read')).map(c=><Link key={c.name} href={c.href} className="metric-card"><span className="metric-name">{c.name}<c.icon size={19}/></span><strong>{c.value}</strong><span className="metric-foot">Consultar registros<ArrowRight size={15}/></span></Link>)}</section>}
 <div className="pcm-dashboard-columns">{has(ctx,'orders.read')&&<section className="panel"><div className="panel-heading"><div><h2>Atendimentos em andamento</h2><p>Ordens autorizadas para você ou sua equipe.</p></div><Link className="text-link" href="/pcm/ordens">Ver ordens<ArrowRight size={15}/></Link></div>{orders.loading?<Loading/>:<OrderTable rows={orders.data?.rows??[]}/>}</section>}
 <section className="panel"><div className="panel-heading"><h2><Bell size={18}/>Notificações</h2></div>{notifications.error&&<Notice>{notifications.error}</Notice>}{notifications.loading?<Loading/>:!notes.length?<Empty text="Nenhuma notificação no momento."/>:<div className="pcm-notifications">{notes.slice(0,8).map((n:any)=><article key={n.id}><strong>{n.title}</strong><p>{n.message}</p><Link href={notificationHref(n.kind,n.entity_id)}>Abrir registro<ArrowRight size={13}/></Link></article>)}</div>}</section></div>
 {has(ctx,'assets.read')&&<section className="panel"><div className="panel-heading"><div><h2>Agenda preventiva</h2><p>Ocorrências geradas pelo agendador. Os vencimentos originais são preservados.</p></div><Link className="text-link" href="/pcm/agenda">Abrir agenda<ArrowRight size={15}/></Link></div>{agenda.error&&<Notice>{agenda.error}</Notice>}{agenda.loading?<Loading/>:!agenda.data?.rows?.length?<Empty text="Nenhuma ocorrência nesta consulta."/>:<div className="table-scroll"><table><thead><tr><th>Plano</th><th>Vencimento original</th><th>Data operacional</th><th>Status</th></tr></thead><tbody>{agenda.data.rows.map((r:any)=><tr key={r.id}><td><Link className="cell-title" href={'/pcm/preventivas/'+r.plan_id}>{r.code} · {r.name}</Link></td><td>{String(r.original_due_date).slice(0,10)}</td><td>{String(r.scheduled_date).slice(0,10)}</td><td><Badge value={r.status??'PLANNED'}/></td></tr>)}</tbody></table></div>}</section>}
 <div className="pcm-shortcuts">{has(ctx,'assets.write')&&<Link className="panel" href="/pcm/ativos"><Wrench size={22}/><strong>Ativos e componentes</strong><p>Cadastros, manuais e histórico técnico.</p></Link>}{has(ctx,'plans.manage')&&<Link className="panel" href="/pcm/preventivas"><Clock3 size={22}/><strong>Planos preventivos</strong><p>Recorrência e tarefas previstas.</p></Link>}{has(ctx,'materials.read')&&<Link className="panel" href="/pcm/materiais"><Package size={22}/><strong>Materiais e aplicações</strong><p>Catálogo e informações importadas.</p></Link>}</div></>;
}
