# PCM — gestão de manutenção

Aplicação em `apps/pcm`, integrada ao host Next.js existente em `/pcm` e `/api/pcm`. Compartilha identidade, unidades, conexão PostgreSQL e componentes visuais com o 5S; tabelas e migrações ficam no schema `pcm`. Não há segundo login. O painel `/modulos` reúne os módulos da empresa.

## Executar e verificar

Execute na raiz do repositório, com Node 22 ou superior:

```powershell
npm.cmd ci
npm.cmd run pcm:preview
```

A prévia cria PostgreSQL descartável em memória, dados sintéticos e servidor local. Não conecta ao Neon de produção. O terminal informa a URL. Para desenvolvimento com banco de homologação configurado: `npm.cmd run pcm:dev`.

```powershell
npm.cmd run check
npm.cmd run pcm:check
npm.cmd run pcm:test:e2e
npm.cmd run pcm:build
```

Os testes de integração usam PGlite. O teste real da planilha é opt-in e também usa banco descartável:

```powershell
$env:PCM_TEST_WORKBOOK='manut.xlsx'
node --import tsx --test apps/pcm/tests/import-real.test.ts
Remove-Item Env:PCM_TEST_WORKBOOK
```

A validação realizada está em [IMPORTACAO-RELATORIO.md](docs/IMPORTACAO-RELATORIO.md). `manut.xlsx` permanece na raiz, ignorado pelo Git, sem cópia pública ou seed de produção.

## Banco e atualização

Use a `DATABASE_URL` já adotada pelo host, somente no servidor. A execução de migrações **não ocorre ao abrir uma página nem durante o build**. Em homologação, aplique primeiro as migrações compartilhadas e depois as do PCM:

```powershell
npm.cmd run db:migrate
npm.cmd run pcm:migrate
```

O runner PCM registra versões e ignora as já aplicadas, com bloqueio e transação. As migrações 001/010/020/030/040 adicionam o domínio; não apagam tabelas do 5S. A 040 exige código de ativo único na empresa inteira, ignorando caixa e espaços externos; duplicidades preexistentes interrompem a migração para conciliação explícita. Não apague linhas para resolver esse conflito automaticamente.

Antes da publicação, use backup e o fluxo de homologação existente. Para desfazer código, retorne à versão anterior do aplicativo e oculte/revogue o módulo, preservando schema, arquivos e histórico. Não executar DROP SCHEMA, reset ou rollback com exclusão de dados. Mudanças futuras devem usar novas migrações aditivas.

## Acessos

O Master concede cada módulo em **Usuários e acessos**. Concessão de Manutenção não concede 5S. Os acessos existentes ao 5S são preservados.

A migração compartilhada 004 prepara `michelli.rudnik@steelmast.com.br` como administradora **somente da Manutenção**, com a senha temporária solicitada e troca obrigatória no primeiro login. Não sobrescreve senha de uma conta existente. Nenhuma credencial de produção foi alterada nesta execução. A credencial temporária não é exibida em logs ou telas administrativas.

Administradores do módulo e Master possuem todas as permissões PCM. Para usuários comuns, conceda Manutenção no cadastro central e depois acesse **Manutenção → Configurações → Acessos PCM**, selecionando perfil, unidades, equipes e permissões adicionais. Sem unidades configuradas, não há acesso operacional. Alterar concessões invalida sessões anteriores.

| Perfil | Uso inicial |
| --- | --- |
| Solicitante | Abre e acompanha os próprios chamados; consulta ativos/manuais autorizados. |
| Técnico | Atende ordens atribuídas a si ou às equipes autorizadas, registra resposta, checklist, horas e materiais. |
| Planejador PCM | Faz triagem, programa, atribui, mantém preventivas e consulta relatórios; não administra concessões. |
| Gestor | Supervisiona, encerra, mantém parâmetros e custos nas unidades autorizadas. |
| Consulta | Consulta registros autorizados sem permissão de escrita ou custos por padrão. |

As permissões são revalidadas no servidor inclusive em buscas, indicadores, arquivos e exportações. O QR encaminha ao login e preserva o ativo como destino, sem acesso público.

O subnível central **Consulta** limita também o PCM a leitura, mesmo se houver perfil operacional configurado. Operação e Gestão seguem as permissões específicas do perfil PCM; nenhum perfil PCM transforma um usuário em Master.

## Arquivos privados

Desenvolvimento utiliza `data/private/pcm-files`, fora de `public`. Produção bloqueia uploads enquanto não houver armazenamento S3 compatível configurado. Variáveis, somente por nome:

- `PCM_STORAGE_BUCKET`
- `PCM_STORAGE_REGION`
- `PCM_STORAGE_ENDPOINT` (opcional; HTTPS em produção)
- `PCM_STORAGE_ACCESS_KEY_ID`
- `PCM_STORAGE_SECRET_ACCESS_KEY`
- `PCM_STORAGE_DIR` (somente desenvolvimento)
- `PCM_MAX_UPLOAD_BYTES` (opcional para restringir arquivos; o adaptador HTTP limita o multipart completo a 20 MiB)

Configure bucket privado, bloqueio de acesso público e credenciais com acesso somente ao prefixo `pcm/`. Arquivos são lidos pelo servidor após autorização, sem URLs públicas permanentes. Configure backup e retenção compatíveis com o banco. A integração S3 real depende de configuração externa e não foi validada com um bucket nesta execução.

## Geração automática de preventivas

Endpoint `GET/POST /api/pcm/jobs/run`, autenticado por Bearer, com segredo em `PCM_JOB_SECRET` ou `CRON_SECRET`. `APP_URL` define a origem autorizada das mutações e os links QR. Nunca definir essas variáveis com prefixo `NEXT_PUBLIC_`.

`vercel.json` prepara execução diária às 09:00 UTC (06:00 São Paulo). A ativação depende do ambiente/plano da hospedagem e de `CRON_SECRET`. Em outra infraestrutura, um cron externo deve chamar o endpoint com o segredo ou executar `npm.cmd run pcm:job` com configuração de servidor. Não depende de navegador aberto. Não houve publicação/ativação de cron nesta execução.

Cada execução é limitada e retomável: até 100 ordens, 1.000 datas e 200 versões avaliadas. Se `limited` retornar verdadeiro, repetir até concluir a recuperação. A chave de ocorrência impede duplicação mesmo com concorrência. Histórico de execuções em `GET /api/pcm/job-runs` e na configuração PCM identifica falhas e execuções abertas por mais de 15 minutos; verifique-o na operação. Falhas geram alerta interno aos administradores.

## Primeiro uso em homologação

1. Aplicar as migrações com banco de homologação, configurar arquivos privados e entrar como administradora autorizada, trocando a senha temporária.
2. Conferir unidades compartilhadas; cadastrar equipes, capacidade conhecida, parâmetros e calendários operacionais.
3. Cadastrar ativos físicos com códigos textuais. Configurar prefixo se desejar sugestão automática. Aplicabilidade de material não cria ativo físico.
4. Abrir **Importações**, selecionar unidade e data real de referência do extrato (ou deixar desconhecida), enviar `manut.xlsx` e conferir abas/avisos.
5. Conciliar catálogo duplicado, recebimentos, unidades, custos e aplicações. Aprovação por fonte exige decisão explícita; pode pausar/retomar. Confirmar em lotes até acabar a fila aprovada, exportar relatório e revisar pendências.
6. Cadastrar plano preventivo, testar execução autenticada do job e conferir ocorrência/ordem única, agenda e checklist. Configurar o agendador no servidor de homologação.
7. Testar concessão/revogação com solicitante e técnico comuns antes de liberar produção.

Saldo externo, movimentos ERP e consumo PCM permanecem separados. O importador não cria ativos, falhas ou ordens com base nas narrativas da planilha. Indicadores mostram dados insuficientes quando faltam exposição, calendário, taxa ou estimativa.

## Documentação

- [Dicionário de dados](docs/DADOS.md)
- [Mapeamento das sete abas e política de fontes](docs/IMPORTACAO.md)
- [Validação da planilha real](docs/IMPORTACAO-RELATORIO.md)
- [Ativos, ordens, arquivos e custos](docs/CORE-RELATORIO.md)
- [Definições de indicadores, recorrência e qualidade](docs/PLANNING-RELATORIO.md)
- [Plano e requisitos integrais](docs/PLANO.md)
- [Evidências de validação](docs/VALIDACAO.md)

Expansões fora desta entrega: escrita no ERP, estoque fiscal/transacional, sensores/IoT, gatilhos por horímetro, OEE, aplicativo offline, mensagens pagas e métodos avançados RCM/FMEA. Não foram contratados serviços externos.
