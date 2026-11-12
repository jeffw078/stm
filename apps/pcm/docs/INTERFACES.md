# Contratos de integração PCM

`Row` e `Database/Queryable`: imports relativos de `../../../lib/db`. `Actor` e `AppError`: `../../../lib/domain`. A base pública é `./base`. IDs text UUID. Datas calendário `YYYY-MM-DD`; instantes ISO com offset. Campos do banco snake_case; entrada/saída usa snake_case também para reduzir conversões. Entradas Zod strict, campos opcionais null quando desconhecidos. Listagens: `{rows,total,page,pageSize}`. Filtros: `page,pageSize,search,unit_id,asset_id,status,type,priority,assignee_id,from,to,include_descendants`.

## CoreService(db)

- `catalog(actor)`: unidades/setores/equipes/usuários autorizados para seleções.
- `assets(actor,filters)`, `asset(actor,id)`, `saveAsset(actor,input,id?)`, `moveAsset(actor,id,{parent_id,effective_date,reason,revision})`, `assetHistory(actor,id,filters)`.
- Ativo: `unit_id,sector_id?,parent_id?,code,name,description?,node_type` (MACHINE/SYSTEM/ASSEMBLY/COMPONENT/ITEM), `location?,cost_center?,manufacturer?,model?,serial_number?,patrimony?,material_code?,category?,acquired_on?,installed_on?,lifecycle` (ACTIVE/MAINTENANCE/RESERVE/INACTIVE), `criticality` (HIGH/MEDIUM/LOW), `criticality_reason?,team_id?,notes?,revision?`.
- `requests(actor,filters)`, `request(actor,id)`, `createRequest(actor,{unit_id,sector_id?,asset_id?,location?,description,impact?,stopped?,priority?,...})`, `triageRequest(actor,id,{action,reason?,order_id?,revision,...})`. Actions TRIAGE/CONVERT/LINK/REJECT/CANCEL; CONVERT devolve ordem idempotentemente.
- `orders(actor,filters)`, `order(actor,id)`, `createOrder(actor,input)`, `updateOrder(actor,id,input)`, `transitionOrder(actor,id,{to,reason?,revision,summary?,result?,final_condition?,diagnosis?,cause?,cause_unknown_reason?,action_taken?,recommendation?})`.
- Ordem: `unit_id,asset_id?,location?,description,type` (CORRECTIVE/PREVENTIVE/INSPECTION), `priority` (LOW/NORMAL/HIGH/URGENT), `assignee_id?,team_id?,planned_start?,due_at?,estimated_hours?,estimated_person_hours?,failure_id?,requires_asset?,checklist?,plan_version_id?,occurrence_id?`.
- Status: PLANNED/SCHEDULED/IN_PROGRESS/WAITING/EXECUTED/CLOSED/CANCELLED; reabrir CLOSED para IN_PROGRESS exige motivo e permissão.
- `comment(actor,{request_id?,order_id?,body,internal?})`, `work(actor,orderId,{action,started_at?,ended_at?,hourly_rate?,revision?})`: START/STOP/RECORD, sessões próprias/atribuídas; RECORD recebe intervalo completo.
- `applyMaterial(actor,orderId,{material_id,quantity,unit,unit_cost?,kind,reservation_id?,corrects_id?,reason?,external_cost?})`: kind RESERVATION/CONSUMPTION/RETURN; devolução referencia consumo, limite acumulado, mantém custo original.
- `materials(actor,filters)`, `saveMaterial(actor,input,id?)`, `linkMaterial(actor,{asset_id,material_id,position?,expected_quantity?})`; catálogo separado dos ativos.
- `documents(actor,{asset_id?,order_id?,request_id?})`, `addDocument(actor,input,bytes:Buffer)`, `document(actor,id)` metadados autorizados para adaptador de storage. Document fields: `title,kind` (MANUAL/PHOTO/ATTACHMENT), `asset_id?/order_id?/request_id?,filename,mime_type,language?,version?,manufacturer?,document_date?,replaces_id?,external_url?`. Storage shared: root disponibiliza `privateStore():{put(key,bytes,mime),get(key),remove(key)}` em `lib/storage.ts`; valida assinatura PDF/JPEG/PNG/WebP e limite no serviço.
- `notifications(actor)`, `markNotification(actor,id)`.
- Export `insertOrder(q,ctx,input):Promise<Row>`: usado pelo gerador preventivo, deve validar escopo/alvo e criar contexto snapshot. Não abre transação separada.

## PlanningService(db)

- `plans(actor,filters)`, `plan(actor,id)`, `savePlan(actor,input,id?)`, `setPlanActive(actor,id,{active,reason,revision})`.
- Plano: `code,name,unit_id,asset_id,description?,frequency_unit` (DAY/WEEK/MONTH/YEAR), `frequency_count,start_date,end_date?,lead_days,tolerance_days,assignee_id?,team_id?,estimated_hours?,estimated_person_hours?,requires_stop?,tasks:[{title,required}],materials?:[{material_id,quantity,unit}],revision?`.
- `agenda(actor,filters)` retorna ocorrências com `{rows,total,page,pageSize}`, janela from/to datas de calendário. `reschedule(actor,id,{scheduled_date,reason,revision})` mantém original_due_date.
- `runJob(actorOrNull,asOf?:string)` job actor null significa execução interna autorizada pelo endpoint/script com segredo previamente validado; não aceita null vindo de API comum. Retorna contagens e run_id, limites e execuções observáveis. Exportar também serviço de job sem actor separado se necessário.
- `failure(actor,input,id?)`: `unit_id,asset_id,started_at,ended_at?,functional_loss,description,repair_intervals:[{start,end}],downtime_intervals:[{start,end?,planned}]`; falha única reutilizável por ordens.
- `saveCalendar(actor,{unit_id,asset_id?,name,weekly_windows:[{day,start,end}],valid_from,valid_to?})`, `recordExposure(actor,{unit_id,asset_id,started_at,ended_at,operating_hours,source})`, `saveCapacity(actor,{unit_id,team_id,weekly_hours})`.
- `indicators(actor,filters)` inclui cartões com valor/unidade/definição/qualidade/source_ids, distribuições, mensal, pareto e detalhes. Nunca afirmar exposição/capacidade inexistente. Unir/cortar intervalos; trabalhar com falhas, não contagem de ordens para MTBF/MTTR.

## ImportService(db)

- `preview(actor,{unit_id,filename,source_date?,kind?},bytes:Buffer)` XLSX/CSV; persiste staging e arquivo privado, retorna lote com abas, contagens, linhas/problemas pagináveis e avisos. Workbook real disponibilizado na raiz e validado em banco descartável: evidências em `IMPORTACAO-RELATORIO.md`.
- `batches(actor,filters)`, `batch(actor,id,filters?)`, `review(actor,batchId,{line_id OU line_ids OU selection,status,values?,reason?,revision})` status APPROVED/REJECTED/PENDING; seleções e limites detalhados em `IMPORTACAO.md`.
- `confirm(actor,id,{revision})` transacional/idempotente, somente linhas aprovadas, pendentes permanecem staging. `report(actor,id)` autorizado, CSV seguro.
- Tabelas `pcm.materials` e `pcm.material_applications` do núcleo são reusadas. Importador cria suas tabelas de stock snapshots, imported movements, purchase lines, staging e batches em migração 030.
- `references(actor,'stock'|'purchases'|'movements',filters)` lista referências aplicadas por origem/unidade, com paginação real e ocultação de custos conforme permissão.
- Parser `lib/workbook.ts` com funções independentes testáveis; bibliotecas disponíveis `fflate`, `fast-xml-parser`, `decimal.js`; não executar fórmulas, iterar somente células/linhas existentes, validar datas 1900/1904/formatos, códigos como texto e duplicidades.

## Segurança/base

Permissões estáveis: `assets.read`, `assets.write`, `requests.create`, `requests.own`, `requests.all`, `requests.triage`, `orders.read`, `orders.assign`, `orders.execute`, `orders.close`, `orders.reopen`, `orders.cancel`, `orders.respond`, `plans.manage`, `costs.read`, `costs.write`, `materials.read`, `materials.write`, `imports.preview`, `imports.confirm`, `indicators.read`, `export`, `settings.manage`, `access.manage`, `documents.read`, `documents.write`.

Papéis: REQUESTER/TECHNICIAN/PLANNER/MANAGER/VIEWER; resolvidos na base, sem condicionais espalhadas. MASTER e `maintenance.level=ADMIN` recebem todas. Comuns exigem cadastro em `pcm.memberships`, com unidades explícitas. Base cria `pcm.teams`, `pcm.memberships`, `pcm.audit_events`, `pcm.notifications`, `pcm.settings`, `pcm.integrity_lock`. O núcleo cria todas as demais tabelas de ativos/ordens/material/documentos na migração 010. Planejamento adiciona 020; importação 030. Não editar migrações de outra frente.
