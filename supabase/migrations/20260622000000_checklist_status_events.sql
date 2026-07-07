-- Option C: histórico de transições de status das etapas (event sourcing).
-- Cada mudança de status de um checklist_item gera um evento aqui. As datas
-- "realizadas" (actual_start/actual_end) seguem em checklist_items como cache
-- derivado; esta tabela guarda a trilha completa para auditoria e análises
-- (tempo em cada estado, reaberturas, cycle time).

CREATE TABLE checklist_status_events (
  id             uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id        uuid            NOT NULL REFERENCES obras(id)           ON DELETE CASCADE,
  apartment_id   uuid            NOT NULL REFERENCES apartments(id)      ON DELETE CASCADE,
  item_id        uuid            NOT NULL REFERENCES checklist_items(id) ON DELETE CASCADE,
  from_state     checklist_state,
  to_state       checklist_state NOT NULL,
  -- data efetiva da mudança (editável p/ permitir retroagir); created_at é o registro real.
  effective_date date            NOT NULL DEFAULT current_date,
  changed_by     text,
  created_at     timestamptz     NOT NULL DEFAULT now()
);

CREATE INDEX checklist_status_events_item_idx ON checklist_status_events (item_id, created_at);

-- Mesma exposição das demais tabelas (anon + authenticated).
ALTER TABLE checklist_status_events ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON checklist_status_events TO anon;
CREATE POLICY anon_all ON checklist_status_events FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
