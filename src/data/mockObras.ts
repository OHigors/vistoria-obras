export type ApartmentStatus = 'excellent' | 'good' | 'attention' | 'critical';

export type ChecklistState = 'ok' | 'pending' | 'partial' | 'notApplicable';

export type ChecklistItem = {
  id: string;
  label: string;
  state: ChecklistState;
  comment?: string;
};

export type Apartment = {
  id: string;
  obraId: string;
  number: string;
  floor: string;
  towerId: string;
  status: ApartmentStatus;
  statusVisual?: 'Sem dados';
  percentualVistoriado?: number;
  itensConcluidos?: number;
  totalItens?: number;
  pendencias?: number;
  servicosTravados?: number;
  medicoes?: number;
  fotos?: number;
  visitas?: number;
  progress: number;
  notes: string;
  lastInspection: string;
  checklist: ChecklistItem[];
  block?: string;
  position?: string;
  nomeNoForms?: string;
  ativo?: boolean;
};

export type Tower = {
  id: string;
  obraId: string;
  name: string;
  block: string;
  position: string;
  description: string;
  torreOficial?: string;
  nomeNoForms?: string;
  ativo?: boolean;
};

export const checklistLabels = [
  'Requadração monocapa da viga da sacada',
  'Fechamento da churrasqueira em gesso',
  'Impermeabilização do banheiro',
  'Impermeabilização da área de serviço',
  'Impermeabilização da cozinha',
  'Contrapiso da laje técnica',
  'Remoção de excesso de gesso',
  'Contramarco da cobertura',
  'Instalação do guarda-corpo da sacada',
  'Forro de gesso cozinha/banheiro/corredor',
  'Gesso externo',
  'Gesso banheiro',
  'Hidráulica',
  'Ar-condicionado',
  'Limpeza',
  'Shaft churrasqueira/cozinha/banheiro',
  'Forro sacada',
  'Reparo de pedra',
];

export const towers: Tower[] = [
  {
    id: 'torre-1',
    obraId: 'residencial-cagliari',
    name: 'Torre 1',
    block: 'Bloco B',
    position: 'Frente mar',
    description: 'Unidades com prioridade para acabamento externo e sacadas.',
  },
  {
    id: 'torre-2',
    obraId: 'residencial-cagliari',
    name: 'Torre 2',
    block: 'Bloco A',
    position: 'Frente rua',
    description: 'Unidades em fase de vistoria fina e liberação por ambiente.',
  },
];

const createChecklist = (seed: number): ChecklistItem[] =>
  checklistLabels.map((label, index) => {
    const value = (index + seed) % 6;
    return {
      id: `${seed}-${index}`,
      label,
      state:
        value === 0 ? 'partial' : value === 1 ? 'notApplicable' : value <= 3 ? 'pending' : 'ok',
    };
  });

export const apartments: Apartment[] = [
  {
    id: 'ap-11',
    obraId: 'residencial-cagliari',
    number: '11',
    floor: '1º pavimento',
    towerId: 'torre-1',
    status: 'excellent',
    progress: 94,
    notes: 'Unidade praticamente pronta para conferência final.',
    lastInspection: '07/05/2026',
    checklist: createChecklist(11),
  },
  {
    id: 'ap-12',
    obraId: 'residencial-cagliari',
    number: '12',
    floor: '1º pavimento',
    towerId: 'torre-1',
    status: 'good',
    progress: 78,
    notes: 'Pendências simples em gesso e limpeza.',
    lastInspection: '07/05/2026',
    checklist: createChecklist(12),
  },
  {
    id: 'ap-15',
    obraId: 'residencial-cagliari',
    number: '15',
    floor: '1º pavimento',
    towerId: 'torre-1',
    status: 'attention',
    progress: 61,
    notes: 'Revisar impermeabilização e fechamento da churrasqueira.',
    lastInspection: '06/05/2026',
    checklist: createChecklist(15),
  },
  {
    id: 'ap-24',
    obraId: 'residencial-cagliari',
    number: '24',
    floor: '2º pavimento',
    towerId: 'torre-2',
    status: 'good',
    progress: 82,
    notes: 'Boa evolução, faltam conferências de forro e hidráulica.',
    lastInspection: '07/05/2026',
    checklist: createChecklist(24),
  },
  {
    id: 'ap-33',
    obraId: 'residencial-cagliari',
    number: '33',
    floor: '3º pavimento',
    towerId: 'torre-2',
    status: 'critical',
    progress: 38,
    notes: 'Concentrar equipe nas pendências críticas antes da próxima rodada.',
    lastInspection: '05/05/2026',
    checklist: createChecklist(33),
  },
  {
    id: 'ap-82',
    obraId: 'residencial-cagliari',
    number: '82',
    floor: '8º pavimento',
    towerId: 'torre-2',
    status: 'attention',
    progress: 55,
    notes: 'Acompanhar contrapiso da laje técnica e reparo de pedra.',
    lastInspection: '06/05/2026',
    checklist: createChecklist(82),
  },
];

export const project = {
  id: 'residencial-cagliari',
  name: 'Residencial Cagliari',
  address: 'Obra residencial multifamiliar',
  summary: 'MVP para vistoria e acompanhamento visual de apartamentos.',
};

export const importedTowersStorageKey = 'apartamentos-importados-torres';
export const importedApartmentsStorageKey = 'apartamentos-importados-unidades';
const activeProjectStorageKey = 'obra-ativa-id';

const canUseLocalStorage = () => typeof window !== 'undefined' && Boolean(window.localStorage);

const readImportedTowers = (): Tower[] => {
  if (!canUseLocalStorage()) {
    return [];
  }

  try {
    const storedValue = window.localStorage.getItem(importedTowersStorageKey);
    const parsedValue = storedValue ? JSON.parse(storedValue) : [];
    return Array.isArray(parsedValue) ? parsedValue : [];
  } catch {
    return [];
  }
};

const readImportedApartments = (): Apartment[] => {
  if (!canUseLocalStorage()) {
    return [];
  }

  try {
    const storedValue = window.localStorage.getItem(importedApartmentsStorageKey);
    const parsedValue = storedValue ? JSON.parse(storedValue) : [];
    return Array.isArray(parsedValue) ? parsedValue : [];
  } catch {
    return [];
  }
};

const mergeById = <T extends { id: string; ativo?: boolean }>(baseItems: T[], importedItems: T[]) => {
  const itemsById = new Map<string, T>();

  baseItems.forEach((item) => itemsById.set(item.id, item));
  importedItems.forEach((item) => {
    if (item.ativo === false) {
      itemsById.delete(item.id);
      return;
    }

    itemsById.set(item.id, item);
  });

  return [...itemsById.values()];
};

const getActiveObraId = () => {
  if (!canUseLocalStorage()) {
    return project.id;
  }

  const storedProjects = window.localStorage.getItem('obras-cadastradas');
  if (storedProjects) {
    try {
      const parsedProjects = JSON.parse(storedProjects) as { id: string; active?: boolean }[];
      if (Array.isArray(parsedProjects) && parsedProjects.length === 0) {
        return '';
      }

      const activeProject =
        parsedProjects.find((storedProject) => storedProject.active) ?? parsedProjects[0];
      return window.localStorage.getItem(activeProjectStorageKey) ?? activeProject?.id ?? '';
    } catch {
      return window.localStorage.getItem(activeProjectStorageKey) ?? project.id;
    }
  }

  return window.localStorage.getItem(activeProjectStorageKey) ?? project.id;
};

export const getConfiguredTowers = () => {
  const activeObraId = getActiveObraId();
  const importedTowers = readImportedTowers().filter((tower) => tower.obraId === activeObraId);

  if (activeObraId !== project.id) {
    return importedTowers;
  }

  return mergeById(towers, importedTowers);
};

export const getConfiguredApartments = () => {
  const activeObraId = getActiveObraId();
  const importedApartments = readImportedApartments().filter(
    (apartment) => apartment.obraId === activeObraId,
  );

  if (activeObraId !== project.id) {
    return importedApartments;
  }

  if (importedApartments.length === 0) {
    return apartments;
  }

  const importedKeys = new Set(
    importedApartments.map((apartment) => `${apartment.towerId}-${apartment.number}`),
  );
  const baseWithoutImportedDuplicates = apartments.filter(
    (apartment) => !importedKeys.has(`${apartment.towerId}-${apartment.number}`),
  );

  return mergeById(baseWithoutImportedDuplicates, importedApartments);
};

export const saveImportedBuildingData = (nextTowers: Tower[], nextApartments: Apartment[]) => {
  if (!canUseLocalStorage()) {
    return;
  }

  window.localStorage.setItem(importedTowersStorageKey, JSON.stringify(nextTowers));
  window.localStorage.setItem(importedApartmentsStorageKey, JSON.stringify(nextApartments));
};

export const getImportedBuildingData = () => ({
  apartments: readImportedApartments(),
  towers: readImportedTowers(),
});

export const getTowerById = (towerId: string) =>
  getConfiguredTowers().find((tower) => tower.id === towerId);

export const getApartmentById = (apartmentId: string) =>
  getConfiguredApartments().find((apartment) => apartment.id === apartmentId) ??
  apartments.find((apartment) => apartment.id === apartmentId);

export const getApartmentsByTower = (towerId: string) =>
  getConfiguredApartments().filter((apartment) => apartment.towerId === towerId);
