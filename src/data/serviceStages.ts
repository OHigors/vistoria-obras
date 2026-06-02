import type { Apartment, ChecklistItem } from '@/src/data/mockObras';
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
  dataInicio: string;
  dataFim: string;
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
  dataInicio: '',
  dataFim: '',
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
    dataInicio: typeof stage.dataInicio === 'string' ? stage.dataInicio : '',
    dataFim: typeof stage.dataFim === 'string' ? stage.dataFim : '',
  };
};

// These sync shims are kept for backward compat with non-async callers (diagnostics.ts).
// Real loading/saving goes through src/data/db.ts (loadServiceStages / saveServiceStages).
export const getServiceStagesFromStorage = (): ServiceStage[] => defaultServiceStages;
export const saveServiceStagesToStorage = (_stages: ServiceStage[]) => {};

const sortStagesByExecution = (stages: ServiceStage[]) =>
  [...stages].sort((a, b) => a.ordemExecucao - b.ordemExecucao);

export const getEtapasConfiguradas = () => sortStagesByExecution(getServiceStagesFromStorage());
export const getEtapasAtivas = () => getEtapasConfiguradas().filter((s) => s.ativo);
export const getEtapasChecklist = () => getEtapasAtivas().filter((s) => s.apareceNoChecklist);
export const getEtapasMedicao = () => getEtapasAtivas().filter((s) => s.apareceNaMedicao);
export const getEtapasCronograma = () => getEtapasAtivas().filter((s) => s.apareceNoCronograma);

export const getServiceStageByName = (serviceName: string) =>
  getServiceStagesFromStorage().find((s) => s.nome === serviceName);

export const isCriticalStageForStatus = (serviceName: string) => {
  const stage = getServiceStageByName(serviceName);
  return Boolean(stage?.ativo && (stage.etapaCritica || stage.travaLiberacao));
};

const createChecklistItemFromStage = (stage: ServiceStage): ChecklistItem => ({
  id: stage.id,
  label: stage.nome,
  state: 'ok',
  comment: '',
});

export const getChecklistItemsForFeature = (
  apartment: Apartment,
  feature: 'checklist' | 'cronograma' | 'medicao',
): ChecklistItem[] => {
  const stages =
    feature === 'checklist'
      ? getEtapasChecklist()
      : feature === 'cronograma'
        ? getEtapasCronograma()
        : getEtapasMedicao();
  const apartmentItemsByLabel = new Map(apartment.checklist.map((item) => [item.label, item]));
  return stages.map((stage) => apartmentItemsByLabel.get(stage.nome) ?? createChecklistItemFromStage(stage));
};

export const createEmptyServiceStage = (order: number): ServiceStage => ({
  id: '',
  nome: '',
  categoria: '',
  unidadeMedicao: '',
  ordemExecucao: order,
  apareceNoChecklist: true,
  apareceNoCronograma: true,
  apareceNaMedicao: true,
  etapaCritica: false,
  travaLiberacao: false,
  ativo: true,
  servicosDependentes: [],
  observacao: '',
  dataInicio: '',
  dataFim: '',
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
