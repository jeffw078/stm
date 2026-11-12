'use client';
import { useEffect,useState } from 'react';
import { ArrowRight,Eye,EyeOff,ShieldCheck,LockKeyhole } from 'lucide-react';
import { api,Notice } from './shared';
import {safeReturnTo} from '@/lib/return-to';
export function AuthForm({change=false,forced=false}:{change?:boolean;forced?:boolean}){
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[show,setShow]=useState(false),[ready,setReady]=useState(false);
  useEffect(()=>setReady(true),[]);
  async function submit(e:React.FormEvent<HTMLFormElement>){
    e.preventDefault();setError('');const f=new FormData(e.currentTarget);
    if(change&&f.get('password')!==f.get('confirm')){setError('A confirmação não corresponde à nova senha.');return;}
    setBusy(true);try{
      const destination=safeReturnTo(new URLSearchParams(window.location.search).get('next'));
      // Reload after replacing the session cookie to discard redirects cached for the previous session.
      if(change){await api('auth/change-password',{currentPassword:f.get('currentPassword'),password:f.get('password')});window.location.assign(destination);}
      else{const r=await api('auth/login',{email:f.get('email'),password:f.get('password')});window.location.assign(r.mustChangePassword?'/trocar-senha'+(destination==='/modulos'?'':'?next='+encodeURIComponent(destination)):destination);}
    }catch(err){setError((err as Error).message);setBusy(false);}
  }
  return <div className="auth-frame"><section className="auth-story"><img src="/logo.svg" width="194" height="35" alt="SteelMast"/><div className="auth-story-center"><span className="eyebrow"><span/>SISTEMAS STEELMAST</span><h1>A força que molda o aço,<br/><em>impulsiona o futuro</em></h1><p>Acesse os sistemas da SteelMast com sua conta.</p></div><span className="auth-copyright">SteelMast · Sistemas corporativos</span></section><section className="auth-panel"><div className="auth-form-wrap"><span className="auth-icon">{change?<LockKeyhole size={26}/>:<ShieldCheck size={27}/>}</span><span className="eyebrow dark">SISTEMAS STEELMAST</span><h2>{change?forced?'Defina sua nova senha':'Alterar minha senha':'Bem-vindo de volta.'}</h2><p>{change?forced?'Para proteger seu acesso, substitua a senha temporária antes de continuar.':'Mantenha sua conta protegida com uma senha exclusiva.':'Acesse sua conta para entrar nos sistemas SteelMast.'}</p>{error&&<Notice>{error}</Notice>}<form method="post" onSubmit={submit}>
      {!change&&<label>E-mail<input type="email" name="email" placeholder="seu.email@empresa.com.br" autoComplete="username" required maxLength={254}/></label>}
      {change&&<label>{forced?'Senha temporária':'Senha atual'}<input name="currentPassword" type="password" autoComplete="current-password" required maxLength={128}/></label>}
      <label>{change?'Nova senha':'Senha'}<span className="password-field"><input type={show?'text':'password'} name="password" placeholder={change?'Pelo menos 12 caracteres':'Digite sua senha'} autoComplete={change?'new-password':'current-password'} required minLength={change?12:1} maxLength={128}/><button type="button" onClick={()=>setShow(!show)} aria-label={show?'Ocultar senha':'Mostrar senha'}>{show?<EyeOff size={18}/>:<Eye size={18}/>}</button></span></label>
      {change&&<><label>Confirmar nova senha<input name="confirm" type="password" autoComplete="new-password" required minLength={12} maxLength={128}/></label><small>Use de 12 a 128 caracteres, com letras e números.</small></>}
      <button className="button primary full" disabled={!ready||busy}>{!ready||busy?'Aguarde…':change?'Salvar nova senha':'Acessar plataforma'}<ArrowRight size={18}/></button>
    </form><div className="auth-help"><ShieldCheck size={16}/><span>{change?'Suas sessões anteriores serão encerradas.':'Primeiro acesso? Utilize a senha temporária recebida do Master.'}</span></div>{change&&!forced&&<a className="text-link" href="/">Voltar ao sistema</a>}</div><div className="auth-bottom">SteelMast · Acesso restrito a pessoas autorizadas</div></section></div>;
}
