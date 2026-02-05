CREATE TABLE IF NOT EXISTS leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
  email text UNIQUE NOT NULL,
  name text NOT NULL,
  company text NOT NULL,
  phone_e164 text UNIQUE NOT NULL,
  provider text NOT NULL,
  source text NOT NULL DEFAULT 'login',
  crm_status text NOT NULL DEFAULT 'novo'
    CHECK (crm_status IN ('novo','contatado','qualificado','proposta_enviada','fechado_ganho','fechado_perdido')),
  interest_tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  urgency text DEFAULT NULL
    CHECK (urgency IN ('imediato_30d','curto_1_3m','medio_3_6m','pesquisando')),
  next_action_type text DEFAULT NULL
    CHECK (next_action_type IN ('whatsapp','email','ligacao','reuniao','enviar_material','sem_acao')),
  next_action_at timestamptz NULL,
  notes text NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(crm_status);
CREATE INDEX IF NOT EXISTS idx_leads_provider ON leads(provider);
CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads(created_at);
CREATE INDEX IF NOT EXISTS idx_leads_next_action_at ON leads(next_action_at);

CREATE TABLE IF NOT EXISTS lead_events (
  id bigserial PRIMARY KEY,
  lead_id uuid REFERENCES leads(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);
