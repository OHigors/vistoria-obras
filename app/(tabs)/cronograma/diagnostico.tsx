import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { Text } from '@/src/ui/Text';

import type { DiagnosticReport, DiagnosticStatus } from '@/src/data/diagnostics';
import { createDiagnosticText, runMvpDiagnostics } from '@/src/data/diagnostics';

const statusStyle: Record<DiagnosticStatus, { background: string; color: string }> = {
  Atenção: { background: '#FEF3C7', color: '#B45309' },
  Erro: { background: '#FEE2E2', color: '#B91C1C' },
  OK: { background: '#D1FAE5', color: '#047857' },
};

export default function DiagnosticsScreen() {
  const [report, setReport] = useState<DiagnosticReport>(() => runMvpDiagnostics());
  const [copyMessage, setCopyMessage] = useState('');
  const reportText = useMemo(() => createDiagnosticText(report), [report]);

  const runAgain = () => {
    setReport(runMvpDiagnostics());
    setCopyMessage('');
  };

  const copyReport = async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(reportText);
        setCopyMessage('Relatório copiado para a área de transferência.');
        return;
      }

      setCopyMessage('Área de transferência indisponível neste navegador.');
    } catch {
      setCopyMessage('Não foi possível copiar o relatório.');
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Diagnóstico do MVP</Text>
          <Text style={styles.subtitle}>
            Verificação local de regras, dados mockados e persistência do protótipo.
          </Text>
        </View>
        <View style={styles.buttonRow}>
          <Pressable onPress={runAgain} style={styles.primaryButton} testID="run-diagnostics">
            <Text style={styles.primaryButtonText}>Rodar diagnóstico</Text>
          </Pressable>
          <Pressable onPress={runAgain} style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>Rodar novamente</Text>
          </Pressable>
          <Pressable onPress={copyReport} style={styles.secondaryButton} testID="copy-diagnostics">
            <Text style={styles.secondaryButtonText}>Copiar relatório de diagnóstico</Text>
          </Pressable>
        </View>
      </View>

      {copyMessage ? (
        <View style={styles.infoBox}>
          <Text style={styles.infoText}>{copyMessage}</Text>
        </View>
      ) : null}

      <View style={styles.summaryGrid}>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryNumber}>{report.summary.total}</Text>
          <Text style={styles.summaryLabel}>Total de testes</Text>
        </View>
        <View style={styles.summaryCard}>
          <Text style={[styles.summaryNumber, { color: statusStyle.OK.color }]}>
            {report.summary.ok}
          </Text>
          <Text style={styles.summaryLabel}>Testes OK</Text>
        </View>
        <View style={styles.summaryCard}>
          <Text style={[styles.summaryNumber, { color: statusStyle.Atenção.color }]}>
            {report.summary.warnings}
          </Text>
          <Text style={styles.summaryLabel}>Atenções</Text>
        </View>
        <View style={styles.summaryCard}>
          <Text style={[styles.summaryNumber, { color: statusStyle.Erro.color }]}>
            {report.summary.errors}
          </Text>
          <Text style={styles.summaryLabel}>Erros</Text>
        </View>
      </View>

      <View style={styles.panel}>
        <Text style={styles.sectionTitle}>Chaves do localStorage</Text>
        {report.storageKeys.length === 0 ? (
          <Text style={styles.emptyText}>Nenhuma chave encontrada.</Text>
        ) : (
          <View style={styles.keyGrid}>
            {report.storageKeys.map((key) => (
              <Text key={key} style={styles.storageKey}>
                {key}
              </Text>
            ))}
          </View>
        )}
      </View>

      <View style={styles.panel}>
        <Text style={styles.sectionTitle}>Resultados detalhados</Text>
        {report.results.map((result) => {
          const style = statusStyle[result.status];

          return (
            <View key={result.name} style={styles.resultCard}>
              <View style={styles.resultHeader}>
                <Text style={styles.resultTitle}>{result.name}</Text>
                <View style={[styles.statusBadge, { backgroundColor: style.background }]}>
                  <Text style={[styles.statusText, { color: style.color }]}>{result.status}</Text>
                </View>
              </View>
              <Text style={styles.resultMessage}>{result.message}</Text>
              {result.suggestion ? (
                <Text style={styles.suggestion}>Sugestão: {result.suggestion}</Text>
              ) : null}
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 14,
    padding: 20,
  },
  header: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0',
    borderRadius: 8,
    borderWidth: 1,
    gap: 14,
    padding: 18,
  },
  title: {
    color: '#0F172A',
    fontSize: 28,
    fontWeight: '900',
  },
  subtitle: {
    color: '#64748B',
    fontSize: 14,
    lineHeight: 20,
    marginTop: 4,
  },
  buttonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: '#2563EB',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
  },
  secondaryButton: {
    alignItems: 'center',
    borderColor: '#CBD5E1',
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  secondaryButtonText: {
    color: '#2563EB',
    fontSize: 12,
    fontWeight: '900',
  },
  infoBox: {
    backgroundColor: '#DBEAFE',
    borderColor: '#93C5FD',
    borderRadius: 8,
    borderWidth: 1,
    padding: 12,
  },
  infoText: {
    color: '#1D4ED8',
    fontSize: 13,
    fontWeight: '800',
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  summaryCard: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0',
    borderRadius: 8,
    borderWidth: 1,
    flexGrow: 1,
    minWidth: 150,
    padding: 14,
  },
  summaryNumber: {
    color: '#0F172A',
    fontSize: 24,
    fontWeight: '900',
  },
  summaryLabel: {
    color: '#64748B',
    fontSize: 12,
    marginTop: 4,
  },
  panel: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0',
    borderRadius: 8,
    borderWidth: 1,
    gap: 12,
    padding: 14,
  },
  sectionTitle: {
    color: '#0F172A',
    fontSize: 18,
    fontWeight: '900',
  },
  keyGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  storageKey: {
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
    borderRadius: 999,
    borderWidth: 1,
    color: '#475569',
    fontSize: 12,
    fontWeight: '800',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  emptyText: {
    color: '#64748B',
    fontSize: 13,
  },
  resultCard: {
    borderColor: '#E2E8F0',
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
    padding: 12,
  },
  resultHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between',
  },
  resultTitle: {
    color: '#0F172A',
    flex: 1,
    fontSize: 14,
    fontWeight: '900',
    lineHeight: 19,
  },
  statusBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '900',
  },
  resultMessage: {
    color: '#475569',
    fontSize: 13,
    lineHeight: 18,
  },
  suggestion: {
    color: '#92400E',
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 17,
  },
});
