# MTM Solution Site

## Database (Supabase/Postgres)

Este projeto agora usa Postgres (Supabase) para posts e comentários.

### 1) Criar tabelas
Abra o **Supabase SQL Editor** e execute o conteúdo de `db/schema.sql`.

### 2) Variáveis de ambiente
Configure no `.env` (local) e na Vercel:

```
DATABASE_URL=
DB_SSL=true
WHATSAPP_PHONE=
N8N_WEBHOOK_URL=
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
