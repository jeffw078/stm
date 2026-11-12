import {validDate,AppError} from '../../../lib/domain';

export type Frequency='DAY'|'WEEK'|'MONTH'|'YEAR';
export function calendarDate(value:string){if(!validDate(value))throw new AppError('Data de calendário inválida.');return value;}
export function addDays(date:string,days:number){calendarDate(date);const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}
/** Every occurrence is calculated from the original anchor, never from a clamped predecessor. */
export function occurrenceDate(anchor:string,unit:Frequency,count:number,index:number){
 calendarDate(anchor);if(!Number.isInteger(count)||count<1||!Number.isInteger(index)||index<0)throw new AppError('Recorrência inválida.');
 if(unit==='DAY'||unit==='WEEK')return addDays(anchor,index*count*(unit==='WEEK'?7:1));
 const [year,month,day]=anchor.split('-').map(Number);const months=(unit==='YEAR'?12:1)*count*index+month-1;
 const y=year+Math.floor(months/12),m=months%12;const last=new Date(Date.UTC(y,m+1,0)).getUTCDate();
 return `${y}-${String(m+1).padStart(2,'0')}-${String(Math.min(day,last)).padStart(2,'0')}`;
}
export function nextScheduledDate(v:{start_date:string;frequency_unit:Frequency;frequency_count:number;end_date?:string|null},effectiveFrom:string,index=0){
 if(occurrenceDate(v.start_date,v.frequency_unit,v.frequency_count,index)<effectiveFrom){
  if(v.frequency_unit==='DAY'||v.frequency_unit==='WEEK')index=Math.max(index,Math.floor((Date.parse(effectiveFrom)-Date.parse(v.start_date))/86400000/(v.frequency_count*(v.frequency_unit==='WEEK'?7:1))));
  else {const [y,m]=effectiveFrom.split('-').map(Number),[sy,sm]=v.start_date.split('-').map(Number);index=Math.max(index,Math.floor(((y-sy)*12+m-sm)/(v.frequency_count*(v.frequency_unit==='YEAR'?12:1))));}
 }
 let due=occurrenceDate(v.start_date,v.frequency_unit,v.frequency_count,index);if(due<effectiveFrom)due=occurrenceDate(v.start_date,v.frequency_unit,v.frequency_count,index+1);return v.end_date&&due>v.end_date?null:due;
}
export function localDate(instant:Date|string,timezone='America/Sao_Paulo'){const p=new Intl.DateTimeFormat('en-US',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(instant));return `${p.find(p=>p.type==='year')!.value}-${p.find(p=>p.type==='month')!.value}-${p.find(p=>p.type==='day')!.value}`;}
export function localInstant(date:string,time='00:00',timezone='America/Sao_Paulo'){
 const target=Date.parse(`${date}T${time}:00Z`);let guess=target;
 for(let i=0;i<4;i++){const parts=new Intl.DateTimeFormat('en-US',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(guess));const val=(k:string)=>parts.find(p=>p.type===k)!.value;const wall=Date.parse(`${val('year')}-${val('month')}-${val('day')}T${val('hour')}:${val('minute')}:${val('second')}Z`);const delta=target-wall;guess+=delta;if(!delta)break;}
 return new Date(guess).toISOString();
}
export type Interval={start:string|Date;end:string|Date|null};
export type Span=[number,number];
export function unionIntervals(intervals:Interval[],from:string|Date,to:string|Date):Span[]{
 const lower=+new Date(from),upper=+new Date(to);const spans=intervals.map(i=>[Math.max(lower,+new Date(i.start)),Math.min(upper,i.end?+new Date(i.end):upper)] as Span).filter(([a,b])=>Number.isFinite(a)&&Number.isFinite(b)&&b>a).sort((a,b)=>a[0]-b[0]);
 const out:Span[]=[];for(const s of spans){const prev=out.at(-1);if(prev&&s[0]<=prev[1])prev[1]=Math.max(prev[1],s[1]);else out.push([...s]);}return out;
}
export function spanHours(spans:Span[]){return spans.reduce((sum,[a,b])=>sum+(b-a)/3600000,0);}
export function intersectionHours(a:Span[],b:Span[]){let hours=0;for(const [x,y] of a)for(const [u,v] of b)hours+=Math.max(0,Math.min(y,v)-Math.max(x,u))/3600000;return hours;}
export function operationalWindows(calendar:{weekly_windows:{day:number;start:string;end:string}[];valid_from:string;valid_to?:string|null},from:string,to:string,timezone:string){
 const spans:Interval[]=[];let date=addDays(localDate(from,timezone),-1);const last=localDate(to,timezone);let guard=0;
 while(date<=last&&guard++<3700){if(date>=calendar.valid_from&&(!calendar.valid_to||date<=calendar.valid_to)){const day=new Date(date+'T12:00:00Z').getUTCDay();for(const w of calendar.weekly_windows.filter(w=>w.day===day))spans.push({start:localInstant(date,w.start,timezone),end:localInstant(w.end<=w.start?addDays(date,1):date,w.end,timezone)});}date=addDays(date,1);}
 return unionIntervals(spans,from,to);
}
