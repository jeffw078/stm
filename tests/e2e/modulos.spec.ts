import { test,expect } from '@playwright/test';

test('primeiro login e troca da senha temporária chegam ao painel da empresa',async({page,request})=>{
  const email=`first-login-${Date.now()}@test.local`,password='TemporariaLogin123!';
  const created=await request.post('/api/users',{headers:{Origin:'http://127.0.0.1:4173'},data:{name:'Primeiro acesso',email,password,role:'USER',modules:{maintenance:{level:'ADMIN',sublevel:'MANAGER'}}}});
  expect(created.status()).toBe(201);
  // Override the preview proxy's default Master session to exercise the real login.
  await page.context().addCookies([{name:'sm5s_session',value:'invalid-local-session',url:'http://127.0.0.1:4173'}]);
  await page.goto('/login');
  await page.getByLabel('E-mail',{exact:true}).fill(email);
  await page.locator('input[name=password]').fill(password);
  await page.getByRole('button',{name:'Acessar plataforma'}).click();
  await expect(page).toHaveURL(/\/trocar-senha$/);
  await page.locator('input[name=currentPassword]').fill(password);
  await page.locator('input[name=password]').fill('NovaSenhaDefinitiva123!');
  await page.locator('input[name=confirm]').fill('NovaSenhaDefinitiva123!');
  await page.getByRole('button',{name:'Salvar nova senha'}).click();
  await expect(page).toHaveURL(/\/modulos$/);
  await expect(page.getByRole('heading',{name:'Manutenção',exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Auditoria 5S',exact:true})).toHaveCount(0);
});

test('login abre painel da empresa e cartões dão acesso aos módulos',async({page})=>{
  await page.goto('/');await expect(page).toHaveURL(/\/modulos$/);
  await expect(page.getByRole('heading',{name:'Painel da empresa.'})).toBeVisible();
  await page.getByRole('link').filter({has:page.getByRole('heading',{name:'Auditoria 5S',exact:true})}).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  const menu=page.getByRole('button',{name:'Abrir menu',exact:true});
  if(await menu.isVisible())await menu.click();
  await page.getByRole('link',{name:'Painel da empresa',exact:true}).click();
  await page.getByRole('link').filter({has:page.getByRole('heading',{name:'Manutenção',exact:true})}).click();
  await expect(page.getByRole('heading',{name:'Manutenção.'})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
test('admin da manutenção vê apenas seu módulo e não pode abrir o 5S',async({page})=>{
  await page.goto('/__qa/maintenance');
  await expect(page.getByRole('heading',{name:'Painel da empresa.'})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Auditoria 5S',exact:true})).toHaveCount(0);
  await page.goto('/dashboard');await expect(page).toHaveURL(/\/modulos$/);
  for(const endpoint of ['catalog','dashboard','audits','export','users'])expect((await page.request.get('/api/'+endpoint)).status(),endpoint).toBe(403);
  await page.goto('/manutencao');await expect(page.getByRole('heading',{name:'Manutenção.'})).toBeVisible();
});
test('auditor mantém acesso ao 5S e ao painel de módulos',async({page})=>{
  await page.goto('/__qa/auditor');
  await page.getByRole('link').filter({has:page.getByRole('heading',{name:'Auditoria 5S',exact:true})}).click();
  await expect(page).toHaveURL(/\/auditorias$/);
  await expect(page.getByRole('heading',{name:'Minhas auditorias.'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Planejar auditoria'})).toHaveCount(0);
});
test('master cria usuário de manutenção e edita níveis de acesso',async({page})=>{
  await page.goto('/usuarios');const email=`module-${Date.now()}@test.local`;
  await page.getByLabel('Nome completo').fill('Usuário teste manutenção');
  await page.getByLabel('E-mail',{exact:true}).fill(email);
  await page.getByLabel('Senha temporária',{exact:true}).fill('SenhaTemporaria123!');
  await page.getByRole('combobox',{name:'Nível — Manutenção',exact:true}).selectOption('USER');
  await page.getByRole('combobox',{name:'Subnível — Manutenção',exact:true}).selectOption('VIEWER');
  await page.getByRole('button',{name:'Criar usuário',exact:true}).click();
  const row=page.getByRole('row').filter({hasText:email});await expect(row).toContainText('Usuário · Consulta');
  await row.getByRole('button',{name:'Editar permissões de Usuário teste manutenção',exact:true}).click();
  const form=page.locator('form').filter({has:page.getByRole('button',{name:'Salvar permissões'})});
  await form.getByRole('combobox',{name:'Nível — Manutenção',exact:true}).selectOption('ADMIN');
  await expect(form.getByRole('combobox',{name:'Subnível — Manutenção',exact:true})).toHaveValue('MANAGER');
  await form.getByRole('button',{name:'Salvar permissões'}).click();
  await expect(row).toContainText('Administrador');
});
