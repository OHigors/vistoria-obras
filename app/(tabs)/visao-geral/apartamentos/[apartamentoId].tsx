import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Image, Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native'
import { Text } from '@/src/ui/Text';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';

import type { ApartmentStatus, ChecklistItem, ChecklistState } from '@/src/data/mockObras';
import { useAreaFilter } from '@/src/data/AreaFilterContext';
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
import { categoryOrderIndex, defaultServiceDependencies, getGroupStepChildren, isServiceActiveForFeature } from '@/src/data/serviceStages';
import type { Worker } from '@/src/data/serviceWorkers';
import { checklistConfig, getProgressMapStyle, statusConfig } from '@/src/ui/status';

const checklistOptions: ChecklistState[] = ['ok', 'pending', 'partial', 'notApplicable'];

const CATEGORY_PALETTE = ['#2563EB', '#7C3AED', '#0891B2', '#16A34A', '#D97706', '#DB2777', '#0EA5E9', '#65A30D', '#B45309', '#9333EA'];
const categoryColor = (cat: string) => {
  let hash = 0;
  for (let i = 0; i < cat.length; i++) hash = (hash * 31 + cat.charCodeAt(i)) >>> 0;
  return CATEGORY_PALETTE[hash % CATEGORY_PALETTE.length];
};
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
  emergency: string;
  issueCriticality?: IssueCriticality;
  issueComment?: string;
} & ScheduleFields;

const isIssueCriticality = (v: unknown): v is IssueCriticality =>
  criticalityOptions.includes(v as IssueCriticality);

// Group steps are configured per stage in "Serviços e Etapas" (a stage that
// declares sub-steps). When all sub-steps are 'ok'/'NA' the parent auto-resolves
// to 'ok'. The parent→children map is derived from the live catalog at runtime.
const applyGroupStepStates = (
  items: EditableChecklistItem[],
  groupChildren: Record<string, string[]>,
): EditableChecklistItem[] => {
  const stateByLabel = new Map(items.map((i) => [i.label, i.state]));
  return items.map((item) => {
    const children = groupChildren[item.label];
    if (!children) return item;
    const childStates = children.map((name) => stateByLabel.get(name) ?? 'pending');
    const allDone = childStates.every((s) => s === 'ok' || s === 'notApplicable');
    const anyProgress = childStates.some((s) => s === 'ok' || s === 'partial');
    const derivedState: ChecklistState = allDone ? 'ok' : anyProgress ? 'partial' : 'pending';
    return derivedState !== item.state ? { ...item, state: derivedState } : item;
  });
};

const getInitialChecklist = (items?: ChecklistItem[]): EditableChecklistItem[] =>
  (items ?? []).filter((item) => isServiceActiveForFeature(item.label, 'checklist')).map((item) => ({
    ...item,
    comment: item.comment ?? '',
    emergency: item.emergency ?? '',
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
  const { getApartmentById, getTowerById, updateApartmentLocal, serviceStages, refreshServiceStages, project, loading } = useObras();
  const { areaFilter, setAreaFilter } = useAreaFilter();
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
  const [addStepOpen, setAddStepOpen] = useState(false);
  const [addStepSearch, setAddStepSearch] = useState('');
  const [addStepArea, setAddStepArea] = useState<'Interior' | 'Exterior'>('Interior');
  const [confirmRemoveStep, setConfirmRemoveStep] = useState<EditableChecklistItem | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [tabArrows, setTabArrows] = useState({ left: false, right: false });
  const [collapsedChecklistGroups, setCollapsedChecklistGroups] = useState<Record<string, boolean>>({});
  const [collapsedAddStepGroups, setCollapsedAddStepGroups] = useState<Record<string, boolean>>({});
  const [expandedGroupSteps, setExpandedGroupSteps] = useState<Record<string, boolean>>({});
  const [expandedComments, setExpandedComments] = useState<Record<string, boolean>>({});
  const [draftComments, setDraftComments] = useState<Record<string, string>>({});
  const [expandedEmergencies, setExpandedEmergencies] = useState<Record<string, boolean>>({});
  const [draftEmergencies, setDraftEmergencies] = useState<Record<string, string>>({});
  const [visitsLoading, setVisitsLoading] = useState(true);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [assignments, setAssignments] = useState<Record<string, string[]>>({});
  const [workerPickerItem, setWorkerPickerItem] = useState<EditableChecklistItem | null>(null);
  const [draftWorkerIds, setDraftWorkerIds] = useState<string[]>([]);
  const [workerSearch, setWorkerSearch] = useState('');
  const [savingAssignment, setSavingAssignment] = useState(false);
  const scrollRef = useRef<ScrollView | null>(null);
  const tabScrollRef = useRef<ScrollView | null>(null);
  const tabScrollX = useRef(0);
  const tabLayoutW = useRef(0);
  const tabContentW = useRef(0);
  const updateTabArrows = useCallback((x: number) => {
    tabScrollX.current = x;
    const left = x > 4;
    const right = x + tabLayoutW.current < tabContentW.current - 4;
    setTabArrows((cur) => (cur.left === left && cur.right === right ? cur : { left, right }));
  }, []);
  const scrollTabsBy = useCallback((delta: number) => {
    tabScrollRef.current?.scrollTo({ x: Math.max(0, tabScrollX.current + delta), animated: true });
  }, []);

  // ── save batching + visible feedback ─────────────────────────────────────
  // We batch writes (checklist items, photo comments, open visit) and show a
  // toast so the user always sees that something was persisted. Reduces the
  // "1 DB write per keystroke" pattern to a single write per ~800ms idle window.
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [uploadStatus, setUploadStatus] = useState<Record<string, 'uploading' | 'uploaded' | 'failed'>>({});
  const toastAnim = useRef(new Animated.Value(0)).current;
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftCommentsRef = useRef<Record<string, string>>({});
  const draftEmergenciesRef = useRef<Record<string, string>>({});
  const pendingRef = useRef<{
    checklistItems: Map<string, EditableChecklistItem>;
    photos: Map<string, InspectionPhoto>;
    visits: Map<string, InspectionVisit>;
  }>({ checklistItems: new Map(), photos: new Map(), visits: new Map() });

  const showToast = useCallback((status: 'saving' | 'saved' | 'error') => {
    setSaveStatus(status);
    Animated.timing(toastAnim, { toValue: 1, duration: 180, useNativeDriver: true }).start();
    if (hideToastTimerRef.current) clearTimeout(hideToastTimerRef.current);
    if (status !== 'saving') {
      hideToastTimerRef.current = setTimeout(() => {
        Animated.timing(toastAnim, { toValue: 0, duration: 220, useNativeDriver: true }).start(() => setSaveStatus('idle'));
      }, 1600);
    }
  }, [toastAnim]);

  const flushSaves = useCallback(async () => {
    const { checklistItems, photos: pendingPhotos, visits: pendingVisits } = pendingRef.current;
    if (checklistItems.size === 0 && pendingPhotos.size === 0 && pendingVisits.size === 0) {
      // Nothing actually changed (e.g. tapping the current status again). Resolve
      // the "Salvando…" toast instead of leaving it spinning forever.
      showToast('saved');
      return;
    }
    pendingRef.current = { checklistItems: new Map(), photos: new Map(), visits: new Map() };
    try {
      await Promise.all([
        ...Array.from(checklistItems.values()).map((i) =>
          apartamentoId ? dbApi.upsertChecklistItem({ ...i, apartmentId: apartamentoId }) : Promise.resolve(),
        ),
        ...Array.from(pendingPhotos.values()).map((p) => dbApi.savePhoto(p)),
        ...Array.from(pendingVisits.values()).map((v) => dbApi.saveVisit(v)),
      ]);
      showToast('saved');
    } catch (err) {
      console.error('Save flush failed', err);
      showToast('error');
    }
  }, [apartamentoId, showToast]);

  const scheduleSave = useCallback(() => {
    showToast('saving');
    if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    flushTimerRef.current = setTimeout(flushSaves, 1000);
  }, [flushSaves, showToast]);

  useEffect(() => () => {
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      // Best-effort: fire and forget any in-flight pending writes on unmount.
      flushSaves();
    }
    if (hideToastTimerRef.current) clearTimeout(hideToastTimerRef.current);
  }, [flushSaves]);

  useEffect(() => {
    if (!apartamentoId) return;
    setChecklist(getInitialChecklist(apartment?.checklist));
    setMeasurementDrafts({});
    setMeasurementAlert('');
    setSelectedVisit(undefined);
    dbApi.loadMeasurements(apartamentoId).then(setMeasurements);
    dbApi.loadPhotos(apartamentoId).then(setPhotos);
    setVisitsLoading(true);
    dbApi.loadVisits(apartamentoId).then((v) => { setVisits(v); setVisitsLoading(false); });
    dbApi.loadStepAssignments(apartamentoId).then(setAssignments);
  }, [apartamentoId, apartment?.checklist]);

  useEffect(() => {
    dbApi.loadWorkers().then(setWorkers);
  }, []);

  const isExtraStep = useCallback((item: EditableChecklistItem) => item.isExtra === true, []);

  // Catalog stages available to add: active, marked for checklist, and not
  // already on this apartment.
  const availableStages = useMemo(() => {
    const existingLabels = new Set(checklist.map((i) => i.label));
    const q = addStepSearch.trim().toLocaleLowerCase('pt-BR');
    return serviceStages
      .filter((stage) => stage.ativo && stage.apareceNoChecklist && !existingLabels.has(stage.nome))
      .filter((stage) => !q || stage.nome.toLocaleLowerCase('pt-BR').includes(q) || stage.categoria.toLocaleLowerCase('pt-BR').includes(q))
      .sort((a, b) => a.ordemExecucao - b.ordemExecucao);
  }, [serviceStages, checklist, addStepSearch]);

  // Reload the catalog whenever the user opens the picker so freshly-created
  // catalog steps (from Cronograma → Serviços e etapas) show up immediately.
  useEffect(() => {
    if (addStepOpen) refreshServiceStages();
  }, [addStepOpen, refreshServiceStages]);

  const categoryByLabel = useMemo(() => {
    const map = new Map<string, string>();
    for (const stage of serviceStages) {
      const cat = stage.categoria?.trim() || 'Sem categoria';
      map.set(stage.nome, cat);
    }
    return map;
  }, [serviceStages]);

  const areaChecklist = useMemo(
    () => checklist.filter((i) => (i.area ?? 'Interior') === areaFilter),
    [checklist, areaFilter],
  );

  const checklistGroups = useMemo(() => {
    const map = new Map<string, EditableChecklistItem[]>();
    for (const item of areaChecklist) {
      const cat = categoryByLabel.get(item.label) || 'Sem categoria';
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(item);
    }
    return [...map.entries()].sort(([a], [b]) => categoryOrderIndex(a) - categoryOrderIndex(b) || a.localeCompare(b, 'pt-BR'));
  }, [areaChecklist, categoryByLabel]);

  useEffect(() => {
    setCollapsedChecklistGroups((cur) => {
      const next = { ...cur };
      for (const [cat] of checklistGroups) if (!(cat in next)) next[cat] = true;
      return next;
    });
  }, [checklistGroups]);

  const blockedBy = useMemo(() => {
    const forward = new Map<string, string[]>(
      Object.entries(defaultServiceDependencies).map(([k, v]) => [k.toLowerCase(), v.map((s) => s.toLowerCase())])
    );
    for (const stage of serviceStages) {
      if (stage.servicosDependentes.length > 0) {
        const key = stage.nome.toLowerCase();
        const existing = forward.get(key) ?? [];
        const merged = [...new Set([...existing, ...stage.servicosDependentes.map((s) => s.toLowerCase())])];
        forward.set(key, merged);
      }
    }
    const map = new Map<string, string[]>();
    for (const [blocker, blocked] of forward) {
      for (const dep of blocked) {
        const cur = map.get(dep) ?? [];
        map.set(dep, [...cur, blocker]);
      }
    }
    return map;
  }, [serviceStages]);

  const checklistStateByLabel = useMemo(() => {
    const map = new Map<string, ChecklistState>();
    for (const item of checklist) map.set(item.label.toLowerCase(), item.state);
    return map;
  }, [checklist]);

  // Group-step definitions come from the live catalog (Serviços e Etapas).
  const groupStepChildren = useMemo(() => getGroupStepChildren(serviceStages), [serviceStages]);
  const allGroupSubStepLabels = useMemo(
    () => new Set(Object.values(groupStepChildren).flat()),
    [groupStepChildren],
  );

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
  const areaOkCount = areaChecklist.filter((i) => i.state === 'ok' || i.state === 'notApplicable').length;
  const currentStatusKey = calculateApartmentStatus(checklist, progress);
  const status = statusConfig[currentStatusKey];

  const measurableItems = checklist.filter((i) => i.state === 'ok' && isServiceActiveForFeature(i.label, 'medicao'));
  const blockedServiceGroups = getBlockedServiceGroups(checklist);
  const scheduleRows = getScheduleRows(checklist);
  // Count steps currently locked by an active blocker — same predicate the
  // checklist uses to show the "Etapa travada" banner, so the KPI always matches
  // what's visible (including user-configured dependencies, not just defaults).
  const lockedStepsCount = checklist.filter((item) => {
    const blockerLabels = blockedBy.get(item.label.toLowerCase()) ?? [];
    return blockerLabels.some((b) => {
      const st = checklistStateByLabel.get(b);
      return st !== 'ok' && st !== 'partial' && st !== 'notApplicable';
    });
  }).length;
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
      pendingRef.current.visits.set(updated.id, updated);
      return current.map((v) => (v.id === open.id ? updated : v));
    });
    scheduleSave();
  };

  const updateItemStatus = (itemId: string, state: ChecklistState) => {
    const prev = checklist;
    const baseNext = prev.map((i) => i.id === itemId
      ? { ...i, state, issueCriticality: state === 'pending' || state === 'partial' ? i.issueCriticality ?? 'Média' : undefined, issueComment: state === 'pending' || state === 'partial' ? i.issueComment ?? '' : '' }
      : i);
    // Re-derive group step parent states whenever a sub-step changes.
    const next = applyGroupStepStates(baseNext, groupStepChildren);
    setChecklist(next);
    if (apartamentoId) {
      // Queue every item whose state changed (direct edit + any auto-updated parent).
      for (const item of next) {
        const prevItem = prev.find((p) => p.id === item.id);
        if (prevItem?.state !== item.state) pendingRef.current.checklistItems.set(item.id, item);
      }
      const np = calculateProgress(next);
      const ns = calculateApartmentStatus(next, np);
      dbApi.updateApartmentStats(apartamentoId, np, ns).catch(() => showToast('error'));
      updateApartmentLocal(apartamentoId, np, ns, next);
    }
    registerVisitUpdate({ changedItemId: itemId, nextChecklist: next, nextPhotos: photos, progressBeforeFallback: calculateProgress(prev) });
    scheduleSave();
  };

  const updateItemComment = (itemId: string, comment: string) => {
    setChecklist((cur) => {
      const next = cur.map((i) => i.id === itemId ? { ...i, comment } : i);
      const changed = next.find((i) => i.id === itemId);
      if (changed) pendingRef.current.checklistItems.set(itemId, changed);
      registerVisitUpdate({ changedItemId: itemId, nextChecklist: next, nextPhotos: photos, progressBeforeFallback: calculateProgress(cur) });
      return next;
    });
    scheduleSave();
  };

  const updateItemIssue = (itemId: string, field: 'issueCriticality' | 'issueComment', value: string) => {
    setChecklist((cur) => {
      const next = cur.map((i) =>
        i.id === itemId && field === 'issueCriticality' && isIssueCriticality(value) ? { ...i, issueCriticality: value }
        : i.id === itemId && field === 'issueComment' ? { ...i, issueComment: value }
        : i);
      const changed = next.find((i) => i.id === itemId);
      if (changed) pendingRef.current.checklistItems.set(itemId, changed);
      registerVisitUpdate({ changedItemId: itemId, nextChecklist: next, nextPhotos: photos, progressBeforeFallback: calculateProgress(cur) });
      return next;
    });
    scheduleSave();
  };

  const updateItemSchedule = (itemId: string, field: keyof ScheduleFields, value: string) => {
    const masked = maskDateBr(value);
    if (masked.length === 10 && !isValidBrDate(masked)) setScheduleAlert('Data inválida. Use DD/MM/AAAA.');
    else if (masked.length > 0 && masked.length < 10) setScheduleAlert('Use DD/MM/AAAA.');
    else setScheduleAlert('');
    setChecklist((cur) => {
      const next = cur.map((i) => i.id === itemId ? { ...i, [field]: masked } : i);
      const changed = next.find((i) => i.id === itemId);
      if (changed && masked.length === 10) {
        pendingRef.current.checklistItems.set(itemId, changed);
        scheduleSave();
      }
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
    const pickedUri = Platform.OS === 'web' ? `data:image/jpeg;base64,${asset.base64}` : asset.uri;
    // Re-encode to strip EXIF metadata (GPS, device info) before anything is stored.
    const stripped = await manipulateAsync(pickedUri, [], { compress: 0.85, format: SaveFormat.JPEG });
    const localUri = stripped.uri;
    const createdAt = new Date().toISOString();
    const fileName = asset.fileName ?? `foto-${Date.now()}.jpg`;

    if (photoPickerTarget.forMeasurement) {
      updateMeasurementDraft(photoPickerTarget.itemId, 'evidenceUri', localUri);
      updateMeasurementDraft(photoPickerTarget.itemId, 'evidenceFileName', fileName);
      return;
    }

    const item = checklist.find((i) => i.id === photoPickerTarget.itemId);
    if (!item) return;
    const photoId = crypto.randomUUID();
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
    setUploadStatus((u) => ({ ...u, [photoId]: 'uploading' }));
    showToast('saving');

    // Upload to Storage, then persist the row pointing at the storage path.
    (async () => {
      try {
        await dbApi.uploadInspectionPhoto(localUri, storagePath, 'image/jpeg');
        const signedUrl = await dbApi.getInspectionPhotoUrl(storagePath);
        const persisted = { ...optimisticPhoto, uri: signedUrl, storagePath };
        await dbApi.savePhoto(persisted);
        setPhotos((cur) => cur.map((p) => (p.id === photoId ? persisted : p)));
        setUploadStatus((u) => ({ ...u, [photoId]: 'uploaded' }));
        showToast('saved');
        setTimeout(() => setUploadStatus((u) => {
          const next = { ...u }; delete next[photoId]; return next;
        }), 2000);
      } catch (err) {
        console.error('Failed to upload inspection photo', err);
        setPhotos((cur) => cur.filter((p) => p.id !== photoId));
        setUploadStatus((u) => {
          const next = { ...u }; delete next[photoId]; return next;
        });
        showToast('error');
      }
    })();
  };

  const updatePhotoComment = (photoId: string, comment: string) => {
    setPhotos((cur) => {
      const target = cur.find((p) => p.id === photoId);
      const next = cur.map((p) => p.id === photoId ? { ...p, comment, comentarioFoto: comment } : p);
      const updated = next.find((p) => p.id === photoId);
      if (updated) pendingRef.current.photos.set(photoId, updated);
      registerVisitUpdate({ changedItemId: target?.serviceId, nextChecklist: checklist, nextPhotos: next, progressBeforeFallback: progress });
      return next;
    });
    scheduleSave();
  };

  const removePhoto = (photoId: string) => {
    setPhotos((cur) => {
      const target = cur.find((p) => p.id === photoId);
      // Delete is a single discrete intent — fire it now so the user knows it's gone.
      dbApi.deletePhoto(photoId, target?.storagePath).catch(() => showToast('error'));
      const next = cur.filter((p) => p.id !== photoId);
      pendingRef.current.photos.delete(photoId);
      registerVisitUpdate({ changedItemId: target?.serviceId, nextChecklist: checklist, nextPhotos: next, progressBeforeFallback: progress });
      return next;
    });
    setSelectedPhoto((cur) => (cur?.id === photoId ? undefined : cur));
    showToast('saved');
  };

  const updateOpenVisitNote = (generalNote: string) => {
    setVisits((cur) => cur.map((v) => {
      if (v.finalized) return v;
      const updated = { ...v, generalNote, observacaoGeral: generalNote };
      pendingRef.current.visits.set(updated.id, updated);
      return updated;
    }));
    scheduleSave();
  };

  const finishVisit = () => {
    if (!apartment) return;
    // Cancel any pending debounced save — finishVisit writes the canonical row.
    if (flushTimerRef.current) { clearTimeout(flushTimerRef.current); flushTimerRef.current = null; }
    pendingRef.current = { checklistItems: new Map(), photos: new Map(), visits: new Map() };
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
      dbApi.saveVisit(finalized).catch(() => showToast('error'));
      dbApi.updateApartmentStats(apartment.id, progress, statusAfter).catch(() => showToast('error'));
      updateApartmentLocal(apartment.id, progress, statusAfter);
      return cur.map((v) => (v.id === open.id ? finalized : v));
    });
    showToast('saved');
  };

  const startNewVisit = () => {
    if (!apartment) return;
    setVisits((cur) => {
      if (cur.some((v) => !v.finalized)) return cur;
      const now = new Date().toISOString();
      const statusAfter = calculateApartmentStatus(checklist, progress);
      const newVisit = {
        id: crypto.randomUUID(), apartmentId: apartment.id, apartamentoId: apartment.id,
        date: now, startedAt: now, dataInicio: now,
        responsible: localResponsible, responsavel: localResponsible,
        progressBefore: progress, percentualAntes: progress, progressAfter: progress, percentualDepois: progress,
        evolution: 0, evolucao: 0, counts: getChecklistCounts(checklist),
        photosAdded: 0, quantidadeFotos: 0, quantidadePendencias: pendingItems.length,
        statusAfter, statusFinal: statusAfter, generalNote: '', observacaoGeral: '',
        changedItemIds: [], addedPhotoIds: [], issueItemIds: pendingItems.map((i) => i.id), finalized: false,
      };
      dbApi.saveVisit(newVisit).catch(() => showToast('error'));
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
      id: crypto.randomUUID(), obraId: apartment.obraId, towerId: tower?.id,
      apartmentId: apartment.id, serviceId: item.id, contractorId, service: item.label, contractor,
      quantity, unit: draft.unit.trim() || 'un', unitPrice, totalValue: quantity * unitPrice,
      periodStart, periodEnd, status: draft.status, comment: draft.comment.trim(),
      measurementType: draft.measurementType, evidenceUri: draft.evidenceUri || undefined,
      evidenceFileName: draft.evidenceFileName || undefined, responsible: localResponsible,
      launchedAt: new Date().toISOString(),
      approvedAt: draft.status === 'Aprovado para pagamento' ? new Date().toISOString() : undefined,
    };
    dbApi.saveMeasurement(m).catch(() => showToast('error'));
    setMeasurements((prev) => [...prev, m]);
    setMeasurementAlert('');
    setMeasurementDrafts((cur) => ({ ...cur, [item.id]: createEmptyMeasurementDraft() }));
  };

  const clearApartmentMeasurements = () => {
    measurements.forEach((m) => dbApi.deleteMeasurement(m.id).catch(() => showToast('error')));
    setMeasurements([]);
    setMeasurementDrafts({});
    setMeasurementAlert('');
  };

  const addStepToApartment = (stageLabel: string) => {
    if (!apartamentoId || !apartment) return;
    const newItem: EditableChecklistItem = {
      id: crypto.randomUUID(),
      label: stageLabel,
      state: 'pending',
      comment: '',
      emergency: '',
      issueCriticality: 'Média',
      issueComment: '',
      // Area is chosen in the add-step popup — the catalog stage carries no area.
      area: addStepArea,
      isExtra: true,
    };
    const prev = checklist;
    const next = [...prev, newItem];
    const np = calculateProgress(next);
    const ns = calculateApartmentStatus(next, np);
    pendingRef.current.checklistItems.set(newItem.id, newItem);
    setChecklist(next);
    // External side-effects happen AFTER the local setState so we never call
    // another component's setState during this render.
    dbApi.updateApartmentStats(apartamentoId, np, ns).catch(() => showToast('error'));
    updateApartmentLocal(apartamentoId, np, ns, next);
    registerVisitUpdate({ changedItemId: newItem.id, nextChecklist: next, nextPhotos: photos, progressBeforeFallback: calculateProgress(prev) });
    scheduleSave();
    // Land on the area the step was added to so it's immediately visible.
    if (areaFilter !== addStepArea) setAreaFilter(addStepArea);
    setAddStepOpen(false);
    setAddStepSearch('');
  };

  const requestRemoveStep = (item: EditableChecklistItem) => {
    setConfirmRemoveStep(item);
  };

  const confirmRemoveStepNow = () => {
    const target = confirmRemoveStep;
    if (!target || !apartamentoId || !apartment) return;
    setConfirmRemoveStep(null);

    // Cascade photos: soft-delete the inspection_photos rows (Storage objects kept for restore).
    const itemPhotos = photos.filter((p) => p.serviceId === target.id || p.itemId === target.id);
    itemPhotos.forEach((p) => dbApi.deletePhoto(p.id, p.storagePath).catch(() => showToast('error')));
    const nextPhotos = itemPhotos.length > 0
      ? photos.filter((p) => p.serviceId !== target.id && p.itemId !== target.id)
      : photos;
    if (itemPhotos.length > 0) setPhotos(nextPhotos);

    // Cascade measurements: any medição launched for this checklist item.
    const itemMeasurements = measurements.filter((m) => m.serviceId === target.id);
    itemMeasurements.forEach((m) => dbApi.deleteMeasurement(m.id).catch(() => showToast('error')));
    if (itemMeasurements.length > 0) {
      setMeasurements((cur) => cur.filter((m) => m.serviceId !== target.id));
    }

    dbApi.deleteChecklistItem(target.id).catch(() => showToast('error'));
    pendingRef.current.checklistItems.delete(target.id);
    const prev = checklist;
    const next = prev.filter((i) => i.id !== target.id);
    const np = calculateProgress(next);
    const ns = calculateApartmentStatus(next, np);
    setChecklist(next);
    // All cross-component setState happens AFTER local setState.
    dbApi.updateApartmentStats(apartamentoId, np, ns).catch(() => showToast('error'));
    updateApartmentLocal(apartamentoId, np, ns, next);
    registerVisitUpdate({ changedItemId: target.id, nextChecklist: next, nextPhotos, progressBeforeFallback: calculateProgress(prev) });
    showToast('saved');
  };

  const confirmResetNow = () => {
    if (!apartment) return;
    setConfirmReset(false);
    // Soft-delete every photo row from this apartment (Storage objects kept for restore).
    photos.forEach((p) => dbApi.deletePhoto(p.id, p.storagePath).catch(() => showToast('error')));
    setPhotos([]);
    setChecklist(initialChecklist);
    showToast('saved');
  };

  // ── worker assignment ─────────────────────────────────────────────────────

  const openComment = (itemId: string, currentComment: string) => {
    draftCommentsRef.current[itemId] = currentComment;
    setDraftComments((cur) => ({ ...cur, [itemId]: currentComment }));
    setExpandedComments((cur) => ({ ...cur, [itemId]: true }));
  };

  const closeComment = (itemId: string, saveDraft = false) => {
    if (saveDraft) {
      const comment = (draftCommentsRef.current[itemId] ?? '').trim();
      if (apartamentoId) {
        const existing = checklist.find((i) => i.id === itemId);
        if (existing) {
          const next = checklist.map((i) => i.id === itemId ? { ...i, comment } : i);
          setChecklist(next);
          // Keep the shared context in sync so navigating away and back doesn't
          // overwrite the saved comment with stale data from ObrasContext.
          const np = calculateProgress(next);
          updateApartmentLocal(apartamentoId, np, calculateApartmentStatus(next, np), next);
          showToast('saving');
          dbApi.upsertChecklistItem({ ...existing, comment, apartmentId: apartamentoId })
            .then(() => showToast('saved'))
            .catch(() => showToast('error'));
        }
      }
    }
    setExpandedComments((cur) => ({ ...cur, [itemId]: false }));
  };

  const openEmergency = (itemId: string, currentEmergency: string) => {
    draftEmergenciesRef.current[itemId] = currentEmergency;
    setDraftEmergencies((cur) => ({ ...cur, [itemId]: currentEmergency }));
    setExpandedEmergencies((cur) => ({ ...cur, [itemId]: true }));
  };

  const closeEmergency = (itemId: string, saveDraft = false) => {
    if (saveDraft) {
      const emergency = (draftEmergenciesRef.current[itemId] ?? '').trim();
      if (apartamentoId) {
        const existing = checklist.find((i) => i.id === itemId);
        if (existing) {
          const next = checklist.map((i) => i.id === itemId ? { ...i, emergency } : i);
          setChecklist(next);
          const np = calculateProgress(next);
          updateApartmentLocal(apartamentoId, np, calculateApartmentStatus(next, np), next);
          showToast('saving');
          dbApi.upsertChecklistItem({ ...existing, emergency, apartmentId: apartamentoId })
            .then(() => showToast('saved'))
            .catch(() => showToast('error'));
        }
      }
    }
    setExpandedEmergencies((cur) => ({ ...cur, [itemId]: false }));
  };

  const openWorkerPicker = (item: EditableChecklistItem) => {
    setWorkerPickerItem(item);
    setDraftWorkerIds(assignments[item.id] ?? []);
    setWorkerSearch('');
  };

  const toggleWorker = (workerId: string) => {
    setDraftWorkerIds((cur) =>
      cur.includes(workerId) ? cur.filter((id) => id !== workerId) : [...cur, workerId],
    );
  };

  const saveWorkerAssignment = async () => {
    if (!workerPickerItem || !apartamentoId) return;
    setSavingAssignment(true);
    try {
      await dbApi.setStepAssignments(apartamentoId, workerPickerItem.id, draftWorkerIds);
      setAssignments((cur) => ({ ...cur, [workerPickerItem.id]: draftWorkerIds }));
      setWorkerPickerItem(null);
    } catch {
      // keep modal open so the user can retry
    } finally {
      setSavingAssignment(false);
    }
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
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={s.container}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={120}
        onScroll={(e) => {
          const y = e.nativeEvent.contentOffset.y;
          if (y > 400 && !showBackToTop) setShowBackToTop(true);
          else if (y <= 400 && showBackToTop) setShowBackToTop(false);
        }}>

        {/* STATUS HEADER */}
        <View style={[s.header, { paddingTop: insets.top + 12, backgroundColor: getProgressMapStyle(progress).fg }]}>
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
              <Text style={s.headerMetaText}>{okCount} de {checklist.length} etapas concluídas</Text>
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
            { icon: 'clipboard-list-outline', value: pendingItems.length, label: 'Pendências', color: '#4a5565', borderColor: undefined },
            { icon: 'lock-outline', value: lockedStepsCount, label: 'Travados', color: '#B45309' },
            { icon: 'camera-outline', value: photos.length, label: 'Fotos', color: '#2563EB', borderColor: undefined },
            { icon: 'ruler', value: measurements.length, label: 'Medições', color: '#7C3AED', borderColor: undefined },
          ].map((k) => (
            <View key={k.label} style={[s.kpiCard, k.borderColor ? { borderColor: k.borderColor } : undefined]}>
              <MaterialCommunityIcons name={k.icon as any} size={20} color={k.color} />
              <Text style={[s.kpiValue, { color: k.color }]}>{k.value}</Text>
              <Text style={s.kpiLabel}>{k.label}</Text>
            </View>
          ))}
        </View>

        {/* TAB BAR */}
        <View style={s.tabBarWrap}>
          <ScrollView
            ref={tabScrollRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={s.tabBar}
            scrollEventThrottle={32}
            onLayout={(e) => { tabLayoutW.current = e.nativeEvent.layout.width; updateTabArrows(tabScrollX.current); }}
            onContentSizeChange={(w) => { tabContentW.current = w; updateTabArrows(tabScrollX.current); }}
            onScroll={(e) => updateTabArrows(e.nativeEvent.contentOffset.x)}>
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
          {tabArrows.left && (
            <Pressable
              onPress={() => scrollTabsBy(-160)}
              style={[s.tabArrow, s.tabArrowLeft]}
              accessibilityRole="button"
              accessibilityLabel="Ver abas anteriores"
              hitSlop={6}>
              <MaterialCommunityIcons name="chevron-left" size={20} color="#64748B" />
            </Pressable>
          )}
          {tabArrows.right && (
            <Pressable
              onPress={() => scrollTabsBy(160)}
              style={[s.tabArrow, s.tabArrowRight]}
              accessibilityRole="button"
              accessibilityLabel="Ver mais abas"
              hitSlop={6}>
              <MaterialCommunityIcons name="chevron-right" size={20} color="#64748B" />
            </Pressable>
          )}
        </View>

        {/* ── RESUMO ── */}
        {activeTab === 'Resumo' && (
          <>
            <View style={s.card}>
              <Text style={s.cardTitle}>Evolução</Text>
              <View style={s.evoRow}>
                <View style={s.evoStat}>
                  {visitsLoading ? <View style={s.skelValue} /> : <Text style={s.evoValue}>{previousProgress}%</Text>}
                  <Text style={s.evoLabel}>Anterior</Text>
                </View>
                <MaterialCommunityIcons name="arrow-right" size={20} color="#CBD5E1" />
                <View style={s.evoStat}>
                  {visitsLoading ? <View style={s.skelValue} /> : <Text style={[s.evoValue, { color: status.color }]}>{progress}%</Text>}
                  <Text style={s.evoLabel}>Atual</Text>
                </View>
                {visitsLoading ? (
                  <View style={[s.evoBadge, { backgroundColor: '#F1F5F9' }]}>
                    <View style={s.skelBadge} />
                  </View>
                ) : (
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
                )}
              </View>
              <View style={s.evoMeta}>
                {visitsLoading ? (
                  <>
                    <View style={s.skelLine} />
                    <View style={s.skelLine} />
                    <View style={s.skelLine} />
                  </>
                ) : (
                  <>
                    <Text style={s.evoMetaText}><Text style={s.evoMetaBold}>Visitas:</Text> {visits.length}</Text>
                    <Text style={s.evoMetaText}><Text style={s.evoMetaBold}>Primeira:</Text> {firstVisit ? formatPhotoDateTime(firstVisit.date) : '—'}</Text>
                    <Text style={s.evoMetaText}><Text style={s.evoMetaBold}>Última:</Text> {latestVisit ? formatPhotoDateTime(latestVisit.date) : '—'}</Text>
                  </>
                )}
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
              <Text style={s.checklistProgress}>{areaOkCount} / {areaChecklist.length} concluídos</Text>
              <View style={s.checklistHeaderActions}>
                <Pressable
                  onPress={() => {
                    setAddStepSearch('');
                    setAddStepArea(areaFilter);
                    const cats: Record<string, boolean> = {};
                    for (const stg of serviceStages) {
                      const cat = stg.categoria?.trim() || 'Sem categoria';
                      cats[cat] = true;
                    }
                    setCollapsedAddStepGroups(cats);
                    setAddStepOpen(true);
                  }}
                  style={s.addStepBtn}
                  testID="add-step-btn">
                  <MaterialCommunityIcons name="plus-circle-outline" size={14} color="#2563EB" />
                  <Text style={s.addStepBtnText}>Adicionar etapa</Text>
                </Pressable>
              </View>
            </View>
            <View style={s.checklistAreaRow}>
              <Pressable
                onPress={() => setAreaFilter('Exterior')}
                style={[s.checklistAreaBtn, areaFilter === 'Exterior' && s.checklistAreaBtnExterior]}>
                <MaterialCommunityIcons name="domain" size={13} color={areaFilter === 'Exterior' ? '#D97706' : '#94A3B8'} />
                <Text style={[s.checklistAreaBtnText, areaFilter === 'Exterior' && s.checklistAreaBtnTextExterior]}>Exterior</Text>
              </Pressable>
              <Pressable
                onPress={() => setAreaFilter('Interior')}
                style={[s.checklistAreaBtn, areaFilter === 'Interior' && s.checklistAreaBtnInterior]}>
                <MaterialCommunityIcons name="floor-plan" size={13} color={areaFilter === 'Interior' ? '#0891B2' : '#94A3B8'} />
                <Text style={[s.checklistAreaBtnText, areaFilter === 'Interior' && s.checklistAreaBtnTextInterior]}>Interior</Text>
              </Pressable>
            </View>

            {checklistGroups.map(([cat, groupItems]) => {
              const color = categoryColor(cat);
              const collapsed = collapsedChecklistGroups[cat] === true;
              // Sub-steps are hidden from the main list; only count non-sub-step items for the header.
              const visibleItems = groupItems.filter((i) => !allGroupSubStepLabels.has(i.label));
              const okInGroup = visibleItems.filter((i) => i.state === 'ok' || i.state === 'notApplicable').length;
              // Build ordered render list. Top-level entries are ordered by state
              // (Parcial, Pendente, Não se aplica, OK) so completed steps sink to the
              // bottom. Group-step sub-steps stay attached to their parent in roadmap order.
              const stateOrder: Record<string, number> = { partial: 0, pending: 1, notApplicable: 2, ok: 3 };
              type RenderRow = { item: EditableChecklistItem; indented: boolean };
              const blocks: Array<{ sortKey: number; rows: RenderRow[] }> = [];
              for (const item of groupItems) {
                if (item.label in groupStepChildren) {
                  const rows: RenderRow[] = [{ item, indented: false }];
                  if (expandedGroupSteps[item.label]) {
                    for (const childLabel of groupStepChildren[item.label]) {
                      // Resolve against the full checklist: sub-steps belong to the
                      // group regardless of their own category or area, so they must
                      // all appear nested under the parent even when the parent's
                      // area differs from the sub-step's area.
                      const child = checklist.find((i) => i.label === childLabel);
                      if (child) rows.push({ item: child, indented: true });
                    }
                  }
                  blocks.push({ sortKey: stateOrder[item.state] ?? 1, rows });
                } else if (!allGroupSubStepLabels.has(item.label)) {
                  blocks.push({ sortKey: stateOrder[item.state] ?? 1, rows: [{ item, indented: false }] });
                }
              }
              blocks.sort((a, b) => a.sortKey - b.sortKey);
              const renderItems: RenderRow[] = blocks.flatMap((b) => b.rows);
              if (renderItems.length === 0) return null;
              return (
                <View key={`chk-grp-${cat}`} style={s.checklistGroup}>
                  <Pressable
                    onPress={() => setCollapsedChecklistGroups((cur) => ({ ...cur, [cat]: !collapsed }))}
                    style={s.checklistGroupHeader}>
                    <MaterialCommunityIcons name={collapsed ? 'chevron-right' : 'chevron-down'} size={18} color="#64748B" />
                    <View style={[s.checklistGroupDot, { backgroundColor: color }]} />
                    <Text style={s.checklistGroupTitle}>{cat}</Text>
                    <Text style={s.checklistGroupCount}>{okInGroup}/{visibleItems.length} OK</Text>
                  </Pressable>
                  {!collapsed && renderItems.map(({ item, indented }) => {
                    const cfg = checklistConfig[item.state];
                    const itemPhotos = photosByServiceId[item.id] ?? [];
                    const isPending = item.state === 'pending' || item.state === 'partial';
                    const blockerLabels = blockedBy.get(item.label.toLowerCase()) ?? [];
                    const activeBlockers = blockerLabels.filter((b) => {
                      const st = checklistStateByLabel.get(b);
                      return st !== 'ok' && st !== 'partial' && st !== 'notApplicable';
                    });
                    const isLocked = activeBlockers.length > 0;
                    const isGroupStep = !indented && item.label in groupStepChildren;
                    const isExpanded = isGroupStep && !!expandedGroupSteps[item.label];
                    const subStepNames = isGroupStep ? groupStepChildren[item.label] : [];
                    const subStepItems = subStepNames.map((name) => checklist.find((i) => i.label === name));
                    return (
                      <View key={`${item.id}-${indented}`} style={[s.checkCard, { borderLeftColor: isLocked ? '#B45309' : isGroupStep ? '#0891B2' : cfg.color }, isLocked && s.checkCardLocked, indented && s.checkCardIndented]}>
                  {isGroupStep ? (
                    <View style={s.checkCardTop}>
                      <Pressable
                        onPress={() => setExpandedGroupSteps((cur) => ({ ...cur, [item.label]: !isExpanded }))}
                        style={s.checkCardTopMain}>
                        <View style={[s.checkIcon, { backgroundColor: '#E0F2FE' }]}>
                          <MaterialCommunityIcons name="layers-outline" size={18} color="#0891B2" />
                        </View>
                        <View style={s.checkCardInfo}>
                          <View style={s.checkLabelRow}>
                            <Text style={s.checkLabel}>{item.label}</Text>
                            <View style={s.groupBadge}>
                              <MaterialCommunityIcons name="layers-outline" size={10} color="#0891B2" />
                              <Text style={s.groupBadgeText}>Grupo</Text>
                            </View>
                          </View>
                          <Text style={[s.checkStatus, { color: '#0891B2' }]}>
                            {subStepItems.filter((s) => s?.state === 'ok' || s?.state === 'notApplicable').length}/{subStepNames.length} sub-etapas OK
                          </Text>
                          {(assignments[item.id]?.length ?? 0) > 0 && (
                            <Text style={s.assignedWorkersBadge}>
                              {assignments[item.id].length} colaborador(es)
                            </Text>
                          )}
                        </View>
                        <MaterialCommunityIcons name={isExpanded ? 'chevron-up' : 'chevron-down'} size={20} color="#0891B2" />
                      </Pressable>
                      <Pressable onPress={() => openWorkerPicker(item)} style={s.menuDotsBtn} hitSlop={8}>
                        <MaterialCommunityIcons name="account-plus-outline" size={20} color="#94A3B8" />
                      </Pressable>
                    </View>
                  ) : (
                    <View style={s.checkCardTop}>
                      <View style={[s.checkIcon, { backgroundColor: cfg.background }]}>
                        <Text style={[s.checkIconSymbol, { color: cfg.color }]}>{cfg.symbol}</Text>
                      </View>
                      <View style={s.checkCardInfo}>
                        <View style={s.checkLabelRow}>
                          <Text style={s.checkLabel}>{item.label}</Text>
                          {isExtraStep(item) && (
                            <View style={s.extraBadge}>
                              <MaterialCommunityIcons name="star-outline" size={10} color="#7C3AED" />
                              <Text style={s.extraBadgeText}>Extra</Text>
                            </View>
                          )}
                        </View>
                        {itemPhotos.length > 0 && (
                          <Text style={s.checkPhotoCount}>· {itemPhotos.length} foto(s)</Text>
                        )}
                        {(assignments[item.id]?.length ?? 0) > 0 && (
                          <Text style={s.assignedWorkersBadge}>
                            {assignments[item.id].length} colaborador(es)
                          </Text>
                        )}
                      </View>
                      <Pressable onPress={() => openWorkerPicker(item)} style={s.menuDotsBtn} hitSlop={8}>
                        <MaterialCommunityIcons name="account-plus-outline" size={20} color="#94A3B8" />
                      </Pressable>
                      <Pressable
                        onPress={() => requestRemoveStep(item)}
                        style={s.removeStepBtn}
                        testID={`remove-step-${item.id}`}
                        hitSlop={8}>
                        <MaterialCommunityIcons name="close" size={16} color="#94A3B8" />
                      </Pressable>
                    </View>
                  )}

                  {isLocked ? (
                    <View style={s.lockBanner}>
                      <MaterialCommunityIcons name="lock" size={14} color="#B45309" />
                      <View style={{ flex: 1 }}>
                        <Text style={s.lockTitle}>Etapa travada</Text>
                        <Text style={s.lockText} numberOfLines={3}>
                          Aguardando conclusão de: {activeBlockers.join(', ')}
                        </Text>
                      </View>
                    </View>
                  ) : isGroupStep ? (
                    <View style={s.roadmapTrack}>
                      {subStepNames.map((name, idx) => {
                        const sub = subStepItems[idx];
                        const subState = sub?.state ?? 'pending';
                        const subIsOk = subState === 'ok' || subState === 'notApplicable';
                        const subIsPartial = subState === 'partial';
                        const subBlockers = blockedBy.get(name.toLowerCase()) ?? [];
                        const subIsLocked = subBlockers.some((b) => {
                          const st = checklistStateByLabel.get(b);
                          return st !== 'ok' && st !== 'partial' && st !== 'notApplicable';
                        });
                        const dotColor = subIsLocked ? '#B45309' : subIsOk ? '#047857' : '#D97706';
                        const prevSub = idx > 0 ? subStepItems[idx - 1] : null;
                        const prevIsOk = prevSub ? (prevSub.state === 'ok' || prevSub.state === 'notApplicable') : false;
                        const leftLineColor = idx === 0 ? 'transparent' : prevIsOk ? '#047857' : '#E2E8F0';
                        const rightLineColor = idx === subStepNames.length - 1 ? 'transparent' : subIsOk ? '#047857' : '#E2E8F0';
                        const shortLabel = name.replace(/^Impermeabilização /, '');
                        return (
                          <View key={name} style={s.roadmapCell}>
                            <View style={s.roadmapDotRow}>
                              <View style={[s.roadmapHalfLine, { backgroundColor: leftLineColor }]} />
                              <View style={[s.roadmapDot, {
                                backgroundColor: subIsOk ? dotColor : subIsLocked ? '#FEF3C7' : '#FFFFFF',
                                borderColor: dotColor,
                              }]}>
                                {subIsLocked
                                  ? <MaterialCommunityIcons name="lock" size={9} color="#B45309" />
                                  : subIsOk
                                  ? <MaterialCommunityIcons name="check" size={11} color="#FFFFFF" />
                                  : <View style={[s.roadmapInnerDot, { backgroundColor: dotColor }]} />
                                }
                              </View>
                              <View style={[s.roadmapHalfLine, { backgroundColor: rightLineColor }]} />
                            </View>
                            <Text style={[s.roadmapCellLabel, { color: dotColor }]} numberOfLines={2}>{shortLabel}</Text>
                          </View>
                        );
                      })}
                    </View>
                  ) : (
                    <>
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

                      {item.emergency?.trim() && !expandedEmergencies[item.id] && (
                        <Pressable
                          onPress={() => openEmergency(item.id, item.emergency ?? '')}
                          style={s.emergencyPreview}>
                          <MaterialCommunityIcons name="alert" size={13} color="#DC2626" />
                          <Text style={s.emergencyPreviewText} numberOfLines={2}>{item.emergency}</Text>
                          <MaterialCommunityIcons name="pencil-outline" size={13} color="#94A3B8" />
                        </Pressable>
                      )}

                      {expandedEmergencies[item.id] && (
                        <View style={s.emergencyBox}>
                          <TextInput
                            multiline
                            onChangeText={(v) => {
                              draftEmergenciesRef.current[item.id] = v;
                              setDraftEmergencies((cur) => ({ ...cur, [item.id]: v }));
                            }}
                            placeholder="Descreva a emergência..."
                            placeholderTextColor="#94A3B8"
                            style={s.emergencyTextarea}
                            value={draftEmergencies[item.id] ?? ''}
                          />
                          <View style={s.obsBoxFooter}>
                            {(draftEmergencies[item.id] ?? '').trim() ? (
                              <Pressable onPress={() => { draftEmergenciesRef.current[item.id] = ''; setDraftEmergencies((cur) => ({ ...cur, [item.id]: '' })); }} style={s.obsClearBtn}>
                                <MaterialCommunityIcons name="trash-can-outline" size={13} color="#B91C1C" />
                                <Text style={s.obsClearBtnText}>Limpar</Text>
                              </Pressable>
                            ) : <View />}
                            <View style={s.obsBoxFooterRight}>
                              <Pressable onPress={() => closeEmergency(item.id, false)} style={s.obsCancelBtn}>
                                <Text style={s.obsCancelBtnText}>Cancelar</Text>
                              </Pressable>
                              <Pressable onPress={() => closeEmergency(item.id, true)} style={s.obsDoneBtn}>
                                <Text style={s.obsDoneBtnText}>Salvar</Text>
                              </Pressable>
                            </View>
                          </View>
                        </View>
                      )}

                      {item.comment?.trim() && !expandedComments[item.id] && (
                        <Pressable
                          onPress={() => openComment(item.id, item.comment ?? '')}
                          style={s.obsPreview}>
                          <MaterialCommunityIcons name="note-text-outline" size={13} color="#2563EB" />
                          <Text style={s.obsPreviewText} numberOfLines={2}>{item.comment}</Text>
                          <MaterialCommunityIcons name="pencil-outline" size={13} color="#94A3B8" />
                        </Pressable>
                      )}

                      {expandedComments[item.id] && (
                        <View style={s.obsBox}>
                          <TextInput
                            multiline
                            onChangeText={(v) => {
                              draftCommentsRef.current[item.id] = v;
                              setDraftComments((cur) => ({ ...cur, [item.id]: v }));
                            }}
                            placeholder="Adicione uma observação..."
                            placeholderTextColor="#94A3B8"
                            style={s.obsTextarea}
                            value={draftComments[item.id] ?? ''}
                          />
                          <View style={s.obsBoxFooter}>
                            {(draftComments[item.id] ?? '').trim() ? (
                              <Pressable onPress={() => { draftCommentsRef.current[item.id] = ''; setDraftComments((cur) => ({ ...cur, [item.id]: '' })); }} style={s.obsClearBtn}>
                                <MaterialCommunityIcons name="trash-can-outline" size={13} color="#B91C1C" />
                                <Text style={s.obsClearBtnText}>Limpar</Text>
                              </Pressable>
                            ) : <View />}
                            <View style={s.obsBoxFooterRight}>
                              <Pressable onPress={() => closeComment(item.id, false)} style={s.obsCancelBtn}>
                                <Text style={s.obsCancelBtnText}>Cancelar</Text>
                              </Pressable>
                              <Pressable onPress={() => closeComment(item.id, true)} style={s.obsDoneBtn}>
                                <Text style={s.obsDoneBtnText}>Salvar</Text>
                              </Pressable>
                            </View>
                          </View>
                        </View>
                      )}

                      <View style={s.cardActions}>
                        <Pressable
                          onPress={() => expandedEmergencies[item.id]
                            ? closeEmergency(item.id, false)
                            : openEmergency(item.id, item.emergency ?? '')}
                          style={s.cardActionBtn}>
                          <MaterialCommunityIcons name="alert-outline" size={15} color="#64748B" />
                          <Text style={s.cardActionBtnText}>Emergência</Text>
                        </Pressable>
                        <Pressable
                          onPress={() => expandedComments[item.id]
                            ? closeComment(item.id, false)
                            : openComment(item.id, item.comment ?? '')}
                          style={s.cardActionBtn}>
                          <MaterialCommunityIcons name="note-plus-outline" size={15} color="#64748B" />
                          <Text style={s.cardActionBtnText}>Observação</Text>
                        </Pressable>
                        <Pressable onPress={() => addPhotoToItem(item)} style={s.cardActionBtn} testID={`add-photo-${item.id}`}>
                          <MaterialCommunityIcons name="camera-plus-outline" size={15} color="#64748B" />
                          <Text style={s.cardActionBtnText}>
                            {itemPhotos.length > 0 ? `Fotos (${itemPhotos.length})` : 'Foto'}
                          </Text>
                        </Pressable>
                      </View>

                      {itemPhotos.length > 0 && (
                        <View style={s.thumbGrid}>
                          {itemPhotos.map((photo) => (
                            <View key={photo.id} style={s.thumbCard}>
                              <Pressable onPress={() => setSelectedPhoto(photo)}>
                                <View>
                                  <Image source={{ uri: photo.uri }} style={s.thumb} />
                                  {uploadStatus[photo.id] === 'uploading' && (
                                    <View style={s.thumbOverlay}>
                                      <MaterialCommunityIcons name="cloud-upload-outline" size={18} color="#FFFFFF" />
                                      <Text style={s.thumbOverlayText}>Enviando…</Text>
                                    </View>
                                  )}
                                  {uploadStatus[photo.id] === 'uploaded' && (
                                    <View style={s.thumbBadge}>
                                      <MaterialCommunityIcons name="check" size={12} color="#FFFFFF" />
                                    </View>
                                  )}
                                </View>
                              </Pressable>
                              <View style={s.thumbBody}>
                                <TextInput
                                  multiline
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
                            </View>
                          ))}
                        </View>
                      )}
                    </>
                  )}
                      </View>
                    );
                  })}
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

      {/* MODAL: confirm remove extra step */}
      <Modal animationType="fade" onRequestClose={() => setConfirmRemoveStep(null)} transparent visible={Boolean(confirmRemoveStep)}>
        <View style={s.modalBackdrop}>
          <View style={s.confirmSheet}>
            <View style={[s.confirmIcon, { backgroundColor: '#FEE2E2' }]}>
              <MaterialCommunityIcons name="trash-can-outline" size={26} color="#B91C1C" />
            </View>
            <Text style={s.confirmTitle}>Remover etapa deste apartamento?</Text>
            <Text style={s.confirmSub}>
              {confirmRemoveStep?.label}
              {(() => {
                const pn = photos.filter((p) => p.serviceId === confirmRemoveStep?.id || p.itemId === confirmRemoveStep?.id).length;
                const mn = measurements.filter((m) => m.serviceId === confirmRemoveStep?.id).length;
                const parts: string[] = [];
                if (pn > 0) parts.push(`${pn} foto(s)`);
                if (mn > 0) parts.push(`${mn} medição(ões)`);
                return parts.length ? ` · ${parts.join(' e ')} vinculada(s) também serão apagadas.` : '';
              })()}
            </Text>
            <View style={s.confirmActions}>
              <Pressable onPress={() => setConfirmRemoveStep(null)} style={s.confirmBtnGhost}>
                <Text style={s.confirmBtnGhostText}>Cancelar</Text>
              </Pressable>
              <Pressable onPress={confirmRemoveStepNow} style={s.confirmBtnDanger}>
                <Text style={s.confirmBtnDangerText}>Remover</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* MODAL: confirm reset checklist + wipe photos */}
      <Modal animationType="fade" onRequestClose={() => setConfirmReset(false)} transparent visible={confirmReset}>
        <View style={s.modalBackdrop}>
          <View style={s.confirmSheet}>
            <View style={[s.confirmIcon, { backgroundColor: '#FEF3C7' }]}>
              <MaterialCommunityIcons name="refresh" size={26} color="#B45309" />
            </View>
            <Text style={s.confirmTitle}>Resetar checklist?</Text>
            <Text style={s.confirmSub}>
              As edições em andamento serão descartadas e {photos.length} foto(s) deste apartamento serão apagadas.
            </Text>
            <View style={s.confirmActions}>
              <Pressable onPress={() => setConfirmReset(false)} style={s.confirmBtnGhost}>
                <Text style={s.confirmBtnGhostText}>Cancelar</Text>
              </Pressable>
              <Pressable onPress={confirmResetNow} style={s.confirmBtnDanger}>
                <Text style={s.confirmBtnDangerText}>Resetar</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* MODAL: add catalog step to this apartment */}
      <Modal animationType="slide" onRequestClose={() => setAddStepOpen(false)} transparent visible={addStepOpen}>
        <Pressable style={s.modalBackdrop} onPress={() => setAddStepOpen(false)}>
          <Pressable style={s.addStepSheet} onPress={() => {}}>
            <View style={s.addStepGrabber} />
            <View style={s.addStepHeader}>
              <View style={s.addStepHeaderIcon}>
                <MaterialCommunityIcons name="playlist-plus" size={20} color="#2563EB" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.addStepTitle}>Adicionar etapa</Text>
                <Text style={s.addStepSub}>Escolha uma etapa do catálogo para incluir neste apartamento.</Text>
              </View>
              <Pressable onPress={() => setAddStepOpen(false)} hitSlop={8} style={s.addStepCloseBtn}>
                <MaterialCommunityIcons name="close" size={18} color="#64748B" />
              </Pressable>
            </View>
            <View style={s.addStepSearchWrap}>
              <MaterialCommunityIcons name="magnify" size={18} color="#94A3B8" />
              <TextInput
                autoFocus={Platform.OS !== 'web'}
                onChangeText={setAddStepSearch}
                placeholder="Buscar por nome ou categoria…"
                placeholderTextColor="#94A3B8"
                style={s.addStepSearchInput}
                value={addStepSearch}
              />
              {addStepSearch ? (
                <Pressable onPress={() => setAddStepSearch('')} hitSlop={6}>
                  <MaterialCommunityIcons name="close-circle" size={16} color="#94A3B8" />
                </Pressable>
              ) : null}
            </View>
            <View style={s.addStepAreaField}>
              <Text style={s.addStepAreaLabel}>Adicionar como</Text>
              <View style={s.addStepAreaRow}>
                <Pressable
                  onPress={() => setAddStepArea('Interior')}
                  style={[s.addStepAreaBtn, addStepArea === 'Interior' && s.addStepAreaBtnInt]}>
                  <MaterialCommunityIcons name="floor-plan" size={15} color={addStepArea === 'Interior' ? '#FFFFFF' : '#94A3B8'} />
                  <Text style={[s.addStepAreaBtnText, addStepArea === 'Interior' && s.addStepAreaBtnTextActive]}>Interior</Text>
                </Pressable>
                <Pressable
                  onPress={() => setAddStepArea('Exterior')}
                  style={[s.addStepAreaBtn, addStepArea === 'Exterior' && s.addStepAreaBtnExt]}>
                  <MaterialCommunityIcons name="domain" size={15} color={addStepArea === 'Exterior' ? '#FFFFFF' : '#94A3B8'} />
                  <Text style={[s.addStepAreaBtnText, addStepArea === 'Exterior' && s.addStepAreaBtnTextActive]}>Exterior</Text>
                </Pressable>
              </View>
            </View>
            <ScrollView style={s.addStepList} contentContainerStyle={{ gap: 20, paddingBottom: 12 }} showsVerticalScrollIndicator={false}>
              {availableStages.length === 0 ? (
                <View style={s.addStepEmpty}>
                  <MaterialCommunityIcons name="check-all" size={28} color="#CBD5E1" />
                  <Text style={s.addStepEmptyText}>
                    {addStepSearch ? 'Nenhuma etapa corresponde à busca' : 'Todas as etapas do catálogo já estão neste apartamento'}
                  </Text>
                </View>
              ) : (
                (() => {
                  const groups = new Map<string, typeof availableStages>();
                  for (const stg of availableStages) {
                    const cat = stg.categoria?.trim() || 'Sem categoria';
                    if (!groups.has(cat)) groups.set(cat, [] as any);
                    (groups.get(cat) as any).push(stg);
                  }
                  const searching = addStepSearch.trim().length > 0;
                  return [...groups.entries()]
                    .sort(([a], [b]) => a.localeCompare(b, 'pt-BR'))
                    .map(([cat, items]) => {
                      const color = categoryColor(cat);
                      const collapsed = !searching && collapsedAddStepGroups[cat] === true;
                      return (
                        <View key={`add-grp-${cat}`} style={s.addStepGroup}>
                          <Pressable
                            onPress={() => setCollapsedAddStepGroups((cur) => ({ ...cur, [cat]: !collapsed }))}
                            style={s.addStepGroupHeader}>
                            <MaterialCommunityIcons name={collapsed ? 'chevron-right' : 'chevron-down'} size={18} color="#64748B" />
                            <View style={[s.addStepGroupDot, { backgroundColor: color }]} />
                            <Text style={s.addStepGroupTitle}>{cat}</Text>
                            <Text style={s.addStepGroupCount}>{items.length}</Text>
                          </Pressable>
                          {!collapsed && items.map((stage) => (
                            <Pressable key={stage.id} onPress={() => addStepToApartment(stage.nome)} style={s.addStepItem} testID={`pick-stage-${stage.id}`}>
                              <View style={[s.addStepItemBullet, { backgroundColor: color }]} />
                              <View style={{ flex: 1 }}>
                                <Text style={s.addStepItemName}>{stage.nome}</Text>
                                {(stage.etapaCritica || stage.travaLiberacao) && (
                                  <View style={s.addStepBadgeRow}>
                                    {stage.etapaCritica && (
                                      <View style={[s.addStepBadge, { backgroundColor: '#FEE2E2' }]}>
                                        <Text style={[s.addStepBadgeText, { color: '#B91C1C' }]}>Crítica</Text>
                                      </View>
                                    )}
                                    {stage.travaLiberacao && (
                                      <View style={[s.addStepBadge, { backgroundColor: '#FEF3C7' }]}>
                                        <Text style={[s.addStepBadgeText, { color: '#B45309' }]}>Trava</Text>
                                      </View>
                                    )}
                                  </View>
                                )}
                              </View>
                              <View style={s.addStepPlusBtn}>
                                <MaterialCommunityIcons name="plus" size={18} color="#FFFFFF" />
                              </View>
                            </Pressable>
                          ))}
                        </View>
                      );
                    });
                })()
              )}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* WORKER ASSIGNMENT PICKER */}
      <Modal
        animationType="slide"
        transparent
        visible={!!workerPickerItem}
        onRequestClose={() => setWorkerPickerItem(null)}>
        <Pressable style={s.modalBackdrop} onPress={() => setWorkerPickerItem(null)}>
          <Pressable style={s.workerPickerSheet} onPress={() => {}}>
            <View style={s.workerPickerHandle} />
            <View style={s.workerPickerHeader}>
              <View style={{ flex: 1 }}>
                <Text style={s.workerPickerTitle}>Colaboradores</Text>
                {workerPickerItem && (
                  <Text style={s.workerPickerSub} numberOfLines={1}>{workerPickerItem.label}</Text>
                )}
              </View>
              <Pressable onPress={() => setWorkerPickerItem(null)} style={s.addStepCloseBtn}>
                <MaterialCommunityIcons name="close" size={18} color="#64748B" />
              </Pressable>
            </View>

            <View style={s.workerSearchWrap}>
              <MaterialCommunityIcons name="magnify" size={16} color="#94A3B8" />
              <TextInput
                onChangeText={setWorkerSearch}
                placeholder="Buscar colaborador…"
                placeholderTextColor="#94A3B8"
                style={s.workerSearchInput}
                value={workerSearch}
              />
            </View>

            <ScrollView style={s.workerList} showsVerticalScrollIndicator={false}>
              {workers.length === 0 ? (
                <View style={s.workerEmpty}>
                  <MaterialCommunityIcons name="account-off-outline" size={32} color="#CBD5E1" />
                  <Text style={s.workerEmptyText}>Nenhum colaborador cadastrado</Text>
                  <Text style={s.workerEmptySub}>Adicione na tela Catálogos → Colaboradores</Text>
                </View>
              ) : (
                workers
                  .filter((w) => {
                    const q = workerSearch.trim().toLocaleLowerCase('pt-BR');
                    return !q || w.nome.toLocaleLowerCase('pt-BR').includes(q) || w.funcao.toLocaleLowerCase('pt-BR').includes(q);
                  })
                  .map((w) => {
                    const selected = draftWorkerIds.includes(w.id);
                    return (
                      <Pressable key={w.id} onPress={() => toggleWorker(w.id)} style={[s.workerRow, selected && s.workerRowSelected]}>
                        <View style={[s.workerAvatar, { backgroundColor: selected ? '#6D28D9' : '#E2E8F0' }]}>
                          <Text style={[s.workerAvatarText, { color: selected ? '#FFFFFF' : '#64748B' }]}>
                            {w.nome.charAt(0).toUpperCase()}
                          </Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={s.workerName}>{w.nome}</Text>
                          <Text style={s.workerFuncao}>{w.funcao}</Text>
                        </View>
                        <MaterialCommunityIcons
                          name={selected ? 'checkbox-marked-circle' : 'checkbox-blank-circle-outline'}
                          size={22}
                          color={selected ? '#6D28D9' : '#CBD5E1'}
                        />
                      </Pressable>
                    );
                  })
              )}
            </ScrollView>

            <Pressable
              disabled={savingAssignment}
              onPress={saveWorkerAssignment}
              style={[s.workerSaveBtn, savingAssignment && { opacity: 0.6 }]}>
              <MaterialCommunityIcons name="content-save-outline" size={18} color="#FFFFFF" />
              <Text style={s.workerSaveBtnText}>
                {draftWorkerIds.length === 0
                  ? 'Salvar (sem colaboradores)'
                  : `Salvar ${draftWorkerIds.length} colaborador(es)`}
              </Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* BACK-TO-TOP FAB — appears after scrolling, sits above the save toast */}
      {showBackToTop && (
        <Pressable
          onPress={() => scrollRef.current?.scrollTo({ y: 0, animated: false })}
          style={[s.backToTopFab, { bottom: saveStatus !== 'idle' ? 80 : 24 }]}
          testID="back-to-top">
          <MaterialCommunityIcons name="chevron-up" size={22} color="#FFFFFF" />
        </Pressable>
      )}

      {/* SAVE TOAST — pinned above the tab bar, gives constant visual feedback */}
      {saveStatus !== 'idle' && (
        <Animated.View
          pointerEvents="none"
          style={[
            s.saveToast,
            saveStatus === 'saved' && s.saveToastSaved,
            saveStatus === 'error' && s.saveToastError,
            {
              opacity: toastAnim,
              transform: [{ translateY: toastAnim.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }],
            },
          ]}>
          <MaterialCommunityIcons
            name={saveStatus === 'saving' ? 'cloud-upload-outline' : saveStatus === 'saved' ? 'cloud-check' : 'cloud-alert'}
            size={16}
            color="#FFFFFF"
          />
          <Text style={s.saveToastText}>
            {saveStatus === 'saving' ? 'Salvando…' : saveStatus === 'saved' ? 'Salvo' : 'Erro ao salvar'}
          </Text>
        </Animated.View>
      )}
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
  header: { backgroundColor: '#4a5565', paddingHorizontal: 20, paddingBottom: 20, gap: 10 },
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
  tabBarWrap: { justifyContent: 'center' },
  tabBar: { flexDirection: 'row', gap: 6, paddingHorizontal: 16, paddingBottom: 2 },
  tabArrow: { position: 'absolute', top: '50%', marginTop: -15, width: 30, height: 30, borderRadius: 15, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E2E8F0', alignItems: 'center', justifyContent: 'center', shadowColor: '#0F172A', shadowOpacity: 0.12, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 3 },
  tabArrowLeft: { left: 8 },
  tabArrowRight: { right: 8 },
  tabBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 999, borderWidth: 1, borderColor: '#E2E8F0', backgroundColor: '#FFFFFF' },
  tabBtnActive: { backgroundColor: '#EFF6FF', borderColor: '#2563EB' },
  tabBtnText: { color: '#94A3B8', fontSize: 12, fontWeight: '700' },
  tabBtnTextActive: { color: '#2563EB' },
  tabBtnDisabled: { backgroundColor: '#F8FAFC', borderColor: '#E2E8F0', opacity: 0.6 },
  tabBtnTextDisabled: { color: '#CBD5E1' },

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
  // skeleton
  skelValue: { backgroundColor: '#E2E8F0', borderRadius: 8, height: 30, width: 54 },
  skelBadge: { backgroundColor: '#CBD5E1', borderRadius: 6, height: 14, width: 56 },
  skelLine: { backgroundColor: '#E2E8F0', borderRadius: 6, height: 13, width: '70%' as const },
  // observation
  obsPreview: { alignItems: 'center', backgroundColor: '#EFF6FF', borderColor: '#BFDBFE', borderRadius: 8, borderWidth: 1, flexDirection: 'row', gap: 8, paddingHorizontal: 10, paddingVertical: 8 },
  obsPreviewText: { color: '#1E40AF', flex: 1, fontSize: 12 },
  obsBox: { backgroundColor: '#F8FAFC', borderColor: '#E2E8F0', borderRadius: 10, borderWidth: 1, gap: 8, padding: 10 },
  obsTextarea: { borderColor: 'transparent', borderRadius: 6, borderWidth: 1, color: '#0F172A', fontSize: 13, minHeight: 72, textAlignVertical: 'top' },
  obsBoxFooter: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  obsBoxFooterRight: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  obsClearBtn: { alignItems: 'center', flexDirection: 'row', gap: 4 },
  obsClearBtnText: { color: '#B91C1C', fontSize: 12, fontWeight: '600' },
  obsCancelBtn: { backgroundColor: '#F1F5F9', borderColor: '#E2E8F0', borderWidth: 1, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 6 },
  obsCancelBtnText: { color: '#475569', fontSize: 12, fontWeight: '700' },
  obsDoneBtn: { backgroundColor: '#2563EB', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 6 },
  obsDoneBtnText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  // emergency
  emergencyPreview: { alignItems: 'center', backgroundColor: '#FEF2F2', borderColor: '#FECACA', borderRadius: 8, borderWidth: 1, flexDirection: 'row', gap: 8, paddingHorizontal: 10, paddingVertical: 8 },
  emergencyPreviewText: { color: '#DC2626', flex: 1, fontSize: 12, fontWeight: '600' },
  emergencyBox: { backgroundColor: '#F8FAFC', borderColor: '#E2E8F0', borderRadius: 10, borderWidth: 1, gap: 8, padding: 10 },
  emergencyTextarea: { borderColor: 'transparent', borderRadius: 6, borderWidth: 1, color: '#0F172A', fontSize: 13, minHeight: 72, textAlignVertical: 'top' },
  // card actions row
  cardActions: { borderTopColor: '#F1F5F9', borderTopWidth: 1, flexDirection: 'row', gap: 4, paddingTop: 8 },
  cardActionBtn: { alignItems: 'center', borderColor: '#E2E8F0', borderRadius: 8, borderWidth: 1, flexDirection: 'row', gap: 6, paddingHorizontal: 8, paddingVertical: 7, flex: 1, justifyContent: 'center' },
  cardActionBtnText: { color: '#64748B', fontSize: 11, fontWeight: '600' },

  // checklist
  checklistGroup: { gap: 10, paddingHorizontal: 16 },
  checklistGroupHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 4 },
  checklistGroupDot: { width: 10, height: 10, borderRadius: 5 },
  checklistGroupTitle: { color: '#0F172A', fontSize: 13, fontWeight: '800', flex: 1 },
  checklistGroupCount: { color: '#94A3B8', fontSize: 11, fontWeight: '600' },
  checklistHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, gap: 8 },
  checklistHeaderActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  checklistProgress: { color: '#475569', fontSize: 13, fontWeight: '700' },
  checklistAreaRow: { flexDirection: 'row', gap: 6, paddingHorizontal: 16, paddingBottom: 8 },
  checklistAreaBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 8, borderRadius: 10, backgroundColor: '#F1F5F9' },
  checklistAreaBtnExterior: { backgroundColor: '#FEF3C7' },
  checklistAreaBtnInterior: { backgroundColor: '#E0F2FE' },
  checklistAreaBtnText: { fontSize: 12, fontWeight: '700', color: '#94A3B8' },
  checklistAreaBtnTextExterior: { color: '#B45309' },
  checklistAreaBtnTextInterior: { color: '#0369A1' },
  addStepBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderColor: '#DBEAFE', backgroundColor: '#EFF6FF', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  addStepBtnText: { color: '#2563EB', fontSize: 11, fontWeight: '800' },
  resetBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  resetBtnText: { color: '#64748B', fontSize: 11, fontWeight: '700' },
  checkLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  extraBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#F5F3FF', borderColor: '#DDD6FE', borderWidth: 1, borderRadius: 999, paddingHorizontal: 6, paddingVertical: 2 },
  extraBadgeText: { color: '#7C3AED', fontSize: 10, fontWeight: '800', letterSpacing: 0.3 },
  addStepAreaField: { gap: 6, marginTop: 10 },
  addStepAreaLabel: { color: '#475569', fontSize: 12, fontWeight: '700' },
  addStepAreaRow: { flexDirection: 'row', gap: 8 },
  addStepAreaBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 11, borderRadius: 10, backgroundColor: '#F1F5F9' },
  addStepAreaBtnInt: { backgroundColor: '#0891B2' },
  addStepAreaBtnExt: { backgroundColor: '#D97706' },
  addStepAreaBtnText: { color: '#94A3B8', fontSize: 13, fontWeight: '700' },
  addStepAreaBtnTextActive: { color: '#FFFFFF' },
  removeStepBtn: { padding: 4 },
  checkCard: { backgroundColor: '#FFFFFF', borderColor: '#E2E8F0', borderWidth: 1, borderRadius: 14, borderLeftWidth: 4, padding: 14, gap: 12 },
  checkCardTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  checkIcon: { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  checkIconSymbol: { fontSize: 17, fontWeight: '900' },
  checkCardInfo: { flex: 1 },
  checkLabel: { color: '#0F172A', fontSize: 14, fontWeight: '700' },
  checkStatus: { fontSize: 12, fontWeight: '600', marginTop: 6 },
  checkPhotoCount: { color: '#64748B', fontSize: 11, marginTop: 3 },
  stateRow: { flexDirection: 'row', gap: 6 },
  checkCardLocked: { opacity: 0.75, backgroundColor: '#FFFBEB' },
  checkCardIndented: { marginLeft: 20, backgroundColor: '#F0F9FF', borderLeftColor: '#0891B2' },
  checkCardTopMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  menuDotsBtn: { padding: 4 },
  assignedWorkersBadge: { color: '#7C3AED', fontSize: 11, fontWeight: '700', marginTop: 2 },
  lockBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: '#FEF3C7', borderColor: '#FCD34D', borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  lockTitle: { color: '#92400E', fontSize: 12, fontWeight: '800', marginBottom: 2 },
  lockText: { color: '#B45309', fontSize: 12, fontWeight: '600' },

  // group step badge
  groupBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#E0F2FE', borderColor: '#BAE6FD', borderWidth: 1, borderRadius: 999, paddingHorizontal: 6, paddingVertical: 2 },
  groupBadgeText: { color: '#0891B2', fontSize: 10, fontWeight: '800', letterSpacing: 0.3 },

  // worker assignment picker
  workerPickerSheet: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '88%', paddingHorizontal: 20, paddingTop: 10, paddingBottom: 28, gap: 14 },
  workerPickerHandle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 999, backgroundColor: '#E2E8F0', marginBottom: 2 },
  workerPickerHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  workerPickerTitle: { color: '#0F172A', fontSize: 17, fontWeight: '900' },
  workerPickerSub: { color: '#64748B', fontSize: 12, marginTop: 2 },
  workerSearchWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#F8FAFC', borderColor: '#E2E8F0', borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, minHeight: 44 },
  workerSearchInput: { flex: 1, color: '#0F172A', fontSize: 13, paddingVertical: 10 },
  workerList: { maxHeight: 420 },
  workerEmpty: { alignItems: 'center', justifyContent: 'center', paddingVertical: 32, gap: 8 },
  workerEmptyText: { color: '#475569', fontSize: 14, fontWeight: '700' },
  workerEmptySub: { color: '#94A3B8', fontSize: 12, textAlign: 'center' },
  workerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderRadius: 12, paddingHorizontal: 4 },
  workerRowSelected: { backgroundColor: '#F5F3FF' },
  workerAvatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  workerAvatarText: { fontSize: 15, fontWeight: '900' },
  workerName: { color: '#0F172A', fontSize: 14, fontWeight: '700' },
  workerFuncao: { color: '#64748B', fontSize: 12, marginTop: 1 },
  workerSaveBtn: { backgroundColor: '#6D28D9', borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14 },
  workerSaveBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },

  // roadmap (sub-step progress line)
  roadmapTrack: { flexDirection: 'row', paddingTop: 2 },
  roadmapCell: { flex: 1, alignItems: 'center', gap: 6 },
  roadmapDotRow: { flexDirection: 'row', alignItems: 'center', width: '100%' },
  roadmapHalfLine: { flex: 1, height: 2 },
  roadmapDot: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  roadmapInnerDot: { width: 8, height: 8, borderRadius: 4 },
  roadmapCellLabel: { fontSize: 10, fontWeight: '700', textAlign: 'center', lineHeight: 13 },
  stateBtn: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 8, borderWidth: 1, borderColor: '#E2E8F0', backgroundColor: '#F8FAFC' },
  stateBtnText: { color: '#64748B', fontSize: 11, fontWeight: '700' },
  issueBox: { backgroundColor: '#FFFBEB', borderColor: '#FDE68A', borderRadius: 10, borderWidth: 1, padding: 12, gap: 10 },
  issueBoxTitle: { color: '#92400E', fontSize: 12, fontWeight: '800' },
  critRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  critBtn: { borderRadius: 8, borderWidth: 1, borderColor: '#CBD5E1', paddingHorizontal: 10, paddingVertical: 7, backgroundColor: '#FFFFFF' },
  critBtnText: { color: '#475569', fontSize: 12, fontWeight: '700' },
  photoBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: '#DBEAFE', backgroundColor: '#EFF6FF', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, alignSelf: 'flex-start' },
  photoBtnText: { color: '#2563EB', fontSize: 12, fontWeight: '700' },
  thumbGrid: { gap: 10 },
  thumbCard: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  thumbBody: { flex: 1, gap: 6 },
  thumb: { width: 100, height: 80, borderRadius: 8, backgroundColor: '#F1F5F9' },
  thumbOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: 'rgba(15,23,42,0.55)', borderRadius: 8 },
  thumbOverlayText: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },
  thumbBadge: { position: 'absolute', top: 4, right: 4, width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: '#047857' },
  thumbLabel: { color: '#64748B', fontSize: 11 },
  thumbInput: { backgroundColor: '#F8FAFC', borderColor: '#E2E8F0', borderRadius: 10, borderWidth: 1, color: '#0F172A', fontSize: 13, minHeight: 64, padding: 10, textAlignVertical: 'top' },
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

  // add-step modal
  addStepSheet: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '90%', paddingHorizontal: 22, paddingTop: 10, paddingBottom: 28, gap: 18 },
  addStepGrabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 999, backgroundColor: '#E2E8F0', marginBottom: 4 },
  addStepHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  addStepHeaderIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#EFF6FF' },
  addStepCloseBtn: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F1F5F9' },
  addStepTitle: { color: '#0F172A', fontSize: 17, fontWeight: '900' },
  addStepSub: { color: '#64748B', fontSize: 12, lineHeight: 17, marginTop: 2 },
  addStepSearchWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#F8FAFC', borderColor: '#E2E8F0', borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, minHeight: 44 },
  addStepSearchInput: { flex: 1, color: '#0F172A', fontSize: 13, paddingVertical: 10 },
  addStepList: { maxHeight: 480 },
  addStepEmpty: { alignItems: 'center', justifyContent: 'center', paddingVertical: 28, gap: 8 },
  addStepEmptyText: { color: '#64748B', fontSize: 13, textAlign: 'center' },
  addStepGroup: { gap: 14 },
  addStepGroupHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 4 },
  addStepGroupDot: { width: 10, height: 10, borderRadius: 5 },
  addStepGroupTitle: { color: '#0F172A', fontSize: 14, fontWeight: '800', flex: 1 },
  addStepGroupCount: { color: '#64748B', fontSize: 12, fontWeight: '700', backgroundColor: '#F1F5F9', borderRadius: 999, paddingHorizontal: 9, paddingVertical: 2, minWidth: 24, textAlign: 'center' },
  addStepItem: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 18, paddingRight: 16, paddingLeft: 0, borderRadius: 14, borderWidth: 1, borderColor: '#E2E8F0', backgroundColor: '#FFFFFF', overflow: 'hidden' },
  addStepItemBullet: { width: 5, alignSelf: 'stretch', backgroundColor: '#E2E8F0' },
  addStepItemName: { color: '#0F172A', fontSize: 15, fontWeight: '700', lineHeight: 20 },
  addStepBadgeRow: { flexDirection: 'row', gap: 6, marginTop: 6 },
  addStepBadge: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 },
  addStepBadgeText: { fontSize: 10, fontWeight: '800' },
  addStepPlusBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#2563EB', alignItems: 'center', justifyContent: 'center' },

  // confirm dialogs
  confirmSheet: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 22, gap: 12, alignItems: 'center' },
  confirmIcon: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  confirmTitle: { color: '#0F172A', fontSize: 17, fontWeight: '900', textAlign: 'center' },
  confirmSub: { color: '#475569', fontSize: 13, textAlign: 'center', lineHeight: 18 },
  confirmActions: { flexDirection: 'row', gap: 10, marginTop: 6, alignSelf: 'stretch' },
  confirmBtnGhost: { flex: 1, borderRadius: 12, borderWidth: 1, borderColor: '#E2E8F0', paddingVertical: 13, alignItems: 'center', backgroundColor: '#FFFFFF' },
  confirmBtnGhostText: { color: '#475569', fontSize: 14, fontWeight: '800' },
  confirmBtnDanger: { flex: 1, borderRadius: 12, paddingVertical: 13, alignItems: 'center', backgroundColor: '#B91C1C' },
  confirmBtnDangerText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },

  // back-to-top FAB
  backToTopFab: {
    position: 'absolute', right: 20, width: 44, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#64748B',
    shadowColor: '#000', shadowOpacity: 0.22, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 6,
  },

  // save toast — pinned above the bottom tab bar
  saveToast: {
    position: 'absolute', left: 24, right: 24, bottom: 24,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 10, paddingHorizontal: 18, borderRadius: 999,
    backgroundColor: '#0F172A',
    shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 4,
  },
  saveToastSaved: { backgroundColor: '#047857' },
  saveToastError: { backgroundColor: '#B91C1C' },
  saveToastText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800', letterSpacing: 0.2 },
});
