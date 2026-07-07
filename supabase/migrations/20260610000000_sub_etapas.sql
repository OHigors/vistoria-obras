-- Group stages: a stage can declare sub-steps (other stages by name). When all
-- sub-steps are done the group stage auto-completes; it is not edited manually.
-- Mirrors the existing servicos_dependentes text[] column.
ALTER TABLE service_stages
  ADD COLUMN IF NOT EXISTS sub_etapas text[] NOT NULL DEFAULT '{}';
