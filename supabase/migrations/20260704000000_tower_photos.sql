-- Fotos com escopo de nível de torre (além de apartamento).
-- Mesmo padrão de 20260703000000_tower_checklist: apartment_id passa a ser
-- opcional e um discriminador de nível (level_code) é adicionado. tower_id já
-- é NOT NULL nesta tabela (toda foto pertence a uma torre), então permanece.
-- Um CHECK garante escopo exclusivo: a linha é de um apartamento OU de um nível.

ALTER TABLE inspection_photos ALTER COLUMN apartment_id DROP NOT NULL;
ALTER TABLE inspection_photos ADD COLUMN IF NOT EXISTS level_code text;

ALTER TABLE inspection_photos
  ADD CONSTRAINT chk_photos_scope CHECK (
    (apartment_id IS NOT NULL AND level_code IS NULL) OR
    (apartment_id IS NULL AND tower_id IS NOT NULL AND level_code IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS idx_photos_tower_level
  ON inspection_photos (tower_id, level_code)
  WHERE level_code IS NOT NULL;
