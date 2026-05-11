import { Link } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { apartments, project, towers } from '@/src/data/mockObras';
import type { Measurement } from '@/src/data/localMeasurements';
import { formatCurrency, loadAllMeasurements } from '@/src/data/localMeasurements';
import type { ScheduleSummary } from '@/src/data/schedule';
import { summarizeSchedule } from '@/src/data/schedule';
import type { BottleneckSummary } from '@/src/data/serviceBlockers';
import { summarizeBottlenecks } from '@/src/data/serviceBlockers';
import { statusConfig } from '@/src/ui/status';

export default function DashboardScreen() {
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [bottleneckSummary, setBottleneckSummary] = useState<BottleneckSummary>({
    mostBlockedServices: [],
  });
  const [scheduleSummary, setScheduleSummary] = useState<ScheduleSummary>({
    delayedApartments: 0,
  });

  useFocusEffect(
    useCallback(() => {
      setMeasurements(loadAllMeasurements(apartments.map((apartment) => apartment.id)));
      setBottleneckSummary(summarizeBottlenecks(apartments));
      setScheduleSummary(
        summarizeSchedule(
          apartments,
          (towerId) => towers.find((tower) => tower.id === towerId)?.name ?? towerId,
        ),
      );
    }, []),
  );

  const completedAverage = Math.round(
    apartments.reduce((total, apartment) => total + apartment.progress, 0) / apartments.length,
  );

  const criticalCount = apartments.filter((apartment) => apartment.status === 'critical').length;
  const attentionCount = apartments.filter((apartment) => apartment.status === 'attention').length;
  const measurementSummary = useMemo(() => {
    const totalMeasured = measurements.reduce(
      (total, measurement) => total + measurement.totalValue,
      0,
    );
    const approvedTotal = measurements
      .filter((measurement) => measurement.status === 'Aprovado para pagamento')
      .reduce((total, measurement) => total + measurement.totalValue, 0);
    const retainedOrRejectedTotal = measurements
      .filter(
        (measurement) =>
          measurement.status === 'Retido' || measurement.status === 'Reprovado',
      )
      .reduce((total, measurement) => total + measurement.totalValue, 0);
    const contractorCounts = measurements.reduce<Record<string, number>>((counts, measurement) => {
      counts[measurement.contractor] = (counts[measurement.contractor] ?? 0) + 1;
      return counts;
    }, {});

    return {
      approvedTotal,
      contractorCounts,
      retainedOrRejectedTotal,
      totalMeasured,
    };
  }, [measurements]);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>Vistoria residencial</Text>
        <Text style={styles.title}>{project.name}</Text>
        <Text style={styles.subtitle}>{project.summary}</Text>
      </View>

      <View style={styles.statsGrid}>
        <View style={styles.statCard}>
          <Text style={styles.statNumber}>{towers.length}</Text>
          <Text style={styles.statLabel}>torres</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statNumber}>{apartments.length}</Text>
          <Text style={styles.statLabel}>apartamentos</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statNumber}>{completedAverage}%</Text>
          <Text style={styles.statLabel}>avanço médio</Text>
        </View>
      </View>

      <View style={styles.panel}>
        <View style={styles.panelHeader}>
          <View style={styles.panelTitleGroup}>
            <Text style={styles.sectionTitle}>Relatório geral</Text>
            <Text style={styles.sectionHint}>Visão executiva por torre, apartamento e serviço</Text>
          </View>
          <Link href="/relatorio-geral" asChild>
            <Pressable style={styles.secondaryButton}>
              <Text style={styles.secondaryButtonText}>Abrir relatório</Text>
            </Pressable>
          </Link>
        </View>
      </View>

      <View style={styles.panel}>
        <View style={styles.panelHeader}>
          <View style={styles.panelTitleGroup}>
            <Text style={styles.sectionTitle}>Diagnóstico do MVP</Text>
            <Text style={styles.sectionHint}>Rodar testes internos de regras, dados e localStorage</Text>
          </View>
          <Link href="/diagnostico" asChild>
            <Pressable style={styles.secondaryButton}>
              <Text style={styles.secondaryButtonText}>Rodar testes</Text>
            </Pressable>
          </Link>
        </View>
      </View>

      <View style={styles.panel}>
        <View style={styles.panelHeader}>
          <View>
            <Text style={styles.sectionTitle}>Saúde da obra</Text>
            <Text style={styles.sectionHint}>Resumo dos apartamentos de teste</Text>
          </View>
        </View>

        <View style={styles.statusRow}>
          <View style={[styles.statusPill, { backgroundColor: statusConfig.attention.background }]}>
            <Text style={[styles.statusValue, { color: statusConfig.attention.color }]}>
              {attentionCount}
            </Text>
            <Text style={styles.statusText}>em atenção</Text>
          </View>
          <View style={[styles.statusPill, { backgroundColor: statusConfig.critical.background }]}>
            <Text style={[styles.statusValue, { color: statusConfig.critical.color }]}>
              {criticalCount}
            </Text>
            <Text style={styles.statusText}>crítico</Text>
          </View>
        </View>
      </View>

      <View style={styles.panel}>
        <View style={styles.panelHeader}>
          <View>
            <Text style={styles.sectionTitle}>Atrasos do cronograma</Text>
            <Text style={styles.sectionHint}>Planejado x realizado por apartamento</Text>
          </View>
        </View>

        <View style={styles.measurementGrid}>
          <View style={styles.measurementStat}>
            <Text style={styles.statNumber}>{scheduleSummary.delayedApartments}</Text>
            <Text style={styles.statLabel}>apartamento(s) atrasado(s)</Text>
          </View>
          <View style={styles.measurementStatWide}>
            <Text style={styles.statNumber}>
              {scheduleSummary.mostDelayedService?.delayDays ?? 0} dia(s)
            </Text>
            <Text style={styles.statLabel}>
              {scheduleSummary.mostDelayedService?.service ?? 'sem serviço atrasado'}
            </Text>
          </View>
          <View style={styles.measurementStat}>
            <Text style={styles.statNumber}>
              {scheduleSummary.mostDelayedTower?.delayDays ?? 0} dia(s)
            </Text>
            <Text style={styles.statLabel}>
              {scheduleSummary.mostDelayedTower?.towerName ?? 'sem torre atrasada'}
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.panel}>
        <View style={styles.panelHeader}>
          <View>
            <Text style={styles.sectionTitle}>Principais gargalos</Text>
            <Text style={styles.sectionHint}>Pendências que travam serviços futuros</Text>
          </View>
        </View>

        {bottleneckSummary.mostPendingService ? (
          <View style={styles.bottleneckHighlight}>
            <Text style={styles.contractorTitle}>Serviço com mais pendências</Text>
            <Text style={styles.bottleneckService}>
              {bottleneckSummary.mostPendingService.service}
            </Text>
            <Text style={styles.sectionHint}>
              {bottleneckSummary.mostPendingService.affectedApartments} apartamento(s)
              afetado(s)
            </Text>
          </View>
        ) : (
          <Text style={styles.emptyText}>Nenhum gargalo registrado no checklist.</Text>
        )}

        <View style={styles.contractorList}>
          <Text style={styles.contractorTitle}>Serviços mais travados</Text>
          {bottleneckSummary.mostBlockedServices.length === 0 ? (
            <Text style={styles.emptyText}>Nenhum serviço travado no momento.</Text>
          ) : (
            bottleneckSummary.mostBlockedServices.map((blockedService) => (
              <View key={blockedService.service} style={styles.contractorRow}>
                <Text style={styles.contractorName}>{blockedService.service}</Text>
                <Text style={styles.contractorCount}>
                  {blockedService.occurrences} ocorrência(s) em{' '}
                  {blockedService.affectedApartments} apartamento(s)
                </Text>
              </View>
            ))
          )}
        </View>
      </View>

      <View style={styles.panel}>
        <View style={styles.panelHeader}>
          <View style={styles.panelTitleGroup}>
            <Text style={styles.sectionTitle}>Resumo de medições</Text>
            <Text style={styles.sectionHint}>Dados salvos localmente neste navegador</Text>
          </View>
          <Link href="/medicoes" asChild>
            <Pressable style={styles.secondaryButton}>
              <Text style={styles.secondaryButtonText}>Abrir medições</Text>
            </Pressable>
          </Link>
        </View>

        <View style={styles.measurementGrid}>
          <View style={styles.measurementStat}>
            <Text style={styles.statNumber}>{measurements.length}</Text>
            <Text style={styles.statLabel}>medições registradas</Text>
          </View>
          <View style={styles.measurementStat}>
            <Text style={styles.statNumber}>
              {formatCurrency(measurementSummary.totalMeasured)}
            </Text>
            <Text style={styles.statLabel}>valor total</Text>
          </View>
          <View style={styles.measurementStatWide}>
            <Text style={styles.statNumber}>
              {formatCurrency(measurementSummary.approvedTotal)}
            </Text>
            <Text style={styles.statLabel}>aprovado para pagamento</Text>
          </View>
          <View style={styles.measurementStatWide}>
            <Text style={styles.statNumber}>
              {formatCurrency(measurementSummary.retainedOrRejectedTotal)}
            </Text>
            <Text style={styles.statLabel}>retido/reprovado</Text>
          </View>
        </View>

        <View style={styles.contractorList}>
          <Text style={styles.contractorTitle}>Serviços medidos por empreiteiro</Text>
          {Object.entries(measurementSummary.contractorCounts).length === 0 ? (
            <Text style={styles.emptyText}>Nenhuma medição registrada ainda.</Text>
          ) : (
            Object.entries(measurementSummary.contractorCounts).map(([contractor, count]) => (
              <View key={contractor} style={styles.contractorRow}>
                <Text style={styles.contractorName}>{contractor}</Text>
                <Text style={styles.contractorCount}>{count} serviço(s)</Text>
              </View>
            ))
          )}
        </View>
      </View>

      <View style={styles.panel}>
        <View style={styles.panelHeader}>
          <View style={styles.panelTitleGroup}>
            <Text style={styles.sectionTitle}>Gerar relatório</Text>
            <Text style={styles.sectionHint}>Texto para WhatsApp/e-mail, PDF imprimível e CSV tabular</Text>
          </View>
          <Link href="/gerar-relatorio" asChild>
            <Pressable style={styles.secondaryButton}>
              <Text style={styles.secondaryButtonText}>Gerar relatório</Text>
            </Pressable>
          </Link>
        </View>
      </View>

      <View style={styles.panel}>
        <View style={styles.panelHeader}>
          <View style={styles.panelTitleGroup}>
            <Text style={styles.sectionTitle}>Serviços e etapas</Text>
            <Text style={styles.sectionHint}>Configuração local para checklist, cronograma, dependências e medições</Text>
          </View>
          <Link href="/servicos-etapas" asChild>
            <Pressable style={styles.secondaryButton}>
              <Text style={styles.secondaryButtonText}>Configurar etapas</Text>
            </Pressable>
          </Link>
        </View>
      </View>

      <View style={styles.panel}>
        <Text style={styles.sectionTitle}>Torres cadastradas</Text>
        {towers.map((tower) => (
          <Link
            key={tower.id}
            href={{ pathname: '/torres/[torreId]', params: { torreId: tower.id } }}
            asChild>
            <Pressable style={styles.towerCard}>
              <View>
                <Text style={styles.towerName}>
                  {tower.name} / {tower.block} / {tower.position}
                </Text>
                <Text style={styles.towerMeta}>Abrir apartamentos da {tower.name}</Text>
              </View>
              <Text style={styles.towerCount}>
                {apartments.filter((apartment) => apartment.towerId === tower.id).length} un.
              </Text>
            </Pressable>
          </Link>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
    gap: 16,
  },
  hero: {
    backgroundColor: '#0F172A',
    borderRadius: 8,
    padding: 22,
    gap: 8,
  },
  eyebrow: {
    color: '#93C5FD',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0,
    textTransform: 'uppercase',
  },
  title: {
    color: '#FFFFFF',
    fontSize: 30,
    fontWeight: '800',
  },
  subtitle: {
    color: '#CBD5E1',
    fontSize: 15,
    lineHeight: 22,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  statCard: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0',
    borderRadius: 8,
    borderWidth: 1,
    flexGrow: 1,
    minWidth: 190,
    padding: 14,
  },
  statNumber: {
    color: '#0F172A',
    fontSize: 24,
    fontWeight: '800',
    lineHeight: 29,
  },
  statLabel: {
    color: '#64748B',
    fontSize: 12,
    marginTop: 4,
    minWidth: 0,
  },
  panel: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0',
    borderRadius: 8,
    borderWidth: 1,
    padding: 16,
    gap: 12,
  },
  panelHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    justifyContent: 'space-between',
  },
  panelTitleGroup: {
    flex: 1,
    minWidth: 190,
  },
  sectionTitle: {
    color: '#0F172A',
    fontSize: 18,
    fontWeight: '800',
  },
  sectionHint: {
    color: '#64748B',
    fontSize: 13,
    marginTop: 4,
  },
  statusRow: {
    flexDirection: 'row',
    gap: 10,
  },
  statusPill: {
    flex: 1,
    borderRadius: 8,
    padding: 14,
  },
  statusValue: {
    fontSize: 22,
    fontWeight: '900',
  },
  statusText: {
    color: '#475569',
    fontSize: 13,
    marginTop: 2,
  },
  secondaryButton: {
    alignItems: 'center',
    borderColor: '#CBD5E1',
    borderRadius: 8,
    borderWidth: 1,
    minWidth: 144,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  secondaryButtonText: {
    color: '#2563EB',
    fontSize: 12,
    fontWeight: '900',
  },
  measurementGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  measurementStat: {
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
    borderRadius: 8,
    borderWidth: 1,
    flexGrow: 1,
    minWidth: 190,
    padding: 12,
  },
  measurementStatWide: {
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
    borderRadius: 8,
    borderWidth: 1,
    flexGrow: 1,
    minWidth: 240,
    padding: 12,
  },
  contractorList: {
    borderTopColor: '#E2E8F0',
    borderTopWidth: 1,
    gap: 8,
    paddingTop: 12,
  },
  bottleneckHighlight: {
    backgroundColor: '#FFFBEB',
    borderColor: '#FBBF24',
    borderRadius: 8,
    borderWidth: 1,
    gap: 4,
    padding: 12,
  },
  bottleneckService: {
    color: '#0F172A',
    fontSize: 16,
    fontWeight: '900',
    lineHeight: 21,
  },
  contractorTitle: {
    color: '#0F172A',
    fontSize: 14,
    fontWeight: '900',
  },
  contractorRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  contractorName: {
    color: '#475569',
    fontSize: 13,
    fontWeight: '700',
  },
  contractorCount: {
    color: '#2563EB',
    fontSize: 13,
    fontWeight: '900',
  },
  emptyText: {
    color: '#64748B',
    fontSize: 13,
  },
  towerCard: {
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 14,
  },
  towerName: {
    color: '#0F172A',
    fontSize: 15,
    fontWeight: '800',
  },
  towerMeta: {
    color: '#64748B',
    fontSize: 13,
    marginTop: 2,
  },
  towerCount: {
    color: '#2563EB',
    fontSize: 13,
    fontWeight: '800',
  },
});
