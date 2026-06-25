import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '@/src/ui/Text';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import type { Apartment, ApartmentStatus, ChecklistItem } from '@/src/data/mockObras';
import { useObras } from '@/src/data/ObrasContext';
import * as db from '@/src/data/db';
import type { ServiceStage } from '@/src/data/serviceStages';
import { summarizeApartmentSchedule } from '@/src/data/schedule';
import { getBlockedServiceGroups, getChecklistForApartment } from '@/src/data/serviceBlockers';
import { isCriticalStageForStatus } from '@/src/data/serviceStages';
import { getProgressMapStyle, statusConfig } from '@/src/ui/status';

// ── Color token for this modal ─────────────────────────────────────────────────
const C = {
  primary:  '#0F766E',   // teal-700
  light:    '#F0FDFA',   // teal-50
  border:   '#99F6E4',   // teal-200
  medium:   '#0D9488',   // teal-600 (icons, active text)
} as const;

const viewModes = ['Mapa', 'Lista'] as const;
const filterOptions = [
  'Todos', 'Excelente', 'Bom', 'Atenção', 'Crítico',
  'Em aberto', 'Com atraso', 'Travado',
] as const;

type ViewMode      = (typeof viewModes)[number];
type FilterOption  = (typeof filterOptions)[number];
type CovFilter     = 'all' | 'present' | 'absent';
type AreaFilter    = 'all' | 'Exterior' | 'Interior';

type ApartmentSummary = {
  apartment: Apartment;
  blockedCount: number;
  checklist: ChecklistItem[];
  maxDelayDays: number;
  observationCount: number;
  pendingCount: number;
  progress: number;
  statusKey: ApartmentStatus;
};

const calcProgress = (items: ChecklistItem[]) => {
  const score = items.reduce((t, i) => {
    if (i.state === 'ok' || i.state === 'notApplicable') return t + 1;
    if (i.state === 'partial') return t + 0.5;
    return t;
  }, 0);
  return items.length ? Math.round((score / items.length) * 100) : 0;
};

const calcStatus = (items: ChecklistItem[], progress: number): ApartmentStatus => {
  const pending  = items.filter((i) => i.state === 'pending').length;
  const partial  = items.filter((i) => i.state === 'partial').length;
  const manyPend = pending >= Math.max(3, Math.ceil(items.length * 0.35));
  const hasCrit  = items.some(
    (i) => (i.state === 'pending' || i.state === 'partial') && isCriticalStageForStatus(i.label),
  );
  if (progress < 50 || manyPend || hasCrit) return 'critical';
  if ((progress >= 50 && progress <= 74) || partial > 0) return 'attention';
  if (progress >= 90 && pending === 0) return 'excellent';
  return 'good';
};

const normalizeAptSearch = (v: string) =>
  v.toLocaleLowerCase('pt-BR').replace(/apartamento|ap|\s/g, '');
const normalizeText = (v: string) =>
  v.toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[̀-ͯ]/g, '');
const getFloorOrder = (floor: string) => { const m = floor.match(/\d+/); return m ? Number(m[0]) : 0; };

const STATUS_FILTER_MAP: Record<FilterOption, (s: ApartmentSummary) => boolean> = {
  Todos:          () => true,
  Excelente:      (s) => statusConfig[s.statusKey].label === 'Excelente',
  Bom:            (s) => statusConfig[s.statusKey].label === 'Bom',
  Atenção:        (s) => statusConfig[s.statusKey].label === 'Atenção',
  Crítico:        (s) => statusConfig[s.statusKey].label === 'Crítico',
  'Em aberto':(s) => s.pendingCount > 0,
  'Com atraso':   (s) => s.maxDelayDays > 0,
  Travado:        (s) => s.blockedCount > 0,
};

const CAT_PALETTE = ['#2563EB','#0891B2','#16A34A','#D97706','#DB2777','#0EA5E9','#65A30D','#B45309'];
const categoryColor = (cat: string) => {
  let h = 0;
  for (let i = 0; i < cat.length; i++) h = (h * 31 + cat.charCodeAt(i)) >>> 0;
  return CAT_PALETTE[h % CAT_PALETTE.length];
};

export default function TowerApartmentsScreen() {
  const { torreId } = useLocalSearchParams<{ torreId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { getTowerById, getApartmentsByTower, serviceStages, refreshData, loading } = useObras();
  const tower          = getTowerById(torreId);
  const towerApartments = getApartmentsByTower(torreId);

  // ── Main screen ────────────────────────────────────────────────────────────
  const scrollRef       = useRef<ScrollView | null>(null);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('Mapa');
  const [search,   setSearch]   = useState('');
  const [filter,   setFilter]   = useState<FilterOption>('Todos');

  // ── Association modal ──────────────────────────────────────────────────────
  const modalScrollRef = useRef<ScrollView | null>(null);
  const [showModalTop,      setShowModalTop]      = useState(false);
  const [assocOpen,         setAssocOpen]         = useState(false);
  const [assocSearch,       setAssocSearch]       = useState('');
  const [covFilter,         setCovFilter]         = useState<CovFilter>('all');
  const [areaFilter,        setAreaFilter]        = useState<AreaFilter>('all');
  // undefined key → collapsed by default (groups start closed)
  const [assocCollapsed,    setAssocCollapsed]    = useState<Record<string, boolean>>({});
  const [assocBusy,         setAssocBusy]         = useState(false);
  const [assocLoadingId,    setAssocLoadingId]    = useState<string | null>(null);
  const [confirmRemoveAll,  setConfirmRemoveAll]  = useState(false);

  const openModal = useCallback(() => {
    setAssocSearch('');
    setCovFilter('all');
    setAreaFilter('all');
    setAssocCollapsed({});   // all undefined → all collapsed
    setShowModalTop(false);
    setAssocOpen(true);
  }, []);

  const towerAptIds = useMemo(() => towerApartments.map((a) => a.id), [towerApartments]);

  // Coverage map: stage name → count of tower apartments that have it
  const coverageMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const apt of towerApartments) {
      const labels = new Set(apt.checklist.map((i) => i.label));
      for (const stage of serviceStages) {
        if (labels.has(stage.nome)) map.set(stage.nome, (map.get(stage.nome) ?? 0) + 1);
      }
    }
    return map;
  }, [towerApartments, serviceStages]);

  const activeChecklistStages = useMemo(
    () => serviceStages.filter((s) => s.ativo && s.apareceNoChecklist),
    [serviceStages],
  );

  const assocStages = useMemo(() => {
    const q     = normalizeText(assocSearch.trim());
    const total = towerApartments.length;
    return activeChecklistStages.filter((stage) => {
      if (q && !normalizeText(stage.nome).includes(q) && !normalizeText(stage.categoria).includes(q)) return false;
      const have = coverageMap.get(stage.nome) ?? 0;
      if (covFilter === 'present' && have === 0) return false;
      if (covFilter === 'absent'  && total > 0 && have === total) return false;
      if (areaFilter !== 'all' && stage.area !== areaFilter) return false;
      return true;
    });
  }, [activeChecklistStages, assocSearch, covFilter, areaFilter, coverageMap, towerApartments.length]);

  const assocGroups = useMemo(() => {
    const groups = new Map<string, ServiceStage[]>();
    for (const stage of assocStages) {
      const cat = stage.categoria || 'Sem categoria';
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat)!.push(stage);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b, 'pt-BR'));
  }, [assocStages]);

  const absentCount = useMemo(
    () => activeChecklistStages.filter((s) => (coverageMap.get(s.nome) ?? 0) < towerApartments.length).length,
    [activeChecklistStages, coverageMap, towerApartments.length],
  );

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleAddStage = useCallback(async (stage: ServiceStage) => {
    setAssocLoadingId(stage.id);
    try { await db.addStageToApartments(stage, towerAptIds); await refreshData(); }
    finally { setAssocLoadingId(null); }
  }, [towerAptIds, refreshData]);

  const handleRemoveStage = useCallback(async (stage: ServiceStage) => {
    setAssocLoadingId(stage.id);
    try { await db.removeStageFromApartments(stage.nome, towerAptIds); await refreshData(); }
    finally { setAssocLoadingId(null); }
  }, [towerAptIds, refreshData]);

  const handleAddAll = useCallback(async () => {
    setAssocBusy(true);
    try {
      const total = towerApartments.length;
      for (const stage of activeChecklistStages.filter((s) => (coverageMap.get(s.nome) ?? 0) < total))
        await db.addStageToApartments(stage, towerAptIds);
      await refreshData();
    } finally { setAssocBusy(false); }
  }, [activeChecklistStages, coverageMap, towerApartments.length, towerAptIds, refreshData]);

  const handleRemoveAll = useCallback(async () => {
    setConfirmRemoveAll(false);
    setAssocBusy(true);
    try {
      for (const stage of activeChecklistStages)
        await db.removeStageFromApartments(stage.nome, towerAptIds);
      await refreshData();
    } finally { setAssocBusy(false); }
  }, [activeChecklistStages, towerAptIds, refreshData]);

  const toggleGroup = useCallback((cat: string) =>
    setAssocCollapsed((cur) => ({ ...cur, [cat]: !cur[cat] })), []);

  // ── Apartment list ─────────────────────────────────────────────────────────
  const apartmentSummaries = useMemo<ApartmentSummary[]>(
    () => towerApartments.map((apartment) => {
      const checklist       = getChecklistForApartment(apartment);
      const pendingCount    = checklist.filter((i) => i.state === 'pending' || i.state === 'partial').length;
      const blockedCount    = getBlockedServiceGroups(checklist).reduce((t, g) => t + g.blockedServices.length, 0);
      const observationCount= checklist.filter((i) => i.comment?.trim()).length;
      const { maxDelayDays }= summarizeApartmentSchedule(apartment);
      const progress        = calcProgress(checklist);
      return { apartment, blockedCount, checklist, maxDelayDays, observationCount, pendingCount, progress, statusKey: calcStatus(checklist, progress) };
    }),
    [towerApartments],
  );

  const filteredSummaries = useMemo(() => {
    const q = normalizeAptSearch(search);
    return apartmentSummaries.filter((s) =>
      (!q || s.apartment.number.includes(q)) && STATUS_FILTER_MAP[filter](s),
    );
  }, [apartmentSummaries, search, filter]);

  const summariesByFloor = useMemo(() => {
    const grouped = filteredSummaries.reduce<Record<string, ApartmentSummary[]>>((g, s) => {
      g[s.apartment.floor] = [...(g[s.apartment.floor] ?? []), s]; return g;
    }, {});
    // Within a floor, order units by apartment number (numeric when possible).
    for (const floor of Object.keys(grouped)) {
      grouped[floor].sort((a, b) => {
        const na = Number(a.apartment.number), nb = Number(b.apartment.number);
        if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
        return a.apartment.number.localeCompare(b.apartment.number, 'pt-BR');
      });
    }
    return grouped;
  }, [filteredSummaries]);
  // Ascending floor order: 1º pavimento, 2º pavimento, …
  const orderedFloors = useMemo(
    () => Object.keys(summariesByFloor).sort((a, b) => getFloorOrder(a) - getFloorOrder(b)),
    [summariesByFloor],
  );

  const towerStats = useMemo(() => {
    const avgProgress = apartmentSummaries.length
      ? Math.round(apartmentSummaries.reduce((t, s) => t + s.progress, 0) / apartmentSummaries.length) : 0;
    return {
      avgProgress,
      criticalCount:      apartmentSummaries.filter((s) => s.statusKey === 'critical').length,
      totalPending:       apartmentSummaries.reduce((t, s) => t + s.pendingCount, 0),
      totalBlocked:       apartmentSummaries.reduce((t, s) => t + s.blockedCount, 0),
      totalObservations:  apartmentSummaries.reduce((t, s) => t + s.observationCount, 0),
    };
  }, [apartmentSummaries]);

  // ── Back bar ───────────────────────────────────────────────────────────────
  const backBar = (
    <View style={[s.backBar, { paddingTop: insets.top + 8 }]}>
      <Pressable onPress={() => router.push('/(tabs)/visao-geral' as any)} style={s.backBtn}>
        <MaterialCommunityIcons name="chevron-left" size={26} color="#0F172A" />
        <Text style={s.backBtnText}>Visão Geral</Text>
      </Pressable>
    </View>
  );

  if (!tower) {
    return (
      <View style={s.emptyWrap}>
        {backBar}
        <View style={s.empty}>
          <MaterialCommunityIcons name={loading ? 'progress-clock' : 'office-building-remove-outline'} size={48} color="#CBD5E1" />
          <Text style={s.emptyTitle}>{loading ? 'Carregando torre…' : 'Torre não encontrada'}</Text>
        </View>
      </View>
    );
  }

  return (
    <>
      {/* ── MAIN SCREEN ─────────────────────────────────────────────────────── */}
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={s.container}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={64}
        onScroll={(e) => setShowBackToTop(e.nativeEvent.contentOffset.y > 400)}
      >
        {/* HEADER — colored stripe varies with the tower's average progress, matching the apartment screen */}
        <View style={[s.header, { paddingTop: insets.top + 12, backgroundColor: getProgressMapStyle(towerStats.avgProgress).fg }]}>
          <Pressable onPress={() => router.push('/(tabs)/visao-geral' as any)} style={s.headerBack}>
            <MaterialCommunityIcons name="chevron-left" size={26} color="rgba(255,255,255,0.9)" />
            <Text style={s.headerBackText}>Visão Geral</Text>
          </Pressable>
          <View style={s.headerTop}>
            <MaterialCommunityIcons name="office-building" size={30} color="#FFFFFF" />
            <View style={s.headerInfo}>
              <Text style={s.headerTitle}>{tower.name}</Text>
              <Text style={s.headerSub}>{`${tower.block} · ${tower.position}`}</Text>
            </View>
            <View style={s.headerCount}>
              <Text style={s.headerCountValue}>{towerApartments.length}</Text>
              <Text style={s.headerCountLabel}>unid.</Text>
            </View>
          </View>
          {tower.description ? <Text style={s.headerDesc}>{tower.description}</Text> : null}
          <View style={s.headerBar}>
            <View style={[s.headerBarFill, { width: `${towerStats.avgProgress}%` as `${number}%` }]} />
          </View>
          <View style={s.headerMetaRow}>
            <Text style={s.headerBarLabel}>{`${towerStats.avgProgress}% de avanço médio`}</Text>
            <Pressable onPress={openModal} style={s.assocTrigger}>
              <MaterialCommunityIcons name="format-list-checks" size={16} color="#FFFFFF" />
              <Text style={s.assocTriggerText}>Etapas</Text>
            </Pressable>
          </View>
        </View>

        {/* KPI ROW */}
        <View style={s.kpiRow}>
          {[
            { icon: 'check-circle-outline',  value: `${towerStats.avgProgress}%`, label: 'Avanço',      color: '#2563EB', bg: '#EFF6FF' },
            { icon: 'close-circle-outline',   value: towerStats.criticalCount,     label: 'Críticos',    color: towerStats.criticalCount > 0  ? '#B91C1C' : '#047857', bg: towerStats.criticalCount > 0  ? '#FEE2E2' : '#D1FAE5' },
            { icon: 'alert-outline',          value: towerStats.totalPending,      label: 'Em aberto',  color: towerStats.totalPending > 0   ? '#B45309' : '#047857', bg: towerStats.totalPending > 0   ? '#FEF3C7' : '#D1FAE5' },
            { icon: 'lock-outline',           value: towerStats.totalBlocked,      label: 'Travados',    color: towerStats.totalBlocked > 0   ? '#7C3AED' : '#047857', bg: towerStats.totalBlocked > 0   ? '#EDE9FE' : '#D1FAE5' },
            { icon: 'note-text-outline',      value: towerStats.totalObservations, label: 'Observações', color: towerStats.totalObservations > 0 ? '#0891B2' : '#047857', bg: towerStats.totalObservations > 0 ? '#E0F2FE' : '#D1FAE5' },
          ].map((k) => (
            <View key={k.label} style={[s.kpiCard, { backgroundColor: k.bg }]}>
              <MaterialCommunityIcons name={k.icon as any} size={18} color={k.color} />
              <Text style={[s.kpiValue, { color: k.color }]}>{k.value}</Text>
              <Text style={[s.kpiLabel, { color: k.color }]}>{k.label}</Text>
            </View>
          ))}
        </View>

        {/* CONTROLS */}
        <View style={s.controls}>
          <View style={s.searchRow}>
            <MaterialCommunityIcons name="magnify" size={18} color="#94A3B8" />
            <TextInput onChangeText={setSearch} placeholder="Pesquisar apartamento..." placeholderTextColor="#94A3B8" style={s.searchInput} value={search} />
            {search.length > 0 && <Pressable onPress={() => setSearch('')} style={s.searchClear}><MaterialCommunityIcons name="close-circle" size={16} color="#94A3B8" /></Pressable>}
          </View>
          <View style={s.viewToggle}>
            {viewModes.map((mode) => {
              const active = viewMode === mode;
              return (
                <Pressable key={mode} onPress={() => setViewMode(mode)} style={[s.viewBtn, active && s.viewBtnActive]}>
                  <MaterialCommunityIcons name={mode === 'Lista' ? 'view-list' : 'grid'} size={16} color={active ? '#2563EB' : '#94A3B8'} />
                  <Text style={[s.viewBtnText, active && s.viewBtnTextActive]}>{mode}</Text>
                </Pressable>
              );
            })}
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filterRow}>
            {filterOptions.map((opt) => {
              const active = filter === opt;
              return (
                <Pressable key={opt} onPress={() => setFilter(opt)} style={[s.filterChip, active && s.filterChipActive]}>
                  <Text style={[s.filterChipText, active && s.filterChipTextActive]}>{opt}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        {(filter !== 'Todos' || search.length > 0) && (
          <Text style={s.resultsCount}>{`${filteredSummaries.length} de ${apartmentSummaries.length} apartamento(s)`}</Text>
        )}

        {filteredSummaries.length === 0 ? (
          <View style={s.emptyPanel}>
            <MaterialCommunityIcons name="filter-remove-outline" size={36} color="#CBD5E1" />
            <Text style={s.emptyPanelTitle}>Nenhum resultado</Text>
            <Text style={s.emptyPanelSub}>Tente ajustar os filtros ou a busca</Text>
          </View>
        ) : viewMode === 'Lista' ? (
          <View style={s.list}>
            {filteredSummaries.map(({ apartment, statusKey, progress, pendingCount, blockedCount, observationCount, maxDelayDays }) => {
              const st = statusConfig[statusKey];
              const pc = getProgressMapStyle(progress).fg;
              return (
                <Pressable key={apartment.id} onPress={() => router.push({ pathname: '/visao-geral/apartamentos/[apartamentoId]', params: { apartamentoId: apartment.id } })} style={s.aptCard}>
                  <View style={[s.aptCardStripe, { backgroundColor: pc }]} />
                  <View style={s.aptCardInner}>
                    <View style={s.aptCardTop}>
                      <View style={s.aptCardLeft}>
                        <Text style={s.aptNumber}>{`Apto ${apartment.number}`}</Text>
                        <Text style={s.aptFloor}>{apartment.floor}</Text>
                      </View>
                      <View style={s.aptCardRight}>
                        <View style={[s.statusBadge, { backgroundColor: st.background }]}><Text style={[s.statusBadgeText, { color: st.color }]}>{st.label}</Text></View>
                        <Text style={s.aptProgress}>{`${progress}%`}</Text>
                      </View>
                    </View>
                    <View style={s.aptBar}><View style={[s.aptBarFill, { backgroundColor: pc, width: `${progress}%` as `${number}%` }]} /></View>
                    <View style={s.aptMetrics}>
                      {pendingCount > 0    && <View style={s.metricPill}><MaterialCommunityIcons name="alert-circle-outline" size={11} color="#B45309" /><Text style={[s.metricPillText, { color: '#B45309' }]}>{`${pendingCount} em aberto`}</Text></View>}
                      {blockedCount > 0    && <View style={s.metricPill}><MaterialCommunityIcons name="lock-outline" size={11} color="#7C3AED" /><Text style={[s.metricPillText, { color: '#7C3AED' }]}>{`${blockedCount} travado(s)`}</Text></View>}
                      {observationCount > 0 && <View style={s.metricPill}><MaterialCommunityIcons name="note-text-outline" size={11} color="#0891B2" /><Text style={[s.metricPillText, { color: '#0891B2' }]}>{`${observationCount} obs.`}</Text></View>}
                      {maxDelayDays > 0    && <View style={s.metricPill}><MaterialCommunityIcons name="clock-alert-outline" size={11} color="#B91C1C" /><Text style={[s.metricPillText, { color: '#B91C1C' }]}>{`${maxDelayDays}d atraso`}</Text></View>}
                      {pendingCount === 0 && blockedCount === 0 && maxDelayDays === 0 && observationCount === 0 && (
                        <View style={s.metricPill}><MaterialCommunityIcons name="check-circle-outline" size={11} color="#047857" /><Text style={[s.metricPillText, { color: '#047857' }]}>Nada em aberto</Text></View>
                      )}
                    </View>
                    <View style={s.aptCardFooter}>
                      <Text style={s.aptLastInspection}>{apartment.lastInspection ? `Última vistoria: ${apartment.lastInspection}` : 'Sem vistoria registrada'}</Text>
                      <View style={s.openBtn}><Text style={s.openBtnText}>Abrir</Text><MaterialCommunityIcons name="chevron-right" size={14} color="#2563EB" /></View>
                    </View>
                  </View>
                </Pressable>
              );
            })}
          </View>
        ) : (
          <View style={s.mapPanel}>
            <View style={s.legend}>
              {[10, 30, 50, 70, 90].map((v) => {
                const ms = getProgressMapStyle(v);
                return (
                  <View key={v} style={s.legendItem}>
                    <View style={[s.legendDot, { backgroundColor: ms.bg, borderColor: ms.border }]} />
                    <Text style={s.legendText}>{v - 10}–{v + 10}%</Text>
                  </View>
                );
              })}
            </View>
            {orderedFloors.map((floor) => (
              <View key={floor} style={s.floorGroup}>
                <View style={s.floorHeader}>
                  <MaterialCommunityIcons name="stairs" size={14} color="#64748B" />
                  <Text style={s.floorTitle}>{floor}</Text>
                  <Text style={s.floorCount}>{summariesByFloor[floor].length} un.</Text>
                </View>
                <View style={s.compactGrid}>
                  {summariesByFloor[floor].map((sum) => {
                    const ms = getProgressMapStyle(sum.progress);
                    return (
                      <Pressable key={`map-${sum.apartment.id}`} onPress={() => router.push({ pathname: '/visao-geral/apartamentos/[apartamentoId]', params: { apartamentoId: sum.apartment.id } })} style={[s.mapUnit, { borderColor: ms.border, backgroundColor: ms.bg }]}>
                        <Text style={[s.mapUnitNumber, { color: ms.fg }]}>{sum.apartment.number}</Text>
                        <Text style={[s.mapUnitProgress, { color: ms.fg }]}>{`${sum.progress}%`}</Text>
                        <View style={[s.mapUnitDot, sum.pendingCount > 0 && { backgroundColor: ms.fg }]} />
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {/* Back-to-top — main screen */}
      {showBackToTop && (
        <Pressable onPress={() => scrollRef.current?.scrollTo({ y: 0, animated: false })} style={s.backToTopFab}>
          <MaterialCommunityIcons name="chevron-up" size={22} color="#FFFFFF" />
        </Pressable>
      )}

      {/* ── ASSOCIATION MODAL ─────────────────────────────────────────────── */}
      <Modal animationType="slide" transparent visible={assocOpen} onRequestClose={() => setAssocOpen(false)}>
        <Pressable style={m.backdrop} onPress={() => setAssocOpen(false)}>
          <Pressable style={m.sheet} onPress={(e) => e.stopPropagation()}>

            <View style={m.handle} />

            {/* Header */}
            <View style={m.header}>
              <View style={m.headerLeft}>
                <View style={m.headerIconWrap}>
                  <MaterialCommunityIcons name="format-list-checks" size={18} color={C.primary} />
                </View>
                <View>
                  <Text style={m.headerTitle}>Etapas da Torre</Text>
                  <Text style={m.headerSub}>{`${tower.name} · ${towerApartments.length} unidades`}</Text>
                </View>
              </View>
              <Pressable onPress={() => setAssocOpen(false)} style={m.closeBtn} hitSlop={8}>
                <MaterialCommunityIcons name="close" size={18} color="#475569" />
              </Pressable>
            </View>

            {/* Search */}
            <View style={m.searchRow}>
              <MaterialCommunityIcons name="magnify" size={16} color="#94A3B8" />
              <TextInput onChangeText={setAssocSearch} placeholder="Buscar etapa ou categoria…" placeholderTextColor="#94A3B8" style={m.searchInput} value={assocSearch} />
              {assocSearch ? <Pressable onPress={() => setAssocSearch('')} hitSlop={8}><MaterialCommunityIcons name="close-circle" size={16} color="#94A3B8" /></Pressable> : null}
            </View>

            {/* Coverage filter */}
            <View style={m.sectionLabel}>
              <Text style={m.sectionLabelText}>Cobertura</Text>
            </View>
            <View style={m.filterSegment}>
              {([['all', 'Todos'], ['present', 'Presentes'], ['absent', 'Ausentes']] as const).map(([val, label]) => (
                <Pressable key={val} onPress={() => setCovFilter(val)} style={[m.segBtn, covFilter === val && m.segBtnActive]}>
                  <Text style={[m.segBtnText, covFilter === val && m.segBtnTextActive]}>{label}</Text>
                </Pressable>
              ))}
            </View>

            {/* Area filter */}
            <View style={m.sectionLabel}>
              <Text style={m.sectionLabelText}>Área</Text>
            </View>
            <View style={m.areaRow}>
              <Pressable
                onPress={() => setAreaFilter(areaFilter === 'Exterior' ? 'all' : 'Exterior')}
                style={[m.areaBtn, areaFilter === 'Exterior' && m.areaBtnExtActive]}>
                <MaterialCommunityIcons name="domain" size={13} color={areaFilter === 'Exterior' ? '#FFFFFF' : '#94A3B8'} />
                <Text style={[m.areaBtnText, areaFilter === 'Exterior' && m.areaBtnExtText]}>Exterior</Text>
              </Pressable>
              <Pressable
                onPress={() => setAreaFilter(areaFilter === 'Interior' ? 'all' : 'Interior')}
                style={[m.areaBtn, areaFilter === 'Interior' && m.areaBtnIntActive]}>
                <MaterialCommunityIcons name="floor-plan" size={13} color={areaFilter === 'Interior' ? '#FFFFFF' : '#94A3B8'} />
                <Text style={[m.areaBtnText, areaFilter === 'Interior' && m.areaBtnIntText]}>Interior</Text>
              </Pressable>
            </View>

            {/* Global actions */}
            <View style={m.globalActions}>
              <Pressable onPress={handleAddAll} disabled={assocBusy || absentCount === 0} style={[m.globalBtn, m.globalBtnAdd, (assocBusy || absentCount === 0) && m.globalBtnDisabled]}>
                {assocBusy
                  ? <ActivityIndicator size="small" color={C.primary} />
                  : <MaterialCommunityIcons name="plus-circle-outline" size={16} color={absentCount === 0 ? '#CBD5E1' : C.primary} />}
                <Text style={[m.globalBtnAddText, absentCount === 0 && m.globalBtnTextDisabled]}>
                  {absentCount > 0 ? `Adicionar ausentes (${absentCount})` : 'Adicionar ausentes'}
                </Text>
              </Pressable>
              <Pressable onPress={() => setConfirmRemoveAll(true)} disabled={assocBusy} style={[m.globalBtn, m.globalBtnRemove, assocBusy && m.globalBtnDisabled]}>
                <MaterialCommunityIcons name="trash-can-outline" size={16} color={assocBusy ? '#CBD5E1' : '#B91C1C'} />
                <Text style={[m.globalBtnRemoveText, assocBusy && m.globalBtnTextDisabled]}>Remover todos</Text>
              </Pressable>
            </View>

            <View style={m.divider} />

            {/* Stage list */}
            <ScrollView
              ref={modalScrollRef}
              style={m.list}
              contentContainerStyle={m.listContent}
              keyboardShouldPersistTaps="handled"
              scrollEventThrottle={64}
              onScroll={(e) => setShowModalTop(e.nativeEvent.contentOffset.y > 300)}
            >
              {assocGroups.length === 0 ? (
                <View style={m.empty}>
                  <MaterialCommunityIcons name="filter-remove-outline" size={36} color="#CBD5E1" />
                  <Text style={m.emptyTitle}>Nenhuma etapa encontrada</Text>
                  <Text style={m.emptySub}>Ajuste a busca ou os filtros</Text>
                </View>
              ) : assocGroups.map(([cat, stages]) => {
                const color     = categoryColor(cat);
                // undefined → collapsed (default); true → collapsed; false → expanded
                const collapsed = assocCollapsed[cat] !== false;
                const total     = towerApartments.length;
                const completeN = stages.filter((st) => (coverageMap.get(st.nome) ?? 0) === total && total > 0).length;
                return (
                  <View key={cat} style={m.group}>
                    <Pressable onPress={() => toggleGroup(cat)} style={m.groupHeader}>
                      <MaterialCommunityIcons name={collapsed ? 'chevron-right' : 'chevron-down'} size={18} color="#64748B" />
                      <View style={[m.groupDot, { backgroundColor: color }]} />
                      <Text style={m.groupTitle} numberOfLines={1}>{cat}</Text>
                      <Text style={m.groupMeta}>
                        {collapsed ? `${completeN}/${stages.length} completas` : `${stages.length} etapas`}
                      </Text>
                    </Pressable>

                    {!collapsed && stages.map((stage) => {
                      const have       = coverageMap.get(stage.nome) ?? 0;
                      const isComplete = total > 0 && have === total;
                      const isAbsent   = have === 0;
                      const isPartial  = !isComplete && !isAbsent;
                      const isLoading  = assocLoadingId === stage.id;
                      return (
                        <View key={stage.id} style={m.stageRow}>
                          <View style={[m.statusDot, isComplete ? m.dotGreen : isPartial ? m.dotAmber : m.dotGray]} />
                          <View style={m.stageInfo}>
                            <Text style={m.stageName} numberOfLines={1}>{stage.nome}</Text>
                            <View style={m.stageMeta}>
                              <View style={[m.areaBadge, stage.area === 'Exterior' ? m.areaBadgeExt : m.areaBadgeInt]}>
                                <MaterialCommunityIcons name={stage.area === 'Exterior' ? 'domain' : 'floor-plan'} size={9} color={stage.area === 'Exterior' ? '#92400E' : '#0369A1'} />
                                <Text style={[m.areaBadgeText, stage.area === 'Exterior' ? m.areaBadgeTextExt : m.areaBadgeTextInt]}>{stage.area}</Text>
                              </View>
                              <Text style={[m.coverageText, isComplete ? m.coverageGreen : isPartial ? m.coverageAmber : m.coverageGray]}>
                                {`${have}/${total} un.`}
                              </Text>
                            </View>
                          </View>
                          <View style={m.stageActions}>
                            {isLoading ? (
                              <ActivityIndicator size="small" color={C.medium} />
                            ) : (
                              <>
                                {!isComplete && (
                                  <Pressable onPress={() => handleAddStage(stage)} disabled={!!assocLoadingId || assocBusy} style={m.addBtn} hitSlop={6}>
                                    <MaterialCommunityIcons name="plus" size={15} color="#FFFFFF" />
                                  </Pressable>
                                )}
                                {isComplete && <View style={m.completeCheck}><MaterialCommunityIcons name="check-circle" size={20} color="#059669" /></View>}
                                {!isAbsent && (
                                  <Pressable onPress={() => handleRemoveStage(stage)} disabled={!!assocLoadingId || assocBusy} style={m.removeBtn} hitSlop={6}>
                                    <MaterialCommunityIcons name="minus" size={15} color="#B91C1C" />
                                  </Pressable>
                                )}
                              </>
                            )}
                          </View>
                        </View>
                      );
                    })}
                  </View>
                );
              })}
              <View style={{ height: 56 }} />
            </ScrollView>

            {/* Back-to-top — modal */}
            {showModalTop && (
              <Pressable onPress={() => modalScrollRef.current?.scrollTo({ y: 0, animated: true })} style={m.backToTopFab}>
                <MaterialCommunityIcons name="chevron-up" size={20} color="#FFFFFF" />
              </Pressable>
            )}

          </Pressable>
        </Pressable>

        {/* Confirm remove all */}
        {confirmRemoveAll && (
          <View style={m.confirmOverlay}>
            <View style={m.confirmCard}>
              <View style={m.confirmIcon}>
                <MaterialCommunityIcons name="alert-circle-outline" size={32} color="#B91C1C" />
              </View>
              <Text style={m.confirmTitle}>Remover todas as etapas?</Text>
              <Text style={m.confirmBody}>
                {`Esta ação remove o checklist de todos os ${towerApartments.length} apartamentos de ${tower.name}. O progresso salvo será perdido.`}
              </Text>
              <View style={m.confirmActions}>
                <Pressable onPress={() => setConfirmRemoveAll(false)} style={m.confirmCancel}>
                  <Text style={m.confirmCancelText}>Cancelar</Text>
                </Pressable>
                <Pressable onPress={handleRemoveAll} style={m.confirmConfirm}>
                  <MaterialCommunityIcons name="trash-can-outline" size={14} color="#FFFFFF" />
                  <Text style={m.confirmConfirmText}>Remover tudo</Text>
                </Pressable>
              </View>
            </View>
          </View>
        )}
      </Modal>
    </>
  );
}

// ── Main screen styles ─────────────────────────────────────────────────────────
const s = StyleSheet.create({
  container:        { gap: 12, paddingBottom: 32 },
  backBar:          { paddingHorizontal: 8, paddingBottom: 4, backgroundColor: '#F8FAFC' },
  backBtn:          { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 2, paddingVertical: 6, paddingHorizontal: 4 },
  backBtnText:      { color: '#0F172A', fontSize: 15, fontWeight: '600' },
  emptyWrap:        { flex: 1, backgroundColor: '#F8FAFC' },
  empty:            { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 32 },
  emptyTitle:       { color: '#0F172A', fontSize: 18, fontWeight: '700' },
  emptyBtn:         { backgroundColor: '#2563EB', borderRadius: 10, paddingHorizontal: 20, paddingVertical: 10 },
  emptyBtnText:     { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },

  header:           { paddingHorizontal: 16, paddingBottom: 16, gap: 10 },
  headerBack:       { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', marginLeft: -4, marginBottom: 2, gap: 2 },
  headerBackText:   { color: 'rgba(255,255,255,0.9)', fontSize: 15, fontWeight: '600' },
  headerTop:        { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headerInfo:       { flex: 1 },
  headerTitle:      { color: '#FFFFFF', fontSize: 22, fontWeight: '900' },
  headerSub:        { color: 'rgba(255,255,255,0.7)', fontSize: 13, marginTop: 2, fontWeight: '600' },
  headerCount:      { alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.18)', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 8 },
  headerCountValue: { color: '#FFFFFF', fontSize: 22, fontWeight: '900' },
  headerCountLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 11, fontWeight: '700' },
  assocTrigger:     { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(255,255,255,0.18)', borderColor: 'rgba(255,255,255,0.35)', borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7 },
  assocTriggerText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
  headerDesc:       { color: 'rgba(255,255,255,0.8)', fontSize: 13, lineHeight: 18 },
  headerBar:        { backgroundColor: 'rgba(0,0,0,0.2)', borderRadius: 999, height: 6, overflow: 'hidden' },
  headerBarFill:    { height: '100%', borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.85)' },
  headerBarLabel:   { color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: '700' },
  headerMetaRow:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },

  kpiRow:           { flexDirection: 'row', gap: 8, paddingHorizontal: 16 },
  kpiCard:          { flex: 1, borderRadius: 12, padding: 10, alignItems: 'center', gap: 3 },
  kpiValue:         { fontSize: 18, fontWeight: '900' },
  kpiLabel:         { fontSize: 10, fontWeight: '700', textAlign: 'center' },

  controls:         { backgroundColor: '#FFFFFF', borderColor: '#E2E8F0', borderRadius: 14, borderWidth: 1, gap: 12, marginHorizontal: 16, padding: 14 },
  searchRow:        { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F8FAFC', borderColor: '#E2E8F0', borderRadius: 10, borderWidth: 1, paddingHorizontal: 10, gap: 6 },
  searchInput:      { flex: 1, color: '#0F172A', fontSize: 14, minHeight: 42 },
  searchClear:      { padding: 4 },
  viewToggle:       { flexDirection: 'row', backgroundColor: '#F1F5F9', borderRadius: 10, padding: 3, gap: 3 },
  viewBtn:          { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 8, borderRadius: 8 },
  viewBtnActive:    { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E2E8F0' },
  viewBtnText:      { color: '#94A3B8', fontSize: 13, fontWeight: '700' },
  viewBtnTextActive:{ color: '#2563EB' },
  filterRow:        { flexDirection: 'row', gap: 6, paddingBottom: 2 },
  filterChip:       { borderRadius: 999, borderWidth: 1, borderColor: '#E2E8F0', paddingHorizontal: 12, paddingVertical: 7 },
  filterChipActive: { backgroundColor: '#EFF6FF', borderColor: '#2563EB' },
  filterChipText:   { color: '#64748B', fontSize: 12, fontWeight: '700' },
  filterChipTextActive: { color: '#2563EB' },

  resultsCount:     { color: '#94A3B8', fontSize: 12, fontWeight: '600', paddingHorizontal: 16 },
  emptyPanel:       { alignItems: 'center', backgroundColor: '#FFFFFF', borderColor: '#E2E8F0', borderRadius: 14, borderWidth: 1, gap: 8, marginHorizontal: 16, paddingVertical: 36 },
  emptyPanelTitle:  { color: '#475569', fontSize: 15, fontWeight: '700' },
  emptyPanelSub:    { color: '#94A3B8', fontSize: 13 },

  list:             { gap: 8, paddingHorizontal: 16 },
  aptCard:          { backgroundColor: '#FFFFFF', borderColor: '#E2E8F0', borderWidth: 1, borderRadius: 14, overflow: 'hidden', flexDirection: 'row' },
  aptCardStripe:    { width: 4 },
  aptCardInner:     { flex: 1, padding: 14, gap: 10 },
  aptCardTop:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  aptCardLeft:      { gap: 2 },
  aptNumber:        { color: '#0F172A', fontSize: 17, fontWeight: '900' },
  aptFloor:         { color: '#64748B', fontSize: 12 },
  aptCardRight:     { alignItems: 'flex-end', gap: 6 },
  statusBadge:      { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  statusBadgeText:  { fontSize: 11, fontWeight: '900' },
  aptProgress:      { color: '#0F172A', fontSize: 18, fontWeight: '900' },
  aptBar:           { backgroundColor: '#E2E8F0', borderRadius: 999, height: 6, overflow: 'hidden' },
  aptBarFill:       { height: '100%', borderRadius: 999 },
  aptMetrics:       { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  metricPill:       { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#F8FAFC', borderColor: '#E2E8F0', borderRadius: 999, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 4 },
  metricPillText:   { fontSize: 11, fontWeight: '700' },
  aptCardFooter:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderTopColor: '#F1F5F9', paddingTop: 8 },
  aptLastInspection:{ color: '#94A3B8', fontSize: 11 },
  openBtn:          { flexDirection: 'row', alignItems: 'center', gap: 2 },
  openBtnText:      { color: '#2563EB', fontSize: 12, fontWeight: '800' },

  mapPanel:         { backgroundColor: '#FFFFFF', borderColor: '#E2E8F0', borderRadius: 14, borderWidth: 1, marginHorizontal: 16, padding: 14, gap: 16 },
  legend:           { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  legendItem:       { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot:        { width: 10, height: 10, borderRadius: 5, borderWidth: 1 },
  legendText:       { color: '#475569', fontSize: 11, fontWeight: '700' },
  floorGroup:       { gap: 8 },
  floorHeader:      { flexDirection: 'row', alignItems: 'center', gap: 6 },
  floorTitle:       { color: '#0F172A', fontSize: 13, fontWeight: '800', flex: 1 },
  floorCount:       { color: '#94A3B8', fontSize: 11, fontWeight: '600' },
  compactGrid:      { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  mapUnit:          { alignItems: 'center', borderRadius: 10, borderWidth: 1.5, justifyContent: 'center', width: 68, height: 68, gap: 2, backgroundColor: '#FFFFFF' },
  mapUnitNumber:    { fontSize: 13, fontWeight: '900' },
  mapUnitProgress:  { fontSize: 10, fontWeight: '700' },
  mapUnitDot:       { width: 6, height: 6, borderRadius: 3, backgroundColor: '#E2E8F0' },

  backToTopFab: {
    position: 'absolute', right: 20, bottom: 24,
    width: 44, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#94A3B8',
    shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 4,
  },
});

// ── Modal styles ───────────────────────────────────────────────────────────────
const m = StyleSheet.create({
  backdrop:  { flex: 1, backgroundColor: 'rgba(15,23,42,0.55)', justifyContent: 'flex-end' },
  sheet:     { backgroundColor: '#FFFFFF', borderTopLeftRadius: 22, borderTopRightRadius: 22, height: '75%' },
  handle:    { width: 36, height: 4, backgroundColor: '#E2E8F0', borderRadius: 2, alignSelf: 'center', marginTop: 10, marginBottom: 2 },

  header:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingTop: 10, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  headerLeft:    { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerIconWrap:{ width: 36, height: 36, borderRadius: 10, backgroundColor: C.light, alignItems: 'center', justifyContent: 'center' },
  headerTitle:   { color: '#0F172A', fontSize: 16, fontWeight: '900' },
  headerSub:     { color: '#64748B', fontSize: 12, fontWeight: '600', marginTop: 1 },
  closeBtn:      { width: 32, height: 32, borderRadius: 16, backgroundColor: '#F1F5F9', alignItems: 'center', justifyContent: 'center' },

  searchRow:  { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginTop: 12, backgroundColor: '#F8FAFC', borderColor: '#E2E8F0', borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, minHeight: 42 },
  searchInput:{ flex: 1, color: '#0F172A', fontSize: 14, paddingVertical: 8 },

  sectionLabel:    { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
  sectionLabelText:{ color: '#94A3B8', fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.8 },

  // Coverage filter — segmented control
  filterSegment:   { flexDirection: 'row', marginHorizontal: 16, backgroundColor: '#F1F5F9', borderRadius: 10, padding: 3, gap: 3 },
  segBtn:          { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 8 },
  segBtnActive:    { backgroundColor: '#FFFFFF', shadowColor: '#0F172A', shadowOpacity: 0.06, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  segBtnText:      { color: '#94A3B8', fontSize: 13, fontWeight: '700' },
  segBtnTextActive:{ color: C.primary },

  // Area filter — pill row
  areaRow:         { flexDirection: 'row', gap: 8, marginHorizontal: 16 },
  areaBtn:         { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 10, borderRadius: 10, backgroundColor: '#F1F5F9' },
  areaBtnExtActive:{ backgroundColor: '#D97706' },
  areaBtnIntActive:{ backgroundColor: '#0891B2' },
  areaBtnText:     { color: '#94A3B8', fontSize: 13, fontWeight: '700' },
  areaBtnExtText:  { color: '#FFFFFF' },
  areaBtnIntText:  { color: '#FFFFFF' },

  globalActions:       { flexDirection: 'row', gap: 8, marginHorizontal: 16, marginTop: 12 },
  globalBtn:           { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 12, paddingVertical: 11, borderWidth: 1 },
  globalBtnAdd:        { backgroundColor: C.light, borderColor: C.border },
  globalBtnRemove:     { backgroundColor: '#FFF1F2', borderColor: '#FECDD3' },
  globalBtnDisabled:   { opacity: 0.4 },
  globalBtnAddText:    { color: C.primary, fontSize: 13, fontWeight: '800' },
  globalBtnRemoveText: { color: '#B91C1C', fontSize: 13, fontWeight: '800' },
  globalBtnTextDisabled:{ color: '#94A3B8' },

  divider:     { height: 1, backgroundColor: '#F1F5F9', marginTop: 12 },
  list:        { flex: 1 },
  listContent: { paddingHorizontal: 16, paddingTop: 4 },

  empty:      { alignItems: 'center', paddingVertical: 40, gap: 8 },
  emptyTitle: { color: '#475569', fontSize: 15, fontWeight: '700' },
  emptySub:   { color: '#94A3B8', fontSize: 13 },

  group:       { paddingTop: 4 },
  groupHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 11 },
  groupDot:    { width: 10, height: 10, borderRadius: 5 },
  groupTitle:  { color: '#0F172A', fontSize: 13, fontWeight: '800', flex: 1 },
  groupMeta:   { color: '#94A3B8', fontSize: 11, fontWeight: '600' },

  stageRow:   { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingLeft: 28, borderTopWidth: 1, borderTopColor: '#F8FAFC' },
  statusDot:  { width: 9, height: 9, borderRadius: 5, flexShrink: 0 },
  dotGreen:   { backgroundColor: '#059669' },
  dotAmber:   { backgroundColor: '#D97706' },
  dotGray:    { backgroundColor: '#CBD5E1' },

  stageInfo:  { flex: 1, gap: 4 },
  stageName:  { color: '#0F172A', fontSize: 14, fontWeight: '700' },
  stageMeta:  { flexDirection: 'row', alignItems: 'center', gap: 8 },
  areaBadge:         { flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  areaBadgeExt:      { backgroundColor: '#FEF3C7' },
  areaBadgeInt:      { backgroundColor: '#E0F2FE' },
  areaBadgeText:     { fontSize: 10, fontWeight: '700' },
  areaBadgeTextExt:  { color: '#92400E' },
  areaBadgeTextInt:  { color: '#0369A1' },
  coverageText:      { fontSize: 12, fontWeight: '700' },
  coverageGreen:     { color: '#059669' },
  coverageAmber:     { color: '#D97706' },
  coverageGray:      { color: '#94A3B8' },

  stageActions:  { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 0 },
  addBtn:        { width: 32, height: 32, borderRadius: 10, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' },
  removeBtn:     { width: 32, height: 32, borderRadius: 10, backgroundColor: '#FFF1F2', borderWidth: 1, borderColor: '#FECDD3', alignItems: 'center', justifyContent: 'center' },
  completeCheck: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },

  backToTopFab: {
    position: 'absolute', right: 16, bottom: 16,
    width: 38, height: 38, borderRadius: 19,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#94A3B8',
    shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 4,
  },

  confirmOverlay:     { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(15,23,42,0.7)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  confirmCard:        { width: '100%', backgroundColor: '#FFFFFF', borderRadius: 18, padding: 24, alignItems: 'center', gap: 12 },
  confirmIcon:        { width: 60, height: 60, borderRadius: 30, backgroundColor: '#FEE2E2', alignItems: 'center', justifyContent: 'center' },
  confirmTitle:       { color: '#0F172A', fontSize: 18, fontWeight: '900', textAlign: 'center' },
  confirmBody:        { color: '#475569', fontSize: 13, lineHeight: 20, textAlign: 'center' },
  confirmActions:     { flexDirection: 'row', gap: 10, alignSelf: 'stretch', marginTop: 4 },
  confirmCancel:      { flex: 1, alignItems: 'center', justifyContent: 'center', borderColor: '#CBD5E1', borderRadius: 12, borderWidth: 1, paddingVertical: 13 },
  confirmCancelText:  { color: '#475569', fontSize: 14, fontWeight: '800' },
  confirmConfirm:     { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#B91C1C', borderRadius: 12, paddingVertical: 13 },
  confirmConfirmText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
});
