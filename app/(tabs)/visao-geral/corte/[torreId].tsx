import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
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
import { useObraScopeGuard } from '@/src/data/useObraScopeGuard';
import type { Apartment, ApartmentStatus, ChecklistItem, ChecklistState } from '@/src/data/mockObras';
import { getCachedChecklistsFor, getCachedTowerChecklist } from '@/src/data/checklistCache';
import { getBlockedServiceGroups, getChecklistForApartment } from '@/src/data/serviceBlockers';
import { isCriticalStageForStatus } from '@/src/data/serviceStages';
import { computeApartmentStatus as calcStatus } from '@/src/data/apartmentStatus';
import {
  FLOOR_SEGMENTS,
  floorSegmentCode,
  LEVELS_ABOVE_FLOORS,
  LEVELS_BELOW_FLOORS,
  type FloorSegmentPrefix,
  type TowerLevelDef,
} from '@/src/data/towerLevels';
import { getProgressMapStyle } from '@/src/ui/status';
import { ReadOnlyBanner } from '@/src/ui/ReadOnlyBanner';
import { Skeleton } from '@/src/ui/Skeleton';
import { useTutorialAnchor, useTutorialScreen } from '@/src/features/tutorial/TutorialContext';

// ── Prancha (technical drawing) tokens ────────────────────────────────────────
const INK = '#0F172A';
const PAPER = '#FFFFFF';
const SHEET_BG = '#F1F5F9';
const GUIDE = '#CBD5E1';
const HATCH_BLUE = '#93C5FD'; // hachura azul do corte original

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
// calcStatus vem de @/src/data/apartmentStatus (fórmula única compartilhada).

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
  const { getTowerById, getApartmentsByTower, canWrite } = useObras();

  const tower = getTowerById(torreId);
  // `getApartmentsByTower` faz um .filter() e devolve um ARRAY NOVO a cada chamada.
  // Sem este useMemo, a identidade dele mudava a cada render e derrubava toda a
  // cadeia de memos abaixo (towerApartmentsFull → towerStats → floors), refazendo
  // os cálculos pesados dos KPIs em TODO render em vez de só quando os dados mudam.
  const towerApartments = useMemo(() => getApartmentsByTower(torreId), [getApartmentsByTower, torreId]);
  // Trocou de obra? A torre desta URL não existe mais aqui — volta pra Visão Geral.
  useObraScopeGuard(Boolean(tower), '/visao-geral');

  const [towerItems, setTowerItems] = useState<TowerItem[]>([]);
  // LAZY: o contexto não traz mais o checklist dos apartamentos — esta tela carrega
  // o dos apartamentos DESTA torre (senão os KPIs abaixo ficam zerados).
  const [checklistByApt, setChecklistByApt] = useState<Awaited<ReturnType<typeof db.loadChecklistsForApartments>>>(new Map());
  const [loadingItems, setLoadingItems] = useState(true);
  const [needsMigration, setNeedsMigration] = useState(false);
  const [expandedFloor, setExpandedFloor] = useState<string | null>(null);

  // Tutorial: coach marks da primeira visita ao corte.
  useTutorialScreen('corte', Boolean(tower) && !loadingItems && !needsMigration);
  const legendaAnchor = useTutorialAnchor('corte.legenda');
  const pavimentoAnchor = useTutorialAnchor('corte.pavimento');
  const ghostAnchor = useTutorialAnchor('corte.ghost');
  const prumadaAnchor = useTutorialAnchor('corte.prumada');

  const loadItems = useCallback(async () => {
    if (!torreId) return;
    const aptIds = getApartmentsByTower(torreId).map((a) => a.id);
    // Stale-while-revalidate: se a última visita já baixou tudo, pinta na hora
    // com o cache e atualiza por baixo — o skeleton só aparece na PRIMEIRA visita
    // à torre. Antes, cada volta do apartamento/nível refazia o download inteiro
    // com skeleton na frente, e era essa a espera percebida.
    const cachedTower = getCachedTowerChecklist(torreId);
    const cachedByApt = getCachedChecklistsFor(aptIds);
    if (cachedTower && cachedByApt) {
      setTowerItems(cachedTower);
      setChecklistByApt(cachedByApt);
      setLoadingItems(false);
    } else {
      setLoadingItems(true);
    }
    // Espera os DOIS carregamentos (itens de nível + checklists dos apartamentos)
    // antes de baixar o skeleton — assim os KPIs nunca aparecem parcialmente.
    const [itemsRes, checklistRes] = await Promise.allSettled([
      db.loadTowerChecklist(torreId),
      db.loadChecklistsForApartments(aptIds),
    ]);
    if (itemsRes.status === 'fulfilled') {
      setTowerItems(itemsRes.value);
      setNeedsMigration(false);
    } else if (db.isMissingTowerColumns(itemsRes.reason)) {
      setNeedsMigration(true);
    }
    if (checklistRes.status === 'fulfilled') setChecklistByApt(checklistRes.value);
    setLoadingItems(false);
  }, [torreId, getApartmentsByTower]);

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

  // Apartamentos da torre com o checklist carregado sob demanda (o contexto vem vazio).
  const towerApartmentsFull = useMemo(
    () => towerApartments.map((a) => ({ ...a, checklist: checklistByApt.get(a.id) ?? [] })),
    [towerApartments, checklistByApt],
  );

  // KPIs iguais aos da tela de apartamentos (computados a partir do checklist).
  const towerStats = useMemo(() => {
    const summaries = towerApartmentsFull.map((apartment) => {
      const checklist = getChecklistForApartment(apartment);
      // Itens ainda não baixados? progress/status denormalizados (tabela
      // apartments, já no contexto) valem como fallback — o cabeçalho e os KPIs
      // de avanço/críticos aparecem certos desde o primeiro frame, em vez de 0%.
      const progress = checklist.length ? calcProgress(checklist) : apartment.progress;
      return {
        progress,
        statusKey: checklist.length ? calcStatus(checklist, progress) : apartment.status,
        pendingCount: checklist.filter((i) => i.state === 'pending' || i.state === 'partial').length,
        blockedCount: getBlockedServiceGroups(checklist).reduce((t, g) => t + g.blockedServices.length, 0),
        observationCount: checklist.filter((i) => i.comment?.trim()).length,
      };
    });
    const avgProgress = summaries.length
      ? Math.round(summaries.reduce((t, sm) => t + sm.progress, 0) / summaries.length)
      : 0;

    // Os KPIs de CONTAGEM cobrem a torre inteira — apartamentos E níveis (fundação,
    // reservatório, elevador, escada...). Antes só somavam apartamentos, então uma
    // observação criada num nível não aparecia aqui.
    const levelPending = towerItems.filter((i) => i.state === 'pending' || i.state === 'partial').length;
    const levelBlocked = getBlockedServiceGroups(towerItems).reduce((t, g) => t + g.blockedServices.length, 0);
    const levelObservations = towerItems.filter((i) => i.comment?.trim()).length;

    return {
      // Avanço e Críticos seguem por apartamento (cada nível já mostra seu % na faixa).
      avgProgress,
      criticalCount: summaries.filter((sm) => sm.statusKey === 'critical').length,
      totalPending: summaries.reduce((t, sm) => t + sm.pendingCount, 0) + levelPending,
      totalBlocked: summaries.reduce((t, sm) => t + sm.blockedCount, 0) + levelBlocked,
      totalObservations: summaries.reduce((t, sm) => t + sm.observationCount, 0) + levelObservations,
    };
  }, [towerApartmentsFull, towerItems]);

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

  // Primeiro nível vazio na ordem visual do corte (de cima para baixo) — âncora
  // do passo "criar etapas" do tutorial.
  const firstGhostCode = useMemo(() => {
    const defs = [...[...LEVELS_ABOVE_FLOORS].reverse(), ...[...LEVELS_BELOW_FLOORS].reverse()];
    return defs.find((d) => (itemsByLevel.get(d.code) ?? []).length === 0)?.code;
  }, [itemsByLevel]);

  // ── Render helpers ────────────────────────────────────────────────────────────
  const renderGuide = () => <View pointerEvents="none" style={s.guideLine} />;

  const renderLevelBand = (def: TowerLevelDef) => {
    const { items, progress, ghost, critical } = levelAgg(def);
    // Cor puramente por % de conclusão (mesma paleta de pavimentos/apartamentos).
    const map = getProgressMapStyle(progress);
    const fg = map.fg;
    const bg = map.bg;
    const hatched = def.kind === 'below';
    // Viewer (sem escrita): um nível vazio só existe para RECEBER etapas — a única
    // ação lá é criar. Sem permissão, não abrimos essa porta a partir do corte.
    // Níveis com etapas seguem navegáveis (visualização read-only, como os aptos).
    const locked = ghost && !canWrite;
    return (
      <View key={def.code} style={s.row}>
        {renderGuide()}
        <Text style={s.rail}>{def.rail}</Text>
        <Pressable
          {...(ghost && def.code === firstGhostCode ? ghostAnchor : undefined)}
          onPress={() => { if (!locked) router.push(`/visao-geral/nivel/${torreId}/${def.code}` as never); }}
          disabled={needsMigration || locked}
          style={[
            s.band,
            { width: KIND_WIDTH[def.kind] },
            def.kind === 'site' && s.bandSite,
            ghost ? s.bandGhost : { backgroundColor: bg },
            (needsMigration || locked) && s.bandDisabled,
          ]}>
          {hatched && !ghost && <Hatch height={BAND_MIN_H} />}
          <View style={s.bandInner}>
            <View style={s.bandTextWrap}>
              <Text style={[s.bandLabel, ghost && s.bandLabelGhost]} numberOfLines={1}>
                {def.label.toUpperCase()}
              </Text>
              <Text style={s.bandSub} numberOfLines={1}>
                {ghost
                  ? (locked ? 'Sem etapas' : def.hint)
                  : `${items.length} ${items.length === 1 ? 'etapa' : 'etapas'}${critical ? ' · etapa crítica em aberto' : ''}`}
              </Text>
            </View>
            {ghost ? (
              <MaterialCommunityIcons name={locked ? 'lock-outline' : 'plus'} size={16} color="#94A3B8" />
            ) : (
              <Text style={[s.bandPct, { color: fg }]}>{progress}%</Text>
            )}
          </View>
        </Pressable>
      </View>
    );
  };

  // Trecho do túnel do elevador / escada que passa por um pavimento. Cada trecho é
  // um "nível" dinâmico (level_code `elevador-<n>` / `escada-<n>`) — toque abre a
  // mesma tela de etapas usada pelos níveis.
  const renderSegmentStrip = (prefix: FloorSegmentPrefix, floorOrder: number, anchored = false) => {
    const seg = FLOOR_SEGMENTS.find((sg) => sg.prefix === prefix)!;
    const code = floorSegmentCode(prefix, floorOrder);
    const items = itemsByLevel.get(code) ?? [];
    const ghost = items.length === 0;
    const progress = calcProgress(items);
    const map = getProgressMapStyle(progress);
    // Mesma regra das faixas: prumada vazia é só ponto de criação — travada para viewer.
    const locked = ghost && !canWrite;
    return (
      <Pressable
        key={code}
        {...(anchored ? prumadaAnchor : undefined)}
        onPress={() => { if (!locked) router.push(`/visao-geral/nivel/${torreId}/${code}` as never); }}
        disabled={needsMigration || locked}
        accessibilityRole="button"
        accessibilityLabel={`${seg.label} do pavimento ${floorOrder || 'térreo'}`}
        style={[
          s.segStrip,
          ghost ? s.segStripGhost : { backgroundColor: map.bg, borderColor: INK },
          (needsMigration || locked) && s.bandDisabled,
        ]}>
        <MaterialCommunityIcons name={(locked ? 'lock-outline' : seg.icon) as never} size={14} color={ghost ? '#94A3B8' : map.fg} />
        <Text style={[s.segPct, { color: ghost ? '#94A3B8' : map.fg }]}>
          {ghost ? '—' : `${progress}%`}
        </Text>
      </Pressable>
    );
  };

  const renderFloorBand = (floor: (typeof floors)[number], isFirst = false) => {
    // Cor puramente por % de conclusão (mesma paleta dos níveis e apartamentos).
    const map = getProgressMapStyle(floor.progress);
    const fg = map.fg;
    const bg = map.bg;
    const expanded = expandedFloor === floor.floor;
    const floorOrder = getFloorOrder(floor.floor);
    return (
      <View key={floor.floor}>
        <View style={s.row}>
          {renderGuide()}
          <Text style={s.rail}>{floorOrder || 'T'}</Text>
          <View style={s.floorCore}>
          {/* Pavimento · escada e elevador, ambos à direita (as duas prumadas do core) */}
          <Pressable
            {...(isFirst ? pavimentoAnchor : undefined)}
            onPress={() => setExpandedFloor(expanded ? null : floor.floor)}
            style={[
              s.band,
              s.bandFlush,
              { backgroundColor: bg },
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
          {renderSegmentStrip('escada', floorOrder, isFirst)}
          {renderSegmentStrip('elevador', floorOrder)}
          </View>
        </View>
        {expanded && (
          <View style={s.aptDrawerRow}>
            <View style={s.aptDrawerRail} />
            <View style={s.floorCore}>
            <View style={[s.aptDrawer, s.bandFlush, { backgroundColor: bg, borderColor: INK }]}>
              <Text style={[s.aptDrawerHint, { color: fg }]}>Apartamentos deste pavimento</Text>
              <View style={s.aptRow}>
                {floor.apts.map((apt) => {
                  // Cor por % de conclusão (0% → cinza neutro), igual aos pavimentos.
                  const amap = getProgressMapStyle(apt.progress);
                  return (
                    <Pressable
                      key={apt.id}
                      onPress={() => router.push(`/visao-geral/apartamentos/${apt.id}` as never)}
                      style={[s.aptChip, { backgroundColor: amap.bg, borderColor: amap.border }]}>
                      <View style={[s.aptDot, { backgroundColor: amap.fg }]} />
                      <Text style={[s.aptChipText, { color: amap.fg }]}>{apt.number}</Text>
                      <Text style={[s.aptChipPct, { color: amap.fg }]}>{apt.progress}%</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
            {/* Dois espaçadores à direita = prumadas da escada e do elevador */}
            <View style={s.segSpacer} />
            <View style={s.segSpacer} />
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

      {!canWrite && <ReadOnlyBanner />}

      <ScrollView contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 32 }]}>
        {/* ── KPIs ── */}
        <View style={s.kpiRow}>
          {loadingItems
            ? [0, 1, 2, 3].map((i) => (
                <View key={i} style={[s.kpiCard, { backgroundColor: '#F8FAFC' }]}>
                  <Skeleton width={18} height={18} radius={9} />
                  <Skeleton width={26} height={16} radius={4} style={{ marginTop: 3 }} />
                  <Skeleton width={48} height={9} radius={4} style={{ marginTop: 3 }} />
                </View>
              ))
            : [
                { icon: 'floor-plan', value: floors.length, label: 'Pavimentos', color: '#2563EB', bg: '#EFF6FF' },
                { icon: 'home-city-outline', value: towerApartments.length, label: 'Apartamentos', color: '#7C3AED', bg: '#EDE9FE' },
                { icon: 'layers-triple-outline', value: towerItems.length, label: 'Etapas de nível', color: '#0891B2', bg: '#E0F2FE' },
                { icon: 'note-text-outline', value: towerStats.totalObservations, label: 'Observações', color: towerStats.totalObservations > 0 ? '#0F766E' : '#047857', bg: towerStats.totalObservations > 0 ? '#CCFBF1' : '#D1FAE5' },
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

        {/* ── Legenda: reflete o "jogo de cores" real (paleta por % de conclusão),
            + sem etapas (tracejado) e hachurado (níveis enterrados). ── */}
        <View style={s.legend} {...legendaAnchor}>
          {[10, 30, 50, 70, 90].map((pct) => {
            const m = getProgressMapStyle(pct);
            return (
              <View key={pct} style={s.legendItem}>
                <View style={[s.legendSwatch, { backgroundColor: m.bg, borderColor: m.border }]} />
                <Text style={s.legendText}>{`${pct - 10}–${pct + 10}%`}</Text>
              </View>
            );
          })}
          <View style={s.legendItem}>
            <View style={[s.legendSwatch, s.legendSwatchGhost]} />
            <Text style={s.legendText}>sem etapas</Text>
          </View>
          <View style={s.legendItem}>
            <View style={[s.legendSwatch, s.legendSwatchHatch]}>
              <Hatch height={12} />
            </View>
            <Text style={s.legendText}>hachurado (enterrado)</Text>
          </View>
        </View>

        {/* ── O corte ── */}
        {loadingItems && !needsMigration ? (
          // Skeleton com a forma do corte (trilho + faixa do pavimento + escada
          // e elevador à direita), para a tela não "pular" quando os dados chegam.
          <View style={s.sheet}>
            {/* A contagem de faixas vem do contexto (já carregado), então o
                skeleton tem a MESMA altura do corte final: nada pula no lugar. */}
            {Array.from({ length: aboveLevels.length + floors.length + belowLevels.length }).map((_, i) => (
              <View key={i} style={s.row}>
                <Skeleton width={18} height={10} radius={3} style={{ marginHorizontal: 6 }} />
                <View style={{ flex: 1 }}>
                  <Skeleton height={BAND_MIN_H - 10} radius={6} />
                </View>
                <Skeleton width={26} height={BAND_MIN_H - 10} radius={4} style={{ marginLeft: 6 }} />
                <Skeleton width={26} height={BAND_MIN_H - 10} radius={4} style={{ marginLeft: 4 }} />
              </View>
            ))}
          </View>
        ) : (
          <View style={s.sheet}>
            {aboveLevels.map(renderLevelBand)}
            {floors.map((floor, floorIdx) => renderFloorBand(floor, floorIdx === 0))}
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
  legendSwatchHatch: { borderRadius: 3, borderWidth: 1, borderColor: INK, backgroundColor: PAPER, overflow: 'hidden' },
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
  // Trechos verticais de elevador/escada ao lado de cada pavimento. Mesma
  // linguagem visual das faixas (borda INK, cor por % de conclusão); alinhados
  // entre andares, formam as duas "prumadas" do core no corte.
  // Linha do pavimento: escada · faixa (preenche o meio) · elevador. As prumadas
  // ficam nas mesmas posições em todo andar, formando as duas colunas do core.
  floorCore: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  // Anula as margens automáticas do `band` (que centram as faixas de nível) — aqui
  // quem posiciona é o floorCore.
  bandFlush: { flex: 1, marginLeft: 0, marginRight: 0 },
  segStrip: {
    width: 34,
    minHeight: BAND_MIN_H,
    marginVertical: 3,
    marginHorizontal: 4,
    borderWidth: 1.5,
    borderColor: INK,
    backgroundColor: PAPER,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  segStripGhost: { borderStyle: 'dashed', borderColor: '#94A3B8', backgroundColor: PAPER },
  segPct: { fontSize: 8.5, fontWeight: '800' },
  // Largura de uma prumada (34 + 4 de margem de cada lado).
  segSpacer: { width: 42 },
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
