-- Estudo BTS Compress: esquema do banco (PostgreSQL)

CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  label      TEXT NOT NULL,
  value      NUMERIC
);

-- Cadastro único de serviços (DVB e ISDB-T)
CREATE TABLE IF NOT EXISTS services (
  id          SERIAL PRIMARY KEY,
  service_id  INTEGER,                 -- ID de serviço no transport stream
  name        TEXT NOT NULL UNIQUE,
  codec       TEXT,                    -- MPEG 1 / MPEG 2 / MPEG 4
  system      TEXT NOT NULL DEFAULT 'DVB',
  sort        INTEGER NOT NULL DEFAULT 0
);

-- Mapa de PIDs decimais por serviço (aba "PIDS- Total")
CREATE TABLE IF NOT EXISTS service_pids (
  service_id INTEGER PRIMARY KEY REFERENCES services(id) ON DELETE CASCADE,
  v INTEGER, a1 INTEGER, a2 INTEGER, a3 INTEGER, a4 INTEGER,
  pcr INTEGER, pmt INTEGER, dem INTEGER, ait INTEGER, cc INTEGER, ect INTEGER, data INTEGER
);

-- Bitrates por configuração: pids_total | titular | reserva | antigo
CREATE TABLE IF NOT EXISTS bitrates (
  id          SERIAL PRIMARY KEY,
  service_id  INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  config      TEXT NOT NULL,
  label       TEXT,                    -- nome como aparece na planilha, se diferente
  mbps        NUMERIC,
  note        TEXT,
  UNIQUE (service_id, config)
);

-- Taxas de encoder e mux (aba "TAXAS"); áudio e CC em kbps, vídeo em Mbps
CREATE TABLE IF NOT EXISTS encoder_rates (
  id          SERIAL PRIMARY KEY,
  service_id  INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  source      TEXT NOT NULL CHECK (source IN ('enc','mux')),
  a1 NUMERIC, a2 NUMERIC, a3 NUMERIC, a4 NUMERIC, v NUMERIC, cc NUMERIC,
  UNIQUE (service_id, source)
);

-- ISDB-T: serviços por layer (aba "ISDB-T - Cinco Canais")
CREATE TABLE IF NOT EXISTS isdb_layers (
  id     SERIAL PRIMARY KEY,
  layer  TEXT NOT NULL,                -- A | B | Tabelas
  name   TEXT NOT NULL,
  mbps   NUMERIC,
  sort   INTEGER NOT NULL DEFAULT 0
);

-- ISDB-T: PIDs e taxas medidas (aba "PIDS ISDB-T- Taxas")
CREATE TABLE IF NOT EXISTS isdb_pids (
  id     SERIAL PRIMARY KEY,
  grp    TEXT NOT NULL,
  pid    INTEGER,
  ident  TEXT,
  mbps   NUMERIC,
  sort   INTEGER NOT NULL DEFAULT 0
);

-- Histórico de alterações feitas pelo sistema
CREATE TABLE IF NOT EXISTS audit_log (
  id         SERIAL PRIMARY KEY,
  at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  tbl        TEXT NOT NULL,
  row_id     TEXT NOT NULL,
  field      TEXT NOT NULL,
  old_value  TEXT,
  new_value  TEXT,
  context    TEXT
);

-- Equipamento (encoder) usado por serviço em cada configuração
ALTER TABLE bitrates ADD COLUMN IF NOT EXISTS encoder TEXT;

-- Equipamento usado em cada linha de taxas (encoder ou mux)
ALTER TABLE encoder_rates ADD COLUMN IF NOT EXISTS equipment TEXT;

-- Cadastro de equipamentos (encoders, multiplexadores, moduladores...)
CREATE TABLE IF NOT EXISTS equipment (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  manufacturer  TEXT,
  model         TEXT,
  function      TEXT,
  location      TEXT,
  serial        TEXT,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE bitrates      ADD COLUMN IF NOT EXISTS equipment_id INTEGER REFERENCES equipment(id) ON DELETE SET NULL;
ALTER TABLE encoder_rates ADD COLUMN IF NOT EXISTS equipment_id INTEGER REFERENCES equipment(id) ON DELETE SET NULL;

-- Converte os nomes digitados antes do cadastro em equipamentos e vincula
INSERT INTO equipment (name, function)
SELECT DISTINCT t.name, t.fn FROM (
  SELECT encoder AS name, 'Encoder' AS fn FROM bitrates WHERE encoder IS NOT NULL AND equipment_id IS NULL
  UNION
  SELECT equipment, CASE source WHEN 'mux' THEN 'Multiplexador' ELSE 'Encoder' END FROM encoder_rates WHERE equipment IS NOT NULL AND equipment_id IS NULL
) t
WHERE NOT EXISTS (SELECT 1 FROM equipment e WHERE e.name = t.name);

UPDATE bitrates b SET equipment_id = (SELECT min(id) FROM equipment e WHERE e.name = b.encoder), encoder = NULL
WHERE b.encoder IS NOT NULL AND b.equipment_id IS NULL;
UPDATE encoder_rates r SET equipment_id = (SELECT min(id) FROM equipment e WHERE e.name = r.equipment), equipment = NULL
WHERE r.equipment IS NOT NULL AND r.equipment_id IS NULL;

-- Equipamento usado por serviço ISDB-T
ALTER TABLE isdb_layers ADD COLUMN IF NOT EXISTS equipment_id INTEGER REFERENCES equipment(id) ON DELETE SET NULL;

-- Usuários e sessões (login)
CREATE TABLE IF NOT EXISTS users (
  id             SERIAL PRIMARY KEY,
  username       TEXT NOT NULL UNIQUE,
  name           TEXT NOT NULL,
  role           TEXT NOT NULL CHECK (role IN ('viewer','editor','admin')),
  password_hash  TEXT NOT NULL,
  active         BOOLEAN NOT NULL DEFAULT true,
  must_change    BOOLEAN NOT NULL DEFAULT false,
  last_login     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  ip          TEXT,
  user_agent  TEXT
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

-- Quem fez cada alteração
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS username TEXT;
