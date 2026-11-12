// PostgreSQL DATE is a calendar day in the server timezone, unlike timestamptz.
const calendarFields=new Set(['acquired_on','installed_on','document_date','source_date','source_reference_date','effective_date','valid_from','valid_to','effective_from','effective_to','start_date','end_date','original_due_date','scheduled_date','original_deadline']);
export function serializePcm(value:any,key=''):any{
 if(value instanceof Date)return calendarFields.has(key)?`${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`:value.toISOString();
 if(Array.isArray(value))return value.map(v=>serializePcm(v,key));
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,serializePcm(v,k)]));
 return value;
}
export function notificationHref(kind:string,id:string|null){
 if(kind==='JOB_FAILED')return '/pcm/configuracoes';
 if(!id)return '/pcm';
 if(['ORDER_ASSIGNED','PREVENTIVE'].includes(kind))return '/pcm/ordens/'+encodeURIComponent(id);
 if(['REQUEST_UPDATED','ORDER_UPDATED','RESPONSE'].includes(kind))return '/pcm/solicitacoes/'+encodeURIComponent(id);
 return '/pcm';
}
