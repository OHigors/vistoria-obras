-- Vistorias (visitas) com escopo de nível de torre (além de apartamento).
-- Mesmo padrão de checklist_items/inspection_photos: apartment_id passa a ser
-- opcional e ganhamos tower_id + level_code. Um CHECK garante escopo exclusivo:
-- a visita é de um apartamento OU de um nível de torre.

ALTER TABLE inspection_visits ALTER COLUMN apartment_id DROP NOT NULL;
ALTER TABLE inspection_visits ADD COLUMN IF NOT EXISTS tower_id uuid REFERENCES towers(id) ON DELETE CASCADE;
ALTER TABLE inspection_visits ADD COLUMN IF NOT EXISTS level_code text;

ALTER TABLE inspection_visits
  ADD CONSTRAINT chk_visits_scope CHECK (
    (apartment_id IS NOT NULL AND level_code IS NULL) OR
    (apartment_id IS NULL AND tower_id IS NOT NULL AND level_code IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS idx_visits_tower_level
  ON inspection_visits (tower_id, level_code)
  WHERE level_code IS NOT NULL;
