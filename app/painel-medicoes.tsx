import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { getDashboardMetrics } from '@/src/data/dashboardMetrics';
import { formatCurrency, measurementStatusOptions } from '@/src/data/localMeasurements';

export default function MeasurementsPanelScreen() {
  const metrics = useMemo(() => getDashboardMetrics(), []);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Header title="Painel de medições" subtitle="Pré-medição técnica local, sem função de ERP financeiro." />
      <View style={styles.cards}>
        {measurementStatusOptions.filter((status) => status !== 'Cancelado').map((status) => (
          <Metric key={status} label={status} value={formatCurrency(metrics.measurementTotalsByStatus[status])} color={status === 'Reprovado' ? '#DC2626' : status === 'Retido' ? '#F97316' : '#0F766E'} />
        ))}
      </View>
      <View style={styles.grid}>
        <Panel title="Medições por empreiteiro">
          <Ranking items={metrics.measurementByContractor} currency />
        </Panel>
        <Panel title="Medições por serviço">
          <Ranking items={metrics.measurementByService} currency />
        </Panel>
      </View>
      <Panel title="Medições por período">
        <Text style={styles.empty}>Filtros por período estão disponíveis na tela completa de medições e relatórios. Esta visão resume os lançamentos locais atuais.</Text>
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

function Ranking({ currency, items }: { currency?: boolean; items: { label: string; value: number }[] }) {
  const visible = items.filter((item) => item.value > 0);
  const max = Math.max(...visible.map((item) => item.value), 0);
  if (!visible.length) return <Text style={styles.empty}>Sem medições registradas.</Text>;
  return <View style={styles.ranking}>{visible.map((item) => (
    <View key={item.label} style={styles.rankItem}>
      <View style={styles.rankHeader}><Text style={styles.rankLabel}>{item.label}</Text><Text style={styles.rankValue}>{currency ? formatCurrency(item.value) : item.value}</Text></View>
      <View style={styles.track}><View style={[styles.fill, { width: `${Math.max(4, (item.value / max) * 100)}%` }]} /></View>
    </View>
  ))}</View>;
}

const styles = StyleSheet.create({
  cards: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  container: { backgroundColor: '#F6F8FB', gap: 14, padding: 18 },
  empty: { color: '#64748B', fontSize: 13, lineHeight: 20 },
  fill: { backgroundColor: '#0F766E', borderRadius: 999, height: '100%' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  header: { backgroundColor: '#FFFFFF', borderColor: '#E2E8F0', borderRadius: 10, borderWidth: 1, gap: 4, padding: 16 },
  metric: { backgroundColor: '#FFFFFF', borderColor: '#E2E8F0', borderRadius: 10, borderWidth: 1, flexGrow: 1, minWidth: 190, padding: 12 },
  metricLabel: { color: '#475569', fontSize: 12, fontWeight: '800' },
  metricValue: { fontSize: 20, fontWeight: '900' },
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
