# Dicionário do domínio PCM

Empresa única do host; unidade é escopo operacional/autorização. IDs estáveis são UUID em texto, códigos de negócio permanecem texto com zeros iniciais, datas civis são `date`, instantes `timestamptz`, dinheiro/quantidades `numeric` com até seis casas. `revision` implementa concorrência otimista; não substitui bloqueios e constraints nas operações críticas.

| Entidades no schema pcm | Finalidade e relações |
| --- | --- |
| schema_migrations / integrity_lock | Versões aditivas aplicadas; bloqueio transacional para hierarquia e geração. |
| memberships | Usuário compartilhado, perfil, unidades, equipes, concessões extras e revisão. Sem concessão central de Manutenção não autoriza acesso. |
| teams / settings | Equipe por unidade, capacidade semanal conhecida; validação de encerramento, fuso e prefixo opcional de código. |
| assets | Ativo físico, pai opcional, unidade/setor, código único na empresa, localização/centro de custo, fabricante/série/patrimônio, criticidade, ciclo de vida e equipe. |
| asset_history | Criação/alteração/movimentação com data efetiva, motivo, autor e snapshots anterior/novo. Histórico imutável. |
| requests | Número do servidor, solicitante, problema/local/ativo, prioridade, impacto, parada percebida e vínculo opcional à ordem. Estados NEW/TRIAGED/CONVERTED/LINKED/REJECTED/CANCELLED. |
| orders | Número do servidor, alvo e snapshot histórico do caminho técnico, tipo, responsável/equipe, programação, estimativas, checklist, resposta/diagnóstico/causa/ação/resultado e estado. |
| order_status_history | Transições imutáveis com autor/data/motivo. Encerramento automático permitido somente quando a unidade desabilitou a validação; registra EXECUTED e CLOSED. |
| comments | Texto público ou nota interna, ligado à ordem ou solicitação, com autor e unidade. Notas internas não são expostas ao solicitante comum. |
| work_sessions | Apontamento próprio com início/fim, HH, taxa e custo congelados, chaves de idempotência START/RECORD e STOP. Não representa parada do ativo. |
| materials | Catálogo ERP por unidade/código, descrição, medida, fabricante/fornecedor, custo atual opcional, mínimo e segurança. Catálogo não identifica um ativo físico. |
| material_applications | Relação muitos para muitos entre material e ativo, posição/referência e quantidade prevista. |
| order_materials | Reserva, consumo ou devolução; quantidade/medida/custo congelados, consumo corrigido e chave de idempotência. Devolução mantém custo original e não excede consumo. |
| documents | Metadados e SHA-256, alvo autorizado, versão/substituição, formato, idioma e chave privada. Arquivo fora do banco; versões anteriores preservadas. |
| plans / plan_versions | Plano por ativo e versões com vigência, frequência/âncora, antecedência/tolerância, estimativas, tarefas e materiais congelados. Cursor de geração retomável. |
| occurrences | Plano/versão/ativo, vencimento e prazo originais, data reprogramada, ordem única, revisão. Unicidade plano+ativo+data original. |
| job_runs | Início/fim, estado, contagens, limite atingido e erro sanitizado das execuções. |
| failures | Evento funcional real único por ativo, início/fim, descrição e revisão. Pode ter várias ordens sem contar várias falhas. |
| repair_intervals / downtime_intervals | Intervalos efetivos distintos de reparo e parada, com classificação planejada na parada. Podem se sobrepor; indicadores fazem união apropriada. |
| operational_calendars | Janelas semanais por ativo ou unidade e vigência. Calendário específico prevalece; turno pode atravessar meia-noite. |
| exposures | Exposição manual por ativo/intervalo, horas conhecidas e origem. Não presume funcionamento 24h. |
| import_batches | Unidade/tipo, arquivo privado, SHA-256, data de referência, versão de mapeamento, estado, revisão e contagens. |
| import_lines | Aba/linha/células brutas, propostas, revisão humana, avisos, decisão/motivo/autor, fingerprint e aplicação. |
| stock_snapshots | Fotografia externa por material, estabelecimento, depósito original/normalizado, lote, medida, saldo/custo e data. Origem obrigatória no staging. |
| imported_movements | BAIXAS ou CE0302, campos originais/revisados e classificação ainda não conciliada. Não alimenta consumo PCM automaticamente. |
| purchase_lines | Pedido/ordem textual, quantidade/medida, situação e recebimento textual ou explicitamente conciliado. Saldo só quando quantidade e medida forem compatíveis. |
| notifications / audit_events | Alertas internos por usuário/unidade e trilha de ações relevantes com autor, entidade e dados essenciais. |

Confira os nomes exatos e constraints nas migrações versionadas. Campos do núcleo detalhados em [CORE-RELATORIO.md](CORE-RELATORIO.md); regras de recorrência/métricas em [PLANNING-RELATORIO.md](PLANNING-RELATORIO.md); mapeamento e conciliação em [IMPORTACAO.md](IMPORTACAO.md).

Não há exclusão física no fluxo operacional de ativos com histórico; a desativação preserva relações e evidências. Estado em manutenção/reserva/inativo é informado pelo responsável e não é inferido apenas pela existência de ordem aberta.
