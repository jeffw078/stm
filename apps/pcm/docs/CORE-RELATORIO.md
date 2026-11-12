# Núcleo PCM

Implementação em `lib/core-service.ts`, validações em `lib/core-domain.ts`, migração aditiva `migrations/010_core.sql` e testes sintéticos `tests/core.test.ts`. Não foram alteradas tabelas 5S, credenciais, dados reais ou configuração de produção.

## Comportamento e integridade

- Árvore sem limite fixo de profundidade, código único na empresa sem distinguir maiúsculas/espaços externos (migração 040), pai e equipe da mesma unidade. Trigger PostgreSQL adquire `pcm.integrity_lock` antes das escritas e rejeita ciclos e mudança da unidade do ativo. Movimentações exigem revisão, data e motivo; snapshots anteriores permanecem em `asset_history`.
- Solicitações possuem número legível separado do UUID, escopo próprio para solicitante e conversão sob bloqueio da linha. Repetir CONVERT devolve a ordem vinculada. LINK preserva múltiplos solicitantes na mesma ordem; REJECT/CANCEL exigem motivo.
- Ordens possuem número identity, status e revisão otimista. O snapshot do caminho técnico é criado dentro da transação. Um alvo inicialmente desconhecido pode ser identificado antes da primeira execução; após definido, não muda. Uma máquina movida não reescreve o contexto histórico de suas ordens. Consulta de descendentes históricos usa os IDs do snapshot, sem duplicar ordens.
- Corretivas/preventivas criadas diretamente exigem ativo na conclusão por padrão, salvo `requires_asset:false` explícito para atendimento sem equipamento. Conversão com ativo ou indicação de equipamento parado exige identificação técnica antes de EXECUTED/CLOSED. Inspeções sem equipamento podem ser classificadas explicitamente.
- Técnico acessa somente ordem atribuída ou de suas equipes, além do escopo de unidade. Pode preencher checklist sob `orders.execute`, preservando títulos/obrigatoriedade e revisão. Checklist de plano conserva sua versão mesmo para planejador.
- Notas internas e comentários visíveis são separados. A resposta disponível ao solicitante inclui resultado, condição final e recomendação; notas internas não aparecem no detalhe de solicitação própria.
- Sessões próprias de trabalho, intervalos sem sobreposição por técnico e taxa congelada no início. Horas e custo usam decimal com seis casas. Taxa desconhecida permanece null. Sessões encerradas e seus custos são imutáveis. Trabalho não é interpretado como parada do equipamento.
- Catálogo de materiais separado dos ativos. `material_applications` representa aplicabilidade de material em ativo; `order_materials` registra RESERVATION/CONSUMPTION/RETURN da ordem. A devolução referencia consumo original, mantém seu custo e não excede o saldo consumido. Constraints compostas impedem cadeias de correção de outra unidade/ordem/material. Custos e quantidades históricas não são atualizados pelo catálogo.
- Custos conhecidos de terceiros são registrados em `external_cost` no apontamento, sob `costs.write`, e aparecem separadamente nos indicadores e na ordem. Serviço sem peça pode usar item de serviço no catálogo, com unidade própria e sem cadastro de ativo físico. Não há emissão automática de compras ou contratação externa.
- `work` e `applyMaterial` aceitam `idempotency_key` opcional, adicional ao contrato inicial. A interface deve criar uma chave por ação e mantê-la nas tentativas da mesma operação. START e STOP são ações distintas; STOP possui chave própria para poder ser repetido após encerrar a sessão. Sem chave, dois consumos iguais são eventos legítimos distintos e não são eliminados por semelhança.
- Custos são removidos recursivamente das respostas quando falta `costs.read`; fornecer custo/taxa exige `costs.write`. Numeric do PostgreSQL preserva strings decimais.
- PDF, JPEG, PNG e WebP validam assinatura e tamanho no servidor. Manual exige PDF/ativo. Arquivos ficam no adaptador privado; banco guarda metadados, SHA-256 e referência. Substituição conserva versão anterior. Falha da transação remove objeto recém-enviado. Listagem de manuais ancestrais indica `inherited` e `source_asset_id`.
- Auditoria e notificações internas são persistidas. `overview` consulta dados reais por unidade e atribuição.

## Contratos para integração

Detalhes conservam campos flat e incluem aliases: ativo `{asset,children,ancestors,applications,movements,events}`, ordem `{order,status_history,events,comments,work_sessions,materials,requests}` e solicitação `{request,events,comments,order}`. Listagens retornam `{rows,total,page,pageSize}`.

`overview(actor)` retorna `{assets:[{lifecycle,count}],requests:[{status,count}],orders:[{status,count,overdue}]}`. `documents(actor,target)` retorna array com metadados sem chave de storage. `document(actor,id)` faz autorização novamente e retorna metadados incluindo `storage_key`, `filename` e `mime_type` para o adaptador de download; não retorna bytes. Links externos aceitam apenas HTTPS e não são buscados pelo servidor.

`insertOrder(q,ctx,input)` não abre outra transação e suporta `systemContext()`: autor interno fica null. O gerador preventivo usa esse método e reserva seus materiais na mesma transação.

### Campos essenciais

Todos os nomes persistidos e entradas/saídas são snake_case. IDs são text UUID. Instantes usam timestamptz, datas de calendário usam date, quantidades/dinheiro usam numeric(20,6).

- `assets`: `id,unit_id,sector_id,parent_id,code,name,description,node_type,location,cost_center,manufacturer,model,serial_number,patrimony,material_code,category,acquired_on,installed_on,lifecycle,criticality,criticality_reason,team_id,notes,revision,created_at,updated_at`.
- `orders`: `id,number,unit_id,asset_id,location,description,type,priority,status,assignee_id,team_id,planned_start,due_at,estimated_hours,estimated_person_hours,failure_id,requires_asset,checklist,plan_version_id,occurrence_id,asset_snapshot,summary,result,final_condition,diagnosis,cause,cause_unknown_reason,action_taken,recommendation,created_by,revision,created_at,updated_at,executed_at,closed_at`. `asset_snapshot.path` é uma lista raiz→alvo de `{id,code,name}`; snapshot também conserva unidade, localização, setor e centro de custo. FK de falha é adicionada pela migração020.
- `requests`: `id,number,unit_id,sector_id,asset_id,location,description,impact,stopped,priority,status,requester_id,order_id,reason,revision,created_at,updated_at`.
- `work_sessions`: `id,unit_id,order_id,user_id,started_at,ended_at,hours,hourly_rate,cost,idempotency_key,stop_idempotency_key,revision,created_at`.
- `materials`: `id,unit_id,code,name,description,manufacturer,manufacturer_reference,supplier,unit,minimum_quantity,safety_stock,unit_cost,notes,active,revision,created_at,updated_at`. Chave única `(unit_id,lower(code))`; `name` é obrigatório e `description` complementar.
- `material_applications`: `id,unit_id,asset_id,material_id,position,expected_quantity,created_at`; chave única `(asset_id,material_id,position)`.
- `order_materials`: `id,unit_id,order_id,material_id,quantity,unit,unit_cost,cost,external_cost,kind,reservation_id,corrects_id,reason,idempotency_key,created_by,created_at`. Devolução tem quantidade positiva e custo total negativo. Reservas não são baixa de estoque e devem ser excluídas dos custos realizados.
- `documents`: `id,unit_id,asset_id,order_id,request_id,title,kind,filename,mime_type,language,version,manufacturer,document_date,replaces_id,external_url,storage_key,size,sha256,current,created_by,created_at`.
- `asset_history`: `id,asset_id,unit_id,action,effective_date,reason,old_snapshot,new_snapshot,actor_id,created_at`.
- `order_status_history`: `id,order_id,from_status,to_status,reason,actor_id,created_at`.
- `comments`: `id,unit_id,request_id,order_id,body,internal,actor_id,created_at`.

## Verificação e limites

Comando: `node --import tsx --test apps/pcm/tests/core.test.ts`. PGlite executa as migrações PostgreSQL reais em bancos sintéticos isolados. Os cenários cobrem árvore com 20 níveis, ciclo por serviço e SQL direto, histórico após mudança de máquina, acesso por unidade, solicitação própria, conversão repetida, notas privadas, conflito de revisão, atribuição individual/equipe, horas sobrepostas, custos congelados, material/devolução repetida, arquivos privados/versões/revogação, checklist técnico, encerramento/reabertura e identificação pendente de equipamento.

A suíte inicial passou com sete testes. A revisão acrescentou o encerramento configurável e a proteção da origem preventiva, totalizando oito testes do núcleo aprovados; a última execução dirigida incluiu também apresentação/CSV (nove aprovados, zero falhas). O ambiente sandbox falha em `node:os.userInfo`; os testes foram executados com a elevação aprovada para esse comando. Tipos e suíte integrada do host/PCM também passaram; resultados consolidados em `VALIDACAO.md`.

PGlite serializa conexões da fixture e não prova disputa entre duas conexões PostgreSQL independentes. O mecanismo de banco para isso é o bloqueio transacional explícito em `integrity_lock`; a prova de carga com conexões independentes Neon/PostgreSQL continua apropriada na homologação. Não houve DDL/importação no Neon nem teste de S3 real; os uploads sintéticos foram validados com armazenamento privado local e removidos ao final. Produção requer storage privado durável configurado pelo integrador. Não há sincronização de estoque/ERP, e trabalho registrado não inventa disponibilidade ou exposição operacional.
