import type { Database,Queryable } from './db';
import { AppError,type User } from './domain';
import { hashPassword,verifyPassword,randomToken,tokenHash } from './security';
import { grantsSelect } from './module-access';
const fakeHash='scrypt$'+'0'.repeat(48)+'$'+'0'.repeat(128);
export class Authentication{
  constructor(public db:Database){}
  async getUser(token:string|undefined):Promise<User|null>{
    if(!token||token.length>200)return null;
    const {rows}=await this.db.query(`SELECT u.id,u.email,u.name,u.role,u.active,u.must_change_password,u.auth_version,${grantsSelect} FROM sm5s.sessions s JOIN sm5s.users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND s.auth_version=u.auth_version AND u.active AND (NOT u.must_change_password OR u.temporary_expires_at>now())`,[tokenHash(token)]);
    return rows[0] as User??null;
  }
  private async session(q:Queryable,user:{id:string;auth_version:number;must_change_password:boolean}){
    const token=randomToken();const hours=user.must_change_password?0.5:8;
    await q.query("INSERT INTO sm5s.sessions(token_hash,user_id,auth_version,expires_at) VALUES($1,$2,$3,now()+$4*interval '1 hour')",[tokenHash(token),user.id,user.auth_version,hours]);
    return {token,mustChangePassword:user.must_change_password,maxAge:hours*3600};
  }
  async login(email:string,password:string,clientKey:string){
    const normalized=email.toLowerCase().trim().slice(0,254);if(!normalized||password.length>128)throw new AppError('E-mail ou senha inválidos.',401);
    const result=await this.db.transaction(async q=>{
      // The shared email and client buckets persist across Vercel instances.
      const keys=[tokenHash('email:'+normalized),tokenHash('client:'+clientKey)];
      for(const key of keys){
        await q.query('INSERT INTO sm5s.login_attempts(key,attempts) VALUES($1,0) ON CONFLICT DO NOTHING',[key]);
        const row=(await q.query('SELECT * FROM sm5s.login_attempts WHERE key=$1 FOR UPDATE',[key])).rows[0];
        const expired=Date.now()-new Date(row.window_started).getTime()>15*60*1000;
        if(!expired&&row.attempts>=(key===keys[0]?8:40))return {error:new AppError('Muitas tentativas. Aguarde 15 minutos.',429)};
        await q.query('UPDATE sm5s.login_attempts SET attempts=$2,window_started=CASE WHEN $3 THEN now() ELSE window_started END WHERE key=$1',[key,expired?1:row.attempts+1,expired]);
      }
      const user=(await q.query('SELECT * FROM sm5s.users WHERE email=$1 FOR UPDATE',[normalized])).rows[0];
      const verified=await verifyPassword(password,user?.password_hash??fakeHash);
      if(!user||!verified||!user.active)return {error:new AppError('E-mail ou senha inválidos.',401)};
      if(user.must_change_password&&(!user.temporary_expires_at||new Date(user.temporary_expires_at).getTime()<=Date.now()))return {error:new AppError('Senha temporária expirada. Solicite uma nova ao Master.',401)};
      await q.query('DELETE FROM sm5s.login_attempts WHERE key=$1',[keys[0]]);
      await q.query('DELETE FROM sm5s.sessions WHERE expires_at<now()');
      return {value:await this.session(q,user as any)};
    });
    if(result.error)throw result.error;return result.value!;
  }
  async logout(token:string){await this.db.query('DELETE FROM sm5s.sessions WHERE token_hash=$1',[tokenHash(token)]);}
  async changePassword(token:string,current:string,password:string){
    const newHash=await hashPassword(password);
    return this.db.transaction(async q=>{
      const u=(await q.query(`SELECT u.* FROM sm5s.users u JOIN sm5s.sessions s ON s.user_id=u.id WHERE s.token_hash=$1 AND s.expires_at>now() AND s.auth_version=u.auth_version AND u.active FOR UPDATE OF u`,[tokenHash(token)])).rows[0];
      if(!u||(u.must_change_password&&new Date(u.temporary_expires_at).getTime()<=Date.now()))throw new AppError('Sessão expirada.',401);
      if(!await verifyPassword(current,u.password_hash))throw new AppError('Senha atual incorreta.',400);
      if(await verifyPassword(password,u.password_hash))throw new AppError('A nova senha deve ser diferente da atual.');
      const updated=(await q.query('UPDATE sm5s.users SET password_hash=$2,must_change_password=false,temporary_expires_at=NULL,auth_version=auth_version+1 WHERE id=$1 RETURNING *',[u.id,newHash])).rows[0];
      await q.query('DELETE FROM sm5s.sessions WHERE user_id=$1',[u.id]);
      return this.session(q,updated as any);
    });
  }
}
