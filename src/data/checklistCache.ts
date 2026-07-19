import type { ChecklistItem } from '@/src/data/mockObras';
import type { ScheduleFields } from '@/src/data/schedule';

// Cache em memória dos checklists já baixados (stale-while-revalidate).
//
// Corte, lista de apartamentos da torre e tela do apartamento baixam os MESMOS
// itens de checklist, e cada uma refazia o download completo a cada foco — com
// skeleton na frente. Este cache guarda o último resultado por apartamento (e o
// checklist de nível por torre): ao voltar a uma tela, ela pinta na hora com o
// dado em memória e dispara a atualização por baixo. A rede continua sendo a
// fonte da verdade — toda busca fresca sobrescreve o cache.
//
// Ganho colateral importante: o Corte baixa os checklists da torre INTEIRA, então
// abrir qualquer apartamento daquela torre encontra o checklist já em memória e
// renderiza sem esperar a rede.

type Items = (ChecklistItem & ScheduleFields)[];
type TowerItems = (ChecklistItem & ScheduleFields & { levelCode: string })[];

const byApartment = new Map<string, Items>();
const byTower = new Map<string, TowerItems>();

export const getCachedChecklist = (apartmentId: string): Items | undefined =>
  byApartment.get(apartmentId);

export const setCachedChecklist = (apartmentId: string, items: Items) => {
  byApartment.set(apartmentId, items);
};

// Só devolve o conjunto se TODOS os apartamentos pedidos estiverem no cache —
// um mapa parcial faria os KPIs agregados (Corte/torre) saírem menores do que são.
export const getCachedChecklistsFor = (apartmentIds: string[]): Map<string, Items> | undefined => {
  const out = new Map<string, Items>();
  for (const id of apartmentIds) {
    const items = byApartment.get(id);
    if (!items) return undefined;
    out.set(id, items);
  }
  return out;
};

export const getCachedTowerChecklist = (towerId: string): TowerItems | undefined =>
  byTower.get(towerId);

export const setCachedTowerChecklist = (towerId: string, items: TowerItems) => {
  byTower.set(towerId, items);
};

// Troca de obra / refresh completo: dado antigo não deve pintar nem por um frame.
export const clearChecklistCache = () => {
  byApartment.clear();
  byTower.clear();
};
