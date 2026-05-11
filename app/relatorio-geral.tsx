import { Link } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { getInspectionPhotosFromStorage, getInspectionPhotoStorageKey } from '@/src/data/localInspectionPhotos';
import { getInspectionVisitsFromStorage, getInspectionVisitStorageKey } from '@/src/data/localInspectionVisits';
import type { Measurement, MeasurementStatus } from '@/src/data/localMeasurements';
import { formatCurrency, loadAllMeasurements, measurementStatusOptions, parseBrDateForMeasurement } from '@/src/data/localMeasurements';
import type { Apartment, ApartmentStatus, ChecklistItem } from '@/src/data/mockObras';
import { apartments, getApartmentById, getTowerById, project, towers } from '@/src/data/mockObras';
import { consolidatedReportHeader } from '@/src/data/reportExports';
import { getScheduleRows, getScheduledChecklistForApartment } from '@/src/data/schedule';
import { getBlockedServiceGroups } from '@/src/data/serviceBlockers';
import { isCriticalStageForStatus } from '@/src/data/serviceStages';
import { statusConfig } from '@/src/ui/status';

type IssueCriticality = 'Baixa' | 'Média' | 'Alta' | 'Crítica';
type StoredChecklistItem = ChecklistItem & {
  issueComment?: string;
  issueCriticality?: IssueCriticality;
};

type ApartmentReportRow = {
  apartment: Apartment;
  towerId: string;
  towerLabel: string;
  floor: string;
  status: ApartmentStatus;
  progress: number;
  pendingCount: number;
  blockedCount: number;
  maxDelayDays: number;
  lastVisit: string;
};

type PendingReportRow = {
  apartmentId: string;
  apartmentNumber: string;
  towerId: string;
  towerLabel: string;
  service: string;
  description: string;
  status: string;
  criticality: IssueCriticality;
  blocksServices: string;
  photoCount: number;
  createdAt: string;
};

type BlockedReportRow = {
  apartmentId: string;
  apartmentNumber: string;
  towerId: string;
  towerLabel: string;
  originService: string;
  impactedServices: string;
  blockType: string;
  scheduleImpact: string;
  releaseImpact: string;
  apartmentStatus: ApartmentStatus;
};

type ScheduleReportRow = {
  apartmentId: string;
  apartmentNumber: string;
  towerId: string;
  towerLabel: string;
  service: string;
  plannedStart: string;
  plannedEnd: string;
  actualStart: string;
  actualEnd: string;
  status: string;
  delayDays: number;
  blockedBy: string;
};

type MeasurementReportRow = Measurement & {
  apartmentNumber: string;
  towerId: string;
  towerLabel: string;
};

type VisitReportRow = {
  apartmentId: string;
  apartmentNumber: string;
  towerId: string;
  towerLabel: string;
  date: string;
  responsible: string;
  progressBefore: number;
  progressAfter: number;
  evolution: number;
  statusAfter: string;
  photosAdded: number;
  pendingCount: number;
};

const getVisitVariationLabel = (variation: number) => {
  if (variation > 0) {
    return `Evolução: +${variation} p.p.`;
  }

  if (variation < 0) {
    return `Regressão: ${variation} p.p.`;
  }

  return 'Sem variação: 0 p.p.';
};

const allFilter = 'Todos';
const csvSeparator = ';';
const csvBom = '\uFEFF';

const escapeCsvValue = (value: string | number) => {
  const text = String(value);

  if (text.includes('"') || text.includes(csvSeparator) || text.includes('\n') || text.includes('\r')) {
    return `"${text.replaceAll('"', '""')}"`;
  }

  return text;
};

const downloadCsv = (fileName: string, header: string[], rows: (string | number)[][]) => {
  if (typeof document === 'undefined') {
    return;
  }

  const csv = csvBom + [header, ...rows]
    .map((row) => row.map((value) => escapeCsvValue(value)).join(csvSeparator))
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
};

const emptyValue = 'não informado';
const emptyBlockValue = 'não bloqueado';

const calculateProgress = (checklist: ChecklistItem[]) => {
  const score = checklist.reduce((total, item) => {
    if (item.state === 'ok' || item.state === 'notApplicable') {
      return total + 1;
    }

    if (item.state === 'partial') {
      return total + 0.5;
    }

    return total;
  }, 0);

  return checklist.length ? Math.round((score / checklist.length) * 100) : 0;
};

const calculateStatus = (checklist: ChecklistItem[], progress: number): ApartmentStatus => {
  const pendingCount = checklist.filter((item) => item.state === 'pending').length;
  const partialCount = checklist.filter((item) => item.state === 'partial').length;
  const manyPending = pendingCount >= Math.max(3, Math.ceil(checklist.length * 0.35));
  const hasCriticalStage = checklist.some(
    (item) =>
      (item.state === 'pending' || item.state === 'partial') &&
      isCriticalStageForStatus(item.label),
  );

  if (progress < 50 || manyPending || hasCriticalStage) {
    return 'critical';
  }

  if ((progress >= 50 && progress <= 74) || partialCount > 0) {
    return 'attention';
  }

  if (progress >= 90 && pendingCount === 0) {
    return 'excellent';
  }

  return 'good';
};

const getStoredChecklist = (apartment: Apartment): StoredChecklistItem[] =>
  getScheduledChecklistForApartment(apartment).map((item) => item as StoredChecklistItem);

const formatVisitDate = (value: string) =>
  new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));

const isInPeriod = (value: string, periodStart: string, periodEnd: string) => {
  if (!periodStart.trim() && !periodEnd.trim()) {
    return true;
  }

  const date = parseBrDateForMeasurement(value);
  const start = periodStart.trim() ? parseBrDateForMeasurement(periodStart.trim()) : undefined;
  const end = periodEnd.trim() ? parseBrDateForMeasurement(periodEnd.trim()) : undefined;

  if (!date) {
    return true;
  }

  return (!start || date.getTime() >= start.getTime()) && (!end || date.getTime() <= end.getTime());
};

const getTowerLabel = (towerId: string) => {
  const tower = getTowerById(towerId);
  return tower ? `${tower.name} / ${tower.block} / ${tower.position}` : towerId;
};

export default function GeneralReportScreen() {
  const [refreshToken, setRefreshToken] = useState(0);
  const [towerFilter, setTowerFilter] = useState(allFilter);
  const [apartmentFilter, setApartmentFilter] = useState('');
  const [serviceFilter, setServiceFilter] = useState('');
  const [contractorFilter, setContractorFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [criticalityFilter, setCriticalityFilter] = useState('');
  const [periodStartFilter, setPeriodStartFilter] = useState('');
  const [periodEndFilter, setPeriodEndFilter] = useState('');
  const clearFilters = () => {
    setTowerFilter(allFilter);
    setApartmentFilter('');
    setServiceFilter('');
    setContractorFilter('');
    setStatusFilter('');
    setCriticalityFilter('');
    setPeriodStartFilter('');
    setPeriodEndFilter('');
  };

  useFocusEffect(
    useCallback(() => {
      setRefreshToken((current) => current + 1);
    }, []),
  );

  const reportData = useMemo(() => {
    void refreshToken;

    const measurements: MeasurementReportRow[] = loadAllMeasurements(apartments.map((apartment) => apartment.id))
      .map((measurement) => {
        const apartment = getApartmentById(measurement.apartmentId);
        return {
          ...measurement,
          apartmentNumber: apartment?.number ?? measurement.apartmentId.replace('ap-', ''),
          towerId: measurement.towerId ?? apartment?.towerId ?? '',
          towerLabel: getTowerLabel(measurement.towerId ?? apartment?.towerId ?? ''),
        };
      });

    const apartmentRows: ApartmentReportRow[] = apartments.map((apartment) => {
      const checklist = getStoredChecklist(apartment);
      const progress = calculateProgress(checklist);
      const status = calculateStatus(checklist, progress);
      const blockedGroups = getBlockedServiceGroups(checklist);
      const scheduleRows = getScheduleRows(checklist);
      const visits = getInspectionVisitsFromStorage(getInspectionVisitStorageKey(apartment.id));
      const latestVisit = [...visits].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];

      return {
        apartment,
        towerId: apartment.towerId,
        towerLabel: getTowerLabel(apartment.towerId),
        floor: apartment.floor,
        status,
        progress,
        pendingCount: checklist.filter((item) => item.state === 'pending' || item.state === 'partial').length,
        blockedCount: blockedGroups.reduce((total, group) => total + group.blockedServices.length, 0),
        maxDelayDays: Math.max(0, ...scheduleRows.map((row) => row.delayDays)),
        lastVisit: latestVisit ? formatVisitDate(latestVisit.date) : 'sem visita',
      };
    });

    const pendingRows: PendingReportRow[] = apartments.flatMap((apartment) => {
      const checklist = getStoredChecklist(apartment);
      const photos = getInspectionPhotosFromStorage(getInspectionPhotoStorageKey(apartment.id));

      return checklist
        .filter((item) => item.state === 'pending' || item.state === 'partial')
        .map((item) => ({
          apartmentId: apartment.id,
          apartmentNumber: apartment.number,
          towerId: apartment.towerId,
          towerLabel: getTowerLabel(apartment.towerId),
          service: item.label,
          description: item.issueComment || item.comment || 'Pendência de vistoria',
          status: item.state === 'pending' ? 'Pendente' : 'Parcial',
          criticality: item.issueCriticality ?? 'Média',
          blocksServices: (getBlockedServiceGroups([item])[0]?.blockedServices ?? []).join(', ') || 'não trava',
          photoCount: photos.filter((photo) => photo.itemId === item.id || photo.serviceId === item.id).length,
          createdAt: 'localStorage',
        }));
    });

    const blockedRows: BlockedReportRow[] = apartments.flatMap((apartment) => {
      const apartmentRow = apartmentRows.find((row) => row.apartment.id === apartment.id);

      return getBlockedServiceGroups(getStoredChecklist(apartment)).map((group) => ({
        apartmentId: apartment.id,
        apartmentNumber: apartment.number,
        towerId: apartment.towerId,
        towerLabel: getTowerLabel(apartment.towerId),
        originService: group.pendingService,
        impactedServices: group.blockedServices.join(', '),
        blockType: group.currentStatus,
        scheduleImpact: group.impact === 'Crítico' || group.impact === 'Alto' ? 'Alto impacto' : 'Em risco',
        releaseImpact: group.blockedServices.some((service) => service.includes('entrega') || service.includes('liberação'))
          ? 'Impacta liberação'
          : 'Não impacta liberação final',
        apartmentStatus: apartmentRow?.status ?? apartment.status,
      }));
    });

    const scheduleRows: ScheduleReportRow[] = apartments.flatMap((apartment) =>
      getScheduleRows(getStoredChecklist(apartment)).map((row) => ({
        apartmentId: apartment.id,
        apartmentNumber: apartment.number,
        towerId: apartment.towerId,
        towerLabel: getTowerLabel(apartment.towerId),
        service: row.service,
        plannedStart: row.plannedStart ?? '',
        plannedEnd: row.plannedEnd ?? '',
        actualStart: row.actualStart ?? '',
        actualEnd: row.actualEnd ?? '',
        status: row.scheduleStatus,
        delayDays: row.delayDays,
        blockedBy:
          row.blockedServices.length > 0
            ? row.blockedServices.join(', ')
            : getBlockedServiceGroups(getStoredChecklist(apartment)).find((group) =>
                group.blockedServices.includes(row.service),
              )?.pendingService ?? 'não bloqueado',
      })),
    );

    const visitRows: VisitReportRow[] = apartments.flatMap((apartment) =>
      getInspectionVisitsFromStorage(getInspectionVisitStorageKey(apartment.id)).map((visit) => ({
        apartmentId: apartment.id,
        apartmentNumber: apartment.number,
        towerId: apartment.towerId,
        towerLabel: getTowerLabel(apartment.towerId),
        date: formatVisitDate(visit.date),
        responsible: visit.responsible,
        progressBefore: visit.progressBefore,
        progressAfter: visit.progressAfter,
        evolution: visit.evolution,
        statusAfter: statusConfig[visit.statusAfter].label,
        photosAdded: visit.photosAdded,
        pendingCount: visit.issueItemIds.length,
      })),
    );

    return { apartmentRows, blockedRows, measurements, pendingRows, scheduleRows, visitRows };
  }, [refreshToken]);

  const filterCommon = <T extends { apartmentNumber: string; service?: string; status?: string; towerId: string }>(row: T) => {
    const matchesTower = towerFilter === allFilter || row.towerId === towerFilter;
    const matchesApartment = !apartmentFilter.trim() || row.apartmentNumber.includes(apartmentFilter.trim());
    const matchesService =
      !serviceFilter.trim() ||
      (row.service ?? '').toLocaleLowerCase('pt-BR').includes(serviceFilter.trim().toLocaleLowerCase('pt-BR'));
    const matchesStatus =
      !statusFilter.trim() ||
      (row.status ?? '').toLocaleLowerCase('pt-BR').includes(statusFilter.trim().toLocaleLowerCase('pt-BR'));

    return matchesTower && matchesApartment && matchesService && matchesStatus;
  };

  const apartmentRows = reportData.apartmentRows.filter((row) => {
    const matchesTower = towerFilter === allFilter || row.towerId === towerFilter;
    const matchesApartment = !apartmentFilter.trim() || row.apartment.number.includes(apartmentFilter.trim());
    const matchesStatus =
      !statusFilter.trim() ||
      statusConfig[row.status].label.toLocaleLowerCase('pt-BR').includes(statusFilter.trim().toLocaleLowerCase('pt-BR'));

    return matchesTower && matchesApartment && matchesStatus;
  });
  const pendingRows = reportData.pendingRows.filter(
    (row) =>
      filterCommon(row) &&
      (!criticalityFilter.trim() ||
        row.criticality.toLocaleLowerCase('pt-BR').includes(criticalityFilter.trim().toLocaleLowerCase('pt-BR'))),
  );
  const blockedRows = reportData.blockedRows.filter((row) =>
    filterCommon({ ...row, service: row.originService, status: row.blockType }),
  );
  const scheduleRows = reportData.scheduleRows.filter((row) =>
    filterCommon(row) && isInPeriod(row.plannedEnd || row.actualEnd, periodStartFilter, periodEndFilter),
  );
  const measurementRows = reportData.measurements.filter((row) => {
    const matchesContractor =
      !contractorFilter.trim() ||
      row.contractor.toLocaleLowerCase('pt-BR').includes(contractorFilter.trim().toLocaleLowerCase('pt-BR'));
    return filterCommon(row) && matchesContractor && isInPeriod(row.periodStart, periodStartFilter, periodEndFilter);
  });
  const visitRows = reportData.visitRows.filter((row) => {
    const matchesTower = towerFilter === allFilter || row.towerId === towerFilter;
    const matchesApartment = !apartmentFilter.trim() || row.apartmentNumber.includes(apartmentFilter.trim());
    return matchesTower && matchesApartment;
  });

  const totalByMeasurementStatus = (status: MeasurementStatus) =>
    measurementRows
      .filter((measurement) => measurement.status === status)
      .reduce((total, measurement) => total + measurement.totalValue, 0);

  const exportApartments = () =>
    downloadCsv(
      'relatorio-apartamentos-residencial-cagliari.csv',
      ['obra', 'torre', 'apartamento', 'pavimento', 'status_visual', 'percentual_vistoriado', 'pendencias', 'servicos_travados', 'dias_atraso', 'ultima_visita'],
      apartmentRows.map((row) => [
        project.name,
        row.towerLabel,
        row.apartment.number,
        row.floor,
        statusConfig[row.status].label,
        row.progress,
        row.pendingCount,
        row.blockedCount,
        row.maxDelayDays,
        row.lastVisit,
      ]),
    );

  const exportPending = () =>
    downloadCsv(
      'relatorio-pendencias-residencial-cagliari.csv',
      ['obra', 'torre', 'apartamento', 'servico', 'descricao', 'status', 'criticidade', 'trava_servico', 'fotos', 'data_criacao'],
      pendingRows.map((row) => [
        project.name,
        row.towerLabel,
        row.apartmentNumber,
        row.service,
        row.description,
        row.status,
        row.criticality,
        row.blocksServices,
        row.photoCount,
        row.createdAt,
      ]),
    );

  const exportBlocked = () =>
    downloadCsv(
      'relatorio-servicos-travados-residencial-cagliari.csv',
      ['obra', 'torre', 'apartamento', 'servico_origem', 'servicos_impactados', 'tipo_bloqueio', 'impacto_cronograma', 'impacto_liberacao', 'status_apartamento'],
      blockedRows.map((row) => [
        project.name,
        row.towerLabel,
        row.apartmentNumber,
        row.originService,
        row.impactedServices,
        row.blockType,
        row.scheduleImpact,
        row.releaseImpact,
        statusConfig[row.apartmentStatus].label,
      ]),
    );

  const exportSchedule = () =>
    downloadCsv(
      'relatorio-cronograma-residencial-cagliari.csv',
      ['obra', 'torre', 'apartamento', 'servico', 'inicio_planejado', 'fim_planejado', 'inicio_real', 'fim_real', 'status', 'dias_atraso', 'servico_bloqueado_por'],
      scheduleRows.map((row) => [
        project.name,
        row.towerLabel,
        row.apartmentNumber,
        row.service,
        row.plannedStart,
        row.plannedEnd,
        row.actualStart,
        row.actualEnd,
        row.status,
        row.delayDays,
        row.blockedBy || emptyBlockValue,
      ]),
    );

  const exportMeasurements = () =>
    downloadCsv(
      'relatorio-medicoes-residencial-cagliari.csv',
      ['obra', 'torre', 'apartamento', 'servico', 'empreiteiro', 'periodo_inicio', 'periodo_fim', 'quantidade', 'unidade', 'valor_unitario', 'valor_total', 'status', 'responsavel', 'data_lancamento', 'data_aprovacao'],
      measurementRows.map((row) => [
        project.name,
        row.towerLabel,
        row.apartmentNumber,
        row.service,
        row.contractor,
        row.periodStart,
        row.periodEnd,
        row.quantity,
        row.unit,
        row.unitPrice,
        row.totalValue,
        row.status,
        row.responsible ?? 'Usuário local',
        row.launchedAt ?? '',
        row.approvedAt ?? '',
      ]),
    );

  const exportVisits = () =>
    downloadCsv(
      'relatorio-visitas-residencial-cagliari.csv',
      ['obra', 'torre', 'apartamento', 'data_visita', 'responsavel', 'percentual_antes', 'percentual_depois', 'evolucao_ou_regressao', 'status_apos_visita', 'fotos_adicionadas', 'pendencias'],
      visitRows.map((row) => [
        project.name,
        row.towerLabel,
        row.apartmentNumber,
        row.date,
        row.responsible,
        row.progressBefore,
        row.progressAfter,
        getVisitVariationLabel(row.evolution),
        row.statusAfter,
        row.photosAdded,
        row.pendingCount,
      ]),
    );

  const criticalApartments = apartmentRows.filter((row) => row.status === 'critical');
  const approvedMeasurements = measurementRows.filter((row) => row.status === 'Aprovado para pagamento');
  const statusCounts = {
    attention: apartmentRows.filter((row) => row.status === 'attention').length,
    critical: criticalApartments.length,
    excellent: apartmentRows.filter((row) => row.status === 'excellent').length,
    good: apartmentRows.filter((row) => row.status === 'good').length,
  };
  const totalMeasured = measurementRows.reduce((total, row) => total + row.totalValue, 0);
  const totalApproved = totalByMeasurementStatus('Aprovado para pagamento');
  const totalPaidExternally = totalByMeasurementStatus('Pago externamente');

  const exportConsolidated = () =>
    downloadCsv(
      'relatorio-geral-consolidado-residencial-cagliari.csv',
      [...consolidatedReportHeader],
      [
        ...apartmentRows.map((row) => [
          'apartamento',
          project.name,
          row.towerLabel,
          row.apartment.number,
          row.floor,
          statusConfig[row.status].label,
          row.progress,
          emptyValue,
          emptyValue,
          row.maxDelayDays,
          emptyBlockValue,
          row.pendingCount,
          emptyValue,
          emptyValue,
          emptyValue,
          emptyValue,
          emptyValue,
          emptyValue,
          emptyValue,
          emptyValue,
          emptyValue,
          row.lastVisit,
          `serviços travados ${row.blockedCount}`,
        ]),
        ...pendingRows.map((row) => [
          'pendencia',
          project.name,
          row.towerLabel,
          row.apartmentNumber,
          emptyValue,
          emptyValue,
          emptyValue,
          row.service,
          row.status,
          emptyValue,
          row.blocksServices || emptyBlockValue,
          1,
          row.criticality,
          emptyValue,
          emptyValue,
          emptyValue,
          emptyValue,
          emptyValue,
          emptyValue,
          emptyValue,
          emptyValue,
          row.createdAt,
          row.description,
        ]),
        ...blockedRows.map((row) => [
          'servico_travado',
          project.name,
          row.towerLabel,
          row.apartmentNumber,
          emptyValue,
          statusConfig[row.apartmentStatus].label,
          emptyValue,
          row.originService,
          row.blockType,
          emptyValue,
          row.originService,
          emptyValue,
          emptyValue,
          emptyValue,
          emptyValue,
          emptyValue,
          emptyValue,
          emptyValue,
          emptyValue,
          emptyValue,
          emptyValue,
          emptyValue,
          `${row.impactedServices}; ${row.scheduleImpact}; ${row.releaseImpact}`,
        ]),
        ...scheduleRows.map((row) => [
          'cronograma',
          project.name,
          row.towerLabel,
          row.apartmentNumber,
          emptyValue,
          emptyValue,
          emptyValue,
          row.service,
          row.status,
          row.delayDays,
          row.blockedBy || emptyBlockValue,
          emptyValue,
          emptyValue,
          emptyValue,
          emptyValue,
          emptyValue,
          emptyValue,
          emptyValue,
          emptyValue,
          row.plannedStart || emptyValue,
          row.plannedEnd || emptyValue,
          row.actualStart || emptyValue,
          row.actualEnd || emptyValue,
        ]),
        ...measurementRows.map((row) => [
          'medicao',
          project.name,
          row.towerLabel,
          row.apartmentNumber,
          emptyValue,
          emptyValue,
          emptyValue,
          row.service,
          emptyValue,
          emptyValue,
          emptyBlockValue,
          emptyValue,
          emptyValue,
          row.contractor,
          row.quantity,
          row.unit,
          row.unitPrice,
          row.totalValue,
          row.status,
          row.periodStart,
          row.periodEnd,
          row.launchedAt ?? emptyValue,
          row.comment || emptyValue,
        ]),
        ...visitRows.map((row) => [
          'visita',
          project.name,
          row.towerLabel,
          row.apartmentNumber,
          emptyValue,
          row.statusAfter,
          row.progressAfter,
          emptyValue,
          emptyValue,
          emptyValue,
          emptyBlockValue,
          row.pendingCount,
          emptyValue,
          emptyValue,
          emptyValue,
          emptyValue,
          emptyValue,
          emptyValue,
          emptyValue,
          emptyValue,
          emptyValue,
          row.date,
          getVisitVariationLabel(row.evolution),
        ]),
      ],
    );

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Relatórios</Text>
          <Text style={styles.subtitle}>Obra, vistoria, pendências, travas, cronograma, medições e visitas.</Text>
          <Text style={styles.powerBiNote}>
            Os arquivos CSV exportados seguem estrutura padronizada para uso futuro em Power BI.
          </Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable onPress={exportConsolidated} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>Exportar consolidado CSV</Text>
          </Pressable>
          <Pressable disabled style={[styles.primaryButton, styles.disabledButton]}>
            <Text style={styles.disabledButtonText}>Exportar Excel</Text>
          </Pressable>
          <Text style={styles.xlsxNote}>Exportação Excel será habilitada na próxima versão. Use CSV por enquanto.</Text>
        </View>
      </View>

      <View style={styles.panel}>
        <Text style={styles.sectionTitle}>Filtros gerais</Text>
        <View style={styles.optionRow}>
          <Pressable onPress={() => setTowerFilter(allFilter)} style={[styles.chip, towerFilter === allFilter && styles.chipSelected]}>
            <Text style={[styles.chipText, towerFilter === allFilter && styles.chipTextSelected]}>Todas as torres</Text>
          </Pressable>
          {towers.map((tower) => (
            <Pressable key={tower.id} onPress={() => setTowerFilter(tower.id)} style={[styles.chip, towerFilter === tower.id && styles.chipSelected]}>
              <Text style={[styles.chipText, towerFilter === tower.id && styles.chipTextSelected]}>{tower.name}</Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.inputGrid}>
          <TextInput style={styles.input} placeholder="Apartamento" placeholderTextColor="#94A3B8" value={apartmentFilter} onChangeText={setApartmentFilter} />
          <TextInput style={styles.input} placeholder="Serviço" placeholderTextColor="#94A3B8" value={serviceFilter} onChangeText={setServiceFilter} />
          <TextInput style={styles.input} placeholder="Empreiteiro" placeholderTextColor="#94A3B8" value={contractorFilter} onChangeText={setContractorFilter} />
          <TextInput style={styles.input} placeholder="Status" placeholderTextColor="#94A3B8" value={statusFilter} onChangeText={setStatusFilter} />
          <TextInput style={styles.input} placeholder="Criticidade" placeholderTextColor="#94A3B8" value={criticalityFilter} onChangeText={setCriticalityFilter} />
          <TextInput style={styles.input} placeholder="Período início DD/MM/AAAA" placeholderTextColor="#94A3B8" value={periodStartFilter} onChangeText={setPeriodStartFilter} />
          <TextInput style={styles.input} placeholder="Período fim DD/MM/AAAA" placeholderTextColor="#94A3B8" value={periodEndFilter} onChangeText={setPeriodEndFilter} />
        </View>
        <Pressable onPress={clearFilters} style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonText}>Limpar filtros</Text>
        </Pressable>
      </View>

      <View style={styles.panel}>
        <Text style={styles.sectionTitle}>Resumo da obra</Text>
        <View style={styles.metricGrid}>
          <SummaryCard label="total de torres" value={towers.length} />
          <SummaryCard label="total de apartamentos" value={apartmentRows.length} />
          <SummaryCard label="apartamentos excelentes" value={statusCounts.excellent} />
          <SummaryCard label="apartamentos bons" value={statusCounts.good} />
          <SummaryCard label="apartamentos em atenção" value={statusCounts.attention} />
          <SummaryCard label="apartamentos críticos" value={statusCounts.critical} />
          <SummaryCard label="pendências abertas" value={pendingRows.length} />
          <SummaryCard label="serviços travados" value={blockedRows.length} />
          <SummaryCard label="serviços atrasados" value={scheduleRows.filter((row) => row.delayDays > 0).length} />
          <SummaryCard label="total medido" value={formatCurrency(totalMeasured)} />
          <SummaryCard label="total aprovado para pagamento" value={formatCurrency(totalApproved)} />
          <SummaryCard label="total pago externamente" value={formatCurrency(totalPaidExternally)} />
        </View>
      </View>

      <View style={styles.panel}>
        <Text style={styles.sectionTitle}>Totais de medição</Text>
        <View style={styles.metricGrid}>
          {measurementStatusOptions.map((status) => (
            <Text key={status} style={styles.metric}>
              {status}: {formatCurrency(totalByMeasurementStatus(status))}
            </Text>
          ))}
        </View>
      </View>

      <ReportSection title="Relatório de apartamentos" onExport={exportApartments}>
        {apartmentRows.map((row) => (
          <RowCard key={row.apartment.id} apartmentId={row.apartment.id} title={`${row.towerLabel} / Apartamento ${row.apartment.number}`}>
            <Text style={styles.detailText}>Pavimento: {row.floor}</Text>
            <Text style={styles.detailText}>Status visual: {statusConfig[row.status].label}</Text>
            <Text style={styles.detailText}>Percentual vistoriado: {row.progress}%</Text>
            <Text style={styles.detailText}>Pendências: {row.pendingCount}</Text>
            <Text style={styles.detailText}>Serviços travados: {row.blockedCount}</Text>
            <Text style={styles.detailText}>Dias de atraso: {row.maxDelayDays}</Text>
            <Text style={styles.detailText}>Última visita: {row.lastVisit}</Text>
          </RowCard>
        ))}
      </ReportSection>

      <ReportSection title="Apartamentos por status">
        <View style={styles.metricGrid}>
          {(['excellent', 'good', 'attention', 'critical'] as ApartmentStatus[]).map((status) => (
            <Text key={status} style={styles.metric}>
              {statusConfig[status].label}: {apartmentRows.filter((row) => row.status === status).length}
            </Text>
          ))}
        </View>
      </ReportSection>

      <ReportSection title="Apartamentos críticos">
        {criticalApartments.length === 0 ? <Text style={styles.emptyText}>Nenhum apartamento crítico nos filtros.</Text> : null}
        {criticalApartments.map((row) => (
          <RowCard key={`critical-${row.apartment.id}`} apartmentId={row.apartment.id} title={`${row.towerLabel} / Apartamento ${row.apartment.number}`}>
            <Text style={styles.detailText}>Pendências: {row.pendingCount}</Text>
            <Text style={styles.detailText}>Serviços travados: {row.blockedCount}</Text>
            <Text style={styles.detailText}>Maior atraso: {row.maxDelayDays} dia(s)</Text>
          </RowCard>
        ))}
      </ReportSection>

      <ReportSection title="Relatório de pendências" onExport={exportPending}>
        <GroupedCounter title="Pendências por torre" rows={pendingRows.map((row) => row.towerLabel)} />
        <GroupedCounter title="Pendências por apartamento" rows={pendingRows.map((row) => `Apartamento ${row.apartmentNumber}`)} />
        <GroupedCounter title="Pendências por serviço" rows={pendingRows.map((row) => row.service)} />
        {pendingRows.map((row) => (
          <RowCard key={`${row.apartmentId}-${row.service}`} apartmentId={row.apartmentId} title={`${row.towerLabel} / Apartamento ${row.apartmentNumber}`}>
            <Text style={styles.detailText}>Serviço: {row.service}</Text>
            <Text style={styles.detailText}>Descrição: {row.description}</Text>
            <Text style={styles.detailText}>Status: {row.status}</Text>
            <Text style={styles.detailText}>Criticidade: {row.criticality}</Text>
            <Text style={styles.detailText}>Trava serviço: {row.blocksServices}</Text>
            <Text style={styles.detailText}>Fotos: {row.photoCount}</Text>
            <Text style={styles.detailText}>Data de criação: {row.createdAt}</Text>
          </RowCard>
        ))}
      </ReportSection>

      <ReportSection title="Serviços travados" onExport={exportBlocked}>
        {blockedRows.map((row) => (
          <RowCard key={`${row.apartmentId}-${row.originService}`} apartmentId={row.apartmentId} title={`${row.towerLabel} / Apartamento ${row.apartmentNumber}`}>
            <Text style={styles.detailText}>Serviço origem: {row.originService}</Text>
            <Text style={styles.detailText}>Serviços impactados: {row.impactedServices}</Text>
            <Text style={styles.detailText}>Tipo de bloqueio: {row.blockType}</Text>
            <Text style={styles.detailText}>Impacto no cronograma: {row.scheduleImpact}</Text>
            <Text style={styles.detailText}>Impacto na liberação: {row.releaseImpact}</Text>
            <Text style={styles.detailText}>Status do apartamento: {statusConfig[row.apartmentStatus].label}</Text>
          </RowCard>
        ))}
      </ReportSection>

      <ReportSection title="Serviços atrasados / Cronograma" onExport={exportSchedule}>
        {scheduleRows.filter((row) => row.delayDays > 0).map((row) => (
          <RowCard key={`${row.apartmentId}-${row.service}`} apartmentId={row.apartmentId} title={`${row.towerLabel} / Apartamento ${row.apartmentNumber}`}>
            <Text style={styles.detailText}>Serviço: {row.service}</Text>
            <Text style={styles.detailText}>Início planejado: {row.plannedStart || 'sem data'}</Text>
            <Text style={styles.detailText}>Fim planejado: {row.plannedEnd || 'sem data'}</Text>
            <Text style={styles.detailText}>Início real: {row.actualStart || 'sem data'}</Text>
            <Text style={styles.detailText}>Fim real: {row.actualEnd || 'sem data'}</Text>
            <Text style={styles.detailText}>Status: {row.status}</Text>
            <Text style={styles.detailText}>Dias de atraso: {row.delayDays}</Text>
            <Text style={styles.detailText}>Serviço bloqueado por: {row.blockedBy}</Text>
          </RowCard>
        ))}
      </ReportSection>

      <ReportSection title="Relatório de medições" onExport={exportMeasurements}>
        <GroupedCounter title="Medições por empreiteiro" rows={measurementRows.map((row) => row.contractor)} />
        <GroupedCounter title="Medições por período" rows={measurementRows.map((row) => `${row.periodStart} até ${row.periodEnd}`)} />
        <GroupedCounter title="Medições aprovadas para pagamento" rows={approvedMeasurements.map((row) => row.contractor)} />
        {measurementRows.map((row) => (
          <RowCard key={row.id} title={`${row.towerLabel} / Apartamento ${row.apartmentNumber}`}>
            <Text style={styles.detailText}>Serviço: {row.service}</Text>
            <Text style={styles.detailText}>Empreiteiro: {row.contractor}</Text>
            <Text style={styles.detailText}>Período: {row.periodStart} até {row.periodEnd}</Text>
            <Text style={styles.detailText}>Quantidade: {row.quantity} {row.unit}</Text>
            <Text style={styles.detailText}>Valor unitário: {formatCurrency(row.unitPrice)}</Text>
            <Text style={styles.detailText}>Valor total: {formatCurrency(row.totalValue)}</Text>
            <Text style={styles.detailText}>Status: {row.status}</Text>
            <Text style={styles.detailText}>Responsável: {row.responsible ?? 'Usuário local'}</Text>
            <Text style={styles.detailText}>Data de lançamento: {row.launchedAt ? new Date(row.launchedAt).toLocaleString('pt-BR') : 'sem data'}</Text>
            <Text style={styles.detailText}>Data de aprovação: {row.approvedAt ? new Date(row.approvedAt).toLocaleString('pt-BR') : 'não aprovada'}</Text>
          </RowCard>
        ))}
      </ReportSection>

      <ReportSection title="Histórico de visitas" onExport={exportVisits}>
        {visitRows.map((row) => (
          <RowCard key={`${row.apartmentId}-${row.date}`} title={`${row.towerLabel} / Apartamento ${row.apartmentNumber}`}>
            <Text style={styles.detailText}>Data: {row.date}</Text>
            <Text style={styles.detailText}>Responsável: {row.responsible}</Text>
            <Text style={styles.detailText}>Antes: {row.progressBefore}%</Text>
            <Text style={styles.detailText}>Depois: {row.progressAfter}%</Text>
            <Text style={styles.detailText}>{getVisitVariationLabel(row.evolution)}</Text>
            <Text style={styles.detailText}>Status após visita: {row.statusAfter}</Text>
            <Text style={styles.detailText}>Fotos: {row.photosAdded}</Text>
            <Text style={styles.detailText}>Pendências: {row.pendingCount}</Text>
          </RowCard>
        ))}
      </ReportSection>
    </ScrollView>
  );
}

function ReportSection({
  children,
  onExport,
  title,
}: {
  children: React.ReactNode;
  onExport?: () => void;
  title: string;
}) {
  return (
    <View style={styles.panel}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {onExport ? (
          <Pressable onPress={onExport} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>Exportar CSV</Text>
          </Pressable>
        ) : null}
      </View>
      {children}
    </View>
  );
}

function SummaryCard({ label, value }: { label: string; value: number | string }) {
  return (
    <View style={styles.summaryCard}>
      <Text style={styles.summaryValue}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

function RowCard({
  apartmentId,
  children,
  title,
}: {
  apartmentId?: string;
  children: React.ReactNode;
  title: string;
}) {
  return (
    <View style={styles.rowCard}>
      <View style={styles.rowTitleBar}>
        <Text style={styles.cardTitle}>{title}</Text>
        {apartmentId ? (
          <Link
            asChild
            href={{
              pathname: '/apartamentos/[apartamentoId]',
              params: { apartamentoId: apartmentId },
            }}>
            <Pressable style={styles.secondaryButton}>
              <Text style={styles.secondaryButtonText}>Abrir apartamento</Text>
            </Pressable>
          </Link>
        ) : null}
      </View>
      <View style={styles.detailGrid}>{children}</View>
    </View>
  );
}

function GroupedCounter({ rows, title }: { rows: string[]; title: string }) {
  const groupedRows = [...rows.reduce<Map<string, number>>((map, row) => {
    map.set(row, (map.get(row) ?? 0) + 1);
    return map;
  }, new Map())].sort((first, second) => second[1] - first[1]);

  return (
    <View style={styles.groupBox}>
      <Text style={styles.groupTitle}>{title}</Text>
      <View style={styles.metricGrid}>
        {groupedRows.length === 0 ? <Text style={styles.emptyText}>Sem dados nos filtros.</Text> : null}
        {groupedRows.slice(0, 8).map(([label, count]) => (
          <Text key={`${title}-${label}`} style={styles.metric}>{label}: {count}</Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 14,
    padding: 20,
  },
  header: {
    alignItems: 'flex-start',
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    justifyContent: 'space-between',
    padding: 18,
  },
  title: {
    color: '#0F172A',
    fontSize: 28,
    fontWeight: '900',
  },
  subtitle: {
    color: '#64748B',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
  },
  powerBiNote: {
    color: '#2563EB',
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 17,
    marginTop: 8,
    maxWidth: 520,
  },
  headerActions: {
    alignItems: 'flex-start',
    gap: 8,
  },
  xlsxNote: {
    color: '#64748B',
    fontSize: 12,
    fontWeight: '800',
    maxWidth: 280,
  },
  panel: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0',
    borderRadius: 8,
    borderWidth: 1,
    gap: 12,
    padding: 16,
  },
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    justifyContent: 'space-between',
  },
  sectionTitle: {
    color: '#0F172A',
    fontSize: 18,
    fontWeight: '900',
  },
  primaryButton: {
    backgroundColor: '#2563EB',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
  },
  secondaryButton: {
    borderColor: '#CBD5E1',
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  secondaryButtonText: {
    color: '#2563EB',
    fontSize: 12,
    fontWeight: '900',
  },
  disabledButton: {
    backgroundColor: '#E2E8F0',
  },
  disabledButtonText: {
    color: '#64748B',
    fontSize: 13,
    fontWeight: '900',
  },
  optionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    borderColor: '#CBD5E1',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  chipSelected: {
    backgroundColor: '#DBEAFE',
    borderColor: '#2563EB',
  },
  chipText: {
    color: '#475569',
    fontSize: 12,
    fontWeight: '800',
  },
  chipTextSelected: {
    color: '#2563EB',
  },
  inputGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  input: {
    backgroundColor: '#F8FAFC',
    borderColor: '#CBD5E1',
    borderRadius: 8,
    borderWidth: 1,
    color: '#0F172A',
    flexGrow: 1,
    fontSize: 14,
    minHeight: 42,
    minWidth: 180,
    paddingHorizontal: 10,
  },
  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  metric: {
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
    borderRadius: 999,
    borderWidth: 1,
    color: '#475569',
    fontSize: 12,
    fontWeight: '800',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  summaryCard: {
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
    borderRadius: 8,
    borderWidth: 1,
    flexGrow: 1,
    minWidth: 170,
    padding: 12,
  },
  summaryValue: {
    color: '#0F172A',
    fontSize: 20,
    fontWeight: '900',
  },
  summaryLabel: {
    color: '#64748B',
    fontSize: 12,
    fontWeight: '800',
    marginTop: 4,
  },
  rowCard: {
    borderColor: '#E2E8F0',
    borderRadius: 8,
    borderWidth: 1,
    gap: 10,
    padding: 14,
  },
  rowTitleBar: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    justifyContent: 'space-between',
  },
  cardTitle: {
    color: '#0F172A',
    fontSize: 15,
    fontWeight: '900',
    lineHeight: 20,
  },
  detailGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  detailText: {
    color: '#475569',
    fontSize: 13,
    minWidth: 180,
  },
  emptyText: {
    color: '#64748B',
    fontSize: 13,
  },
  groupBox: {
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
    padding: 12,
  },
  groupTitle: {
    color: '#0F172A',
    fontSize: 14,
    fontWeight: '900',
  },
});
