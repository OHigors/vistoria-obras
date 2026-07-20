import { Link, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '@/src/ui/Text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import * as db from '@/src/data/db';
import type { Apartment } from '@/src/data/mockObras';
import { formatCurrency } from '@/src/data/localMeasurements';
import { useObras } from '@/src/data/ObrasContext';
import { getServiceDependencyMap } from '@/src/data/serviceStages';
import { getTowerLevel } from '@/src/data/towerLevels';
import { getProgressColor } from '@/src/ui/status';
import { Skeleton } from '@/src/ui/Skeleton';
import { useTutorialAnchor, useTutorialScreen } from '@/src/features/tutorial/TutorialContext';

const pad2 = (n: number) => String(n).padStart(2, '0');
const fmtDateBr = (d: Date) => `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

// ── KPI tile ─────────────────────────────────────────────────────────────────
type Kpi = { key: string; icon: IconName; value: string | number; label: string; sub: string; color: string; bg: string };
type KpiDetailRow = { id: string; primary: string; secondary?: string; badge?: string };

function KpiCard({ kpi, onPress }: { kpi: Kpi; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${kpi.label}: ${kpi.value}. Toque para ver detalhes`}
      style={({ pressed }) => [s.kpiCard, { borderLeftColor: kpi.color }, pressed && s.cardPressed]}>
      <View style={s.kpiCardHead}>
        <View style={[s.kpiIcon, { backgroundColor: kpi.bg }]}>
          <MaterialCommunityIcons name={kpi.icon} size={18} color={kpi.color} />
        </View>
        <Text style={[s.kpiValue, { color: kpi.color }]} numberOfLines={1}>{kpi.value}</Text>
      </View>
      <View style={s.kpiLabelRow}>
        <Text style={s.kpiLabel}>{kpi.label}</Text>
        <MaterialCommunityIcons name="chevron-right" size={15} color="#CBD5E1" />
      </View>
      <Text style={s.kpiSub} numberOfLines={1}>{kpi.sub}</Text>
    </Pressable>
  );
}

// ── Main screen ──────────────────────────────────────────────────────────────
type DashView = 'kpi' | 'dist';

export default function DashboardScreen() {
  const insets = useSafeAreaInsets();
  const { apartments, towers, project, measurements, profile, loading } = useObras();
  const [alertOpen, setAlertOpen] = useState(false);
  const [kpiModal, setKpiModal] = useState<Kpi | null>(null);
  const [view, setView] = useState<DashView>('kpi');

  // Tutorial: coach marks da primeira visita ao Início.
  useTutorialScreen('inicio', !loading);
  const heroAnchor = useTutorialAnchor('inicio.hero');
  const focosAnchor = useTutorialAnchor('inicio.focos');
  const abasAnchor = useTutorialAnchor('inicio.abas');
  const kpisAnchor = useTutorialAnchor('inicio.kpis');
  const sinoAnchor = useTutorialAnchor('inicio.sino');

  // Etapas "Atrasada": calculadas no banco (RPC), com a MESMA regra do Gantt.
  // Antes, o Início rodava buildCronogramaFromData sobre todos os ~17k itens só
  // para achar as poucas atrasadas. Recarrega ao focar a aba; o "hoje" é a data
  // LOCAL do aparelho, para bater com o cálculo do cliente.
  const [dashboard, setDashboard] = useState<db.ObraDashboard | null>(null);
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      const now = new Date();
      const today = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
      db.loadObraDashboard(today)
        .then((d) => alive && setDashboard(d))
        .catch(() => {});
      return () => { alive = false; };
    }, []),
  );

  const lateSteps = useMemo(
    () =>
      (dashboard?.late ?? []).map((r) => {
        const towerPrefix = r.towerName ? `${r.towerName} · ` : '';
        const location = r.apartmentId
          ? `${towerPrefix}Apto ${r.aptNumber}`
          : `${towerPrefix}${getTowerLevel(r.levelCode ?? '')?.label ?? r.levelCode ?? ''}`;
        const [y, m, d] = r.plannedEnd.split('-').map(Number);
        return {
          id: r.id,
          location,
          service: r.label,
          delayDays: r.delayDays,
          plannedEnd: new Date(y, m - 1, d),
        };
      }),
    [dashboard],
  );

  const lateUnits = dashboard?.lateUnits ?? 0;

  // Focos derivados do RPC: "torre mais atrasada" e "apartamentos atrasados" saem
  // das linhas de atraso; "serviço mais pendente" sai de pending_by_service filtrado
  // pelos serviços que travam outros (mapa de dependências do cliente).
  const dashSummary = useMemo(() => {
    const aptLate = (dashboard?.late ?? []).filter((r) => r.apartmentId);
    const delayedApartments = new Set(aptLate.map((r) => r.apartmentId)).size;
    const towerDelays = new Map<string, number>();
    for (const r of aptLate) {
      if (r.towerName) towerDelays.set(r.towerName, Math.max(towerDelays.get(r.towerName) ?? 0, r.delayDays));
    }
    const mostDelayedTower = [...towerDelays.entries()].sort((a, b) => b[1] - a[1])[0];
    const depMap = getServiceDependencyMap();
    const mostPending = (dashboard?.pendingByService ?? [])
      .filter((p) => (depMap[p.label]?.length ?? 0) > 0)
      .sort((a, b) => b.apartments - a.apartments)[0];
    return {
      delayedApartments,
      mostDelayedTower: mostDelayedTower ? { towerName: mostDelayedTower[0], delayDays: mostDelayedTower[1] } : undefined,
      mostPendingService: mostPending ? { service: mostPending.label, affectedApartments: mostPending.apartments } : undefined,
    };
  }, [dashboard]);

  const completedAverage = apartments.length
    ? Math.round(apartments.reduce((t, a) => t + a.progress, 0) / apartments.length)
    : 0;

  const measurementTotal = useMemo(
    () => measurements.reduce((t, m) => t + m.totalValue, 0),
    [measurements],
  );

  const statusCounts = useMemo(() => ({
    excellent: apartments.filter((a) => a.status === 'excellent').length,
    good: apartments.filter((a) => a.status === 'good').length,
    attention: apartments.filter((a) => a.status === 'attention').length,
    critical: apartments.filter((a) => a.status === 'critical').length,
  }), [apartments]);

  // Emergências / Observações: contagens vindas do RPC (antes varriam os itens).
  const emergencyUnits = dashboard?.emergencyUnits ?? 0;
  const observations = { count: dashboard?.obsCount ?? 0, units: dashboard?.obsUnits ?? 0 };

  // Detalhamento de cada KPI: onde a informação está (apto/nível). Alimenta o
  // pop-up que abre ao tocar em um indicador.
  const kpiDetails = useMemo<Record<string, KpiDetailRow[]>>(() => {
    const tName = (id: string) => towers.find((t) => t.id === id)?.name ?? '';
    const aptLoc = (a: Apartment) => `${tName(a.towerId) ? `${tName(a.towerId)} · ` : ''}Apto ${a.number}`;

    const done: KpiDetailRow[] = apartments
      .filter((a) => a.status === 'excellent')
      .map((a) => ({ id: a.id, primary: aptLoc(a), secondary: `${a.progress}% concluído` }));

    const delayed: KpiDetailRow[] = lateSteps.map((ls) => ({
      id: ls.id,
      primary: ls.service,
      secondary: `${ls.location} · venceu ${fmtDateBr(ls.plannedEnd)}`,
      badge: `${ls.delayDays}d`,
    }));

    // Localização de uma linha de emergência/observação vinda do RPC.
    const flagLoc = (r: db.DashboardFlagRow) =>
      r.scope === 'apt'
        ? `${r.towerName ? `${r.towerName} · ` : ''}Apto ${r.aptNumber}`
        : `${r.towerName ? `${r.towerName} · ` : ''}${getTowerLevel(r.levelCode ?? '')?.label ?? r.levelCode ?? ''}`;

    // Emergências — uma linha por unidade (apto/nível), juntando os textos.
    const emergencyByUnit = new Map<string, { loc: string; texts: string[] }>();
    for (const r of dashboard?.emergency ?? []) {
      const key = r.scope === 'apt' ? (r.aptId ?? '') : `${r.towerId}|${r.levelCode ?? ''}`;
      const e = emergencyByUnit.get(key) ?? { loc: flagLoc(r), texts: [] };
      e.texts.push(`${r.label}: ${r.text}`);
      emergencyByUnit.set(key, e);
    }
    const emergency: KpiDetailRow[] = [...emergencyByUnit.entries()].map(([key, v]) => ({
      id: key, primary: v.loc, secondary: v.texts.join('  ·  '),
    }));

    // Observações — uma linha por comentário.
    const obs: KpiDetailRow[] = (dashboard?.observations ?? []).map((r) => ({
      id: r.scope === 'apt' ? `${r.aptId}-${r.itemId}` : `${r.towerId}-${r.itemId}`,
      primary: flagLoc(r),
      secondary: `${r.label}: ${r.text}`,
    }));

    const value: KpiDetailRow[] = measurements.map((m) => {
      const a = apartments.find((x) => x.id === m.apartmentId);
      return { id: m.id, primary: a ? aptLoc(a) : 'Medição', secondary: m.service || m.contractor || undefined, badge: formatCurrency(m.totalValue) };
    });

    return { done, delayed, emergency, obs, value };
  }, [apartments, towers, dashboard, lateSteps, measurements]);

  const total = apartments.length || 1;
  const completedPct = Math.round((statusCounts.excellent / total) * 100);

  const firstName = profile?.name?.trim().split(/\s+/)[0];

  const towerStats = useMemo(() =>
    towers.map((tower) => {
      const apts = apartments.filter((a) => a.towerId === tower.id);
      return {
        id: tower.id,
        name: tower.name,
        units: apts.length,
        avg: apts.length ? Math.round(apts.reduce((t, a) => t + a.progress, 0) / apts.length) : 0,
        critical: apts.filter((a) => a.status === 'critical').length,
      };
    }),
    [towers, apartments],
  );

  // 4 KPIs de contagem em grade 2×2; "Medido" (moeda) tem forma própria abaixo.
  const kpis: Kpi[] = [
    {
      key: 'done', icon: 'home-city-outline', color: '#047857', bg: '#ECFDF5',
      value: statusCounts.excellent, label: 'Concluídas', sub: `${completedPct}% do total`,
    },
    {
      key: 'delayed', icon: 'clock-alert-outline', color: '#B45309', bg: '#FFFBEB',
      value: lateSteps.length, label: 'Atrasadas',
      sub: lateSteps.length > 0 ? `em ${lateUnits} unidade(s)` : 'Tudo no prazo',
    },
    {
      key: 'emergency', icon: 'alert-octagon-outline', color: '#DC2626', bg: '#FEF2F2',
      value: emergencyUnits, label: 'Emergências',
      sub: emergencyUnits > 0 ? 'requer ação imediata' : 'Nenhuma emergência',
    },
    {
      key: 'obs', icon: 'note-text-outline', color: '#4338CA', bg: '#EEF2FF',
      value: observations.count, label: 'Observações',
      sub: observations.count > 0 ? `em ${observations.units} unidade(s)` : 'Nenhuma observação',
    },
  ];

  const medidoKpi: Kpi = {
    key: 'value', icon: 'cash-multiple', color: '#0F766E', bg: '#F0FDFA',
    value: measurementTotal > 0 ? formatCurrency(measurementTotal) : 'R$ 0',
    label: 'Medido', sub: `${measurements.length} medição(ões)`,
  };

  const focos = [
    // O item mais acionável vem primeiro: a etapa com maior atraso, visível sem
    // precisar abrir o sino. Toque abre a lista completa de alertas.
    lateSteps[0] && {
      icon: 'clock-alert-outline' as IconName, color: '#DC2626', bg: '#FEF2F2',
      title: 'Etapa mais atrasada',
      text: `${lateSteps[0].service} · ${lateSteps[0].location} · ${lateSteps[0].delayDays} dia(s)`,
      onPress: () => setAlertOpen(true),
    },
    dashSummary.mostPendingService && {
      icon: 'progress-alert' as IconName, color: '#C2410C', bg: '#FFF7ED',
      title: 'Serviço mais pendente',
      text: `${dashSummary.mostPendingService.service} · ${dashSummary.mostPendingService.affectedApartments} un.`,
    },
    dashSummary.delayedApartments > 0 && dashSummary.mostDelayedTower && {
      icon: 'office-building-marker-outline' as IconName, color: '#B45309', bg: '#FFFBEB',
      title: 'Torre mais atrasada',
      text: `${dashSummary.mostDelayedTower.towerName} · ${dashSummary.mostDelayedTower.delayDays} dia(s)`,
    },
  ].filter(Boolean) as { icon: IconName; color: string; bg: string; title: string; text: string; onPress?: () => void }[];

  // Status das unidades — ordenado do melhor ao pior, com % do total. Alimenta a
  // barra empilhada e a legenda da aba "Distribuição".
  const statusRows = useMemo(
    () =>
      [
        { key: 'excellent', label: 'Excelente', color: '#047857', count: statusCounts.excellent },
        { key: 'good', label: 'Bom', color: '#2563EB', count: statusCounts.good },
        { key: 'attention', label: 'Atenção', color: '#D97706', count: statusCounts.attention },
        { key: 'critical', label: 'Crítico', color: '#DC2626', count: statusCounts.critical },
      ].map((r) => ({ ...r, pct: Math.round((r.count / total) * 100) })),
    [statusCounts, total],
  );

  // Distribuição por faixa de conclusão — revela onde está o volume de trabalho
  // (quantas unidades a iniciar, em andamento e concluídas).
  const progressBuckets = useMemo(() => {
    const defs = [
      { label: '0%', rep: 0, min: 0, max: 0 },
      { label: '1–25', rep: 13, min: 1, max: 25 },
      { label: '26–50', rep: 38, min: 26, max: 50 },
      { label: '51–75', rep: 63, min: 51, max: 75 },
      { label: '76–99', rep: 88, min: 76, max: 99 },
      { label: '100%', rep: 100, min: 100, max: 100 },
    ];
    return defs.map((d) => ({
      label: d.label,
      color: getProgressColor(d.rep),
      count: apartments.filter((a) => a.progress >= d.min && a.progress <= d.max).length,
    }));
  }, [apartments]);
  const maxBucket = Math.max(1, ...progressBuckets.map((b) => b.count));

  const hasAlerts = lateSteps.length > 0 || !!dashSummary.mostPendingService;
  const heroColor = getProgressColor(completedAverage);

  return (
    <ScrollView style={s.scroll} contentContainerStyle={s.container} showsVerticalScrollIndicator={false}>

      {/* HEADER */}
      <View style={[s.header, { paddingTop: insets.top + 12 }]}>
        <View style={s.headerRow}>
          <View style={s.headerLeft}>
            <Link href="/perfil" asChild>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Abrir perfil"
                style={({ pressed }) => [s.avatar, pressed && s.headerBtnPressed]}>
                <MaterialCommunityIcons name="account-outline" size={26} color="#FFFFFF" />
              </Pressable>
            </Link>
            <View style={{ flex: 1 }}>
              <Text style={s.headerGreeting} numberOfLines={1}>
                {firstName ? `Bem-vindo, ${firstName}` : 'Bem-vindo,'}
              </Text>
              {loading
                ? <Skeleton width={140} height={18} radius={6} style={{ marginTop: 2 }} />
                : <Text style={s.headerProject} numberOfLines={1}>{project.name}</Text>}
            </View>
          </View>
          <View style={s.headerActions}>
            <Pressable
              {...sinoAnchor}
              onPress={() => setAlertOpen(true)}
              accessibilityRole="button"
              accessibilityLabel={lateSteps.length > 0 ? `Alertas da obra: ${lateSteps.length} etapa(s) atrasada(s)` : 'Alertas da obra'}
              style={({ pressed }) => [s.alertBtn, pressed && s.headerBtnPressed]}>
              <MaterialCommunityIcons
                name={hasAlerts ? 'bell-alert' : 'bell-check-outline'}
                size={20}
                color={hasAlerts ? '#FCD34D' : 'rgba(255,255,255,0.85)'}
              />
              {lateSteps.length > 0 && (
                <View style={s.alertBadge}>
                  <Text style={s.alertBadgeText}>{lateSteps.length > 9 ? '9+' : lateSteps.length}</Text>
                </View>
              )}
            </Pressable>
            <Link href="/cronograma/servicos-etapas" asChild>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Configurar serviços e etapas"
                style={({ pressed }) => [s.settingsBtn, pressed && s.headerBtnPressed]}>
                <MaterialCommunityIcons name="cog-outline" size={20} color="rgba(255,255,255,0.85)" />
              </Pressable>
            </Link>
          </View>
        </View>
      </View>

      {/* HERO */}
      {loading ? (
        <View style={s.heroCard}>
          <Skeleton height={22} width="60%" radius={6} />
          <Skeleton height={56} width="40%" radius={10} style={{ marginTop: 8 }} />
          <Skeleton height={8} radius={999} style={{ marginTop: 10 }} />
          <View style={s.heroStatRow}>
            <Skeleton width={90} height={32} radius={8} />
            <Skeleton width={90} height={32} radius={8} />
          </View>
        </View>
      ) : (
        <View style={s.heroCard} {...heroAnchor}>
          <Text style={s.heroLabel}>Progresso geral da obra</Text>
          <Text style={[s.heroPercent, { color: heroColor }]}>{completedAverage}%</Text>
          <View style={s.heroBar}>
            <View style={[s.heroBarFill, { width: `${completedAverage}%` as `${number}%`, backgroundColor: heroColor }]} />
          </View>
          <View style={s.heroStatRow}>
            <View style={s.heroStat}>
              <Text style={s.heroStatValue}>{towers.length}</Text>
              <Text style={s.heroStatLabel}>Torres</Text>
            </View>
            <View style={s.heroStatDivider} />
            <View style={s.heroStat}>
              <Text style={s.heroStatValue}>{apartments.length}</Text>
              <Text style={s.heroStatLabel}>Unidades</Text>
            </View>
          </View>
        </View>
      )}

      {/* FOCOS DE ATENÇÃO — sempre visível, acima das abas: é o que exige ação */}
      {loading ? (
        <View style={s.focosCard}>
          <Skeleton height={16} width="45%" radius={6} />
          <Skeleton height={44} radius={12} style={{ marginTop: 12 }} />
          <Skeleton height={44} radius={12} style={{ marginTop: 8 }} />
        </View>
      ) : (
        <View style={s.focosCard} {...focosAnchor}>
          <View style={s.panelHead}>
            <MaterialCommunityIcons name="target" size={16} color="#0F172A" />
            <Text style={s.panelTitle}>Focos de atenção</Text>
          </View>
          {focos.length === 0 ? (
            <View style={s.allClearInline}>
              <MaterialCommunityIcons name="check-circle-outline" size={18} color="#047857" />
              <Text style={s.allClearText}>Obra sem pontos críticos no momento</Text>
            </View>
          ) : (
            <View style={s.focoList}>
              {focos.map((f, i) => (
                <Pressable
                  key={i}
                  onPress={f.onPress}
                  disabled={!f.onPress}
                  accessibilityRole={f.onPress ? 'button' : undefined}
                  style={({ pressed }) => [s.focoRow, i === 0 && s.focoRowFirst, pressed && f.onPress && { opacity: 0.7 }]}>
                  <View style={[s.focoIcon, { backgroundColor: f.bg }]}>
                    <MaterialCommunityIcons name={f.icon} size={16} color={f.color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.focoTitle}>{f.title}</Text>
                    <Text style={s.focoText} numberOfLines={1}>{f.text}</Text>
                  </View>
                  {f.onPress && <MaterialCommunityIcons name="chevron-right" size={16} color="#CBD5E1" />}
                </Pressable>
              ))}
            </View>
          )}
        </View>
      )}

      {/* MÓDULO DE ABAS — o controle e o conteúdo vivem num mesmo cartão, deixando
          claro que o que está abaixo pertence à aba selecionada */}
      <View style={s.tabModule}>
        <View style={s.tabModuleHeader}>
          <View style={s.viewToggle} {...abasAnchor}>
            <Pressable
              onPress={() => setView('kpi')}
              accessibilityRole="button"
              accessibilityState={{ selected: view === 'kpi' }}
              style={[s.viewBtn, view === 'kpi' && s.viewBtnActive]}>
              <MaterialCommunityIcons name="view-dashboard-outline" size={16} color={view === 'kpi' ? '#2563EB' : '#94A3B8'} />
              <Text style={[s.viewBtnText, view === 'kpi' && s.viewBtnTextActive]}>Indicadores</Text>
            </Pressable>
            <Pressable
              onPress={() => setView('dist')}
              accessibilityRole="button"
              accessibilityState={{ selected: view === 'dist' }}
              style={[s.viewBtn, view === 'dist' && s.viewBtnActive]}>
              <MaterialCommunityIcons name="chart-bar" size={16} color={view === 'dist' ? '#2563EB' : '#94A3B8'} />
              <Text style={[s.viewBtnText, view === 'dist' && s.viewBtnTextActive]}>Distribuição</Text>
            </Pressable>
          </View>
        </View>

        <View style={s.tabModuleBody}>
          {/* ── TAB: INDICADORES ── */}
          {view === 'kpi' && (
            loading ? (
              <>
                <View style={s.kpiGrid}>
                  {[1, 2, 3, 4].map((i) => (
                    <Skeleton key={i} height={96} radius={14} style={{ flexGrow: 1, flexBasis: '47%' }} />
                  ))}
                </View>
                <Skeleton height={64} radius={14} />
              </>
            ) : (
              <>
                <View style={s.kpiGrid} {...kpisAnchor}>
                  {kpis.map((kpi) => <KpiCard key={kpi.key} kpi={kpi} onPress={() => setKpiModal(kpi)} />)}
                </View>

                {/* Medido — valor financeiro tem forma própria (faixa larga) */}
                <Pressable
                  onPress={() => setKpiModal(medidoKpi)}
                  accessibilityRole="button"
                  accessibilityLabel={`Medido: ${medidoKpi.value}. Toque para ver detalhes`}
                  style={({ pressed }) => [s.medidoBand, pressed && s.cardPressed]}>
                  <View style={[s.kpiIcon, { backgroundColor: medidoKpi.bg }]}>
                    <MaterialCommunityIcons name={medidoKpi.icon} size={18} color={medidoKpi.color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.kpiLabel}>Medido</Text>
                    <Text style={s.kpiSub} numberOfLines={1}>{medidoKpi.sub}</Text>
                  </View>
                  <Text style={[s.medidoValue, { color: medidoKpi.color }]} numberOfLines={1}>{medidoKpi.value}</Text>
                  <MaterialCommunityIcons name="chevron-right" size={16} color="#CBD5E1" />
                </Pressable>
              </>
            )
          )}

          {/* ── TAB: DISTRIBUIÇÃO ── */}
          {view === 'dist' && (
            loading ? (
              <>
                <Skeleton height={16} width="50%" radius={6} />
                <Skeleton height={26} radius={8} style={{ marginTop: 4 }} />
                <View style={{ gap: 8, marginTop: 4 }}>
                  <Skeleton height={12} radius={6} />
                  <Skeleton height={12} radius={6} />
                  <Skeleton height={12} radius={6} />
                </View>
                <Skeleton height={128} radius={10} style={{ marginTop: 12 }} />
              </>
            ) : (
              <>
                {/* Status das unidades — barra 100% empilhada + legenda com % */}
                <View style={s.section}>
                  <View style={s.panelHead}>
                    <MaterialCommunityIcons name="poll" size={16} color="#0F172A" />
                    <Text style={s.panelTitle}>Status das unidades</Text>
                  </View>
                  <View style={s.stackBar}>
                    {statusRows.filter((r) => r.count > 0).length === 0 ? (
                      <View style={s.stackEmpty} />
                    ) : (
                      statusRows
                        .filter((r) => r.count > 0)
                        .map((r) => (
                          <View key={r.key} style={[s.stackSeg, { flex: r.count, backgroundColor: r.color }]}>
                            {r.pct >= 10 && <Text style={s.stackSegText}>{r.pct}%</Text>}
                          </View>
                        ))
                    )}
                  </View>
                  <View style={s.statusLegend}>
                    {statusRows.map((r) => (
                      <View key={r.key} style={s.statusLegendRow}>
                        <View style={[s.legendDot, { backgroundColor: r.color }]} />
                        <Text style={s.statusLegendLabel}>{r.label}</Text>
                        <Text style={s.statusLegendCount}>{r.count}</Text>
                        <Text style={[s.statusLegendPct, { color: r.color }]}>{r.pct}%</Text>
                      </View>
                    ))}
                  </View>
                </View>

                {/* Avanço das unidades — histograma por faixa de conclusão */}
                <View style={[s.section, s.sectionDivided]}>
                  <View style={s.panelHead}>
                    <MaterialCommunityIcons name="chart-bar" size={16} color="#0F172A" />
                    <Text style={s.panelTitle}>Avanço das unidades</Text>
                  </View>
                  <View style={s.histRow}>
                    {progressBuckets.map((b) => (
                      <View key={b.label} style={s.histCol}>
                        <View style={s.histBarArea}>
                          <Text style={s.histCount}>{b.count}</Text>
                          <View
                            style={[
                              s.histBar,
                              b.count > 0
                                ? { height: 10 + Math.round((b.count / maxBucket) * 86), backgroundColor: b.color }
                                : { height: 3, backgroundColor: '#E2E8F0' },
                            ]}
                          />
                        </View>
                        <Text style={s.histAxis} numberOfLines={1}>{b.label}</Text>
                      </View>
                    ))}
                  </View>
                  <Text style={s.histCaption}>Unidades por faixa de conclusão</Text>
                </View>

                {/* Progresso por torre — avanço médio e nº de unidades */}
                <View style={[s.section, s.sectionDivided]}>
                  <View style={s.panelHead}>
                    <MaterialCommunityIcons name="office-building-outline" size={16} color="#0F172A" />
                    <Text style={s.panelTitle}>Progresso por torre</Text>
                  </View>
                  {towerStats.map((tower) => (
                    <View key={tower.id} style={s.towerBarRow}>
                      <View style={s.towerBarInfo}>
                        <Text style={s.towerBarLabel} numberOfLines={1}>{tower.name}</Text>
                        <Text style={s.towerBarUnits}>{tower.units} un.</Text>
                      </View>
                      <View style={s.towerBarTrack}>
                        <View style={[s.towerBarFill, {
                          width: `${tower.avg}%` as `${number}%`,
                          backgroundColor: getProgressColor(tower.avg),
                        }]} />
                      </View>
                      <Text style={s.towerBarPct}>{tower.avg}%</Text>
                      {tower.critical > 0 && (
                        <View style={s.towerBarBadge}>
                          <MaterialCommunityIcons name="alert" size={10} color="#B91C1C" />
                          <Text style={s.towerBarBadgeText}>{tower.critical}</Text>
                        </View>
                      )}
                    </View>
                  ))}
                </View>
              </>
            )
          )}
        </View>
      </View>

      {/* ALERT MODAL */}
      <Modal
        animationType="slide"
        transparent
        visible={alertOpen}
        onRequestClose={() => setAlertOpen(false)}>
        <Pressable style={s.modalBackdrop} onPress={() => setAlertOpen(false)}>
          <Pressable style={[s.modalSheet, { paddingBottom: Math.max(insets.bottom, 20) }]} onPress={() => {}}>
            <Pressable onPress={() => setAlertOpen(false)} style={s.modalHandleArea}>
              <View style={s.modalHandle} />
            </Pressable>
            <View style={s.modalHeader}>
              <MaterialCommunityIcons name="bell-alert-outline" size={22} color="#B45309" />
              <Text style={s.modalTitle}>Alertas da obra</Text>
              <Pressable onPress={() => setAlertOpen(false)} style={s.modalCloseBtn}>
                <MaterialCommunityIcons name="close" size={20} color="#64748B" />
              </Pressable>
            </View>

            <ScrollView style={s.modalScroll} contentContainerStyle={s.modalScrollContent} showsVerticalScrollIndicator={false}>
              {!hasAlerts && (
                <View style={s.emptyAlerts}>
                  <View style={s.emptyAlertsIcon}>
                    <MaterialCommunityIcons name="check-circle-outline" size={28} color="#047857" />
                  </View>
                  <Text style={s.emptyAlertsTitle}>Tudo em dia</Text>
                  <Text style={s.emptyAlertsSub}>Nenhuma etapa atrasada e nenhum gargalo no momento.</Text>
                </View>
              )}

              {lateSteps.length > 0 && (
                <View style={s.lateSection}>
                  <View style={s.lateSectionHead}>
                    <MaterialCommunityIcons name="clock-alert-outline" size={16} color="#B45309" />
                    <Text style={s.lateSectionTitle}>Etapas atrasadas</Text>
                    <View style={s.lateSectionCount}>
                      <Text style={s.lateSectionCountText}>{lateSteps.length}</Text>
                    </View>
                  </View>
                  <Text style={s.lateSectionSub}>
                    {lateSteps.length} etapa(s) vencida(s) em {lateUnits} unidade(s). Priorize as de maior atraso.
                  </Text>
                  {lateSteps.slice(0, 8).map((ls) => (
                    <View key={ls.id} style={s.lateRow}>
                      <View style={s.lateBadge}>
                        <Text style={s.lateBadgeNum}>{ls.delayDays}</Text>
                        <Text style={s.lateBadgeUnit}>{ls.delayDays === 1 ? 'dia' : 'dias'}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={s.lateService} numberOfLines={1}>{ls.service}</Text>
                        <Text style={s.lateMeta} numberOfLines={1}>
                          {ls.location} · venceu {fmtDateBr(ls.plannedEnd)}
                        </Text>
                      </View>
                    </View>
                  ))}
                  {lateSteps.length > 8 && (
                    <Text style={s.lateMore}>+{lateSteps.length - 8} etapa(s) atrasada(s)</Text>
                  )}
                </View>
              )}

              {dashSummary.mostPendingService && (
                <View style={s.modalAlertItem}>
                  <View style={[s.modalAlertIcon, { backgroundColor: '#FEE2E2' }]}>
                    <MaterialCommunityIcons name="lock-alert-outline" size={20} color="#B91C1C" />
                  </View>
                  <View style={s.modalAlertContent}>
                    <Text style={s.modalAlertTitle}>Gargalo principal</Text>
                    <Text style={s.modalAlertText}>
                      <Text style={s.modalAlertBold}>{dashSummary.mostPendingService.service}</Text>
                      {` está pendente em ${dashSummary.mostPendingService.affectedApartments} apartamento(s).`}
                    </Text>
                  </View>
                </View>
              )}
            </ScrollView>

          </Pressable>
        </Pressable>
      </Modal>

      {/* KPI DETAIL MODAL — onde a informação está */}
      <Modal
        animationType="slide"
        transparent
        visible={!!kpiModal}
        onRequestClose={() => setKpiModal(null)}>
        <Pressable style={s.modalBackdrop} onPress={() => setKpiModal(null)}>
          <Pressable style={[s.modalSheet, { paddingBottom: Math.max(insets.bottom, 20) }]} onPress={() => {}}>
            <Pressable onPress={() => setKpiModal(null)} style={s.modalHandleArea}>
              <View style={s.modalHandle} />
            </Pressable>
            <View style={s.modalHeader}>
              {kpiModal && (
                <View style={[s.kpiIcon, { backgroundColor: kpiModal.bg }]}>
                  <MaterialCommunityIcons name={kpiModal.icon} size={18} color={kpiModal.color} />
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={s.modalTitle}>{kpiModal?.label}</Text>
                <Text style={s.kpiModalSub} numberOfLines={1}>{kpiModal?.sub}</Text>
              </View>
              <Pressable onPress={() => setKpiModal(null)} style={s.modalCloseBtn}>
                <MaterialCommunityIcons name="close" size={20} color="#64748B" />
              </Pressable>
            </View>

            <ScrollView style={s.modalScroll} contentContainerStyle={s.modalScrollContent} showsVerticalScrollIndicator={false}>
              {(() => {
                const rows = kpiModal ? kpiDetails[kpiModal.key] ?? [] : [];
                if (rows.length === 0) {
                  return (
                    <View style={s.kpiDetailEmpty}>
                      <MaterialCommunityIcons name="tray-remove" size={26} color="#CBD5E1" />
                      <Text style={s.kpiDetailEmptyText}>Nada para mostrar aqui.</Text>
                    </View>
                  );
                }
                return rows.map((r) => (
                  <View key={r.id} style={s.kpiDetailRow}>
                    <View style={[s.kpiDetailDot, { backgroundColor: kpiModal?.color ?? '#94A3B8' }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={s.kpiDetailPrimary} numberOfLines={1}>{r.primary}</Text>
                      {!!r.secondary && <Text style={s.kpiDetailSecondary} numberOfLines={2}>{r.secondary}</Text>}
                    </View>
                    {!!r.badge && (
                      <View style={s.kpiDetailBadge}>
                        <Text style={[s.kpiDetailBadgeText, { color: kpiModal?.color ?? '#334155' }]}>{r.badge}</Text>
                      </View>
                    )}
                  </View>
                ));
              })()}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

    </ScrollView>
  );
}

const s = StyleSheet.create({
  scroll: { backgroundColor: '#F8FAFC' },
  container: { paddingBottom: 40 },

  // header — mesmo slate do Perfil (telas conectadas pelo avatar); maior, para
  // dar peso à saudação e ao nome da obra
  header: { backgroundColor: '#334155', paddingHorizontal: 20, paddingBottom: 32 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  headerLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(255,255,255,0.18)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)', alignItems: 'center', justifyContent: 'center' },
  headerGreeting: { color: 'rgba(255,255,255,0.7)', fontSize: 14.5, fontWeight: '600', letterSpacing: 0.2 },
  headerProject: { color: '#FFFFFF', fontSize: 26, fontWeight: '900', lineHeight: 30, marginTop: 3 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerBtnPressed: { backgroundColor: 'rgba(255,255,255,0.3)' },
  alertBtn: { padding: 9, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.15)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)' },
  alertBadge: { position: 'absolute', top: -3, right: -3, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: '#DC2626', borderWidth: 1.5, borderColor: '#334155', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  alertBadgeText: { color: '#FFFFFF', fontSize: 9, fontWeight: '900' },
  settingsBtn: { padding: 9, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.15)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)' },

  // hero — pulled up over the header for a layered look
  heroCard: { backgroundColor: '#FFFFFF', borderColor: '#E2E8F0', borderWidth: 1, borderRadius: 16, marginHorizontal: 16, marginTop: -14, padding: 20, gap: 8, shadowColor: '#0F172A', shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 3 },
  heroLabel: { color: '#64748B', fontSize: 13, fontWeight: '600' },
  heroPercent: { fontSize: 52, fontWeight: '900', lineHeight: 56 },
  heroBar: { backgroundColor: '#E2E8F0', borderRadius: 999, height: 8, overflow: 'hidden' },
  heroBarFill: { height: '100%', borderRadius: 999 },
  heroStatRow: { flexDirection: 'row', alignItems: 'center', paddingTop: 8, marginTop: 4, borderTopWidth: 1, borderTopColor: '#F1F5F9' },
  heroStat: { flex: 1, alignItems: 'center' },
  heroStatValue: { color: '#0F172A', fontSize: 20, fontWeight: '900' },
  heroStatLabel: { color: '#94A3B8', fontSize: 11, fontWeight: '600', marginTop: 2 },
  heroStatDivider: { width: 1, height: 32, backgroundColor: '#E2E8F0' },

  // módulo de abas — um cartão único que agrupa o controle e o conteúdo da aba
  tabModule: { marginHorizontal: 16, marginTop: 12, backgroundColor: '#FFFFFF', borderRadius: 18, borderWidth: 1, borderColor: '#E2E8F0', overflow: 'hidden', shadowColor: '#0F172A', shadowOpacity: 0.05, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  tabModuleHeader: { padding: 10, borderBottomWidth: 1, borderBottomColor: '#EEF2F7' },
  tabModuleBody: { padding: 14, gap: 12 },

  // segmented control
  viewToggle: { flexDirection: 'row', backgroundColor: '#F1F5F9', borderRadius: 12, padding: 3, gap: 3 },
  viewBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 10 },
  viewBtnActive: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E2E8F0' },
  viewBtnText: { color: '#94A3B8', fontSize: 13, fontWeight: '700' },
  viewBtnTextActive: { color: '#2563EB' },

  // kpi grid — 2×2 fixo; a faixa colorida à esquerda ecoa os cards do checklist
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  kpiCard: { flexGrow: 1, flexBasis: '47%', backgroundColor: '#F8FAFC', borderRadius: 14, borderWidth: 1, borderColor: '#EEF2F7', borderLeftWidth: 3, padding: 14, gap: 6 },
  cardPressed: { backgroundColor: '#F8FAFC', transform: [{ scale: 0.98 }] },
  kpiCardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  kpiIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  kpiValue: { fontSize: 22, fontWeight: '900', flexShrink: 1, textAlign: 'right' },
  kpiLabelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  kpiLabel: { color: '#0F172A', fontSize: 13, fontWeight: '800' },
  kpiSub: { color: '#94A3B8', fontSize: 11, fontWeight: '600' },
  // medido — faixa financeira de largura total
  medidoBand: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#F8FAFC', borderRadius: 14, borderWidth: 1, borderColor: '#EEF2F7', borderLeftWidth: 3, borderLeftColor: '#0F766E', padding: 14 },
  medidoValue: { fontSize: 18, fontWeight: '900' },
  // kpi detail modal
  kpiModalSub: { color: '#94A3B8', fontSize: 12, fontWeight: '600', marginTop: 1 },
  kpiDetailRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#F8FAFC', borderRadius: 10, borderWidth: 1, borderColor: '#EEF2F7', paddingVertical: 10, paddingHorizontal: 12 },
  kpiDetailDot: { width: 8, height: 8, borderRadius: 4 },
  kpiDetailPrimary: { color: '#0F172A', fontSize: 13, fontWeight: '800' },
  kpiDetailSecondary: { color: '#64748B', fontSize: 11.5, fontWeight: '600', marginTop: 1 },
  kpiDetailBadge: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  kpiDetailBadgeText: { fontSize: 12, fontWeight: '900' },
  kpiDetailEmpty: { alignItems: 'center', gap: 8, paddingVertical: 28 },
  kpiDetailEmptyText: { color: '#94A3B8', fontSize: 13, fontWeight: '600' },

  // section headers (usadas no cartão de focos e nas seções da aba)
  panelHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  panelTitle: { color: '#0F172A', fontSize: 15, fontWeight: '800' },

  // focos de atenção — cartão próprio, sempre visível acima das abas
  focosCard: { backgroundColor: '#FFFFFF', borderRadius: 16, borderWidth: 1, borderColor: '#E2E8F0', padding: 16, marginHorizontal: 16, marginTop: 12, gap: 14 },
  allClearInline: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#F0FDF4', borderColor: '#A7F3D0', borderWidth: 1, borderRadius: 12, padding: 12 },
  allClearText: { color: '#047857', fontSize: 13, fontWeight: '600', flex: 1 },
  focoList: { gap: 0 },
  focoRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#F1F5F9' },
  focoRowFirst: { borderTopWidth: 0, paddingTop: 0 },
  focoIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  focoTitle: { color: '#0F172A', fontSize: 13, fontWeight: '800' },
  focoText: { color: '#64748B', fontSize: 12, fontWeight: '600', marginTop: 1 },

  // seções da aba Distribuição — separadas por hairline dentro do módulo
  section: { gap: 12 },
  sectionDivided: { borderTopWidth: 1, borderTopColor: '#F1F5F9', paddingTop: 14 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },

  // status das unidades — barra 100% empilhada + legenda
  stackBar: { flexDirection: 'row', height: 28, borderRadius: 8, overflow: 'hidden', backgroundColor: '#F1F5F9', gap: 2 },
  stackSeg: { alignItems: 'center', justifyContent: 'center' },
  stackSegText: { color: '#FFFFFF', fontSize: 11, fontWeight: '800' },
  stackEmpty: { flex: 1 },
  statusLegend: { gap: 9 },
  statusLegendRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusLegendLabel: { flex: 1, color: '#475569', fontSize: 13, fontWeight: '700' },
  statusLegendCount: { color: '#0F172A', fontSize: 14, fontWeight: '900', width: 34, textAlign: 'right' },
  statusLegendPct: { fontSize: 12, fontWeight: '800', width: 42, textAlign: 'right' },

  // avanço das unidades — histograma de barras verticais
  histRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  histCol: { flex: 1, alignItems: 'center' },
  histBarArea: { height: 116, justifyContent: 'flex-end', alignItems: 'center', gap: 4 },
  histCount: { color: '#334155', fontSize: 11, fontWeight: '800' },
  histBar: { width: '72%', minWidth: 14, borderTopLeftRadius: 6, borderTopRightRadius: 6 },
  histAxis: { color: '#64748B', fontSize: 10, fontWeight: '700', marginTop: 6 },
  histCaption: { color: '#94A3B8', fontSize: 11, fontWeight: '600', textAlign: 'center' },

  // progresso por torre
  towerBarRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  towerBarInfo: { width: 84 },
  towerBarLabel: { color: '#0F172A', fontSize: 12, fontWeight: '700' },
  towerBarUnits: { color: '#94A3B8', fontSize: 10.5, fontWeight: '600', marginTop: 1 },
  towerBarTrack: { flex: 1, height: 10, backgroundColor: '#E2E8F0', borderRadius: 999, overflow: 'hidden' },
  towerBarFill: { height: '100%', borderRadius: 999 },
  towerBarPct: { color: '#475569', fontSize: 12, fontWeight: '700', width: 34, textAlign: 'right' },
  towerBarBadge: { flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: '#FEE2E2', borderRadius: 6, paddingHorizontal: 5, paddingVertical: 2 },
  towerBarBadgeText: { color: '#B91C1C', fontSize: 10, fontWeight: '800' },

  // modal
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, gap: 16 },
  modalHandleArea: { paddingVertical: 10, alignItems: 'center' },
  modalHandle: { width: 40, height: 4, backgroundColor: '#E2E8F0', borderRadius: 999 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  modalTitle: { flex: 1, color: '#0F172A', fontSize: 17, fontWeight: '800' },
  modalCloseBtn: { padding: 4 },
  modalAlertItem: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, backgroundColor: '#FEF3C7', borderRadius: 12, padding: 14 },
  modalAlertIcon: { width: 40, height: 40, borderRadius: 10, backgroundColor: '#FDE68A', alignItems: 'center', justifyContent: 'center' },
  modalAlertContent: { flex: 1, gap: 4 },
  modalAlertTitle: { color: '#92400E', fontSize: 13, fontWeight: '800' },
  modalAlertText: { color: '#92400E', fontSize: 12, lineHeight: 18 },
  modalAlertBold: { fontWeight: '800' },

  // alert modal scroll + late-steps list
  modalScroll: { maxHeight: 440 },
  modalScrollContent: { gap: 12, paddingBottom: 4 },
  lateSection: { backgroundColor: '#FFFBEB', borderColor: '#FDE68A', borderWidth: 1, borderRadius: 12, padding: 14, gap: 10 },
  lateSectionHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  lateSectionTitle: { flex: 1, color: '#92400E', fontSize: 14, fontWeight: '800' },
  lateSectionCount: { minWidth: 22, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 999, backgroundColor: '#F59E0B', alignItems: 'center', justifyContent: 'center' },
  lateSectionCountText: { color: '#FFFFFF', fontSize: 12, fontWeight: '900' },
  lateSectionSub: { color: '#B45309', fontSize: 12, lineHeight: 17, fontWeight: '600' },
  lateRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#FFFFFF', borderRadius: 10, padding: 10, borderWidth: 1, borderColor: '#FEF3C7' },
  lateBadge: { width: 44, height: 44, borderRadius: 10, backgroundColor: '#FEF2F2', alignItems: 'center', justifyContent: 'center' },
  lateBadgeNum: { color: '#DC2626', fontSize: 16, fontWeight: '900', lineHeight: 18 },
  lateBadgeUnit: { color: '#DC2626', fontSize: 9, fontWeight: '700' },
  lateService: { color: '#0F172A', fontSize: 13, fontWeight: '800' },
  lateMeta: { color: '#64748B', fontSize: 11.5, fontWeight: '600', marginTop: 1 },
  lateMore: { color: '#B45309', fontSize: 12, fontWeight: '700', textAlign: 'center', paddingTop: 2 },
  emptyAlerts: { alignItems: 'center', gap: 8, backgroundColor: '#F0FDF4', borderColor: '#A7F3D0', borderWidth: 1, borderRadius: 14, paddingVertical: 24, paddingHorizontal: 16 },
  emptyAlertsIcon: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#DCFCE7', alignItems: 'center', justifyContent: 'center' },
  emptyAlertsTitle: { color: '#047857', fontSize: 16, fontWeight: '900' },
  emptyAlertsSub: { color: '#15803D', fontSize: 12.5, fontWeight: '600', textAlign: 'center', lineHeight: 18 },
});
