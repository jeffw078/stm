export function safeReturnTo(value:string|null|undefined){
 if(!value||!value.startsWith('/'))return '/modulos';
 try{const url=new URL(value,'https://steelmast.invalid');if(url.origin==='https://steelmast.invalid'&&(url.pathname==='/pcm'||url.pathname.startsWith('/pcm/')))return url.pathname+url.search;}catch{}
 return '/modulos';
}
