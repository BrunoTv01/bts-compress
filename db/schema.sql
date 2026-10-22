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
