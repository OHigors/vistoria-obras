import { checklistLabels } from '@/src/data/mockObras';

export type ServiceStage = {
  id: string;
  nome: string;
  categoria: string;
  unidadeMedicao: string;
  ordemExecucao: number;
  apareceNoChecklist: boolean;
  apareceNoCronograma: boolean;
  apareceNaMedicao: boolean;
  etapaCritica: boolean;
  travaLiberacao: boolean;
  ativo: boolean;
  servicosDependentes: string[];
  observacao: string;
};

export const serviceStagesStorageKey = 'config-etapas-servicos-obra';

export const defaultServiceDependencies: Record<string, string[]> = {
  'Requadração monocapa da viga da sacada': ['pintura externa', 'acabamento da sacada'],
  'Fechamento da churrasqueira em gesso': ['pintura', 'limpeza fina'],
  'Impermeabilização do banheiro': ['contrapiso', 'revestimento', 'louças'],
  'Impermeabilização da área de serviço': ['contrapiso', 'revestimento'],
  'Impermeabilização da cozinha': ['contrapiso', 'revestimento'],
  'Contrapiso da laje técnica': ['acabamento da laje técnica'],
  'Remoção de excesso de gesso': ['pintura', 'limpeza fina'],
  'Contramarco da cobertura': ['esquadria', 'acabamento'],
  'Instalação do guarda-corpo da sacada': ['liberação da sacada'],
  'Forro de gesso cozinha/banheiro/corredor': ['pintura', 'iluminação', 'limpeza fina'],
  'Gesso externo': ['pintura externa'],
  'Gesso banheiro': ['pintura', 'acabamento do banheiro'],
  Hidráulica: ['fechamento de shaft', 'testes finais'],
  'Ar-condicionado': ['fechamento de forro', 'acabamento'],
  Limpeza: ['entrega final'],
  'Shaft churrasqueira/cozinha/banheiro': ['acabamento', 'pintura', 'entrega final'],
  'Forro sacada': ['pintura da sacada', 'limpeza'],
  'Reparo de pedra': ['limpeza fina', 'entrega final'],
};

const exampleStages = [
  'Impermeabilização',
  'Contrapiso',
  'Hidráulica',
  'Elétrica',
  'Fechamento de shaft',
  'Gesso',
  'Pintura',
  'Revestimento',
  'Louças e metais',
  'Esquadria',
  'Limpeza fina',
  'Vistoria final',
];

const slugify = (value: string) =>
  value
    .trim()
    .toLocaleLowerCase('pt-BR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const getCategory = (name: string) => {
  if (name.includes('Impermeabilização')) {
    return 'Impermeabilização';
  }

  if (name.includes('Gesso') || name.includes('Forro') || name.includes('Shaft')) {
    return 'Gesso e fechamentos';
  }

  if (name.includes('Hidráulica') || name.includes('Ar-condicionado')) {
    return 'Instalações';
  }

  if (name.includes('Limpeza') || name.includes('Vistoria')) {
    return 'Entrega';
  }

  return 'Execução';
};

const createStage = (name: string, index: number): ServiceStage => ({
  id: slugify(name),
  nome: name,
  categoria: getCategory(name),
  unidadeMedicao: name.includes('Limpeza') || name.includes('Vistoria') ? 'un' : 'm²',
  ordemExecucao: index + 1,
  apareceNoChecklist: true,
  apareceNoCronograma: true,
  apareceNaMedicao: true,
  etapaCritica: name.includes('Impermeabilização') || name.includes('Hidráulica') || name.includes('Vistoria'),
  travaLiberacao: name.includes('Limpeza') || name.includes('Vistoria') || name.includes('Shaft'),
  ativo: true,
  servicosDependentes: defaultServiceDependencies[name] ?? [],
  observacao: '',
});

export const defaultServiceStages: ServiceStage[] = [
  ...checklistLabels,
  ...exampleStages.filter((stage) => !checklistLabels.includes(stage)),
].map(createStage);

const normalizeStage = (stage: Partial<ServiceStage>, index: number): ServiceStage | undefined => {
  if (typeof stage.nome !== 'string' || !stage.nome.trim()) {
    return undefined;
  }

  return {
    id: typeof stage.id === 'string' && stage.id ? stage.id : slugify(stage.nome),
    nome: stage.nome,
    categoria: typeof stage.categoria === 'string' ? stage.categoria : getCategory(stage.nome),
    unidadeMedicao: typeof stage.unidadeMedicao === 'string' ? stage.unidadeMedicao : 'un',
    ordemExecucao: typeof stage.ordemExecucao === 'number' ? stage.ordemExecucao : index + 1,
    apareceNoChecklist: stage.apareceNoChecklist !== false,
    apareceNoCronograma: stage.apareceNoCronograma !== false,
    apareceNaMedicao: stage.apareceNaMedicao !== false,
    etapaCritica: Boolean(stage.etapaCritica),
    travaLiberacao: Boolean(stage.travaLiberacao),
    ativo: stage.ativo !== false,
    servicosDependentes: Array.isArray(stage.servicosDependentes) ? stage.servicosDependentes : [],
    observacao: typeof stage.observacao === 'string' ? stage.observacao : '',
  };
};

export const getServiceStagesFromStorage = (): ServiceStage[] => {
  if (typeof window === 'undefined') {
    return defaultServiceStages;
  }

  try {
    const storedValue = window.localStorage.getItem(serviceStagesStorageKey);

    if (!storedValue) {
      return defaultServiceStages;
    }

    const storedStages = JSON.parse(storedValue) as Partial<ServiceStage>[];
    const normalizedStages = storedStages
      .map(normalizeStage)
      .filter((stage): stage is ServiceStage => Boolean(stage));

    return normalizedStages.length ? normalizedStages.sort((first, second) => first.ordemExecucao - second.ordemExecucao) : defaultServiceStages;
  } catch {
    return defaultServiceStages;
  }
};

export const saveServiceStagesToStorage = (stages: ServiceStage[]) => {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(serviceStagesStorageKey, JSON.stringify(stages));
};

export const createEmptyServiceStage = (order: number): ServiceStage => ({
  id: `etapa-${Date.now()}`,
  nome: '',
  categoria: '',
  unidadeMedicao: 'un',
  ordemExecucao: order,
  apareceNoChecklist: true,
  apareceNoCronograma: true,
  apareceNaMedicao: true,
  etapaCritica: false,
  travaLiberacao: false,
  ativo: true,
  servicosDependentes: [],
  observacao: '',
});

export const getServiceDependencyMap = () =>
  getServiceStagesFromStorage().reduce<Record<string, string[]>>((dependencies, stage) => {
    if (stage.ativo && stage.servicosDependentes.length > 0) {
      dependencies[stage.nome] = stage.servicosDependentes;
    }

    return dependencies;
  }, { ...defaultServiceDependencies });

export const isServiceActiveForFeature = (
  serviceName: string,
  feature: 'checklist' | 'cronograma' | 'medicao',
) => {
  const stage = getServiceStagesFromStorage().find((item) => item.nome === serviceName);

  if (!stage) {
    return true;
  }

  if (!stage.ativo) {
    return false;
  }

  if (feature === 'checklist') {
    return stage.apareceNoChecklist;
  }

  if (feature === 'cronograma') {
    return stage.apareceNoCronograma;
  }

  return stage.apareceNaMedicao;
};
