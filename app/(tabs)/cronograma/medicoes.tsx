import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Image, Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '@/src/ui/Text';
import { useToast } from '@/src/ui/Toast';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import type { Measurement, MeasurementStatus, MeasurementType } from '@/src/data/localMeasurements';
import {
  formatCurrency,
  getAllowedMeasurementTransitions,
  getMeasurementTypeLabel,
  isMeasurementPeriodValid,
  measurementStatusOptions,
  measurementTypeOptions,
  parseBrDateForMeasurement,
  toNumber,
} from '@/src/data/localMeasurements';
import { useObras } from '@/src/data/ObrasContext';
import * as db from '@/src/data/db';

type EnrichedMeasurement = Measurement & {
  apartmentNumber: string;
  towerId: string;
  towerLabel: string;
};

type EditDraft = {
  contractor: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  periodStart: string;
  periodEnd: string;
  status: MeasurementStatus;
  comment: string;
  measurementType: MeasurementType;
  evidenceUri: string;
  evidenceFileName: string;
};

const allFilter = 'Todos';
const csvSeparator = ';';
const csvBom = '﻿';

const escapeCsvValue = (value: string | number) => {
  const text = String(value);
  if (text.includes('"') || text.includes(csvSeparator) || text.includes('\n') || text.includes('\r')) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
};

const downloadCsv = (measurements: EnrichedMeasurement[], projectName: string) => {
  if (typeof document === 'undefined') return;
  const header = ['Obra', 'Torre', 'Apartamento', 'Serviço', 'Empreiteiro', 'Quantidade', 'Unidade', 'Valor unitário', 'Valor total', 'Período início', 'Período fim', 'Status', 'Responsável', 'Data de lançamento', 'Data de aprovação', 'Comentário'];
  const rows = measurements.map((m) => [projectName, m.towerLabel, `Apartamento ${m.apartmentNumber}`, m.service, m.contractor, m.quantity, m.unit, m.unitPrice, m.totalValue, m.periodStart, m.periodEnd, m.status, m.responsible ?? 'Usuário local', m.launchedAt ?? '', m.approvedAt ?? '', m.comment]);
  const csv = csvBom + [header, ...rows].map((row) => row.map((v) => escapeCsvValue(v)).join(csvSeparator)).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'medicoes-residencial-cagliari.csv';
  link.click();
  URL.revokeObjectURL(url);
};

const createEditDraft = (m: Measurement): EditDraft => ({
  contractor: m.contractor, quantity: String(m.quantity), unit: m.unit,
  unitPrice: String(m.unitPrice), periodStart: m.periodStart, periodEnd: m.periodEnd,
  status: m.status, comment: m.comment, measurementType: m.measurementType,
  evidenceUri: m.evidenceUri ?? '', evidenceFileName: m.evidenceFileName ?? '',
});

const STATUS_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  'Em aberto':               { bg: '#F1F5F9', text: '#475569', border: '#CBD5E1' },
  'Conferido':               { bg: '#EFF6FF', text: '#1D4ED8', border: '#3B82F6' },
  'Aprovado para pagamento': { bg: '#D1FAE5', text: '#047857', border: '#10B981' },
  'Pago externamente':       { bg: '#F0FDF4', text: '#15803D', border: '#4ADE80' },
  'Retido':                  { bg: '#FEF3C7', text: '#B45309', border: '#FCD34D' },
  'Reprovado':               { bg: '#FEE2E2', text: '#B91C1C', border: '#F87171' },
};

export default function MeasurementsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { towers, project, getApartmentById, getTowerById } = useObras();
  const [measurements, setMeasurements] = useState<EnrichedMeasurement[]>([]);
  const [towerFilter, setTowerFilter] = useState(allFilter);
  const [apartmentFilter, setApartmentFilter] = useState('');
  const [serviceFilter, setServiceFilter] = useState('');
  const [contractorFilter, setContractorFilter] = useState('');
  const [periodStartFilter, setPeriodStartFilter] = useState('');
  const [periodEndFilter, setPeriodEndFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<MeasurementStatus | typeof allFilter>(allFilter);
  const [editingMeasurementId, setEditingMeasurementId] = useState<string>();
  const [editDraft, setEditDraft] = useState<EditDraft>();
  const [selectedEvidence, setSelectedEvidence] = useState<EnrichedMeasurement>();

  useFocusEffect(useCallback(() => {
    db.loadAllMeasurements().then((raw) => {
      setMeasurements(raw.map((m) => {
        const apt = getApartmentById(m.apartmentId);
        const tower = apt ? getTowerById(apt.towerId) : undefined;
        return { ...m, apartmentNumber: apt?.number ?? m.apartmentId.replace('ap-', ''), towerId: tower?.id ?? '', towerLabel: tower ? `${tower.name} / ${tower.block} / ${tower.position}` : 'Torre não encontrada' };
      }));
    });
  }, [getApartmentById, getTowerById]));

  const filteredMeasurements = useMemo(() => measurements.filter((m) => {
    const matchesTower = towerFilter === allFilter || m.towerId === towerFilter;
    const matchesApt = !apartmentFilter.trim() || m.apartmentNumber.includes(apartmentFilter.trim());
    const matchesContractor = !contractorFilter.trim() || m.contractor.toLocaleLowerCase('pt-BR').includes(contractorFilter.trim().toLocaleLowerCase('pt-BR'));
    const matchesService = !serviceFilter.trim() || m.service.toLocaleLowerCase('pt-BR').includes(serviceFilter.trim().toLocaleLowerCase('pt-BR'));
    const matchesStatus = statusFilter === allFilter || m.status === statusFilter;
    const mStart = parseBrDateForMeasurement(m.periodStart);
    const mEnd = parseBrDateForMeasurement(m.periodEnd);
    const fStart = periodStartFilter.trim() ? parseBrDateForMeasurement(periodStartFilter.trim()) : undefined;
    const fEnd = periodEndFilter.trim() ? parseBrDateForMeasurement(periodEndFilter.trim()) : undefined;
    const matchesPStart = !fStart || !mStart || mStart.getTime() >= fStart.getTime();
    const matchesPEnd = !fEnd || !mEnd || mEnd.getTime() <= fEnd.getTime();
    return matchesTower && matchesApt && matchesContractor && matchesService && matchesStatus && matchesPStart && matchesPEnd;
  }), [apartmentFilter, contractorFilter, measurements, periodEndFilter, periodStartFilter, serviceFilter, statusFilter, towerFilter]);

  const filteredTotal = filteredMeasurements.reduce((t, m) => t + m.totalValue, 0);
  const approvedTotal = filteredMeasurements.filter((m) => m.status === 'Aprovado para pagamento').reduce((t, m) => t + m.totalValue, 0);
  const retainedOrRejectedTotal = filteredMeasurements.filter((m) => m.status === 'Retido' || m.status === 'Reprovado').reduce((t, m) => t + m.totalValue, 0);
  const totalByStatus = (status: MeasurementStatus) => filteredMeasurements.filter((m) => m.status === status).reduce((t, m) => t + m.totalValue, 0);

  const startEditing = (m: EnrichedMeasurement) => { setEditingMeasurementId(m.id); setEditDraft(createEditDraft(m)); };
  const cancelEditing = () => { setEditingMeasurementId(undefined); setEditDraft(undefined); };

  const updateDraft = (field: keyof EditDraft, value: EditDraft[keyof EditDraft]) => {
    setEditDraft((cur) => cur ? { ...cur, [field]: value } : cur);
  };

  const saveEdited = (measurement: EnrichedMeasurement) => {
    if (!editDraft) return;
    const quantity = toNumber(editDraft.quantity);
    const unitPrice = toNumber(editDraft.unitPrice);
    if (quantity <= 0 || unitPrice < 0) return;
    if (!isMeasurementPeriodValid(editDraft.periodStart, editDraft.periodEnd)) return;
    const updated = measurements.map((cur) => cur.id === measurement.id ? {
      ...cur, contractor: editDraft.contractor.trim() || cur.contractor, quantity, unit: editDraft.unit.trim() || cur.unit,
      unitPrice, totalValue: quantity * unitPrice, periodStart: editDraft.periodStart, periodEnd: editDraft.periodEnd,
      status: editDraft.status, comment: editDraft.comment.trim(), measurementType: editDraft.measurementType,
      evidenceUri: editDraft.evidenceUri || cur.evidenceUri, evidenceFileName: editDraft.evidenceFileName || cur.evidenceFileName,
      approvedAt: editDraft.status === 'Aprovado para pagamento' && cur.status !== 'Aprovado para pagamento' ? new Date().toISOString() : cur.approvedAt,
    } : cur);
    const { apartmentNumber: _an, towerId: _ti, towerLabel: _tl, ...base } = updated.find((m) => m.id === measurement.id)!;
    setMeasurements(updated);
    db.saveMeasurement(base).catch(() => toast.error('Erro ao salvar medição'));
    cancelEditing();
  };

  const updateStatus = (measurement: EnrichedMeasurement, status: MeasurementStatus) => {
    const approvedAt = status === 'Aprovado para pagamento' && measurement.status !== 'Aprovado para pagamento' ? new Date().toISOString() : measurement.approvedAt;
    const updated = { ...measurement, status, approvedAt };
    setMeasurements((prev) => prev.map((m) => (m.id === measurement.id ? updated : m)));
    const { apartmentNumber: _an, towerId: _ti, towerLabel: _tl, ...base } = updated;
    db.saveMeasurement(base).catch(() => toast.error('Erro ao salvar medição'));
  };

  const deleteMeasurement = (measurement: EnrichedMeasurement) => {
    setMeasurements((prev) => prev.filter((m) => m.id !== measurement.id));
    db.deleteMeasurement(measurement.id).catch(() => toast.error('Erro ao excluir medição'));
    cancelEditing();
  };

  return (
    <>
      <View style={[s.backBar, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.push('/(tabs)/cronograma' as any)} style={s.backBtn}>
          <MaterialCommunityIcons name="chevron-left" size={26} color="#0F172A" />
          <Text style={s.backBtnText}>Cronograma</Text>
        </Pressable>
      </View>
      <ScrollView style={s.scroll} contentContainerStyle={s.container}>

      {/* HEADER */}
      <View style={s.pageHeader}>
        <View style={s.pageHeaderLeft}>
          <MaterialCommunityIcons name="ruler" size={28} color="#047857" />
          <View>
            <Text style={s.pageTitle}>Medições</Text>
            <Text style={s.pageSubtitle}>Registros financeiros por serviço</Text>
          </View>
        </View>
        <Pressable onPress={() => downloadCsv(filteredMeasurements, project.name)} style={s.exportBtn}>
          <MaterialCommunityIcons name="export" size={16} color="#FFFFFF" />
          <Text style={s.exportBtnText}>CSV</Text>
        </Pressable>
      </View>

      {/* SUMMARY — green border (financial) */}
      <View style={[s.section, s.sectionGreen]}>
        <Text style={[s.sectionTitle, { color: '#047857' }]}>Resumo financeiro</Text>
        <View style={s.summaryGrid}>
          {[
            { label: 'Medições', value: String(filteredMeasurements.length), color: '#0F172A' },
            { label: 'Total filtrado', value: formatCurrency(filteredTotal), color: '#047857' },
            { label: 'Aprovado', value: formatCurrency(approvedTotal), color: '#1D4ED8' },
            { label: 'Retido/Reprov.', value: formatCurrency(retainedOrRejectedTotal), color: '#B91C1C' },
          ].map((item) => (
            <View key={item.label} style={s.summaryCard}>
              <Text style={[s.summaryValue, { color: item.color }]}>{item.value}</Text>
              <Text style={s.summaryLabel}>{item.label}</Text>
            </View>
          ))}
        </View>
        <View style={s.statusRow}>
          {measurementStatusOptions.map((status) => {
            const sc = STATUS_COLORS[status] ?? STATUS_COLORS['Em aberto'];
            const val = totalByStatus(status);
            return val > 0 ? (
              <View key={status} style={[s.statusChip, { backgroundColor: sc.bg, borderColor: sc.border }]}>
                <Text style={[s.statusChipText, { color: sc.text }]}>{status}: {formatCurrency(val)}</Text>
              </View>
            ) : null;
          })}
        </View>
      </View>

      {/* FILTERS — blue border */}
      <View style={[s.section, s.sectionBlue]}>
        <Text style={[s.sectionTitle, { color: '#1D4ED8' }]}>Filtros</Text>

        <View style={s.filterBlock}>
          <Text style={s.filterLabel}>Torre</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chipRow}>
            <Pressable onPress={() => setTowerFilter(allFilter)} style={[s.chip, towerFilter === allFilter && s.chipActive]}>
              <Text style={[s.chipText, towerFilter === allFilter && s.chipTextActive]}>Todas</Text>
            </Pressable>
            {towers.map((tower) => (
              <Pressable key={tower.id} onPress={() => setTowerFilter(tower.id)} style={[s.chip, towerFilter === tower.id && s.chipActive]}>
                <Text style={[s.chipText, towerFilter === tower.id && s.chipTextActive]}>{tower.name}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>

        <View style={s.inputGrid}>
          {[
            { label: 'Apartamento', value: apartmentFilter, set: setApartmentFilter, ph: 'Ex.: 11' },
            { label: 'Empreiteiro', value: contractorFilter, set: setContractorFilter, ph: 'Nome do empreiteiro' },
            { label: 'Serviço', value: serviceFilter, set: setServiceFilter, ph: 'Nome do serviço' },
            { label: 'Período início', value: periodStartFilter, set: setPeriodStartFilter, ph: 'DD/MM/AAAA' },
            { label: 'Período fim', value: periodEndFilter, set: setPeriodEndFilter, ph: 'DD/MM/AAAA' },
          ].map((f) => (
            <View key={f.label} style={s.fieldGroup}>
              <Text style={s.filterLabel}>{f.label}</Text>
              <TextInput onChangeText={f.set} placeholder={f.ph} placeholderTextColor="#94A3B8" style={s.input} value={f.value} />
            </View>
          ))}
        </View>

        <View style={s.filterBlock}>
          <Text style={s.filterLabel}>Status</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chipRow}>
            <Pressable onPress={() => setStatusFilter(allFilter)} style={[s.chip, statusFilter === allFilter && s.chipActive]}>
              <Text style={[s.chipText, statusFilter === allFilter && s.chipTextActive]}>Todos</Text>
            </Pressable>
            {measurementStatusOptions.map((status) => (
              <Pressable key={status} onPress={() => setStatusFilter(status)} style={[s.chip, statusFilter === status && s.chipActive]}>
                <Text style={[s.chipText, statusFilter === status && s.chipTextActive]}>{status}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </View>

      {/* MEASUREMENTS LIST */}
      {filteredMeasurements.length === 0 ? (
        <View style={[s.section, { borderColor: '#E2E8F0', borderWidth: 2, alignItems: 'center', paddingVertical: 28 }]}>
          <MaterialCommunityIcons name="ruler" size={36} color="#CBD5E1" />
          <Text style={{ color: '#94A3B8', fontSize: 14, marginTop: 8 }}>Nenhuma medição encontrada para os filtros atuais.</Text>
        </View>
      ) : (
        filteredMeasurements.map((measurement) => {
          const isEditing = editingMeasurementId === measurement.id && editDraft;
          const draftTotal = editDraft ? toNumber(editDraft.quantity) * toNumber(editDraft.unitPrice) : measurement.totalValue;
          const sc = STATUS_COLORS[measurement.status] ?? STATUS_COLORS['Em aberto'];

          return (
            <View key={measurement.id} style={[s.card, { borderColor: sc.border }]}>
              <View style={s.cardHeader}>
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={s.cardTitle}>{measurement.service}</Text>
                  <Text style={s.cardMeta}>Apto {measurement.apartmentNumber} · {measurement.towerLabel}</Text>
                </View>
                <View style={s.cardHeaderRight}>
                  <Text style={[s.cardTotal, { color: '#047857' }]}>{formatCurrency(isEditing ? draftTotal : measurement.totalValue)}</Text>
                  <View style={[s.statusBadge, { backgroundColor: sc.bg, borderColor: sc.border }]}>
                    <Text style={[s.statusBadgeText, { color: sc.text }]}>{measurement.status}</Text>
                  </View>
                </View>
              </View>

              {isEditing ? (
                <View style={s.editPanel}>
                  <View style={s.inputGrid}>
                    {([
                      { label: 'Empreiteiro', field: 'contractor' as keyof EditDraft, ph: 'Nome' },
                      { label: 'Quantidade', field: 'quantity' as keyof EditDraft, ph: '0', kb: 'decimal-pad' as const },
                      { label: 'Unidade', field: 'unit' as keyof EditDraft, ph: 'm², un' },
                      { label: 'Valor unitário', field: 'unitPrice' as keyof EditDraft, ph: '0,00', kb: 'decimal-pad' as const },
                      { label: 'Período início', field: 'periodStart' as keyof EditDraft, ph: 'DD/MM/AAAA' },
                      { label: 'Período fim', field: 'periodEnd' as keyof EditDraft, ph: 'DD/MM/AAAA' },
                    ]).map((f) => (
                      <View key={f.field} style={s.fieldGroup}>
                        <Text style={s.filterLabel}>{f.label}</Text>
                        <TextInput keyboardType={f.kb} onChangeText={(v) => updateDraft(f.field, v)} placeholder={f.ph} placeholderTextColor="#94A3B8" style={s.input} value={String(editDraft[f.field] ?? '')} />
                      </View>
                    ))}
                  </View>
                  <View style={s.filterBlock}>
                    <Text style={s.filterLabel}>Tipo</Text>
                    <View style={s.chipRow}>
                      {measurementTypeOptions.map((t) => (
                        <Pressable key={t} onPress={() => updateDraft('measurementType', t)} style={[s.chip, editDraft.measurementType === t && s.chipActive]}>
                          <Text style={[s.chipText, editDraft.measurementType === t && s.chipTextActive]}>{getMeasurementTypeLabel(t)}</Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                  <View style={s.filterBlock}>
                    <Text style={s.filterLabel}>Status</Text>
                    <View style={s.chipRow}>
                      {measurementStatusOptions.map((st) => (
                        <Pressable key={st} onPress={() => updateDraft('status', st)} style={[s.chip, editDraft.status === st && s.chipActive]}>
                          <Text style={[s.chipText, editDraft.status === st && s.chipTextActive]}>{st}</Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                  <TextInput multiline onChangeText={(v) => updateDraft('comment', v)} placeholder="Comentário" placeholderTextColor="#94A3B8" style={s.textarea} value={editDraft.comment} />
                  <View style={s.actionRow}>
                    <Pressable onPress={() => saveEdited(measurement)} style={s.btnPrimary}><Text style={s.btnPrimaryText}>Salvar edição</Text></Pressable>
                    <Pressable onPress={cancelEditing} style={s.btnSecondary}><Text style={s.btnSecondaryText}>Cancelar</Text></Pressable>
                  </View>
                </View>
              ) : (
                <>
                  <View style={s.detailGrid}>
                    {[
                      `Empreiteiro: ${measurement.contractor}`,
                      `Obra: ${project.name}`,
                      `Torre: ${measurement.towerLabel}`,
                      `Apto: ${measurement.apartmentNumber}`,
                      `Qtd: ${measurement.quantity} ${measurement.unit}`,
                      `Valor unit.: ${formatCurrency(measurement.unitPrice)}`,
                      `Tipo: ${getMeasurementTypeLabel(measurement.measurementType)}`,
                      `Período: ${measurement.periodStart} → ${measurement.periodEnd}`,
                      `Responsável: ${measurement.responsible ?? 'Usuário local'}`,
                      `Lançamento: ${measurement.launchedAt ? new Date(measurement.launchedAt).toLocaleString('pt-BR') : 'sem data'}`,
                      `Aprovação: ${measurement.approvedAt ? new Date(measurement.approvedAt).toLocaleString('pt-BR') : 'não aprovada'}`,
                    ].map((t) => (
                      <Text key={t} style={s.detailChip}>{t}</Text>
                    ))}
                  </View>
                  {measurement.comment ? <Text style={s.commentText}>{measurement.comment}</Text> : null}
                  {measurement.evidenceUri ? (
                    <Pressable onPress={() => setSelectedEvidence(measurement)} style={s.evidenceRow}>
                      <Image source={{ uri: measurement.evidenceUri }} style={s.evidenceThumb} />
                      <Text style={s.detailChip}>Ver evidência: {measurement.evidenceFileName ?? 'foto local'}</Text>
                    </Pressable>
                  ) : null}
                  <View style={s.actionRow}>
                    {getAllowedMeasurementTransitions(measurement.status).map((next) => (
                      <Pressable key={`${measurement.id}-${next}`} onPress={() => updateStatus(measurement, next)} style={s.btnPrimary}>
                        <Text style={s.btnPrimaryText}>
                          {next === 'Conferido' ? 'Conferir' : next === 'Aprovado para pagamento' ? 'Aprovar' : next === 'Pago externamente' ? 'Pago ext.' : next === 'Reprovado' ? 'Reprovar' : 'Reter'}
                        </Text>
                      </Pressable>
                    ))}
                    <Pressable onPress={() => downloadCsv([measurement], project.name)} style={s.btnSecondary}><Text style={s.btnSecondaryText}>Exportar</Text></Pressable>
                    <Pressable onPress={() => startEditing(measurement)} style={s.btnSecondary}><Text style={s.btnSecondaryText}>Editar</Text></Pressable>
                    <Pressable onPress={() => deleteMeasurement(measurement)} style={s.btnDanger}><Text style={s.btnDangerText}>Excluir</Text></Pressable>
                  </View>
                </>
              )}
            </View>
          );
        })
      )}

      {/* Evidence Modal */}
      <Modal animationType="fade" onRequestClose={() => setSelectedEvidence(undefined)} transparent visible={Boolean(selectedEvidence)}>
        <View style={s.modalBackdrop}>
          <View style={s.modalSheet}>
            {selectedEvidence?.evidenceUri && (
              <>
                <Image source={{ uri: selectedEvidence.evidenceUri }} style={s.evidenceImage} />
                <Text style={s.cardTitle}>{selectedEvidence.service}</Text>
                <Text style={s.cardMeta}>{selectedEvidence.evidenceFileName ?? 'Evidência local'}</Text>
              </>
            )}
            <Pressable onPress={() => setSelectedEvidence(undefined)} style={s.btnSecondary}>
              <Text style={s.btnSecondaryText}>Fechar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      </ScrollView>
    </>
  );
}

const s = StyleSheet.create({
  backBar: { paddingHorizontal: 8, paddingBottom: 4, backgroundColor: '#F8FAFC' },
  backBtn: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 2, paddingVertical: 6, paddingHorizontal: 4 },
  backBtnText: { color: '#0F172A', fontSize: 15, fontWeight: '600' },
  scroll: { backgroundColor: '#F8FAFC' },
  container: { gap: 12, padding: 16, paddingBottom: 40 },

  // page header
  pageHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 16, borderWidth: 2, borderColor: '#10B981', padding: 16 },
  pageHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  pageTitle: { color: '#0F172A', fontSize: 22, fontWeight: '900' },
  pageSubtitle: { color: '#64748B', fontSize: 13, marginTop: 2 },
  exportBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#047857', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10 },
  exportBtnText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },

  // sections
  section: { backgroundColor: '#FFFFFF', borderRadius: 16, borderWidth: 2, padding: 16, gap: 12 },
  sectionGreen: { borderColor: '#10B981' },
  sectionBlue:  { borderColor: '#3B82F6' },
  sectionTitle: { fontSize: 15, fontWeight: '900' },

  // summary
  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  summaryCard: { flexGrow: 1, minWidth: 140, backgroundColor: '#F8FAFC', borderRadius: 12, padding: 12, gap: 4 },
  summaryValue: { fontSize: 18, fontWeight: '900' },
  summaryLabel: { color: '#64748B', fontSize: 11, fontWeight: '600' },
  statusRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  statusChip: { borderRadius: 8, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 5 },
  statusChipText: { fontSize: 12, fontWeight: '700' },

  // filters
  filterBlock: { gap: 8 },
  filterLabel: { color: '#475569', fontSize: 12, fontWeight: '700' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderColor: '#CBD5E1', borderRadius: 999, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 7 },
  chipActive: { backgroundColor: '#DBEAFE', borderColor: '#2563EB' },
  chipText: { color: '#475569', fontSize: 12, fontWeight: '700' },
  chipTextActive: { color: '#1D4ED8' },
  inputGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  fieldGroup: { flexGrow: 1, gap: 6, minWidth: 160 },
  input: { backgroundColor: '#F8FAFC', borderColor: '#CBD5E1', borderRadius: 10, borderWidth: 1, color: '#0F172A', fontSize: 14, minHeight: 42, paddingHorizontal: 12 },

  // measurement cards
  card: { backgroundColor: '#FFFFFF', borderRadius: 16, borderWidth: 2, padding: 14, gap: 12 },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, justifyContent: 'space-between' },
  cardHeaderRight: { alignItems: 'flex-end', gap: 6 },
  cardTitle: { color: '#0F172A', fontSize: 15, fontWeight: '900' },
  cardMeta: { color: '#64748B', fontSize: 13 },
  cardTotal: { fontSize: 16, fontWeight: '900' },
  statusBadge: { borderRadius: 8, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 4 },
  statusBadgeText: { fontSize: 11, fontWeight: '700' },
  detailGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#F1F5F9' },
  detailChip: { backgroundColor: '#F8FAFC', borderColor: '#E2E8F0', borderRadius: 8, borderWidth: 1, color: '#475569', fontSize: 12, paddingHorizontal: 8, paddingVertical: 4 },
  commentText: { color: '#475569', fontSize: 13, lineHeight: 18 },
  editPanel: { borderTopWidth: 1, borderTopColor: '#F1F5F9', gap: 12, paddingTop: 12 },
  textarea: { backgroundColor: '#F8FAFC', borderColor: '#CBD5E1', borderRadius: 10, borderWidth: 1, color: '#0F172A', fontSize: 14, minHeight: 72, padding: 12, textAlignVertical: 'top' },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  evidenceRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#F8FAFC', borderRadius: 10, padding: 10 },
  evidenceThumb: { borderRadius: 8, height: 56, width: 56 },

  // buttons
  btnPrimary: { backgroundColor: '#1D4ED8', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10 },
  btnPrimaryText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  btnSecondary: { borderColor: '#CBD5E1', borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 9 },
  btnSecondaryText: { color: '#1D4ED8', fontSize: 12, fontWeight: '700' },
  btnDanger: { borderColor: '#F87171', borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 9 },
  btnDangerText: { color: '#B91C1C', fontSize: 12, fontWeight: '700' },

  // modal
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.7)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 20, borderTopRightRadius: 20, gap: 12, padding: 20 },
  evidenceImage: { borderRadius: 12, height: 320, resizeMode: 'contain', width: '100%' },
});
