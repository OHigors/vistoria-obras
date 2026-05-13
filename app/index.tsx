import { useFocusEffect } from '@react-navigation/native';
import { Link } from 'expo-router';
import type { Href } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { getDashboardMetrics, statusColors, statusLabels } from '@/src/data/dashboardMetrics';
import type { DashboardMetrics, DashboardStatus } from '@/src/data/dashboardMetrics';
import { formatCurrency } from '@/src/data/localMeasurements';
import { getActiveProject } from '@/src/data/localProjects';
import type { LocalProject } from '@/src/data/localProjects';
import { project } from '@/src/data/mockObras';

const formatUpdatedAt = () =>
  new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date());

export default function DashboardScreen() {
  const [activeProject, setActiveProject] = useState<LocalProject>(() => getActiveProject());
  const [metrics, setMetrics] = useState<DashboardMetrics>(() => getDashboardMetrics());

  useFocusEffect(
    useCallback(() => {
      setActiveProject(getActiveProject());
      setMetrics(getDashboardMetrics());
    }, []),
  );

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.eyebrow}>Visão geral</Text>
          <Text style={styles.title}>{activeProject.nome || project.name}</Text>
          <Text style={styles.subtitle}>Responsável: {activeProject.responsavel || 'não informado'}</Text>
          <Text style={styles.meta}>
            {metrics.towers.length} torre(s) · {metrics.apartments.length} apartamento(s) · Atualizado em {formatUpdatedAt()}
          </Text>
        </View>
        <QuickButton href="/obras" label="Configurar obra" primary />
      </View>

      <View style={styles.cardGrid}>
        <MainCard href="/torres" title="Apartamentos" value={metrics.apartments.length} text="Torres e unidades" />
        <MainCard href="/painel-pendencias" title="Pendências" value={metrics.pendingOpen} text={`${metrics.pendingCritical} crítica(s)`} />
        <MainCard href="/painel-pendencias" title="Serviços travados" value={metrics.blockedServices} text={`${metrics.blockedApartments} apartamento(s)`} />
        <MainCard href="/painel-cronograma" title="Cronograma" value={`${metrics.averageDelay}d`} text="Média de atraso" />
        <MainCard href="/painel-medicoes" title="Medições" value={formatCurrency(metrics.totalMeasured)} text="Pré-medição técnica" />
        <MainCard href="/gerar-relatorio" title="Relatórios" value="RDO" text="Texto, PDF e CSV" />
      </View>

      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Saúde da obra</Text>
        <View style={styles.statusGrid}>
          {(['Sem dados', 'excellent', 'good', 'attention', 'critical'] as DashboardStatus[]).map((status) => (
            <View key={status} style={styles.statusCard}>
              <Text style={[styles.statusValue, { color: statusColors[status] }]}>{metrics.statusCounts[status]}</Text>
              <Text style={styles.statusLabel}>{statusLabels[status]}</Text>
            </View>
          ))}
        </View>
      </View>

      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Ações rápidas</Text>
        <View style={styles.quickGrid}>
          <QuickButton href="/importar-apartamentos" label="Importar apartamentos" />
          <QuickButton href="/servicos-etapas" label="Serviços e etapas" />
          <QuickButton href="/gerar-relatorio" label="Gerar relatório" />
          <QuickButton href="/diagnostico" label="Diagnóstico" />
          <QuickButton href="/painel-qualidade" label="Qualidade" />
          <QuickButton href="/painel-cronograma" label="Cronograma" />
        </View>
      </View>
    </ScrollView>
  );
}

function MainCard({
  href,
  text,
  title,
  value,
}: {
  href: Href;
  text: string;
  title: string;
  value: number | string;
}) {
  return (
    <View style={styles.mainCard}>
      <Text style={styles.cardTitle}>{title}</Text>
      <Text style={styles.cardValue}>{value}</Text>
      <Text style={styles.cardText}>{text}</Text>
      <QuickButton href={href} label="Abrir" compact />
    </View>
  );
}

function QuickButton({
  compact,
  href,
  label,
  primary,
}: {
  compact?: boolean;
  href: Href;
  label: string;
  primary?: boolean;
}) {
  return (
    <Link href={href} asChild>
      <Pressable style={StyleSheet.flatten([styles.quickButton, primary && styles.primaryButton, compact && styles.compactButton])}>
        <Text style={[styles.quickButtonText, primary && styles.primaryButtonText]}>{label}</Text>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  cardGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  cardText: { color: '#64748B', fontSize: 12, lineHeight: 18 },
  cardTitle: { color: '#334155', fontSize: 13, fontWeight: '900' },
  cardValue: { color: '#0F172A', fontSize: 24, fontWeight: '900' },
  compactButton: { alignSelf: 'flex-start', minHeight: 34, minWidth: 86 },
  container: { backgroundColor: '#F6F8FB', gap: 14, padding: 18 },
  eyebrow: { color: '#2563EB', fontSize: 12, fontWeight: '900', textTransform: 'uppercase' },
  header: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0',
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    justifyContent: 'space-between',
    padding: 16,
  },
  headerText: { flex: 1, gap: 4, minWidth: 230 },
  mainCard: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0',
    borderRadius: 10,
    borderWidth: 1,
    flexGrow: 1,
    gap: 7,
    minHeight: 142,
    minWidth: 180,
    padding: 12,
  },
  meta: { color: '#64748B', fontSize: 13, lineHeight: 19 },
  panel: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0',
    borderRadius: 10,
    borderWidth: 1,
    gap: 12,
    padding: 14,
  },
  panelTitle: { color: '#0F172A', fontSize: 17, fontWeight: '900' },
  primaryButton: { backgroundColor: '#2563EB', borderColor: '#2563EB' },
  primaryButtonText: { color: '#FFFFFF' },
  quickButton: {
    alignItems: 'center',
    backgroundColor: '#EFF6FF',
    borderColor: '#BFDBFE',
    borderRadius: 8,
    borderWidth: 1,
    flexGrow: 1,
    minHeight: 40,
    justifyContent: 'center',
    minWidth: 150,
    paddingHorizontal: 12,
  },
  quickButtonText: { color: '#1D4ED8', fontSize: 12, fontWeight: '900', textAlign: 'center' },
  quickGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  statusCard: {
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
    borderRadius: 8,
    borderWidth: 1,
    flexGrow: 1,
    minWidth: 128,
    padding: 10,
  },
  statusGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  statusLabel: { color: '#475569', fontSize: 12, fontWeight: '800' },
  statusValue: { fontSize: 22, fontWeight: '900' },
  subtitle: { color: '#475569', fontSize: 14, lineHeight: 20 },
  title: { color: '#0F172A', fontSize: 27, fontWeight: '900' },
});
