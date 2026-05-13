import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { getDashboardMetrics } from '@/src/data/dashboardMetrics';

export default function QualityPanelScreen() {
  const metrics = useMemo(() => getDashboardMetrics(), []);
  const averageEvolution = metrics.totalVisits
    ? Math.round(metrics.rows.reduce((total, row) => total + row.progress, 0) / Math.max(metrics.rows.length, 1))
    : 0;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Header title="Painel de qualidade" subtitle="Vistorias, visitas, fotos, evolução e regressões." />
      <View style={styles.cards}>
        <Metric label="Apartamentos vistoriados" value={metrics.withInspection} color="#16A34A" />
        <Metric label="Sem vistoria" value={metrics.withoutInspection} color="#64748B" />
        <Metric label="Visitas realizadas" value={metrics.totalVisits} color="#2563EB" />
        <Metric label="Fotos anexadas" value={metrics.totalPhotos} color="#7C3AED" />
        <Metric label="Evolução média" value={`${averageEvolution}%`} color="#0F766E" />
        <Metric label="Regressões" value={metrics.regressions} color="#DC2626" />
        <Metric label="Pendências por visita" value={metrics.visitPendencies} color="#F59E0B" />
      </View>
      <View style={styles.grid}>
        <Panel title="Fotos por apartamento">
          <Ranking items={metrics.rows.map((row) => ({ label: `${row.tower?.name ?? row.apartment.towerId} / AP ${row.apartment.number}`, value: row.photos })).filter((item) => item.value > 0).slice(0, 10)} />
        </Panel>
        <Panel title="Evolução por torre">
          <Ranking items={metrics.towerProgress} suffix="%" />
        </Panel>
      </View>
      <Panel title="Apartamentos com regressão">
        <Text style={styles.empty}>
          {metrics.regressions > 0
            ? `${metrics.regressions} regressão(ões) detectada(s) no histórico de visitas.`
            : 'Nenhuma regressão detectada no histórico atual.'}
        </Text>
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

function Ranking({ items, suffix = '' }: { items: { label: string; value: number }[]; suffix?: string }) {
  const visible = items.filter((item) => item.value > 0);
  const max = Math.max(...visible.map((item) => item.value), 0);
  if (!visible.length) return <Text style={styles.empty}>Sem dados suficientes.</Text>;
  return <View style={styles.ranking}>{visible.map((item) => (
    <View key={item.label} style={styles.rankItem}>
      <View style={styles.rankHeader}><Text style={styles.rankLabel}>{item.label}</Text><Text style={styles.rankValue}>{item.value}{suffix}</Text></View>
      <View style={styles.track}><View style={[styles.fill, { width: `${Math.max(4, (item.value / Math.max(max, 1)) * 100)}%` }]} /></View>
    </View>
  ))}</View>;
}

const styles = StyleSheet.create({
  cards: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  container: { backgroundColor: '#F6F8FB', gap: 14, padding: 18 },
  empty: { color: '#64748B', fontSize: 13, lineHeight: 20 },
  fill: { backgroundColor: '#7C3AED', borderRadius: 999, height: '100%' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  header: { backgroundColor: '#FFFFFF', borderColor: '#E2E8F0', borderRadius: 10, borderWidth: 1, gap: 4, padding: 16 },
  metric: { backgroundColor: '#FFFFFF', borderColor: '#E2E8F0', borderRadius: 10, borderWidth: 1, flexGrow: 1, minWidth: 170, padding: 12 },
  metricLabel: { color: '#475569', fontSize: 12, fontWeight: '800' },
  metricValue: { fontSize: 24, fontWeight: '900' },
  panel: { backgroundColor: '#FFFFFF', borderColor: '#E2E8F0', borderRadius: 10, borderWidth: 1, flex: 1, gap: 12, minWidth: 280, padding: 14 },
  panelTitle: { color: '#0F172A', fontSize: 17, fontWeight: '900' },
  rankHeader: { flexDirection: 'row', gap: 8, justifyContent: 'space-between' },
  rankItem: { gap: 6 },
  rankLabel: { color: '#334155', flex: 1, fontSize: 12, fontWeight: '800' },
  rankValue: { color: '#0F172A', fontSize: 12, fontWeight: '900' },
  ranking: { gap: 10 },
  subtitle: { color: '#64748B', fontSize: 14, lineHeight: 20 },
  title: { color: '#0F172A', fontSize: 26, fontWeight: '900' },
  track: { backgroundColor: '#E2E8F0', borderRadius: 999, height: 8, overflow: 'hidden' },
});
