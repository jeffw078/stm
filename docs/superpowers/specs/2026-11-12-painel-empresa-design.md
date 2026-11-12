# Painel geral SteelMast

O login passa a abrir um painel geral com cartões dos módulos autorizados. O 5S mantém suas URLs, dados e permissões atuais. Manutenção recebe somente uma página inicial de preparação; os recursos serão definidos pelo próximo pedido.

## Acessos

Master continua administrando a empresa. Os demais usuários recebem permissões independentes por módulo: administrador ou usuário, com subníveis de consulta, operação ou gestão. Consulta permite leitura; operação permite executar atividades atribuídas; gestão acrescenta planejamento e revisão. Administrador possui gestão do módulo, sem se tornar Master. No 5S, apenas Master continua podendo importar e gerir unidades/setores.

Os Admins atuais recebem administração do 5S e os Auditores recebem usuário/operação do 5S. A autorização é verificada no servidor, inclusive para APIs e fotos; alterar acessos revoga sessões. O Master pode criar contas, editar os módulos e subníveis, ativar/desativar e redefinir senhas.

Michelli Rudnik recebe administração da Manutenção, sem acesso implícito ao 5S. Uma migração provisiona a conta com hash da senha temporária solicitada, troca obrigatória e validade de 72 horas. Se o e-mail já existir, sua senha e acessos anteriores são preservados. Migrações reaplicadas não restauram permissões revogadas.

## Abordagem

Decisão de implementação: acrescentar permissões por módulo às contas existentes e preservar as rotas do 5S. Recriar o login ou mover todas as rotas aumentaria o risco de interromper acessos existentes sem benefício para este pedido. Novas contas usam perfil global de usuário; privilégios de módulo não concedem privilégios globais.

## Validação

Testar migração idempotente, manutenção isolada do 5S, níveis e subníveis, revogação de sessões e fluxo legado. Executar TypeScript, testes, varredura de segredos, build e testes de navegador quando disponíveis. Sem credenciais de produção no ambiente, alterações de banco são entregues por migração e não presumidas como aplicadas ao Neon.
