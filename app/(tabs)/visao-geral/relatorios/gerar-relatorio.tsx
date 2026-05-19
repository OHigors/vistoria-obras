import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native'
import { Text } from '@/src/ui/Text';

import {
  createGeneratedReport,
  reportCsvHeader,
  validateReportFilters,
  type ReportContentOptions,
  type ReportFilters,
  type ReportKind,
} from '@/src/data/generatedReports';
import { project, towers } from '@/src/data/mockObras';
import { isValidBrDate, maskDateBr } from '@/src/data/schedule';

const csvSeparator = ';';
const csvBom = '\uFEFF';

const reportKinds: { label: string; value: ReportKind }[] = [
  { label: 'Relatório do dia da obra', value: 'daily' },
  { label: 'Relatório por torre', value: 'tower' },
  { label: 'Relatório por apartamento', value: 'apartment' },
  { label: 'Relatório por serviço', value: 'service' },
  { label: 'Relatório por empreiteiro', value: 'contractor' },
];

const contentOptions: { field: keyof ReportContentOptions; label: string }[] = [
  { field: 'includeSummary', label: 'incluir resumo' },
  { field: 'includeChecklist', label: 'incluir checklist' },
  { field: 'includeIssues', label: 'incluir pendências' },
  { field: 'includePhotos', label: 'incluir fotos' },
  { field: 'includeBlocked', label: 'incluir serviços travados' },
  { field: 'includeSchedule', label: 'incluir cronograma' },
  { field: 'includeMeasurements', label: 'incluir medições' },
  { field: 'includeHistory', label: 'incluir histórico de visitas' },
];

const defaultFilters: ReportFilters = {
  apartment: '',
  contractor: '',
  date: new Intl.DateTimeFormat('pt-BR').format(new Date()),
  periodEnd: '',
  periodStart: '',
  service: '',
  tower: 'Todos',
};

const defaultOptions: ReportContentOptions = {
  includeBlocked: true,
  includeChecklist: true,
  includeHistory: true,
  includeIssues: true,
  includeMeasurements: true,
  includePhotos: false,
  includeSchedule: true,
  includeSummary: true,
};

const parseBrDate = (value: string) => {
  if (!isValidBrDate(value)) {
    return undefined;
  }

  const [day, month, year] = value.split('/').map(Number);
  return new Date(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T00:00:00`);
};

const validateDates = (filters: ReportFilters) => {
  if (!isValidBrDate(filters.date)) {
    return 'Data inválida. Use DD/MM/AAAA.';
  }

  if (filters.periodStart && !isValidBrDate(filters.periodStart)) {
    return 'Período início inválido. Use DD/MM/AAAA.';
  }

  if (filters.periodEnd && !isValidBrDate(filters.periodEnd)) {
    return 'Período fim inválido. Use DD/MM/AAAA.';
  }

  const start = parseBrDate(filters.periodStart);
  const end = parseBrDate(filters.periodEnd);

  if (start && end && end.getTime() < start.getTime()) {
    return 'Período fim não pode ser menor que período início.';
  }

  return '';
};

const escapeCsvValue = (value: string | number) => {
  const text = String(value);

  if (text.includes('"') || text.includes(csvSeparator) || text.includes('\n') || text.includes('\r')) {
    return `"${text.replaceAll('"', '""')}"`;
  }

  return text;
};

const downloadCsv = (rows: (string | number)[][]) => {
  if (typeof document === 'undefined') {
    return;
  }

  const csv = csvBom + [[...reportCsvHeader], ...rows]
    .map((row) => row.map((value) => escapeCsvValue(value)).join(csvSeparator))
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = 'relatorio-gerado-residencial-cagliari.csv';
  link.click();
  URL.revokeObjectURL(url);
};

export default function GenerateReportScreen() {
  const [kind, setKind] = useState<ReportKind>('daily');
  const [filters, setFilters] = useState<ReportFilters>(defaultFilters);
  const [options, setOptions] = useState<ReportContentOptions>(defaultOptions);
  const [message, setMessage] = useState('');

  const report = useMemo(() => createGeneratedReport(kind, filters, options), [filters, kind, options]);
  const validationMessage = validateDates(filters) || validateReportFilters(kind, filters);
  const canExport = !validationMessage && report.isValid && report.text.length > 0;

  const updateFilter = (field: keyof ReportFilters, value: string) => {
    setFilters((currentFilters) => ({ ...currentFilters, [field]: value }));
  };

  const updateDateFilter = (field: 'date' | 'periodEnd' | 'periodStart', value: string) => {
    updateFilter(field, maskDateBr(value));
  };

  const toggleOption = (field: keyof ReportContentOptions) => {
    setOptions((currentOptions) => ({ ...currentOptions, [field]: !currentOptions[field] }));
  };

  const copyReport = async () => {
    if (!canExport) {
      setMessage(validationMessage || 'Prévia vazia. Ajuste os filtros para copiar.');
      return;
    }

    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(report.text);
        setMessage('Relatório copiado');
        return;
      }
    } catch {
      // Fall back to showing the text in the preview.
    }

    setMessage('Não foi possível copiar automaticamente. Use a prévia de texto abaixo.');
  };

  const generatePdf = () => {
    if (!canExport) {
      setMessage(validationMessage || 'Prévia vazia. Ajuste os filtros para gerar PDF.');
      return;
    }

    if (typeof window === 'undefined') {
      setMessage('PDF não disponível neste ambiente.');
      return;
    }

    if (typeof document !== 'undefined') {
      const printFrame = document.createElement('iframe');
      printFrame.style.height = '0';
      printFrame.style.left = '-9999px';
      printFrame.style.position = 'fixed';
      printFrame.style.top = '0';
      printFrame.style.width = '0';
      document.body.appendChild(printFrame);

      const frameDocument = printFrame.contentWindow?.document;

      if (frameDocument) {
        frameDocument.open();
        frameDocument.write(report.html);
        frameDocument.close();
        printFrame.contentWindow?.focus();
        printFrame.contentWindow?.print();
        setMessage('PDF gerado. Use “Salvar como PDF” na janela de impressão.');
        window.setTimeout(() => {
          printFrame.remove();
        }, 1000);
        return;
      }

      printFrame.remove();
    }

    const reportWindow = window.open('', '_blank');

    if (!reportWindow) {
      setMessage('PDF não disponível. Permita pop-ups ou use CSV por enquanto.');
      return;
    }

    reportWindow.document.open();
    reportWindow.document.write(report.html);
    reportWindow.document.close();
    reportWindow.focus();
    reportWindow.print();
    setMessage('PDF gerado. Use “Salvar como PDF” na janela de impressão.');
  };

  const exportCsv = () => {
    if (!canExport) {
      setMessage(validationMessage || 'Prévia vazia. Ajuste os filtros para exportar CSV.');
      return;
    }

    downloadCsv(report.csvRows);
    setMessage('CSV exportado');
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Gerar relatório</Text>
          <Text style={styles.subtitle}>Texto para WhatsApp/e-mail, PDF imprimível e exportação CSV tabular.</Text>
        </View>
      </View>

      <View style={styles.panel}>
        <Text style={styles.sectionTitle}>Tipo de relatório</Text>
        <View style={styles.optionRow}>
          {reportKinds.map((item) => (
            <Pressable
              key={item.value}
              onPress={() => setKind(item.value)}
              style={[styles.chip, kind === item.value && styles.chipSelected]}>
              <Text style={[styles.chipText, kind === item.value && styles.chipTextSelected]}>{item.label}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.hint}>
          {kind === 'apartment'
            ? 'Informe o apartamento para este tipo de relatório.'
            : kind === 'tower'
              ? 'Selecione uma torre para este tipo de relatório.'
              : kind === 'service'
                ? 'Informe o serviço para este tipo de relatório.'
                : kind === 'contractor'
                  ? 'Informe o empreiteiro para este tipo de relatório.'
                  : 'Use a data do relatório para o relatório do dia da obra.'}
        </Text>
      </View>

      <View style={styles.panel}>
        <Text style={styles.sectionTitle}>Filtros</Text>
        <View style={styles.inputGrid}>
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Obra</Text>
            <TextInput editable={false} style={[styles.input, styles.disabledInput]} value={project.name} />
          </View>
          <View style={styles.fullWidthGroup}>
            <Text style={styles.fieldLabel}>Torre</Text>
            <View style={styles.optionRow}>
              <Pressable onPress={() => updateFilter('tower', 'Todos')} style={[styles.chip, filters.tower === 'Todos' && styles.chipSelected]}>
                <Text style={[styles.chipText, filters.tower === 'Todos' && styles.chipTextSelected]}>Todas as torres</Text>
              </Pressable>
              {towers.map((tower) => (
                <Pressable key={tower.id} onPress={() => updateFilter('tower', tower.id)} style={[styles.chip, filters.tower === tower.id && styles.chipSelected]}>
                  <Text style={[styles.chipText, filters.tower === tower.id && styles.chipTextSelected]}>{tower.name}</Text>
                </Pressable>
              ))}
            </View>
          </View>
          <Field label="Apartamento" required={kind === 'apartment'} value={filters.apartment} onChangeText={(value) => updateFilter('apartment', value)} />
          <Field label="Serviço" required={kind === 'service'} value={filters.service} onChangeText={(value) => updateFilter('service', value)} />
          <Field label="Empreiteiro" required={kind === 'contractor'} value={filters.contractor} onChangeText={(value) => updateFilter('contractor', value)} />
          <Field label="Data do relatório" required value={filters.date} onChangeText={(value) => updateDateFilter('date', value)} />
          <Field label="Período início" value={filters.periodStart} onChangeText={(value) => updateDateFilter('periodStart', value)} />
          <Field label="Período fim" value={filters.periodEnd} onChangeText={(value) => updateDateFilter('periodEnd', value)} />
        </View>
        {validationMessage ? (
          <Text style={styles.warningText}>{validationMessage}</Text>
        ) : null}
      </View>

      <View style={styles.panel}>
        <Text style={styles.sectionTitle}>Conteúdo</Text>
        <View style={styles.optionRow}>
          {contentOptions.map((item) => {
            const selected = options[item.field];

            return (
              <Pressable
                key={item.field}
                onPress={() => toggleOption(item.field)}
                style={[styles.chip, selected && styles.chipSelected]}>
                <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{item.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.panel}>
        <Text style={styles.sectionTitle}>Formatos</Text>
        <View style={styles.actionRow}>
          <Pressable onPress={copyReport} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>Copiar relatório</Text>
          </Pressable>
          <Pressable onPress={generatePdf} style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>Gerar PDF</Text>
          </Pressable>
          <Pressable onPress={exportCsv} style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>Exportar CSV</Text>
          </Pressable>
          <Pressable disabled style={[styles.secondaryButton, styles.disabledButton]}>
            <Text style={styles.disabledButtonText}>Exportar Excel</Text>
          </Pressable>
        </View>
        <Text style={styles.hint}>Exportação Excel será habilitada na próxima versão. Use CSV por enquanto.</Text>
        {message ? <Text style={styles.message}>{message}</Text> : null}
      </View>

      <View style={styles.panel}>
        <Text style={styles.sectionTitle}>Prévia para copiar</Text>
        <Text selectable style={styles.previewText}>{report.text || 'Sem dados para os filtros atuais.'}</Text>
      </View>
    </ScrollView>
  );
}

function Field({
  label,
  onChangeText,
  required = false,
  value,
}: {
  label: string;
  onChangeText: (value: string) => void;
  required?: boolean;
  value: string;
}) {
  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.fieldLabel}>
        {label}
        {required ? ' *' : ''}
      </Text>
      <TextInput
        onChangeText={onChangeText}
        placeholder={label.includes('Data') || label.includes('Período') ? 'DD/MM/AAAA' : label}
        placeholderTextColor="#94A3B8"
        style={styles.input}
        value={value}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  actionRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    borderColor: '#CBD5E1',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  chipSelected: {
    backgroundColor: '#DBEAFE',
    borderColor: '#2563EB',
  },
  chipText: {
    color: '#475569',
    fontSize: 12,
    fontWeight: '800',
  },
  chipTextSelected: {
    color: '#2563EB',
  },
  container: {
    gap: 14,
    padding: 20,
  },
  disabledButton: {
    backgroundColor: '#E2E8F0',
  },
  disabledButtonText: {
    color: '#64748B',
    fontSize: 12,
    fontWeight: '900',
  },
  disabledInput: {
    color: '#64748B',
  },
  fieldGroup: {
    flexBasis: '31%',
    flexGrow: 1,
    gap: 6,
    minWidth: 0,
  },
  fieldLabel: {
    color: '#475569',
    fontSize: 12,
    fontWeight: '900',
  },
  fullWidthGroup: {
    flexBasis: '100%',
    flexGrow: 1,
    gap: 6,
    minWidth: 0,
  },
  header: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0',
    borderRadius: 8,
    borderWidth: 1,
    padding: 18,
  },
  hint: {
    color: '#64748B',
    fontSize: 12,
    fontWeight: '800',
  },
  input: {
    backgroundColor: '#F8FAFC',
    borderColor: '#CBD5E1',
    borderRadius: 8,
    borderWidth: 1,
    color: '#0F172A',
    flexGrow: 1,
    fontSize: 14,
    minHeight: 42,
    paddingHorizontal: 10,
    width: '100%',
  },
  inputGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    width: '100%',
  },
  message: {
    color: '#2563EB',
    fontSize: 13,
    fontWeight: '900',
  },
  optionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  panel: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0',
    borderRadius: 8,
    borderWidth: 1,
    gap: 12,
    padding: 16,
    width: '100%',
  },
  previewText: {
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
    borderRadius: 8,
    borderWidth: 1,
    color: '#0F172A',
    fontSize: 13,
    lineHeight: 20,
    padding: 12,
  },
  primaryButton: {
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
  sectionTitle: {
    color: '#0F172A',
    fontSize: 18,
    fontWeight: '900',
  },
  subtitle: {
    color: '#64748B',
    fontSize: 14,
    lineHeight: 20,
    marginTop: 4,
  },
  title: {
    color: '#0F172A',
    fontSize: 28,
    fontWeight: '900',
  },
  warningText: {
    color: '#B45309',
    fontSize: 13,
    fontWeight: '900',
  },
});
