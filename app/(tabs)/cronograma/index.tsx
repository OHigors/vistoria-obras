import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { Text } from '@/src/ui/Text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { useObras } from '@/src/data/ObrasContext';
import { summarizeBottlenecks } from '@/src/data/serviceBlockers';
import { summarizeSchedule } from '@/src/data/schedule';
import { Skeleton } from '@/src/ui/Skeleton';

export default function CronogramaScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { apartments, towers, loading } = useObras();

  const bottleneckSummary = useMemo(() => summarizeBottlenecks(apartments), [apartments]);
  const scheduleSummary = useMemo(
    () => summarizeSchedule(apartments, (id) => towers.find((t) => t.id === id)?.name ?? id),
    [apartments, towers],
  );

  const hasIssues = bottleneckSummary.mostBlockedServices.length > 0 || scheduleSummary.delayedApartments > 0;
  const hasBlockers = bottleneckSummary.mostBlockedServices.length > 0;
  const hasDelays = scheduleSummary.delayedApartments > 0;

  return (
    <ScrollView
      style={s.scroll}
      contentContainerStyle={[s.container, { paddingTop: insets.top + 16 }]}
      showsVerticalScrollIndicator={false}>

      {/* KPI ROW — amber border when issues, green when all ok */}
      {loading ? (
        <View style={s.kpiRow}>
          <Skeleton height={100} radius={14} style={{ flex: 1 }} />
          <Skeleton height={100} radius={14} style={{ flex: 1 }} />
        </View>
      ) : (
        <View style={s.kpiRow}>
          <View style={[s.kpiCard, hasBlockers ? s.kpiBorderRed : s.kpiBorderGreen]}>
            <MaterialCommunityIcons
              name="lock-alert-outline"
              size={28}
              color={hasBlockers ? '#B91C1C' : '#047857'}
            />
            <Text style={[s.kpiValue, { color: hasBlockers ? '#B91C1C' : '#047857' }]}>
              {bottleneckSummary.mostBlockedServices.length}
            </Text>
            <Text style={s.kpiLabel}>Serviços travados</Text>
          </View>
          <View style={[s.kpiCard, hasDelays ? s.kpiBorderAmber : s.kpiBorderGreen]}>
            <MaterialCommunityIcons
              name={hasDelays ? 'calendar-remove' : 'calendar-check'}
              size={28}
              color={hasDelays ? '#B45309' : '#047857'}
            />
            <Text style={[s.kpiValue, { color: hasDelays ? '#B45309' : '#047857' }]}>
              {scheduleSummary.delayedApartments}
            </Text>
            <Text style={s.kpiLabel}>Apt. atrasados</Text>
          </View>
        </View>
      )}

      {/* ALL CLEAR — green border */}
      {loading ? (
        <Skeleton height={120} radius={14} />
      ) : !hasIssues ? (
        <View style={[s.section, s.sectionGreen, s.sectionCentered]}>
          <MaterialCommunityIcons name="check-all" size={44} color="#047857" />
          <Text style={s.allClearTitle}>Obra sem gargalos</Text>
          <Text style={s.allClearSub}>Nenhum serviço travado nem atrasos detectados.</Text>
        </View>
      ) : null}

      {/* GARGALO PRINCIPAL — red border */}
      {!loading && bottleneckSummary.mostPendingService && (
        <View style={[s.section, s.sectionRed]}>
          <Text style={[s.sectionTitle, { color: '#B91C1C' }]}>Principal serviço em aberto</Text>
          <View style={s.blockerRow}>
            <View style={s.blockerIconWrap}>
              <MaterialCommunityIcons name="alert-circle" size={26} color="#B91C1C" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.blockerService}>{bottleneckSummary.mostPendingService.service}</Text>
              <Text style={s.blockerMeta}>
                Afeta {bottleneckSummary.mostPendingService.affectedApartments} apartamento(s)
              </Text>
            </View>
          </View>
        </View>
      )}

      {/* SERVIÇOS IMPACTADOS — amber border */}
      {loading ? (
        <Skeleton height={160} radius={14} />
      ) : hasBlockers ? (
        <View style={[s.section, s.sectionAmber]}>
          <Text style={[s.sectionTitle, { color: '#B45309' }]}>Serviços mais impactados</Text>
          {bottleneckSummary.mostBlockedServices.map((svc) => {
            const pct = apartments.length ? Math.round((svc.affectedApartments / apartments.length) * 100) : 0;
            const isHigh = svc.occurrences > 5;
            return (
              <View key={svc.service} style={s.svcRow}>
                <View style={s.svcRowHeader}>
                  <Text style={s.svcName} numberOfLines={1}>{svc.service}</Text>
                  <View style={[s.impactBadge, { backgroundColor: isHigh ? '#FEE2E2' : '#FEF3C7' }]}>
                    <Text style={[s.impactText, { color: isHigh ? '#B91C1C' : '#B45309' }]}>
                      {isHigh ? 'ALTO' : 'MÉDIO'}
                    </Text>
                  </View>
                </View>
                <View style={s.barTrack}>
                  <View style={[s.barFill, {
                    width: `${pct}%` as `${number}%`,
                    backgroundColor: isHigh ? '#B91C1C' : '#D97706',
                  }]} />
                </View>
                <Text style={s.barMeta}>{svc.occurrences} ocorrência(s) · {svc.affectedApartments} apt. afetados</Text>
              </View>
            );
          })}
        </View>
      ) : null}

      {/* ATRASOS — amber border */}
      {loading ? (
        <Skeleton height={100} radius={14} />
      ) : hasDelays ? (
        <View style={[s.section, s.sectionAmber]}>
          <Text style={[s.sectionTitle, { color: '#B45309' }]}>Atrasos no cronograma</Text>
          <View style={s.delayRow}>
            <MaterialCommunityIcons name="clock-alert-outline" size={24} color="#B45309" />
            <View style={{ flex: 1 }}>
              <Text style={s.delayText}>{scheduleSummary.delayedApartments} apartamento(s) com atrasos detectados</Text>
              {scheduleSummary.mostDelayedService && (
                <Text style={s.delayMeta}>
                  Maior atraso: {scheduleSummary.mostDelayedService.service} ({scheduleSummary.mostDelayedService.delayDays}d)
                </Text>
              )}
            </View>
          </View>
          {scheduleSummary.mostDelayedTower && (
            <View style={s.delayTowerRow}>
              <MaterialCommunityIcons name="office-building-outline" size={15} color="#B45309" />
              <Text style={s.delayTowerText}>
                Torre mais impactada: {scheduleSummary.mostDelayedTower.towerName} (até {scheduleSummary.mostDelayedTower.delayDays}d)
              </Text>
            </View>
          )}
        </View>
      ) : null}

      {/* FERRAMENTAS — each card has its own border color */}
      <View style={s.linksSection}>
        {[
          { href: '/cronograma/obra', icon: 'chart-gantt', label: 'Cronograma da Obra', sub: 'Planejado × Executado por frente e pavimento', color: '#0D9488', border: '#14B8A6', bg: '#F0FDFA' },
          { href: '/cronograma/diagnostico', icon: 'stethoscope', label: 'Diagnóstico do MVP', sub: 'Análise completa do estado da obra', color: '#1D4ED8', border: '#3B82F6', bg: '#EFF6FF' },
          { href: '/cronograma/servicos-etapas', icon: 'cog-outline', label: 'Serviços e Etapas', sub: 'Configure checklist, cronograma e medições', color: '#6D28D9', border: '#8B5CF6', bg: '#F5F3FF' },
          { href: '/cronograma/medicoes', icon: 'ruler', label: 'Medições', sub: 'Registros financeiros por serviço', color: '#047857', border: '#10B981', bg: '#F0FDF4' },
        ].map((item) => (
          <Pressable
            key={item.href}
            onPress={() => router.push(item.href as any)}
            style={[s.linkCard, { borderColor: item.border, backgroundColor: item.bg }]}>
            <View style={[s.linkIcon, { backgroundColor: '#FFFFFF' }]}>
              <MaterialCommunityIcons name={item.icon as any} size={20} color={item.color} />
            </View>
            <View style={s.linkContent}>
              <Text style={[s.linkLabel, { color: item.color }]}>{item.label}</Text>
              <Text style={s.linkSub}>{item.sub}</Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={18} color={item.border} />
          </Pressable>
        ))}
      </View>

    </ScrollView>
  );
}

const s = StyleSheet.create({
  scroll: { backgroundColor: '#F8FAFC' },
  container: { gap: 12, paddingBottom: 40, paddingHorizontal: 16 },

  // kpi
  kpiRow: { flexDirection: 'row', gap: 12 },
  kpiCard: { flex: 1, borderRadius: 14, padding: 16, alignItems: 'center', gap: 6, backgroundColor: '#FFFFFF', borderWidth: 2 },
  kpiBorderRed:   { borderColor: '#F87171' },
  kpiBorderAmber: { borderColor: '#FCD34D' },
  kpiBorderGreen: { borderColor: '#34D399' },
  kpiValue: { fontSize: 32, fontWeight: '900' },
  kpiLabel: { color: '#475569', fontSize: 12, fontWeight: '600', textAlign: 'center' },

  // section containers
  section: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 16, gap: 12, borderWidth: 2 },
  sectionRed:     { borderColor: '#F87171' },
  sectionAmber:   { borderColor: '#FCD34D' },
  sectionGreen:   { borderColor: '#34D399' },
  sectionCentered: { alignItems: 'center', paddingVertical: 28 },
  sectionTitle: { fontSize: 15, fontWeight: '900' },

  // all clear
  allClearTitle: { color: '#047857', fontSize: 16, fontWeight: '800' },
  allClearSub: { color: '#94A3B8', fontSize: 13, textAlign: 'center', lineHeight: 20 },

  // bottleneck
  blockerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#FEF2F2', borderRadius: 10, padding: 12 },
  blockerIconWrap: { width: 44, height: 44, borderRadius: 12, backgroundColor: '#FEE2E2', alignItems: 'center', justifyContent: 'center' },
  blockerService: { color: '#0F172A', fontSize: 14, fontWeight: '800' },
  blockerMeta: { color: '#B91C1C', fontSize: 12, fontWeight: '600', marginTop: 2 },

  // chart
  svcRow: { gap: 6 },
  svcRowHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  svcName: { color: '#0F172A', flex: 1, fontSize: 13, fontWeight: '700' },
  impactBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  impactText: { fontSize: 10, fontWeight: '900' },
  barTrack: { height: 8, backgroundColor: '#E2E8F0', borderRadius: 999, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 999 },
  barMeta: { color: '#94A3B8', fontSize: 11 },

  // delays
  delayRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, backgroundColor: '#FFFBEB', borderRadius: 10, padding: 12 },
  delayText: { color: '#0F172A', fontSize: 14, fontWeight: '700', lineHeight: 20 },
  delayMeta: { color: '#B45309', fontSize: 12, fontWeight: '600', marginTop: 4 },
  delayTowerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  delayTowerText: { color: '#B45309', fontSize: 13, fontWeight: '600' },

  // links
  linksSection: { gap: 10 },
  linkCard: { borderRadius: 14, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 2 },
  linkIcon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  linkContent: { flex: 1, gap: 2 },
  linkLabel: { fontSize: 14, fontWeight: '800' },
  linkSub: { color: '#64748B', fontSize: 12 },
});
