# MTM Solution Site

## Database (Supabase/Postgres)

Este projeto agora usa Postgres (Supabase) para posts e comentários.

### 1) Criar tabelas
Abra o **Supabase SQL Editor** e execute o conteúdo de `db/schema.sql`.
Para materiais (Storage), execute também `db/materials_schema.sql`.

### 2) Variáveis de ambiente
Configure no `.env` (local) e na Vercel:

```
DATABASE_URL=
DB_SSL=true
WHATSAPP_PHONE=
N8N_WEBHOOK_URL=
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
MATERIALS_BUCKET=materials
MATERIALS_SIGNED_URL_TTL=600
ADMIN_BOOTSTRAP_USERNAME=
ADMIN_BOOTSTRAP_PASSWORD=
ADMIN_BOOTSTRAP_EMAIL=
SMTP_HOST=
SMTP_PORT=
SMTP_SECURE=
SMTP_USER=
SMTP_PASS=
SMTP_FROM=
NOTIFY_EMAIL=
```

- `DB_SSL=true` quando usar Supabase.

### 3) Importar seed (opcional)
Para migrar os posts iniciais do `db/data.seed.json` para o banco:

```
node scripts/import_seed_to_db.js
```

### 4) Rodar localmente
```
npm install
npm start
```

## Vercel
- Configure as env vars no projeto da Vercel.
- Faça o deploy normalmente.

## Auth (Supabase)
1) Execute `db/profiles_schema.sql` no Supabase SQL Editor.
2) Execute `db/profiles_admin_patch.sql` para adicionar provider/estado (admin).
2) Configure Google OAuth no Supabase Auth:
   - Redirect URLs: `https://seu-dominio.com.br/login` e `http://localhost:3000/login`.
3) Defina `SUPABASE_URL` e `SUPABASE_ANON_KEY` no `.env` e na Vercel.
4) Teste o fluxo:
   - Deslogado → acessar `/materiais` → redireciona para `/login`.
   - Login → preencher `/perfil`.
   - Após perfil completo → acesso liberado.

## Admin (login fixo com usuários locais)
1) Execute `db/admin_schema.sql` no Supabase SQL Editor.
2) Execute `db/admin_security_patch.sql` para aplicar lockout e sessão segura (em bases já criadas).
3) Configure as env vars do bootstrap (somente se ainda não houver admins):
   - `ADMIN_BOOTSTRAP_USERNAME`
   - `ADMIN_BOOTSTRAP_PASSWORD`
   - `ADMIN_BOOTSTRAP_EMAIL` (opcional)
4) Inicie o app e acesse `/admin/login` com o usuário bootstrap.
5) Em `/admin/users`, cadastre outros admins e defina roles.

### Segurança do admin
- O bootstrap só roda se **admin_accounts estiver vazio**.
- Senha mínima: **12+ caracteres** com letras e números.
- Rate limit por IP (10 tentativas / 15 min).
- Lockout por usuário após 5 falhas (15 min).

## Cadastros (profiles)
Permissões por role:
- reader: visualizar lista/detalhe
- editor: editar, desativar/reativar e exportar
- admin: igual editor
- super_admin: igual editor + exclusão definitiva

## Logs de login
Para registrar cada login (histórico), execute `db/profile_login_events.sql` no Supabase SQL Editor.

Filtros disponíveis:
- provider, status (ativos/inativos), data (range), busca por nome/email/empresa

Exportação:
- `/admin/profiles/export.csv`
- `/admin/profiles/export.json`

## Materiais (Storage)
1) Execute `db/materials_schema.sql` no Supabase SQL Editor.
   - Se já executou antes, rode também `db/materials_schedule_patch.sql` para adicionar agendamento.
2) Crie o bucket `materials` no Supabase Storage.
3) Configure `SUPABASE_SERVICE_ROLE_KEY` na Vercel (somente server).
4) Acesse `/admin/materials` para enviar e publicar arquivos.
5) A rota `/materiais` lista apenas materiais publicados.
