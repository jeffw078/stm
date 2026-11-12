# Evidências de validação PCM — 12/11/2026

Todos os bancos usados nesta execução foram descartáveis. Não foi executado deploy, DDL ou importação no Neon de produção. O arquivo `manut.xlsx` original foi preservado e permanece fora do Git.

## Verificações executadas

| Comando / verificação | Resultado observado |
| --- | --- |
| `npm.cmd run check` antes e depois da integração | 34 testes do host aprovados, TypeScript e verificação de segredos aprovados. |
| `npm.cmd run pcm:check` | 31 testes aprovados, zero falhas e um teste real opt-in ignorado; tipos e verificação de segredos aprovados. |
| Teste real opt-in de `manut.xlsx` | Aprovado em PGlite isolado. Sete abas, 23.607 linhas de staging; 22.994 referências aplicadas sem criar ordens/consumo PCM; repetição retornou o mesmo lote. |
| Testes dirigidos de revisão | Migrações reaplicadas sem alterar dados, validação configurável de encerramento, histórico de descendentes HTTP e datas civis aprovados. |
| `node --import tsx --test apps/pcm/tests/storage.test.ts` | Um teste aprovado: diretório vazio na configuração continua usando a pasta privada ignorada pelo Git. |
| Revisão independente de código | Verificados autorização, unidades, arquivos, recorrência, importação e saldos. Achados corrigidos com testes pertinentes. |
| Verificações HTTP no preview | Ativos, exportação, arquivos e QR sem sessão retornaram 401; job sem segredo retornou 401; POST com origem inválida retornou 403. Exportação autenticada retornou 200, CSV e nome de arquivo correto, com registro sintético. |
| `npm.cmd run build` final | Aprovado com TypeScript, sem avisos. Rotas 5S, painel e PCM presentes. Inspeção dos 16 manifests de servidor confirmou zero arquivos privados, planilha, ambientes ou resultados de teste no pacote. |
| Playwright integrado e retestes | 24 cenários únicos validados: dez PCM e 14 do host. A passagem conjunta aprovou 23/24; o timeout de compilação fria foi corrigido e o reteste direcionado aprovou sete casos com exit 0, incluindo todos os cinco fluxos PCM em 390 px. |

A contagem da suíte PCM inclui testes de regras e integração, não representa número de telas. O teste real permanece opt-in no comando comum para que CI não dependa da planilha privada. Detalhamento real em [IMPORTACAO-RELATORIO.md](IMPORTACAO-RELATORIO.md).

## Cobertura relevante

- Isolamento 5S/PCM, escopo explícito por unidade, revogação e subnível central Consulta sem escrita.
- Hierarquia com 20 níveis, ciclos, movimentações e contexto histórico congelado; código textual normalizado único na empresa.
- Solicitações próprias, conversão repetida, concorrência otimista, notas internas, atribuição/equipe e alvo técnico obrigatório.
- Execução/checklist, validação padrão e encerramento automático configurado, reabertura auditada, HH, custos congelados, devoluções e idempotência.
- PDF privado, versões, autorização de download e revogação; CSV protegido contra fórmulas.
- Recorrência dia 31/bissexto/fuso, jobs concorrentes, pausa/reativação, prazo original e recuperação limitada/retomável com rollback observável.
- Métricas com resultados sintéticos conhecidos: falha única, intervalos sobrepostos, meia-noite, HH simultâneo, ausência de exposição/capacidade/taxa, cancelamento e custo histórico.
- XLSX sparse, sete abas, fórmula na linha 1.048.576, zeros iniciais, decimais, datas 1900/1904, catálogo duplicado, recebimento parcial e referências sem soma indevida.
- Snapshot alternativo da mesma data substitui versão da chave; 100 unidades antigas versus 2 novas e outro lote de 3 resultam em 5, não 105.

## Navegador e build

Validação encerrada. Os resultados combinam a passagem de 24 cenários com o reteste direcionado; não correspondem a uma única passagem 24/24. Comandos, correções, contagens e logs completos no [relatório do navegador](../../../docs/PCM-E2E-RELATORIO.md). Contextos de solicitante e técnico herdaram 390×844 nos testes de celular; o host manteve seus projetos desktop e tablet.

Quatro capturas em `test-results/pcm-visual` foram inspecionadas: planejamento 5S e cadastro de ativo PCM nas larguras 1366 e 390. Shell, cores, tipografia, campos, cartões e botões seguem o mesmo padrão. No celular os campos usam uma coluna e as tabelas mantêm rolagem local. O preview foi encerrado antes do build; portas 4173, 4174 e 5439 ficaram livres.

O primeiro build revelou rastreamento excessivo dos arquivos locais pelo adaptador de desenvolvimento. A configuração final exclui explicitamente dados privados, planilha, ambientes e artefatos de testes; as chamadas de filesystem somente de desenvolvimento não são rastreadas. O segundo build passou sem avisos e os 16 manifests foram conferidos sem arquivos dessas categorias. Produção usa S3 privado, não esses arquivos locais.

A primeira passagem do navegador identificou incompatibilidade da multiplexação PGlite com pool concorrente: a mesma sessão alternava entre 200 e 401 e apresentava erro de prepared statement. Diagnóstico com 36 requisições locais reproduziu seis respostas 401 e duas 503. O preview agora usa uma conexão mediante flag exclusiva de desenvolvimento; PostgreSQL de produção mantém o pool normal. Após reiniciar, o mesmo diagnóstico de 36 requisições retornou 36 respostas 200 e zero erros. Os fluxos foram repetidos e aprovados.

## Dependências externas

- Aplicação das migrações no Neon de homologação/produção conforme aprovação de publicação.
- Bucket privado S3 compatível, credenciais e política de backup/retenção; acesso real a S3 não foi exercitado aqui.
- Origem `APP_URL`, segredo e ativação de cron externo; configuração preparada em `vercel.json`, sem agendamento de produção ativado nesta execução.
- Revisão humana de duplicidades, unidades, recebimentos e aplicações antes da primeira importação de negócio. Dados sem comprovação continuam pendentes, sem inventar ativos/exposição/custos.
