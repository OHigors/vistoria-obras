import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '@/src/ui/Text';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import type { Apartment, ApartmentStatus, ChecklistItem } from '@/src/data/mockObras';
import { useObras } from '@/src/data/ObrasContext';
import { summarizeApartmentSchedule } from '@/src/data/schedule';
import { getBlockedServiceGroups, getChecklistForApartment } from '@/src/data/serviceBlockers';
import { categoryOrderIndex, isCriticalStageForStatus } from '@/src/data/serviceStages';
import { getProgressMapStyle, statusConfig } from '@/src/ui/status';
import { Skeleton } from '@/src/ui/Skeleton';

// ── Screen color token (indigo — distinct from the other Cronograma tools) ──────
const C = {
  primary: '#4F46E5',  // indigo-600
  light:   '#EEF2FF',  // indigo-50
  border:  '#C7D2FE',  // indigo-200
  medium:  '#6366F1',  // indigo-500
} as const;

type FloorView = 'Unidades' | 'Etapas';

type AptSummary = {
  apartment: Apartment;
  checklist: ChecklistItem[];
  progress: number;
  statusKey: ApartmentStatus;
  pendingCount: number;
  blockedCount: number;
  maxDelayDays: number;
};

type FloorSummary = {
  floor: string;
  order: number;
  apartments: AptSummary[];
  avgProgress: number;
  pendingTotal: number;
  blockedTotal: number;
  delayedCount: number;
  criticalCount: number;
};

type StepRollup = { label: string; categoria: string; done: number; total: number };

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

const getFloorOrder = (floor: string) => {
  const m = floor.match(/\d+/);
  return m ? Number(m[0]) : 0;
};

const sortAptByNumber = (a: AptSummary, b: AptSummary) => {
  const na = Number(a.apartment.number), nb = Number(b.apartment.number);
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
  return a.apartment.number.localeCompare(b.apartment.number, 'pt-BR');
};

export default function PavimentosScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { towers, serviceStages, getApartmentsByTower, loading } = useObras();

  const [towerId, setTowerId]   = useState<string | null>(null);
  const [openFloor, setOpenFloor] = useState<string | null>(null);
  const [floorView, setFloorView] = useState<FloorView>('Unidades');

  const activeTowerId = towerId ?? towers[0]?.id ?? null;
  const activeTower   = towers.find((t) => t.id === activeTowerId);
  const towerApartments = useMemo(
    () => (activeTowerId ? getApartmentsByTower(activeTowerId) : []),
    [activeTowerId, getApartmentsByTower],
  );

  // label → categoria, for the per-floor step rollup ordering
  const categoryByLabel = useMemo(() => {
    const map = new Map<string, string>();
    for (const stage of serviceStages) map.set(stage.nome, stage.categoria || 'Sem categoria');
    return map;
  }, [serviceStages]);

  const floors = useMemo<FloorSummary[]>(() => {
    const summaries: AptSummary[] = towerApartments.map((apartment) => {
      const checklist    = getChecklistForApartment(apartment);
      const pendingCount = checklist.filter((i) => i.state === 'pending' || i.state === 'partial').length;
      const blockedCount = getBlockedServiceGroups(checklist).reduce((t, g) => t + g.blockedServices.length, 0);
      const { maxDelayDays } = summarizeApartmentSchedule(apartment);
      const progress = calcProgress(checklist);
      return { apartment, checklist, progress, statusKey: calcStatus(checklist, progress), pendingCount, blockedCount, maxDelayDays };
    });

    const byFloor = new Map<string, AptSummary[]>();
    for (const sum of summaries) {
      const arr = byFloor.get(sum.apartment.floor) ?? [];
      arr.push(sum);
      byFloor.set(sum.apartment.floor, arr);
    }

    return [...byFloor.entries()]
      .map(([floor, apts]) => {
        apts.sort(sortAptByNumber);
        const avgProgress = apts.length ? Math.round(apts.reduce((t, a) => t + a.progress, 0) / apts.length) : 0;
        return {
          floor,
          order: getFloorOrder(floor),
          apartments: apts,
          avgProgress,
          pendingTotal:  apts.reduce((t, a) => t + a.pendingCount, 0),
          blockedTotal:  apts.reduce((t, a) => t + a.blockedCount, 0),
          delayedCount:  apts.filter((a) => a.maxDelayDays > 0).length,
          criticalCount: apts.filter((a) => a.statusKey === 'critical').length,
        };
      })
      // Descending: top floor first, like a real building elevation.
      .sort((a, b) => b.order - a.order);
  }, [towerApartments]);

  const stats = useMemo(() => {
    const avg = floors.length ? Math.round(floors.reduce((t, f) => t + f.avgProgress, 0) / floors.length) : 0;
    return {
      avgProgress:  avg,
      floorCount:   floors.length,
      doneFloors:   floors.filter((f) => f.avgProgress >= 100).length,
      criticFloors: floors.filter((f) => f.criticalCount > 0).length,
    };
  }, [floors]);

  const openFloorSummary = useMemo(
    () => floors.find((f) => f.floor === openFloor) ?? null,
    [floors, openFloor],
  );

  // Per-step completion across the open floor, grouped by category.
  const floorStepGroups = useMemo<[string, StepRollup[]][]>(() => {
    if (!openFloorSummary) return [];
    const map = new Map<string, StepRollup>();
    for (const apt of openFloorSummary.apartments) {
      for (const item of apt.checklist) {
        const entry = map.get(item.label) ?? {
          label: item.label,
          categoria: categoryByLabel.get(item.label) ?? 'Sem categoria',
          done: 0,
          total: 0,
        };
        entry.total += 1;
        if (item.state === 'ok' || item.state === 'notApplicable') entry.done += 1;
        map.set(item.label, entry);
      }
    }
    const groups = new Map<string, StepRollup[]>();
    for (const step of map.values()) {
      const arr = groups.get(step.categoria) ?? [];
      arr.push(step);
      groups.set(step.categoria, arr);
    }
    return [...groups.entries()]
      .map(([cat, steps]) => [cat, steps.sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'))] as [string, StepRollup[]])
      .sort(([a], [b]) => categoryOrderIndex(a) - categoryOrderIndex(b) || a.localeCompare(b, 'pt-BR'));
  }, [openFloorSummary, categoryByLabel]);

  const closeFloor = () => setOpenFloor(null);
  const openFloorModal = (floor: string) => { setFloorView('Unidades'); setOpenFloor(floor); };

  return (
    <>
      <ScrollView contentContainerStyle={s.container} showsVerticalScrollIndicator={false}>
        {/* HEADER — stripe colored by overall avg progress */}
        <View style={[s.header, { paddingTop: insets.top + 12, backgroundColor: getProgressMapStyle(stats.avgProgress).fg }]}>
          <Pressable onPress={() => router.push('/(tabs)/cronograma' as any)} style={s.headerBack}>
            <MaterialCommunityIcons name="chevron-left" size={26} color="rgba(255,255,255,0.9)" />
            <Text style={s.headerBackText}>Cronograma</Text>
          </Pressable>
          <View style={s.headerTop}>
            <MaterialCommunityIcons name="stairs" size={28} color="#FFFFFF" />
            <View style={{ flex: 1 }}>
              <Text style={s.headerTitle}>Mapa de Pavimentos</Text>
              <Text style={s.headerSub}>Avanço por andar e suas unidades</Text>
            </View>
            <View style={s.headerCount}>
              <Text style={s.headerCountValue}>{stats.avgProgress}%</Text>
              <Text style={s.headerCountLabel}>médio</Text>
            </View>
          </View>

          {/* Tower selector */}
          {towers.length > 1 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.towerRow}>
              {towers.map((t) => {
                const active = t.id === activeTowerId;
                return (
                  <Pressable key={t.id} onPress={() => setTowerId(t.id)} style={[s.towerChip, active && s.towerChipActive]}>
                    <MaterialCommunityIcons name="office-building" size={13} color={active ? C.primary : 'rgba(255,255,255,0.9)'} />
                    <Text style={[s.towerChipText, active && s.towerChipTextActive]}>{t.name}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}
        </View>

        {/* KPI ROW */}
        {loading ? (
          <View style={s.kpiRow}>
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} height={64} radius={12} style={{ flex: 1 }} />)}
          </View>
        ) : (
          <View style={s.kpiRow}>
            {[
              { icon: 'stairs',                value: stats.floorCount,   label: 'Pavimentos', color: '#4338CA', bg: '#EEF2FF' },
              { icon: 'trending-up',           value: `${stats.avgProgress}%`, label: 'Avanço', color: '#2563EB', bg: '#EFF6FF' },
              { icon: 'check-circle-outline',  value: stats.doneFloors,   label: 'Concluídos', color: stats.doneFloors > 0 ? '#047857' : '#64748B', bg: stats.doneFloors > 0 ? '#D1FAE5' : '#F1F5F9' },
              { icon: 'alert-circle-outline',  value: stats.criticFloors, label: 'Críticos', color: stats.criticFloors > 0 ? '#B91C1C' : '#047857', bg: stats.criticFloors > 0 ? '#FEE2E2' : '#D1FAE5' },
            ].map((k) => (
              <View key={k.label} style={[s.kpiCard, { backgroundColor: k.bg }]}>
                <MaterialCommunityIcons name={k.icon as any} size={17} color={k.color} />
                <Text style={[s.kpiValue, { color: k.color }]}>{k.value}</Text>
                <Text style={[s.kpiLabel, { color: k.color }]}>{k.label}</Text>
              </View>
            ))}
          </View>
        )}

        {/* BUILDING CROSS-SECTION */}
        {loading ? (
          <View style={s.building}>
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} height={78} radius={12} />)}
          </View>
        ) : floors.length === 0 ? (
          <View style={s.emptyPanel}>
            <MaterialCommunityIcons name="stairs-box" size={40} color="#CBD5E1" />
            <Text style={s.emptyTitle}>Nenhum pavimento</Text>
            <Text style={s.emptySub}>{activeTower ? `${activeTower.name} ainda não tem unidades cadastradas.` : 'Cadastre torres e unidades para visualizar.'}</Text>
          </View>
        ) : (
          <View style={s.building}>
            <View style={s.roof}><MaterialCommunityIcons name="home-roof" size={16} color="#94A3B8" /><Text style={s.roofText}>Cobertura</Text></View>
            {floors.map((f) => {
              const ms = getProgressMapStyle(f.avgProgress);
              return (
                <Pressable key={f.floor} onPress={() => openFloorModal(f.floor)} style={({ pressed }) => [s.floorBand, { borderLeftColor: ms.fg }, pressed && s.floorBandPressed]}>
                  <View style={s.floorBandHead}>
                    <View style={s.floorLabelWrap}>
                      <Text style={s.floorLabel}>{f.floor}</Text>
                      <Text style={s.floorUnits}>{f.apartments.length} un.</Text>
                    </View>
                    <View style={s.floorRight}>
                      <Text style={[s.floorPct, { color: ms.fg }]}>{f.avgProgress}%</Text>
                      <MaterialCommunityIcons name="chevron-right" size={18} color="#CBD5E1" />
                    </View>
                  </View>

                  {/* apartment cells — visual heatmap of the floor */}
                  <View style={s.cellRow}>
                    {f.apartments.map((a) => {
                      const cs = getProgressMapStyle(a.progress);
                      return (
                        <View key={a.apartment.id} style={[s.cell, { backgroundColor: cs.bg, borderColor: cs.border }]}>
                          <Text style={[s.cellNum, { color: cs.fg }]}>{a.apartment.number}</Text>
                          {(a.pendingCount > 0 || a.maxDelayDays > 0) && (
                            <View style={[s.cellDot, { backgroundColor: a.maxDelayDays > 0 ? '#B91C1C' : cs.fg }]} />
                          )}
                        </View>
                      );
                    })}
                  </View>

                  {/* compact flags */}
                  {(f.pendingTotal > 0 || f.blockedTotal > 0 || f.delayedCount > 0) && (
                    <View style={s.flagRow}>
                      {f.pendingTotal > 0 && <Flag icon="alert-circle-outline" color="#B45309" text={`${f.pendingTotal} pend.`} />}
                      {f.blockedTotal > 0 && <Flag icon="lock-outline" color="#7C3AED" text={`${f.blockedTotal} travado(s)`} />}
                      {f.delayedCount > 0 && <Flag icon="clock-alert-outline" color="#B91C1C" text={`${f.delayedCount} atrasado(s)`} />}
                    </View>
                  )}
                </Pressable>
              );
            })}
            <View style={s.ground} />
          </View>
        )}
      </ScrollView>

      {/* ── FLOOR MODAL ─────────────────────────────────────────────────────── */}
      <Modal animationType="slide" transparent visible={!!openFloorSummary} onRequestClose={closeFloor}>
        <Pressable style={mod.backdrop} onPress={closeFloor}>
          <Pressable style={mod.sheet} onPress={(e) => e.stopPropagation()}>
            <View style={mod.handle} />

            {openFloorSummary && (
              <>
                {/* Header */}
                <View style={mod.header}>
                  <View style={mod.headerLeft}>
                    <View style={mod.headerIcon}><MaterialCommunityIcons name="stairs" size={18} color={C.primary} /></View>
                    <View>
                      <Text style={mod.headerTitle}>{openFloorSummary.floor}</Text>
                      <Text style={mod.headerSub}>{`${activeTower?.name ?? ''} · ${openFloorSummary.apartments.length} unidade(s)`}</Text>
                    </View>
                  </View>
                  <Pressable onPress={closeFloor} style={mod.closeBtn} hitSlop={8}>
                    <MaterialCommunityIcons name="close" size={18} color="#475569" />
                  </Pressable>
                </View>

                {/* Floor mini-KPIs */}
                <View style={mod.kpiRow}>
                  <MiniKpi value={`${openFloorSummary.avgProgress}%`} label="Avanço" color="#2563EB" />
                  <MiniKpi value={openFloorSummary.pendingTotal} label="Pendências" color={openFloorSummary.pendingTotal > 0 ? '#B45309' : '#047857'} />
                  <MiniKpi value={openFloorSummary.blockedTotal} label="Travados" color={openFloorSummary.blockedTotal > 0 ? '#7C3AED' : '#047857'} />
                  <MiniKpi value={openFloorSummary.delayedCount} label="Atrasados" color={openFloorSummary.delayedCount > 0 ? '#B91C1C' : '#047857'} />
                </View>

                {/* View toggle */}
                <View style={mod.toggle}>
                  {(['Unidades', 'Etapas'] as FloorView[]).map((v) => {
                    const active = floorView === v;
                    return (
                      <Pressable key={v} onPress={() => setFloorView(v)} style={[mod.toggleBtn, active && mod.toggleBtnActive]}>
                        <MaterialCommunityIcons name={v === 'Unidades' ? 'door' : 'format-list-checks'} size={15} color={active ? C.primary : '#94A3B8'} />
                        <Text style={[mod.toggleText, active && mod.toggleTextActive]}>{v}</Text>
                      </Pressable>
                    );
                  })}
                </View>

                <ScrollView style={mod.list} contentContainerStyle={mod.listContent} showsVerticalScrollIndicator={false}>
                  {floorView === 'Unidades' ? (
                    openFloorSummary.apartments.map((a) => {
                      const st = statusConfig[a.statusKey];
                      const pc = getProgressMapStyle(a.progress).fg;
                      return (
                        <Pressable
                          key={a.apartment.id}
                          onPress={() => { closeFloor(); router.push({ pathname: '/visao-geral/apartamentos/[apartamentoId]', params: { apartamentoId: a.apartment.id } }); }}
                          style={mod.aptCard}>
                          <View style={[mod.aptStripe, { backgroundColor: pc }]} />
                          <View style={mod.aptInner}>
                            <View style={mod.aptTop}>
                              <Text style={mod.aptNumber}>{`Apto ${a.apartment.number}`}</Text>
                              <View style={mod.aptTopRight}>
                                <View style={[mod.statusBadge, { backgroundColor: st.background }]}><Text style={[mod.statusBadgeText, { color: st.color }]}>{st.label}</Text></View>
                                <Text style={mod.aptPct}>{`${a.progress}%`}</Text>
                              </View>
                            </View>
                            <View style={mod.aptBar}><View style={[mod.aptBarFill, { backgroundColor: pc, width: `${a.progress}%` as `${number}%` }]} /></View>
                            <View style={mod.pillRow}>
                              {a.pendingCount > 0 && <Flag icon="alert-circle-outline" color="#B45309" text={`${a.pendingCount} pend.`} />}
                              {a.blockedCount > 0 && <Flag icon="lock-outline" color="#7C3AED" text={`${a.blockedCount} travado(s)`} />}
                              {a.maxDelayDays > 0 && <Flag icon="clock-alert-outline" color="#B91C1C" text={`${a.maxDelayDays}d atraso`} />}
                              {a.pendingCount === 0 && a.blockedCount === 0 && a.maxDelayDays === 0 && <Flag icon="check-circle-outline" color="#047857" text="Sem pendências" />}
                              <View style={mod.openHint}><Text style={mod.openHintText}>Abrir</Text><MaterialCommunityIcons name="chevron-right" size={13} color={C.primary} /></View>
                            </View>
                          </View>
                        </Pressable>
                      );
                    })
                  ) : (
                    floorStepGroups.map(([cat, steps]) => (
                      <View key={cat} style={mod.stepGroup}>
                        <Text style={mod.stepGroupTitle}>{cat}</Text>
                        {steps.map((step) => {
                          const pct = step.total ? Math.round((step.done / step.total) * 100) : 0;
                          const done = pct >= 100;
                          const barColor = done ? '#047857' : pct > 0 ? '#D97706' : '#CBD5E1';
                          return (
                            <View key={step.label} style={mod.stepRow}>
                              <View style={mod.stepInfo}>
                                <Text style={mod.stepName} numberOfLines={1}>{step.label}</Text>
                                <View style={mod.stepBar}><View style={[mod.stepBarFill, { backgroundColor: barColor, width: `${pct}%` as `${number}%` }]} /></View>
                              </View>
                              <View style={[mod.stepCount, done && mod.stepCountDone]}>
                                <Text style={[mod.stepCountText, done && mod.stepCountTextDone]}>{`${step.done}/${step.total}`}</Text>
                              </View>
                            </View>
                          );
                        })}
                      </View>
                    ))
                  )}
                  <View style={{ height: 32 }} />
                </ScrollView>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const Flag = ({ icon, color, text }: { icon: string; color: string; text: string }) => (
  <View style={s.flag}>
    <MaterialCommunityIcons name={icon as any} size={11} color={color} />
    <Text style={[s.flagText, { color }]}>{text}</Text>
  </View>
);

const MiniKpi = ({ value, label, color }: { value: string | number; label: string; color: string }) => (
  <View style={mod.miniKpi}>
    <Text style={[mod.miniKpiValue, { color }]}>{value}</Text>
    <Text style={mod.miniKpiLabel}>{label}</Text>
  </View>
);

const s = StyleSheet.create({
  container: { gap: 12, paddingBottom: 36 },

  header:         { paddingHorizontal: 16, paddingBottom: 16, gap: 12 },
  headerBack:     { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', marginLeft: -4, gap: 2 },
  headerBackText: { color: 'rgba(255,255,255,0.9)', fontSize: 15, fontWeight: '600' },
  headerTop:      { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headerTitle:    { color: '#FFFFFF', fontSize: 21, fontWeight: '900' },
  headerSub:      { color: 'rgba(255,255,255,0.75)', fontSize: 13, marginTop: 2, fontWeight: '600' },
  headerCount:    { alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.18)', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 6 },
  headerCountValue:{ color: '#FFFFFF', fontSize: 20, fontWeight: '900' },
  headerCountLabel:{ color: 'rgba(255,255,255,0.7)', fontSize: 11, fontWeight: '700' },

  towerRow:        { flexDirection: 'row', gap: 8, paddingRight: 8 },
  towerChip:       { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(255,255,255,0.18)', borderColor: 'rgba(255,255,255,0.35)', borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  towerChipActive: { backgroundColor: '#FFFFFF', borderColor: '#FFFFFF' },
  towerChipText:   { color: 'rgba(255,255,255,0.95)', fontSize: 12, fontWeight: '800' },
  towerChipTextActive: { color: C.primary },

  kpiRow:   { flexDirection: 'row', gap: 8, paddingHorizontal: 16 },
  kpiCard:  { flex: 1, borderRadius: 12, padding: 10, alignItems: 'center', gap: 3 },
  kpiValue: { fontSize: 18, fontWeight: '900' },
  kpiLabel: { fontSize: 10, fontWeight: '700', textAlign: 'center' },

  building: { backgroundColor: '#FFFFFF', borderColor: '#E2E8F0', borderRadius: 16, borderWidth: 1, marginHorizontal: 16, padding: 12, gap: 8 },
  roof:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingBottom: 2 },
  roofText: { color: '#94A3B8', fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6 },
  ground:   { height: 6, borderRadius: 3, backgroundColor: '#E2E8F0', marginTop: 2 },

  floorBand:       { borderWidth: 1, borderColor: '#E2E8F0', borderLeftWidth: 4, borderRadius: 12, padding: 12, gap: 10, backgroundColor: '#FFFFFF' },
  floorBandPressed:{ backgroundColor: '#F8FAFC' },
  floorBandHead:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  floorLabelWrap:  { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  floorLabel:      { color: '#0F172A', fontSize: 15, fontWeight: '900' },
  floorUnits:      { color: '#94A3B8', fontSize: 12, fontWeight: '600' },
  floorRight:      { flexDirection: 'row', alignItems: 'center', gap: 2 },
  floorPct:        { fontSize: 16, fontWeight: '900' },

  cellRow:  { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  cell:     { width: 46, height: 40, borderRadius: 8, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  cellNum:  { fontSize: 13, fontWeight: '900' },
  cellDot:  { position: 'absolute', top: 4, right: 4, width: 5, height: 5, borderRadius: 3 },

  flagRow:  { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  flag:     { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#F8FAFC', borderColor: '#E2E8F0', borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  flagText: { fontSize: 11, fontWeight: '700' },

  emptyPanel: { alignItems: 'center', backgroundColor: '#FFFFFF', borderColor: '#E2E8F0', borderRadius: 14, borderWidth: 1, gap: 8, marginHorizontal: 16, paddingVertical: 40, paddingHorizontal: 24 },
  emptyTitle: { color: '#475569', fontSize: 15, fontWeight: '800' },
  emptySub:   { color: '#94A3B8', fontSize: 13, textAlign: 'center', lineHeight: 19 },
});

const mod = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.55)', justifyContent: 'flex-end' },
  sheet:    { backgroundColor: '#FFFFFF', borderTopLeftRadius: 22, borderTopRightRadius: 22, height: '80%' },
  handle:   { width: 36, height: 4, backgroundColor: '#E2E8F0', borderRadius: 2, alignSelf: 'center', marginTop: 10, marginBottom: 2 },

  header:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingTop: 10, paddingBottom: 12 },
  headerLeft:  { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerIcon:  { width: 36, height: 36, borderRadius: 10, backgroundColor: C.light, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: '#0F172A', fontSize: 17, fontWeight: '900' },
  headerSub:   { color: '#64748B', fontSize: 12, fontWeight: '600', marginTop: 1 },
  closeBtn:    { width: 32, height: 32, borderRadius: 16, backgroundColor: '#F1F5F9', alignItems: 'center', justifyContent: 'center' },

  kpiRow:      { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 12 },
  miniKpi:     { flex: 1, backgroundColor: '#F8FAFC', borderColor: '#E2E8F0', borderWidth: 1, borderRadius: 12, paddingVertical: 10, alignItems: 'center', gap: 2 },
  miniKpiValue:{ fontSize: 16, fontWeight: '900' },
  miniKpiLabel:{ color: '#64748B', fontSize: 10, fontWeight: '700' },

  toggle:          { flexDirection: 'row', backgroundColor: '#F1F5F9', borderRadius: 10, padding: 3, gap: 3, marginHorizontal: 16, marginBottom: 4 },
  toggleBtn:       { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 9, borderRadius: 8 },
  toggleBtnActive: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E2E8F0' },
  toggleText:      { color: '#94A3B8', fontSize: 13, fontWeight: '700' },
  toggleTextActive:{ color: C.primary },

  list:        { flex: 1 },
  listContent: { paddingHorizontal: 16, paddingTop: 8, gap: 8 },

  aptCard:   { flexDirection: 'row', backgroundColor: '#FFFFFF', borderColor: '#E2E8F0', borderWidth: 1, borderRadius: 14, overflow: 'hidden' },
  aptStripe: { width: 4 },
  aptInner:  { flex: 1, padding: 12, gap: 8 },
  aptTop:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  aptNumber: { color: '#0F172A', fontSize: 16, fontWeight: '900' },
  aptTopRight:{ flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusBadge:{ borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 },
  statusBadgeText: { fontSize: 10, fontWeight: '900' },
  aptPct:    { color: '#0F172A', fontSize: 16, fontWeight: '900' },
  aptBar:    { backgroundColor: '#E2E8F0', borderRadius: 999, height: 6, overflow: 'hidden' },
  aptBarFill:{ height: '100%', borderRadius: 999 },
  pillRow:   { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  openHint:  { flexDirection: 'row', alignItems: 'center', gap: 1, marginLeft: 'auto' },
  openHintText: { color: C.primary, fontSize: 12, fontWeight: '800' },

  stepGroup:      { gap: 6, paddingTop: 6 },
  stepGroupTitle: { color: '#475569', fontSize: 11, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.6 },
  stepRow:        { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepInfo:       { flex: 1, gap: 5 },
  stepName:       { color: '#0F172A', fontSize: 13, fontWeight: '600' },
  stepBar:        { backgroundColor: '#E2E8F0', borderRadius: 999, height: 5, overflow: 'hidden' },
  stepBarFill:    { height: '100%', borderRadius: 999 },
  stepCount:      { minWidth: 42, alignItems: 'center', backgroundColor: '#F1F5F9', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  stepCountDone:  { backgroundColor: '#D1FAE5' },
  stepCountText:  { color: '#475569', fontSize: 12, fontWeight: '800' },
  stepCountTextDone: { color: '#047857' },
});
