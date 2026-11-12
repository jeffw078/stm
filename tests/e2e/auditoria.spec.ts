import { test,expect } from '@playwright/test';
const origin='http://127.0.0.1:4173';
test('dashboard exibe histórico e filtros sem transbordar a tela',async({page})=>{
  await page.goto('/dashboard');await expect(page.getByRole('heading',{name:'Visão geral.'})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Desempenho por senso'})).toBeVisible();
  await page.getByRole('combobox',{name:'Senso',exact:true}).selectOption('1');
  await expect(page.getByText('Resultado do senso selecionado')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
test('auditor avalia os 23 itens e master revisa e finaliza',async({page,browser,request})=>{
  test.setTimeout(120000);
  const cat=await (await request.get('/api/catalog')).json();
  const sector=await (await request.post('/api/sectors',{headers:{Origin:origin},data:{name:'Teste E2E '+Date.now(),unitId:cat.units[0].id}})).json();
  const auditor=cat.users.find((u:any)=>u.role==='AUDITOR');
  const audit=await (await request.post('/api/audits',{headers:{Origin:origin},data:{sectorId:sector.id,date:'2026-11-06',auditorId:auditor.id,notes:'Verificação ponta a ponta'}})).json();
  expect(audit.id).toBeTruthy();
  await page.goto('/__qa/auditor');await page.goto('/auditorias/'+audit.id);
  await expect(page.getByRole('heading',{name:sector.name+'.'})).toBeVisible();
  for(const [index,name] of ['Seiri','Seiton','Seiso','Seiketsu','Shitsuke'].entries()){
    await page.getByRole('navigation',{name:'Sensos da auditoria'}).getByRole('button',{name:new RegExp(name)}).click();
    const count=[4,6,6,4,3][index];
    for(let q=1;q<=count;q++)await page.getByTestId(`s${index+1}q${q}-100`).click();
  }
  await page.getByRole('button',{name:'Salvar rascunho'}).click();
  await expect(page.getByText('Rascunho salvo.',{exact:false})).toBeVisible();
  await page.reload();await expect(page.getByText('23 de 23 perguntas')).toBeVisible();
  await page.getByRole('button',{name:'Enviar para revisão'}).click();
  await expect(page.getByText('Avaliação enviada para revisão.',{exact:true})).toBeVisible();
  const denied=await page.request.post('/api/units',{headers:{Origin:origin},data:{name:'Não deve criar'}});expect(denied.status()).toBe(403);
  const manager=await browser.newPage();await manager.goto('/__qa/master');await manager.goto('/auditorias/'+audit.id);
  await expect(manager.getByRole('heading',{name:'Revisão da auditoria'})).toBeVisible();
  await manager.getByRole('button',{name:'Aprovar e finalizar'}).click();
  await expect(manager.getByText('Auditoria revisada e finalizada.',{exact:true})).toBeVisible();await manager.close();
  await page.reload();await expect(page.getByRole('button',{name:'Salvar rascunho'})).toHaveCount(0);
});
