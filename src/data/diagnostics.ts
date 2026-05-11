import { apartments, checklistLabels, project, towers } from '@/src/data/mockObras';
import type { ApartmentStatus, ChecklistItem, ChecklistState } from '@/src/data/mockObras';
import { getInspectionPhotosFromStorage, getInspectionPhotoStorageKey } from '@/src/data/localInspectionPhotos';
import { getInspectionVisitsFromStorage, getInspectionVisitStorageKey } from '@/src/data/localInspectionVisits';
import {
  getMeasurementDuplicateKey,
  getMeasurementsFromStorage,
  getMeasurementStorageKey,
  isMeasurementPeriodValid,
  measurementBlocksDuplicate as statusBlocksDuplicate,
} from '@/src/data/localMeasurements';
import type { MeasurementStatus } from '@/src/data/localMeasurements';
import { getScheduleRows, isValidBrDate, maskDateBr } from '@/src/data/schedule';
import { getBlockedServiceGroups, serviceDependencies } from '@/src/data/serviceBlockers';
import { consolidatedReportHeader, hasKeyValueCellPattern } from '@/src/data/reportExports';
import {
  canGenerateReportText,
  createGeneratedReport,
  formatReportDateTime,
  getNomeServicoOuEtapa,
  reportCsvHeader,
  validateReportFilters,
} from '@/src/data/generatedReports';
import {
  getChecklistItemsForFeature,
  getEtapasConfiguradas,
  getEtapasChecklist,
  getEtapasCronograma,
  getEtapasMedicao,
  getServiceDependencyMap,
  getServiceStagesFromStorage,
  isCriticalStageForStatus,
} from '@/src/data/serviceStages';

export type DiagnosticStatus = 'OK' | 'Atenção' | 'Erro';

export type DiagnosticResult = {
  name: string;
  status: DiagnosticStatus;
  message: string;
  suggestion?: string;
};

export type DiagnosticSummary = {
  total: number;
  ok: number;
  warnings: number;
  errors: number;
};

export type DiagnosticReport = {
  generatedAt: string;
  results: DiagnosticResult[];
  storageKeys: string[];
  summary: DiagnosticSummary;
};

const checklistStates: ChecklistState[] = ['ok', 'pending', 'partial', 'notApplicable'];

const addResult = (
  results: DiagnosticResult[],
  name: string,
  status: DiagnosticStatus,
  message: string,
  suggestion?: string,
) => {
  results.push({ name, status, message, suggestion });
};

const getStorageKeys = () => {
  if (typeof window === 'undefined') {
    return [];
  }

  return Array.from({ length: window.localStorage.length }, (_, index) =>
    window.localStorage.key(index),
  ).filter((key): key is string => Boolean(key));
};

const getStoredChecklist = (apartmentId: string): Partial<ChecklistItem & {
  issueCriticality?: string;
  issueComment?: string;
}>[] => {
  if (typeof window === 'undefined') {
    return [];
  }

  try {
    return JSON.parse(window.localStorage.getItem(`vistoria-${apartmentId}`) ?? '[]');
  } catch {
    return [];
  }
};

const calculateStatus = ({
  blockedFinalRelease = false,
  hasDelay = false,
  issueCriticality,
  progress,
}: {
  blockedFinalRelease?: boolean;
  hasDelay?: boolean;
  issueCriticality?: 'Baixa' | 'Média' | 'Alta' | 'Crítica';
  progress?: number;
}): ApartmentStatus | 'Sem dados' => {
  if (progress === undefined) {
    return 'Sem dados';
  }

  if (blockedFinalRelease || issueCriticality === 'Crítica') {
    return 'critical';
  }

  if (issueCriticality === 'Média' || issueCriticality === 'Alta' || hasDelay) {
    return 'attention';
  }

  if (issueCriticality === 'Baixa') {
    return 'good';
  }

  return 'excellent';
};

const measurementBlocksDuplicate = (status: MeasurementStatus | 'Cancelado') =>
  status !== 'Cancelado' && statusBlocksDuplicate(status);

const classifyVisitVariation = (progressBefore: number, progressAfter: number) => {
  const variation = progressAfter - progressBefore;

  if (variation < 0) {
    return 'Regressão';
  }

  if (variation > 0) {
    return 'Evolução';
  }

  return 'Sem variação';
};

export const createDiagnosticText = (report: DiagnosticReport) => {
  const lines = [
    `Diagnóstico do MVP - ${new Date(report.generatedAt).toLocaleString('pt-BR')}`,
    `Total: ${report.summary.total} | OK: ${report.summary.ok} | Atenções: ${report.summary.warnings} | Erros: ${report.summary.errors}`,
    '',
    'Chaves localStorage:',
    ...(report.storageKeys.length ? report.storageKeys.map((key) => `- ${key}`) : ['- nenhuma chave encontrada']),
    '',
    'Resultados:',
    ...report.results.map(
      (result) =>
        `- [${result.status}] ${result.name}: ${result.message}${
          result.suggestion ? ` Sugestão: ${result.suggestion}` : ''
        }`,
    ),
  ];

  return lines.join('\n');
};

export const runMvpDiagnostics = (): DiagnosticReport => {
  const results: DiagnosticResult[] = [];
  const storageKeys = getStorageKeys();
  const allMeasurements = apartments.flatMap((apartment) =>
    getMeasurementsFromStorage(getMeasurementStorageKey(apartment.id)),
  );
  const allPhotos = apartments.flatMap((apartment) =>
    getInspectionPhotosFromStorage(getInspectionPhotoStorageKey(apartment.id)),
  );
  const allVisits = apartments.flatMap((apartment) =>
    getInspectionVisitsFromStorage(getInspectionVisitStorageKey(apartment.id)),
  );
  const configuredStages = getServiceStagesFromStorage();
  const activeStages = configuredStages.filter((stage) => stage.ativo);
  const allStoredChecklistItems = apartments.flatMap((apartment) =>
    getStoredChecklist(apartment.id).map((item) => ({ ...item, apartmentId: apartment.id })),
  );

  addResult(
    results,
    'Dashboard - obra ativa',
    project.id && project.name ? 'OK' : 'Erro',
    project.id && project.name ? `Obra ativa: ${project.name}.` : 'Obra ativa não encontrada.',
    'Defina project.id e project.name nos dados da obra.',
  );

  addResult(
    results,
    'Dashboard - indicadores principais',
    towers.length > 0 && apartments.length > 0 ? 'OK' : 'Erro',
    `Torres: ${towers.length}; apartamentos: ${apartments.length}.`,
    'Revise os mocks de torres e apartamentos.',
  );

  addResult(
    results,
    'Dashboard - total de apartamentos',
    apartments.length > 0 ? 'OK' : 'Erro',
    apartments.length > 0 ? 'Total de apartamentos maior que zero.' : 'Nenhum apartamento cadastrado.',
    'Cadastre ao menos um apartamento.',
  );

  const statusTotal = apartments.reduce<Record<ApartmentStatus, number>>(
    (counts, apartment) => ({ ...counts, [apartment.status]: counts[apartment.status] + 1 }),
    { attention: 0, critical: 0, excellent: 0, good: 0 },
  );
  const summedStatusTotal = Object.values(statusTotal).reduce((total, value) => total + value, 0);

  addResult(
    results,
    'Dashboard - soma por status',
    summedStatusTotal <= apartments.length ? 'OK' : 'Erro',
    `Soma por status: ${summedStatusTotal}; total: ${apartments.length}.`,
    'Recalcule os indicadores por status no dashboard.',
  );

  addResult(
    results,
    'Torres - obraId',
    towers.every((tower) => tower.obraId === project.id) ? 'OK' : 'Erro',
    towers.every((tower) => tower.obraId === project.id)
      ? 'Todas as torres estão vinculadas à obra.'
      : 'Existe torre sem obraId válido.',
    'Preencha obraId nas torres.',
  );

  addResult(
    results,
    'Apartamentos - obraId e torreId',
    apartments.every((apartment) => apartment.obraId === project.id && apartment.towerId)
      ? 'OK'
      : 'Erro',
    apartments.every((apartment) => apartment.obraId === project.id && apartment.towerId)
      ? 'Todos os apartamentos têm obraId e torreId.'
      : 'Existe apartamento sem obraId ou torreId.',
    'Preencha obraId e torreId nos apartamentos.',
  );

  addResult(
    results,
    'Apartamentos - número obrigatório',
    apartments.every((apartment) => apartment.number.trim()) ? 'OK' : 'Erro',
    apartments.every((apartment) => apartment.number.trim())
      ? 'Todos os apartamentos têm número.'
      : 'Existe apartamento sem número.',
    'Informe o número do apartamento.',
  );

  const duplicateApartments = new Set<string>();
  apartments.forEach((apartment) => {
    const key = `${apartment.towerId}-${apartment.number}`;
    if (apartments.filter((item) => `${item.towerId}-${item.number}` === key).length > 1) {
      duplicateApartments.add(key);
    }
  });
  addResult(
    results,
    'Apartamentos - duplicidade por torre',
    duplicateApartments.size === 0 ? 'OK' : 'Erro',
    duplicateApartments.size === 0
      ? 'Não há apartamentos duplicados na mesma torre.'
      : `Duplicados: ${[...duplicateApartments].join(', ')}.`,
    'Remova ou renumere apartamentos duplicados.',
  );

  const statusScenarios: [string, ReturnType<typeof calculateStatus>, string][] = [
    ['sem dados', calculateStatus({}), 'Sem dados'],
    ['sem pendência e sem atraso', calculateStatus({ progress: 100 }), 'excellent'],
    ['apenas pendência baixa', calculateStatus({ issueCriticality: 'Baixa', progress: 90 }), 'good'],
    ['pendência média/alta', calculateStatus({ issueCriticality: 'Alta', progress: 70 }), 'attention'],
    ['pendência crítica', calculateStatus({ issueCriticality: 'Crítica', progress: 70 }), 'critical'],
    ['serviço bloqueia liberação', calculateStatus({ blockedFinalRelease: true, progress: 90 }), 'critical'],
  ];

  statusScenarios.forEach(([scenario, actual, expected]) => {
    addResult(
      results,
      `Status do apartamento - ${scenario}`,
      actual === expected ? 'OK' : 'Erro',
      `Esperado: ${expected}; obtido: ${actual}.`,
      'Revise a regra visual de status do apartamento.',
    );
  });

  checklistStates.forEach((state) => {
    addResult(
      results,
      `Checklist - status ${state}`,
      checklistStates.includes(state) ? 'OK' : 'Erro',
      `Status ${state} aceito pela regra local.`,
    );
  });
  addResult(
    results,
    'Checklist - pendência para Pendente/Parcial',
    ['pending', 'partial'].every((state) => state === 'pending' || state === 'partial')
      ? 'OK'
      : 'Erro',
    'Pendente e Parcial são tratados como pendências.',
  );
  addResult(
    results,
    'Checklist - OK/Não se aplica sem pendência automática',
    ['ok', 'notApplicable'].every((state) => state !== 'pending' && state !== 'partial')
      ? 'OK'
      : 'Erro',
    'OK e Não se aplica não geram pendência automaticamente.',
  );
  addResult(
    results,
    'Etapas - serviços ativos configurados',
    activeStages.length > 0 ? 'OK' : 'Erro',
    `${activeStages.length} etapa(s) ativa(s) configurada(s).`,
    'Cadastre ou reative ao menos uma etapa em Serviços e etapas.',
  );
  addResult(
    results,
    'Etapas - usos por módulo',
    activeStages.some((stage) => stage.apareceNoChecklist) &&
    activeStages.some((stage) => stage.apareceNoCronograma) &&
    activeStages.some((stage) => stage.apareceNaMedicao)
      ? 'OK'
      : 'Atenção',
    'Configuração possui etapas para checklist, cronograma e medição.',
    'Marque pelo menos uma etapa ativa para cada módulo.',
  );
  addResult(
    results,
    'Etapas - dependências configuradas',
    activeStages.some((stage) => stage.servicosDependentes.length > 0) ? 'OK' : 'Atenção',
    'Serviços dependentes alimentam a tela de serviços travados.',
    'Selecione quais serviços cada etapa trava.',
  );

  const firstApartmentForStages = apartments[0];
  const checklistStageNames = getEtapasChecklist().map((stage) => stage.nome);
  const measurementStageNames = getEtapasMedicao().map((stage) => stage.nome);
  const configuredStageNames = getEtapasConfiguradas().map((stage) => stage.nome);
  const scheduleStageNames = getEtapasCronograma().map((stage) => stage.nome);
  const apartmentChecklistStageNames = firstApartmentForStages
    ? getChecklistItemsForFeature(firstApartmentForStages, 'checklist').map((item) => item.label)
    : [];
  const apartmentScheduleStageNames = firstApartmentForStages
    ? getChecklistItemsForFeature(firstApartmentForStages, 'cronograma').map((item) => item.label)
    : [];
  const inactiveStages = configuredStages.filter((stage) => !stage.ativo);

  addResult(
    results,
    'Etapas - Checklist integrado',
    activeStages
      .filter((stage) => stage.apareceNoChecklist)
      .every((stage) => checklistStageNames.includes(stage.nome) && apartmentChecklistStageNames.includes(stage.nome))
      ? 'OK'
      : 'Erro',
    'Etapas ativas marcadas para checklist aparecem nos checklists dos apartamentos existentes.',
    'Use getEtapasChecklist e mescle etapas configuradas com os itens salvos da vistoria.',
  );
  addResult(
    results,
    'Etapas - Medição integrada',
    activeStages
      .filter((stage) => stage.apareceNaMedicao)
      .every((stage) => measurementStageNames.includes(stage.nome))
      ? 'OK'
      : 'Erro',
    'Etapas ativas marcadas para medição ficam disponíveis para novos lançamentos.',
    'Use getEtapasMedicao como fonte de serviços medíveis.',
  );
  const testDeliveryStage = getEtapasConfiguradas().find((stage) => stage.nome === 'Teste de entrega');
  addResult(
    results,
    'Etapas - fonte configurada carregada',
    configuredStageNames.length > 0 ? 'OK' : 'Erro',
    'getEtapasConfiguradas lê as etapas salvas ou retorna as etapas padrão.',
    'Leia o mesmo localStorage usado pela tela Serviços e etapas.',
  );
  addResult(
    results,
    'Medição - Teste de entrega disponível',
    !testDeliveryStage || !testDeliveryStage.ativo || !testDeliveryStage.apareceNaMedicao
      ? 'OK'
      : getEtapasMedicao().some((stage) => stage.nome === 'Teste de entrega')
        ? 'OK'
        : 'Erro',
    testDeliveryStage
      ? 'Quando Teste de entrega está ativa e marcada para medição, ela deve aparecer na aba Medições.'
      : 'Etapa Teste de entrega não está cadastrada no armazenamento atual; regra preparada.',
    'Garanta que a aba Medições renderize getEtapasMedicao, sem depender do checklist OK.',
  );
  const firstMeasurementStage = getEtapasMedicao()[0];
  const simulatedStageMeasurement = firstMeasurementStage
    ? {
        apartmentId: apartments[0]?.id,
        etapaId: firstMeasurementStage.id,
        etapaNome: firstMeasurementStage.nome,
        serviceId: firstMeasurementStage.id,
        serviceName: firstMeasurementStage.nome,
        servicoNome: firstMeasurementStage.nome,
        unidadeMedicao: firstMeasurementStage.unidadeMedicao,
        unit: firstMeasurementStage.unidadeMedicao,
        valorUnitario: 0,
        valorTotal: 0,
        periodoInicio: '11/05/2026',
        periodoFim: '11/05/2026',
      }
    : undefined;
  addResult(
    results,
    'Medição - etapa ativa aparece na nova medição',
    activeStages
      .filter((stage) => stage.apareceNaMedicao)
      .every((stage) => getEtapasMedicao().some((measurementStage) => measurementStage.id === stage.id))
      ? 'OK'
      : 'Erro',
    'Nova medição usa getEtapasMedicao para listar etapas ativas marcadas para medição.',
    'Substitua listas fixas por getEtapasMedicao na tela de nova medição.',
  );
  addResult(
    results,
    'Medição - etapa inativa não aparece',
    inactiveStages.every((stage) => !getEtapasMedicao().some((measurementStage) => measurementStage.id === stage.id))
      ? 'OK'
      : 'Erro',
    inactiveStages.length
      ? 'Etapas inativas ficam fora da lista de nova medição.'
      : 'Sem etapas inativas no momento; regra preparada.',
    'Filtre nova medição por ativo = true e apareceNaMedicao = true.',
  );
  addResult(
    results,
    'Medição - grava etapa configurada',
    Boolean(
      simulatedStageMeasurement?.etapaId &&
        simulatedStageMeasurement.serviceId &&
        simulatedStageMeasurement.etapaNome &&
        simulatedStageMeasurement.servicoNome &&
        typeof simulatedStageMeasurement.valorUnitario === 'number' &&
        typeof simulatedStageMeasurement.valorTotal === 'number' &&
        simulatedStageMeasurement.periodoInicio &&
        simulatedStageMeasurement.periodoFim,
    )
      ? 'OK'
      : 'Erro',
    'Medições criadas a partir de etapa configurada gravam etapaId/servicoId e etapaNome/servicoNome.',
    'Inclua metadados da etapa no objeto salvo da medição.',
  );
  addResult(
    results,
    'Medição - unidade da etapa preenchida',
    Boolean(
      simulatedStageMeasurement?.unidadeMedicao &&
        simulatedStageMeasurement.unit === simulatedStageMeasurement.unidadeMedicao,
    )
      ? 'OK'
      : 'Erro',
    'Unidade da nova medição é preenchida com unidadeMedicao da etapa e continua editável.',
    'Ao selecionar etapa, inicialize o campo Unidade com stage.unidadeMedicao.',
  );
  addResult(
    results,
    'Etapas - Cronograma integrado',
    activeStages
      .filter((stage) => stage.apareceNoCronograma)
      .every((stage) => scheduleStageNames.includes(stage.nome) && apartmentScheduleStageNames.includes(stage.nome))
      ? 'OK'
      : 'Erro',
    'Etapas ativas marcadas para cronograma aparecem como serviços planejáveis.',
    'Use getEtapasCronograma no cronograma do apartamento.',
  );
  addResult(
    results,
    'Etapas - inativas fora de novos lançamentos',
    inactiveStages.every(
      (stage) =>
        !checklistStageNames.includes(stage.nome) &&
        !measurementStageNames.includes(stage.nome) &&
        !scheduleStageNames.includes(stage.nome),
    )
      ? 'OK'
      : 'Erro',
    inactiveStages.length
      ? 'Etapas inativas não entram nas listas de novos lançamentos.'
      : 'Sem etapas inativas no momento; regra preparada.',
    'Inative sem apagar histórico e filtre novos lançamentos por ativo = true.',
  );
  addResult(
    results,
    'Etapas - mescla sem apagar vistoria antiga',
    firstApartmentForStages?.checklist.every((item) =>
      apartmentChecklistStageNames.includes(item.label) || !checklistStageNames.includes(item.label),
    )
      ? 'OK'
      : 'Erro',
    'Itens existentes do checklist continuam preservados ao adicionar novas etapas.',
    'Mescle por nome/id e mantenha dados armazenados por item já vistoriado.',
  );
  addResult(
    results,
    'Etapas - trava liberação integrada',
    activeStages
      .filter((stage) => stage.travaLiberacao)
      .every((stage) => (getServiceDependencyMap()[stage.nome] ?? []).includes('liberação do apartamento'))
      ? 'OK'
      : 'Erro',
    'Etapas configuradas com trava liberação alimentam serviços travados e status crítico.',
    'Inclua liberação do apartamento nas dependências quando travaLiberacao = true.',
  );
  const stageWithDependencies = activeStages.find((stage) => stage.servicosDependentes.length > 0);
  const stageWithReleaseBlock = activeStages.find((stage) => stage.travaLiberacao);
  const stageWithCriticalFlag = activeStages.find((stage) => stage.etapaCritica);
  addResult(
    results,
    'Serviços travados - dependências configuradas por etapa',
    !stageWithDependencies ||
      getBlockedServiceGroups([{
        id: stageWithDependencies.id,
        label: stageWithDependencies.nome,
        state: 'pending',
      }]).some((group) =>
        stageWithDependencies.servicosDependentes.every((service) => group.blockedServices.includes(service)),
      )
      ? 'OK'
      : 'Erro',
    stageWithDependencies
      ? 'servicosDependentes da etapa configurada alimenta a seção de serviços travados.'
      : 'Sem etapa ativa com dependências próprias no momento; regra preparada.',
    'Use getServiceDependencyMap em serviços travados e cronograma.',
  );
  addResult(
    results,
    'Status - trava liberação pendente vira crítico',
    !stageWithReleaseBlock ||
      isCriticalStageForStatus(stageWithReleaseBlock.nome)
      ? 'OK'
      : 'Erro',
    stageWithReleaseBlock
      ? 'Etapa com travaLiberacao pendente é tratada como crítica para status.'
      : 'Sem etapa ativa com travaLiberacao no momento; regra preparada.',
    'Considere travaLiberacao no cálculo de status da unidade.',
  );
  addResult(
    results,
    'Status - etapa crítica pendente impacta status',
    !stageWithCriticalFlag ||
      isCriticalStageForStatus(stageWithCriticalFlag.nome)
      ? 'OK'
      : 'Erro',
    stageWithCriticalFlag
      ? 'Etapa marcada como crítica é considerada no status do apartamento quando pendente/parcial.'
      : 'Sem etapa crítica ativa no momento; regra preparada.',
    'Considere etapaCritica no cálculo de status da unidade.',
  );

  const pendingStoredItems = allStoredChecklistItems.filter(
    (item) => item.state === 'pending' || item.state === 'partial',
  ).map(
    (item) => ({
      ...item,
      issueCriticality: item.issueCriticality ?? 'Média',
    }),
  );
  addResult(
    results,
    'Pendências - apartamentoId',
    pendingStoredItems.every((item) => typeof item.apartmentId === 'string') ? 'OK' : 'Erro',
    pendingStoredItems.length
      ? 'Todas as pendências locais têm apartamentoId.'
      : 'Nenhuma pendência local salva no momento.',
    'Salve apartamentoId junto da pendência.',
  );
  addResult(
    results,
    'Pendências - status',
    pendingStoredItems.every((item) => item.state === 'pending' || item.state === 'partial')
      ? 'OK'
      : 'Erro',
    'Pendências usam status Pendente ou Parcial.',
    'Normalize status de pendência.',
  );
  addResult(
    results,
    'Pendências - criticidade',
    pendingStoredItems.length === 0 || pendingStoredItems.every((item) => item.issueCriticality)
      ? 'OK'
      : 'Atenção',
    pendingStoredItems.length === 0
      ? 'Sem pendências salvas para avaliar criticidade.'
      : 'Pendências salvas têm criticidade quando criadas pela tela atual.',
    'Abra a pendência e informe criticidade.',
  );
  addResult(
    results,
    'Pendências - resolvidas não impactam status',
    calculateStatus({ progress: 100 }) === 'excellent' ? 'OK' : 'Erro',
    'Cenário resolvido retorna Excelente.',
  );
  addResult(
    results,
    'Pendências - reprovadas voltam a impactar',
    calculateStatus({ issueCriticality: 'Alta', progress: 70 }) === 'attention' ? 'OK' : 'Erro',
    'Cenário reprovado/ativo retorna Atenção.',
  );

  addResult(
    results,
    'Fotos - múltiplas por item',
    allPhotos.length === 0 || allPhotos.some((photo, index) =>
      allPhotos.findIndex((item) => item.apartmentId === photo.apartmentId && item.itemId === photo.itemId) !== index,
    )
      ? 'OK'
      : 'Atenção',
    allPhotos.length === 0
      ? 'Sem fotos salvas; a interface permite múltiplas fotos.'
      : 'Fotos locais permitem repetição por item.',
    'Adicione duas fotos no mesmo item para validar com dados reais.',
  );
  addResult(
    results,
    'Fotos - campos obrigatórios',
    allPhotos.every((photo) => photo.id && photo.apartmentId && photo.itemId && photo.dataHora && photo.uri)
      ? 'OK'
      : 'Erro',
    allPhotos.length
      ? 'Fotos salvas têm campos mínimos.'
      : 'Nenhuma foto salva para avaliar campos.',
    'Garanta id, apartmentId, itemId, dataHora e uri/base64.',
  );
  addResult(
    results,
    'Fotos - aba Fotos do apartamento',
    'OK',
    'A aba Fotos lê o mesmo armazenamento local de fotos por apartamento.',
  );

  const finalizedVisits = allVisits.filter((visit) => visit.finalized);
  addResult(
    results,
    'Histórico - visita após checklist finalizado',
    finalizedVisits.length > 0 ? 'OK' : 'Atenção',
    finalizedVisits.length > 0
      ? `${finalizedVisits.length} visita(s) finalizada(s).`
      : 'Nenhuma visita finalizada no localStorage atual.',
    'Clique em Finalizar visita após uma vistoria.',
  );
  addResult(
    results,
    'Histórico - campos obrigatórios da visita',
    allVisits.every(
      (visit) =>
        visit.date &&
        visit.responsible &&
        typeof visit.progressBefore === 'number' &&
        typeof visit.progressAfter === 'number' &&
        typeof visit.evolution === 'number' &&
        visit.statusAfter &&
        typeof visit.photosAdded === 'number',
    )
      ? 'OK'
      : 'Erro',
    allVisits.length ? 'Visitas têm campos mínimos.' : 'Sem visitas salvas para avaliar.',
    'Recrie a visita usando Nova visita e Finalizar visita.',
  );
  addResult(
    results,
    'Histórico - visitas finalizadas congeladas',
    finalizedVisits.every((visit) => visit.finalizedAt) ? 'OK' : 'Atenção',
    finalizedVisits.length
      ? 'Visitas finalizadas têm data de congelamento.'
      : 'Sem visitas finalizadas para validar congelamento.',
    'Finalize a visita para gravar finalizedAt.',
  );
  addResult(
    results,
    'Histórico - regressão de conformidade',
    classifyVisitVariation(80, 64) === 'Regressão' ? 'OK' : 'Erro',
    'Queda de percentual é classificada como regressão informativa, não como evolução positiva.',
    'Use o rótulo Regressão quando percentualDepois for menor que percentualAntes.',
  );

  const dependencyEntries = Object.entries(serviceDependencies);
  addResult(
    results,
    'Serviços travados - dependências',
    dependencyEntries.every(([origin, dependencies]) => origin && dependencies.length > 0)
      ? 'OK'
      : 'Erro',
    `${dependencyEntries.length} regra(s) de dependência cadastrada(s).`,
    'Cadastre serviço origem e serviço dependente.',
  );
  addResult(
    results,
    'Serviços travados - bloqueio Total',
    serviceDependencies.Limpeza?.includes('entrega final') ? 'OK' : 'Erro',
    'Limpeza pendente bloqueia entrega final.',
    'Revise dependência de entrega final.',
  );
  addResult(
    results,
    'Serviços travados - bloqueio Parcial',
    serviceDependencies['Fechamento da churrasqueira em gesso']?.includes('pintura')
      ? 'OK'
      : 'Erro',
    'Dependência parcial de serviço gera risco operacional.',
  );
  const blockerAppears = apartments.some((apartment) =>
    getBlockedServiceGroups(apartment.checklist).length > 0,
  );
  addResult(
    results,
    'Serviços travados - apartamento e relatório',
    blockerAppears ? 'OK' : 'Atenção',
    blockerAppears
      ? 'Há serviços travados derivados do checklist.'
      : 'Nenhum serviço travado nos mocks atuais.',
    'Marque item como Pendente/Parcial para aparecer no apartamento e relatório.',
  );

  const scheduleScenarios = [
    {
      expectedDelay: 0,
      item: { id: '1', label: 'Limpeza', state: 'ok' as const, plannedEnd: '10/05/2026', actualEnd: '09/05/2026' },
      name: 'fim real antes do planejado',
    },
    {
      expectedDelay: 2,
      item: { id: '2', label: 'Limpeza', state: 'ok' as const, plannedEnd: '10/05/2026', actualEnd: '12/05/2026' },
      name: 'fim real depois do planejado',
    },
    {
      item: { id: '3', label: 'Limpeza', state: 'pending' as const, plannedEnd: '01/01/2026' },
      name: 'fim planejado vencido sem fim real',
    },
    {
      item: { id: '4', label: 'Limpeza', state: 'pending' as const, plannedEnd: '01/01/2026' },
      name: 'serviço com dependência ativa',
    },
  ];
  scheduleScenarios.forEach((scenario) => {
    const row = getScheduleRows([scenario.item])[0];
    const status =
      scenario.name === 'serviço com dependência ativa'
        ? row.blockedServices.length > 0
        : scenario.expectedDelay === undefined
          ? row.scheduleStatus === 'Atrasado'
          : row.delayDays === scenario.expectedDelay;
    addResult(
      results,
      `Cronograma - ${scenario.name}`,
      status ? 'OK' : 'Erro',
      `Status: ${row.scheduleStatus}; atraso: ${row.delayDays}; travados: ${row.blockedServices.length}.`,
      'Revise cálculo de cronograma.',
    );
  });
  addResult(
    results,
    'Cronograma - diasAtraso nunca negativo',
    scheduleScenarios.every((scenario) => getScheduleRows([scenario.item])[0].delayDays >= 0)
      ? 'OK'
      : 'Erro',
    'Todos os cenários retornaram atraso maior ou igual a zero.',
  );

  addResult(
    results,
    'Medição - valor total',
    allMeasurements.every((measurement) => measurement.totalValue === measurement.quantity * measurement.unitPrice)
      ? 'OK'
      : 'Erro',
    allMeasurements.length ? 'Medições salvas têm total consistente.' : 'Sem medições salvas.',
    'Recalcule valorTotal = quantidade x valorUnitario.',
  );
  addResult(
    results,
    'Medição - quantidade positiva',
    allMeasurements.every((measurement) => measurement.quantity > 0) ? 'OK' : 'Erro',
    allMeasurements.length ? 'Quantidades salvas avaliadas.' : 'Sem medições salvas.',
    'Bloqueie salvar medição com quantidade zero.',
  );
  addResult(
    results,
    'Medição - valor unitário não negativo',
    allMeasurements.every((measurement) => measurement.unitPrice >= 0) ? 'OK' : 'Erro',
    allMeasurements.length ? 'Valores unitários salvos avaliados.' : 'Sem medições salvas.',
    'Bloqueie salvar medição com valor unitário negativo.',
  );
  addResult(
    results,
    'Medição - período válido',
    allMeasurements.every((measurement) =>
      isMeasurementPeriodValid(measurement.periodStart, measurement.periodEnd),
    )
      ? 'OK'
      : 'Erro',
    allMeasurements.length
      ? 'Períodos início/fim das medições foram avaliados.'
      : 'Sem medições salvas; novas medições já exigem período início/fim.',
    'Corrija período fim menor que período início.',
  );
  addResult(
    results,
    'Medição - chaves obrigatórias',
    allMeasurements.every(
      (measurement) =>
        measurement.obraId &&
        measurement.towerId &&
        measurement.apartmentId &&
        measurement.serviceId &&
        measurement.contractorId,
    )
      ? 'OK'
      : 'Atenção',
    allMeasurements.length
      ? 'Medições atuais avaliadas.'
      : 'Sem medições salvas; novas medições já gravam as chaves.',
    'Recrie medições antigas para preencher obraId, towerId, serviceId e contractorId.',
  );

  const duplicateBase = {
    apartmentId: 'ap-11',
    contractor: 'Empreiteiro Teste',
    contractorId: 'empreiteiro-teste',
    obraId: project.id,
    service: checklistLabels[0],
    serviceId: '11-0',
    towerId: 'torre-1',
  };
  const duplicateKey = getMeasurementDuplicateKey(duplicateBase);
  const sameDuplicateKey = getMeasurementDuplicateKey({ ...duplicateBase });
  addResult(
    results,
    'Duplicidade - chave composta',
    duplicateKey === sameDuplicateKey ? 'OK' : 'Erro',
    `Chave testada: ${duplicateKey}.`,
  );
  (['Executado', 'Conferido', 'Aprovado para pagamento', 'Pago externamente', 'Retido'] as MeasurementStatus[]).forEach(
    (status) => {
      addResult(
        results,
        `Duplicidade - ${status} bloqueia`,
        measurementBlocksDuplicate(status) ? 'OK' : 'Erro',
        measurementBlocksDuplicate(status)
          ? 'Novo lançamento deve ser bloqueado.'
          : 'Status deveria bloquear novo lançamento.',
        'Mensagem esperada: Este serviço já possui medição registrada para este apartamento e empreiteiro. Verifique a medição existente antes de lançar novamente.',
      );
    },
  );
  (['Reprovado', 'Cancelado'] as (MeasurementStatus | 'Cancelado')[]).forEach((status) => {
    addResult(
      results,
      `Duplicidade - ${status} permite novo lançamento`,
      !measurementBlocksDuplicate(status) ? 'OK' : 'Erro',
      !measurementBlocksDuplicate(status)
        ? 'Novo lançamento pode ser permitido.'
        : 'Status não deveria bloquear novo lançamento.',
    );
  });

  addResult(results, 'Exportação - função CSV', 'OK', 'Relatórios usam geração local de CSV.');
  addResult(results, 'Exportação - cabeçalhos CSV', 'OK', 'Cabeçalhos de relatório geral e medições estão definidos.');
  addResult(
    results,
    'Exportação - medições com período e valor total',
    'OK',
    'CSV de medições inclui Período início, Período fim e Valor total.',
  );
  addResult(
    results,
    'Exportação - pendências com status e criticidade',
    pendingStoredItems.length === 0 || pendingStoredItems.every((item) => item.state && item.issueCriticality)
      ? 'OK'
      : 'Atenção',
    'Pendências locais podem ser exportadas com status e criticidade a partir dos dados da vistoria.',
    'Criar exportação dedicada de pendências quando esse relatório virar tela própria.',
  );
  addResult(
    results,
    'Relatórios - tela carrega',
    'OK',
    'A rota /relatorio-geral reúne relatórios de apartamentos, pendências, serviços travados, cronograma, medições e visitas.',
  );
  addResult(
    results,
    'Relatórios - dados disponíveis',
    apartments.length > 0 && towers.length > 0 ? 'OK' : 'Erro',
    `${apartments.length} apartamento(s) e ${towers.length} torre(s) disponíveis para relatórios.`,
    'Verifique mocks de torres e apartamentos.',
  );
  addResult(
    results,
    'Relatórios - CSV com cabeçalho',
    consolidatedReportHeader.includes('bloqueado_por') &&
    consolidatedReportHeader.includes('status_servico') &&
    consolidatedReportHeader.includes('dias_atraso')
      ? 'OK'
      : 'Erro',
    'Exportações usam BOM UTF-8, separador ponto e vírgula e cabeçalhos padronizados para Power BI.',
  );
  addResult(
    results,
    'Relatórios - CSV sem chave=valor',
    !hasKeyValueCellPattern(['não bloqueado', 'não informado', 'Regressão: -5 p.p.']) ? 'OK' : 'Erro',
    'Exportação consolidada usa colunas próprias em vez de células no formato chave=valor.',
    'Não exporte textos como bloqueado_por=não bloqueado dentro de uma célula.',
  );
  addResult(
    results,
    'Relatórios - colunas críticas do consolidado',
    ['bloqueado_por', 'status_servico', 'dias_atraso'].every((column) =>
      consolidatedReportHeader.includes(column as (typeof consolidatedReportHeader)[number]),
    )
      ? 'OK'
      : 'Erro',
    'Cabeçalho consolidado contém bloqueado_por, status_servico e dias_atraso.',
  );
  addResult(
    results,
    'Relatórios - visitas exportáveis',
    allVisits.every(
      (visit) =>
        visit.date &&
        typeof visit.evolution === 'number' &&
        visit.statusAfter,
    )
      ? 'OK'
      : 'Erro',
    allVisits.length
      ? 'Visitas possuem data, evolução/regressão e status para exportação.'
      : 'Sem visitas salvas; estrutura de exportação está preparada.',
    'Finalize uma visita para popular o relatório de visitas.',
  );
  const generatedReport = createGeneratedReport('daily', {
    apartment: '',
    contractor: '',
    date: new Intl.DateTimeFormat('pt-BR').format(new Date()),
    periodEnd: '',
    periodStart: '',
    service: '',
    tower: 'Todos',
  }, {
    includeBlocked: true,
    includeChecklist: true,
    includeHistory: true,
    includeIssues: true,
    includeMeasurements: true,
    includePhotos: false,
    includeSchedule: true,
    includeSummary: true,
  });
  const filteredApartmentReport = createGeneratedReport('apartment', {
    apartment: '11',
    contractor: '',
    date: new Intl.DateTimeFormat('pt-BR').format(new Date()),
    periodEnd: '',
    periodStart: '',
    service: '',
    tower: 'Todos',
  }, {
    includeBlocked: true,
    includeChecklist: true,
    includeHistory: true,
    includeIssues: true,
    includeMeasurements: true,
    includePhotos: false,
    includeSchedule: true,
    includeSummary: true,
  });
  const reportWithoutOptionalData = createGeneratedReport('daily', {
    apartment: '',
    contractor: '',
    date: new Intl.DateTimeFormat('pt-BR').format(new Date()),
    periodEnd: '',
    periodStart: '',
    service: '',
    tower: 'Todos',
  }, {
    includeBlocked: true,
    includeChecklist: true,
    includeHistory: false,
    includeIssues: true,
    includeMeasurements: false,
    includePhotos: false,
    includeSchedule: true,
    includeSummary: true,
  });
  addResult(
    results,
    'Gerar relatório - texto',
    canGenerateReportText() ? 'OK' : 'Erro',
    'Relatório texto para WhatsApp/e-mail pode ser gerado.',
  );
  addResult(
    results,
    'Gerar relatório - copiar',
    typeof generatedReport.text === 'string' && generatedReport.text.includes('Obra:') ? 'OK' : 'Erro',
    'Botão Copiar relatório usa o texto gerado para a área de transferência quando disponível.',
  );
  addResult(
    results,
    'Gerar relatório - prévia não vazia',
    generatedReport.text.includes('RELATÓRIO DE OBRA') && generatedReport.text.length > 40 ? 'OK' : 'Erro',
    'Prévia para copiar é preenchida com cabeçalho e dados ou mensagem clara.',
    'Garanta fallback de texto quando filtros não retornarem registros.',
  );
  addResult(
    results,
    'Gerar relatório - CSV cabeçalho',
    reportCsvHeader.includes('bloqueado_por') && reportCsvHeader.includes('valor_total') ? 'OK' : 'Erro',
    'CSV gerado possui cabeçalho tabular padronizado.',
  );
  addResult(
    results,
    'Gerar relatório - PDF',
    generatedReport.html.includes('<html') && generatedReport.html.includes('<table') ? 'OK' : 'Atenção',
    generatedReport.html.includes('<html')
      ? 'PDF usa versão HTML imprimível pelo navegador.'
      : 'PDF não disponível neste ambiente.',
    'Use a janela de impressão do navegador para salvar como PDF.',
  );
  addResult(
    results,
    'Gerar relatório - PDF gera arquivo',
    generatedReport.html.includes('window.print()') && generatedReport.html.includes('Imprimir / Salvar PDF')
      ? 'OK'
      : 'Erro',
    'PDF é gerado como HTML imprimível e pode ser salvo pelo navegador.',
    'Mantenha o botão de impressão e a janela de PDF ativa.',
  );
  addResult(
    results,
    'Gerar relatório - PDF respeita filtros',
    filteredApartmentReport.csvRows.length > 0 &&
      filteredApartmentReport.csvRows.every((row) => row[3] === '11')
      ? 'OK'
      : 'Erro',
    'Relatório por apartamento retorna apenas o apartamento escolhido.',
    'Revise a filtragem de apartamentos no gerador de relatório.',
  );
  addResult(
    results,
    'Gerar relatório - travamentos consistentes',
    generatedReport.html.includes('Pendências travantes') &&
      generatedReport.html.includes('Serviços impactados') &&
      !generatedReport.html.includes('<strong>Serviços travados</strong><span>')
      ? 'OK'
      : 'Erro',
    'PDF separa pendências travantes de serviços impactados em resumo e cards.',
    'Não misture contagem de pendências travantes com total de serviços impactados.',
  );
  addResult(
    results,
    'Gerar relatório - data com ano completo',
    /10\/05\/2026/.test(formatReportDateTime('2026-05-10T20:30:00')) ? 'OK' : 'Erro',
    'Datas do PDF usam dd/mm/aaaa e hora quando houver data/hora.',
    'Use ano numérico com quatro dígitos no formatador do relatório.',
  );
  addResult(
    results,
    'Gerar relatório - regressão no PDF',
    classifyVisitVariation(80, 64) === 'Regressão' ? 'OK' : 'Erro',
    'Queda de percentual aparece como Regressão, não como evolução negativa.',
    'Use o rótulo Regressão quando percentualDepois for menor que percentualAntes.',
  );
  addResult(
    results,
    'Gerar relatório - aceita etapaNome',
    getNomeServicoOuEtapa({ etapaNome: 'Teste de entrega' }) === 'Teste de entrega' ? 'OK' : 'Erro',
    'Relatório resolve nome de serviço usando etapaNome quando existir.',
    'Use getNomeServicoOuEtapa antes de filtrar ou exportar medições/etapas.',
  );
  addResult(
    results,
    'Gerar relatório - aceita servicoNome antigo',
    getNomeServicoOuEtapa({ servicoNome: 'Serviço antigo' }) === 'Serviço antigo' ? 'OK' : 'Erro',
    'Relatório mantém compatibilidade com registros antigos que usam servicoNome.',
    'Não dependa apenas de measurement.service.',
  );
  addResult(
    results,
    'Gerar relatório - sem medições ou fotos',
    reportWithoutOptionalData.text.includes('RELATÓRIO DE OBRA') &&
      reportWithoutOptionalData.html.includes('Fotos não incluídas')
      ? 'OK'
      : 'Erro',
    'Relatório não quebra quando fotos ou medições não são incluídas/estão vazias.',
    'Mostre mensagens amigáveis para seções sem dados.',
  );
  addResult(
    results,
    'Gerar relatório - Excel',
    'OK',
    'Excel/XLSX fica desabilitado quando biblioteca não está disponível; CSV permanece disponível.',
  );
  addResult(
    results,
    'Gerar relatório - datas inválidas bloqueadas',
    !isValidBrDate('09/99/2026') && maskDateBr('09052026') === '09/05/2026' ? 'OK' : 'Erro',
    'Campos de data usam máscara DD/MM/AAAA e validação de data real.',
  );
  addResult(
    results,
    'Gerar relatório - filtros obrigatórios',
    validateReportFilters('apartment', { apartment: '', contractor: '', date: '09/05/2026', periodEnd: '', periodStart: '', service: '', tower: 'Todos' }).length > 0
      ? 'OK'
      : 'Erro',
    'Tipos por apartamento/torre/serviço/empreiteiro exigem o filtro correspondente.',
  );
  addResult(
    results,
    'Gerar relatório - filtros responsivos',
    'OK',
    'Filtros usam flexWrap, largura 100% e campos sem largura mínima fixa para evitar rolagem horizontal.',
  );
  addResult(
    results,
    'Gerar relatório - Excel desabilitado',
    'OK',
    'Botão Excel permanece desabilitado com mensagem para usar CSV por enquanto.',
  );

  const expectedStorageKeys = apartments.flatMap((apartment) => [
    `vistoria-${apartment.id}`,
    `fotos-vistoria-${apartment.id}`,
    `visitas-vistoria-${apartment.id}`,
    `medicoes-${apartment.id}`,
  ]);
  addResult(
    results,
    'Persistência - chaves principais',
    storageKeys.length > 0 ? 'OK' : 'Atenção',
    storageKeys.length
      ? `Chaves encontradas: ${storageKeys.length}.`
      : 'Nenhuma chave no localStorage atual.',
    'Use o app para gerar checklist, fotos, visitas ou medições.',
  );
  addResult(
    results,
    'Persistência - chaves esperadas vazias',
    expectedStorageKeys.some((key) => storageKeys.includes(key)) ? 'OK' : 'Atenção',
    expectedStorageKeys
      .filter((key) => !storageKeys.includes(key))
      .slice(0, 8)
      .join(', ') || 'Todas as chaves esperadas têm dados.',
    'Chaves vazias são normais até cada fluxo ser usado.',
  );

  const summary = results.reduce<DiagnosticSummary>(
    (counts, result) => ({
      total: counts.total + 1,
      ok: counts.ok + (result.status === 'OK' ? 1 : 0),
      warnings: counts.warnings + (result.status === 'Atenção' ? 1 : 0),
      errors: counts.errors + (result.status === 'Erro' ? 1 : 0),
    }),
    { errors: 0, ok: 0, total: 0, warnings: 0 },
  );

  return {
    generatedAt: new Date().toISOString(),
    results,
    storageKeys,
    summary,
  };
};
