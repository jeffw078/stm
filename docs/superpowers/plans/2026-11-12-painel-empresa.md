# Plano — painel geral e permissões por módulo

Especificação: `docs/superpowers/specs/2026-11-12-painel-empresa-design.md`.

1. Escrever testes de regressão para isolamento entre módulos, subníveis, preservação e reaplicação de migrações e revogação de sessões. Executar e confirmar falhas por funcionalidades ausentes.
2. Adicionar migrações, modelo de permissões e carregamento autenticado. Proteger serviços, APIs, evidências e páginas do 5S, preservando as restrições históricas. Provisionar Michelli com hash de senha temporária, sem redefinir contas existentes.
3. Criar painel de módulos, página de preparação da Manutenção e navegação contextual. Generalizar apresentação do login e metadados. Acrescentar edição de permissões à administração de usuários.
4. Atualizar prévia e testes de navegador. Executar `npm run check`, `npm run build` e Playwright. Revisar alterações e documentar aplicação ao banco.

Decisões: executar no diretório compartilhado solicitado, sem criar worktree ou publicar; manter a política de senhas definitivas, aceitando a senha curta solicitada apenas no provisionamento temporário; manter Master como único administrador global.

## Progresso

- Inspeção: checkout limpo, Next.js/PostgreSQL; nenhuma credencial de banco fornecida no workspace. Dependências em instalação.
- Etapa 1: cinco testes de domínio falharam pelas regras novas ausentes; três testes de integração falharam pela criação de perfil USER e edição de permissões ainda ausentes.
- Etapa 2: modelo, migrações e autorização implementados. `npm run check`: TypeScript, 34 testes e varredura de segredos aprovados. Migrações validadas em PGlite, inclusive senha solicitada, prazo de 72h, preservação de conta existente e reaplicação sem restaurar acessos.
- Etapa 3: painel, cartões, navegação contextual, Manutenção e edição de permissões implementados; inspeção visual em 1366×900 e 768×1024 sem transbordamento.
- Revisão independente: auth, API, serviços, fotos, migrações e interface revisados, sem problemas concretos identificados.
- Validação de navegador: primeira execução bloqueada pela ausência da versão correspondente do Chromium; navegador instalado. Fluxo completo do 5S aprovado em desktop e tablet. Ajustados seletores de combobox, abertura do menu no tablet e espera da prévia com compilação sob demanda. Execução final pendente.
- Primeiro login: verificação manual reproduziu retorno intermitente à troca de senha após resposta 200 da alteração. Substituído push/refresh concorrentes por navegação completa após substituir o cookie de sessão. Adicionado teste do login real com senha temporária, troca e chegada ao painel com somente os módulos autorizados. A reprodução manual ocorreu sob carga concorrente; o primeiro teste automatizado já passou antes da correção, portanto não demonstra de forma determinística a corrida anterior.
- O teste do primeiro login então reproduziu envio nativo GET da troca de senha antes da hidratação. Formulário de autenticação passa a declarar POST e bloqueia envio até a hidratação; criação de usuário também declara POST e aguarda carregamento da administração. Esse teste falhou com a URL contendo os campos e foi mantido para verificar o fluxo corrigido.
- Concluído: 14/14 cenários Playwright aprovados (desktop/tablet); build de produção e TypeScript aprovados; nova varredura de segredos e `git diff --check` aprovados. Sem migração ou publicação em produção; instruções e limites registrados em README e `docs/VALIDACAO.md`.
