import { Link } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { criticalityColors, getDashboardMetrics } from '@/src/data/dashboardMetrics';

export default function PendingPanelScreen() {
  const metrics = useMemo(() => getDashboardMetrics(), []);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Header title="Painel de pendências" subtitle="Análise operacional de pendências, criticidade e travas de liberação." />
      <View style={styles.cards}>
        <Metric label="Pendências abertas" value={metrics.pendingOpen} color="#F59E0B" />
        <Metric label="Pendências críticas" value={metrics.pendingCritical} color="#DC2626" />
        <Metric label="Serviços travados" value={metrics.blockedServices} color="#F97316" />
        <Metric label="Apartamentos impactados" value={metrics.blockedApartments} color="#7C3AED" />
      </View>
      <View style={styles.grid}>
        <Panel title="Pendências por criticidade">
          <Ranking items={Object.entries(metrics.pendingByCriticality).map(([label, value]) => ({ color: criticalityColors[label as keyof typeof criticalityColors], label, value }))} />
        </Panel>
        <Panel title="Pendências por fase">
          <Ranking items={metrics.pendingByPhase} />
        </Panel>
      </View>
      <View style={styles.grid}>
        <Panel title="Pendências por etapa/subetapa">
          <Ranking items={metrics.pendingByService} />
        </Panel>
        <Panel title="Apartamentos com mais pendências">
          {metrics.criticalApartmentRows.length ? metrics.criticalApartmentRows.map((row) => (
            <View key={row.apartment.id} style={styles.row}>
              <View style={styles.rowTextGroup}>
                <Text style={styles.rowTitle}>{row.tower?.name ?? row.apartment.towerId} · AP {row.apartment.number}</Text>
                <Text style={styles.rowText}>{row.pendingItems.length} pendência(s), {row.criticalPendencies} crítica(s), {row.blockedServices} serviço(s) travado(s)</Text>
              </View>
              <Link href={`/apartamentos/${row.apartment.id}`} asChild>
                <Pressable style={styles.openButton}><Text style={styles.openButtonText}>Abrir</Text></Pressable>
              </Link>
            </View>
          )) : <Empty />}
        </Panel>
      </View>
      <Panel title="Pendências que travam liberação">
        <Ranking items={metrics.releaseBlockers} />
      </Panel>
    </ScrollView>
  );
}

function Header({ subtitle, title }: { subtitle: string; title: string }) {
  return <View style={styles.header}><Text style={styles.title}>{title}</Text><Text style={styles.subtitle}>{subtitle}</Text></View>;
}

function Metric({ color, label, value }: { color: string; label: string; value: number | string }) {
  return <View style={styles.metric}><Text style={[styles.metricValue, { color }]}>{value}</Text><Text style={styles.metricLabel}>{label}</Text></View>;
}

function Panel({ children, title }: { children: React.ReactNode; title: string }) {
  return <View style={styles.panel}><Text style={styles.panelTitle}>{title}</Text>{children}</View>;
}

function Empty() {
  return <Text style={styles.empty}>Sem dados suficientes. Importe apartamentos ou registre vistorias para popular este indicador.</Text>;
}

function Ranking({ items }: { items: { color?: string; label: string; value: number }[] }) {
  const visible = items.filter((item) => item.value > 0);
  const max = Math.max(...visible.map((item) => item.value), 0);
  if (!visible.length) return <Empty />;
  return <View style={styles.ranking}>{visible.map((item) => (
    <View key={item.label} style={styles.rankItem}>
      <View style={styles.rankHeader}><Text style={styles.rankLabel}>{item.label}</Text><Text style={styles.rankValue}>{item.value}</Text></View>
      <View style={styles.track}><View style={[styles.fill, { backgroundColor: item.color ?? '#2563EB', width: `${Math.max(4, (item.value / max) * 100)}%` }]} /></View>
    </View>
  ))}</View>;
}

const styles = StyleSheet.create({
  cards: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  container: { backgroundColor: '#F6F8FB', gap: 14, padding: 18 },
  empty: { color: '#64748B', fontSize: 13, lineHeight: 20 },
  fill: { borderRadius: 999, height: '100%' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  header: { backgroundColor: '#FFFFFF', borderColor: '#E2E8F0', borderRadius: 10, borderWidth: 1, gap: 4, padding: 16 },
  metric: { backgroundColor: '#FFFFFF', borderColor: '#E2E8F0', borderRadius: 10, borderWidth: 1, flexGrow: 1, minWidth: 170, padding: 12 },
  metricLabel: { color: '#475569', fontSize: 12, fontWeight: '800' },
  metricValue: { fontSize: 24, fontWeight: '900' },
  openButton: { alignItems: 'center', backgroundColor: '#2563EB', borderRadius: 8, minHeight: 34, justifyContent: 'center', paddingHorizontal: 12 },
  openButtonText: { color: '#FFFFFF', fontSize: 12, fontWeight: '900' },
  panel: { backgroundColor: '#FFFFFF', borderColor: '#E2E8F0', borderRadius: 10, borderWidth: 1, flex: 1, gap: 12, minWidth: 280, padding: 14 },
  panelTitle: { color: '#0F172A', fontSize: 17, fontWeight: '900' },
  rankHeader: { flexDirection: 'row', gap: 8, justifyContent: 'space-between' },
  rankItem: { gap: 6 },
  rankLabel: { color: '#334155', flex: 1, fontSize: 12, fontWeight: '800' },
  rankValue: { color: '#0F172A', fontSize: 12, fontWeight: '900' },
  ranking: { gap: 10 },
  row: { alignItems: 'center', backgroundColor: '#F8FAFC', borderColor: '#E2E8F0', borderRadius: 8, borderWidth: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between', padding: 10 },
  rowText: { color: '#64748B', fontSize: 12, lineHeight: 18 },
  rowTextGroup: { flex: 1, minWidth: 190 },
  rowTitle: { color: '#0F172A', fontSize: 13, fontWeight: '900' },
  subtitle: { color: '#64748B', fontSize: 14, lineHeight: 20 },
  title: { color: '#0F172A', fontSize: 26, fontWeight: '900' },
  track: { backgroundColor: '#E2E8F0', borderRadius: 999, height: 8, overflow: 'hidden' },
});
