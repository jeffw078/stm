'use client';
import { useEffect,useState,useCallback } from 'react';
import { AlertCircle,Loader2,ArrowUpRight,CheckCircle2,ClipboardList } from 'lucide-react';
import Link from 'next/link';
import { STATUS_LABELS,scoreLabel } from '@/lib/domain';
export async function api<T=any>(path:string,body?:unknown,method?:string):Promise<T>{
  const response=await fetch('/api/'+path,{method:method??(body?'POST':'GET'),headers:body instanceof FormData?undefined:body?{'Content-Type':'application/json'}:undefined,body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body),cache:'no-store'});
  const data=await response.json();
  if(!response.ok){if(response.status===401&&!path.startsWith('auth/'))window.location.assign('/login');if(response.status===428)window.location.assign('/trocar-senha');const reference=typeof data.requestId==='string'?' Referência: '+data.requestId:'';throw new Error((data.error??'Não foi possível concluir.')+reference);}return data;
}
export function useData<T=any>(path:string|null){
  const [data,setData]=useState<T|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[nonce,setNonce]=useState(0);
  useEffect(()=>{let active=true;if(!path)return;setLoading(true);setError('');api<T>(path).then(d=>{if(active)setData(d);}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[path,nonce]);
  return {data,error,loading,reload:useCallback(()=>setNonce(n=>n+1),[])};
}
export function Notice({children,kind='error'}:{children:React.ReactNode;kind?:'error'|'success'|'info'}){return <div className={`notice ${kind}`} role={kind==='error'?'alert':'status'}>{kind==='success'?<CheckCircle2 size={18}/>:<AlertCircle size={18}/>}<div>{children}</div></div>;}
export function Loading(){return <div className="loading" role="status"><Loader2 size={24} className="spin"/>Carregando informações…</div>;}
export function Empty({title='Nenhum registro neste período',text='Altere os filtros ou planeje uma nova auditoria.'}:{title?:string;text?:string}){return <div className="empty"><ClipboardList size={34}/><h3>{title}</h3><p>{text}</p></div>;}
export function StatusBadge({status}:{status:string}){return <span className={`status ${status.toLowerCase()}`}><span/>{STATUS_LABELS[status]??status}</span>;}
export function Score({value}:{value:number|null|undefined}){return <span className={`score ${value==null?'muted':value>=90?'good':value>=70?'mid':'low'}`}>{value==null?'—':scoreLabel(value)}</span>;}
export const formatDate=(date:string)=>new Date(date.slice(0,10)+'T12:00:00Z').toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo'});
export const formatPeriod=(period:string)=>new Date(period+'-15T12:00:00Z').toLocaleDateString('pt-BR',{month:'long',year:'numeric',timeZone:'America/Sao_Paulo'});
export function AuditTable({rows,compact=false}:{rows:any[];compact?:boolean}){
  if(!rows.length)return <Empty/>;
  return <div className="table-scroll"><table><thead><tr><th>Setor / unidade</th><th>Data</th>{!compact&&<th>Auditor</th>}<th>Etapa</th><th>Pontuação</th><th><span className="sr-only">Abrir</span></th></tr></thead><tbody>{rows.map(a=><tr key={a.id}><td><Link className="cell-title" href={'/auditorias/'+a.id}>{a.sector}</Link><small>{a.unit}{a.source==='HISTORICAL'?' · Histórico importado':''}</small></td><td>{formatDate(a.date)}</td>{!compact&&<td>{a.auditor_name}</td>}<td><StatusBadge status={a.status}/></td><td><Score value={a.overall}/></td><td><Link className="icon-link" href={'/auditorias/'+a.id} aria-label={'Abrir auditoria de '+a.sector}><ArrowUpRight size={18}/></Link></td></tr>)}</tbody></table></div>;
}
export type Catalog={units:any[];sectors:any[];users:any[];latestPeriod:string};
