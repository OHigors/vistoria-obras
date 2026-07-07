-- Etapas no nível da torre (Corte da Torre).
-- Etapas como "Fundação", "Limpeza do terreno" e "Reservatório" não pertencem a
-- um apartamento: pertencem a um nível da torre (terreno, fundação, sobressolo,
-- térreo, cobertura, telhado/barrilete, reservatório...). Esta migração permite
-- que checklist_items exista em dois escopos:
--   • apartamento : apartment_id preenchido (comportamento atual, inalterado)
--   • torre/nível : tower_id + level_code preenchidos, apartment_id NULL
-- level_code é o código do nível no catálogo do app (src/data/towerLevels.ts),
-- ex.: 'terreno', 'fundacao', 'sobressolo', 'terreo', 'cobertura',
-- 'telhado-barrilete', 'reservatorio', 'cob-reservatorio'.

ALTER TABLE checklist_items ALTER COLUMN apartment_id DROP NOT NULL;

-- towers.id e apartments.id são uuid no banco (o schema versionado usa text,
-- mas o banco aplicado é uuid — por isso tower_id precisa ser uuid).
ALTER TABLE checklist_items
  ADD COLUMN IF NOT EXISTS tower_id   uuid REFERENCES towers(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS level_code text;

-- Todo item precisa de exatamente um escopo: apartamento OU torre+nível.
ALTER TABLE checklist_items
  ADD CONSTRAINT checklist_items_scope_check
  CHECK (
    (apartment_id IS NOT NULL AND tower_id IS NULL AND level_code IS NULL)
    OR
    (apartment_id IS NULL AND tower_id IS NOT NULL AND level_code IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS idx_checklist_items_tower_level
  ON checklist_items(tower_id, level_code);
