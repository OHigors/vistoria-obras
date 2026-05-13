import type { Apartment, ChecklistItem } from '@/src/data/mockObras';
import { checklistLabels } from '@/src/data/mockObras';
import { getActiveProjectId } from '@/src/data/localProjects';

export type ServiceSubstage = {
  id: string;
  etapaId: string;
  nome: string;
  unidadeMedicao: string;
  ordem: number;
  ativo: boolean;
  apareceNoChecklist: boolean;
  apareceNoCronograma: boolean;
  apareceNaMedicao: boolean;
  criticidadePadrao: 'Baixa' | 'Média' | 'Alta' | 'Crítica';
  travaLiberacao: boolean;
  servicosDependentes: string[];
  observacao: string;
};

export type ServiceStage = {
  id: string;
  nome: string;
  fase: string;
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
  subetapas: ServiceSubstage[];
  observacao: string;
};

export const serviceStagesStorageKey = 'config-etapas-servicos-obra';

export const getServiceStagesStorageKey = () => `${serviceStagesStorageKey}-${getActiveProjectId()}`;

export const serviceStagePhases = [
  'Todas',
  'Estrutura',
  'Impermeabilização',
  'Contrapiso',
  'Revestimentos',
  'Gesso',
  'Pintura',
  'Esquadrias',
  'Acabamentos',
  'Instalações finais',
  'Limpeza e entrega',
] as const;

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
  'Liberação da unidade': ['entrega final'],
};

const groupedDefaults = [
  ['Estrutura', 'Estrutura de concreto', 'Estrutura', ['Forma', 'Armação', 'Concretagem', 'Cura', 'Desforma', 'Tratamento de falhas']],
  ['Estrutura', 'Alvenaria', 'Estrutura', ['Marcação de alvenaria', 'Elevação de alvenaria', 'Vergas e contravergas', 'Encunhamento']],
  ['Estrutura', 'Instalações embutidas', 'Instalações', ['Passagem elétrica', 'Passagem hidráulica', 'Passagem de gás', 'Infraestrutura de ar-condicionado', 'Fechamento de shaft']],
  ['Impermeabilização', 'Impermeabilização', 'Impermeabilização', ['Banheiro', 'Cozinha', 'Área de serviço', 'Sacada', 'Laje técnica', 'Teste de estanqueidade']],
  ['Contrapiso', 'Contrapiso', 'Contrapiso e regularização', ['Banheiro', 'Cozinha', 'Área de serviço', 'Sala/quartos', 'Sacada', 'Laje técnica']],
  ['Contrapiso', 'Regularização de paredes', 'Contrapiso e regularização', ['Chapisco', 'Emboço', 'Reboco']],
  ['Revestimentos', 'Revestimento cerâmico', 'Revestimentos', ['Banheiro parede', 'Banheiro piso', 'Cozinha parede', 'Cozinha piso', 'Área de serviço', 'Sacada']],
  ['Revestimentos', 'Rejunte', 'Revestimentos', ['Banheiro', 'Cozinha', 'Área de serviço', 'Sacada']],
  ['Gesso', 'Gesso', 'Gesso', ['Gesso liso interno', 'Forro de gesso banheiro', 'Forro de gesso cozinha', 'Forro de gesso área de serviço', 'Forro de gesso sala', 'Forro de gesso corredor', 'Caixote de gesso', 'Acabamento de caixote', 'Fechamento de churrasqueira em gesso', 'Sanca', 'Tabica', 'Revisão de gesso']],
  ['Pintura', 'Pintura', 'Pintura', ['Preparação de superfície', 'Selador', 'Massa corrida', 'Lixamento', 'Primeira demão', 'Segunda demão', 'Retoques', 'Pintura de teto', 'Pintura de paredes', 'Pintura externa/sacada']],
  ['Esquadrias', 'Esquadrias', 'Esquadrias e vidros', ['Contramarco', 'Instalação de esquadria', 'Regulagem', 'Vedação', 'Vidros']],
  ['Acabamentos', 'Louças e metais', 'Acabamentos', ['Bacia sanitária', 'Cuba', 'Torneiras', 'Registros', 'Chuveiro', 'Acessórios']],
  ['Acabamentos', 'Bancadas', 'Acabamentos', ['Bancada banheiro', 'Bancada cozinha', 'Soleiras', 'Peitoris']],
  ['Acabamentos', 'Portas e ferragens', 'Acabamentos', ['Batentes', 'Folhas de porta', 'Fechaduras', 'Guarnições', 'Regulagem']],
  ['Instalações finais', 'Elétrica final', 'Instalações finais', ['Tomadas', 'Interruptores', 'Quadro elétrico', 'Disjuntores', 'Testes elétricos']],
  ['Instalações finais', 'Hidráulica final', 'Instalações finais', ['Teste de pressão', 'Ligações finais', 'Teste de escoamento', 'Teste de vazamento']],
  ['Limpeza e entrega', 'Limpeza', 'Limpeza e entrega', ['Limpeza grossa', 'Limpeza fina', 'Remoção de resíduos', 'Revisão final']],
  ['Limpeza e entrega', 'Vistoria final', 'Limpeza e entrega', ['Checklist final', 'Pendências de entrega', 'Liberação da unidade']],
] as const;

const slugify = (value: string) =>
  value
    .trim()
    .toLocaleLowerCase('pt-BR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const getCategory = (name: string) => {
  if (name.includes('Impermeabilização')) return 'Impermeabilização';
  if (name.includes('Gesso') || name.includes('Forro') || name.includes('Shaft')) return 'Gesso e fechamentos';
  if (name.includes('Hidráulica') || name.includes('Ar-condicionado')) return 'Instalações';
  if (name.includes('Limpeza') || name.includes('Vistoria')) return 'Entrega';
  return 'Execução';
};

const createLegacyStage = (name: string, index: number): ServiceStage => ({
  id: slugify(name),
  nome: name,
  fase: 'Execução',
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
  subetapas: [],
  observacao: '',
});

const shouldBlockRelease = (name: string) =>
  [
    'Impermeabilização',
    'Teste de estanqueidade',
    'Fechamento de shaft',
    'Limpeza fina',
    'Vistoria final',
    'Liberação da unidade',
  ].some((term) => name.includes(term));

const createSubstage = (stageId: string, name: string, index: number): ServiceSubstage => ({
  id: `${stageId}-${slugify(name)}`,
  etapaId: stageId,
  nome: name,
  unidadeMedicao: name.includes('Checklist') || name.includes('Liberação') ? 'un' : 'm²',
  ordem: index + 1,
  ativo: true,
  apareceNoChecklist: true,
  apareceNoCronograma: true,
  apareceNaMedicao: true,
  criticidadePadrao: 'Média',
  travaLiberacao: shouldBlockRelease(name),
  servicosDependentes: defaultServiceDependencies[name] ?? [],
  observacao: '',
});

export const defaultServiceStages = checklistLabels.map(createLegacyStage);

export const defaultResidentialServiceStages: ServiceStage[] = [
  ...defaultServiceStages,
  ...groupedDefaults.map(([fase, nome, categoria, subetapas], index) => {
    const id = slugify(nome);
    return {
      id,
      nome,
      fase,
      categoria,
      unidadeMedicao: nome.includes('Vistoria') ? 'un' : 'm²',
      ordemExecucao: defaultServiceStages.length + index + 1,
      apareceNoChecklist: true,
      apareceNoCronograma: true,
      apareceNaMedicao: true,
      etapaCritica: fase === 'Impermeabilização' || nome === 'Vistoria final',
      travaLiberacao: shouldBlockRelease(nome),
      ativo: true,
      servicosDependentes: defaultServiceDependencies[nome] ?? [],
      subetapas: subetapas.map((substage, substageIndex) => createSubstage(id, substage, substageIndex)),
      observacao: '',
    };
  }),
];

const normalizeSubstage = (
  substage: Partial<ServiceSubstage>,
  stageId: string,
  index: number,
): ServiceSubstage | undefined => {
  if (typeof substage.nome !== 'string' || !substage.nome.trim()) return undefined;

  return {
    id: typeof substage.id === 'string' && substage.id ? substage.id : `${stageId}-sub-${index + 1}`,
    etapaId: typeof substage.etapaId === 'string' && substage.etapaId ? substage.etapaId : stageId,
    nome: substage.nome.trim(),
    unidadeMedicao: typeof substage.unidadeMedicao === 'string' ? substage.unidadeMedicao : 'un',
    ordem: typeof substage.ordem === 'number' ? substage.ordem : index + 1,
    ativo: substage.ativo !== false,
    apareceNoChecklist: substage.apareceNoChecklist !== false,
    apareceNoCronograma: substage.apareceNoCronograma !== false,
    apareceNaMedicao: substage.apareceNaMedicao !== false,
    criticidadePadrao: substage.criticidadePadrao ?? 'Média',
    travaLiberacao: Boolean(substage.travaLiberacao),
    servicosDependentes: Array.isArray(substage.servicosDependentes) ? substage.servicosDependentes : [],
    observacao: typeof substage.observacao === 'string' ? substage.observacao : '',
  };
};

const normalizeStage = (stage: Partial<ServiceStage>, index: number): ServiceStage | undefined => {
  if (typeof stage.nome !== 'string' || !stage.nome.trim()) return undefined;
  const id = typeof stage.id === 'string' && stage.id ? stage.id : slugify(stage.nome);

  return {
    id,
    nome: stage.nome.trim(),
    fase: typeof stage.fase === 'string' ? stage.fase : 'Execução',
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
    subetapas: Array.isArray(stage.subetapas)
      ? stage.subetapas
          .map((substage, substageIndex) => normalizeSubstage(substage, id, substageIndex))
          .filter((substage): substage is ServiceSubstage => Boolean(substage))
      : [],
    observacao: typeof stage.observacao === 'string' ? stage.observacao : '',
  };
};

export const getServiceStagesFromStorage = (): ServiceStage[] => {
  if (typeof window === 'undefined') return defaultResidentialServiceStages;

  try {
    const activeProjectId = getActiveProjectId();
    const storedValue =
      window.localStorage.getItem(getServiceStagesStorageKey()) ??
      (activeProjectId === 'residencial-cagliari'
        ? window.localStorage.getItem(serviceStagesStorageKey)
        : null);
    if (!storedValue) return defaultResidentialServiceStages;

    const normalizedStages = (JSON.parse(storedValue) as Partial<ServiceStage>[])
      .map(normalizeStage)
      .filter((stage): stage is ServiceStage => Boolean(stage));

    return normalizedStages.length
      ? normalizedStages.sort((first, second) => first.ordemExecucao - second.ordemExecucao)
      : defaultResidentialServiceStages;
  } catch {
    return defaultResidentialServiceStages;
  }
};

const sortStagesByExecution = (stages: ServiceStage[]) =>
  [...stages].sort((first, second) => first.ordemExecucao - second.ordemExecucao);

export const getEtapasConfiguradas = () => sortStagesByExecution(getServiceStagesFromStorage());

export const getEtapasAtivas = () => getEtapasConfiguradas().filter((stage) => stage.ativo);

const flattenStagesForFeature = (feature: 'checklist' | 'cronograma' | 'medicao') =>
  getEtapasAtivas().flatMap((stage) => {
    const substages = stage.subetapas
      .filter((substage) => substage.ativo)
      .filter((substage) =>
        feature === 'checklist'
          ? substage.apareceNoChecklist
          : feature === 'cronograma'
            ? substage.apareceNoCronograma
            : substage.apareceNaMedicao,
      )
      .sort((first, second) => first.ordem - second.ordem)
      .map((substage) => ({
        ...stage,
        id: substage.id,
        nome: substage.nome,
        unidadeMedicao: substage.unidadeMedicao,
        etapaCritica: stage.etapaCritica || substage.criticidadePadrao === 'Crítica',
        travaLiberacao: stage.travaLiberacao || substage.travaLiberacao,
        servicosDependentes: substage.servicosDependentes.length ? substage.servicosDependentes : stage.servicosDependentes,
        observacao: substage.observacao || stage.observacao,
      }));

    if (substages.length) return substages;

    const enabled =
      feature === 'checklist'
        ? stage.apareceNoChecklist
        : feature === 'cronograma'
          ? stage.apareceNoCronograma
          : stage.apareceNaMedicao;

    return enabled ? [stage] : [];
  });

export const getEtapasChecklist = () => flattenStagesForFeature('checklist');
export const getEtapasMedicao = () => flattenStagesForFeature('medicao');
export const getEtapasCronograma = () => flattenStagesForFeature('cronograma');

export const getServiceStageByName = (serviceName: string) =>
  getServiceStagesFromStorage().find((stage) => stage.nome === serviceName) ??
  flattenStagesForFeature('checklist').find((stage) => stage.nome === serviceName);

export const isCriticalStageForStatus = (serviceName: string) => {
  const stage = getServiceStageByName(serviceName);
  return Boolean(stage?.ativo && (stage.etapaCritica || stage.travaLiberacao));
};

const createChecklistItemFromStage = (stage: ServiceStage): ChecklistItem => ({
  id: stage.id,
  label: stage.nome,
  state: 'pending',
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
  const apartmentItemsById = new Map(apartment.checklist.map((item) => [item.id, item]));

  return stages.map(
    (stage) =>
      apartmentItemsById.get(stage.id) ??
      apartmentItemsByLabel.get(stage.nome) ??
      createChecklistItemFromStage(stage),
  );
};

export const saveServiceStagesToStorage = (stages: ServiceStage[]) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(getServiceStagesStorageKey(), JSON.stringify(stages));
};

export const createEmptyServiceStage = (order: number): ServiceStage => ({
  id: `etapa-${Date.now()}`,
  nome: '',
  fase: 'Estrutura',
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
  subetapas: [],
  observacao: '',
});

export const createEmptyServiceSubstage = (stageId: string, order: number): ServiceSubstage => ({
  id: `${stageId}-sub-${Date.now()}`,
  etapaId: stageId,
  nome: '',
  unidadeMedicao: 'un',
  ordem: order,
  ativo: true,
  apareceNoChecklist: true,
  apareceNoCronograma: true,
  apareceNaMedicao: true,
  criticidadePadrao: 'Média',
  travaLiberacao: false,
  servicosDependentes: [],
  observacao: '',
});

export const getServiceDependencyMap = () =>
  getServiceStagesFromStorage().reduce<Record<string, string[]>>((dependencies, stage) => {
    if (!stage.ativo) {
      delete dependencies[stage.nome];
      return dependencies;
    }

    const dependents = [...stage.servicosDependentes];
    if (stage.travaLiberacao && !dependents.includes('liberação do apartamento')) {
      dependents.push('liberação do apartamento');
    }

    if (dependents.length > 0) dependencies[stage.nome] = dependents;

    stage.subetapas.forEach((substage) => {
      if (!substage.ativo) return;
      const substageDependents = substage.servicosDependentes.length
        ? [...substage.servicosDependentes]
        : [...dependents];
      if (substage.travaLiberacao && !substageDependents.includes('liberação do apartamento')) {
        substageDependents.push('liberação do apartamento');
      }
      if (substageDependents.length > 0) dependencies[substage.nome] = substageDependents;
    });

    return dependencies;
  }, { ...defaultServiceDependencies });

export const isServiceActiveForFeature = (
  serviceName: string,
  feature: 'checklist' | 'cronograma' | 'medicao',
) => {
  const stage = flattenStagesForFeature(feature).find((item) => item.nome === serviceName);
  return stage ? stage.ativo : true;
};
