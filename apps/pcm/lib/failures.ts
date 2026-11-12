export function pcmInfrastructureFailure(error:unknown,requestId:string){
 const code=error&&typeof error==='object'?'code' in error?String(error.code):'':'';
 if(['42P01','3F000','42703'].includes(code))return {status:503,body:{error:'A Manutenção precisa de ativação ou atualização neste ambiente. Peça ao administrador para concluir a configuração.',requestId,code:'PCM_SETUP_REQUIRED'}};
 return {status:503,body:{error:'Não foi possível concluir. Verifique a configuração e informe o código de referência ao suporte.',requestId,code:'PCM_UNAVAILABLE'}};
}
