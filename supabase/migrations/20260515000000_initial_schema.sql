-- =============================================================================
-- vistoria-obras — initial schema
-- =============================================================================
-- Run order: this file first, then supabase/seed.sql
--
-- Storage: create a "photos" bucket in the Supabase dashboard manually.
--          inspection_photos.storage_path holds the object key inside that bucket.
--          Resolve to a URL with: supabase.storage.from('photos').getPublicUrl(path)
-- =============================================================================

-- ─── Extensions ───────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── Enum types ───────────────────────────────────────────────────────────────
CREATE TYPE apartment_status AS ENUM (
  'excellent',
  'good',
  'attention',
  'critical'
);

CREATE TYPE checklist_state AS ENUM (
  'ok',
  'pending',
  'partial',
  'notApplicable'
);

CREATE TYPE measurement_status AS ENUM (
  'Executado',
  'Conferido',
  'Aprovado para pagamento',
  'Pago externamente',
  'Reprovado',
  'Retido',
  'Cancelado'
);

CREATE TYPE measurement_type AS ENUM (
  'normal',
  'complement',
  'rework'
);

-- ─── obras (top-level tenant) ─────────────────────────────────────────────────
CREATE TABLE obras (
  id         text        PRIMARY KEY,
  name       text        NOT NULL,
  summary    text        NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ─── towers ───────────────────────────────────────────────────────────────────
CREATE TABLE towers (
  id          text        PRIMARY KEY,
  obra_id     text        NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
  name        text        NOT NULL,
  block       text        NOT NULL DEFAULT '',
  position    text        NOT NULL DEFAULT '',
  description text        NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_towers_obra_id ON towers(obra_id);

-- ─── apartments ───────────────────────────────────────────────────────────────
CREATE TABLE apartments (
  id              text             PRIMARY KEY,
  obra_id         text             NOT NULL REFERENCES obras(id)  ON DELETE CASCADE,
  tower_id        text             NOT NULL REFERENCES towers(id) ON DELETE CASCADE,
  number          text             NOT NULL,
  floor           text             NOT NULL DEFAULT '',
  status          apartment_status NOT NULL,
  progress        integer          NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  notes           text             NOT NULL DEFAULT '',
  last_inspection date,
  created_at      timestamptz      NOT NULL DEFAULT now(),
  updated_at      timestamptz      NOT NULL DEFAULT now()
);

CREATE INDEX idx_apartments_obra_id  ON apartments(obra_id);
CREATE INDEX idx_apartments_tower_id ON apartments(tower_id);

-- ─── checklist_items ──────────────────────────────────────────────────────────
-- One row per checklist item per apartment.
-- Schedule fields (planned/actual dates) live here so they travel together
-- with the inspection state — mirrors how ScheduledChecklistItem works in code.
CREATE TABLE checklist_items (
  id            text            PRIMARY KEY,
  obra_id       text            NOT NULL REFERENCES obras(id)      ON DELETE CASCADE,
  apartment_id  text            NOT NULL REFERENCES apartments(id) ON DELETE CASCADE,
  label         text            NOT NULL,
  state         checklist_state NOT NULL DEFAULT 'pending',
  comment       text            NOT NULL DEFAULT '',
  -- schedule fields
  planned_start date,
  planned_end   date,
  actual_start  date,
  actual_end    date,
  sort_order    integer         NOT NULL DEFAULT 0,
  created_at    timestamptz     NOT NULL DEFAULT now(),
  updated_at    timestamptz     NOT NULL DEFAULT now()
);

CREATE INDEX idx_checklist_items_obra_id      ON checklist_items(obra_id);
CREATE INDEX idx_checklist_items_apartment_id ON checklist_items(apartment_id);

-- ─── service_stages ───────────────────────────────────────────────────────────
-- Configurable service/stage catalog per obra.
-- Unique constraint on (obra_id, nome) prevents duplicate stage names per project.
CREATE TABLE service_stages (
  id                    text        PRIMARY KEY,
  obra_id               text        NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
  nome                  text        NOT NULL,
  categoria             text        NOT NULL DEFAULT '',
  unidade_medicao       text        NOT NULL DEFAULT 'un',
  ordem_execucao        integer     NOT NULL DEFAULT 0,
  aparece_no_checklist  boolean     NOT NULL DEFAULT true,
  aparece_no_cronograma boolean     NOT NULL DEFAULT true,
  aparece_na_medicao    boolean     NOT NULL DEFAULT true,
  etapa_critica         boolean     NOT NULL DEFAULT false,
  trava_liberacao       boolean     NOT NULL DEFAULT false,
  ativo                 boolean     NOT NULL DEFAULT true,
  servicos_dependentes  text[]      NOT NULL DEFAULT '{}',
  observacao            text        NOT NULL DEFAULT '',
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  UNIQUE (obra_id, nome)
);

CREATE INDEX idx_service_stages_obra_id ON service_stages(obra_id);

-- ─── inspection_visits ────────────────────────────────────────────────────────
CREATE TABLE inspection_visits (
  id               text             PRIMARY KEY,
  obra_id          text             NOT NULL REFERENCES obras(id)       ON DELETE CASCADE,
  apartment_id     text             NOT NULL REFERENCES apartments(id)  ON DELETE CASCADE,
  date             timestamptz      NOT NULL,
  started_at       timestamptz,
  responsible      text             NOT NULL DEFAULT '',
  progress_before  integer          NOT NULL DEFAULT 0 CHECK (progress_before BETWEEN 0 AND 100),
  progress_after   integer          NOT NULL DEFAULT 0 CHECK (progress_after  BETWEEN 0 AND 100),
  evolution        integer          NOT NULL DEFAULT 0,
  -- {"ok": N, "pending": N, "partial": N, "notApplicable": N}
  counts           jsonb            NOT NULL DEFAULT '{"ok":0,"pending":0,"partial":0,"notApplicable":0}',
  photos_added     integer          NOT NULL DEFAULT 0,
  status_after     apartment_status NOT NULL,
  general_note     text             NOT NULL DEFAULT '',
  changed_item_ids text[]           NOT NULL DEFAULT '{}',
  added_photo_ids  text[]           NOT NULL DEFAULT '{}',
  issue_item_ids   text[]           NOT NULL DEFAULT '{}',
  finalized        boolean          NOT NULL DEFAULT false,
  finalized_at     timestamptz,
  created_at       timestamptz      NOT NULL DEFAULT now(),
  updated_at       timestamptz      NOT NULL DEFAULT now()
);

CREATE INDEX idx_inspection_visits_obra_id      ON inspection_visits(obra_id);
CREATE INDEX idx_inspection_visits_apartment_id ON inspection_visits(apartment_id);
CREATE INDEX idx_inspection_visits_date         ON inspection_visits(date DESC);

-- ─── inspection_photos ────────────────────────────────────────────────────────
-- storage_path is the object key inside the "photos" Supabase Storage bucket.
-- Example: "residencial-cagliari/ap-11/20260515-abc123.jpg"
CREATE TABLE inspection_photos (
  id           text        PRIMARY KEY,
  obra_id      text        NOT NULL REFERENCES obras(id)       ON DELETE CASCADE,
  tower_id     text        NOT NULL REFERENCES towers(id),
  apartment_id text        NOT NULL REFERENCES apartments(id)  ON DELETE CASCADE,
  item_id      text,
  service_id   text        NOT NULL,
  service      text        NOT NULL,
  storage_path text        NOT NULL,
  file_name    text        NOT NULL,
  comment      text        NOT NULL DEFAULT '',
  visit_id     text        REFERENCES inspection_visits(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_inspection_photos_obra_id      ON inspection_photos(obra_id);
CREATE INDEX idx_inspection_photos_apartment_id ON inspection_photos(apartment_id);
CREATE INDEX idx_inspection_photos_visit_id     ON inspection_photos(visit_id);

-- ─── measurements ─────────────────────────────────────────────────────────────
CREATE TABLE measurements (
  id                    text               PRIMARY KEY,
  obra_id               text               NOT NULL REFERENCES obras(id)       ON DELETE CASCADE,
  tower_id              text               REFERENCES towers(id),
  apartment_id          text               NOT NULL REFERENCES apartments(id)  ON DELETE CASCADE,
  service_id            text,
  contractor_id         text,
  service               text               NOT NULL,
  contractor            text               NOT NULL,
  quantity              numeric(12, 4)     NOT NULL,
  unit                  text               NOT NULL,
  unit_price            numeric(14, 2)     NOT NULL,
  total_value           numeric(14, 2)     NOT NULL,
  period_start          date               NOT NULL,
  period_end            date               NOT NULL,
  status                measurement_status NOT NULL DEFAULT 'Executado',
  comment               text               NOT NULL DEFAULT '',
  measurement_type      measurement_type   NOT NULL DEFAULT 'normal',
  -- storage_path equivalent of evidenceUri — key inside "photos" bucket
  evidence_storage_path text,
  evidence_file_name    text,
  responsible           text,
  launched_at           timestamptz,
  approved_at           timestamptz,
  created_at            timestamptz        NOT NULL DEFAULT now(),
  updated_at            timestamptz        NOT NULL DEFAULT now()
);

CREATE INDEX idx_measurements_obra_id      ON measurements(obra_id);
CREATE INDEX idx_measurements_apartment_id ON measurements(apartment_id);
CREATE INDEX idx_measurements_tower_id     ON measurements(tower_id);
CREATE INDEX idx_measurements_status       ON measurements(status);
CREATE INDEX idx_measurements_period       ON measurements(period_start, period_end);

-- ─── updated_at auto-trigger ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_obras_updated_at
  BEFORE UPDATE ON obras FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_towers_updated_at
  BEFORE UPDATE ON towers FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_apartments_updated_at
  BEFORE UPDATE ON apartments FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_checklist_items_updated_at
  BEFORE UPDATE ON checklist_items FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_service_stages_updated_at
  BEFORE UPDATE ON service_stages FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_inspection_visits_updated_at
  BEFORE UPDATE ON inspection_visits FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_measurements_updated_at
  BEFORE UPDATE ON measurements FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── Row Level Security ───────────────────────────────────────────────────────
-- RLS is enabled on all tables. Policies are permissive for the MVP (any
-- authenticated user can read and write). Tighten later by joining against a
-- user→obra membership table and scoping USING (obra_id = ...).
ALTER TABLE obras             ENABLE ROW LEVEL SECURITY;
ALTER TABLE towers            ENABLE ROW LEVEL SECURITY;
ALTER TABLE apartments        ENABLE ROW LEVEL SECURITY;
ALTER TABLE checklist_items   ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_stages    ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspection_visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspection_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE measurements      ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_all" ON obras
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON towers
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON apartments
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON checklist_items
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON service_stages
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON inspection_visits
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON inspection_photos
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON measurements
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
