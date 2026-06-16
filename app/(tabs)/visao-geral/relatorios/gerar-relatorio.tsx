import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Text } from '@/src/ui/Text';
import { useToast } from '@/src/ui/Toast';

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
const csvBom = '﻿';

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

const reportKinds: { label: string; value: ReportKind }[] = [
  { label: 'Dia da obra', value: 'daily' },
  { label: 'Por torre', value: 'tower' },
  { label: 'Por apartamento', value: 'apartment' },
  { label: 'Por serviço', value: 'service' },
  { label: 'Por empreiteiro', value: 'contractor' },
];

const reportKindHints: Record<ReportKind, string> = {
  daily: 'Usa a data do relatório para resumir o dia da obra.',
  tower: 'Selecione uma torre para gerar o relatório.',
  apartment: 'Informe o apartamento para gerar o relatório.',
  service: 'Informe o serviço para gerar o relatório.',
  contractor: 'Informe o empreiteiro para gerar o relatório.',
};

const contentOptions: { field: keyof ReportContentOptions; label: string }[] = [
  { field: 'includeSummary', label: 'Resumo' },
  { field: 'includeChecklist', label: 'Checklist' },
  { field: 'includeIssues', label: 'Pendências' },
  { field: 'includePhotos', label: 'Fotos' },
  { field: 'includeBlocked', label: 'Serviços travados' },
  { field: 'includeSchedule', label: 'Cronograma' },
  { field: 'includeMeasurements', label: 'Medições' },
  { field: 'includeHistory', label: 'Histórico de visitas' },
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
  let text = String(value);

  // Neutralize spreadsheet formula injection (same guard as the report engine).
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) {
    text = `'${text}`;
  }

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
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const [kind, setKind] = useState<ReportKind>('daily');
  const [filters, setFilters] = useState<ReportFilters>(defaultFilters);
  const [options, setOptions] = useState<ReportContentOptions>(defaultOptions);

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

  const blockExport = (verb: string) => {
    toast.error(validationMessage || `Prévia vazia. Ajuste os filtros para ${verb}.`);
  };

  const copyReport = async () => {
    if (!canExport) return blockExport('copiar');

    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(report.text);
        toast.saved('Relatório copiado');
        return;
      }
    } catch {
      // Fall back to showing the text in the preview.
    }

    toast.error('Não foi possível copiar. Use a prévia abaixo.');
  };

  const generatePdf = () => {
    if (!canExport) return blockExport('gerar o PDF');

    if (typeof window === 'undefined') {
      toast.error('PDF não disponível neste ambiente.');
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
        toast.saved('PDF gerado. Use “Salvar como PDF”.');
        window.setTimeout(() => {
          printFrame.remove();
        }, 1000);
        return;
      }

      printFrame.remove();
    }

    const reportWindow = window.open('', '_blank');

    if (!reportWindow) {
      toast.error('Permita pop-ups ou use CSV por enquanto.');
      return;
    }

    reportWindow.document.open();
    reportWindow.document.write(report.html);
    reportWindow.document.close();
    reportWindow.focus();
    reportWindow.print();
    toast.saved('PDF gerado. Use “Salvar como PDF”.');
  };

  const exportCsv = () => {
    if (!canExport) return blockExport('exportar o CSV');

    downloadCsv(report.csvRows);
    toast.saved('CSV exportado');
  };

  return (
    <View style={s.screen}>
      <View style={[s.backBar, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} style={s.backBtn}>
          <MaterialCommunityIcons name="chevron-left" size={26} color="#0F172A" />
          <Text style={s.backBtnText}>Voltar</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={s.container} showsVerticalScrollIndicator={false}>
        {/* HEADER */}
        <View style={s.header}>
          <View style={s.headerIcon}>
            <MaterialCommunityIcons name="file-export-outline" size={24} color="#2563EB" />
          </View>
          <View style={s.headerInfo}>
            <Text style={s.title}>Gerar relatório</Text>
            <Text style={s.subtitle}>Texto para WhatsApp/e-mail, PDF imprimível e CSV.</Text>
          </View>
        </View>

        {/* TIPO */}
        <View style={s.card}>
          <CardHead icon="file-document-outline" title="Tipo de relatório" />
          <View style={s.chipRow}>
            {reportKinds.map((item) => {
              const selected = kind === item.value;
              return (
                <Pressable key={item.value} onPress={() => setKind(item.value)} style={[s.chip, selected && s.chipSelected]}>
                  <Text style={[s.chipText, selected && s.chipTextSelected]}>{item.label}</Text>
                </Pressable>
              );
            })}
          </View>
          <View style={s.hintRow}>
            <MaterialCommunityIcons name="information-outline" size={13} color="#94A3B8" />
            <Text style={s.hint}>{reportKindHints[kind]}</Text>
          </View>
        </View>

        {/* FILTROS */}
        <View style={s.card}>
          <CardHead icon="filter-variant" title="Filtros" />

          <View style={s.fieldGroup}>
            <Text style={s.fieldLabel}>Obra</Text>
            <TextInput editable={false} style={[s.input, s.inputDisabled]} value={project.name} />
          </View>

          <View style={s.fieldGroup}>
            <Text style={s.fieldLabel}>Torre</Text>
            <View style={s.chipRow}>
              <Pressable onPress={() => updateFilter('tower', 'Todos')} style={[s.chip, filters.tower === 'Todos' && s.chipSelected]}>
                <Text style={[s.chipText, filters.tower === 'Todos' && s.chipTextSelected]}>Todas as torres</Text>
              </Pressable>
              {towers.map((tower) => {
                const selected = filters.tower === tower.id;
                return (
                  <Pressable key={tower.id} onPress={() => updateFilter('tower', tower.id)} style={[s.chip, selected && s.chipSelected]}>
                    <Text style={[s.chipText, selected && s.chipTextSelected]}>{tower.name}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <Field label="Apartamento" required={kind === 'apartment'} value={filters.apartment} onChangeText={(value) => updateFilter('apartment', value)} />
          <Field label="Serviço" required={kind === 'service'} value={filters.service} onChangeText={(value) => updateFilter('service', value)} />
          <Field label="Empreiteiro" required={kind === 'contractor'} value={filters.contractor} onChangeText={(value) => updateFilter('contractor', value)} />
          <Field label="Data do relatório" required value={filters.date} onChangeText={(value) => updateDateFilter('date', value)} />

          <View style={s.fieldRow}>
            <View style={s.fieldCol}>
              <Field label="Período início" value={filters.periodStart} onChangeText={(value) => updateDateFilter('periodStart', value)} />
            </View>
            <View style={s.fieldCol}>
              <Field label="Período fim" value={filters.periodEnd} onChangeText={(value) => updateDateFilter('periodEnd', value)} />
            </View>
          </View>

          {validationMessage ? (
            <View style={s.warnRow}>
              <MaterialCommunityIcons name="alert-outline" size={15} color="#B45309" />
              <Text style={s.warnText}>{validationMessage}</Text>
            </View>
          ) : null}
        </View>

        {/* CONTEÚDO */}
        <View style={s.card}>
          <CardHead icon="format-list-checks" title="Conteúdo" />
          <View style={s.chipRow}>
            {contentOptions.map((item) => {
              const selected = options[item.field];
              return (
                <Pressable key={item.field} onPress={() => toggleOption(item.field)} style={[s.chip, selected && s.chipSelected]}>
                  <MaterialCommunityIcons
                    name={selected ? 'check-circle' : 'circle-outline'}
                    size={13}
                    color={selected ? '#2563EB' : '#94A3B8'}
                  />
                  <Text style={[s.chipText, selected && s.chipTextSelected]}>{item.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* EXPORTAR */}
        <View style={s.card}>
          <CardHead icon="tray-arrow-down" title="Exportar" />
          <Pressable onPress={copyReport} style={[s.primaryBtn, !canExport && s.btnMuted]}>
            <MaterialCommunityIcons name="content-copy" size={16} color="#FFFFFF" />
            <Text style={s.primaryBtnText}>Copiar relatório</Text>
          </Pressable>
          <View style={s.btnRow}>
            <Pressable onPress={generatePdf} style={[s.secondaryBtn, !canExport && s.btnMuted]}>
              <MaterialCommunityIcons name="file-pdf-box" size={16} color="#2563EB" />
              <Text style={s.secondaryBtnText}>PDF</Text>
            </Pressable>
            <Pressable onPress={exportCsv} style={[s.secondaryBtn, !canExport && s.btnMuted]}>
              <MaterialCommunityIcons name="file-delimited-outline" size={16} color="#2563EB" />
              <Text style={s.secondaryBtnText}>CSV</Text>
            </Pressable>
            <Pressable disabled style={[s.secondaryBtn, s.ghostBtn]}>
              <MaterialCommunityIcons name="microsoft-excel" size={16} color="#94A3B8" />
              <Text style={s.ghostBtnText}>Excel</Text>
            </Pressable>
          </View>
          <View style={s.hintRow}>
            <MaterialCommunityIcons name="information-outline" size={13} color="#94A3B8" />
            <Text style={s.hint}>Exportação Excel chega em breve. Use CSV por enquanto.</Text>
          </View>
        </View>

        {/* PRÉVIA */}
        <View style={s.card}>
          <CardHead icon="eye-outline" title="Prévia" />
          <Text selectable style={s.previewText}>{report.text || 'Sem dados para os filtros atuais.'}</Text>
        </View>
      </ScrollView>
    </View>
  );
}

function CardHead({ icon, title }: { icon: IconName; title: string }) {
  return (
    <View style={s.cardHead}>
      <MaterialCommunityIcons name={icon} size={16} color="#0F172A" />
      <Text style={s.cardTitle}>{title}</Text>
    </View>
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
  const isDate = label.includes('Data') || label.includes('Período');
  return (
    <View style={s.fieldGroup}>
      <Text style={s.fieldLabel}>
        {label}
        {required ? <Text style={s.fieldRequired}> *</Text> : null}
      </Text>
      <TextInput
        onChangeText={onChangeText}
        placeholder={isDate ? 'DD/MM/AAAA' : label}
        placeholderTextColor="#94A3B8"
        style={s.input}
        value={value}
      />
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F8FAFC' },

  backBar: { paddingHorizontal: 8, paddingBottom: 4, backgroundColor: '#F8FAFC' },
  backBtn: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 2, paddingVertical: 6, paddingHorizontal: 4 },
  backBtnText: { color: '#0F172A', fontSize: 15, fontWeight: '600' },

  container: { gap: 12, padding: 16, paddingBottom: 40 },

  header: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#FFFFFF', borderColor: '#E2E8F0', borderWidth: 1, borderRadius: 14, padding: 16 },
  headerIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: '#EFF6FF', alignItems: 'center', justifyContent: 'center' },
  headerInfo: { flex: 1 },
  title: { color: '#0F172A', fontSize: 20, fontWeight: '900' },
  subtitle: { color: '#64748B', fontSize: 13, lineHeight: 18, marginTop: 2 },

  card: { backgroundColor: '#FFFFFF', borderColor: '#E2E8F0', borderWidth: 1, borderRadius: 14, padding: 16, gap: 12 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle: { color: '#0F172A', fontSize: 15, fontWeight: '800' },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#FFFFFF', borderColor: '#E2E8F0', borderRadius: 999, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8 },
  chipSelected: { backgroundColor: '#EFF6FF', borderColor: '#2563EB' },
  chipText: { color: '#64748B', fontSize: 12, fontWeight: '700' },
  chipTextSelected: { color: '#2563EB' },

  hintRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  hint: { color: '#94A3B8', fontSize: 12, fontWeight: '600', flex: 1, lineHeight: 16 },

  fieldGroup: { gap: 6 },
  fieldRow: { flexDirection: 'row', gap: 10 },
  fieldCol: { flex: 1 },
  fieldLabel: { color: '#475569', fontSize: 12, fontWeight: '700' },
  fieldRequired: { color: '#DC2626' },
  input: { backgroundColor: '#F8FAFC', borderColor: '#E2E8F0', borderRadius: 10, borderWidth: 1, color: '#0F172A', fontSize: 14, minHeight: 44, paddingHorizontal: 12 },
  inputDisabled: { color: '#94A3B8' },

  warnRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#FFFBEB', borderColor: '#FDE68A', borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  warnText: { color: '#B45309', fontSize: 12, fontWeight: '700', flex: 1, lineHeight: 16 },

  primaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#2563EB', borderRadius: 10, paddingVertical: 13 },
  primaryBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  btnRow: { flexDirection: 'row', gap: 10 },
  secondaryBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#FFFFFF', borderColor: '#E2E8F0', borderWidth: 1, borderRadius: 10, paddingVertical: 12 },
  secondaryBtnText: { color: '#2563EB', fontSize: 13, fontWeight: '800' },
  btnMuted: { opacity: 0.5 },
  ghostBtn: { backgroundColor: '#F8FAFC' },
  ghostBtnText: { color: '#94A3B8', fontSize: 13, fontWeight: '800' },

  previewText: { backgroundColor: '#F8FAFC', borderColor: '#E2E8F0', borderRadius: 10, borderWidth: 1, color: '#334155', fontSize: 13, lineHeight: 20, padding: 12 },
});
