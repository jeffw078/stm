# Relatório de implementação e validação da importação

Data: 12/11/2026. Nenhuma alteração de produção, commit ou deploy foi executado nesta frente.

## Arquivo efetivamente recebido

`manut.xlsx` tornou-se disponível na raiz durante a implementação. Foi lido sem mover ou modificar o original. Tamanho observado: **3.538.257 bytes**. SHA-256 observado e conferido novamente após a validação:

`637423a0ca444d3d306a19d74a2550c7f07974b636598ebb19e95fabb3d0c300`

| Aba real | Cabeçalho detectado | Registros de negócio | Evidência |
| --- | --- | --- | --- |
| LISTA DE PEÇAS | 4 | 124 | Duplicidade `9000786` nas linhas 35/118 vai à conciliação. |
| ESTOQUE | 1 | 595 | Fotografia separada de movimentações. |
| BAIXAS | 2 | 1.103 | Preservada como fonte ambígua, sem ordens ou consumo inventados. |
| Insumos Manu.Pintura-Jateamento | 1 | 46 | Ordem inicial `119.16` preservada como identificador textual. |
| CE0302 | 1 | 21.296 | Apenas 21.298 linhas XML existentes: cabeçalho, movimentos e fórmula final ignorada. |
| TD_Analise | Auxiliar oculta | 425 linhas auxiliares | Nenhuma nova movimentação. |
| VARIAVEIS | Auxiliar oculta | 18 linhas auxiliares | Nenhuma concessão de acesso ou unidade inferida. |

Total observado: **23.164 registros de negócio**, mais **443 linhas auxiliares**; **23.607 linhas de staging**. Não houve divergência nas contagens de negócio em relação às cinco abas quantificadas nos requisitos. As 443 linhas auxiliares são conferência, não registros adicionais de estoque/movimentos.

O arquivo real contém valores XML como `828.05290000000002`. O importador preserva essa representação original e propõe quantização decimal em seis casas, com aviso que exige revisão. Não depende de ponto flutuante binário para quantidades/dinheiro nem utiliza cache de fórmulas para definir mestre/saldo.

## Validação real em banco descartável

Comando executado (ambiente local isolado):

```powershell
$env:PCM_TEST_WORKBOOK='manut.xlsx'
node --import tsx --test apps/pcm/tests/import-real.test.ts
```

Resultado observado: **1 teste aprovado**, duração do cenário **233.695 ms**. O teste criou PostgreSQL PGlite em memória, aplicou migrações locais, utilizou armazenamento privado em memória e não utilizou `DATABASE_URL`.

O fluxo persistiu staging integral e passou por revisão autorizada em grupos de até 500 registros, seguida de **46 chamadas de confirmação**, também de até 500 por transação. Foram aplicadas somente fontes externas cujo propósito foi explicitamente a preservação como referência:

- 595 snapshots em `pcm.stock_snapshots`.
- 22.399 movimentos importados: 21.296 CE0302 + 1.103 BAIXAS, com classificação `UNMAPPED`, sem reconhecimento de consumo PCM.
- 22.994 linhas aplicadas no total; zero aprovadas restantes.
- 170 linhas de catálogo/compras permaneceram pendentes para decisões de conciliação e recebimento; 443 auxiliares permaneceram rejeitadas como fonte de novos eventos.
- Zero ordens de manutenção e zero apontamentos de consumo operacional criados.

Reenviar o arquivo devolveu o **mesmo lote**, com as mesmas contagens e um único objeto privado em memória. SHA-256 do arquivo original permaneceu idêntico. O banco e os objetos em memória foram descartados ao encerrar o teste. Esses números são resultados de validação em ambiente descartável, não representam importação realizada em produção.

## Cobertura sintética e integração

A suíte de `workbook.test.ts` cobre iteração sparse com fórmula na linha 1048576, código com zeros iniciais, documento com zeros, datas 1900/1904 e dia fictício 60, decimal brasileiro, ordem `119.16`, recebimento textual desconhecido/proposto, duplicidade de catálogo, arredondamento proposto, fórmulas preservadas, limites ZIP e XML com entidades recusado.

A suíte de `import.test.ts` cobre permissões, staging persistido, revisão otimista, confirmação parcial/idempotente, atualização de catálogo somente após autorização explícita, eventos iguais legítimos preservados em arquivos diferentes com aviso de sobreposição, snapshots separados, recebimento parcial revisado, CSV seguro, aprovação de fonte em grupos de 500, retomada, isolamento de unidade, ocultação de custos e revogação.

Última execução sintética observada: `node --import tsx --test apps/pcm/tests/import.test.ts apps/pcm/tests/workbook.test.ts apps/pcm/tests/import-real.test.ts` — **9 aprovados, 0 falhas, 1 ignorado** (real opt-in), duração total aproximada de 22 segundos.

A UI em `components/imports.tsx` usa componentes compartilhados, upload real multipart, filtros/paginação, editor com campos humanos, seleção de linhas, aprovação de fonte com consentimento e motivo, progresso/pausa por transação, confirmação retomável e relatório autorizado. A inspeção visual de desktop/celular e o fluxo HTTP completo pertencem à verificação integrada do host e não foram alegados como concluídos nesta frente.

O teste real é opt-in: sem `PCM_TEST_WORKBOOK`, permanece ignorado em CI. A suíte sintética não necessita do arquivo privado. Na primeira execução, o sandbox Windows impediu `tsx` em `os.userInfo` (`uv_os_get_passwd ENOMEM`); executar os testes locais com a aprovação de execução fora desse sandbox resolveu o bloqueio, sem alterar dependências.

## Configuração e decisões pendentes de negócio

Em produção, configurar armazenamento privado durável antes do primeiro upload. Realizar a primeira revisão/importação de negócio em homologação; resolver duplicidade do catálogo, referências a ativos e recebimentos com o responsável pelos dados. Datas de referência dos extratos que não foram informadas continuam desconhecidas. Aprovar mapeamento de espécie/sentido/estornos e fonte canônica antes de qualquer reconhecimento de consumo. Definir unidade de lead time e metodologia de reposição antes de calcular compra. Nenhuma dessas decisões foi inventada a partir do arquivo.
