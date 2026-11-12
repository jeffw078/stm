# Verificação de navegador PCM

Suíte preparada em `tests/e2e/pcm.spec.ts`, usando a configuração Playwright existente, um worker e os projetos desktop/tablet. Todos os dados são sintéticos e exclusivos de cada execução. Não utiliza o workbook real nem acesso ao Neon.

Cinco cenários exercitam:

1. Cadastro real de ativo pela interface, preservação de zeros à esquerda, pesquisa/detalhe, QR autenticado e PDF privado via multipart com leitura de bytes e bloqueio ao auditor 5S.
2. Usuários solicitante/técnico criados na API central, concessões PCM de unidade, troca real de senha temporária, abertura de chamado por solicitante na interface, isolamento de outro solicitante, conversão/atribuição pela interface e conversão repetida, atendimento atribuído, hora de trabalho via API, comentário público/nota interna, execução e encerramento na interface. Verifica resposta ao solicitante e bloqueio a outra unidade.
3. Plano preventivo com checklist obrigatório/opcional pela interface, calendário operacional pela interface e indicadores com MTBF ausente quando não existe exposição. Exercita lista da agenda.
4. CSV sintético com código textual em staging, tela de revisão, aprovação/confirmação via API e catálogo resultante.
5. Isolamento 5S/PCM em páginas e APIs, navegação em 390px nas seções principais sem overflow horizontal e bloqueio sem sessão válida.

Comboboxes são localizados por papel e nome exato. Dados assíncronos aguardam opções/respostas e assertions; não há sleeps. Solicitações POST enviam Origin e usam as sessões reais do preview descartável.

Para executar: `npm run pcm:test:e2e`. A configuração existente executa cinco cenários em desktop e tablet, totalizando dez. A passagem conjunta de regressão usa `npm run pcm:test:e2e -- tests/e2e/auditoria.spec.ts tests/e2e/modulos.spec.ts`, totalizando 24 casos. A execução foi liberada pelo integrador depois de o preview aplicar as migrações PCM em PGlite descartável.

Problemas identificados e corrigidos pelo integrador: edição de componente sem reenviar parent_id conflitava com validação de movimentação; STOP de trabalho na interface não enviava revisão da sessão; seletor de ativo/material não tinha nome acessível porque o label envolvia dois controles. O cenário de trabalho usa RECORD completo, cuja API recebe início/fim e chave de idempotência. Os seletores mantêm asserts por papel e nome exato após a correção de acessibilidade.

Durante a primeira execução houve respostas de sessão inconsistentes no socket PGlite com pool concorrente. Diagnóstico reproduzido pelo integrador: oito erros em 36 leituras de contexto (seis 401 e dois 503). A correção limita o pool a um cliente somente quando `SM5S_LOCAL_PREVIEW=1` fora de produção. Após reiniciar, seis ondas de seis GET de contexto simultâneos retornaram 36 respostas 200, zero erros. O pool PostgreSQL de produção mantém três clientes. Falhas do preview não foram contornadas por retries de autenticação nos testes.

Na passagem intermediária, todos os cinco casos tablet passaram; no desktop passaram ativo/QR/manual e staging CSV. Dois casos desktop haviam executado antes da correção do nome acessível; o caso visual atingiu o orçamento original de 120 segundos após capturas e compilação inicial. O orçamento desse caso foi ajustado para 180 segundos.

Passagem conjunta de 24 casos: 23 passaram em 11,7 minutos, incluindo todos os dez PCM. A única falha foi o caso de cartões dos módulos no desktop, ainda com o orçamento original de 15 segundos para uma API PCM fria; o trace mostrou quatro requisições ainda pendentes, sem erro HTTP. O integrador manteve o heading durante o carregamento e ajustou o expect da configuração para 30 segundos. O reteste direcionado usa `--grep 'tablet.*pcm.spec.ts|login abre painel' --output=test-results/pcm-retest`, selecionando sete casos, sem repetir os outros 17.

Para a aceitação de campo, o projeto chamado `tablet` na configuração existente passa a usar 390×844 apenas dentro de `pcm.spec.ts`. Os testes 5S conservam 768×1024. Contextos adicionais de solicitante e técnico herdam o viewport da página do gestor, de modo que a abertura e o atendimento completos também são executados em 390 pixels. O stdout inclui `PCM_VIEWPORT` em cada um dos cinco cenários de celular.

Evidências de execução: `data/private/pcm-e2e-final.log` preserva a cauda da passagem conjunta e seu resumo (a captura foi solicitada quando a execução já estava no vigésimo caso); `data/private/pcm-e2e-retest.log` preserva integralmente stdout/stderr dos sete retestes via Tee-Object e o exit code do comando. Esses logs são privados e não entram no Git.

## Resultado final

- Passagem conjunta: 23 passaram e um timeout de compilação fria em 11,7 minutos. Todos os dez PCM passaram nessa execução.
- Retestes direcionados: sete passaram em 4,6 minutos, zero falhas, exit code 0. Incluem o caso de cartões dos módulos nos dois projetos e os cinco fluxos PCM completos em 390×844. Comando: `npm.cmd run pcm:test:e2e -- tests/e2e/modulos.spec.ts --grep 'tablet.*pcm.spec.ts|login abre painel' --output=test-results/pcm-retest`.
- Resultado combinado após as correções: 24 cenários únicos validados, sendo dez PCM e 14 de regressão do host. A evidência é a passagem conjunta mais o reteste direcionado; não é uma única passagem 24/24.
- Typecheck final: `node node_modules/typescript/bin/tsc --noEmit --pretty false`, exit code 0.
- Playwright e preview encerrados. Conexão TCP verificou portas 4173, 4174 e 5439 fechadas antes de liberar o build ao integrador. Não foi executado build concorrente com o preview.
- Quatro capturas preservadas e inspecionadas com view_image; formulários e shell PCM seguem o padrão visual 5S em desktop e celular.

Capturas são geradas em `test-results/pcm-visual`: `5s-form-desktop.png`, `5s-form-mobile.png`, `pcm-form-desktop.png` e `pcm-form-mobile.png`. A comparação visual usa o formulário real de planejamento 5S e o cadastro de ativo PCM, nas larguras 1366 e 390 pixels. As quatro capturas foram inspecionadas com view_image: mesma barra lateral/cabeçalho, identidade verde, cartões, tipografia, bordas, botões e campos; no celular, formulário em coluna única e tabelas PCM contidas em scroll local. As capturas 5S usam apenas a viewport para não incluir as centenas de linhas históricas abaixo do formulário; PCM mantém a página completa para revisar todos os campos.
