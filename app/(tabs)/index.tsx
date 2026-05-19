import { Link, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { Text } from '@/src/ui/Text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Svg, { Circle, Text as SvgText } from 'react-native-svg';


import { formatCurrency } from '@/src/data/localMeasurements';
import { useObras } from '@/src/data/ObrasContext';
import { summarizeBottlenecks } from '@/src/data/serviceBlockers';
import { summarizeSchedule } from '@/src/data/schedule';
import { statusConfig } from '@/src/ui/status';
import { Skeleton } from '@/src/ui/Skeleton';

// ── Donut chart built with react-native-svg ─────────────────────────────────
type Segment = { value: number; color: string };

function DonutChart({ segments, size = 160 }: { segments: Segment[]; size?: number }) {
  const r = Math.round(size * 0.32);
  const sw = Math.round(size * 0.17);
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * r;
  const total = segments.reduce((t, s) => t + s.value, 0);
  if (!total) return null;

  let angleDeg = -90;
  return (
    <Svg width={size} height={size}>
      {segments
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
              strokeDasharray={[arc, gap]}
              strokeDashoffset={0}
              transform={`rotate(${currentAngle}, ${cx}, ${cy})`}
            />
          );
        })}
      <SvgText
        x={cx}
        y={cy - 6}
        textAnchor="middle"
        fontSize={20}
        fontWeight="bold"
        fill="#0F172A"
      >
        {total}
      </SvgText>
      <SvgText
        x={cx}
        y={cy + 12}
        textAnchor="middle"
        fontSize={10}
        fill="#94A3B8"
      >
        apts.
      </SvgText>
    </Svg>
  );
}

// ── Main screen ──────────────────────────────────────────────────────────────
export default function DashboardScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { apartments, towers, project, measurements, loading } = useObras();
  const [alertOpen, setAlertOpen] = useState(false);

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

  const pieSegments: Segment[] = [
    { value: statusCounts.critical, color: '#B91C1C' },
    { value: statusCounts.attention, color: '#D97706' },
    { value: statusCounts.good, color: '#2563EB' },
    { value: statusCounts.excellent, color: '#047857' },
  ];

  const hasAlerts = scheduleSummary.delayedApartments > 0 || !!bottleneckSummary.mostPendingService;

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
          <Text style={s.heroPercent}>{completedAverage}%</Text>
          <View style={s.heroBar}>
            <View style={[s.heroBarFill, { width: `${completedAverage}%` as `${number}%` }]} />
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
              <Text style={s.heroStatValue}>{measurements.length}</Text>
              <Text style={s.heroStatLabel}>Medições</Text>
            </View>
          </View>
        </View>
      )}

      {/* KPI — blue border */}
      <View style={[s.kpiGrid, s.kpiBorder]}>
        {loading ? (
          <>
            <Skeleton height={90} radius={14} style={{ flex: 1, minWidth: 140 }} />
            <Skeleton height={90} radius={14} style={{ flex: 1, minWidth: 140 }} />
            <Skeleton height={90} radius={14} style={{ flex: 1, minWidth: 140 }} />
            <Skeleton height={90} radius={14} style={{ flex: 1, minWidth: 140 }} />
          </>
        ) : (
          <>
            <View style={[s.kpiCard, { backgroundColor: '#D1FAE5' }]}>
              <MaterialCommunityIcons name="chart-line" size={22} color="#047857" />
              <Text style={[s.kpiValue, { color: '#047857' }]}>{completedAverage}%</Text>
              <Text style={s.kpiLabel}>Avanço</Text>
            </View>
            <View style={[s.kpiCard, { backgroundColor: '#FEE2E2' }]}>
              <MaterialCommunityIcons name="close-circle-outline" size={22} color="#B91C1C" />
              <Text style={[s.kpiValue, { color: '#B91C1C' }]}>{statusCounts.critical}</Text>
              <Text style={s.kpiLabel}>Críticos</Text>
            </View>
            <View style={[s.kpiCard, { backgroundColor: '#EFF6FF' }]}>
              <MaterialCommunityIcons name="file-document-outline" size={22} color="#2563EB" />
              <Text style={[s.kpiValue, { color: '#2563EB' }]}>{measurements.length}</Text>
              <Text style={s.kpiLabel}>{measurementTotal > 0 ? formatCurrency(measurementTotal) : 'Medições'}</Text>
            </View>
            <View style={[s.kpiCard, { backgroundColor: '#FEF3C7' }]}>
              <MaterialCommunityIcons name="alert-circle-outline" size={22} color="#B45309" />
              <Text style={[s.kpiValue, { color: '#B45309' }]}>{bottleneckSummary.mostBlockedServices.length}</Text>
              <Text style={s.kpiLabel}>Gargalos</Text>
            </View>
          </>
        )}
      </View>

      {/* SAÚDE DA OBRA — purple border */}
      <View style={[s.section, s.sectionPurple]}>
        <Text style={[s.sectionTitle, { color: '#6D28D9' }]}>Saúde da obra</Text>
        {loading ? (
          <View style={s.healthGrid}>
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} height={110} radius={12} style={{ flex: 1, minWidth: 80 }} />
            ))}
          </View>
        ) : (
          <View style={s.healthGrid}>
            {([
              { key: 'excellent', icon: 'check-circle', stage: '90–100%', detail: 'Sem pendências' },
              { key: 'good', icon: 'thumb-up', stage: '75–89%', detail: 'Pequenas pendências' },
              { key: 'attention', icon: 'alert', stage: '50–74%', detail: 'Itens parciais' },
              { key: 'critical', icon: 'close-circle', stage: 'Abaixo 50%', detail: 'Muitas pendências' },
            ] as const).map(({ key, icon, stage, detail }) => {
              const cfg = statusConfig[key];
              const count = statusCounts[key];
              const pct = apartments.length ? Math.round((count / apartments.length) * 100) : 0;
              return (
                <View key={key} style={[s.healthCard, { borderColor: cfg.color, backgroundColor: cfg.background }]}>
                  <MaterialCommunityIcons name={icon} size={18} color={cfg.color} />
                  <View style={s.healthCountRow}>
                    <Text style={[s.healthCount, { color: cfg.color }]}>{count}</Text>
                    <Text style={[s.healthAptLabel, { color: cfg.color }]}>apt.</Text>
                  </View>
                  <Text style={[s.healthLabel, { color: cfg.color }]}>{cfg.label}</Text>
                  <Text style={s.healthDetail}>{detail}</Text>
                  <View style={s.healthPctBar}>
                    <View style={[s.healthPctFill, { width: `${pct}%` as `${number}%`, backgroundColor: cfg.color }]} />
                  </View>
                  <Text style={s.healthPctText}>{pct}% do total</Text>
                </View>
              );
            })}
          </View>
        )}
      </View>

      {/* ALL CLEAR — only shown when no alerts */}
      {!loading && !hasAlerts && (
        <View style={s.allClearCard}>
          <MaterialCommunityIcons name="check-circle-outline" size={20} color="#047857" />
          <Text style={s.allClearText}>Obra sem pendências críticas no momento</Text>
        </View>
      )}

      {/* CHART — teal border */}
      {loading ? (
        <View style={[s.chartCard, s.sectionTeal]}>
          <Skeleton height={18} width="50%" radius={6} />
          <View style={s.chartRow}>
            <Skeleton width={160} height={160} radius={80} />
            <View style={{ flex: 1, gap: 8 }}>
              <Skeleton height={14} radius={6} />
              <Skeleton height={14} radius={6} />
              <Skeleton height={14} radius={6} />
              <Skeleton height={14} radius={6} />
            </View>
          </View>
        </View>
      ) : (
        <View style={[s.chartCard, s.sectionTeal]}>
          <Text style={[s.chartTitle, { color: '#0F766E' }]}>Distribuição de status</Text>

          <View style={s.chartRow}>
            <DonutChart segments={pieSegments} size={160} />
            <View style={s.chartLegend}>
              {[
                { label: 'Excelente', color: '#047857', count: statusCounts.excellent },
                { label: 'Bom', color: '#2563EB', count: statusCounts.good },
                { label: 'Atenção', color: '#D97706', count: statusCounts.attention },
                { label: 'Crítico', color: '#B91C1C', count: statusCounts.critical },
              ].map((item) => (
                <View key={item.label} style={s.legendItem}>
                  <View style={[s.legendDot, { backgroundColor: item.color }]} />
                  <Text style={s.legendLabel}>{item.label}</Text>
                  <Text style={[s.legendCount, { color: item.color }]}>{item.count} apt.</Text>
                </View>
              ))}
            </View>
          </View>

          <View style={s.chartDivider} />
          <Text style={s.chartSubTitle}>Progresso por torre</Text>
          {towerStats.map((tower) => (
            <View key={tower.id} style={s.towerBarRow}>
              <Text style={s.towerBarLabel} numberOfLines={1}>{tower.name}</Text>
              <View style={s.towerBarTrack}>
                <View style={[s.towerBarFill, {
                  width: `${tower.avg}%` as `${number}%`,
                  backgroundColor: tower.critical > 0 ? '#B91C1C' : tower.avg >= 75 ? '#047857' : '#2563EB',
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
  container: { paddingBottom: 40, gap: 12 },

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

  // hero
  heroCard: { backgroundColor: '#FFFFFF', borderColor: '#E2E8F0', borderWidth: 1, borderRadius: 16, marginHorizontal: 16, padding: 20, gap: 8 },
  heroLabel: { color: '#64748B', fontSize: 13, fontWeight: '600' },
  heroPercent: { color: '#2563EB', fontSize: 52, fontWeight: '900', lineHeight: 56 },
  heroBar: { backgroundColor: '#E2E8F0', borderRadius: 999, height: 8, overflow: 'hidden' },
  heroBarFill: { height: '100%', backgroundColor: '#2563EB', borderRadius: 999 },
  heroStatRow: { flexDirection: 'row', alignItems: 'center', paddingTop: 8, borderTopWidth: 1, borderTopColor: '#F1F5F9' },
  heroStat: { flex: 1, alignItems: 'center' },
  heroStatValue: { color: '#0F172A', fontSize: 20, fontWeight: '900' },
  heroStatLabel: { color: '#94A3B8', fontSize: 11, fontWeight: '600', marginTop: 2 },
  heroStatDivider: { width: 1, height: 32, backgroundColor: '#E2E8F0' },

  // kpi
  kpiBorder: { backgroundColor: '#FFFFFF', borderRadius: 16, borderWidth: 2, borderColor: '#3B82F6', padding: 12, marginHorizontal: 16 },
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  kpiCard: { flex: 1, minWidth: 140, borderRadius: 14, padding: 14, alignItems: 'center', gap: 6 },
  kpiValue: { fontSize: 24, fontWeight: '900' },
  kpiLabel: { color: '#475569', fontSize: 11, fontWeight: '700', textAlign: 'center' },

  // sections with colored borders
  section: { backgroundColor: '#FFFFFF', borderRadius: 16, borderWidth: 2, padding: 14, marginHorizontal: 16, gap: 10 },
  sectionPurple: { borderColor: '#8B5CF6' },
  sectionTeal:   { borderColor: '#14B8A6' },
  sectionTitle: { fontSize: 15, fontWeight: '900' },
  healthGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  healthCard: { flex: 1, minWidth: 80, paddingVertical: 12, paddingHorizontal: 8, borderRadius: 12, borderWidth: 1, alignItems: 'center', gap: 2 },
  healthCountRow: { flexDirection: 'row', alignItems: 'baseline', gap: 3 },
  healthCount: { fontSize: 22, fontWeight: '900' },
  healthAptLabel: { fontSize: 11, fontWeight: '700' },
  healthLabel: { fontSize: 11, fontWeight: '800', textAlign: 'center' },
  healthStage: { color: '#64748B', fontSize: 9, fontWeight: '600', textAlign: 'center', lineHeight: 12 },
  healthDetail: { color: '#94A3B8', fontSize: 9, textAlign: 'center', lineHeight: 12 },
  healthPctBar: { width: '100%', height: 4, backgroundColor: 'rgba(0,0,0,0.08)', borderRadius: 999, overflow: 'hidden', marginTop: 4 },
  healthPctFill: { height: '100%', borderRadius: 999 },
  healthPctText: { color: '#94A3B8', fontSize: 9, fontWeight: '600' },

  // alert trigger
  alertTrigger: { backgroundColor: '#FFFBEB', borderColor: '#FCD34D', borderWidth: 1, borderRadius: 14, marginHorizontal: 16, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 10 },
  alertTriggerLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  alertTriggerText: { flex: 1, color: '#92400E', fontSize: 12, fontWeight: '600' },
  allClearCard: { backgroundColor: '#F0FDF4', borderColor: '#A7F3D0', borderWidth: 1, borderRadius: 12, marginHorizontal: 16, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 8 },
  allClearText: { color: '#047857', fontSize: 13, fontWeight: '600', flex: 1 },

  // chart
  chartCard: { backgroundColor: '#FFFFFF', borderRadius: 16, marginHorizontal: 16, padding: 18, gap: 14 },
  chartTitle: { color: '#0F172A', fontSize: 15, fontWeight: '800' },
  chartRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  chartLegend: { flex: 1, gap: 10 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendLabel: { flex: 1, color: '#475569', fontSize: 12, fontWeight: '700' },
  legendCount: { fontSize: 12, fontWeight: '800' },
  chartDivider: { height: 1, backgroundColor: '#F1F5F9' },
  chartSubTitle: { color: '#475569', fontSize: 13, fontWeight: '700' },
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
  modalCloseFullBtn: { backgroundColor: '#F1F5F9', borderRadius: 12, padding: 14, alignItems: 'center' },
  modalCloseFullBtnText: { color: '#0F172A', fontSize: 14, fontWeight: '800' },
});
