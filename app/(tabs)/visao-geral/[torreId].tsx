import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '@/src/ui/Text';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import type { Apartment, ApartmentStatus, ChecklistItem } from '@/src/data/mockObras';
import { useObras } from '@/src/data/ObrasContext';
import { summarizeApartmentSchedule } from '@/src/data/schedule';
import { getBlockedServiceGroups, getChecklistForApartment } from '@/src/data/serviceBlockers';
import { isCriticalStageForStatus } from '@/src/data/serviceStages';
import { getProgressColor, statusConfig } from '@/src/ui/status';

const viewModes = ['Lista', 'Mapa'] as const;
const filterOptions = [
  'Todos',
  'Excelente',
  'Bom',
  'Atenção',
  'Crítico',
  'Com pendência',
  'Com atraso',
  'Travado',
] as const;

type ViewMode = (typeof viewModes)[number];
type FilterOption = (typeof filterOptions)[number];

type ApartmentSummary = {
  apartment: Apartment;
  blockedCount: number;
  checklist: ChecklistItem[];
  maxDelayDays: number;
  mostDelayedService?: string;
  pendingCount: number;
  progress: number;
  statusKey: ApartmentStatus;
};

const calculateProgress = (items: ChecklistItem[]) => {
  const score = items.reduce((total, item) => {
    if (item.state === 'ok' || item.state === 'notApplicable') return total + 1;
    if (item.state === 'partial') return total + 0.5;
    return total;
  }, 0);
  return items.length ? Math.round((score / items.length) * 100) : 0;
};

const calculateStatus = (items: ChecklistItem[], progress: number): ApartmentStatus => {
  const pendingCount = items.filter((i) => i.state === 'pending').length;
  const partialCount = items.filter((i) => i.state === 'partial').length;
  const manyPending = pendingCount >= Math.max(3, Math.ceil(items.length * 0.35));
  const hasCritical = items.some(
    (i) => (i.state === 'pending' || i.state === 'partial') && isCriticalStageForStatus(i.label),
  );
  if (progress < 50 || manyPending || hasCritical) return 'critical';
  if ((progress >= 50 && progress <= 74) || partialCount > 0) return 'attention';
  if (progress >= 90 && pendingCount === 0) return 'excellent';
  return 'good';
};

const normalizeSearch = (value: string) =>
  value.toLocaleLowerCase('pt-BR').replace(/apartamento|ap|\s/g, '');

const getFloorOrder = (floor: string) => {
  const match = floor.match(/\d+/);
  return match ? Number(match[0]) : 0;
};

const STATUS_FILTER_MAP: Record<FilterOption, (s: ApartmentSummary) => boolean> = {
  Todos: () => true,
  Excelente: (s) => statusConfig[s.statusKey].label === 'Excelente',
  Bom: (s) => statusConfig[s.statusKey].label === 'Bom',
  Atenção: (s) => statusConfig[s.statusKey].label === 'Atenção',
  Crítico: (s) => statusConfig[s.statusKey].label === 'Crítico',
  'Com pendência': (s) => s.pendingCount > 0,
  'Com atraso': (s) => s.maxDelayDays > 0,
  Travado: (s) => s.blockedCount > 0,
};

export default function TowerApartmentsScreen() {
  const { torreId } = useLocalSearchParams<{ torreId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { getTowerById, getApartmentsByTower, loading } = useObras();
  const tower = getTowerById(torreId);
  const towerApartments = getApartmentsByTower(torreId);
  const [viewMode, setViewMode] = useState<ViewMode>('Lista');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterOption>('Todos');

  const apartmentSummaries: ApartmentSummary[] = useMemo(
    () =>
      towerApartments.map((apartment) => {
        const checklist = getChecklistForApartment(apartment);
        const pendingCount = checklist.filter((i) => i.state === 'pending' || i.state === 'partial').length;
        const blockedCount = getBlockedServiceGroups(checklist).reduce((t, g) => t + g.blockedServices.length, 0);
        const scheduleSummary = summarizeApartmentSchedule(apartment);
        const progress = calculateProgress(checklist);
        return {
          apartment,
          blockedCount,
          checklist,
          maxDelayDays: scheduleSummary.maxDelayDays,
          mostDelayedService: scheduleSummary.mostDelayedService,
          pendingCount,
          progress,
          statusKey: calculateStatus(checklist, progress),
        };
      }),
    [towerApartments],
  );

  const filteredSummaries = useMemo(() => {
    const normalized = normalizeSearch(search);
    return apartmentSummaries.filter((s) => {
      const matchesSearch = !normalized || s.apartment.number.includes(normalized);
      return matchesSearch && STATUS_FILTER_MAP[filter](s);
    });
  }, [apartmentSummaries, search, filter]);

  const summariesByFloor = useMemo(
    () =>
      filteredSummaries.reduce<Record<string, ApartmentSummary[]>>((groups, s) => {
        groups[s.apartment.floor] = [...(groups[s.apartment.floor] ?? []), s];
        return groups;
      }, {}),
    [filteredSummaries],
  );

  const orderedFloors = useMemo(
    () => Object.keys(summariesByFloor).sort((a, b) => getFloorOrder(b) - getFloorOrder(a)),
    [summariesByFloor],
  );

  // Tower-level KPIs
  const towerStats = useMemo(() => {
    const avgProgress = apartmentSummaries.length
      ? Math.round(apartmentSummaries.reduce((t, s) => t + s.progress, 0) / apartmentSummaries.length)
      : 0;
    const criticalCount = apartmentSummaries.filter((s) => s.statusKey === 'critical').length;
    const totalPending = apartmentSummaries.reduce((t, s) => t + s.pendingCount, 0);
    const totalBlocked = apartmentSummaries.reduce((t, s) => t + s.blockedCount, 0);
    return { avgProgress, criticalCount, totalPending, totalBlocked };
  }, [apartmentSummaries]);

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
      <ScrollView contentContainerStyle={[s.container, { paddingTop: insets.top + 8 }]} showsVerticalScrollIndicator={false}>
        {backBar}

      {/* HEADER */}
      <View style={s.header}>
        <View style={s.headerTop}>
          <MaterialCommunityIcons name="office-building" size={32} color="#2563EB" />
          <View style={s.headerInfo}>
            <Text style={s.headerTitle}>{tower.name}</Text>
            <Text style={s.headerSub}>{tower.block} · {tower.position}</Text>
          </View>
          <View style={s.headerCount}>
            <Text style={s.headerCountValue}>{towerApartments.length}</Text>
            <Text style={s.headerCountLabel}>unid.</Text>
          </View>
        </View>
        {tower.description ? (
          <Text style={s.headerDesc}>{tower.description}</Text>
        ) : null}
        <View style={s.headerBar}>
          <View style={[s.headerBarFill, { width: `${towerStats.avgProgress}%` as `${number}%`, backgroundColor: getProgressColor(towerStats.avgProgress) }]} />
        </View>
        <Text style={s.headerBarLabel}>{towerStats.avgProgress}% de avanço médio</Text>
      </View>

      {/* KPI ROW */}
      <View style={s.kpiRow}>
        {[
          { icon: 'check-circle-outline', value: `${towerStats.avgProgress}%`, label: 'Avanço', color: '#2563EB', bg: '#EFF6FF' },
          { icon: 'close-circle-outline', value: towerStats.criticalCount, label: 'Críticos', color: towerStats.criticalCount > 0 ? '#B91C1C' : '#047857', bg: towerStats.criticalCount > 0 ? '#FEE2E2' : '#D1FAE5' },
          { icon: 'alert-outline', value: towerStats.totalPending, label: 'Pendências', color: towerStats.totalPending > 0 ? '#B45309' : '#047857', bg: towerStats.totalPending > 0 ? '#FEF3C7' : '#D1FAE5' },
          { icon: 'lock-outline', value: towerStats.totalBlocked, label: 'Travados', color: towerStats.totalBlocked > 0 ? '#7C3AED' : '#047857', bg: towerStats.totalBlocked > 0 ? '#EDE9FE' : '#D1FAE5' },
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
        {/* Search */}
        <View style={s.searchRow}>
          <MaterialCommunityIcons name="magnify" size={18} color="#94A3B8" style={s.searchIcon} />
          <TextInput
            onChangeText={setSearch}
            placeholder="Pesquisar apartamento..."
            placeholderTextColor="#94A3B8"
            style={s.searchInput}
            value={search}
          />
          {search.length > 0 && (
            <Pressable onPress={() => setSearch('')} style={s.searchClear}>
              <MaterialCommunityIcons name="close-circle" size={16} color="#94A3B8" />
            </Pressable>
          )}
        </View>

        {/* View mode toggle */}
        <View style={s.viewToggle}>
          {viewModes.map((mode) => {
            const active = viewMode === mode;
            const icon = mode === 'Lista' ? 'view-list' : 'grid';
            return (
              <Pressable key={mode} onPress={() => setViewMode(mode)} style={[s.viewBtn, active && s.viewBtnActive]}>
                <MaterialCommunityIcons name={icon as any} size={16} color={active ? '#2563EB' : '#94A3B8'} />
                <Text style={[s.viewBtnText, active && s.viewBtnTextActive]}>{mode}</Text>
              </Pressable>
            );
          })}
        </View>

        {/* Filter chips */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filterRow}>
          {filterOptions.map((option) => {
            const active = filter === option;
            return (
              <Pressable key={option} onPress={() => setFilter(option)} style={[s.filterChip, active && s.filterChipActive]}>
                <Text style={[s.filterChipText, active && s.filterChipTextActive]}>{option}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* RESULTS COUNT */}
      {filter !== 'Todos' || search ? (
        <Text style={s.resultsCount}>
          {filteredSummaries.length} de {apartmentSummaries.length} apartamento(s)
        </Text>
      ) : null}

      {/* EMPTY */}
      {filteredSummaries.length === 0 ? (
        <View style={s.emptyPanel}>
          <MaterialCommunityIcons name="filter-remove-outline" size={36} color="#CBD5E1" />
          <Text style={s.emptyPanelTitle}>Nenhum resultado</Text>
          <Text style={s.emptyPanelSub}>Tente ajustar os filtros ou a busca</Text>
        </View>
      ) : viewMode === 'Lista' ? (

        /* LIST VIEW */
        <View style={s.list}>
          {filteredSummaries.map((summary) => {
            const st = statusConfig[summary.statusKey];
            const progressColor = getProgressColor(summary.progress);
            const { apartment } = summary;
            return (
              <Pressable
                key={apartment.id}
                onPress={() => router.push({ pathname: '/visao-geral/apartamentos/[apartamentoId]', params: { apartamentoId: apartment.id } })}
                style={s.aptCard}>
                  <View style={[s.aptCardStripe, { backgroundColor: progressColor }]} />
                  <View style={s.aptCardInner}>
                    <View style={s.aptCardTop}>
                      <View style={s.aptCardLeft}>
                        <Text style={s.aptNumber}>Apto {apartment.number}</Text>
                        <Text style={s.aptFloor}>{apartment.floor}</Text>
                      </View>
                      <View style={s.aptCardRight}>
                        <View style={[s.statusBadge, { backgroundColor: st.background }]}>
                          <Text style={[s.statusBadgeText, { color: st.color }]}>{st.label}</Text>
                        </View>
                        <Text style={s.aptProgress}>{summary.progress}%</Text>
                      </View>
                    </View>

                    <View style={s.aptBar}>
                      <View style={[s.aptBarFill, { backgroundColor: progressColor, width: `${summary.progress}%` as `${number}%` }]} />
                    </View>

                    <View style={s.aptMetrics}>
                      {summary.pendingCount > 0 && (
                        <View style={s.metricPill}>
                          <MaterialCommunityIcons name="alert-circle-outline" size={11} color="#B45309" />
                          <Text style={[s.metricPillText, { color: '#B45309' }]}>{summary.pendingCount} pendência(s)</Text>
                        </View>
                      )}
                      {summary.blockedCount > 0 && (
                        <View style={s.metricPill}>
                          <MaterialCommunityIcons name="lock-outline" size={11} color="#7C3AED" />
                          <Text style={[s.metricPillText, { color: '#7C3AED' }]}>{summary.blockedCount} travado(s)</Text>
                        </View>
                      )}
                      {summary.maxDelayDays > 0 && (
                        <View style={s.metricPill}>
                          <MaterialCommunityIcons name="clock-alert-outline" size={11} color="#B91C1C" />
                          <Text style={[s.metricPillText, { color: '#B91C1C' }]}>{summary.maxDelayDays}d atraso</Text>
                        </View>
                      )}
                      {summary.pendingCount === 0 && summary.blockedCount === 0 && summary.maxDelayDays === 0 && (
                        <View style={s.metricPill}>
                          <MaterialCommunityIcons name="check-circle-outline" size={11} color="#047857" />
                          <Text style={[s.metricPillText, { color: '#047857' }]}>Sem pendências</Text>
                        </View>
                      )}
                    </View>

                    <View style={s.aptCardFooter}>
                      <Text style={s.aptLastInspection}>
                        {apartment.lastInspection ? `Última vistoria: ${apartment.lastInspection}` : 'Sem vistoria registrada'}
                      </Text>
                      <View style={s.openBtn}>
                        <Text style={s.openBtnText}>Abrir</Text>
                        <MaterialCommunityIcons name="chevron-right" size={14} color="#2563EB" />
                      </View>
                    </View>
                  </View>
              </Pressable>
            );
          })}
        </View>

      ) : (

        /* MAP VIEW */
        <View style={s.mapPanel}>
          {/* Legend */}
          <View style={s.legend}>
            {[
              { label: '0-20%', color: getProgressColor(10) },
              { label: '20-40%', color: getProgressColor(30) },
              { label: '40-60%', color: getProgressColor(50) },
              { label: '60-80%', color: getProgressColor(70) },
              { label: '80-100%', color: getProgressColor(90) },
            ].map((band) => (
              <View key={band.label} style={s.legendItem}>
                <View style={[s.legendDot, { backgroundColor: band.color }]} />
                <Text style={s.legendText}>{band.label}</Text>
              </View>
            ))}
          </View>

          {/* Floors */}
          {orderedFloors.map((floor) => (
            <View key={floor} style={s.floorGroup}>
              <View style={s.floorHeader}>
                <MaterialCommunityIcons name="stairs" size={14} color="#64748B" />
                <Text style={s.floorTitle}>{floor}</Text>
                <Text style={s.floorCount}>{summariesByFloor[floor].length} un.</Text>
              </View>
              <View style={s.compactGrid}>
                {summariesByFloor[floor].map((summary) => {
                  const progressColor = getProgressColor(summary.progress);
                  return (
                    <Pressable
                      key={`map-${summary.apartment.id}`}
                      onPress={() => router.push({ pathname: '/visao-geral/apartamentos/[apartamentoId]', params: { apartamentoId: summary.apartment.id } })}
                      style={[s.mapUnit, { backgroundColor: '#FFFFFF', borderColor: progressColor }]}>
                      <Text style={[s.mapUnitNumber, { color: progressColor }]}>{summary.apartment.number}</Text>
                      <Text style={[s.mapUnitProgress, { color: progressColor }]}>{summary.progress}%</Text>
                      {summary.pendingCount > 0 && (
                        <View style={[s.mapUnitDot, { backgroundColor: progressColor }]} />
                      )}
                      {summary.pendingCount === 0 && <View style={s.mapUnitDot} />}
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ))}
        </View>
      )}

    </ScrollView>
    </>
  );
}

const s = StyleSheet.create({
  container: { gap: 12, paddingBottom: 32 },

  // back bar
  backBar: { paddingHorizontal: 8, paddingBottom: 4, backgroundColor: '#F8FAFC' },
  backBtn: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 2, paddingVertical: 6, paddingHorizontal: 4 },
  backBtnText: { color: '#0F172A', fontSize: 15, fontWeight: '600' },

  // empty
  emptyWrap: { flex: 1, backgroundColor: '#F8FAFC' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 32 },
  emptyTitle: { color: '#0F172A', fontSize: 18, fontWeight: '700' },
  emptyBtn: { backgroundColor: '#2563EB', borderRadius: 10, paddingHorizontal: 20, paddingVertical: 10 },
  emptyBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },

  // header
  header: { backgroundColor: '#FFFFFF', borderColor: '#E2E8F0', borderBottomWidth: 1, padding: 16, gap: 12 },
  headerTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headerInfo: { flex: 1 },
  headerTitle: { color: '#0F172A', fontSize: 22, fontWeight: '900' },
  headerSub: { color: '#64748B', fontSize: 13, marginTop: 2 },
  headerCount: { alignItems: 'center', backgroundColor: '#EFF6FF', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 8 },
  headerCountValue: { color: '#2563EB', fontSize: 22, fontWeight: '900' },
  headerCountLabel: { color: '#93C5FD', fontSize: 11, fontWeight: '700' },
  headerDesc: { color: '#475569', fontSize: 13, lineHeight: 18 },
  headerBar: { backgroundColor: '#E2E8F0', borderRadius: 999, height: 6, overflow: 'hidden' },
  headerBarFill: { height: '100%', backgroundColor: '#2563EB', borderRadius: 999 },
  headerBarLabel: { color: '#64748B', fontSize: 12, fontWeight: '600' },

  // kpi
  kpiRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16 },
  kpiCard: { flex: 1, borderRadius: 12, padding: 10, alignItems: 'center', gap: 3 },
  kpiValue: { fontSize: 18, fontWeight: '900' },
  kpiLabel: { fontSize: 10, fontWeight: '700', textAlign: 'center' },

  // controls
  controls: { backgroundColor: '#FFFFFF', borderColor: '#E2E8F0', borderRadius: 14, borderWidth: 1, gap: 12, marginHorizontal: 16, padding: 14 },
  searchRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F8FAFC', borderColor: '#E2E8F0', borderRadius: 10, borderWidth: 1, paddingHorizontal: 10, gap: 6 },
  searchIcon: {},
  searchInput: { flex: 1, color: '#0F172A', fontSize: 14, minHeight: 42 },
  searchClear: { padding: 4 },
  viewToggle: { flexDirection: 'row', backgroundColor: '#F1F5F9', borderRadius: 10, padding: 3, gap: 3 },
  viewBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 8, borderRadius: 8 },
  viewBtnActive: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E2E8F0' },
  viewBtnText: { color: '#94A3B8', fontSize: 13, fontWeight: '700' },
  viewBtnTextActive: { color: '#2563EB' },
  filterRow: { flexDirection: 'row', gap: 6, paddingBottom: 2 },
  filterChip: { borderRadius: 999, borderWidth: 1, borderColor: '#E2E8F0', paddingHorizontal: 12, paddingVertical: 7 },
  filterChipActive: { backgroundColor: '#EFF6FF', borderColor: '#2563EB' },
  filterChipText: { color: '#64748B', fontSize: 12, fontWeight: '700' },
  filterChipTextActive: { color: '#2563EB' },

  // results
  resultsCount: { color: '#94A3B8', fontSize: 12, fontWeight: '600', paddingHorizontal: 16 },

  // empty panel
  emptyPanel: { alignItems: 'center', backgroundColor: '#FFFFFF', borderColor: '#E2E8F0', borderRadius: 14, borderWidth: 1, gap: 8, marginHorizontal: 16, paddingVertical: 36 },
  emptyPanelTitle: { color: '#475569', fontSize: 15, fontWeight: '700' },
  emptyPanelSub: { color: '#94A3B8', fontSize: 13 },

  // list
  list: { gap: 8, paddingHorizontal: 16 },
  aptCard: { backgroundColor: '#FFFFFF', borderColor: '#E2E8F0', borderWidth: 1, borderRadius: 14, overflow: 'hidden', flexDirection: 'row' },
  aptCardStripe: { width: 4 },
  aptCardInner: { flex: 1, padding: 14, gap: 10 },
  aptCardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  aptCardLeft: { gap: 2 },
  aptNumber: { color: '#0F172A', fontSize: 17, fontWeight: '900' },
  aptFloor: { color: '#64748B', fontSize: 12 },
  aptCardRight: { alignItems: 'flex-end', gap: 6 },
  statusBadge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  statusBadgeText: { fontSize: 11, fontWeight: '900' },
  aptProgress: { color: '#0F172A', fontSize: 18, fontWeight: '900' },
  aptBar: { backgroundColor: '#E2E8F0', borderRadius: 999, height: 6, overflow: 'hidden' },
  aptBarFill: { height: '100%', borderRadius: 999 },
  aptMetrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  metricPill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#F8FAFC', borderColor: '#E2E8F0', borderRadius: 999, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 4 },
  metricPillText: { fontSize: 11, fontWeight: '700' },
  aptCardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderTopColor: '#F1F5F9', paddingTop: 8 },
  aptLastInspection: { color: '#94A3B8', fontSize: 11 },
  openBtn: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  openBtnText: { color: '#2563EB', fontSize: 12, fontWeight: '800' },

  // map
  mapPanel: { backgroundColor: '#FFFFFF', borderColor: '#E2E8F0', borderRadius: 14, borderWidth: 1, marginHorizontal: 16, padding: 14, gap: 16 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { color: '#475569', fontSize: 11, fontWeight: '700' },
  floorGroup: { gap: 8 },
  floorHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  floorTitle: { color: '#0F172A', fontSize: 13, fontWeight: '800', flex: 1 },
  floorCount: { color: '#94A3B8', fontSize: 11, fontWeight: '600' },
  compactGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  mapUnit: { alignItems: 'center', borderRadius: 10, borderWidth: 1, justifyContent: 'center', width: 68, height: 68, gap: 2 },
  mapUnitNumber: { fontSize: 13, fontWeight: '900' },
  mapUnitProgress: { fontSize: 10, fontWeight: '700' },
  mapUnitDot: { width: 6, height: 6, borderRadius: 3 },
});
