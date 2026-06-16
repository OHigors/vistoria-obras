import { Link, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '@/src/ui/Text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Svg, { Circle, Text as SvgText } from 'react-native-svg';


import { formatCurrency } from '@/src/data/localMeasurements';
import { useObras } from '@/src/data/ObrasContext';
import { summarizeBottlenecks } from '@/src/data/serviceBlockers';
import { summarizeSchedule } from '@/src/data/schedule';
import { getProgressColor } from '@/src/ui/status';
import { Skeleton } from '@/src/ui/Skeleton';

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

// ── Donut chart built with react-native-svg ─────────────────────────────────
type Segment = { value: number; color: string };

function DonutChart({ segments, size = 150 }: { segments: Segment[]; size?: number }) {
  const r = Math.round(size * 0.34);
  const sw = Math.round(size * 0.15);
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * r;
  const total = segments.reduce((t, s) => t + s.value, 0);

  let angleDeg = -90;
  return (
    <Svg width={size} height={size}>
      <Circle cx={cx} cy={cy} r={r} fill="none" stroke="#F1F5F9" strokeWidth={sw} />
      {total > 0 && segments
        .filter((s) => s.value > 0)
        .map((seg, i) => {
          const arc = (seg.value / total) * circumference;
          const gap = circumference - arc;
          const currentAngle = angleDeg;
          angleDeg += (seg.value / total) * 360;
          return (
            <Circle
              key={i}
              cx={cx}
              cy={cy}
              r={r}
              fill="none"
              stroke={seg.color}
              strokeWidth={sw}
              strokeLinecap="round"
              strokeDasharray={[arc, gap]}
              strokeDashoffset={0}
              transform={`rotate(${currentAngle}, ${cx}, ${cy})`}
            />
          );
        })}
      <SvgText x={cx} y={cy - 4} textAnchor="middle" fontSize={22} fontWeight="bold" fill="#0F172A">
        {total}
      </SvgText>
      <SvgText x={cx} y={cy + 13} textAnchor="middle" fontSize={10} fill="#94A3B8">
        unidades
      </SvgText>
    </Svg>
  );
}

// ── KPI tile ─────────────────────────────────────────────────────────────────
type Kpi = { key: string; icon: IconName; value: string | number; label: string; sub: string; color: string; bg: string };

function KpiCard({ kpi }: { kpi: Kpi }) {
  return (
    <View style={s.kpiCard}>
      <View style={s.kpiCardHead}>
        <View style={[s.kpiIcon, { backgroundColor: kpi.bg }]}>
          <MaterialCommunityIcons name={kpi.icon} size={18} color={kpi.color} />
        </View>
        <Text style={[s.kpiValue, { color: kpi.color }]} numberOfLines={1}>{kpi.value}</Text>
      </View>
      <Text style={s.kpiLabel}>{kpi.label}</Text>
      <Text style={s.kpiSub} numberOfLines={1}>{kpi.sub}</Text>
    </View>
  );
}

// ── Main screen ──────────────────────────────────────────────────────────────
type DashView = 'kpi' | 'dist';

export default function DashboardScreen() {
  const insets = useSafeAreaInsets();
  const { apartments, towers, project, measurements, loading } = useObras();
  const [alertOpen, setAlertOpen] = useState(false);
  const [view, setView] = useState<DashView>('kpi');

  const bottleneckSummary = useMemo(() => summarizeBottlenecks(apartments), [apartments]);
  const scheduleSummary = useMemo(
    () => summarizeSchedule(apartments, (id) => towers.find((t) => t.id === id)?.name ?? id),
    [apartments, towers],
  );

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

  // Operational rollups derived from the live checklist — not shown elsewhere.
  const ops = useMemo(() => {
    let openIssues = 0;
    let unitsWithIssues = 0;
    let observations = 0;
    for (const a of apartments) {
      const pend = a.checklist.filter((i) => i.state === 'pending' || i.state === 'partial').length;
      if (pend > 0) unitsWithIssues += 1;
      openIssues += pend;
      observations += a.checklist.filter((i) => i.comment?.trim()).length;
    }
    return { openIssues, unitsWithIssues, observations };
  }, [apartments]);

  const total = apartments.length || 1;
  const completedPct = Math.round((statusCounts.excellent / total) * 100);
  const criticalPct = Math.round((statusCounts.critical / total) * 100);

  const towerStats = useMemo(() =>
    towers.map((tower) => {
      const apts = apartments.filter((a) => a.towerId === tower.id);
      return {
        id: tower.id,
        name: tower.name,
        avg: apts.length ? Math.round(apts.reduce((t, a) => t + a.progress, 0) / apts.length) : 0,
        critical: apts.filter((a) => a.status === 'critical').length,
      };
    }),
    [towers, apartments],
  );

  const kpis: Kpi[] = [
    {
      key: 'done', icon: 'home-city-outline', color: '#047857', bg: '#ECFDF5',
      value: statusCounts.excellent, label: 'Concluídas', sub: `${completedPct}% do total`,
    },
    {
      key: 'delayed', icon: 'clock-alert-outline', color: '#B45309', bg: '#FFFBEB',
      value: scheduleSummary.delayedApartments, label: 'Atrasadas',
      sub: scheduleSummary.delayedApartments > 0 && scheduleSummary.mostDelayedTower
        ? scheduleSummary.mostDelayedTower.towerName
        : 'Tudo no prazo',
    },
    {
      key: 'critical', icon: 'alert-octagon-outline', color: '#DC2626', bg: '#FEF2F2',
      value: statusCounts.critical, label: 'Críticas', sub: `${criticalPct}% do total`,
    },
    {
      key: 'issues', icon: 'clipboard-list-outline', color: '#4338CA', bg: '#EEF2FF',
      value: ops.openIssues, label: 'Pendências',
      sub: ops.unitsWithIssues > 0 ? `em ${ops.unitsWithIssues} unidade(s)` : 'Nenhuma aberta',
    },
    {
      key: 'bottleneck', icon: 'lock-alert-outline', color: '#C2410C', bg: '#FFF7ED',
      value: bottleneckSummary.mostBlockedServices.length, label: 'Gargalos',
      sub: bottleneckSummary.mostPendingService?.service ?? 'Sem gargalos',
    },
    {
      key: 'value', icon: 'cash-multiple', color: '#0F766E', bg: '#F0FDFA',
      value: measurementTotal > 0 ? formatCurrency(measurementTotal) : 'R$ 0',
      label: 'Medido', sub: `${measurements.length} medição(ões)`,
    },
  ];

  const focos = [
    bottleneckSummary.mostPendingService && {
      icon: 'progress-alert' as IconName, color: '#C2410C', bg: '#FFF7ED',
      title: 'Serviço mais pendente',
      text: `${bottleneckSummary.mostPendingService.service} · ${bottleneckSummary.mostPendingService.affectedApartments} un.`,
    },
    scheduleSummary.delayedApartments > 0 && scheduleSummary.mostDelayedTower && {
      icon: 'clock-alert-outline' as IconName, color: '#B45309', bg: '#FFFBEB',
      title: 'Torre mais atrasada',
      text: `${scheduleSummary.mostDelayedTower.towerName} · ${scheduleSummary.mostDelayedTower.delayDays} dia(s)`,
    },
    bottleneckSummary.mostBlockedServices[0] && {
      icon: 'lock-outline' as IconName, color: '#B91C1C', bg: '#FEF2F2',
      title: 'Principal gargalo',
      text: `${bottleneckSummary.mostBlockedServices[0].service} · ${bottleneckSummary.mostBlockedServices[0].affectedApartments} un.`,
    },
  ].filter(Boolean) as { icon: IconName; color: string; bg: string; title: string; text: string }[];

  const pieSegments: Segment[] = [
    { value: statusCounts.critical, color: '#DC2626' },
    { value: statusCounts.attention, color: '#D97706' },
    { value: statusCounts.good, color: '#2563EB' },
    { value: statusCounts.excellent, color: '#047857' },
  ];

  const hasAlerts = scheduleSummary.delayedApartments > 0 || !!bottleneckSummary.mostPendingService;
  const heroColor = getProgressColor(completedAverage);

  return (
    <ScrollView style={s.scroll} contentContainerStyle={s.container} showsVerticalScrollIndicator={false}>

      {/* HEADER */}
      <View style={[s.header, { paddingTop: insets.top + 12 }]}>
        <View style={s.headerRow}>
          <View style={s.headerLeft}>
            <View style={s.avatar}>
              <MaterialCommunityIcons name="account-outline" size={26} color="#FFFFFF" />
            </View>
            <View>
              <Text style={s.headerGreeting}>Bem-vindo,</Text>
              {loading
                ? <Skeleton width={140} height={18} radius={6} style={{ marginTop: 2 }} />
                : <Text style={s.headerProject}>{project.name}</Text>}
            </View>
          </View>
          <View style={s.headerActions}>
            {hasAlerts && (
              <Pressable onPress={() => setAlertOpen(true)} style={s.alertBtn}>
                <MaterialCommunityIcons name="bell-alert" size={20} color="#FCD34D" />
              </Pressable>
            )}
            <Link href="/cronograma/servicos-etapas" asChild>
              <Pressable style={s.settingsBtn}>
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
            <Skeleton width={80} height={32} radius={8} />
            <Skeleton width={80} height={32} radius={8} />
            <Skeleton width={80} height={32} radius={8} />
          </View>
        </View>
      ) : (
        <View style={s.heroCard}>
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
            <View style={s.heroStatDivider} />
            <View style={s.heroStat}>
              <Text style={s.heroStatValue}>{ops.observations}</Text>
              <Text style={s.heroStatLabel}>Observações</Text>
            </View>
          </View>
        </View>
      )}

      {/* SEGMENTED CONTROL — mirrors the Catálogos toggle */}
      <View style={s.toggleWrap}>
        <View style={s.viewToggle}>
          <Pressable onPress={() => setView('kpi')} style={[s.viewBtn, view === 'kpi' && s.viewBtnActive]}>
            <MaterialCommunityIcons name="view-dashboard-outline" size={16} color={view === 'kpi' ? '#6D28D9' : '#94A3B8'} />
            <Text style={[s.viewBtnText, view === 'kpi' && s.viewBtnTextActive]}>Indicadores</Text>
          </Pressable>
          <Pressable onPress={() => setView('dist')} style={[s.viewBtn, view === 'dist' && s.viewBtnActive]}>
            <MaterialCommunityIcons name="chart-donut" size={16} color={view === 'dist' ? '#6D28D9' : '#94A3B8'} />
            <Text style={[s.viewBtnText, view === 'dist' && s.viewBtnTextActive]}>Distribuição</Text>
          </Pressable>
        </View>
      </View>

      {/* ── TAB: INDICADORES ── */}
      {view === 'kpi' && (
        loading ? (
          <View style={s.tabBody}>
            <View style={s.kpiGrid}>
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <Skeleton key={i} height={96} radius={14} style={{ flex: 1, minWidth: 150 }} />
              ))}
            </View>
          </View>
        ) : (
          <View style={s.tabBody}>
            <View style={s.kpiGrid}>
              {kpis.map((kpi) => <KpiCard key={kpi.key} kpi={kpi} />)}
            </View>

            {/* Focos de atenção — where to act next */}
            <View style={s.panel}>
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
                    <View key={i} style={[s.focoRow, i === 0 && s.focoRowFirst]}>
                      <View style={[s.focoIcon, { backgroundColor: f.bg }]}>
                        <MaterialCommunityIcons name={f.icon} size={16} color={f.color} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={s.focoTitle}>{f.title}</Text>
                        <Text style={s.focoText} numberOfLines={1}>{f.text}</Text>
                      </View>
                    </View>
                  ))}
                </View>
              )}
            </View>
          </View>
        )
      )}

      {/* ── TAB: DISTRIBUIÇÃO ── */}
      {view === 'dist' && (
        loading ? (
          <View style={s.tabBody}>
            <View style={s.panel}>
              <Skeleton height={18} width="50%" radius={6} />
              <View style={s.chartRow}>
                <Skeleton width={150} height={150} radius={75} />
                <View style={{ flex: 1, gap: 10 }}>
                  <Skeleton height={14} radius={6} />
                  <Skeleton height={14} radius={6} />
                  <Skeleton height={14} radius={6} />
                  <Skeleton height={14} radius={6} />
                </View>
              </View>
            </View>
          </View>
        ) : (
          <View style={s.tabBody}>
            <View style={s.panel}>
              <View style={s.panelHead}>
                <MaterialCommunityIcons name="chart-donut" size={16} color="#0F172A" />
                <Text style={s.panelTitle}>Distribuição de status</Text>
              </View>
              <View style={s.chartRow}>
                <DonutChart segments={pieSegments} size={150} />
                <View style={s.chartLegend}>
                  {[
                    { label: 'Excelente', color: '#047857', count: statusCounts.excellent },
                    { label: 'Bom', color: '#2563EB', count: statusCounts.good },
                    { label: 'Atenção', color: '#D97706', count: statusCounts.attention },
                    { label: 'Crítico', color: '#DC2626', count: statusCounts.critical },
                  ].map((item) => (
                    <View key={item.label} style={s.legendItem}>
                      <View style={[s.legendDot, { backgroundColor: item.color }]} />
                      <Text style={s.legendLabel}>{item.label}</Text>
                      <Text style={[s.legendCount, { color: item.color }]}>{item.count}</Text>
                    </View>
                  ))}
                </View>
              </View>
            </View>

            <View style={s.panel}>
              <View style={s.panelHead}>
                <MaterialCommunityIcons name="office-building-outline" size={16} color="#0F172A" />
                <Text style={s.panelTitle}>Progresso por torre</Text>
              </View>
              {towerStats.map((tower) => (
                <View key={tower.id} style={s.towerBarRow}>
                  <Text style={s.towerBarLabel} numberOfLines={1}>{tower.name}</Text>
                  <View style={s.towerBarTrack}>
                    <View style={[s.towerBarFill, {
                      width: `${tower.avg}%` as `${number}%`,
                      backgroundColor: getProgressColor(tower.avg),
                    }]} />
                  </View>
                  <Text style={s.towerBarPct}>{tower.avg}%</Text>
                  {tower.critical > 0 && (
                    <View style={s.towerBarBadge}>
                      <Text style={s.towerBarBadgeText}>{tower.critical} ⚠</Text>
                    </View>
                  )}
                </View>
              ))}
            </View>
          </View>
        )
      )}

      {/* ALERT MODAL */}
      <Modal
        animationType="slide"
        transparent
        visible={alertOpen}
        onRequestClose={() => setAlertOpen(false)}>
        <Pressable style={s.modalBackdrop} onPress={() => setAlertOpen(false)}>
          <Pressable style={s.modalSheet} onPress={() => {}}>
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

            {scheduleSummary.delayedApartments > 0 && (
              <View style={s.modalAlertItem}>
                <View style={s.modalAlertIcon}>
                  <MaterialCommunityIcons name="clock-alert-outline" size={20} color="#B45309" />
                </View>
                <View style={s.modalAlertContent}>
                  <Text style={s.modalAlertTitle}>Atraso no cronograma</Text>
                  <Text style={s.modalAlertText}>
                    <Text style={s.modalAlertBold}>{scheduleSummary.delayedApartments} apartamento(s)</Text>
                    {scheduleSummary.mostDelayedTower
                      ? ` com atraso. Torre mais afetada: ${scheduleSummary.mostDelayedTower.towerName} (até ${scheduleSummary.mostDelayedTower.delayDays} dias de atraso).`
                      : ' apresentam atraso no cronograma.'}
                  </Text>
                  {scheduleSummary.mostDelayedService && (
                    <Text style={s.modalAlertText}>
                      Serviço mais atrasado: <Text style={s.modalAlertBold}>{scheduleSummary.mostDelayedService.service}</Text> ({scheduleSummary.mostDelayedService.delayDays} dias).
                    </Text>
                  )}
                </View>
              </View>
            )}

            {bottleneckSummary.mostPendingService && (
              <View style={s.modalAlertItem}>
                <View style={[s.modalAlertIcon, { backgroundColor: '#FEE2E2' }]}>
                  <MaterialCommunityIcons name="lock-alert-outline" size={20} color="#B91C1C" />
                </View>
                <View style={s.modalAlertContent}>
                  <Text style={s.modalAlertTitle}>Gargalo principal</Text>
                  <Text style={s.modalAlertText}>
                    <Text style={s.modalAlertBold}>{bottleneckSummary.mostPendingService.service}</Text>
                    {` está pendente em ${bottleneckSummary.mostPendingService.affectedApartments} apartamento(s).`}
                  </Text>
                  {bottleneckSummary.mostBlockedServices.length > 0 && (
                    <Text style={s.modalAlertText}>
                      Serviços travados: <Text style={s.modalAlertBold}>{bottleneckSummary.mostBlockedServices.slice(0, 3).map((sv) => sv.service).join(', ')}{bottleneckSummary.mostBlockedServices.length > 3 ? '…' : ''}</Text>
                    </Text>
                  )}
                </View>
              </View>
            )}

          </Pressable>
        </Pressable>
      </Modal>

    </ScrollView>
  );
}

const s = StyleSheet.create({
  scroll: { backgroundColor: '#F8FAFC' },
  container: { paddingBottom: 40 },

  // header
  header: { backgroundColor: '#4a5565', paddingHorizontal: 20, paddingBottom: 22 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatar: { width: 50, height: 50, borderRadius: 25, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  headerGreeting: { color: 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: '600' },
  headerProject: { color: '#FFFFFF', fontSize: 22, fontWeight: '900', marginTop: 2 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  alertBtn: { padding: 9, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.15)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)' },
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

  // segmented control
  toggleWrap: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 4 },
  viewToggle: { flexDirection: 'row', backgroundColor: '#F1F5F9', borderRadius: 12, padding: 3, gap: 3 },
  viewBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 10 },
  viewBtnActive: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E2E8F0' },
  viewBtnText: { color: '#94A3B8', fontSize: 13, fontWeight: '700' },
  viewBtnTextActive: { color: '#6D28D9' },

  tabBody: { gap: 12, paddingTop: 8 },

  // kpi grid
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: 16 },
  kpiCard: { flex: 1, minWidth: 150, backgroundColor: '#FFFFFF', borderRadius: 14, borderWidth: 1, borderColor: '#E2E8F0', padding: 14, gap: 6 },
  kpiCardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  kpiIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  kpiValue: { fontSize: 22, fontWeight: '900', flexShrink: 1, textAlign: 'right' },
  kpiLabel: { color: '#0F172A', fontSize: 13, fontWeight: '800' },
  kpiSub: { color: '#94A3B8', fontSize: 11, fontWeight: '600' },

  // generic panel
  panel: { backgroundColor: '#FFFFFF', borderRadius: 16, borderWidth: 1, borderColor: '#E2E8F0', padding: 16, marginHorizontal: 16, gap: 14 },
  panelHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  panelTitle: { color: '#0F172A', fontSize: 15, fontWeight: '800' },

  // focos de atenção
  allClearInline: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#F0FDF4', borderColor: '#A7F3D0', borderWidth: 1, borderRadius: 12, padding: 12 },
  allClearText: { color: '#047857', fontSize: 13, fontWeight: '600', flex: 1 },
  focoList: { gap: 0 },
  focoRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#F1F5F9' },
  focoRowFirst: { borderTopWidth: 0, paddingTop: 0 },
  focoIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  focoTitle: { color: '#0F172A', fontSize: 13, fontWeight: '800' },
  focoText: { color: '#64748B', fontSize: 12, fontWeight: '600', marginTop: 1 },

  // chart
  chartRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  chartLegend: { flex: 1, gap: 10 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendLabel: { flex: 1, color: '#475569', fontSize: 13, fontWeight: '700' },
  legendCount: { fontSize: 14, fontWeight: '900' },
  towerBarRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  towerBarLabel: { color: '#0F172A', fontSize: 12, fontWeight: '700', width: 60 },
  towerBarTrack: { flex: 1, height: 10, backgroundColor: '#E2E8F0', borderRadius: 999, overflow: 'hidden' },
  towerBarFill: { height: '100%', borderRadius: 999 },
  towerBarPct: { color: '#475569', fontSize: 12, fontWeight: '700', width: 34, textAlign: 'right' },
  towerBarBadge: { backgroundColor: '#FEE2E2', borderRadius: 6, paddingHorizontal: 5, paddingVertical: 2 },
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
});
