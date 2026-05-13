import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { getDashboardMetrics } from '@/src/data/dashboardMetrics';

export default function SchedulePanelScreen() {
  const metrics = useMemo(() => getDashboardMetrics(), []);
  const delayed = metrics.rows.reduce((total, row) => total + row.scheduleRows.filter((item) => item.scheduleStatus === 'Atrasado').length, 0);
  const blocked = metrics.blockedServices;
  const totalSchedule = metrics.rows.reduce((total, row) => total + row.scheduleRows.length, 0);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Header title="Painel de cronograma" subtitle="Prazos, atrasos, bloqueios e planejado x realizado." />
      <View style={styles.cards}>
        <Metric label="Serviços no prazo" value={Math.max(0, totalSchedule - delayed)} color="#16A34A" />
        <Metric label="Serviços atrasados" value={delayed} color="#DC2626" />
        <Metric label="Serviços bloqueados" value={blocked} color="#F97316" />
        <Metric label="Maior atraso" value={`${Math.max(...metrics.rows.map((row) => row.delayDays), 0)}d`} color="#7C3AED" />
      </View>
      <View style={styles.grid}>
        <Panel title="Atraso por torre"><Ranking items={metrics.towerDelay} suffix=" dia(s)" /></Panel>
        <Panel title="Atraso por fase"><Ranking items={metrics.phaseDelay} suffix=" dia(s)" /></Panel>
      </View>
      <View style={styles.grid}>
        <Panel title="Planejado x realizado">
          <Percent label="Planejado acumulado" value={metrics.plannedProgress} />
          <Percent label="Realizado acumulado" value={metrics.averageProgress} />
          <Text style={styles.empty}>Desvio: {metrics.averageProgress - metrics.plannedProgress >= 0 ? '+' : ''}{metrics.averageProgress - metrics.plannedProgress} p.p.</Text>
        </Panel>
        <Panel title="Apartamentos com atraso crítico">
          <Ranking items={metrics.criticalApartmentRows.filter((row) => row.delayDays > 0).map((row) => ({ label: `${row.tower?.name ?? row.apartment.towerId} / AP ${row.apartment.number}`, value: row.delayDays }))} suffix=" dia(s)" />
        </Panel>
      </View>
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
  return <View style={styles.ranking}>{visible.map((item) => <Percent key={item.label} label={item.label} value={Math.round((item.value / max) * 100)} right={`${item.value}${suffix}`} />)}</View>;
}

function Percent({ label, right, value }: { label: string; right?: string; value: number }) {
  return (
    <View style={styles.rankItem}>
      <View style={styles.rankHeader}><Text style={styles.rankLabel}>{label}</Text><Text style={styles.rankValue}>{right ?? `${value}%`}</Text></View>
      <View style={styles.track}><View style={[styles.fill, { width: `${Math.max(4, Math.min(value, 100))}%` }]} /></View>
    </View>
  );
}

const styles = StyleSheet.create({
  cards: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  container: { backgroundColor: '#F6F8FB', gap: 14, padding: 18 },
  empty: { color: '#64748B', fontSize: 13, lineHeight: 20 },
  fill: { backgroundColor: '#2563EB', borderRadius: 999, height: '100%' },
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
