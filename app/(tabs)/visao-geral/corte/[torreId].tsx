import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Text } from '@/src/ui/Text';

import * as db from '@/src/data/db';
import { useObras } from '@/src/data/ObrasContext';
import type { Apartment, ApartmentStatus, ChecklistItem, ChecklistState } from '@/src/data/mockObras';
import { getBlockedServiceGroups, getChecklistForApartment } from '@/src/data/serviceBlockers';
import { isCriticalStageForStatus } from '@/src/data/serviceStages';
import {
  LEVELS_ABOVE_FLOORS,
  LEVELS_BELOW_FLOORS,
  type TowerLevelDef,
} from '@/src/data/towerLevels';
import { getProgressMapStyle, statusConfig } from '@/src/ui/status';

// ── Prancha (technical drawing) tokens ────────────────────────────────────────
const INK = '#0F172A';
const PAPER = '#FFFFFF';
const SHEET_BG = '#F1F5F9';
const GUIDE = '#CBD5E1';
const HATCH_BLUE = '#93C5FD'; // hachura azul do corte original
const CRIT_BG = '#FEE2E2';
const CRIT_FG = '#B91C1C';

// Larguras da silhueta por tipo de nível (reproduz o degrau do corte).
const KIND_WIDTH: Record<TowerLevelDef['kind'], `${number}%`> = {
  tank: '52%',
  roof: '78%',
  body: '92%',
  below: '92%',
  site: '100%',
};

const BAND_MIN_H = 52;

type TowerItem = db.TowerChecklistItem;

const calcProgress = (items: { state: ChecklistState }[]) => {
  const score = items.reduce((t, i) => {
    if (i.state === 'ok' || i.state === 'notApplicable') return t + 1;
    if (i.state === 'partial') return t + 0.5;
    return t;
  }, 0);
  return items.length ? Math.round((score / items.length) * 100) : 0;
};

const getFloorOrder = (floor: string) => {
  const m = floor.match(/\d+/);
  return m ? Number(m[0]) : 0;
};

// Mesma regra de status da tela de apartamentos (para o KPI de "Críticos").
const calcStatus = (items: ChecklistItem[], progress: number): ApartmentStatus => {
  const pending = items.filter((i) => i.state === 'pending').length;
  const partial = items.filter((i) => i.state === 'partial').length;
  const manyPend = pending >= Math.max(3, Math.ceil(items.length * 0.35));
  const hasCrit = items.some(
    (i) => (i.state === 'pending' || i.state === 'partial') && isCriticalStageForStatus(i.label),
  );
  if (progress < 50 || manyPend || hasCrit) return 'critical';
  if ((progress >= 50 && progress <= 74) || partial > 0) return 'attention';
  if (progress >= 90 && pending === 0) return 'excellent';
  return 'good';
};

// Hachura diagonal dos níveis enterrados (como no corte original).
function Hatch({ height }: { height: number }) {
  const lines = Math.ceil(400 / 16) + 4;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { overflow: 'hidden' }]}>
      {Array.from({ length: lines }).map((_, i) => (
        <View
          key={i}
          style={{
            position: 'absolute',
            left: i * 16 - height,
            top: -height,
            width: 1,
            height: height * 3,
            backgroundColor: HATCH_BLUE,
            transform: [{ rotate: '45deg' }],
          }}
        />
      ))}
    </View>
  );
}

export default function CorteDaTorreScreen() {
  const { torreId } = useLocalSearchParams<{ torreId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { getTowerById, getApartmentsByTower } = useObras();

  const tower = getTowerById(torreId);
  const towerApartments = getApartmentsByTower(torreId);

  const [towerItems, setTowerItems] = useState<TowerItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(true);
  const [needsMigration, setNeedsMigration] = useState(false);
  const [expandedFloor, setExpandedFloor] = useState<string | null>(null);

  const loadItems = useCallback(async () => {
    if (!torreId) return;
    setLoadingItems(true);
    try {
      const items = await db.loadTowerChecklist(torreId);
      setTowerItems(items);
      setNeedsMigration(false);
    } catch (e) {
      if (db.isMissingTowerColumns(e)) setNeedsMigration(true);
    } finally {
      setLoadingItems(false);
    }
  }, [torreId]);

  // Recarrega ao focar — reflete as marcações feitas na tela do nível.
  useFocusEffect(useCallback(() => { loadItems(); }, [loadItems]));

  // ── Agregações ───────────────────────────────────────────────────────────────
  const itemsByLevel = useMemo(() => {
    const map = new Map<string, TowerItem[]>();
    for (const item of towerItems) {
      if (!map.has(item.levelCode)) map.set(item.levelCode, []);
      map.get(item.levelCode)!.push(item);
    }
    return map;
  }, [towerItems]);

  const floors = useMemo(() => {
    const map = new Map<string, Apartment[]>();
    for (const apt of towerApartments) {
      if (!map.has(apt.floor)) map.set(apt.floor, []);
      map.get(apt.floor)!.push(apt);
    }
    return [...map.entries()]
      .map(([floor, apts]) => ({
        floor,
        order: getFloorOrder(floor),
        apts: [...apts].sort((a, b) => a.number.localeCompare(b.number, 'pt-BR', { numeric: true })),
        progress: Math.round(apts.reduce((t, a) => t + a.progress, 0) / apts.length),
        hasCritical: apts.some((a) => a.status === 'critical'),
      }))
      .sort((a, b) => b.order - a.order); // topo do prédio primeiro
  }, [towerApartments]);

  // KPIs iguais aos da tela de apartamentos (computados a partir do checklist).
  const towerStats = useMemo(() => {
    const summaries = towerApartments.map((apartment) => {
      const checklist = getChecklistForApartment(apartment);
      const progress = calcProgress(checklist);
      return {
        progress,
        statusKey: calcStatus(checklist, progress),
        pendingCount: checklist.filter((i) => i.state === 'pending' || i.state === 'partial').length,
        blockedCount: getBlockedServiceGroups(checklist).reduce((t, g) => t + g.blockedServices.length, 0),
        observationCount: checklist.filter((i) => i.comment?.trim()).length,
      };
    });
    const avgProgress = summaries.length
      ? Math.round(summaries.reduce((t, sm) => t + sm.progress, 0) / summaries.length)
      : 0;
    return {
      avgProgress,
      criticalCount: summaries.filter((sm) => sm.statusKey === 'critical').length,
      totalPending: summaries.reduce((t, sm) => t + sm.pendingCount, 0),
      totalBlocked: summaries.reduce((t, sm) => t + sm.blockedCount, 0),
      totalObservations: summaries.reduce((t, sm) => t + sm.observationCount, 0),
    };
  }, [towerApartments]);

  const levelAgg = useCallback(
    (def: TowerLevelDef) => {
      const items = itemsByLevel.get(def.code) ?? [];
      if (items.length === 0) return { items, progress: 0, ghost: true, critical: false };
      const critical = items.some(
        (i) => (i.state === 'pending' || i.state === 'partial') && isCriticalStageForStatus(i.label),
      );
      return { items, progress: calcProgress(items), ghost: false, critical };
    },
    [itemsByLevel],
  );

  // ── Render helpers ────────────────────────────────────────────────────────────
  const renderGuide = () => <View pointerEvents="none" style={s.guideLine} />;

  const renderLevelBand = (def: TowerLevelDef) => {
    const { items, progress, ghost, critical } = levelAgg(def);
    const map = getProgressMapStyle(progress);
    const fg = critical ? CRIT_FG : map.fg;
    const bg = critical ? CRIT_BG : map.bg;
    const hatched = def.kind === 'below';
    return (
      <View key={def.code} style={s.row}>
        {renderGuide()}
        <Text style={s.rail}>{def.rail}</Text>
        <Pressable
          onPress={() => router.push(`/visao-geral/nivel/${torreId}/${def.code}` as never)}
          disabled={needsMigration}
          style={[
            s.band,
            { width: KIND_WIDTH[def.kind] },
            def.kind === 'site' && s.bandSite,
            ghost ? s.bandGhost : { backgroundColor: bg },
            needsMigration && s.bandDisabled,
          ]}>
          {hatched && !ghost && <Hatch height={BAND_MIN_H} />}
          <View style={s.bandInner}>
            <View style={s.bandTextWrap}>
              <Text style={[s.bandLabel, ghost && s.bandLabelGhost]} numberOfLines={1}>
                {def.label.toUpperCase()}
              </Text>
              <Text style={s.bandSub} numberOfLines={1}>
                {ghost
                  ? def.hint
                  : `${items.length} ${items.length === 1 ? 'etapa' : 'etapas'}${critical ? ' · etapa crítica em aberto' : ''}`}
              </Text>
            </View>
            {ghost ? (
              <MaterialCommunityIcons name="plus" size={16} color="#94A3B8" />
            ) : (
              <Text style={[s.bandPct, { color: fg }]}>{progress}%</Text>
            )}
          </View>
        </Pressable>
      </View>
    );
  };

  const renderFloorBand = (floor: (typeof floors)[number]) => {
    const map = getProgressMapStyle(floor.progress);
    const fg = floor.hasCritical ? CRIT_FG : map.fg;
    const bg = floor.hasCritical ? CRIT_BG : map.bg;
    const expanded = expandedFloor === floor.floor;
    return (
      <View key={floor.floor}>
        <View style={s.row}>
          {renderGuide()}
          <Text style={s.rail}>{getFloorOrder(floor.floor) || 'T'}</Text>
          <Pressable
            onPress={() => setExpandedFloor(expanded ? null : floor.floor)}
            style={[
              s.band,
              { width: KIND_WIDTH.body, backgroundColor: bg },
              expanded && s.bandExpanded,
              expanded && s.bandExpandedFlush,
            ]}>
            <View style={s.bandInner}>
              <View style={s.bandTextWrap}>
                <Text style={s.bandLabel} numberOfLines={1}>{floor.floor.toUpperCase()}</Text>
                <Text style={s.bandSub}>
                  {floor.apts.length} {floor.apts.length === 1 ? 'apto' : 'aptos'}
                  {floor.hasCritical ? ' · unidade crítica' : ''}
                </Text>
              </View>
              <Text style={[s.bandPct, { color: fg }]}>{floor.progress}%</Text>
              <MaterialCommunityIcons
                name={expanded ? 'chevron-up' : 'chevron-down'}
                size={16}
                color="#94A3B8"
              />
            </View>
          </Pressable>
        </View>
        {expanded && (
          <View style={s.aptDrawerRow}>
            <View style={s.aptDrawerRail} />
            <View style={[s.aptDrawer, { width: KIND_WIDTH.body, backgroundColor: bg, borderColor: fg }]}>
              <Text style={[s.aptDrawerHint, { color: fg }]}>Apartamentos deste pavimento</Text>
              <View style={s.aptRow}>
                {floor.apts.map((apt) => {
                  const noProgress = apt.progress === 0;
                  const cfg = statusConfig[apt.status];
                  // Sem avanço → cinza; com avanço → cor do status.
                  const dot = noProgress ? '#94A3B8' : cfg.color;
                  const chipBg = noProgress ? '#FFFFFF' : cfg.background;
                  const chipBorder = noProgress ? '#CBD5E1' : cfg.border;
                  const chipText = noProgress ? '#64748B' : cfg.color;
                  return (
                    <Pressable
                      key={apt.id}
                      onPress={() => router.push(`/visao-geral/apartamentos/${apt.id}` as never)}
                      style={[s.aptChip, { backgroundColor: chipBg, borderColor: chipBorder }]}>
                      <View style={[s.aptDot, { backgroundColor: dot }]} />
                      <Text style={[s.aptChipText, { color: chipText }]}>{apt.number}</Text>
                      <Text style={[s.aptChipPct, { color: chipText }]}>{apt.progress}%</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </View>
        )}
      </View>
    );
  };

  // Níveis renderizados de cima para baixo, como no corte.
  const aboveLevels = [...LEVELS_ABOVE_FLOORS].reverse();
  const belowLevels = [...LEVELS_BELOW_FLOORS].reverse(); // terreo, sobressolo, fundacao, terreno

  if (!tower) {
    return (
      <View style={[s.screen, s.center]}>
        <Text style={s.emptyText}>Torre não encontrada.</Text>
      </View>
    );
  }

  const headerColor = getProgressMapStyle(towerStats.avgProgress).fg;

  return (
    <View style={s.screen}>
      {/* ── Cabeçalho (faixa colorida, como no restante do app) ── */}
      <View style={[s.header, { paddingTop: insets.top + 12, backgroundColor: headerColor }]}>
        <Pressable onPress={() => router.push('/(tabs)/visao-geral' as never)} style={s.headerBack}>
          <MaterialCommunityIcons name="chevron-left" size={26} color="rgba(255,255,255,0.9)" />
          <Text style={s.headerBackText}>Visão Geral</Text>
        </Pressable>
        <View style={s.headerTop}>
          <MaterialCommunityIcons name="office-building-outline" size={30} color="#FFFFFF" />
          <View style={s.headerInfo}>
            <Text style={s.headerTitle}>{tower.name}</Text>
            <Text style={s.headerSub}>{[tower.block, tower.position].filter(Boolean).join(' · ')}</Text>
          </View>
          <View style={s.headerCount}>
            <Text style={s.headerCountValue}>{towerApartments.length}</Text>
            <Text style={s.headerCountLabel}>unid.</Text>
          </View>
        </View>
        <View style={s.headerBar}>
          <View style={[s.headerBarFill, { width: `${towerStats.avgProgress}%` as `${number}%` }]} />
        </View>
        <View style={s.headerMetaRow}>
          <Text style={s.headerBarLabel}>{`${towerStats.avgProgress}% de avanço médio`}</Text>
          <Pressable onPress={() => router.push(`/visao-geral/${torreId}` as never)} style={s.headerAction}>
            <MaterialCommunityIcons name="format-list-bulleted" size={16} color="#FFFFFF" />
            <Text style={s.headerActionText}>Apartamentos</Text>
          </Pressable>
        </View>
      </View>

      <ScrollView contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 32 }]}>
        {/* ── KPIs (mesmos da tela de apartamentos) ── */}
        <View style={s.kpiRow}>
          {[
            { icon: 'check-circle-outline', value: `${towerStats.avgProgress}%`, label: 'Avanço', color: '#2563EB', bg: '#EFF6FF' },
            { icon: 'close-circle-outline', value: towerStats.criticalCount, label: 'Críticos', color: towerStats.criticalCount > 0 ? '#B91C1C' : '#047857', bg: towerStats.criticalCount > 0 ? '#FEE2E2' : '#D1FAE5' },
            { icon: 'alert-outline', value: towerStats.totalPending, label: 'Em aberto', color: towerStats.totalPending > 0 ? '#B45309' : '#047857', bg: towerStats.totalPending > 0 ? '#FEF3C7' : '#D1FAE5' },
            { icon: 'lock-outline', value: towerStats.totalBlocked, label: 'Travados', color: towerStats.totalBlocked > 0 ? '#7C3AED' : '#047857', bg: towerStats.totalBlocked > 0 ? '#EDE9FE' : '#D1FAE5' },
            { icon: 'note-text-outline', value: towerStats.totalObservations, label: 'Observações', color: towerStats.totalObservations > 0 ? '#0891B2' : '#047857', bg: towerStats.totalObservations > 0 ? '#E0F2FE' : '#D1FAE5' },
          ].map((k) => (
            <View key={k.label} style={[s.kpiCard, { backgroundColor: k.bg }]}>
              <MaterialCommunityIcons name={k.icon as never} size={18} color={k.color} />
              <Text style={[s.kpiValue, { color: k.color }]}>{k.value}</Text>
              <Text style={[s.kpiLabel, { color: k.color }]}>{k.label}</Text>
            </View>
          ))}
        </View>

        {needsMigration && (
          <View style={s.migrationCard}>
            <MaterialCommunityIcons name="database-alert-outline" size={20} color="#B45309" />
            <View style={s.migrationTextWrap}>
              <Text style={s.migrationTitle}>Banco ainda sem etapas de torre</Text>
              <Text style={s.migrationText}>
                Aplique a migração supabase/migrations/20260703000000_tower_checklist.sql e tente de novo.
              </Text>
            </View>
            <Pressable onPress={loadItems} style={s.migrationRetry}>
              <Text style={s.migrationRetryText}>Tentar de novo</Text>
            </Pressable>
          </View>
        )}

        {/* ── Legenda ── */}
        <View style={s.legend}>
          <View style={s.legendItem}>
            <View style={[s.legendSwatch, { backgroundColor: '#D1FAE5', borderColor: '#A7F3D0' }]} />
            <Text style={s.legendText}>avançado</Text>
          </View>
          <View style={s.legendItem}>
            <View style={[s.legendSwatch, { backgroundColor: '#FEF3C7', borderColor: '#FDE68A' }]} />
            <Text style={s.legendText}>em andamento</Text>
          </View>
          <View style={s.legendItem}>
            <View style={[s.legendSwatch, { backgroundColor: CRIT_BG, borderColor: '#FCA5A5' }]} />
            <Text style={s.legendText}>crítico</Text>
          </View>
          <View style={s.legendItem}>
            <View style={[s.legendSwatch, s.legendSwatchGhost]} />
            <Text style={s.legendText}>sem etapas</Text>
          </View>
        </View>

        {/* ── O corte ── */}
        {loadingItems && !needsMigration ? (
          <View style={s.center}>
            <ActivityIndicator color="#2563EB" />
          </View>
        ) : (
          <View style={s.sheet}>
            {aboveLevels.map(renderLevelBand)}
            {floors.map(renderFloorBand)}
            {belowLevels.map((def, idx) => (
              <View key={def.code}>
                {renderLevelBand(def)}
                {/* Linha do terreno entre TÉRREO e SOBRESSOLO */}
                {idx === 0 && (
                  <View style={s.groundRow}>
                    <Text style={s.groundMark}>▽</Text>
                    <View style={s.groundLine} />
                    <Text style={s.groundLabel}>NÍVEL DO TERRENO</Text>
                  </View>
                )}
              </View>
            ))}
          </View>
        )}

        <Text style={s.footNote}>
          Toque em um nível para ver e marcar as etapas da torre. Toque em um pavimento para abrir os
          apartamentos.
        </Text>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: SHEET_BG },
  center: { alignItems: 'center', justifyContent: 'center', paddingVertical: 40 },
  emptyText: { color: '#64748B', fontSize: 14 },

  // Cabeçalho (faixa colorida, como no restante do app)
  header: { paddingHorizontal: 16, paddingBottom: 16, gap: 10 },
  headerBack: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', marginLeft: -4, gap: 2 },
  headerBackText: { color: 'rgba(255,255,255,0.9)', fontSize: 15, fontWeight: '600' },
  headerTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headerInfo: { flex: 1 },
  headerTitle: { color: '#FFFFFF', fontSize: 22, fontWeight: '900' },
  headerSub: { color: 'rgba(255,255,255,0.7)', fontSize: 13, marginTop: 2, fontWeight: '600' },
  headerCount: { alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.18)', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 8 },
  headerCountValue: { color: '#FFFFFF', fontSize: 22, fontWeight: '900' },
  headerCountLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 11, fontWeight: '700' },
  headerBar: { backgroundColor: 'rgba(0,0,0,0.2)', borderRadius: 999, height: 6, overflow: 'hidden' },
  headerBarFill: { height: '100%', borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.85)' },
  headerMetaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  headerBarLabel: { color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: '700' },
  headerAction: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(255,255,255,0.18)', borderColor: 'rgba(255,255,255,0.35)', borderWidth: 1,
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7,
  },
  headerActionText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },

  scroll: { padding: 14 },

  // KPIs (mesmos da tela de apartamentos)
  kpiRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  kpiCard: { flex: 1, borderRadius: 12, padding: 10, alignItems: 'center', gap: 3 },
  kpiValue: { fontSize: 18, fontWeight: '900' },
  kpiLabel: { fontSize: 10, fontWeight: '700', textAlign: 'center' },

  // Aviso de migração / erro
  migrationCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
    borderRadius: 10,
    padding: 10,
    marginBottom: 12,
  },
  migrationTextWrap: { flex: 1 },
  migrationTitle: { fontSize: 12.5, fontWeight: '800', color: '#92400E' },
  migrationText: { fontSize: 11, color: '#B45309', marginTop: 2 },
  migrationRetry: {
    backgroundColor: '#F59E0B',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  migrationRetryText: { color: '#FFFFFF', fontSize: 11, fontWeight: '800' },

  // Legenda
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 10, paddingHorizontal: 2 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendSwatch: { width: 12, height: 12, borderRadius: 3, borderWidth: 1 },
  legendSwatchGhost: {
    backgroundColor: PAPER,
    borderColor: '#94A3B8',
    borderStyle: 'dashed',
  },
  legendText: { fontSize: 10, color: '#64748B' },

  // A prancha
  sheet: {
    backgroundColor: PAPER,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingVertical: 18,
    paddingHorizontal: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: BAND_MIN_H + 6,
    position: 'relative',
  },
  guideLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '50%',
    borderTopWidth: 1,
    borderColor: GUIDE,
    borderStyle: 'dashed',
  },
  rail: {
    width: 30,
    fontSize: 12,
    fontWeight: '700',
    color: INK,
    textAlign: 'center',
  },
  band: {
    alignSelf: 'center',
    marginLeft: 'auto',
    marginRight: 'auto',
    minHeight: BAND_MIN_H,
    borderWidth: 1.5,
    borderColor: INK,
    backgroundColor: PAPER,
    justifyContent: 'center',
    marginVertical: 3,
    overflow: 'hidden',
  },
  bandSite: { minHeight: 40, borderStyle: 'solid', borderColor: '#475569' },
  bandGhost: { borderStyle: 'dashed', borderColor: '#94A3B8', backgroundColor: PAPER },
  bandDisabled: { opacity: 0.5 },
  bandExpanded: { borderBottomWidth: 3 },
  // Ao expandir, une a faixa ao "drawer" abaixo (cantos inferiores retos).
  bandExpandedFlush: { borderBottomLeftRadius: 0, borderBottomRightRadius: 0, borderBottomWidth: 0, marginBottom: 0 },
  bandInner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    gap: 8,
  },
  bandTextWrap: { flex: 1 },
  bandLabel: { fontSize: 12.5, fontWeight: '800', color: INK, letterSpacing: 0.4 },
  bandLabelGhost: { color: '#94A3B8' },
  bandSub: { fontSize: 10, color: '#64748B', marginTop: 1 },
  bandPct: { fontSize: 12, fontWeight: '700' },

  // Linha do terreno
  groundRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginVertical: 2 },
  groundMark: { fontSize: 11, color: INK, marginLeft: 24 },
  groundLine: { flex: 1, height: 2.5, backgroundColor: INK },
  groundLabel: { fontSize: 8, letterSpacing: 1, color: '#64748B' },

  // "Drawer" que engloba os apartamentos do pavimento (parece parte da faixa).
  aptDrawerRow: { flexDirection: 'row', alignItems: 'flex-start', marginTop: -3, marginBottom: 6 },
  aptDrawerRail: { width: 30 },
  aptDrawer: {
    marginLeft: 'auto',
    marginRight: 'auto',
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 10,
    borderWidth: 1.5,
    borderTopWidth: 0,
  },
  aptDrawerHint: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.6,
    opacity: 0.8,
    marginBottom: 8,
  },
  // Chips de apartamentos
  aptRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  aptChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  aptDot: { width: 6, height: 6, borderRadius: 3 },
  aptChipText: { fontSize: 11, fontWeight: '800' },
  aptChipPct: { fontSize: 9.5 },

  footNote: { fontSize: 11, color: '#94A3B8', textAlign: 'center', marginTop: 12, paddingHorizontal: 20 },
});
