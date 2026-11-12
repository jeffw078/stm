# Planejamento, agenda e indicadores PCM

Implementação em `lib/planning-service.ts`, `lib/planning-domain.ts`, `lib/metrics.ts`, migração `020_planning.sql` e componentes `components/planning.tsx` / `components/indicators.tsx`. Não houve commit, deploy, importação de produção nem alteração do 5S nesta frente.

## Preventivas e agenda

- Planos individuais por ativo, com cópia do plano pela interface para reutilizar o modelo em outros ativos. Cada alteração cria uma versão com vigência; checklists, orientações, estimativas e materiais previstos ficam congelados. Ordens já geradas não são reescritas.
- Recorrência calculada sempre a partir da âncora original. Dia 31 usa o último dia válido e retorna ao 31 no mês seguinte. 29/02 retorna em anos bissextos. Datas operacionais são calculadas no fuso da unidade, com padrão `America/Sao_Paulo`.
- Banco garante a chave `(plan_id,asset_id,original_due_date)` e uma ordem por ocorrência. Transação e bloqueio de integridade serializam geração concorrente, edição e pausa. Geração automática usa `created_by = null`, inclusive nas reservas, eventos e histórico de status.
- Job limitado a 100 ordens, 1.000 avaliações de datas e 200 versões por execução. Cursor persistido e rotação por `last_run_at` permitem continuar a recuperação sem descartar atrasos. `limited` e os limites aparecem no retorno. Pausa preserva ocorrências existentes e o cursor; retomada recupera pendências.
- `runJob(null,asOf)` é uma entrada interna: o adaptador externo deve validar segredo antes da chamada. O serviço não autentica requisições HTTP por conta própria. `job_runs` registra execução, erro genérico e contagens. `jobRuns(actor,filters)` pagina observabilidade, identifica execução ainda aberta após 15 minutos e restringe usuários por unidade às próprias execuções. Falhas notificam Master e administradores do módulo sem mensagem técnica sensível.
- Agenda tem mês, semana e lista, paginação e reprogramação por revisão/motivo. O vencimento e a tolerância originais permanecem imutáveis. A carga semanal considera todas as ordens não finalizadas da equipe, compara HH estimadas à capacidade cadastrada e informa ausência ou cobertura parcial de estimativas.

## Eventos e indicadores

- Eventos reais de falha são únicos e reutilizáveis por múltiplas ordens. Reparos, paradas e sessões de técnicos são entidades distintas. Lista de falhas retorna intervalos editáveis e IDs para vinculação. Escopo, unidade, alvo, ordem e origem preventiva também são validados em triggers do banco.
- Calendários de operação aceitam janelas semanais e vigência, inclusive turno atravessando meia-noite. Configuração específica do ativo prevalece sobre o calendário da unidade. Exposições manuais têm origem, intervalo e horas; registros sobrepostos e horas superiores ao intervalo são rejeitados.
- Cartões retornam valor, unidade, fórmula, qualidade, cobertura quando aplicável e `source_ids`. Há detalhamento por ordem e ativo, distribuições, evolução mensal, Pareto de falhas/paradas, consumo por material/unidade e custos conhecidos por categoria/ativo/centro de custo/tipo.
- A data de corte é o início do dia posterior ao último dia selecionado, no fuso de cada unidade. Histórico de status reconstrói pendências anteriores; reabertura não apaga execuções anteriores. Cancelamento não transforma ordem em serviço executado e permanece no denominador preventivo.
- MTBF usa falhas funcionais reais e exposição manual com cobertura integral do recorte. Não presume operação contínua. Sem falhas há mensagem específica e exposição conhecida; não há divisão por zero. Para vários ativos, o agregado MTBF fica indisponível porque não se presumiu população homogênea; o detalhamento individual permanece disponível.
- MTTR usa eventos reparados elegíveis e união dos intervalos efetivos, cortados no período. Falha sem intervalo confiável é excluída com cobertura. Disponibilidade usa união das paradas por ativo intersectada com janelas de operação. O consolidado pondera equipamento-hora, sem média simples de percentuais.
- HH simultâneo de técnicos é somado. Backlog usa estimativa remanescente conhecida; semanas requerem cobertura de estimativas e capacidade de todas as equipes envolvidas.
- Aderência usa vencimento/tolerância originais; reprogramação não melhora o prazo. Canceladas permanecem elegíveis; exclusões são zero. Filtro de status administrativo não remove ocorrências do denominador.
- Custos dependem de `costs.read`; respostas sem essa permissão não incluem cartões ou gráficos monetários. Custos conhecidos usam snapshots dos apontamentos, materiais líquidos de devoluções e terceiros conhecidos; ausência de taxa ou custo não é transformada em zero.
- Estoque usa a data de fotografia mais recente do material até o corte e preserva referência/origens. Dentro dessa data, uma chave física (material/unidade de medida/unidade operacional/estabelecimento/depósito normalizado/lote) tem uma única versão canônica: lote de importação confirmado mais recentemente, depois criação do lote, ID do lote, linha e ID de origem como desempates determinísticos. Reenvios alterados da mesma data substituem a versão da chave em vez de somar estoque. Chaves distintas nessa fotografia são somadas somente se a unidade de medida coincidir com o catálogo. Não se misturam datas de fotografia para completar chaves ausentes: a cobertura da fotografia continua declaradamente desconhecida. `alternatives_excluded` informa versões descartadas no resultado.
- Consumo PCM e reservas não são subtraídos do saldo externo nem somados aos movimentos importados sem conciliação. Quantidades de unidades diferentes não são agregadas.

## Verificação

Comando: `node --import tsx --test apps/pcm/tests/planning-domain.test.ts apps/pcm/tests/metrics.test.ts apps/pcm/tests/planning.test.ts`.

Dez testes aprovados com PGlite e dados sintéticos: dia 31/bissexto/fuso, meia-noite/intervalos abertos e sobrepostos, dados insuficientes, denominador zero, falha única versus ordens, HH simultâneo, histórico no corte, preventiva/cancelamento, custos parciais/privacidade, fotografia de estoque e substituição de reenvio alterado na mesma data, geração concorrente/idempotente, pausa/retomada, reprogramação com revisão, congelamento de versão, recuperação limitada, rollback com execução observável, autorização/unidade e solicitações/ordens por localização em unidade sem ativos.

`npx.cmd tsc --noEmit --pretty false` passou após a integração dos componentes. O Windows sandbox bloqueia `os.userInfo` usado pelo tsx; testes foram executados com escalonamento autorizado. A inspeção visual e a navegação integradas pertencem à frente raiz.

## Limites explícitos

- Produção precisa aplicar migrações e configurar o agendador externo e seu segredo. O job nunca depende de abrir uma tela.
- Fotografia sem data, calendário ausente, exposição incompleta ou capacidade desconhecida permanecem dados insuficientes. Exposição parcialmente cortada não é interpolada; registre um intervalo adequado ao recorte.
- Confiabilidade não é silenciosamente filtrada por tipo/status/prioridade/equipe/responsável de ordem; a população e os filtros aplicáveis são expostos. Estoque por ativo depende de aplicabilidade cadastrada.
- Agenda e seletores paginam; períodos com mais de 100 ocorrências exibem paginação também na visão de calendário. Capacidade representa a capacidade líquida informada, não presença confirmada, férias ou escala individual.
- Eventos de parada dependem de registro operacional completo; ausência de registros não comprova ausência de falhas ou indisponibilidade. Não há OEE, sensores, gatilhos por horímetro nem estimativa fictícia de exposição.
