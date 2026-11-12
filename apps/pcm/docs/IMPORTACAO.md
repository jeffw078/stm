# Importação assistida PCM

O importador aceita XLSX e CSV UTF-8, preserva o arquivo em armazenamento privado e grava um lote de staging antes de qualquer aplicação. Não cria máquinas, usuários, ordens, falhas ou consumo a partir das planilhas. `manut.xlsx` foi disponibilizado na raiz durante o desenvolvimento; a validação real é opt-in e usa somente PostgreSQL descartável PGlite.

## Fluxo e API

1. `preview(actor,{unit_id,filename,source_date?,kind?},bytes)` valida a identidade, permissão `imports.preview` e unidade no servidor; lê o arquivo e persiste suas fontes. `kind` aceita `WORKBOOK` (padrão), `CATALOG`, `STOCK`, `BAIXAS`, `MOVEMENT`, `PURCHASE`. O tipo selecionado deve corresponder ao conteúdo. Arquivo idêntico na mesma unidade/tipo retorna o mesmo lote, inclusive após confirmação; mudar somente o nome não cria outro lote.
2. `batches(actor,filters)` e `batch(actor,id,filters?)` retornam paginação real. Detalhe contém `id`, `revision`, `sheets`, `warnings`, `rows`, `total`, `page`, `pageSize`, `counts`. Linhas possuem `raw`, `proposed_values`, `reviewed_values`, `issues`, `proposed_action`, `source_row`, `fingerprint` e estado. Filtros de linhas: `status` (`PENDING`, `APPROVED`, `REJECTED`, `APPLIED`), `sheet`, `search`, `page`, `pageSize` até 100. Sem `costs.read`, valores monetários e células brutas são omitidos das respostas.
3. `review(actor,id,{line_id OU line_ids OU selection,status,values?,reason?,revision})` exige `imports.confirm`. `line_ids` aceita até 500 IDs explícitos do mesmo lote. `selection:{kind:'MOVEMENT'|'BAIXAS'|'STOCK'}` aprova somente os próximos 500 pendentes da fonte, sem alteração de valores, com motivo explícito; devolve `reviewed_now` e `remaining_selection` para continuidade/pausa. Essa seleção não aceita catálogo ou interpretações de recebimento. A operação é atômica; uma linha inválida impede todas as alterações da chamada. `revision` é a versão atual do lote; versão antiga produz HTTP 409. Cada chamada incrementa a revisão uma vez. Todos os registros de negócio começam `PENDING`; auxiliares/desconhecidos ficam `REJECTED`. Aprovação de linha com avisos exige motivo de pelo menos cinco caracteres. Valores editados aceitam somente campos mapeados, datas calendário e números decimais como strings. Linhas já aplicadas não podem ser reescritas.
4. `confirm(actor,id,{revision})` aplica **até 500 linhas aprovadas** por transação. Retorna `applied_now`, nova `revision` e `counts.approved` ainda não aplicadas. Repetir com a revisão devolvida até `counts.approved === 0`. Interrupções podem retomar o lote sem duplicar linhas já aplicadas. Pendentes continuam em staging; o estado é `PARTIAL` enquanto houver pendentes ou aprovadas restantes, `CONFIRMED` quando todas foram aplicadas/rejeitadas. Conflito numa chamada reverte todas as aplicações daquela chamada. A confirmação registra ator, data, contagens e auditoria de cada transação.
5. `report(actor,id)` exige `imports.preview`, `export` e escopo da unidade; retorna CSV UTF-8 com BOM, separado por `;`, com origem, hash, data de referência, versão de mapeamento, aba/linha, problemas e revisão. Células iniciadas por caracteres de fórmula são neutralizadas. Valores monetários são retirados sem `costs.read`.
6. `references(actor,'stock'|'purchases'|'movements',filters)` exige `materials.read` e lista somente registros já aplicados e autorizados. Retorno paginado inclui `material_code`, `material_name`, `quantity`, `unit`, `source_date`, `source_reference_date`, `source_filename`, `source_hash`, `mapping_version`, `sheet`, `source_row` e campos próprios de cada fonte. Fotografia mantém estabelecimento/depósito/lote; compras mantêm quantidade/recebimento e `remaining_quantity` somente quando dados e unidades forem conhecidos; movimentos mantêm origem e classificação `UNMAPPED`. Filtros: unidade, busca, código, datas, tipo de movimento ou situação do pedido. Custos e campos monetários aninhados são omitidos sem `costs.read`. Não retorna células brutas ou chaves privadas de storage e não consolida saldo com consumo.

Quantidade/dinheiro usa strings decimais e colunas `numeric(20,6)`. O XML original permanece intacto em `raw`; números XLSX com mais de seis casas geram proposta arredondada com aviso obrigatório para revisão. `revision` nunca é inferida pelo cliente. Aplicar catálogo exige `materials.write`; aplicar seu custo ou editar valores monetários exige `costs.write`. Atualizações de catálogo existente exigem ainda `overwrite_existing: true` e motivo. Sem autorização explícita o catálogo confiável não é sobrescrito. Vínculo de aplicação usa `asset_id` selecionado/revisado e valida a unidade, sem inferir patrimônio pela narrativa.

## Mapeamento das sete abas

| Aba | Cabeçalho | Destino e critérios |
| --- | --- | --- |
| LISTA DE PEÇAS | Detectado nas primeiras 50 linhas, normalmente 4 | Catálogo `pcm.materials`; código, descrição, fornecedor, unidade, mínimo, segurança e custo. Valores de estoque, OC aberta e saldo permanecem referências distintas no staging. Narrativa/local são evidência para proposta de aplicação. Código repetido, incluindo `9000786`, exige conciliação. |
| ESTOQUE | Normalmente 1 | `pcm.stock_snapshots`; código, estabelecimento, depósito original e normalizado, lote, unidade, quantidade, custo e data de referência. Fotografia externa, sem produzir entrada ou ajustar saldo operacional. |
| BAIXAS | Normalmente 2 | `pcm.imported_movements` com `source_kind=BAIXAS` e `classification=UNMAPPED`; preserva solicitação/linha, data, quantidade, valor bruto, centro de custo e campos originais. O título PLANEJAMENTO DE COMPRAS é preservado no arquivo; a ambiguidade é sinalizada, sem fabricar ordem/consumo. |
| Insumos Manu.Pintura-Jateamento | Normalmente 1 | `pcm.purchase_lines`; ordem/pedido são texto, incluindo `119.16` e zeros iniciais. Quantidade recebida vazia fica desconhecida. Texto pode propor recebimento; aplicação exige quantidade/unidade revisadas e coerentes, nunca acima do pedido. |
| CE0302 | Normalmente 1 | `pcm.imported_movements`, `classification=UNMAPPED`; todas as espécies/sentidos permanecem importados até existir mapeamento de negócio validado. Não alimenta consumo operacional. Total na linha 1048576 sem identificador é ignorado. |
| TD_Analise | Auxiliar, oculta | Staging somente para conferência. Totais não viram movimentações. |
| VARIAVEIS | Auxiliar, oculta | Staging de meses/centros de custo/títulos para revisão. Não cria concessões de acesso ou associa unidade presumida. |

Os campos brutos preservam todas as células existentes, inclusive fórmulas e valores em cache. A aplicação utiliza somente campos explicitamente mapeados e revisados. Fórmulas em campos mapeados geram valor proposto desconhecido; cache não define dados mestres ou saldo. Fórmulas sem identificador não criam linha de negócio.

## Datas, origem e sobreposição

`import_batches.source_date` é a data de referência do extrato fornecida pelo usuário; desconhecida fica nula. Datas nas linhas BAIXAS/CE0302/compras são datas dos eventos da fonte, independentes da data de atualização da capa. O sistema de datas 1900/1904 é lido do workbook; o dia fictício 29/02/1900 é rejeitado. Datas calendário não sofrem conversão de fuso.

Cada registro aplicado referencia uma linha de staging, que referencia lote/unidade, arquivo privado, hash SHA-256 e versão `pcm-2026-11-v1`. Aba, linha original, campos brutos e decisões da revisão são preservados. Depósitos como `alm` e `ALM` mantêm seu valor original e uma versão normalizada separada.

A identidade de importação é `(unit_id,import_kind,file_hash)`. Arquivos diferentes com eventos iguais mantêm suas linhas legítimas; correspondências aproximadas/campos iguais geram aviso de sobreposição, sem exclusão automática. Possível sobreposição BAIXAS/CE0302 é sinalizada, com fontes separadas. Ainda não há identificador externo comprovadamente único nem mapeamento aprovado para transformar essas fontes em consumo. O importador deliberadamente não soma snapshots a movimentos, não desconta consumo local de fotografia externa e não calcula compra usando lead time sem unidade.

## Limites e segurança

Upload até 12 MiB; até 512 entradas ZIP, 80 MiB expandidos no total, 40 MiB por entrada, razão máxima 250 acima da tolerância de 1 MiB, 100 mil linhas efetivas e 1,2 milhão de células. A dimensão declarada da aba nunca determina a iteração. O leitor usa somente elementos `row`/`c` existentes. ZIP com caminhos inseguros/entradas duplicadas e XML com DTD/entidades são rejeitados antes do processamento. Macros, fórmulas e links externos não são executados; somente partes XML necessárias são descompactadas. CSV usa UTF-8, valores textuais e limite por registro.

Arquivo privado fica fora do banco: `privateStore()` local de desenvolvimento ou S3 compatível configurado. O banco contém somente chave privada/metadados/staging, nunca base64. Falha na transação remove o objeto recém-enviado; reimportação não cria outro objeto. Não existe download público do arquivo original. A produção exige armazenamento privado durável configurado pelo host.

## Verificação

Suíte sintética (não depende de `manut.xlsx`):

```powershell
node --import tsx --test apps/pcm/tests/workbook.test.ts apps/pcm/tests/import.test.ts
```

Validação real explicitamente opt-in, sem usar `DATABASE_URL`, sem alterar o original e sem importar em produção:

```powershell
$env:PCM_TEST_WORKBOOK='manut.xlsx'
node --import tsx --test apps/pcm/tests/import-real.test.ts
Remove-Item Env:PCM_TEST_WORKBOOK
```

O teste real usa armazenamento em memória e PGlite descartável. Confere todas as abas e staging, revisa fontes externas por blocos, confirma progressivamente sem consumo/OM, testa reimportação e confere SHA-256 inalterado do original. Catálogo/recebimentos que exigem decisão humana permanecem pendentes. O teste é ignorado quando `PCM_TEST_WORKBOOK` não está definido.
