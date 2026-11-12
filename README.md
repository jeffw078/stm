# SteelMast — Plataforma de gestão

Sistema em **Next.js 16 + React 19 + TypeScript**, preparado para **Vercel** e **Neon PostgreSQL**. Interface em português para computador e tablet, com logo e paleta do site oficial SteelMast.

## Painel da empresa e módulos

Após o login (e a troca de senha, quando exigida), todos os usuários chegam ao **Painel da empresa** em `/modulos`. Os cartões exibem somente os módulos autorizados. As rotas e os dados existentes do 5S são mantidos; `/dashboard` continua sendo o painel do 5S.

O Master gerencia as permissões em **Usuários e acessos**. Cada módulo possui nível **Administrador** ou **Usuário**. Para usuários, os subníveis são **Consulta** (leitura), **Operação** (atividades atribuídas) e **Gestão** (planejamento e revisão). Administração de módulo não concede o perfil Master. Importação e cadastros de unidades/setores do 5S continuam restritos ao Master. Alterar permissões encerra as sessões do usuário.

**Atualização de uma instalação existente:** com `DATABASE_URL` configurada para o banco correto, execute `npm run db:migrate` antes de disponibilizar esta versão. A migração `003_module_access.sql` mantém Admins como administradores do 5S e Auditores como usuários de operação do 5S. A reaplicação não restaura acessos removidos.

A migração `004_maintenance_admin.sql` provisiona `michelli.rudnik@steelmast.com.br` como administradora apenas da Manutenção, com a senha temporária solicitada pelo responsável, armazenada somente como hash. Ela exige troca no primeiro acesso e expira **72 horas após a aplicação da migração**. Essa é uma exceção de provisionamento; novas senhas e redefinições continuam exigindo 12 caracteres com letras e números. Se o e-mail já existir, a senha, o perfil e os acessos anteriores são preservados, acrescentando-se a administração da Manutenção. Reaplicar a migração não redefine senha nem restaura permissões. Após expirar, o Master pode redefinir a senha pela tela de usuários.

O módulo de Manutenção está em `/pcm` (`/manutencao` redireciona para ele), com ativos/componentes, chamados, ordens, horas/materiais, manuais privados, preventivas, agenda, indicadores e importação assistida da planilha. O projeto separado e as instruções de migração, acessos, armazenamento privado e agendador estão em [apps/pcm/README.md](apps/pcm/README.md). Sem credenciais de produção neste workspace, a conta e o módulo foram validados em banco descartável; migração e publicação no Neon real seguem o fluxo de homologação.

## O que está implementado

- Perfis Master, Admin e Auditor, com autorização no servidor por operação e auditoria.
- Master inicial `jeffersonw078@gmail.com`, criado por comando de bootstrap. **Não existe senha padrão no código.**
- Senha temporária de 72 horas e troca obrigatória no primeiro acesso; scrypt com salt individual, sessões revogáveis e limite de tentativas compartilhado pelo banco.
- Planejamento, rascunhos, 23 perguntas das telas originais, evidências, envio, revisão independente, devolução com motivo e finalização.
- Média por senso e média geral com peso igual para os cinco sensos. Respostas novas usam 0, 25, 50, 75 e 100. Notas históricas preservam a escala original de 0 a 100.
- Comparação com o **mês calendário anterior**, do mesmo setor e unidade. Uma ausência não é substituída por um mês mais antigo. Respostas individuais aparecem somente se existirem na origem.
- Fotos JPEG/PNG/WebP compactadas no navegador, recodificadas no servidor em WebP, sem EXIF; somente a versão compactada é gravada no Neon. Leitura autenticada e limite de três fotos por senso.
- Dashboard com período inicial/final, unidade, setor e senso; evolução mensal, resultados por senso, setores e exportação CSV.
- Cadastros de unidades/setores e usuários; desativação de acesso e redefinição de senha pelo Master.
- Importação CSV/TSV/TXT com prévia, relatório, duplicidades, conflitos, validação de data/mês/ano/autoria e gravação em lote transacional.

## Instalação local com Neon

Requer Node.js 22 ou superior e um banco Neon acessível.

```bash
npm ci
cp .env.example .env.local
```

Preencha `.env.local` **somente na sua máquina**:

| Variável | Uso |
| --- | --- |
| `DATABASE_URL` | Conexão PostgreSQL com TLS, preferencialmente pooled, copiada do painel Neon. Somente servidor. |
| `APP_URL` | Origem exata da aplicação: `http://localhost:3000` localmente e a URL HTTPS publicada em produção. Sem barra final. |
| `MASTER_EMAIL` | `jeffersonw078@gmail.com`, usado pelos comandos administrativos. |
| `MASTER_TEMP_PASSWORD` | Senha exclusiva, de 12 a 128 caracteres, com letras e números; utilizada somente nos comandos de criação/recuperação. |

Não use prefixo `NEXT_PUBLIC_` nessas variáveis. Não coloque o arquivo `db.txt` dentro do projeto ou no Git.

```bash
npm run db:migrate
npm run db:bootstrap
npm run dev
```

Abra `http://localhost:3000`. Entre com o e-mail Master e a senha temporária que você definiu. O sistema exigirá uma nova senha antes de liberar qualquer dado. Após o bootstrap, remova `MASTER_TEMP_PASSWORD` do ambiente de execução comum. O comando de bootstrap é idempotente e não redefine uma conta existente.

As migrações trabalham apenas no schema `sm5s`, sem apagar ou alterar tabelas de outros schemas. A migração 002 permite salvar comentários de perguntas ainda sem pontuação; 003 e 004 acrescentam os módulos e o provisionamento da Manutenção. Todas podem ser reaplicadas sem redefinir senhas ou restaurar permissões revogadas.

Se a senha temporária do Master expirar, defina uma nova `MASTER_TEMP_PASSWORD` localmente e execute:

```bash
npm run db:reset-master
```

Esse comando exige acesso administrativo à conexão do banco; revoga as sessões do Master e exige nova troca. A recuperação não é exposta pela API pública.

## Publicação na Vercel

1. Extraia o projeto e envie os arquivos para um repositório privado de sua escolha. A pasta raiz é a que contém `package.json`.
2. Importe o repositório na Vercel. Escolha o preset **Next.js**, Node.js **22.x**, instalação `npm ci` e build `npm run build`. O `vercel.json` já define o framework, a região e o limite da função.
3. Em **Settings → Environment Variables**, configure `DATABASE_URL` e `APP_URL` para o ambiente de produção. `APP_URL` deve ser a origem da URL atribuída ao projeto ou do domínio próprio. Não cadastre a senha temporária do Master na Vercel; ela só é necessária no bootstrap local.
4. Execute `db:migrate` e `db:bootstrap` em um terminal confiável, com o `.env.local` apontando para o banco correto. Essas rotinas não rodam automaticamente em cada build.
5. Faça o deploy e confira `/login`. Entre como Master, troque a senha, cadastre Admins/Auditores e importe o histórico.
6. Para deployments de Preview, use outro branch/banco Neon e ajuste `APP_URL` para aquela origem. As sessões usam cookie Secure em produção; acesse por HTTPS.

O build funciona sem conexão ao banco. Isso permite validar o código antes de disponibilizar credenciais. Nenhuma credencial Neon acompanha esta entrega. **O projeto foi preparado, mas não foi publicado na sua conta Vercel nem conectado ao Neon real neste ambiente.**

Para conferir o painel Neon com o ChatGPT no Chrome, use `docs/Prompt_ChatGPT_Chrome_Neon.txt`. O roteiro coleta apenas informações técnicas e estrutura de tabelas, sem senhas e sem alterações no banco.

## Importação dos arquivos recebidos

O pacote inclui `data/historico-original.tsv`, preservando o arquivo de origem, e `data/validacao-historico.json` com o diagnóstico por linha.

| Resultado | Quantidade |
| --- | ---: |
| Linhas de origem | 2.037 |
| Notas válidas | 1.925 |
| Duplicidades idênticas ignoradas | 22 |
| Linhas conflitantes separadas para correção | 90 |
| Auditorias formadas pelos registros válidos | 391 |
| Avisos | 4 |

Período: janeiro/2025 a junho/2026. Três avisos corrigem o ano `#VALOR!` usando a data válida. Um aviso sinaliza as grafias “Gerente de Usinas” / “Gerente de Usina”, mantidas como setores distintos para evitar uma fusão indevida.

Entre os conflitos há notas 0 e 100 para o mesmo setor/data/senso. Nenhuma versão foi escolhida automaticamente. O relatório contém as linhas para correção na planilha original. Os registros restantes de uma auditoria parcial são preservados; uma média geral só existe quando os cinco sensos estão disponíveis.

Pelo sistema: **Importar histórico → selecionar arquivo → validar → revisar relatório → confirmar**. Para importar apenas as notas válidas, marque explicitamente a opção de separar as inconsistências. Após corrigir as linhas conflitantes, importe o arquivo corrigido; notas iguais existentes serão ignoradas e notas diferentes bloquearão a transação inteira.

Pelo terminal:

```bash
# Somente validar, sem conexão ou gravação no banco:
npm run import:history

# Gravar exclusivamente os registros válidos, separando conflitos:
npm run import:history -- --commit --valid-only

# Importar outro arquivo já corrigido:
npm run import:history -- caminho/arquivo.tsv --commit
```

A importação do arquivo original foi executada e validada no PostgreSQL de testes: **1.925 notas em 391 auditorias**. Essa execução não alterou o Neon real. Dados agregados não geram respostas fictícias às 23 perguntas.

## Perfis e fluxo

| Ação | Master | Admin | Auditor |
| --- | :---: | :---: | :---: |
| Dashboard e exportação | Sim | Sim | Não |
| Planejar auditoria | Sim | Sim | Não |
| Ver auditorias | Todas | Todas | Somente atribuídas |
| Preencher avaliação | Todas em edição | Quando designado | Somente atribuídas |
| Revisar/devolver/finalizar | Sim, quando não é o auditor | Sim, quando não é o auditor | Não |
| Importar histórico e gerir cadastros/usuários | Sim | Não | Não |

**Planejada → Em andamento → Em revisão → Finalizada.** A devolução retorna para Em andamento e exige um motivo de pelo menos cinco caracteres. Após o envio, as respostas e fotos ficam bloqueadas até eventual devolução. Auditorias finalizadas não podem ser editadas pelo formulário. Histórico parcial pode receber apenas notas faltantes por uma nova importação, sem sobrescrever qualquer nota existente.

Rascunhos preservam inclusive comentários de perguntas sem nota. As gravações usam revisão otimista; uma sessão desatualizada recebe conflito, em vez de substituir silenciosamente o trabalho de outro usuário. Atualizações de fotos preservam a revisão associada às respostas locais.

## Segurança e armazenamento

- Credenciais em variáveis de ambiente, SQL parametrizado e transações PostgreSQL.
- Cookies HttpOnly, SameSite e Secure em produção; banco guarda somente o hash do token aleatório.
- Mudanças de senha e desativação revogam sessões. As gravações revalidam autorização sob bloqueio da mesma linha de usuário alterada pela revogação, incluindo requisições autenticadas anteriormente.
- Proteção de origem nas operações de alteração; ajuste `APP_URL` corretamente se aparecer “Origem da requisição inválida”.
- Fotos têm lado máximo de 1.400 pixels e até 450 KiB após recodificação; arquivo original não é armazenado. Usar bytea no Neon dispensa um serviço externo de arquivos. A capacidade deve ser monitorada conforme o volume de fotos crescer.
- Até 15 fotos por auditoria, aproximadamente 6,6 MiB no limite máximo. Para alto volume, a evolução indicada é mover os arquivos compactados para armazenamento de objetos privado e manter metadados no Neon.
- Layout de tablet e computador, navegação adaptável e botões de avaliação com área de toque ampla.
- Nenhum envio de e-mail ou WhatsApp automático é realizado; a senha temporária deve ser entregue ao usuário por canal privado.

## Validação

```bash
npm run check
npm run build
```

`check` executa TypeScript, 34 testes de domínio/segurança/importação/integração PostgreSQL/imagens/módulos e varredura de segredos. Os testes usam PGlite, um PostgreSQL em WebAssembly; não precisam do Neon nem alteram seus dados.

Foi realizada revisão técnica independente e corrigidos cinco achados: versão concorrente após anexos, autoria conflituosa no histórico, revogação concorrente, saída de formulário por links internos e observações sem nota. Os testes de regressão estão em `tests/`.

Existe também a suíte de navegador para desktop/tablet e um workflow de CI:

```bash
npx playwright install --with-deps chromium
npm run test:e2e
```

**Validação de 12/11/2026:** os 14 cenários Playwright passaram em desktop e tablet, incluindo login real, troca obrigatória de senha, painel de módulos, isolamento da Manutenção, edição de permissões e o fluxo completo de avaliação/revisão do 5S. O painel foi inspecionado visualmente em 1366×900 e 768×1024. Os testes usam apenas a prévia descartável; a homologação do deployment continua separada.

Para uma demonstração local descartável, sem Neon:

```bash
npm run dev:preview -- --port 4173
```

Abra `http://127.0.0.1:4173` (porta frontal da demonstração). Esse comando inicializa um banco de teste com o histórico válido e usuários fictícios. Um proxy local fornece uma sessão descartável de Master; `/__qa/auditor` e `/__qa/master` trocam o perfil exclusivamente na demonstração. Esses caminhos não existem na aplicação de produção e o comando recusa execução na Vercel. Não use essa demonstração para dados novos de produção; ao encerrar o processo, o banco em memória é descartado.

## Estrutura

- `app/`: páginas protegidas e API.
- `components/`: formulário, dashboard, importação e administração.
- `lib/`: regras, segurança, persistência e serviços.
- `migrations/`: criação/atualização aditiva do schema `sm5s`.
- `scripts/`: migrações, bootstrap, recuperação, importação e verificação de segredos.
- `data/`: histórico original e relatório de inconsistências.
- `tests/`: testes automatizados e suíte de navegador.
- `docs/`: especificação, plano e evidências de validação.

Referências técnicas: [Next.js — autenticação](https://nextjs.org/docs/app/guides/authentication), [Next.js — segurança](https://nextjs.org/docs/15/app/guides/data-security), [Neon — conexões](https://neon.com/docs/get-started/connect-neon), [identidade SteelMast](https://steelmast.com.br/).
