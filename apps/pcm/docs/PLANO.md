# PCM — plano de execução e progresso

Fonte integral: `REQUISITOS.txt`, fornecida em 12/11/2026. Todas as etapas estão autorizadas nesse pedido; decisões rotineiras são tomadas durante a execução.

## Arquitetura e contratos

O projeto existente é Auditoria 5S em Next.js 16/React 19/TypeScript, PostgreSQL via `pg`, sem ORM ou workspaces. O PCM fica em `apps/pcm` e usa o host Next existente por adaptadores finos de página/API em `/pcm` e `/api/pcm`. Não será criado um segundo login nem movidas as rotas antigas. O módulo estável é `maintenance`, já concedido à Michelli e independente de `5s`.

Domínio próprio no schema `pcm`; migrações próprias aplicadas por comando separado. Compartilhados: usuários/sessões, conexão/pool, unidades/setores existentes, `Shell`, `Notice`, `Loading`, botões/tabelas/formulários e CSS. Empresa única; escopo operacional por unidade. Nenhuma unidade enviada pelo cliente define autorização: o servidor resolve as concessões e valida todas as relações. Master e administrador do módulo têm todas as unidades; usuários comuns recebem perfil e unidades no cadastro PCM.

## Etapas

1. Base e contratos: linha de base, isolamento, autorização granular, unidades/equipes, transações e auditoria.
2. Núcleo: ativos e árvore, históricos, solicitações, ordens, execução, tempos, materiais, respostas e manuais privados.
3. Agenda e indicadores: planos versionados, calendário fixo, job autenticado/idempotente, eventos de falha e exposição, intervalos e indicadores rastreáveis.
4. Importação: XLSX/CSV, sete abas, staging revisável, conciliação, arquivo privado, idempotência e fontes separadas.
5. Integração: páginas completas no mesmo design, APIs, configurações, acesso da Michelli e QR autenticado.
6. Verificação: testes PostgreSQL/fluxos críticos, regressão 5S, navegação desktop/celular, inspeção visual, build e documentação de implantação.

Partes com contratos estáveis e arquivos exclusivos podem ser desenvolvidas por agentes em paralelo, conforme a habilidade de divisão de tarefas. Não alterar arquivos de outra frente sem coordenar. Nenhum commit, reset, deploy ou importação de produção é parte da execução.

## Contrato de serviços

- Base `lib/base.ts`: `PcmActor` (Actor compartilhado), `Context` com `actor`, `role`, `permissions: string[]`, `unitIds: string[] | null`, `teamIds: string[]`; `withContext(db,actor,permission,fn(q,ctx))`; `requirePermission(ctx,permission)`; `ensureUnit(ctx,id)`; `scopeSql(ctx,column,values)`; `event(q,ctx,kind,id,action,detail)`; `revision(row,expected)`; `pagination(input)` e `pageResult(rows,total,args)`; `uid()`.
- Toda operação pública de serviço recebe `actor` primeiro e valida novamente o contexto no servidor. Todas as escritas passam por `withContext`, que verifica sessão/revogação sob bloqueio da identidade, valida a permissão e abre transação. Valores monetários/quantidades são strings decimais e colunas numeric.
- Serviço do núcleo em `lib/core-service.ts`, exporta `CoreService` e `insertOrder(q,ctx,input)` para geração preventiva. Métodos detalhados em `INTERFACES.md`.
- Serviço preventivo/indicadores em `lib/planning-service.ts`, exporta `PlanningService`; importação em `lib/import-service.ts`, exporta `ImportService`.
- APIs próprias adaptam somente esses serviços. Objetos de detalhe incluem relações e eventos autorizados; custos são removidos das respostas se faltar `costs.read`.

## Decisões e dependências

- `manut.xlsx` foi disponibilizada na raiz pelo usuário durante a execução. Sete abas validadas e importação real exercitada em PGlite descartável; contagens, hash e decisões em `IMPORTACAO-RELATORIO.md`. Nenhuma importação em produção.
- Sem DATABASE_URL local; preservar a configuração existente e entregar migrações prontas. Executar testes com PGlite.
- Manuais/arquivos: adaptador privado local para desenvolvimento e S3 compatível configurável para produção. Nunca disco público/efêmero em produção. Job externo por endpoint com segredo próprio e script de execução; não depende do navegador.
- Horímetros/ciclos e seus gatilhos ficam como expansão; exposição operacional manual por intervalo tem origem e validação, sem presumir funcionamento. O agendamento por calendário é entregue integralmente.

## Progresso

- Etapas 1–6 concluídas no ambiente disponível: base, núcleo, planejamento/indicadores, importação, integração e verificação. Alterações anteriores do painel geral preservadas, sem commit/reversão. Linha de base e regressão: 34 testes do host; PCM: 31 aprovados na suíte mais um teste dirigido de armazenamento privado, além da planilha real opt-in aprovada. Revisão independente e correções concluídas. 24 cenários únicos de navegador validados por passagem conjunta/retestes, incluindo fluxos de 390 px. Build final sem avisos, manifests sem dados privados; evidências em `VALIDACAO.md`. Aplicação das migrações no Neon, bucket S3 e ativação de cron dependem do ambiente externo e não foram executadas em produção.
