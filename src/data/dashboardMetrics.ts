import type { Apartment, ApartmentStatus, ChecklistItem, Tower } from '@/src/data/mockObras';
import { getConfiguredApartments, getConfiguredTowers } from '@/src/data/mockObras';
import { getInspectionPhotosFromStorage, getInspectionPhotoStorageKey } from '@/src/data/localInspectionPhotos';
import { getInspectionVisitsFromStorage, getInspectionVisitStorageKey } from '@/src/data/localInspectionVisits';
import type { Measurement, MeasurementStatus } from '@/src/data/localMeasurements';
import { loadAllMeasurements, measurementStatusOptions } from '@/src/data/localMeasurements';
import { getScheduleRows, getScheduledChecklistForApartment } from '@/src/data/schedule';
import type { ScheduleRow } from '@/src/data/schedule';
import { getBlockedServiceGroups, getChecklistForApartment } from '@/src/data/serviceBlockers';
import { getEtapasConfiguradas } from '@/src/data/serviceStages';

export type DashboardStatus = ApartmentStatus | 'Sem dados';
export type DashboardCriticality = 'Baixa' | 'Média' | 'Alta' | 'Crítica';

export type DashboardRow = {
  apartment: Apartment;
  blockedServices: number;
  checklist: ChecklistItem[];
  criticalPendencies: number;
  delayDays: number;
  measurements: Measurement[];
  pendingItems: ChecklistItem[];
  photos: number;
  progress: number;
  scheduleRows: ScheduleRow[];
  status: DashboardStatus;
  tower?: Tower;
  visits: number;
};

export type RankingItem = {
  label: string;
  value: number;
};

export type DashboardMetrics = {
  apartments: Apartment[];
  averageDelay: number;
  averageProgress: number;
  blockedApartments: number;
  blockedServices: number;
  criticalApartmentRows: DashboardRow[];
  measurementByContractor: RankingItem[];
  measurementByService: RankingItem[];
  measurementTotalsByStatus: Record<MeasurementStatus, number>;
  measurements: Measurement[];
  pendingByApartment: RankingItem[];
  pendingByCriticality: Record<DashboardCriticality, number>;
  pendingByPhase: RankingItem[];
  pendingByService: RankingItem[];
  pendingCritical: number;
  pendingOpen: number;
  phaseDelay: RankingItem[];
  phaseProgress: RankingItem[];
  plannedProgress: number;
  releaseBlockers: RankingItem[];
  regressions: number;
  rows: DashboardRow[];
  statusCounts: Record<DashboardStatus, number>;
  totalMeasured: number;
  totalPhotos: number;
  totalVisits: number;
  towerDelay: RankingItem[];
  towerProgress: RankingItem[];
  towers: Tower[];
  visitPendencies: number;
  withoutInspection: number;
  withInspection: number;
};

export const statusLabels: Record<DashboardStatus, string> = {
  'Sem dados': 'Sem dados',
  attention: 'Atenção',
  critical: 'Crítico',
  excellent: 'Excelente',
  good: 'Bom',
};

export const statusColors: Record<DashboardStatus, string> = {
  'Sem dados': '#64748B',
  attention: '#F59E0B',
  critical: '#DC2626',
  excellent: '#16A34A',
  good: '#2563EB',
};

export const criticalityColors: Record<DashboardCriticality, string> = {
  Baixa: '#2563EB',
  Média: '#F59E0B',
  Alta: '#F97316',
  Crítica: '#DC2626',
};

export const defaultDashboardPhases = [
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
];

const addCount = (map: Map<string, number>, key: string, amount = 1) => {
  map.set(key, (map.get(key) ?? 0) + amount);
};

export const toRanking = (map: Map<string, number>, limit = 10): RankingItem[] =>
  [...map.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((first, second) => second.value - first.value || first.label.localeCompare(second.label))
    .slice(0, limit);

const calculateProgress = (items: ChecklistItem[]) => {
  if (!items.length) return 0;

  const score = items.reduce((total, item) => {
    if (item.state === 'ok' || item.state === 'notApplicable') return total + 1;
    if (item.state === 'partial') return total + 0.5;
    return total;
  }, 0);

  return Math.round((score / items.length) * 100);
};

const getServiceMeta = () => {
  const map = new Map<string, { critical: boolean; phase: string; releaseBlocker: boolean; stage: string }>();

  getEtapasConfiguradas().forEach((stage) => {
    map.set(stage.nome, {
      critical: stage.etapaCritica,
      phase: stage.fase,
      releaseBlocker: stage.travaLiberacao,
      stage: stage.nome,
    });

    stage.subetapas.forEach((substage) => {
      map.set(substage.nome, {
        critical: stage.etapaCritica || substage.criticidadePadrao === 'Crítica',
        phase: stage.fase,
        releaseBlocker: stage.travaLiberacao || substage.travaLiberacao,
        stage: stage.nome,
      });
    });
  });

  return map;
};

const getCriticality = (
  item: ChecklistItem,
  meta?: { critical: boolean; releaseBlocker: boolean },
): DashboardCriticality => {
  if (meta?.releaseBlocker) return 'Crítica';
  if (meta?.critical) return 'Alta';
  if (item.state === 'partial') return 'Média';
  return 'Baixa';
};

const getStatus = (
  apartment: Apartment,
  progress: number,
  pendingCount: number,
  criticalPendencies: number,
  blockedRelease: boolean,
): DashboardStatus => {
  if (apartment.statusVisual === 'Sem dados') return 'Sem dados';
  if (blockedRelease || criticalPendencies > 0 || apartment.status === 'critical') return 'critical';
  if (pendingCount >= 3 || apartment.status === 'attention') return 'attention';
  if (pendingCount > 0 || progress < 90 || apartment.status === 'good') return 'good';
  return 'excellent';
};

export const getDashboardMetrics = (): DashboardMetrics => {
  const apartments = getConfiguredApartments();
  const towers = getConfiguredTowers();
  const measurements = loadAllMeasurements(apartments.map((apartment) => apartment.id));
  const towerById = new Map(towers.map((tower) => [tower.id, tower]));
  const metaByService = getServiceMeta();
  const measurementByApartment = new Map<string, Measurement[]>();

  measurements.forEach((measurement) => {
    measurementByApartment.set(measurement.apartmentId, [
      ...(measurementByApartment.get(measurement.apartmentId) ?? []),
      measurement,
    ]);
  });

  const rows = apartments.map((apartment): DashboardRow => {
    const checklist = getChecklistForApartment(apartment);
    const pendingItems = checklist.filter((item) => item.state === 'pending' || item.state === 'partial');
    const blockedGroups = getBlockedServiceGroups(checklist);
    const progress = apartment.statusVisual === 'Sem dados' ? 0 : calculateProgress(checklist);
    const scheduleRows = getScheduleRows(getScheduledChecklistForApartment(apartment));
    const criticalPendencies = pendingItems.filter((item) => getCriticality(item, metaByService.get(item.label)) === 'Crítica').length;
    const blockedRelease = pendingItems.some((item) => metaByService.get(item.label)?.releaseBlocker);

    return {
      apartment,
      blockedServices: blockedGroups.reduce((total, group) => total + group.blockedServices.length, 0),
      checklist,
      criticalPendencies,
      delayDays: scheduleRows.reduce((max, row) => Math.max(max, row.delayDays), 0),
      measurements: measurementByApartment.get(apartment.id) ?? [],
      pendingItems,
      photos: getInspectionPhotosFromStorage(getInspectionPhotoStorageKey(apartment.id)).length,
      progress,
      scheduleRows,
      status: getStatus(apartment, progress, pendingItems.length, criticalPendencies, blockedRelease),
      tower: towerById.get(apartment.towerId),
      visits: getInspectionVisitsFromStorage(getInspectionVisitStorageKey(apartment.id)).length,
    };
  });

  const statusCounts: Record<DashboardStatus, number> = {
    'Sem dados': 0,
    attention: 0,
    critical: 0,
    excellent: 0,
    good: 0,
  };
  const pendingByCriticality: Record<DashboardCriticality, number> = {
    Baixa: 0,
    Média: 0,
    Alta: 0,
    Crítica: 0,
  };
  const pendingByPhase = new Map<string, number>();
  const pendingByService = new Map<string, number>();
  const pendingByApartment = new Map<string, number>();
  const releaseBlockers = new Map<string, number>();
  const phaseProgress = new Map<string, { done: number; total: number }>();
  const towerProgress = new Map<string, { done: number; total: number }>();
  const phaseDelay = new Map<string, number>();
  const towerDelay = new Map<string, number>();
  const measurementTotalsByStatus = measurementStatusOptions.reduce(
    (totals, status) => ({ ...totals, [status]: 0 }),
    {} as Record<MeasurementStatus, number>,
  );
  const measurementByContractor = new Map<string, number>();
  const measurementByService = new Map<string, number>();

  let pendingOpen = 0;
  let pendingCritical = 0;
  let blockedServices = 0;
  let totalPhotos = 0;
  let totalVisits = 0;
  let visitPendencies = 0;
  let regressions = 0;
  let totalMeasured = 0;
  let plannedDone = 0;
  let plannedTotal = 0;
  let delaySum = 0;
  let delayedRows = 0;

  rows.forEach((row) => {
    statusCounts[row.status] += 1;
    pendingOpen += row.pendingItems.length;
    pendingCritical += row.criticalPendencies;
    blockedServices += row.blockedServices;
    totalPhotos += row.photos;
    totalVisits += row.visits;

    if (row.pendingItems.length) {
      addCount(pendingByApartment, `${row.tower?.name ?? row.apartment.towerId} / AP ${row.apartment.number}`, row.pendingItems.length);
    }

    const towerName = row.tower?.name ?? row.apartment.towerId;
    const towerEntry = towerProgress.get(towerName) ?? { done: 0, total: 0 };
    towerEntry.done += row.progress;
    towerEntry.total += 1;
    towerProgress.set(towerName, towerEntry);

    row.pendingItems.forEach((item) => {
      const meta = metaByService.get(item.label);
      const criticality = getCriticality(item, meta);
      pendingByCriticality[criticality] += 1;
      addCount(pendingByPhase, meta?.phase ?? 'Sem fase');
      addCount(pendingByService, item.label);
      if (meta?.releaseBlocker) addCount(releaseBlockers, `${meta.phase} · ${item.label}`);
    });

    row.checklist.forEach((item) => {
      const phase = metaByService.get(item.label)?.phase ?? 'Sem fase';
      const entry = phaseProgress.get(phase) ?? { done: 0, total: 0 };
      entry.total += 1;
      if (item.state === 'ok' || item.state === 'notApplicable') entry.done += 1;
      if (item.state === 'partial') entry.done += 0.5;
      phaseProgress.set(phase, entry);
    });

    row.scheduleRows.forEach((scheduleRow) => {
      const phase = metaByService.get(scheduleRow.service)?.phase ?? 'Sem fase';
      plannedTotal += 1;
      if (scheduleRow.inspectionStatus === 'ok' || scheduleRow.inspectionStatus === 'notApplicable') plannedDone += 1;
      if (scheduleRow.delayDays > 0) {
        delaySum += scheduleRow.delayDays;
        delayedRows += 1;
        addCount(phaseDelay, phase, scheduleRow.delayDays);
        addCount(towerDelay, towerName, scheduleRow.delayDays);
      }
    });

    row.measurements.forEach((measurement) => {
      measurementTotalsByStatus[measurement.status] += measurement.totalValue;
      addCount(measurementByContractor, measurement.contractor || 'Não informado', measurement.totalValue);
      addCount(measurementByService, measurement.service || 'Não informado', measurement.totalValue);
      totalMeasured += measurement.totalValue;
    });

    getInspectionVisitsFromStorage(getInspectionVisitStorageKey(row.apartment.id)).forEach((visit) => {
      visitPendencies += visit.quantidadePendencias ?? visit.issueItemIds.length;
      if (visit.evolution < 0) regressions += 1;
    });
  });

  const averageProgress = Math.round(rows.reduce((total, row) => total + row.progress, 0) / Math.max(rows.length, 1));

  return {
    apartments,
    averageDelay: Math.round(delaySum / Math.max(delayedRows, 1)),
    averageProgress,
    blockedApartments: rows.filter((row) => row.blockedServices > 0).length,
    blockedServices,
    criticalApartmentRows: [...rows]
      .filter((row) => row.status === 'critical' || row.pendingItems.length > 0 || row.blockedServices > 0 || row.delayDays > 0)
      .sort((first, second) =>
        second.pendingItems.length - first.pendingItems.length ||
        second.criticalPendencies - first.criticalPendencies ||
        second.blockedServices - first.blockedServices ||
        second.delayDays - first.delayDays,
      )
      .slice(0, 10),
    measurementByContractor: toRanking(measurementByContractor, 10),
    measurementByService: toRanking(measurementByService, 10),
    measurementTotalsByStatus,
    measurements,
    pendingByApartment: toRanking(pendingByApartment, 10),
    pendingByCriticality,
    pendingByPhase: defaultDashboardPhases.map((phase) => ({ label: phase, value: pendingByPhase.get(phase) ?? 0 })),
    pendingByService: toRanking(pendingByService, 10),
    pendingCritical,
    pendingOpen,
    phaseDelay: toRanking(phaseDelay, 10),
    phaseProgress: [...phaseProgress.entries()].map(([label, value]) => ({
      label,
      value: Math.round((value.done / Math.max(value.total, 1)) * 100),
    })),
    plannedProgress: Math.round((plannedDone / Math.max(plannedTotal, 1)) * 100),
    releaseBlockers: toRanking(releaseBlockers, 10),
    regressions,
    rows,
    statusCounts,
    totalMeasured,
    totalPhotos,
    totalVisits,
    towerDelay: toRanking(towerDelay, 10),
    towerProgress: [...towerProgress.entries()].map(([label, value]) => ({
      label,
      value: Math.round(value.done / Math.max(value.total, 1)),
    })),
    towers,
    visitPendencies,
    withoutInspection: rows.filter((row) => row.status === 'Sem dados').length,
    withInspection: rows.filter((row) => row.status !== 'Sem dados').length,
  };
};
