import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Image, Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native'
import { Text } from '@/src/ui/Text';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';

import type { ApartmentStatus, ChecklistItem, ChecklistState } from '@/src/data/mockObras';
import type { InspectionPhoto } from '@/src/data/localInspectionPhotos';
import type { InspectionVisit, VisitChecklistCounts } from '@/src/data/localInspectionVisits';
import { localResponsible } from '@/src/data/localInspectionVisits';
import type { Measurement, MeasurementDraft } from '@/src/data/localMeasurements';
import {
  createEmptyMeasurementDraft,
  formatCurrency,
  getContractorId,
  getMeasurementDuplicateKey,
  getMeasurementTypeLabel,
  isMeasurementPeriodValid,
  measurementBlocksDuplicate,
  measurementDuplicateMessage,
  normalizeMeasurementPeriod,
  measurementStatusOptions,
  measurementTypeOptions,
  toNumber,
} from '@/src/data/localMeasurements';
import { useObras } from '@/src/data/ObrasContext';
import * as dbApi from '@/src/data/db';
import type { ScheduleFields } from '@/src/data/schedule';
import { formatDateBr, getScheduleRows, isValidBrDate, maskDateBr } from '@/src/data/schedule';
import { getBlockedServiceGroups } from '@/src/data/serviceBlockers';
import { isServiceActiveForFeature } from '@/src/data/serviceStages';
import { checklistConfig, statusConfig } from '@/src/ui/status';

const checklistOptions: ChecklistState[] = ['ok', 'pending', 'partial', 'notApplicable'];
const criticalityOptions = ['Baixa', 'Média', 'Alta', 'Crítica'] as const;
const detailTabs = ['Resumo', 'Checklist', 'Pendências', 'Fotos', 'Serviços', 'Cronograma', 'Medições', 'Histórico'] as const;

type DetailTab = (typeof detailTabs)[number];
type IssueCriticality = (typeof criticalityOptions)[number];

const scheduleStatusStyles: Record<string, { background: string; color: string }> = {
  'No prazo': { background: '#DBEAFE', color: '#2563EB' },
  Atenção: { background: '#FEF3C7', color: '#B45309' },
  Atrasado: { background: '#FEE2E2', color: '#B91C1C' },
  Concluído: { background: '#D1FAE5', color: '#047857' },
};

type EditableChecklistItem = ChecklistItem & {
  comment: string;
  issueCriticality?: IssueCriticality;
  issueComment?: string;
} & ScheduleFields;

const isIssueCriticality = (v: unknown): v is IssueCriticality =>
  criticalityOptions.includes(v as IssueCriticality);

const getInitialChecklist = (items?: ChecklistItem[]): EditableChecklistItem[] =>
  (items ?? []).filter((item) => isServiceActiveForFeature(item.label, 'checklist')).map((item) => ({
    ...item,
    comment: item.comment ?? '',
    issueCriticality: item.state === 'pending' || item.state === 'partial' ? 'Média' : undefined,
    issueComment: '',
  }));

const formatPhotoDateTime = (value: string) =>
  new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));

const getChecklistCounts = (items: EditableChecklistItem[]): VisitChecklistCounts =>
  items.reduce<VisitChecklistCounts>(
    (counts, item) => ({ ...counts, [item.state]: counts[item.state] + 1 }),
    { notApplicable: 0, ok: 0, partial: 0, pending: 0 },
  );

const sortVisitsDesc = (visits: InspectionVisit[]) =>
  [...visits].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

const getVariationColor = (v: number) => (v > 0 ? '#047857' : v < 0 ? '#B91C1C' : '#64748B');
const getVariationLabel = (v: number) =>
  v > 0 ? `+${v} p.p.` : v < 0 ? `${v} p.p.` : '0 p.p.';

const calculateProgress = (items: EditableChecklistItem[]) => {
  if (!items.length) return 0;
  const score = items.reduce((t, i) => {
    if (i.state === 'ok' || i.state === 'notApplicable') return t + 1;
    if (i.state === 'partial') return t + 0.5;
    return t;
  }, 0);
  return Math.round((score / items.length) * 100);
};

const calculateApartmentStatus = (items: EditableChecklistItem[], progress: number): ApartmentStatus => {
  const pendingCount = items.filter((i) => i.state === 'pending').length;
  const partialCount = items.filter((i) => i.state === 'partial').length;
  const manyPending = pendingCount >= Math.max(3, Math.ceil(items.length * 0.35));
  if (progress < 50 || manyPending) return 'critical';
  if ((progress >= 50 && progress <= 74) || partialCount > 0) return 'attention';
  if (progress >= 90 && pendingCount === 0) return 'excellent';
  return 'good';
};

export default function ApartmentDetailScreen() {
  const { apartamentoId } = useLocalSearchParams<{ apartamentoId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { getApartmentById, getTowerById, updateApartmentLocal, project, loading } = useObras();
  const apartment = getApartmentById(apartamentoId);
  const tower = apartment ? getTowerById(apartment.towerId) : undefined;

  const goBackToTower = useCallback(() => {
    router.push(apartment ? `/(tabs)/visao-geral/${apartment.towerId}` as any : '/(tabs)/visao-geral' as any);
  }, [router, apartment?.towerId]);

  const initialChecklist = useMemo(() => getInitialChecklist(apartment?.checklist), [apartment?.checklist]);
  const [checklist, setChecklist] = useState<EditableChecklistItem[]>(initialChecklist);
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [measurementDrafts, setMeasurementDrafts] = useState<Record<string, MeasurementDraft>>({});
  const [measurementAlert, setMeasurementAlert] = useState('');
  const [scheduleAlert, setScheduleAlert] = useState('');
  const [photos, setPhotos] = useState<InspectionPhoto[]>([]);
  const [selectedPhoto, setSelectedPhoto] = useState<InspectionPhoto>();
  const [selectedMeasurementEvidence, setSelectedMeasurementEvidence] = useState<Measurement>();
  const [activeTab, setActiveTab] = useState<DetailTab>('Resumo');
  const [visits, setVisits] = useState<InspectionVisit[]>([]);
  const [selectedVisit, setSelectedVisit] = useState<InspectionVisit>();
  const [photoPickerTarget, setPhotoPickerTarget] = useState<{ itemId: string; forMeasurement?: boolean } | null>(null);

  useEffect(() => {
    if (!apartamentoId) return;
    setChecklist(getInitialChecklist(apartment?.checklist));
    setMeasurementDrafts({});
    setMeasurementAlert('');
    setSelectedVisit(undefined);
    dbApi.loadMeasurements(apartamentoId).then(setMeasurements);
    dbApi.loadPhotos(apartamentoId).then(setPhotos);
    dbApi.loadVisits(apartamentoId).then(setVisits);
  }, [apartamentoId, apartment?.checklist]);

  if (!apartment || !tower) {
    return (
      <View style={[s.empty, { paddingTop: insets.top + 16 }]}>
        <Pressable onPress={goBackToTower} style={s.emptyBack}>
          <MaterialCommunityIcons name="chevron-left" size={28} color="#0F172A" />
          <Text style={s.emptyBackText}>Voltar</Text>
        </Pressable>
        <View style={s.emptyCenter}>
          <MaterialCommunityIcons name={loading ? 'progress-clock' : 'home-alert-outline'} size={48} color="#CBD5E1" />
          <Text style={s.emptyTitle}>{loading ? 'Carregando apartamento…' : 'Apartamento não encontrado'}</Text>
        </View>
      </View>
    );
  }

  const progress = calculateProgress(checklist);
  const okCount = checklist.filter((i) => i.state === 'ok' || i.state === 'notApplicable').length;
  const currentStatusKey = calculateApartmentStatus(checklist, progress);
  const status = statusConfig[currentStatusKey];
  const measurableItems = checklist.filter((i) => i.state === 'ok' && isServiceActiveForFeature(i.label, 'medicao'));
  const blockedServiceGroups = getBlockedServiceGroups(checklist);
  const scheduleRows = getScheduleRows(checklist);
  const totalBlockedServices = blockedServiceGroups.reduce((t, g) => t + g.blockedServices.length, 0);
  const totalMeasuredValue = measurements.reduce((t, m) => t + m.totalValue, 0);
  const pendingItems = checklist.filter((i) => i.state === 'pending' || i.state === 'partial');
  const finalizedVisits = sortVisitsDesc(visits.filter((v) => v.finalized));
  const openVisit = visits.find((v) => !v.finalized);
  const latestVisit = openVisit ?? finalizedVisits[0];
  const firstVisit = sortVisitsDesc(visits).at(-1);
  const previousProgress = latestVisit?.progressBefore ?? finalizedVisits[1]?.progressAfter ?? progress;
  const unitProgressVariation = progress - previousProgress;
  const photosByServiceId = photos.reduce<Record<string, InspectionPhoto[]>>((g, p) => {
    g[p.serviceId] = [...(g[p.serviceId] ?? []), p];
    return g;
  }, {});

  // ── mutations ──────────────────────────────────────────────────────────────

  const registerVisitUpdate = ({
    addedPhotoId, changedItemId, nextChecklist, nextPhotos, progressBeforeFallback,
  }: {
    addedPhotoId?: string;
    changedItemId?: string;
    nextChecklist: EditableChecklistItem[];
    nextPhotos: InspectionPhoto[];
    progressBeforeFallback: number;
  }) => {
    if (!apartment) return;
    const nextProgress = calculateProgress(nextChecklist);
    const nextStatus = calculateApartmentStatus(nextChecklist, nextProgress);
    const counts = getChecklistCounts(nextChecklist);
    const issueItemIds = nextChecklist.filter((i) => i.state === 'pending' || i.state === 'partial').map((i) => i.id);
    const now = new Date().toISOString();
    setVisits((current) => {
      const open = current.find((v) => !v.finalized);
      if (!open) return current;
      const progressBefore = open.progressBefore ?? progressBeforeFallback;
      const existingPhotoIds = open.addedPhotoIds ?? [];
      const addedPhotoIds = addedPhotoId
        ? [...new Set([...existingPhotoIds, addedPhotoId])]
        : existingPhotoIds.filter((id) => nextPhotos.some((p) => p.id === id));
      const changedItemIds = changedItemId
        ? [...new Set([...(open.changedItemIds ?? []), changedItemId])]
        : open.changedItemIds ?? [];
      const updated: InspectionVisit = {
        id: open.id, apartmentId: apartment.id, apartamentoId: apartment.id,
        date: open.date ?? now, startedAt: open.startedAt ?? open.date ?? now,
        dataInicio: open.dataInicio ?? open.startedAt ?? open.date ?? now,
        responsible: open.responsible ?? localResponsible, responsavel: open.responsavel ?? open.responsible ?? localResponsible,
        progressBefore, percentualAntes: progressBefore,
        progressAfter: nextProgress, percentualDepois: nextProgress,
        evolution: nextProgress - progressBefore, evolucao: nextProgress - progressBefore,
        counts, photosAdded: addedPhotoIds.length, quantidadeFotos: addedPhotoIds.length,
        quantidadePendencias: issueItemIds.length, statusAfter: nextStatus, statusFinal: nextStatus,
        generalNote: open.generalNote ?? '', observacaoGeral: open.observacaoGeral ?? open.generalNote ?? '',
        changedItemIds, addedPhotoIds, issueItemIds, finalized: false,
      };
      dbApi.saveVisit(updated);
      return current.map((v) => (v.id === open.id ? updated : v));
    });
  };

  const updateItemStatus = (itemId: string, state: ChecklistState) => {
    setChecklist((cur) => {
      const next = cur.map((i) => i.id === itemId
        ? { ...i, state, issueCriticality: state === 'pending' || state === 'partial' ? i.issueCriticality ?? 'Média' : undefined, issueComment: state === 'pending' || state === 'partial' ? i.issueComment ?? '' : '' }
        : i);
      const changed = next.find((i) => i.id === itemId);
      if (changed && apartamentoId) {
        dbApi.upsertChecklistItem({ ...changed, apartmentId: apartamentoId });
        const np = calculateProgress(next);
        const ns = calculateApartmentStatus(next, np);
        dbApi.updateApartmentStats(apartamentoId, np, ns);
        updateApartmentLocal(apartamentoId, np, ns, next);
      }
      registerVisitUpdate({ changedItemId: itemId, nextChecklist: next, nextPhotos: photos, progressBeforeFallback: calculateProgress(cur) });
      return next;
    });
  };

  const updateItemComment = (itemId: string, comment: string) => {
    setChecklist((cur) => {
      const next = cur.map((i) => i.id === itemId ? { ...i, comment } : i);
      const changed = next.find((i) => i.id === itemId);
      if (changed && apartamentoId) dbApi.upsertChecklistItem({ ...changed, apartmentId: apartamentoId });
      registerVisitUpdate({ changedItemId: itemId, nextChecklist: next, nextPhotos: photos, progressBeforeFallback: calculateProgress(cur) });
      return next;
    });
  };

  const updateItemIssue = (itemId: string, field: 'issueCriticality' | 'issueComment', value: string) => {
    setChecklist((cur) => {
      const next = cur.map((i) =>
        i.id === itemId && field === 'issueCriticality' && isIssueCriticality(value) ? { ...i, issueCriticality: value }
        : i.id === itemId && field === 'issueComment' ? { ...i, issueComment: value }
        : i);
      registerVisitUpdate({ changedItemId: itemId, nextChecklist: next, nextPhotos: photos, progressBeforeFallback: calculateProgress(cur) });
      return next;
    });
  };

  const updateItemSchedule = (itemId: string, field: keyof ScheduleFields, value: string) => {
    const masked = maskDateBr(value);
    if (masked.length === 10 && !isValidBrDate(masked)) setScheduleAlert('Data inválida. Use DD/MM/AAAA.');
    else if (masked.length > 0 && masked.length < 10) setScheduleAlert('Use DD/MM/AAAA.');
    else setScheduleAlert('');
    setChecklist((cur) => {
      const next = cur.map((i) => i.id === itemId ? { ...i, [field]: masked } : i);
      const changed = next.find((i) => i.id === itemId);
      if (changed && apartamentoId && masked.length === 10) dbApi.upsertChecklistItem({ ...changed, apartmentId: apartamentoId });
      return next;
    });
  };

  const addPhotoToItem = (item: EditableChecklistItem) => {
    if (!apartment || !tower) return;
    setPhotoPickerTarget({ itemId: item.id });
  };

  const handlePickImage = async (source: 'camera' | 'gallery') => {
    if (!apartment || !tower || !photoPickerTarget) return;
    setPhotoPickerTarget(null);

    if (Platform.OS !== 'web') {
      const perm = source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) return;
    }

    const result = source === 'camera'
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8, base64: Platform.OS === 'web' })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8, base64: Platform.OS === 'web' });

    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    const localUri = Platform.OS === 'web' ? `data:image/jpeg;base64,${asset.base64}` : asset.uri;
    const createdAt = new Date().toISOString();
    const fileName = asset.fileName ?? `foto-${Date.now()}.jpg`;

    if (photoPickerTarget.forMeasurement) {
      updateMeasurementDraft(photoPickerTarget.itemId, 'evidenceUri', localUri);
      updateMeasurementDraft(photoPickerTarget.itemId, 'evidenceFileName', fileName);
      return;
    }

    const item = checklist.find((i) => i.id === photoPickerTarget.itemId);
    if (!item) return;
    const photoId = `${apartment.id}-${item.id}-${Date.now()}`;
    const storagePath = `${apartment.id}/${item.id}/${photoId}.jpg`;

    // Optimistic insert with the local URI so the thumb shows immediately.
    const optimisticPhoto = {
      id: photoId, towerId: tower.id, apartmentId: apartment.id,
      itemId: item.id, serviceId: item.id, service: item.label,
      uri: localUri, storagePath: '', fileName,
      createdAt, dataHora: createdAt,
      comment: '', comentarioFoto: '', visitId: openVisit?.id,
    };
    setPhotos((cur) => {
      const next = [...cur, optimisticPhoto];
      registerVisitUpdate({ addedPhotoId: photoId, changedItemId: item.id, nextChecklist: checklist, nextPhotos: next, progressBeforeFallback: progress });
      return next;
    });

    // Upload to Storage, then persist the row pointing at the storage path.
    (async () => {
      try {
        await dbApi.uploadInspectionPhoto(localUri, storagePath, asset.mimeType ?? 'image/jpeg');
        const publicUrl = dbApi.getInspectionPhotoUrl(storagePath);
        const persisted = { ...optimisticPhoto, uri: publicUrl, storagePath };
        await dbApi.savePhoto(persisted);
        setPhotos((cur) => cur.map((p) => (p.id === photoId ? persisted : p)));
      } catch (err) {
        console.error('Failed to upload inspection photo', err);
        setPhotos((cur) => cur.filter((p) => p.id !== photoId));
      }
    })();
  };

  const updatePhotoComment = (photoId: string, comment: string) => {
    setPhotos((cur) => {
      const target = cur.find((p) => p.id === photoId);
      const next = cur.map((p) => p.id === photoId ? { ...p, comment, comentarioFoto: comment } : p);
      const updated = next.find((p) => p.id === photoId);
      if (updated) dbApi.savePhoto(updated);
      registerVisitUpdate({ changedItemId: target?.serviceId, nextChecklist: checklist, nextPhotos: next, progressBeforeFallback: progress });
      return next;
    });
  };

  const removePhoto = (photoId: string) => {
    setPhotos((cur) => {
      const target = cur.find((p) => p.id === photoId);
      dbApi.deletePhoto(photoId, target?.storagePath);
      const next = cur.filter((p) => p.id !== photoId);
      registerVisitUpdate({ changedItemId: target?.serviceId, nextChecklist: checklist, nextPhotos: next, progressBeforeFallback: progress });
      return next;
    });
    setSelectedPhoto((cur) => (cur?.id === photoId ? undefined : cur));
  };

  const updateOpenVisitNote = (generalNote: string) => {
    registerVisitUpdate({ nextChecklist: checklist, nextPhotos: photos, progressBeforeFallback: progress });
    setVisits((cur) => cur.map((v) => !v.finalized ? { ...v, generalNote, observacaoGeral: generalNote } : v));
  };

  const finishVisit = () => {
    if (!apartment) return;
    setVisits((cur) => {
      const open = cur.find((v) => !v.finalized);
      if (!open) return cur;
      const now = new Date().toISOString();
      const progressBefore = open.progressBefore ?? open.percentualAntes ?? progress;
      const addedPhotoIds = (open.addedPhotoIds ?? []).filter((id) => photos.some((p) => p.id === id));
      const statusAfter = calculateApartmentStatus(checklist, progress);
      const finalized = {
        ...open, apartmentId: apartment.id, apartamentoId: apartment.id,
        date: now, startedAt: open.startedAt ?? open.date ?? now, dataInicio: open.dataInicio ?? open.startedAt ?? open.date ?? now,
        finalized: true, finalizedAt: now,
        responsible: open.responsible || localResponsible, responsavel: open.responsavel || open.responsible || localResponsible,
        progressBefore, percentualAntes: progressBefore, progressAfter: progress, percentualDepois: progress,
        evolution: progress - progressBefore, evolucao: progress - progressBefore,
        counts: getChecklistCounts(checklist), photosAdded: addedPhotoIds.length, quantidadeFotos: addedPhotoIds.length,
        quantidadePendencias: pendingItems.length, statusAfter, statusFinal: statusAfter,
        generalNote: open.generalNote ?? '', observacaoGeral: open.observacaoGeral ?? open.generalNote ?? '',
        changedItemIds: open.changedItemIds ?? [], addedPhotoIds, issueItemIds: pendingItems.map((i) => i.id),
      };
      dbApi.saveVisit(finalized);
      dbApi.updateApartmentStats(apartment.id, progress, statusAfter);
      updateApartmentLocal(apartment.id, progress, statusAfter);
      return cur.map((v) => (v.id === open.id ? finalized : v));
    });
  };

  const startNewVisit = () => {
    if (!apartment) return;
    setVisits((cur) => {
      if (cur.some((v) => !v.finalized)) return cur;
      const now = new Date().toISOString();
      const statusAfter = calculateApartmentStatus(checklist, progress);
      const newVisit = {
        id: `${apartment.id}-visita-${Date.now()}`, apartmentId: apartment.id, apartamentoId: apartment.id,
        date: now, startedAt: now, dataInicio: now,
        responsible: localResponsible, responsavel: localResponsible,
        progressBefore: progress, percentualAntes: progress, progressAfter: progress, percentualDepois: progress,
        evolution: 0, evolucao: 0, counts: getChecklistCounts(checklist),
        photosAdded: 0, quantidadeFotos: 0, quantidadePendencias: pendingItems.length,
        statusAfter, statusFinal: statusAfter, generalNote: '', observacaoGeral: '',
        changedItemIds: [], addedPhotoIds: [], issueItemIds: pendingItems.map((i) => i.id), finalized: false,
      };
      dbApi.saveVisit(newVisit);
      return [...cur, newVisit];
    });
  };

  const getMeasurementDraft = (itemId: string) => measurementDrafts[itemId] ?? createEmptyMeasurementDraft();

  const updateMeasurementDraft = (itemId: string, field: keyof MeasurementDraft, value: MeasurementDraft[keyof MeasurementDraft]) => {
    setMeasurementDrafts((cur) => ({ ...cur, [itemId]: { ...(cur[itemId] ?? createEmptyMeasurementDraft()), [field]: value } }));
  };

  const addMeasurementEvidence = (itemId: string) => {
    setPhotoPickerTarget({ itemId, forMeasurement: true });
  };

  const createMeasurement = (item: EditableChecklistItem) => {
    if (!apartment) return;
    const draft = getMeasurementDraft(item.id);
    const contractor = draft.contractor.trim();
    if (!contractor) { setMeasurementAlert('Empreiteiro é obrigatório.'); return; }
    const contractorId = getContractorId(contractor);
    const duplicateKey = getMeasurementDuplicateKey({ apartmentId: apartment.id, contractor, contractorId, obraId: apartment.obraId, service: item.label, serviceId: item.id, towerId: tower?.id });
    const hasDuplicate = measurements.some((m) => getMeasurementDuplicateKey({ apartmentId: m.apartmentId, contractor: m.contractor, contractorId: m.contractorId, obraId: m.obraId, service: m.service, serviceId: m.serviceId, towerId: m.towerId }) === duplicateKey && measurementBlocksDuplicate(m.status));
    if (hasDuplicate) { setMeasurementAlert(measurementDuplicateMessage); return; }
    const quantity = toNumber(draft.quantity);
    const unitPrice = toNumber(draft.unitPrice);
    if (!apartment.obraId || !tower?.id || !apartment.id || !item.id || !contractorId) { setMeasurementAlert('Chave obrigatória incompleta.'); return; }
    if (quantity <= 0) { setMeasurementAlert('Quantidade deve ser maior que zero.'); return; }
    if (unitPrice < 0) { setMeasurementAlert('Valor unitário inválido.'); return; }
    const periodStart = normalizeMeasurementPeriod(draft.periodStart);
    const periodEnd = normalizeMeasurementPeriod(draft.periodEnd);
    if (!isMeasurementPeriodValid(periodStart, periodEnd)) { setMeasurementAlert('Período inválido.'); return; }
    const m = {
      id: `${apartment.id}-${item.id}-${Date.now()}`, obraId: apartment.obraId, towerId: tower?.id,
      apartmentId: apartment.id, serviceId: item.id, contractorId, service: item.label, contractor,
      quantity, unit: draft.unit.trim() || 'un', unitPrice, totalValue: quantity * unitPrice,
      periodStart, periodEnd, status: draft.status, comment: draft.comment.trim(),
      measurementType: draft.measurementType, evidenceUri: draft.evidenceUri || undefined,
      evidenceFileName: draft.evidenceFileName || undefined, responsible: localResponsible,
      launchedAt: new Date().toISOString(),
      approvedAt: draft.status === 'Aprovado para pagamento' ? new Date().toISOString() : undefined,
    };
    dbApi.saveMeasurement(m);
    setMeasurements((prev) => [...prev, m]);
    setMeasurementAlert('');
    setMeasurementDrafts((cur) => ({ ...cur, [item.id]: createEmptyMeasurementDraft() }));
  };

  const clearApartmentMeasurements = () => {
    measurements.forEach((m) => dbApi.deleteMeasurement(m.id));
    setMeasurements([]);
    setMeasurementDrafts({});
    setMeasurementAlert('');
  };

  // ── tab icon map ──────────────────────────────────────────────────────────

  const TAB_ICONS: Record<DetailTab, string> = {
    Resumo: 'view-dashboard-outline',
    Checklist: 'checkbox-marked-outline',
    Pendências: 'alert-circle-outline',
    Fotos: 'camera-outline',
    Serviços: 'hammer-wrench',
    Cronograma: 'calendar-clock',
    Medições: 'ruler',
    Histórico: 'history',
  };

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <>
      <ScrollView contentContainerStyle={s.container} showsVerticalScrollIndicator={false}>

        {/* STATUS HEADER */}
        <View style={[s.header, { backgroundColor: status.color, paddingTop: insets.top + 12 }]}>
          <Pressable onPress={goBackToTower} style={s.headerBack}>
            <MaterialCommunityIcons name="chevron-left" size={26} color="rgba(255,255,255,0.9)" />
            <Text style={s.headerBackText}>{tower.name}</Text>
          </Pressable>
          <View style={s.headerRow}>
            <View style={s.headerInfo}>
              <Text style={s.headerKicker}>{tower.name} · {tower.block} · {apartment.floor}</Text>
              <Text style={s.headerAptNumber}>Apto {apartment.number}</Text>
              {apartment.notes ? <Text style={s.headerNotes} numberOfLines={2}>{apartment.notes}</Text> : null}
            </View>
            <View style={s.headerProgressCircle}>
              <Text style={s.headerProgressValue}>{progress}%</Text>
              <Text style={s.headerProgressLabel}>vistoriado</Text>
            </View>
          </View>
          <View style={s.headerBar}>
            <View style={[s.headerBarFill, { width: `${progress}%` as `${number}%` }]} />
          </View>
          <View style={s.headerMeta}>
            <View style={s.headerMetaItem}>
              <MaterialCommunityIcons name="checkbox-marked-circle-outline" size={13} color="rgba(255,255,255,0.8)" />
              <Text style={s.headerMetaText}>{okCount}/{checklist.length} OK</Text>
            </View>
            <View style={s.headerMetaItem}>
              <MaterialCommunityIcons name="alert-outline" size={13} color="rgba(255,255,255,0.8)" />
              <Text style={s.headerMetaText}>{pendingItems.length} pendência(s)</Text>
            </View>
            <View style={s.statusPill}>
              <Text style={[s.statusPillText, { color: status.color }]}>{status.label}</Text>
            </View>
          </View>
        </View>

        {/* VISIT BANNER */}
        {openVisit ? (
          <View style={s.visitBannerOpen}>
            <View style={s.visitBannerLeft}>
              <View style={s.visitPulse} />
              <View>
                <Text style={s.visitBannerTitle}>Visita em andamento</Text>
                <Text style={s.visitBannerSub}>Iniciada {formatPhotoDateTime(openVisit.date)}</Text>
              </View>
            </View>
            <Pressable onPress={finishVisit} style={s.visitFinishBtn}>
              <Text style={s.visitFinishBtnText}>Finalizar</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable onPress={startNewVisit} style={s.visitBannerNew}>
            <MaterialCommunityIcons name="plus-circle-outline" size={18} color="#2563EB" />
            <Text style={s.visitBannerNewText}>
              {finalizedVisits.length > 0 ? `${finalizedVisits.length} visita(s) · Iniciar nova` : 'Iniciar primeira visita'}
            </Text>
          </Pressable>
        )}

        {/* KPI ROW */}
        <View style={s.kpiRow}>
          {[
            { icon: 'alert-circle-outline', value: pendingItems.length, label: 'Pendências', color: pendingItems.length > 0 ? '#B91C1C' : '#047857' },
            { icon: 'lock-outline', value: totalBlockedServices, label: 'Travados', color: totalBlockedServices > 0 ? '#B45309' : '#047857' },
            { icon: 'camera-outline', value: photos.length, label: 'Fotos', color: '#2563EB' },
            { icon: 'ruler', value: measurements.length, label: 'Medições', color: '#7C3AED' },
          ].map((k) => (
            <View key={k.label} style={s.kpiCard}>
              <MaterialCommunityIcons name={k.icon as any} size={20} color={k.color} />
              <Text style={[s.kpiValue, { color: k.color }]}>{k.value}</Text>
              <Text style={s.kpiLabel}>{k.label}</Text>
            </View>
          ))}
        </View>

        {/* TAB BAR */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.tabBar}>
          {detailTabs.map((tab) => {
            const active = activeTab === tab;
            return (
              <Pressable key={tab} onPress={() => setActiveTab(tab)} style={[s.tabBtn, active && s.tabBtnActive]}>
                <MaterialCommunityIcons name={TAB_ICONS[tab] as any} size={14} color={active ? '#2563EB' : '#94A3B8'} />
                <Text style={[s.tabBtnText, active && s.tabBtnTextActive]}>{tab}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* ── RESUMO ── */}
        {activeTab === 'Resumo' && (
          <>
            <View style={s.card}>
              <Text style={s.cardTitle}>Evolução</Text>
              <View style={s.evoRow}>
                <View style={s.evoStat}>
                  <Text style={s.evoValue}>{previousProgress}%</Text>
                  <Text style={s.evoLabel}>Anterior</Text>
                </View>
                <MaterialCommunityIcons name="arrow-right" size={20} color="#CBD5E1" />
                <View style={s.evoStat}>
                  <Text style={[s.evoValue, { color: status.color }]}>{progress}%</Text>
                  <Text style={s.evoLabel}>Atual</Text>
                </View>
                <View style={[s.evoBadge, { backgroundColor: unitProgressVariation >= 0 ? '#D1FAE5' : '#FEE2E2' }]}>
                  <MaterialCommunityIcons
                    name={unitProgressVariation >= 0 ? 'trending-up' : 'trending-down'}
                    size={13}
                    color={getVariationColor(unitProgressVariation)}
                  />
                  <Text style={[s.evoBadgeText, { color: getVariationColor(unitProgressVariation) }]}>
                    {getVariationLabel(unitProgressVariation)}
                  </Text>
                </View>
              </View>
              <View style={s.evoMeta}>
                <Text style={s.evoMetaText}><Text style={s.evoMetaBold}>Visitas:</Text> {visits.length}</Text>
                <Text style={s.evoMetaText}><Text style={s.evoMetaBold}>Primeira:</Text> {firstVisit ? formatPhotoDateTime(firstVisit.date) : '—'}</Text>
                <Text style={s.evoMetaText}><Text style={s.evoMetaBold}>Última:</Text> {latestVisit ? formatPhotoDateTime(latestVisit.date) : '—'}</Text>
              </View>
            </View>

            {openVisit && (
              <View style={s.card}>
                <Text style={s.cardTitle}>Observação da visita</Text>
                <TextInput
                  multiline
                  onChangeText={updateOpenVisitNote}
                  placeholder="Registre observações gerais..."
                  placeholderTextColor="#94A3B8"
                  style={s.textarea}
                  value={openVisit.generalNote ?? ''}
                />
              </View>
            )}

            {pendingItems.length === 0 ? (
              <View style={[s.card, s.cardCentered]}>
                <MaterialCommunityIcons name="check-circle" size={32} color="#047857" />
                <Text style={s.allClear}>Nenhuma pendência ativa</Text>
              </View>
            ) : (
              <View style={s.card}>
                <Text style={s.cardTitle}>Pendências ativas ({pendingItems.length})</Text>
                {pendingItems.slice(0, 5).map((item) => {
                  const cfg = checklistConfig[item.state];
                  const critColor = item.issueCriticality === 'Crítica' ? '#B91C1C' : item.issueCriticality === 'Alta' ? '#B45309' : '#64748B';
                  return (
                    <View key={`r-${item.id}`} style={s.pendingRow}>
                      <View style={[s.pendingDot, { backgroundColor: cfg.color }]} />
                      <Text style={s.pendingLabel} numberOfLines={1}>{item.label}</Text>
                      <Text style={[s.pendingCrit, { color: critColor }]}>{item.issueCriticality ?? 'Média'}</Text>
                    </View>
                  );
                })}
                {pendingItems.length > 5 && <Text style={s.moreText}>+{pendingItems.length - 5} na aba Pendências</Text>}
              </View>
            )}
          </>
        )}

        {/* ── CHECKLIST ── */}
        {activeTab === 'Checklist' && (
          <>
            <View style={s.checklistHeader}>
              <Text style={s.checklistProgress}>{okCount} / {checklist.length} concluídos</Text>
              <Pressable onPress={() => setChecklist(initialChecklist)} style={s.resetBtn}>
                <MaterialCommunityIcons name="refresh" size={13} color="#64748B" />
                <Text style={s.resetBtnText}>Resetar</Text>
              </Pressable>
            </View>
            {checklist.map((item) => {
              const cfg = checklistConfig[item.state];
              const itemPhotos = photosByServiceId[item.id] ?? [];
              const isPending = item.state === 'pending' || item.state === 'partial';
              return (
                <View key={item.id} style={[s.checkCard, { borderLeftColor: cfg.color }]}>
                  <View style={s.checkCardTop}>
                    <View style={[s.checkIcon, { backgroundColor: cfg.background }]}>
                      <Text style={[s.checkIconSymbol, { color: cfg.color }]}>{cfg.symbol}</Text>
                    </View>
                    <View style={s.checkCardInfo}>
                      <Text style={s.checkLabel}>{item.label}</Text>
                      <Text style={[s.checkStatus, { color: cfg.color }]}>
                        {cfg.label}{itemPhotos.length > 0 ? ` · ${itemPhotos.length} foto(s)` : ''}
                      </Text>
                    </View>
                  </View>

                  <View style={s.stateRow}>
                    {checklistOptions.map((opt) => {
                      const oc = checklistConfig[opt];
                      const sel = item.state === opt;
                      return (
                        <Pressable
                          key={opt}
                          onPress={() => updateItemStatus(item.id, opt)}
                          testID={`checklist-${item.id}-${opt}`}
                          style={[s.stateBtn, sel && { backgroundColor: oc.background, borderColor: oc.color }]}>
                          <Text style={[s.stateBtnText, sel && { color: oc.color, fontWeight: '800' as const }]}>{oc.label}</Text>
                        </Pressable>
                      );
                    })}
                  </View>

                  <TextInput
                    multiline
                    onChangeText={(v) => updateItemComment(item.id, v)}
                    placeholder="Comentário..."
                    placeholderTextColor="#94A3B8"
                    style={s.textarea}
                    value={item.comment}
                  />

                  {isPending && (
                    <View style={s.issueBox}>
                      <Text style={s.issueBoxTitle}>Criticidade da pendência</Text>
                      <View style={s.critRow}>
                        {criticalityOptions.map((c) => {
                          const sel = item.issueCriticality === c;
                          const cc = c === 'Crítica' ? '#B91C1C' : c === 'Alta' ? '#B45309' : c === 'Média' ? '#D97706' : '#64748B';
                          return (
                            <Pressable
                              key={c}
                              onPress={() => updateItemIssue(item.id, 'issueCriticality', c)}
                              style={[s.critBtn, sel && { backgroundColor: cc, borderColor: cc }]}>
                              <Text style={[s.critBtnText, sel && { color: '#FFF' }]}>{c}</Text>
                            </Pressable>
                          );
                        })}
                      </View>
                      <TextInput
                        multiline
                        onChangeText={(v) => updateItemIssue(item.id, 'issueComment', v)}
                        placeholder="Descreva a pendência..."
                        placeholderTextColor="#94A3B8"
                        style={s.textarea}
                        value={item.issueComment ?? ''}
                      />
                    </View>
                  )}

                  <Pressable onPress={() => addPhotoToItem(item)} style={s.photoBtn} testID={`add-photo-${item.id}`}>
                    <MaterialCommunityIcons name="camera-plus-outline" size={15} color="#2563EB" />
                    <Text style={s.photoBtnText}>{itemPhotos.length > 0 ? 'Mais fotos' : 'Adicionar foto'}</Text>
                  </Pressable>

                  {itemPhotos.length > 0 && (
                    <View style={s.thumbGrid}>
                      {itemPhotos.map((photo) => (
                        <View key={photo.id} style={s.thumbCard}>
                          <Pressable onPress={() => setSelectedPhoto(photo)}>
                            <Image source={{ uri: photo.uri }} style={s.thumb} />
                          </Pressable>
                          <TextInput
                            onChangeText={(v) => updatePhotoComment(photo.id, v)}
                            placeholder="Comentário..."
                            placeholderTextColor="#94A3B8"
                            style={s.thumbInput}
                            testID={`photo-comment-${photo.id}`}
                            value={photo.comment}
                          />
                          <Pressable onPress={() => removePhoto(photo.id)} style={s.removeBtn} testID={`remove-photo-${photo.id}`}>
                            <MaterialCommunityIcons name="trash-can-outline" size={12} color="#B91C1C" />
                            <Text style={s.removeBtnText}>Remover</Text>
                          </Pressable>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              );
            })}
          </>
        )}

        {/* ── PENDÊNCIAS ── */}
        {activeTab === 'Pendências' && (
          <>
            {pendingItems.length === 0 ? (
              <View style={[s.card, s.cardCentered]}>
                <MaterialCommunityIcons name="check-circle" size={32} color="#047857" />
                <Text style={s.allClear}>Sem pendências ativas</Text>
              </View>
            ) : (
              pendingItems.map((item) => {
                const cfg = checklistConfig[item.state];
                const critColor = item.issueCriticality === 'Crítica' ? '#B91C1C' : item.issueCriticality === 'Alta' ? '#B45309' : '#D97706';
                return (
                  <View key={`p-${item.id}`} style={[s.issueCard, { borderLeftColor: cfg.color }]}>
                    <View style={s.issueCardRow}>
                      <Text style={s.issueCardLabel}>{item.label}</Text>
                      <View style={[s.critPill, { borderColor: critColor }]}>
                        <Text style={[s.critPillText, { color: critColor }]}>{item.issueCriticality ?? 'Média'}</Text>
                      </View>
                    </View>
                    <Text style={[s.issueCardState, { color: cfg.color }]}>{cfg.label}</Text>
                    {(item.issueComment || item.comment) ? (
                      <Text style={s.issueCardComment}>{item.issueComment || item.comment}</Text>
                    ) : null}
                    {(photosByServiceId[item.id]?.length ?? 0) > 0 && (
                      <Text style={s.issueCardPhotos}>{photosByServiceId[item.id].length} foto(s) anexada(s)</Text>
                    )}
                  </View>
                );
              })
            )}

            {blockedServiceGroups.length > 0 && (
              <>
                <Text style={s.sectionLabel}>Serviços travados por pendências</Text>
                {blockedServiceGroups.map((g) => (
                  <View key={g.pendingService} style={s.blockedCard}>
                    <View style={s.blockedRow}>
                      <MaterialCommunityIcons name="lock" size={15} color="#B45309" />
                      <Text style={s.blockedService}>{g.pendingService}</Text>
                      <View style={s.impactBadge}><Text style={s.impactBadgeText}>{g.impact}</Text></View>
                    </View>
                    <Text style={s.blockedChain}>Trava: {g.blockedServices.join(' · ')}</Text>
                  </View>
                ))}
              </>
            )}
          </>
        )}

        {/* ── FOTOS ── */}
        {activeTab === 'Fotos' && (
          photos.length === 0 ? (
            <View style={[s.card, s.cardCentered]}>
              <MaterialCommunityIcons name="camera-off-outline" size={40} color="#CBD5E1" />
              <Text style={s.emptyStateTitle}>Nenhuma foto registrada</Text>
              <Text style={s.emptyStateSub}>Adicione fotos na aba Checklist</Text>
            </View>
          ) : (
            <View style={s.gallery}>
              {photos.map((photo) => (
                <Pressable key={`g-${photo.id}`} onPress={() => setSelectedPhoto(photo)} style={s.galleryCard}>
                  <Image source={{ uri: photo.uri }} style={s.galleryImage} />
                  <View style={s.galleryInfo}>
                    <Text style={s.galleryService}>{photo.service}</Text>
                    <Text style={s.galleryMeta}>{formatPhotoDateTime(photo.dataHora ?? photo.createdAt)}</Text>
                    {photo.comment ? <Text style={s.galleryComment}>{photo.comment}</Text> : null}
                  </View>
                </Pressable>
              ))}
            </View>
          )
        )}

        {/* ── SERVIÇOS ── */}
        {activeTab === 'Serviços' && (
          <View style={s.card}>
            {checklist.map((item, idx) => {
              const cfg = checklistConfig[item.state];
              const n = photosByServiceId[item.id]?.length ?? 0;
              return (
                <View key={`svc-${item.id}`} style={[s.svcRow, idx > 0 && s.svcRowBorder]}>
                  <View style={[s.svcStripe, { backgroundColor: cfg.color }]} />
                  <View style={s.svcInfo}>
                    <Text style={s.svcLabel}>{item.label}</Text>
                    {item.comment ? <Text style={s.svcComment} numberOfLines={1}>{item.comment}</Text> : null}
                  </View>
                  <View style={s.svcRight}>
                    {n > 0 && <Text style={s.svcPhotos}>{n} 📷</Text>}
                    <View style={[s.svcBadge, { backgroundColor: cfg.background }]}>
                      <Text style={[s.svcBadgeText, { color: cfg.color }]}>{cfg.label}</Text>
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {/* ── CRONOGRAMA ── */}
        {activeTab === 'Cronograma' && (
          <>
            {scheduleAlert ? (
              <View style={s.alertBox}><Text style={s.alertText}>{scheduleAlert}</Text></View>
            ) : null}
            {scheduleRows.map((row) => {
              const checklistItem = checklist.find((i) => i.label === row.service);
              if (!checklistItem) return null;
              const ss = scheduleStatusStyles[row.scheduleStatus] ?? scheduleStatusStyles['No prazo'];
              const isPendingOrPartial = row.inspectionStatus === 'pending' || row.inspectionStatus === 'partial';
              const isNA = row.inspectionStatus === 'notApplicable';
              return (
                <View key={`sch-${checklistItem.id}`} style={s.schedCard}>
                  <View style={s.schedCardTop}>
                    <View style={s.schedInfo}>
                      <Text style={s.schedService}>{row.service}</Text>
                      <Text style={s.schedInspection}>{checklistConfig[row.inspectionStatus].label}</Text>
                    </View>
                    <View style={[s.schedBadge, { backgroundColor: ss.background }]}>
                      <Text style={[s.schedBadgeText, { color: ss.color }]}>{row.scheduleStatus}</Text>
                    </View>
                  </View>
                  {isNA ? (
                    <Text style={s.schedNA}>Não se aplica ao cronograma</Text>
                  ) : (
                    <>
                      <View style={s.formGrid}>
                        {[
                          { label: 'Início planejado', field: 'plannedStart' as keyof ScheduleFields, value: checklistItem.plannedStart },
                          { label: 'Término planejado', field: 'plannedEnd' as keyof ScheduleFields, value: checklistItem.plannedEnd },
                          { label: 'Início real', field: 'actualStart' as keyof ScheduleFields, value: checklistItem.actualStart },
                        ].map((f) => (
                          <View key={f.field} style={s.fieldGroup}>
                            <Text style={s.fieldLabel}>{f.label}</Text>
                            <TextInput
                              keyboardType="number-pad"
                              maxLength={10}
                              onChangeText={(v) => updateItemSchedule(checklistItem.id, f.field, v)}
                              placeholder="DD/MM/AAAA"
                              placeholderTextColor="#94A3B8"
                              style={s.input}
                              testID={`schedule-${f.field}-${checklistItem.id}`}
                              value={f.value ?? ''}
                            />
                          </View>
                        ))}
                        <View style={s.fieldGroup}>
                          <Text style={s.fieldLabel}>Término real</Text>
                          {isPendingOrPartial ? (
                            <View style={s.inputDisabled}><Text style={s.inputDisabledText}>Ainda não concluído</Text></View>
                          ) : (
                            <TextInput
                              keyboardType="number-pad"
                              maxLength={10}
                              onChangeText={(v) => updateItemSchedule(checklistItem.id, 'actualEnd', v)}
                              placeholder="DD/MM/AAAA"
                              placeholderTextColor="#94A3B8"
                              style={s.input}
                              testID={`schedule-actualEnd-${checklistItem.id}`}
                              value={checklistItem.actualEnd ?? ''}
                            />
                          )}
                        </View>
                      </View>
                      <View style={s.schedMeta}>
                        <Text style={s.schedMetaText}>Planejado: {formatDateBr(row.plannedStart)} → {formatDateBr(row.plannedEnd)}</Text>
                        <Text style={s.schedMetaText}>
                          {isPendingOrPartial
                            ? row.actualStart ? `Real: iniciado ${formatDateBr(row.actualStart)} — em andamento` : 'Real: não iniciado'
                            : `Real: ${formatDateBr(row.actualStart)} → ${formatDateBr(row.actualEnd)}`}
                        </Text>
                        {row.delayDays > 0 && <Text style={s.schedDelay}>Atraso: {row.delayDays} dia(s)</Text>}
                      </View>
                    </>
                  )}
                  {row.blockedServices.length > 0 && (
                    <Text style={s.schedBlocked}>Trava: {row.blockedServices.join(', ')}</Text>
                  )}
                </View>
              );
            })}
          </>
        )}

        {/* ── MEDIÇÕES ── */}
        {activeTab === 'Medições' && (
          <>
            <View style={s.measSummaryRow}>
              <View style={s.measSumCard}>
                <Text style={s.measSumValue}>{measurements.length}</Text>
                <Text style={s.measSumLabel}>medições</Text>
              </View>
              <View style={s.measSumCard}>
                <Text style={[s.measSumValue, { color: '#047857' }]}>{formatCurrency(totalMeasuredValue)}</Text>
                <Text style={s.measSumLabel}>valor total</Text>
              </View>
              <Pressable onPress={clearApartmentMeasurements} style={s.clearBtn}>
                <Text style={s.clearBtnText}>Limpar</Text>
              </Pressable>
            </View>

            {measurementAlert ? <View style={s.alertBox}><Text style={s.alertText}>{measurementAlert}</Text></View> : null}

            {measurableItems.length === 0 ? (
              <View style={[s.card, s.cardCentered]}>
                <MaterialCommunityIcons name="ruler" size={32} color="#CBD5E1" />
                <Text style={s.emptyStateTitle}>Nenhum item disponível</Text>
                <Text style={s.emptyStateSub}>Marque itens como OK no Checklist para criar medições</Text>
              </View>
            ) : (
              measurableItems.map((item) => {
                const draft = getMeasurementDraft(item.id);
                const draftTotal = toNumber(draft.quantity) * toNumber(draft.unitPrice);
                const hasDuplicate = Boolean(draft.contractor.trim()) && measurements.some((m) =>
                  getMeasurementDuplicateKey({ apartmentId: m.apartmentId, contractor: m.contractor, contractorId: m.contractorId, obraId: m.obraId, service: m.service, serviceId: m.serviceId, towerId: m.towerId }) ===
                  getMeasurementDuplicateKey({ apartmentId: apartment.id, contractor: draft.contractor, obraId: apartment.obraId, service: item.label, serviceId: item.id, towerId: tower.id }) &&
                  measurementBlocksDuplicate(m.status));
                return (
                  <View key={`meas-${item.id}`} style={s.measCard}>
                    <View style={s.measCardTop}>
                      <Text style={s.measService}>{item.label}</Text>
                      <Text style={[s.measTotal, draftTotal > 0 && { color: '#047857' }]}>{formatCurrency(draftTotal)}</Text>
                    </View>

                    <View style={s.formGrid}>
                      {[
                        { label: 'Empreiteiro', field: 'contractor' as keyof MeasurementDraft, placeholder: 'Nome', keyboard: 'default' as const },
                        { label: 'Quantidade', field: 'quantity' as keyof MeasurementDraft, placeholder: '0', keyboard: 'decimal-pad' as const },
                        { label: 'Unidade', field: 'unit' as keyof MeasurementDraft, placeholder: 'm², un', keyboard: 'default' as const },
                        { label: 'Valor unitário', field: 'unitPrice' as keyof MeasurementDraft, placeholder: '0,00', keyboard: 'decimal-pad' as const },
                        { label: 'Período início', field: 'periodStart' as keyof MeasurementDraft, placeholder: 'DD/MM/AAAA', keyboard: 'default' as const },
                        { label: 'Período fim', field: 'periodEnd' as keyof MeasurementDraft, placeholder: 'DD/MM/AAAA', keyboard: 'default' as const },
                      ].map((f) => (
                        <View key={f.field} style={s.fieldGroup}>
                          <Text style={s.fieldLabel}>{f.label}</Text>
                          <TextInput
                            keyboardType={f.keyboard}
                            onChangeText={(v) => updateMeasurementDraft(item.id, f.field, v)}
                            placeholder={f.placeholder}
                            placeholderTextColor="#94A3B8"
                            style={s.input}
                            testID={`measurement-${f.field}-${item.id}`}
                            value={String(draft[f.field] ?? '')}
                          />
                        </View>
                      ))}
                    </View>

                    {hasDuplicate && (
                      <View style={s.dupAlert}><Text style={s.dupAlertText}>{measurementDuplicateMessage}</Text></View>
                    )}

                    <View style={s.fieldGroup}>
                      <Text style={s.fieldLabel}>Tipo</Text>
                      <View style={s.optionRow}>
                        {measurementTypeOptions.map((t) => {
                          const sel = draft.measurementType === t;
                          return (
                            <Pressable key={t} onPress={() => { updateMeasurementDraft(item.id, 'measurementType', t); setMeasurementAlert(''); }}
                              style={[s.optBtn, sel && s.optBtnActive]}>
                              <Text style={[s.optBtnText, sel && s.optBtnTextActive]}>{getMeasurementTypeLabel(t)}</Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    </View>

                    <View style={s.fieldGroup}>
                      <Text style={s.fieldLabel}>Status</Text>
                      <View style={s.optionRow}>
                        {measurementStatusOptions.map((st) => {
                          const sel = draft.status === st;
                          return (
                            <Pressable key={st} onPress={() => updateMeasurementDraft(item.id, 'status', st)}
                              style={[s.optBtn, sel && s.optBtnGreen]}>
                              <Text style={[s.optBtnText, sel && s.optBtnGreenText]}>{st}</Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    </View>

                    <TextInput
                      multiline
                      onChangeText={(v) => updateMeasurementDraft(item.id, 'comment', v)}
                      placeholder="Observação..."
                      placeholderTextColor="#94A3B8"
                      style={s.textarea}
                      testID={`measurement-comment-${item.id}`}
                      value={draft.comment}
                    />

                    <View style={s.fieldGroup}>
                      <Text style={s.fieldLabel}>Evidência</Text>
                      {draft.evidenceUri ? (
                        <Pressable onPress={() => setSelectedMeasurementEvidence({ id: 'draft', apartmentId: apartment.id, obraId: apartment.obraId, towerId: tower.id, serviceId: item.id, contractorId: getContractorId(draft.contractor || 'rascunho'), service: item.label, contractor: draft.contractor || 'Rascunho', quantity: toNumber(draft.quantity), unit: draft.unit || 'un', unitPrice: toNumber(draft.unitPrice), totalValue: draftTotal, periodStart: draft.periodStart, periodEnd: draft.periodEnd, status: draft.status, comment: draft.comment, measurementType: draft.measurementType, evidenceUri: draft.evidenceUri, evidenceFileName: draft.evidenceFileName })}>
                          <Image source={{ uri: draft.evidenceUri }} style={s.evidenceThumb} />
                        </Pressable>
                      ) : null}
                      <Pressable onPress={() => addMeasurementEvidence(item.id)} style={s.clearBtn}>
                        <Text style={s.clearBtnText}>{draft.evidenceUri ? 'Trocar evidência' : 'Adicionar evidência'}</Text>
                      </Pressable>
                    </View>

                    <Pressable onPress={() => createMeasurement(item)} style={s.primaryBtn} testID={`create-measurement-${item.id}`}>
                      <Text style={s.primaryBtnText}>Criar medição</Text>
                    </Pressable>
                  </View>
                );
              })
            )}

            {measurements.map((m) => (
              <View key={m.id} style={s.savedMeasCard}>
                <View style={s.savedMeasTop}>
                  <View style={s.savedMeasInfo}>
                    <Text style={s.savedMeasService}>{m.service}</Text>
                    <Text style={s.savedMeasMeta}>{m.contractor} · {m.quantity} {m.unit} · {formatCurrency(m.unitPrice)}/{m.unit}</Text>
                    <Text style={s.savedMeasMeta}>Período: {m.periodStart} → {m.periodEnd}</Text>
                    {m.evidenceUri ? (
                      <Pressable onPress={() => setSelectedMeasurementEvidence(m)}>
                        <Text style={[s.savedMeasMeta, { color: '#2563EB' }]}>Ver evidência</Text>
                      </Pressable>
                    ) : null}
                  </View>
                  <Text style={s.savedMeasTotal}>{formatCurrency(m.totalValue)}</Text>
                </View>
                <View style={s.savedMeasFooter}>
                  <View style={s.savedMeasType}><Text style={s.savedMeasTypeText}>{getMeasurementTypeLabel(m.measurementType)}</Text></View>
                  <View style={s.savedMeasStatus}><Text style={s.savedMeasStatusText}>{m.status}</Text></View>
                  {m.comment ? <Text style={s.savedMeasComment}>{m.comment}</Text> : null}
                </View>
              </View>
            ))}
          </>
        )}

        {/* ── HISTÓRICO ── */}
        {activeTab === 'Histórico' && (
          sortVisitsDesc(visits).length === 0 ? (
            <View style={[s.card, s.cardCentered]}>
              <MaterialCommunityIcons name="history" size={40} color="#CBD5E1" />
              <Text style={s.emptyStateTitle}>Nenhuma visita registrada</Text>
              <Text style={s.emptyStateSub}>Inicie uma visita para registrar o histórico</Text>
            </View>
          ) : (
            sortVisitsDesc(visits).map((visit) => (
              <Pressable key={visit.id} onPress={() => setSelectedVisit(visit)} style={s.visitCard}>
                <View style={s.visitCardLeft}>
                  <View style={[s.visitDot2, { backgroundColor: visit.finalized ? '#047857' : '#2563EB' }]} />
                  <View>
                    <Text style={s.visitDate}>{formatPhotoDateTime(visit.date)}</Text>
                    <Text style={s.visitResp}>{visit.responsible}</Text>
                    <Text style={s.visitMeta}>
                      {visit.progressBefore}% → {visit.progressAfter}% · {visit.counts.pending + visit.counts.partial} pendência(s)
                    </Text>
                  </View>
                </View>
                <View style={s.visitCardRight}>
                  <Text style={[s.visitEvo, { color: getVariationColor(visit.evolution) }]}>
                    {visit.evolution >= 0 ? '+' : ''}{visit.evolution} p.p.
                  </Text>
                  <MaterialCommunityIcons name="chevron-right" size={18} color="#94A3B8" />
                </View>
              </Pressable>
            ))
          )
        )}

      </ScrollView>

      {/* MODAL: photo source picker */}
      <Modal animationType="fade" onRequestClose={() => setPhotoPickerTarget(null)} transparent visible={Boolean(photoPickerTarget)}>
        <Pressable style={s.modalBackdrop} onPress={() => setPhotoPickerTarget(null)}>
          <View style={s.pickerSheet}>
            <Text style={s.pickerTitle}>Adicionar foto</Text>
            <Pressable style={s.pickerOption} onPress={() => handlePickImage('camera')}>
              <MaterialCommunityIcons name="camera-outline" size={22} color="#2563EB" />
              <Text style={s.pickerOptionText}>Tirar foto</Text>
            </Pressable>
            <View style={s.pickerDivider} />
            <Pressable style={s.pickerOption} onPress={() => handlePickImage('gallery')}>
              <MaterialCommunityIcons name="image-outline" size={22} color="#2563EB" />
              <Text style={s.pickerOptionText}>Escolher da galeria</Text>
            </Pressable>
            <Pressable style={s.pickerCancel} onPress={() => setPhotoPickerTarget(null)}>
              <Text style={s.pickerCancelText}>Cancelar</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      {/* MODAL: photo */}
      <Modal animationType="fade" onRequestClose={() => setSelectedPhoto(undefined)} transparent visible={Boolean(selectedPhoto)}>
        <View style={s.modalBackdrop}>
          <View style={s.modalSheet}>
            {selectedPhoto && (
              <>
                <Image source={{ uri: selectedPhoto.uri }} style={s.modalImage} />
                <View style={s.modalInfo}>
                  <Text style={s.modalService}>{selectedPhoto.service}</Text>
                  <Text style={s.modalMeta}>{tower.name} / Apto {apartment.number}</Text>
                  <Text style={s.modalMeta}>{formatPhotoDateTime(selectedPhoto.dataHora ?? selectedPhoto.createdAt)}</Text>
                  {selectedPhoto.comment ? <Text style={s.modalComment}>{selectedPhoto.comment}</Text> : null}
                </View>
              </>
            )}
            <Pressable onPress={() => setSelectedPhoto(undefined)} style={s.modalClose}>
              <Text style={s.modalCloseText}>Fechar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* MODAL: measurement evidence */}
      <Modal animationType="fade" onRequestClose={() => setSelectedMeasurementEvidence(undefined)} transparent visible={Boolean(selectedMeasurementEvidence)}>
        <View style={s.modalBackdrop}>
          <View style={s.modalSheet}>
            {selectedMeasurementEvidence?.evidenceUri && (
              <>
                <Image source={{ uri: selectedMeasurementEvidence.evidenceUri }} style={s.modalImage} />
                <View style={s.modalInfo}>
                  <Text style={s.modalService}>{selectedMeasurementEvidence.service}</Text>
                  <Text style={s.modalMeta}>Empreiteiro: {selectedMeasurementEvidence.contractor}</Text>
                  {selectedMeasurementEvidence.evidenceFileName && <Text style={s.modalMeta}>{selectedMeasurementEvidence.evidenceFileName}</Text>}
                  {selectedMeasurementEvidence.comment ? <Text style={s.modalComment}>{selectedMeasurementEvidence.comment}</Text> : null}
                </View>
              </>
            )}
            <Pressable onPress={() => setSelectedMeasurementEvidence(undefined)} style={s.modalClose}>
              <Text style={s.modalCloseText}>Fechar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* MODAL: visit detail */}
      <Modal animationType="slide" onRequestClose={() => setSelectedVisit(undefined)} transparent visible={Boolean(selectedVisit)}>
        <View style={s.modalBackdrop}>
          <View style={s.visitModalSheet}>
            {selectedVisit && (
              <ScrollView contentContainerStyle={s.visitModalContent}>
                <Text style={s.visitModalTitle}>Detalhe da visita</Text>
                <View style={s.visitModalGrid}>
                  {[
                    `Data: ${formatPhotoDateTime(selectedVisit.date)}`,
                    `Responsável: ${selectedVisit.responsible}`,
                    `Antes: ${selectedVisit.progressBefore}%`,
                    `Depois: ${selectedVisit.progressAfter}%`,
                    `Evolução: ${getVariationLabel(selectedVisit.evolution)}`,
                    `Status: ${statusConfig[selectedVisit.statusAfter].label}`,
                  ].map((t) => <Text key={t} style={s.visitModalChip}>{t}</Text>)}
                </View>

                <Text style={s.visitModalSectionTitle}>Itens alterados</Text>
                {selectedVisit.changedItemIds.length === 0
                  ? <Text style={s.visitModalEmpty}>Nenhum item alterado.</Text>
                  : selectedVisit.changedItemIds.map((id) => <Text key={id} style={s.visitModalItem}>{checklist.find((i) => i.id === id)?.label ?? id}</Text>)}

                <Text style={s.visitModalSectionTitle}>Fotos adicionadas</Text>
                {photos.filter((p) => selectedVisit.addedPhotoIds.includes(p.id)).length === 0
                  ? <Text style={s.visitModalEmpty}>Nenhuma foto.</Text>
                  : <View style={s.thumbGrid}>
                    {photos.filter((p) => selectedVisit.addedPhotoIds.includes(p.id)).map((p) => (
                      <View key={`vp-${p.id}`} style={s.thumbCard}>
                        <Image source={{ uri: p.uri }} style={s.thumb} />
                        <Text style={s.thumbLabel}>{p.service}</Text>
                      </View>
                    ))}
                  </View>}

                <Text style={s.visitModalSectionTitle}>Pendências geradas</Text>
                {selectedVisit.issueItemIds.length === 0
                  ? <Text style={s.visitModalEmpty}>Nenhuma pendência.</Text>
                  : selectedVisit.issueItemIds.map((id) => <Text key={id} style={s.visitModalItem}>{checklist.find((i) => i.id === id)?.label ?? id}</Text>)}

                {selectedVisit.generalNote ? <Text style={s.visitModalNote}>{selectedVisit.generalNote}</Text> : null}
              </ScrollView>
            )}
            <Pressable onPress={() => setSelectedVisit(undefined)} style={s.modalClose}>
              <Text style={s.modalCloseText}>Fechar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

const s = StyleSheet.create({
  // layout
  container: { gap: 12, paddingBottom: 40 },
  empty: { flex: 1, backgroundColor: '#F8FAFC', padding: 16 },
  emptyBack: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 2, paddingVertical: 8, paddingRight: 12 },
  emptyBackText: { color: '#0F172A', fontSize: 15, fontWeight: '600' },
  emptyCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  emptyTitle: { color: '#0F172A', fontSize: 18, fontWeight: '700' },

  // header
  header: { paddingHorizontal: 20, paddingBottom: 20, gap: 10 },
  headerBack: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', marginLeft: -4, marginBottom: 2, gap: 2 },
  headerBackText: { color: 'rgba(255,255,255,0.9)', fontSize: 15, fontWeight: '600' },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  headerInfo: { flex: 1, gap: 4 },
  headerKicker: { color: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: '700' },
  headerAptNumber: { color: '#FFFFFF', fontSize: 34, fontWeight: '900', lineHeight: 38 },
  headerNotes: { color: 'rgba(255,255,255,0.75)', fontSize: 13, lineHeight: 18 },
  headerProgressCircle: { alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.18)', borderRadius: 14, paddingHorizontal: 16, paddingVertical: 12 },
  headerProgressValue: { color: '#FFFFFF', fontSize: 30, fontWeight: '900' },
  headerProgressLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 11, fontWeight: '600' },
  headerBar: { backgroundColor: 'rgba(0,0,0,0.2)', borderRadius: 999, height: 6, overflow: 'hidden' },
  headerBarFill: { backgroundColor: 'rgba(255,255,255,0.8)', height: '100%', borderRadius: 999 },
  headerMeta: { flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  headerMetaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  headerMetaText: { color: 'rgba(255,255,255,0.8)', fontSize: 12, fontWeight: '600' },
  statusPill: { backgroundColor: '#FFFFFF', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  statusPillText: { fontSize: 11, fontWeight: '900' },

  // visit banner
  visitBannerOpen: { backgroundColor: '#EFF6FF', borderColor: '#BFDBFE', borderWidth: 1, borderRadius: 14, marginHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14, gap: 10 },
  visitBannerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  visitPulse: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#2563EB' },
  visitBannerTitle: { color: '#1D4ED8', fontSize: 13, fontWeight: '800' },
  visitBannerSub: { color: '#60A5FA', fontSize: 11, marginTop: 1 },
  visitFinishBtn: { backgroundColor: '#2563EB', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9 },
  visitFinishBtnText: { color: '#FFFFFF', fontSize: 12, fontWeight: '900' },
  visitBannerNew: { backgroundColor: '#FFFFFF', borderColor: '#DBEAFE', borderWidth: 1, borderRadius: 14, marginHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 8, padding: 14 },
  visitBannerNewText: { color: '#2563EB', fontSize: 13, fontWeight: '700' },

  // kpi
  kpiRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16 },
  kpiCard: { flex: 1, backgroundColor: '#FFFFFF', borderColor: '#E2E8F0', borderWidth: 1, borderRadius: 14, padding: 12, alignItems: 'center', gap: 4 },
  kpiValue: { fontSize: 22, fontWeight: '900', color: '#0F172A' },
  kpiLabel: { color: '#64748B', fontSize: 10, fontWeight: '700', textAlign: 'center' },

  // tab bar
  tabBar: { flexDirection: 'row', gap: 6, paddingHorizontal: 16, paddingBottom: 2 },
  tabBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 999, borderWidth: 1, borderColor: '#E2E8F0', backgroundColor: '#FFFFFF' },
  tabBtnActive: { backgroundColor: '#EFF6FF', borderColor: '#2563EB' },
  tabBtnText: { color: '#94A3B8', fontSize: 12, fontWeight: '700' },
  tabBtnTextActive: { color: '#2563EB' },

  // card
  card: { backgroundColor: '#FFFFFF', borderColor: '#E2E8F0', borderWidth: 1, borderRadius: 14, padding: 16, marginHorizontal: 16, gap: 12 },
  cardTitle: { color: '#0F172A', fontSize: 15, fontWeight: '800' },
  cardCentered: { alignItems: 'center', justifyContent: 'center', paddingVertical: 28, gap: 8 },
  allClear: { color: '#047857', fontSize: 14, fontWeight: '700' },
  emptyStateTitle: { color: '#475569', fontSize: 15, fontWeight: '700' },
  emptyStateSub: { color: '#94A3B8', fontSize: 13, textAlign: 'center' },

  // resumo
  evoRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  evoStat: { flex: 1, alignItems: 'center' },
  evoValue: { fontSize: 30, fontWeight: '900', color: '#0F172A' },
  evoLabel: { color: '#64748B', fontSize: 11, fontWeight: '600', marginTop: 2 },
  evoBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  evoBadgeText: { fontSize: 13, fontWeight: '800' },
  evoMeta: { gap: 4, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#F1F5F9' },
  evoMetaText: { color: '#64748B', fontSize: 12 },
  evoMetaBold: { color: '#475569', fontWeight: '700' },
  pendingRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pendingDot: { width: 8, height: 8, borderRadius: 4 },
  pendingLabel: { flex: 1, color: '#0F172A', fontSize: 13, fontWeight: '600' },
  pendingCrit: { fontSize: 11, fontWeight: '800' },
  moreText: { color: '#94A3B8', fontSize: 12, textAlign: 'center' },
  textarea: { backgroundColor: '#F8FAFC', borderColor: '#E2E8F0', borderRadius: 10, borderWidth: 1, color: '#0F172A', fontSize: 13, minHeight: 64, padding: 10, textAlignVertical: 'top' },

  // checklist
  checklistHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16 },
  checklistProgress: { color: '#475569', fontSize: 13, fontWeight: '700' },
  resetBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  resetBtnText: { color: '#64748B', fontSize: 11, fontWeight: '700' },
  checkCard: { backgroundColor: '#FFFFFF', borderColor: '#E2E8F0', borderWidth: 1, borderRadius: 14, borderLeftWidth: 4, marginHorizontal: 16, padding: 14, gap: 12 },
  checkCardTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  checkIcon: { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  checkIconSymbol: { fontSize: 17, fontWeight: '900' },
  checkCardInfo: { flex: 1 },
  checkLabel: { color: '#0F172A', fontSize: 14, fontWeight: '700' },
  checkStatus: { fontSize: 12, fontWeight: '600', marginTop: 2 },
  stateRow: { flexDirection: 'row', gap: 6 },
  stateBtn: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 8, borderWidth: 1, borderColor: '#E2E8F0', backgroundColor: '#F8FAFC' },
  stateBtnText: { color: '#64748B', fontSize: 11, fontWeight: '700' },
  issueBox: { backgroundColor: '#FFFBEB', borderColor: '#FDE68A', borderRadius: 10, borderWidth: 1, padding: 12, gap: 10 },
  issueBoxTitle: { color: '#92400E', fontSize: 12, fontWeight: '800' },
  critRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  critBtn: { borderRadius: 8, borderWidth: 1, borderColor: '#CBD5E1', paddingHorizontal: 10, paddingVertical: 7, backgroundColor: '#FFFFFF' },
  critBtnText: { color: '#475569', fontSize: 12, fontWeight: '700' },
  photoBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: '#DBEAFE', backgroundColor: '#EFF6FF', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, alignSelf: 'flex-start' },
  photoBtnText: { color: '#2563EB', fontSize: 12, fontWeight: '700' },
  thumbGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  thumbCard: { width: 100, gap: 4 },
  thumb: { width: 100, height: 80, borderRadius: 8, backgroundColor: '#F1F5F9' },
  thumbLabel: { color: '#64748B', fontSize: 11 },
  thumbInput: { backgroundColor: '#F8FAFC', borderColor: '#E2E8F0', borderRadius: 6, borderWidth: 1, color: '#0F172A', fontSize: 11, padding: 6 },
  removeBtn: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  removeBtnText: { color: '#B91C1C', fontSize: 11, fontWeight: '700' },

  // pendências
  issueCard: { backgroundColor: '#FFFFFF', borderColor: '#E2E8F0', borderWidth: 1, borderRadius: 14, borderLeftWidth: 4, marginHorizontal: 16, padding: 14, gap: 8 },
  issueCardRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, justifyContent: 'space-between' },
  issueCardLabel: { color: '#0F172A', fontSize: 14, fontWeight: '800', flex: 1 },
  issueCardState: { fontSize: 12, fontWeight: '600' },
  issueCardComment: { color: '#475569', fontSize: 13, lineHeight: 18 },
  issueCardPhotos: { color: '#64748B', fontSize: 12 },
  critPill: { borderRadius: 999, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3 },
  critPillText: { fontSize: 11, fontWeight: '800' },
  sectionLabel: { color: '#64748B', fontSize: 12, fontWeight: '800', paddingHorizontal: 16, marginTop: 4 },
  blockedCard: { backgroundColor: '#FFFBEB', borderColor: '#FCD34D', borderWidth: 1, borderRadius: 12, marginHorizontal: 16, padding: 12, gap: 6 },
  blockedRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  blockedService: { color: '#92400E', fontSize: 13, fontWeight: '800', flex: 1 },
  blockedChain: { color: '#B45309', fontSize: 12 },
  impactBadge: { backgroundColor: '#FEF3C7', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  impactBadgeText: { color: '#B45309', fontSize: 11, fontWeight: '800' },

  // fotos
  gallery: { paddingHorizontal: 16, gap: 10 },
  galleryCard: { backgroundColor: '#FFFFFF', borderColor: '#E2E8F0', borderWidth: 1, borderRadius: 14, overflow: 'hidden' },
  galleryImage: { width: '100%', height: 200, backgroundColor: '#F1F5F9' },
  galleryInfo: { padding: 12, gap: 4 },
  galleryService: { color: '#0F172A', fontSize: 13, fontWeight: '700' },
  galleryMeta: { color: '#64748B', fontSize: 12 },
  galleryComment: { color: '#475569', fontSize: 13, marginTop: 2 },

  // serviços
  svcRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
  svcRowBorder: { borderTopWidth: 1, borderTopColor: '#F1F5F9' },
  svcStripe: { width: 4, height: 38, borderRadius: 2 },
  svcInfo: { flex: 1, paddingLeft: 10 },
  svcLabel: { color: '#0F172A', fontSize: 13, fontWeight: '700' },
  svcComment: { color: '#64748B', fontSize: 11, marginTop: 2 },
  svcRight: { alignItems: 'flex-end', gap: 4 },
  svcPhotos: { color: '#64748B', fontSize: 11 },
  svcBadge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  svcBadgeText: { fontSize: 11, fontWeight: '800' },

  // cronograma
  alertBox: { backgroundColor: '#FEF3C7', borderColor: '#FCD34D', borderWidth: 1, borderRadius: 10, padding: 12, marginHorizontal: 16 },
  alertText: { color: '#92400E', fontSize: 13, fontWeight: '600' },
  schedCard: { backgroundColor: '#FFFFFF', borderColor: '#E2E8F0', borderWidth: 1, borderRadius: 14, marginHorizontal: 16, padding: 14, gap: 12 },
  schedCardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, justifyContent: 'space-between' },
  schedInfo: { flex: 1, gap: 3 },
  schedService: { color: '#0F172A', fontSize: 14, fontWeight: '700' },
  schedInspection: { color: '#64748B', fontSize: 12 },
  schedBadge: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  schedBadgeText: { fontSize: 12, fontWeight: '800' },
  schedNA: { color: '#94A3B8', fontSize: 13 },
  formGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  fieldGroup: { flexGrow: 1, gap: 6, minWidth: 140 },
  fieldLabel: { color: '#475569', fontSize: 12, fontWeight: '700' },
  input: { backgroundColor: '#F8FAFC', borderColor: '#CBD5E1', borderRadius: 8, borderWidth: 1, color: '#0F172A', fontSize: 13, minHeight: 42, paddingHorizontal: 10 },
  inputDisabled: { backgroundColor: '#F1F5F9', borderRadius: 8, padding: 10 },
  inputDisabledText: { color: '#94A3B8', fontSize: 13 },
  schedMeta: { gap: 4 },
  schedMetaText: { color: '#475569', fontSize: 12 },
  schedDelay: { color: '#B91C1C', fontSize: 12, fontWeight: '700' },
  schedBlocked: { color: '#B45309', fontSize: 12, fontStyle: 'italic' },

  // medições
  measSummaryRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16 },
  measSumCard: { flex: 1, backgroundColor: '#FFFFFF', borderColor: '#E2E8F0', borderWidth: 1, borderRadius: 12, padding: 12, alignItems: 'center', gap: 2 },
  measSumValue: { color: '#0F172A', fontSize: 20, fontWeight: '900' },
  measSumLabel: { color: '#64748B', fontSize: 11, fontWeight: '600' },
  measCard: { backgroundColor: '#FFFFFF', borderColor: '#E2E8F0', borderWidth: 1, borderRadius: 14, marginHorizontal: 16, padding: 14, gap: 12 },
  measCardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  measService: { color: '#0F172A', fontSize: 14, fontWeight: '800', flex: 1 },
  measTotal: { color: '#94A3B8', fontSize: 16, fontWeight: '900' },
  dupAlert: { backgroundColor: '#FEF3C7', borderRadius: 8, padding: 10 },
  dupAlertText: { color: '#B45309', fontSize: 12, fontWeight: '700' },
  optionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  optBtn: { borderRadius: 8, borderWidth: 1, borderColor: '#CBD5E1', paddingHorizontal: 10, paddingVertical: 7 },
  optBtnText: { color: '#475569', fontSize: 12, fontWeight: '700' },
  optBtnActive: { backgroundColor: '#EFF6FF', borderColor: '#2563EB' },
  optBtnTextActive: { color: '#2563EB' },
  optBtnGreen: { backgroundColor: '#D1FAE5', borderColor: '#059669' },
  optBtnGreenText: { color: '#059669' },
  evidenceThumb: { width: 100, height: 80, borderRadius: 8, backgroundColor: '#F1F5F9' },
  primaryBtn: { backgroundColor: '#2563EB', borderRadius: 10, padding: 13, alignItems: 'center' },
  primaryBtnText: { color: '#FFFFFF', fontSize: 13, fontWeight: '900' },
  clearBtn: { borderRadius: 8, borderWidth: 1, borderColor: '#E2E8F0', paddingHorizontal: 12, paddingVertical: 8 },
  clearBtnText: { color: '#475569', fontSize: 12, fontWeight: '700' },
  savedMeasCard: { backgroundColor: '#F8FAFC', borderColor: '#E2E8F0', borderWidth: 1, borderRadius: 14, marginHorizontal: 16, padding: 14, gap: 8 },
  savedMeasTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 },
  savedMeasInfo: { flex: 1, gap: 3 },
  savedMeasService: { color: '#0F172A', fontSize: 13, fontWeight: '800' },
  savedMeasMeta: { color: '#64748B', fontSize: 12 },
  savedMeasTotal: { color: '#047857', fontSize: 16, fontWeight: '900' },
  savedMeasFooter: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
  savedMeasType: { backgroundColor: '#EFF6FF', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  savedMeasTypeText: { color: '#2563EB', fontSize: 11, fontWeight: '700' },
  savedMeasStatus: { backgroundColor: '#D1FAE5', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  savedMeasStatusText: { color: '#047857', fontSize: 11, fontWeight: '700' },
  savedMeasComment: { color: '#64748B', fontSize: 12, fontStyle: 'italic' },

  // histórico
  visitCard: { backgroundColor: '#FFFFFF', borderColor: '#E2E8F0', borderWidth: 1, borderRadius: 14, marginHorizontal: 16, padding: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  visitCardLeft: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, flex: 1 },
  visitDot2: { width: 10, height: 10, borderRadius: 5, marginTop: 3 },
  visitDate: { color: '#0F172A', fontSize: 13, fontWeight: '700' },
  visitResp: { color: '#64748B', fontSize: 12, marginTop: 2 },
  visitMeta: { color: '#94A3B8', fontSize: 11, marginTop: 2 },
  visitCardRight: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  visitEvo: { fontSize: 14, fontWeight: '800' },

  // photo source picker
  pickerSheet: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: 24, paddingTop: 8 },
  pickerTitle: { textAlign: 'center', fontSize: 15, fontWeight: '700', color: '#0F172A', paddingVertical: 14, paddingHorizontal: 20 },
  pickerOption: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 16, paddingHorizontal: 24 },
  pickerOptionText: { fontSize: 16, color: '#0F172A', fontWeight: '500' },
  pickerDivider: { height: 1, backgroundColor: '#F1F5F9', marginHorizontal: 20 },
  pickerCancel: { marginHorizontal: 20, marginTop: 16, borderRadius: 12, borderWidth: 1, borderColor: '#E2E8F0', paddingVertical: 14, alignItems: 'center' },
  pickerCancelText: { fontSize: 15, color: '#64748B', fontWeight: '600' },

  // modals
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 20, borderTopRightRadius: 20, overflow: 'hidden', maxHeight: '88%' },
  modalImage: { width: '100%', height: 260, backgroundColor: '#000' },
  modalInfo: { padding: 16, gap: 4 },
  modalService: { color: '#0F172A', fontSize: 14, fontWeight: '800' },
  modalMeta: { color: '#64748B', fontSize: 12 },
  modalComment: { color: '#475569', fontSize: 13, marginTop: 4 },
  modalClose: { margin: 16, backgroundColor: '#F1F5F9', borderRadius: 12, padding: 14, alignItems: 'center' },
  modalCloseText: { color: '#0F172A', fontSize: 14, fontWeight: '800' },
  visitModalSheet: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '90%' },
  visitModalContent: { padding: 20, gap: 14 },
  visitModalTitle: { color: '#0F172A', fontSize: 18, fontWeight: '900' },
  visitModalGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  visitModalChip: { backgroundColor: '#F8FAFC', borderColor: '#E2E8F0', borderWidth: 1, borderRadius: 999, color: '#475569', fontSize: 12, fontWeight: '700', paddingHorizontal: 10, paddingVertical: 6 },
  visitModalSectionTitle: { color: '#0F172A', fontSize: 14, fontWeight: '800' },
  visitModalEmpty: { color: '#94A3B8', fontSize: 13 },
  visitModalItem: { color: '#475569', fontSize: 13 },
  visitModalNote: { color: '#475569', fontSize: 13, fontStyle: 'italic' },
});
