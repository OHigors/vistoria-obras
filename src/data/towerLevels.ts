// Catálogo dos níveis estruturais da torre — o "corte esquemático" da prancha.
// Baseado no corte clássico de projeto: TERRENO → FUNDAÇÃO → SOBRESSOLO →
// TÉRREO → pavimentos tipo (vêm dos apartamentos reais) → COBERTURA →
// TELHADO/BARRILETE → RESERVATÓRIO → COB. RESERVATÓRIO.
// Etapas que não pertencem a um apartamento (fundação, limpeza do terreno,
// reservatório...) moram nestes níveis, com escopo torre (ver db.ts →
// loadTowerChecklist / upsertTowerChecklistItem).

export type TowerLevelKind =
  | 'site'   // faixa do terreno (implantação)
  | 'below'  // abaixo do nível do solo (hachurado no corte)
  | 'body'   // corpo da torre (largura total)
  | 'roof'   // telhado/barrilete (levemente recuado)
  | 'tank';  // reservatório (bloco estreito no topo)

export type TowerLevelDef = {
  code: string;  // level_code persistido em checklist_items
  label: string; // rótulo na prancha
  rail: string;  // código na régua lateral do corte
  kind: TowerLevelKind;
  hint: string;  // exemplos de etapas que moram neste nível
};

// Ordem de baixo para cima, como o prédio é construído.
export const TOWER_LEVELS: TowerLevelDef[] = [
  { code: 'terreno', label: 'Terreno / Implantação', rail: '▽', kind: 'site', hint: 'Limpeza do terreno, terraplanagem, canteiro' },
  { code: 'fundacao', label: 'Fundação', rail: 'F', kind: 'below', hint: 'Estacas, blocos, baldrames' },
  { code: 'sobressolo', label: 'Sobressolo', rail: 'S', kind: 'below', hint: 'Garagem, contenção, rampas' },
  { code: 'terreo', label: 'Térreo', rail: 'T', kind: 'body', hint: 'Hall, acessos, áreas comuns' },
  // ...pavimentos tipo entram aqui, vindos dos apartamentos reais...
  { code: 'cobertura', label: 'Cobertura', rail: 'C', kind: 'body', hint: 'Áreas comuns da cobertura, laje técnica' },
  { code: 'telhado-barrilete', label: 'Telhado / Barrilete', rail: 'TB', kind: 'roof', hint: 'Telhado, rufos, barrilete' },
  { code: 'reservatorio', label: 'Reservatório', rail: 'R', kind: 'tank', hint: 'Reservatório superior, impermeabilização' },
  { code: 'cob-reservatorio', label: 'Cob. Reservatório', rail: 'CR', kind: 'tank', hint: 'Laje de cobertura do reservatório' },
];

// Níveis que ficam abaixo dos pavimentos tipo no corte (renderizados depois deles).
export const LEVELS_BELOW_FLOORS = TOWER_LEVELS.filter((l) =>
  ['terreno', 'fundacao', 'sobressolo', 'terreo'].includes(l.code),
);

// Níveis acima dos pavimentos tipo.
export const LEVELS_ABOVE_FLOORS = TOWER_LEVELS.filter(
  (l) => !LEVELS_BELOW_FLOORS.includes(l),
);

export const getTowerLevel = (code: string): TowerLevelDef | undefined =>
  TOWER_LEVELS.find((l) => l.code === code);
