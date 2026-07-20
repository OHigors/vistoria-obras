import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Animated, Modal, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
// expo-image: cache em disco/memória (a Image do RN rebaixa a foto inteira toda vez).
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { preparePhotoForUpload } from '@/src/features/inspection/preparePhoto';
import { Text } from '@/src/ui/Text';

import * as db from '@/src/data/db';
import { getCachedTowerChecklist } from '@/src/data/checklistCache';
import { useObras } from '@/src/data/ObrasContext';
import { useObraScopeGuard } from '@/src/data/useObraScopeGuard';
import type { InspectionPhoto } from '@/src/data/localInspectionPhotos';
import type { InspectionVisit, VisitChecklistCounts } from '@/src/data/localInspectionVisits';
import { localResponsible } from '@/src/data/localInspectionVisits';
import type { ApartmentStatus, ChecklistState } from '@/src/data/mockObras';
import { getBlockedServiceGroups } from '@/src/data/serviceBlockers';
import { categoryOrderIndex, isCriticalStageForStatus } from '@/src/data/serviceStages';
import { formatDateBr, getScheduleRows, maskDateBr, type ScheduleFields } from '@/src/data/schedule';
import { getTowerLevel } from '@/src/data/towerLevels';
import { checklistConfig, getProgressMapStyle, statusConfig } from '@/src/ui/status';
import { computeApartmentStatus as calcStatus } from '@/src/data/apartmentStatus';
import { ReadOnlyBanner } from '@/src/ui/ReadOnlyBanner';
import { inspectionStyles as s } from '@/src/features/inspection/inspectionStyles';
import { useTutorialAnchor, useTutorialScreen } from '@/src/features/tutorial/TutorialContext';

type TowerItem = db.TowerChecklistItem;

const detailTabs = ['Resumo', 'Checklist', 'Em aberto', 'Fotos', 'Serviços', 'Cronograma', 'Medições', 'Histórico'] as const;
type DetailTab = (typeof detailTabs)[number];

const TAB_ICONS: Record<DetailTab, string> = {
  Resumo: 'view-dashboard-outline',
  Checklist: 'checkbox-marked-outline',
  'Em aberto': 'alert-circle-outline',
  Fotos: 'camera-outline',
  Serviços: 'hammer-wrench',
  Cronograma: 'calendar-clock',
  Medições: 'ruler',
  Histórico: 'history',
};

const progressOrder: ChecklistState[] = ['ok', 'partial', 'pending', 'notApplicable'];

const scheduleStatusStyles: Record<string, { background: string; color: string }> = {
  'No prazo': { background: '#DBEAFE', color: '#2563EB' },
  Atenção: { background: '#FEF3C7', color: '#B45309' },
  Atrasado: { background: '#FEE2E2', color: '#B91C1C' },
  Concluído: { background: '#D1FAE5', color: '#047857' },
};

const CATEGORY_PALETTE = ['#2563EB', '#7C3AED', '#0891B2', '#16A34A', '#D97706', '#DB2777', '#0EA5E9', '#65A30D', '#B45309', '#9333EA'];
const categoryColor = (cat: string) => {
  let hash = 0;
  for (let i = 0; i < cat.length; i++) hash = (hash * 31 + cat.charCodeAt(i)) >>> 0;
  return CATEGORY_PALETTE[hash % CATEGORY_PALETTE.length];
};

const todayBr = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
};

const formatPhotoDateTime = (value: string) =>
  new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));

const calcProgress = (list: { state: ChecklistState }[]) => {
  const score = list.reduce((t, i) => {
    if (i.state === 'ok' || i.state === 'notApplicable') return t + 1;
    if (i.state === 'partial') return t + 0.5;
    return t;
  }, 0);
  return list.length ? Math.round((score / list.length) * 100) : 0;
};

const getChecklistCounts = (list: { state: ChecklistState }[]): VisitChecklistCounts =>
  list.reduce<VisitChecklistCounts>((c, i) => ({ ...c, [i.state]: c[i.state] + 1 }), { notApplicable: 0, ok: 0, partial: 0, pending: 0 });
const sortVisitsDesc = (visits: InspectionVisit[]) =>
  [...visits].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
const getVariationColor = (v: number) => (v > 0 ? '#047857' : v < 0 ? '#B91C1C' : '#64748B');
const getVariationLabel = (v: number) => (v > 0 ? `+${v} p.p.` : v < 0 ? `${v} p.p.` : '0 p.p.');
// calcStatus vem de @/src/data/apartmentStatus (fórmula única compartilhada).

export default function NivelDaTorreScreen() {
  const { torreId, levelCode } = useLocalSearchParams<{ torreId: string; levelCode: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { getTowerById, serviceStages, canWrite } = useObras();

  const tower = getTowerById(torreId);
  const level = getTowerLevel(levelCode);
  // Trocou de obra? A torre desta URL não existe mais aqui — volta pra Visão Geral.
  useObraScopeGuard(Boolean(tower), '/visao-geral');

  const [items, setItems] = useState<TowerItem[]>([]);
  const [photos, setPhotos] = useState<InspectionPhoto[]>([]);
  const [loading, setLoading] = useState(true);

  // Tutorial: coach marks da primeira visita a um nível da torre.
  useTutorialScreen('nivel', Boolean(tower && level) && !loading);
  const etapasAnchor = useTutorialAnchor('nivel.etapas');
  const addStepAnchor = useTutorialAnchor('nivel.add');
  const [needsMigration, setNeedsMigration] = useState(false);
  const [activeTab, setActiveTab] = useState<DetailTab>('Resumo');
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [expandedComments, setExpandedComments] = useState<Record<string, boolean>>({});
  const [draftComments, setDraftComments] = useState<Record<string, string>>({});
  const [draftPhotoComments, setDraftPhotoComments] = useState<Record<string, string>>({});
  const [expandedEmergencies, setExpandedEmergencies] = useState<Record<string, boolean>>({});
  const [draftEmergencies, setDraftEmergencies] = useState<Record<string, string>>({});
  const [confirmRemove, setConfirmRemove] = useState<TowerItem | null>(null);
  const [confirmRemovePhoto, setConfirmRemovePhoto] = useState<string | null>(null);
  const [addStepOpen, setAddStepOpen] = useState(false);
  const [addStepSearch, setAddStepSearch] = useState('');
  const [collapsedAddStepGroups, setCollapsedAddStepGroups] = useState<Record<string, boolean>>({});
  const [photoPickerTarget, setPhotoPickerTarget] = useState<string | null>(null);
  const [selectedPhoto, setSelectedPhoto] = useState<InspectionPhoto | null>(null);
  const [uploadStatus, setUploadStatus] = useState<Record<string, 'uploading'>>({});
  const [visits, setVisits] = useState<InspectionVisit[]>([]);
  const [selectedVisit, setSelectedVisit] = useState<InspectionVisit | null>(null);
  const draftCommentsRef = useRef<Record<string, string>>({});
  const draftEmergenciesRef = useRef<Record<string, string>>({});

  const tabScrollRef = useRef<ScrollView | null>(null);
  const tabScrollX = useRef(0);
  const tabLayoutW = useRef(0);
  const tabContentW = useRef(0);
  const [tabArrows, setTabArrows] = useState({ left: false, right: false });
  const updateTabArrows = useCallback((x: number) => {
    tabScrollX.current = x;
    const left = x > 4;
    const right = x + tabLayoutW.current < tabContentW.current - 4;
    setTabArrows((cur) => (cur.left === left && cur.right === right ? cur : { left, right }));
  }, []);
  const scrollTabsBy = useCallback((delta: number) => {
    tabScrollRef.current?.scrollTo({ x: Math.max(0, tabScrollX.current + delta), animated: true });
  }, []);

  const loadItems = useCallback(async () => {
    if (!torreId || !levelCode) return;
    // Stale-while-revalidate: o Corte acabou de baixar o checklist da torre —
    // pinta com ele na hora e atualiza por baixo (skeleton só sem cache).
    const cached = getCachedTowerChecklist(torreId);
    if (cached) {
      setItems(cached.filter((i) => i.levelCode === levelCode));
      setLoading(false);
    } else {
      setLoading(true);
    }
    try {
      const all = await db.loadTowerChecklist(torreId);
      setItems(all.filter((i) => i.levelCode === levelCode));
      setNeedsMigration(false);
    } catch (e) {
      if (db.isMissingTowerColumns(e)) setNeedsMigration(true);
    } finally {
      setLoading(false);
    }
    db.loadTowerPhotos(torreId, levelCode).then(setPhotos).catch(() => {});
    db.loadTowerVisits(torreId, levelCode).then(setVisits).catch(() => {});
  }, [torreId, levelCode]);

  useFocusEffect(useCallback(() => { loadItems(); }, [loadItems]));

  // ── aggregations ──────────────────────────────────────────────────────────
  const progress = calcProgress(items);
  const okCount = items.filter((i) => i.state === 'ok' || i.state === 'notApplicable').length;
  const pendingItems = items.filter((i) => i.state === 'pending' || i.state === 'partial');
  const blockedGroups = getBlockedServiceGroups(items);
  const totalBlocked = blockedGroups.reduce((t, g) => t + g.blockedServices.length, 0);
  const scheduleRows = getScheduleRows(items);

  const openVisit = visits.find((v) => !v.finalized);
  const finalizedVisits = sortVisitsDesc(visits.filter((v) => v.finalized));
  const latestVisit = openVisit ?? finalizedVisits[0];
  const firstVisit = sortVisitsDesc(visits).at(-1);
  const previousProgress = latestVisit?.progressBefore ?? finalizedVisits[1]?.progressAfter ?? progress;
  const unitProgressVariation = progress - previousProgress;

  const categoryByLabel = useMemo(() => {
    const map = new Map<string, string>();
    for (const st of serviceStages) map.set(st.nome, st.categoria?.trim() || 'Sem categoria');
    return map;
  }, [serviceStages]);

  const checklistGroups = useMemo(() => {
    const map = new Map<string, TowerItem[]>();
    for (const item of items) {
      const cat = categoryByLabel.get(item.label) || 'Sem categoria';
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(item);
    }
    return [...map.entries()].sort(
      ([a], [b]) => categoryOrderIndex(a) - categoryOrderIndex(b) || a.localeCompare(b, 'pt-BR'),
    );
  }, [items, categoryByLabel]);

  const availableStages = useMemo(() => {
    const existing = new Set(items.map((i) => i.label));
    const q = addStepSearch.trim().toLocaleLowerCase('pt-BR');
    return serviceStages
      .filter((st) => st.ativo && st.apareceNoChecklist && !existing.has(st.nome))
      .filter((st) => !q || st.nome.toLocaleLowerCase('pt-BR').includes(q) || st.categoria.toLocaleLowerCase('pt-BR').includes(q))
      .sort((a, b) => a.ordemExecucao - b.ordemExecucao);
  }, [serviceStages, items, addStepSearch]);

  const photosByServiceId = useMemo(() => {
    const g: Record<string, InspectionPhoto[]> = {};
    for (const p of photos) g[p.serviceId] = [...(g[p.serviceId] ?? []), p];
    return g;
  }, [photos]);

  // ── persistence ───────────────────────────────────────────────────────────
  const persistItem = useCallback((item: TowerItem, revertTo: TowerItem[]) => {
    if (!canWrite || !torreId) return;
    db.upsertTowerChecklistItem({ ...item, towerId: torreId, levelCode: item.levelCode }).catch(() => setItems(revertTo));
  }, [canWrite, torreId]);

  // Mantém a visita aberta em dia sempre que uma etapa muda de estado.
  const registerVisitUpdate = (nextItems: TowerItem[], changedItemId?: string) => {
    if (!torreId || !levelCode) return;
    setVisits((cur) => {
      const open = cur.find((v) => !v.finalized);
      if (!open) return cur;
      const nextProgress = calcProgress(nextItems);
      const issueIds = nextItems.filter((i) => i.state === 'pending' || i.state === 'partial').map((i) => i.id);
      const statusAfter = calcStatus(nextItems, nextProgress);
      const updated: InspectionVisit = {
        ...open,
        progressAfter: nextProgress, percentualDepois: nextProgress,
        evolution: nextProgress - open.progressBefore, evolucao: nextProgress - open.progressBefore,
        counts: getChecklistCounts(nextItems), statusAfter, statusFinal: statusAfter,
        quantidadePendencias: issueIds.length, issueItemIds: issueIds,
        changedItemIds: changedItemId ? [...new Set([...(open.changedItemIds ?? []), changedItemId])] : open.changedItemIds,
      };
      db.saveTowerVisit(updated, torreId, levelCode).catch(() => {});
      return cur.map((v) => (v.id === open.id ? updated : v));
    });
  };

  const startNewVisit = () => {
    if (!canWrite || !torreId || !levelCode || visits.some((v) => !v.finalized)) return;
    const now = new Date().toISOString();
    const statusAfter = calcStatus(items, progress);
    const issueIds = pendingItems.map((i) => i.id);
    const newVisit: InspectionVisit = {
      id: crypto.randomUUID(), apartmentId: '', apartamentoId: '',
      date: now, startedAt: now, dataInicio: now,
      responsible: localResponsible, responsavel: localResponsible,
      progressBefore: progress, percentualAntes: progress, progressAfter: progress, percentualDepois: progress,
      evolution: 0, evolucao: 0, counts: getChecklistCounts(items),
      photosAdded: 0, quantidadeFotos: 0, quantidadePendencias: issueIds.length,
      statusAfter, statusFinal: statusAfter, generalNote: '', observacaoGeral: '',
      changedItemIds: [], addedPhotoIds: [], issueItemIds: issueIds, finalized: false,
    };
    setVisits((cur) => [...cur, newVisit]);
    db.saveTowerVisit(newVisit, torreId, levelCode).catch(() => {});
  };

  const finishVisit = () => {
    if (!canWrite || !torreId || !levelCode) return;
    setVisits((cur) => {
      const open = cur.find((v) => !v.finalized);
      if (!open) return cur;
      const now = new Date().toISOString();
      const statusAfter = calcStatus(items, progress);
      const finalized: InspectionVisit = {
        ...open, date: now, finalized: true, finalizedAt: now,
        progressAfter: progress, percentualDepois: progress,
        evolution: progress - open.progressBefore, evolucao: progress - open.progressBefore,
        counts: getChecklistCounts(items), quantidadePendencias: pendingItems.length,
        statusAfter, statusFinal: statusAfter, issueItemIds: pendingItems.map((i) => i.id),
      };
      db.saveTowerVisit(finalized, torreId, levelCode).catch(() => {});
      return cur.map((v) => (v.id === open.id ? finalized : v));
    });
  };

  // Toast de conclusão (etapa movida para o fim da lista) — dura um pouco mais.
  const [movedToast, setMovedToast] = useState(false);
  const movedAnim = useRef(new Animated.Value(0)).current;
  const movedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showMovedToast = useCallback(() => {
    setMovedToast(true);
    Animated.timing(movedAnim, { toValue: 1, duration: 180, useNativeDriver: true }).start();
    if (movedTimerRef.current) clearTimeout(movedTimerRef.current);
    movedTimerRef.current = setTimeout(() => {
      Animated.timing(movedAnim, { toValue: 0, duration: 220, useNativeDriver: true }).start(() => setMovedToast(false));
    }, 3400);
  }, [movedAnim]);

  const updateItemStatus = (itemId: string, next: ChecklistState) => {
    if (!canWrite) return; // viewer: sem escrita (o banco também bloqueia)
    const prev = items;
    const target = prev.find((i) => i.id === itemId);
    if (!target) return;
    const stamped: TowerItem = {
      ...target, state: next,
      actualStart: (next === 'partial' || next === 'ok') && !target.actualStart ? todayBr() : target.actualStart,
      actualEnd: next === 'ok' ? target.actualEnd ?? todayBr() : undefined,
    };
    const nextItems = prev.map((i) => (i.id === itemId ? stamped : i));
    setItems(nextItems);
    persistItem(stamped, prev);
    registerVisitUpdate(nextItems, itemId);
    if (next === 'ok' && target.state !== 'ok') showMovedToast();
  };

  const addStepToLevel = async (nome: string, ordemExecucao: number) => {
    if (!canWrite || !torreId || !levelCode) return;
    setAddStepOpen(false);
    setAddStepSearch('');
    try {
      const item = await db.addTowerChecklistItem({ towerId: torreId, levelCode, label: nome, sortOrder: ordemExecucao });
      setItems((cur) => (cur.some((i) => i.id === item.id) ? cur : [...cur, item]));
    } catch {}
  };

  const removeStepNow = () => {
    if (!canWrite) return;
    const target = confirmRemove;
    setConfirmRemove(null);
    if (!target) return;
    const prev = items;
    setItems((cur) => cur.filter((i) => i.id !== target.id));
    db.deleteChecklistItem(target.id).catch(() => setItems(prev));
  };

  const openComment = (itemId: string, current: string) => {
    if (!canWrite) return;
    draftCommentsRef.current[itemId] = current;
    setDraftComments((cur) => ({ ...cur, [itemId]: current }));
    setExpandedComments((cur) => ({ ...cur, [itemId]: true }));
  };
  const closeComment = (itemId: string, save = false) => {
    if (save) {
      const comment = (draftCommentsRef.current[itemId] ?? '').trim();
      const prev = items;
      const target = prev.find((i) => i.id === itemId);
      if (target) {
        const updated = { ...target, comment };
        setItems((cur) => cur.map((i) => (i.id === itemId ? updated : i)));
        persistItem(updated, prev);
      }
    }
    setExpandedComments((cur) => ({ ...cur, [itemId]: false }));
  };

  const openEmergency = (itemId: string, current: string) => {
    if (!canWrite) return;
    draftEmergenciesRef.current[itemId] = current;
    setDraftEmergencies((cur) => ({ ...cur, [itemId]: current }));
    setExpandedEmergencies((cur) => ({ ...cur, [itemId]: true }));
  };
  const closeEmergency = (itemId: string, save = false) => {
    if (save) {
      const emergency = (draftEmergenciesRef.current[itemId] ?? '').trim();
      const prev = items;
      const target = prev.find((i) => i.id === itemId);
      if (target) {
        const updated = { ...target, emergency };
        setItems((cur) => cur.map((i) => (i.id === itemId ? updated : i)));
        persistItem(updated, prev);
      }
    }
    setExpandedEmergencies((cur) => ({ ...cur, [itemId]: false }));
  };

  const updateItemSchedule = (item: TowerItem, field: keyof ScheduleFields, value: string) => {
    const masked = maskDateBr(value);
    const prev = items;
    const updated = { ...item, [field]: masked } as TowerItem;
    setItems((cur) => cur.map((i) => (i.id === item.id ? updated : i)));
    if (masked.length === 0 || masked.length === 10) persistItem(updated, prev);
  };

  // ── photos ────────────────────────────────────────────────────────────────
  const updatePhotoComment = (photoId: string, comment: string) => {
    setPhotos((cur) => cur.map((p) => (p.id === photoId ? { ...p, comment, comentarioFoto: comment } : p)));
    const target = photos.find((p) => p.id === photoId);
    if (target) db.savePhoto({ ...target, comment, comentarioFoto: comment }).catch(() => {});
  };

  // Comentário da foto: edita um rascunho e só grava no "Salvar" (evita 1 escrita
  // por tecla, que causava erros). "Cancelar" descarta o rascunho.
  const savePhotoComment = (photoId: string) => {
    if (!canWrite) return;
    const value = draftPhotoComments[photoId] ?? photos.find((p) => p.id === photoId)?.comment ?? '';
    updatePhotoComment(photoId, value);
    setDraftPhotoComments((cur) => { const n = { ...cur }; delete n[photoId]; return n; });
  };
  const cancelPhotoComment = (photoId: string) => {
    setDraftPhotoComments((cur) => { const n = { ...cur }; delete n[photoId]; return n; });
  };

  const handlePickImage = async (source: 'camera' | 'gallery') => {
    if (!canWrite) return;
    const itemId = photoPickerTarget;
    setPhotoPickerTarget(null);
    if (!itemId || !tower || !levelCode) return;
    const item = items.find((i) => i.id === itemId);
    if (!item) return;
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
    // Limita o maior lado (1600px) e re-encoda — o re-encode também remove o EXIF.
    const stripped = await preparePhotoForUpload(pickedUri, asset.width, asset.height);
    const localUri = stripped.uri;
    const createdAt = new Date().toISOString();
    const fileName = asset.fileName ?? `foto-${Date.now()}.jpg`;
    const photoId = crypto.randomUUID();
    // Prefixo obra_id/ → as políticas de Storage escopam o acesso por obra.
    const storagePath = `${tower.obraId}/torre/${tower.id}/${levelCode}/${item.id}/${photoId}.jpg`;
    const optimistic: InspectionPhoto = {
      id: photoId, towerId: tower.id, apartmentId: '', itemId: item.id, serviceId: item.id,
      service: item.label, uri: localUri, storagePath: '', fileName,
      createdAt, dataHora: createdAt, comment: '', comentarioFoto: '', visitId: undefined,
    };
    setPhotos((cur) => [optimistic, ...cur]);
    setUploadStatus((u) => ({ ...u, [photoId]: 'uploading' }));
    try {
      await db.uploadInspectionPhoto(localUri, storagePath, 'image/jpeg');
      const signedUrl = await db.getInspectionPhotoUrl(storagePath);
      const persisted = { ...optimistic, uri: signedUrl, storagePath };
      await db.saveTowerPhoto(persisted, levelCode);
      setPhotos((cur) => cur.map((p) => (p.id === photoId ? persisted : p)));
      setUploadStatus((u) => { const n = { ...u }; delete n[photoId]; return n; });
    } catch {
      setPhotos((cur) => cur.filter((p) => p.id !== photoId));
      setUploadStatus((u) => { const n = { ...u }; delete n[photoId]; return n; });
    }
  };

  const removePhoto = (photoId: string) => {
    if (!canWrite) return;
    setPhotos((cur) => cur.filter((p) => p.id !== photoId));
    setSelectedPhoto((cur) => (cur?.id === photoId ? null : cur));
    db.deletePhoto(photoId).catch(() => {});
  };

  if (!tower || !level) {
    return (
      <View style={[s.empty, { paddingTop: insets.top + 16 }]}>
        <Pressable onPress={() => router.push(`/visao-geral/corte/${torreId}` as never)} style={s.emptyBack}>
          <MaterialCommunityIcons name="chevron-left" size={28} color="#0F172A" />
          <Text style={s.emptyBackText}>Voltar</Text>
        </Pressable>
        <View style={s.emptyCenter}>
          <MaterialCommunityIcons name={loading ? 'progress-clock' : 'home-alert-outline'} size={48} color="#CBD5E1" />
          <Text style={s.emptyTitle}>{loading ? 'Carregando nível…' : 'Nível não encontrado'}</Text>
        </View>
      </View>
    );
  }

  const headerColor = getProgressMapStyle(progress).fg;
  const kicker = [tower.name, tower.block].filter(Boolean).join(' · ');

  const kpis = [
    { icon: 'clipboard-list-outline', value: pendingItems.length, label: 'Em aberto', color: '#4a5565' },
    { icon: 'lock-outline', value: totalBlocked, label: 'Travados', color: '#B45309' },
    { icon: 'camera-outline', value: photos.length, label: 'Fotos', color: '#2563EB' },
    { icon: 'ruler', value: 0, label: 'Medições', color: '#7C3AED' },
  ];

  return (
    <>
      <ScrollView contentContainerStyle={s.container} showsVerticalScrollIndicator={false}>
        {/* STATUS HEADER */}
        <View style={[s.header, { paddingTop: insets.top + 12, backgroundColor: headerColor }]}>
          <Pressable onPress={() => router.push(`/visao-geral/corte/${torreId}` as never)} style={s.headerBack}>
            <MaterialCommunityIcons name="chevron-left" size={26} color="rgba(255,255,255,0.9)" />
            <Text style={s.headerBackText}>Corte da torre</Text>
          </Pressable>
          <View style={s.headerRow}>
            <View style={s.headerInfo}>
              <Text style={s.headerKicker}>{kicker}</Text>
              <Text style={s.headerAptNumber}>{level.label}</Text>
            </View>
            <View style={s.headerProgressCircle}>
              <Text style={s.headerProgressValue}>{progress}%</Text>
              <Text style={s.headerProgressLabel}>vistoriado</Text>
            </View>
          </View>
          <View style={s.headerBar}>
            <View style={[s.headerBarFill, { width: `${progress}%` as `${number}%` }]} />
          </View>
          <View style={s.headerMeta} {...etapasAnchor}>
            <View style={s.headerMetaItem}>
              <MaterialCommunityIcons name="checkbox-marked-circle-outline" size={13} color="rgba(255,255,255,0.8)" />
              <Text style={s.headerMetaText}>{okCount} de {items.length} etapas concluídas</Text>
            </View>
          </View>
        </View>

        {!canWrite && <ReadOnlyBanner />}

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
            {canWrite && (
              <Pressable onPress={finishVisit} style={s.visitFinishBtn}>
                <Text style={s.visitFinishBtnText}>Finalizar</Text>
              </Pressable>
            )}
          </View>
        ) : canWrite ? (
          <Pressable onPress={startNewVisit} style={s.visitBannerNew}>
            <MaterialCommunityIcons name="plus-circle-outline" size={18} color="#2563EB" />
            <Text style={s.visitBannerNewText}>
              {finalizedVisits.length > 0 ? `${finalizedVisits.length} visita(s) · Iniciar nova` : 'Iniciar primeira visita'}
            </Text>
          </Pressable>
        ) : null}

        {/* KPI ROW */}
        <View style={s.kpiRow}>
          {kpis.map((k) => (
            <View key={k.label} style={s.kpiCard}>
              <MaterialCommunityIcons name={k.icon as never} size={20} color={k.color} />
              <Text style={[s.kpiValue, { color: k.color }]}>{k.value}</Text>
              <Text style={s.kpiLabel}>{k.label}</Text>
            </View>
          ))}
        </View>

        {/* TAB BAR */}
        <View style={s.tabBarWrap}>
          <ScrollView
            ref={tabScrollRef} horizontal showsHorizontalScrollIndicator={false}
            contentContainerStyle={s.tabBar} scrollEventThrottle={32}
            onLayout={(e) => { tabLayoutW.current = e.nativeEvent.layout.width; updateTabArrows(tabScrollX.current); }}
            onContentSizeChange={(w) => { tabContentW.current = w; updateTabArrows(tabScrollX.current); }}
            onScroll={(e) => updateTabArrows(e.nativeEvent.contentOffset.x)}>
            {detailTabs.map((tab) => {
              const active = activeTab === tab;
              return (
                <Pressable key={tab} onPress={() => setActiveTab(tab)} style={[s.tabBtn, active && s.tabBtnActive]}>
                  <MaterialCommunityIcons name={TAB_ICONS[tab] as never} size={14} color={active ? '#2563EB' : '#94A3B8'} />
                  <Text style={[s.tabBtnText, active && s.tabBtnTextActive]}>{tab}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
          {tabArrows.left && (
            <Pressable onPress={() => scrollTabsBy(-160)} style={[s.tabArrow, s.tabArrowLeft]} hitSlop={6}>
              <MaterialCommunityIcons name="chevron-left" size={20} color="#64748B" />
            </Pressable>
          )}
          {tabArrows.right && (
            <Pressable onPress={() => scrollTabsBy(160)} style={[s.tabArrow, s.tabArrowRight]} hitSlop={6}>
              <MaterialCommunityIcons name="chevron-right" size={20} color="#64748B" />
            </Pressable>
          )}
        </View>

        {needsMigration && (
          <View style={s.alertBox}><Text style={s.alertText}>Banco ainda sem etapas de torre. Aplique a migração 20260703000000_tower_checklist.sql.</Text></View>
        )}

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
                  <Text style={[s.evoValue, { color: headerColor }]}>{progress}%</Text>
                  <Text style={s.evoLabel}>Atual</Text>
                </View>
                <View style={[s.evoBadge, { backgroundColor: unitProgressVariation >= 0 ? '#D1FAE5' : '#FEE2E2' }]}>
                  <MaterialCommunityIcons name={unitProgressVariation >= 0 ? 'trending-up' : 'trending-down'} size={13} color={getVariationColor(unitProgressVariation)} />
                  <Text style={[s.evoBadgeText, { color: getVariationColor(unitProgressVariation) }]}>{getVariationLabel(unitProgressVariation)}</Text>
                </View>
              </View>
              <View style={s.evoMeta}>
                <Text style={s.evoMetaText}><Text style={s.evoMetaBold}>Visitas:</Text> {visits.length}</Text>
                <Text style={s.evoMetaText}><Text style={s.evoMetaBold}>Primeira:</Text> {firstVisit ? formatPhotoDateTime(firstVisit.date) : '—'}</Text>
                <Text style={s.evoMetaText}><Text style={s.evoMetaBold}>Última:</Text> {latestVisit ? formatPhotoDateTime(latestVisit.date) : '—'}</Text>
              </View>
            </View>

            {pendingItems.length === 0 ? (
              <View style={[s.card, s.cardCentered]}>
                <MaterialCommunityIcons name="check-circle" size={32} color="#047857" />
                <Text style={s.allClear}>Nada em aberto</Text>
              </View>
            ) : (
              <View style={s.card}>
                <Text style={s.cardTitle}>Itens em aberto ({pendingItems.length})</Text>
                {pendingItems.slice(0, 5).map((item) => {
                  const cfg = checklistConfig[item.state];
                  return (
                    <View key={`r-${item.id}`} style={s.pendingRow}>
                      <View style={[s.pendingDot, { backgroundColor: cfg.color }]} />
                      <Text style={s.pendingLabel} numberOfLines={1}>{item.label}</Text>
                      <Text style={[s.pendingCrit, { color: '#64748B' }]}>{cfg.label}</Text>
                    </View>
                  );
                })}
                {pendingItems.length > 5 && <Text style={s.moreText}>+{pendingItems.length - 5} na aba Em aberto</Text>}
              </View>
            )}
          </>
        )}

        {/* ── CHECKLIST ── */}
        {activeTab === 'Checklist' && (
          <>
            <View style={s.checklistHeader}>
              <Text style={s.checklistProgress}>{okCount} / {items.length} concluídos</Text>
              <View style={s.checklistHeaderActions}>
                {canWrite && (
                  <Pressable {...addStepAnchor} onPress={() => { setAddStepSearch(''); setAddStepOpen(true); }} style={s.addStepBtn}>
                    <MaterialCommunityIcons name="plus-circle-outline" size={14} color="#2563EB" />
                    <Text style={s.addStepBtnText}>Adicionar etapa</Text>
                  </Pressable>
                )}
              </View>
            </View>

            {checklistGroups.map(([cat, groupItems]) => {
              const color = categoryColor(cat);
              const collapsed = collapsedGroups[cat] === true;
              const okInGroup = groupItems.filter((i) => i.state === 'ok' || i.state === 'notApplicable').length;
              // Só as etapas concluídas (ok) descem para o fim; as demais mantêm a
              // ordem original (sort estável), então outras mudanças não reordenam.
              const orderedItems = [...groupItems].sort((a, b) => (a.state === 'ok' ? 1 : 0) - (b.state === 'ok' ? 1 : 0));
              return (
                <View key={`chk-grp-${cat}`} style={s.checklistGroup}>
                  <Pressable onPress={() => setCollapsedGroups((cur) => ({ ...cur, [cat]: !collapsed }))} style={s.checklistGroupHeader}>
                    <MaterialCommunityIcons name={collapsed ? 'chevron-right' : 'chevron-down'} size={18} color="#64748B" />
                    <View style={[s.checklistGroupDot, { backgroundColor: color }]} />
                    <Text style={s.checklistGroupTitle}>{cat}</Text>
                    <Text style={s.checklistGroupCount}>{okInGroup}/{groupItems.length} OK</Text>
                  </Pressable>
                  {!collapsed && orderedItems.map((item) => {
                    const cfg = checklistConfig[item.state];
                    const itemPhotos = photosByServiceId[item.id] ?? [];
                    return (
                      <View key={item.id} style={[s.checkCard, { borderLeftColor: cfg.color }]}>
                        <View style={s.checkCardTop}>
                          <View style={[s.checkIcon, { backgroundColor: cfg.background }]}>
                            {cfg.icon
                              ? <MaterialCommunityIcons name={cfg.icon} size={16} color={cfg.color} />
                              : <Text style={[s.checkIconSymbol, { color: cfg.color }]}>{cfg.abbrev}</Text>}
                          </View>
                          <View style={s.checkCardInfo}>
                            <View style={s.checkLabelRow}>
                              <Text style={s.checkLabel}>{item.label}</Text>
                            </View>
                            {itemPhotos.length > 0 && <Text style={s.checkPhotoCount}>· {itemPhotos.length} foto(s)</Text>}
                          </View>
                          {canWrite && (
                            <Pressable onPress={() => setConfirmRemove(item)} style={s.removeStepBtn} hitSlop={8}>
                              <MaterialCommunityIcons name="close" size={16} color="#94A3B8" />
                            </Pressable>
                          )}
                        </View>

                        {canWrite ? (
                          <View style={s.statusBtnRow}>
                            {progressOrder.map((opt) => {
                              const oc = checklistConfig[opt];
                              const sel = item.state === opt;
                              return (
                                <Pressable
                                  key={opt}
                                  onPress={() => updateItemStatus(item.id, opt)}
                                  accessibilityRole="button"
                                  accessibilityState={{ selected: sel }}
                                  accessibilityLabel={oc.label}
                                  style={[s.statusBtn, sel && { backgroundColor: oc.background, borderColor: oc.color }]}>
                                  <Text style={[s.statusBtnLabel, { color: sel ? oc.color : '#64748B' }]} numberOfLines={2}>{oc.label}</Text>
                                </Pressable>
                              );
                            })}
                          </View>
                        ) : (
                          <View style={[s.statusReadOnly, { backgroundColor: checklistConfig[item.state].background, borderColor: checklistConfig[item.state].color }]}>
                            {checklistConfig[item.state].icon
                              ? <MaterialCommunityIcons name={checklistConfig[item.state].icon!} size={13} color={checklistConfig[item.state].color} />
                              : <Text style={[s.statusReadOnlyText, { color: checklistConfig[item.state].color }]}>{checklistConfig[item.state].abbrev}</Text>}
                            <Text style={[s.statusReadOnlyText, { color: checklistConfig[item.state].color }]}>{checklistConfig[item.state].label}</Text>
                          </View>
                        )}

                        {item.emergency?.trim() && !expandedEmergencies[item.id] && (
                          <Pressable onPress={() => openEmergency(item.id, item.emergency ?? '')} style={s.emergencyPreview}>
                            <MaterialCommunityIcons name="alert" size={13} color="#DC2626" />
                            <Text style={s.emergencyPreviewText} numberOfLines={2}>{item.emergency}</Text>
                            <MaterialCommunityIcons name="pencil-outline" size={13} color="#94A3B8" />
                          </Pressable>
                        )}
                        {expandedEmergencies[item.id] && (
                          <View style={s.emergencyBox}>
                            <TextInput
                              multiline
                              onChangeText={(v) => { draftEmergenciesRef.current[item.id] = v; setDraftEmergencies((cur) => ({ ...cur, [item.id]: v })); }}
                              placeholder="Descreva a emergência..." placeholderTextColor="#94A3B8"
                              style={s.emergencyTextarea} value={draftEmergencies[item.id] ?? ''} />
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
                          <Pressable onPress={() => openComment(item.id, item.comment ?? '')} style={s.obsPreview}>
                            <MaterialCommunityIcons name="note-text-outline" size={13} color="#2563EB" />
                            <Text style={s.obsPreviewText} numberOfLines={2}>{item.comment}</Text>
                            <MaterialCommunityIcons name="pencil-outline" size={13} color="#94A3B8" />
                          </Pressable>
                        )}
                        {expandedComments[item.id] && (
                          <View style={s.obsBox}>
                            <TextInput
                              multiline
                              onChangeText={(v) => { draftCommentsRef.current[item.id] = v; setDraftComments((cur) => ({ ...cur, [item.id]: v })); }}
                              placeholder="Adicione uma observação..." placeholderTextColor="#94A3B8"
                              style={s.obsTextarea} value={draftComments[item.id] ?? ''} />
                            <View style={s.obsBoxFooter}>
                              <View />
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

                        {canWrite && (
                          <View style={s.cardActions}>
                            <Pressable
                              onPress={() => expandedEmergencies[item.id] ? closeEmergency(item.id, false) : openEmergency(item.id, item.emergency ?? '')}
                              style={s.cardActionBtn}>
                              <MaterialCommunityIcons name="alert-outline" size={15} color="#64748B" />
                              <Text style={s.cardActionBtnText}>Emergência</Text>
                            </Pressable>
                            <Pressable
                              onPress={() => expandedComments[item.id] ? closeComment(item.id, false) : openComment(item.id, item.comment ?? '')}
                              style={s.cardActionBtn}>
                              <MaterialCommunityIcons name="note-plus-outline" size={15} color="#64748B" />
                              <Text style={s.cardActionBtnText}>Observação</Text>
                            </Pressable>
                            <Pressable onPress={() => setPhotoPickerTarget(item.id)} style={s.cardActionBtn}>
                              <MaterialCommunityIcons name="camera-plus-outline" size={15} color="#64748B" />
                              <Text style={s.cardActionBtnText}>{itemPhotos.length > 0 ? `Fotos (${itemPhotos.length})` : 'Foto'}</Text>
                            </Pressable>
                          </View>
                        )}

                        {itemPhotos.length > 0 && (
                          <View style={s.thumbGrid}>
                            {itemPhotos.map((photo) => (
                              <View key={photo.id} style={s.thumbCard}>
                                <Pressable onPress={() => setSelectedPhoto(photo)}>
                                  <View>
                                    <Image source={{ uri: photo.uri }} style={s.thumb} cachePolicy="memory-disk" recyclingKey={photo.id} transition={120} />
                                    {uploadStatus[photo.id] === 'uploading' && (
                                      <View style={s.thumbOverlay}>
                                        <MaterialCommunityIcons name="cloud-upload-outline" size={18} color="#FFFFFF" />
                                        <Text style={s.thumbOverlayText}>Enviando…</Text>
                                      </View>
                                    )}
                                  </View>
                                </Pressable>
                                <View style={s.thumbBody}>
                                  <View style={s.obsBox}>
                                    {canWrite && (
                                      <Pressable onPress={() => setConfirmRemovePhoto(photo.id)} style={s.photoRemoveX} hitSlop={6}>
                                        <MaterialCommunityIcons name="close" size={14} color="#64748B" />
                                      </Pressable>
                                    )}
                                    <TextInput
                                      editable={canWrite}
                                      multiline onChangeText={(v) => setDraftPhotoComments((cur) => ({ ...cur, [photo.id]: v }))}
                                      placeholder={canWrite ? 'Comentário...' : 'Sem comentário'} placeholderTextColor="#94A3B8"
                                      style={[s.obsTextarea, canWrite && { paddingRight: 26 }]} value={draftPhotoComments[photo.id] ?? photo.comment ?? ''} />
                                    {canWrite && (
                                    <View style={s.obsBoxFooter}>
                                      <View />
                                      <View style={s.obsBoxFooterRight}>
                                        <Pressable onPress={() => cancelPhotoComment(photo.id)} style={s.obsCancelBtn}>
                                          <Text style={s.obsCancelBtnText}>Cancelar</Text>
                                        </Pressable>
                                        <Pressable onPress={() => savePhotoComment(photo.id)} style={s.obsDoneBtn}>
                                          <Text style={s.obsDoneBtnText}>Salvar</Text>
                                        </Pressable>
                                      </View>
                                    </View>
                                    )}
                                  </View>
                                </View>
                              </View>
                            ))}
                          </View>
                        )}
                      </View>
                    );
                  })}
                </View>
              );
            })}
          </>
        )}

        {/* ── EM ABERTO ── */}
        {activeTab === 'Em aberto' && (
          <>
            {pendingItems.length === 0 ? (
              <View style={[s.card, s.cardCentered]}>
                <MaterialCommunityIcons name="check-circle" size={32} color="#047857" />
                <Text style={s.allClear}>Nada em aberto</Text>
              </View>
            ) : (
              pendingItems.map((item) => {
                const cfg = checklistConfig[item.state];
                const critical = isCriticalStageForStatus(item.label);
                return (
                  <View key={`p-${item.id}`} style={[s.issueCard, { borderLeftColor: cfg.color }]}>
                    <View style={s.issueCardRow}>
                      <Text style={s.issueCardLabel}>{item.label}</Text>
                      {critical && (
                        <View style={[s.critPill, { borderColor: '#B91C1C' }]}>
                          <Text style={[s.critPillText, { color: '#B91C1C' }]}>Crítica</Text>
                        </View>
                      )}
                    </View>
                    <Text style={[s.issueCardState, { color: cfg.color }]}>{cfg.label}</Text>
                    {item.comment ? <Text style={s.issueCardComment}>{item.comment}</Text> : null}
                  </View>
                );
              })
            )}
            {blockedGroups.length > 0 && (
              <>
                <Text style={s.sectionLabel}>Serviços travados por itens em aberto</Text>
                {blockedGroups.map((g) => (
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
                  <Image source={{ uri: photo.uri }} style={s.galleryImage} cachePolicy="memory-disk" recyclingKey={photo.id} transition={120} />
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
            {items.map((item, idx) => {
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
          scheduleRows.map((row) => {
            const item = items.find((i) => i.label === row.service);
            if (!item) return null;
            const ss = scheduleStatusStyles[row.scheduleStatus] ?? scheduleStatusStyles['No prazo'];
            const isPendingOrPartial = row.inspectionStatus === 'pending' || row.inspectionStatus === 'partial';
            const isNA = row.inspectionStatus === 'notApplicable';
            return (
              <View key={`sch-${item.id}`} style={s.schedCard}>
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
                      {([
                        { label: 'Início planejado', field: 'plannedStart' as keyof ScheduleFields, value: item.plannedStart },
                        { label: 'Término planejado', field: 'plannedEnd' as keyof ScheduleFields, value: item.plannedEnd },
                        { label: 'Início real', field: 'actualStart' as keyof ScheduleFields, value: item.actualStart },
                      ]).map((f) => (
                        <View key={f.field} style={s.fieldGroup}>
                          <Text style={s.fieldLabel}>{f.label}</Text>
                          <TextInput
                            keyboardType="number-pad" maxLength={10}
                            onChangeText={(v) => updateItemSchedule(item, f.field, v)}
                            placeholder="DD/MM/AAAA" placeholderTextColor="#94A3B8"
                            style={s.input} value={f.value ?? ''} />
                        </View>
                      ))}
                      <View style={s.fieldGroup}>
                        <Text style={s.fieldLabel}>Término real</Text>
                        {isPendingOrPartial ? (
                          <View style={s.inputDisabled}><Text style={s.inputDisabledText}>Ainda não concluído</Text></View>
                        ) : (
                          <TextInput
                            keyboardType="number-pad" maxLength={10}
                            onChangeText={(v) => updateItemSchedule(item, 'actualEnd', v)}
                            placeholder="DD/MM/AAAA" placeholderTextColor="#94A3B8"
                            style={s.input} value={item.actualEnd ?? ''} />
                        )}
                      </View>
                    </View>
                    <View style={s.schedMeta}>
                      <Text style={s.schedMetaText}>Planejado: {formatDateBr(row.plannedStart)} → {formatDateBr(row.plannedEnd)}</Text>
                      {row.delayDays > 0 && <Text style={s.schedDelay}>Atraso: {row.delayDays} dia(s)</Text>}
                    </View>
                  </>
                )}
                {row.blockedServices.length > 0 && <Text style={s.schedBlocked}>Trava: {row.blockedServices.join(', ')}</Text>}
              </View>
            );
          })
        )}

        {/* ── MEDIÇÕES ── */}
        {activeTab === 'Medições' && (
          <View style={[s.card, s.cardCentered]}>
            <MaterialCommunityIcons name="ruler" size={32} color="#CBD5E1" />
            <Text style={s.emptyStateTitle}>Medições por nível em breve</Text>
            <Text style={s.emptyStateSub}>Serão habilitadas junto com a migração de medições por torre.</Text>
          </View>
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
                      {visit.progressBefore}% → {visit.progressAfter}% · {visit.counts.pending + visit.counts.partial} em aberto
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

      {/* MODAL: photo viewer */}
      <Modal animationType="fade" onRequestClose={() => setSelectedPhoto(null)} transparent visible={Boolean(selectedPhoto)}>
        <View style={s.modalBackdrop}>
          <View style={s.modalSheet}>
            {selectedPhoto && (
              <>
                <Image source={{ uri: selectedPhoto.uri }} style={s.modalImage} cachePolicy="memory-disk" />
                <View style={s.modalInfo}>
                  <Text style={s.modalService}>{selectedPhoto.service}</Text>
                  <Text style={s.modalMeta}>{tower.name} / {level.label}</Text>
                  <Text style={s.modalMeta}>{formatPhotoDateTime(selectedPhoto.dataHora ?? selectedPhoto.createdAt)}</Text>
                  {selectedPhoto.comment ? <Text style={s.modalComment}>{selectedPhoto.comment}</Text> : null}
                </View>
                <Pressable onPress={() => setConfirmRemovePhoto(selectedPhoto.id)} style={s.removeBtn}>
                  <MaterialCommunityIcons name="trash-can-outline" size={12} color="#B91C1C" />
                  <Text style={s.removeBtnText}>Remover foto</Text>
                </Pressable>
              </>
            )}
            <Pressable onPress={() => setSelectedPhoto(null)} style={s.modalClose}>
              <Text style={s.modalCloseText}>Fechar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* MODAL: visit detail */}
      <Modal animationType="slide" onRequestClose={() => setSelectedVisit(null)} transparent visible={Boolean(selectedVisit)}>
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
                  : selectedVisit.changedItemIds.map((id) => <Text key={id} style={s.visitModalItem}>{items.find((i) => i.id === id)?.label ?? id}</Text>)}

                <Text style={s.visitModalSectionTitle}>Itens em aberto gerados</Text>
                {selectedVisit.issueItemIds.length === 0
                  ? <Text style={s.visitModalEmpty}>Nada em aberto.</Text>
                  : selectedVisit.issueItemIds.map((id) => <Text key={id} style={s.visitModalItem}>{items.find((i) => i.id === id)?.label ?? id}</Text>)}

                {selectedVisit.generalNote ? <Text style={s.visitModalNote}>{selectedVisit.generalNote}</Text> : null}
              </ScrollView>
            )}
            <Pressable onPress={() => setSelectedVisit(null)} style={s.modalClose}>
              <Text style={s.modalCloseText}>Fechar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* MODAL: confirm remove step */}
      <Modal animationType="fade" onRequestClose={() => setConfirmRemove(null)} transparent visible={Boolean(confirmRemove)}>
        <View style={s.modalBackdrop}>
          <View style={s.confirmSheet}>
            <View style={[s.confirmIcon, { backgroundColor: '#FEE2E2' }]}>
              <MaterialCommunityIcons name="trash-can-outline" size={26} color="#B91C1C" />
            </View>
            <Text style={s.confirmTitle}>Remover etapa deste nível?</Text>
            <Text style={s.confirmSub}>{confirmRemove?.label}</Text>
            <View style={s.confirmActions}>
              <Pressable onPress={() => setConfirmRemove(null)} style={s.confirmBtnGhost}>
                <Text style={s.confirmBtnGhostText}>Cancelar</Text>
              </Pressable>
              <Pressable onPress={removeStepNow} style={s.confirmBtnDanger}>
                <Text style={s.confirmBtnDangerText}>Remover</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* MODAL: confirm remove photo */}
      <Modal animationType="fade" onRequestClose={() => setConfirmRemovePhoto(null)} transparent visible={Boolean(confirmRemovePhoto)}>
        <View style={s.modalBackdrop}>
          <View style={s.confirmSheet}>
            <View style={[s.confirmIcon, { backgroundColor: '#FEE2E2' }]}>
              <MaterialCommunityIcons name="image-remove" size={26} color="#B91C1C" />
            </View>
            <Text style={s.confirmTitle}>Remover esta foto?</Text>
            <Text style={s.confirmSub}>A foto e seu comentário serão apagados. Esta ação não pode ser desfeita.</Text>
            <View style={s.confirmActions}>
              <Pressable onPress={() => setConfirmRemovePhoto(null)} style={s.confirmBtnGhost}>
                <Text style={s.confirmBtnGhostText}>Cancelar</Text>
              </Pressable>
              <Pressable
                onPress={() => { if (confirmRemovePhoto) removePhoto(confirmRemovePhoto); setConfirmRemovePhoto(null); }}
                style={s.confirmBtnDanger}>
                <Text style={s.confirmBtnDangerText}>Remover</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* MODAL: add catalog step */}
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
                <Text style={s.addStepSub}>Escolha uma etapa do catálogo para incluir neste nível.</Text>
              </View>
              <Pressable onPress={() => setAddStepOpen(false)} hitSlop={8} style={s.addStepCloseBtn}>
                <MaterialCommunityIcons name="close" size={18} color="#64748B" />
              </Pressable>
            </View>
            <View style={s.addStepSearchWrap}>
              <MaterialCommunityIcons name="magnify" size={18} color="#94A3B8" />
              <TextInput
                autoFocus={Platform.OS !== 'web'} onChangeText={setAddStepSearch}
                placeholder="Buscar por nome ou categoria…" placeholderTextColor="#94A3B8"
                style={s.addStepSearchInput} value={addStepSearch} />
              {addStepSearch ? (
                <Pressable onPress={() => setAddStepSearch('')} hitSlop={6}>
                  <MaterialCommunityIcons name="close-circle" size={16} color="#94A3B8" />
                </Pressable>
              ) : null}
            </View>
            <ScrollView style={s.addStepList} contentContainerStyle={{ gap: 20, paddingBottom: 12 }} showsVerticalScrollIndicator={false}>
              {availableStages.length === 0 ? (
                <View style={s.addStepEmpty}>
                  <MaterialCommunityIcons name="check-all" size={28} color="#CBD5E1" />
                  <Text style={s.addStepEmptyText}>
                    {addStepSearch ? 'Nenhuma etapa corresponde à busca' : 'Todas as etapas do catálogo já estão neste nível'}
                  </Text>
                </View>
              ) : (
                (() => {
                  const groups = new Map<string, typeof availableStages>();
                  for (const stg of availableStages) {
                    const cat = stg.categoria?.trim() || 'Sem categoria';
                    if (!groups.has(cat)) groups.set(cat, [] as typeof availableStages);
                    groups.get(cat)!.push(stg);
                  }
                  const searching = addStepSearch.trim().length > 0;
                  return [...groups.entries()]
                    .sort(([a], [b]) => a.localeCompare(b, 'pt-BR'))
                    .map(([cat, stages]) => {
                      const color = categoryColor(cat);
                      const collapsed = !searching && collapsedAddStepGroups[cat] === true;
                      return (
                        <View key={`add-grp-${cat}`} style={s.addStepGroup}>
                          <Pressable onPress={() => setCollapsedAddStepGroups((cur) => ({ ...cur, [cat]: !collapsed }))} style={s.addStepGroupHeader}>
                            <MaterialCommunityIcons name={collapsed ? 'chevron-right' : 'chevron-down'} size={18} color="#64748B" />
                            <View style={[s.addStepGroupDot, { backgroundColor: color }]} />
                            <Text style={s.addStepGroupTitle}>{cat}</Text>
                            <Text style={s.addStepGroupCount}>{stages.length}</Text>
                          </Pressable>
                          {!collapsed && stages.map((stage) => (
                            <Pressable key={stage.id} onPress={() => addStepToLevel(stage.nome, stage.ordemExecucao)} style={s.addStepItem}>
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

      {movedToast && (
        <Animated.View
          pointerEvents="none"
          style={[
            s.saveToast,
            s.saveToastSaved,
            {
              opacity: movedAnim,
              transform: [{ translateY: movedAnim.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }],
            },
          ]}>
          <MaterialCommunityIcons name="arrow-down-bold" size={16} color="#FFFFFF" />
          <Text style={s.saveToastText}>Concluída — movida para o fim da lista</Text>
        </Animated.View>
      )}
    </>
  );
}
