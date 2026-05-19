import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { Text } from '@/src/ui/Text';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { createEmptyServiceStage, defaultServiceStages } from '@/src/data/serviceStages';
import type { ServiceStage } from '@/src/data/serviceStages';
import * as db from '@/src/data/db';

const booleanFields = [
  ['apareceNoChecklist', 'Checklist'],
  ['apareceNoCronograma', 'Cronograma'],
  ['apareceNaMedicao', 'Medição'],
  ['etapaCritica', 'Crítica'],
  ['travaLiberacao', 'Trava lib.'],
  ['ativo', 'Ativa'],
] as const;

function Field({ keyboardType, label, onChangeText, value }: { keyboardType?: 'default' | 'number-pad'; label: string; onChangeText: (v: string) => void; value: string }) {
  return (
    <View style={s.fieldGroup}>
      <Text style={s.fieldLabel}>{label}</Text>
      <TextInput keyboardType={keyboardType} onChangeText={onChangeText} placeholder={label} placeholderTextColor="#94A3B8" style={s.input} value={value} />
    </View>
  );
}

export default function ServiceStagesScreen() {
  const [stages, setStages] = useState<ServiceStage[]>([]);
  const [editingId, setEditingId] = useState<string>();
  const [draft, setDraft] = useState<ServiceStage>(() => createEmptyServiceStage(1));

  useFocusEffect(useCallback(() => {
    db.loadServiceStages().then((loaded) => {
      setStages(loaded);
      setDraft(createEmptyServiceStage(loaded.length + 1));
      setEditingId(undefined);
    });
  }, []));

  const sortedStages = useMemo(
    () => [...stages].sort((a, b) => a.ordemExecucao - b.ordemExecucao),
    [stages],
  );

  const persistStages = (next: ServiceStage[]) => {
    const ordered = next.map((s, i) => ({ ...s, ordemExecucao: i + 1 })).sort((a, b) => a.ordemExecucao - b.ordemExecucao);
    setStages(ordered);
    db.saveServiceStages(ordered);
  };

  const updateDraft = <F extends keyof ServiceStage>(field: F, value: ServiceStage[F]) => {
    setDraft((cur) => ({ ...cur, [field]: value }));
  };

  const saveDraft = () => {
    if (!draft.nome.trim()) return;
    const normalized: ServiceStage = { ...draft, id: draft.id || `etapa-${Date.now()}`, nome: draft.nome.trim(), categoria: draft.categoria.trim() || 'Execução', unidadeMedicao: draft.unidadeMedicao.trim() || 'un', observacao: draft.observacao.trim() };
    const next = editingId ? stages.map((s) => (s.id === editingId ? normalized : s)) : [...stages, normalized];
    persistStages(next);
    setEditingId(undefined);
    setDraft(createEmptyServiceStage(next.length + 1));
  };

  const editStage = (stage: ServiceStage) => { setEditingId(stage.id); setDraft(stage); };
  const inactivate = (stage: ServiceStage) => persistStages(stages.map((s) => (s.id === stage.id ? { ...s, ativo: false } : s)));

  const moveStage = (stage: ServiceStage, dir: -1 | 1) => {
    const ordered = [...sortedStages];
    const i = ordered.findIndex((s) => s.id === stage.id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ordered.length) return;
    [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
    persistStages(ordered);
  };

  const toggleDependent = (name: string) => {
    const deps = draft.servicosDependentes.includes(name)
      ? draft.servicosDependentes.filter((s) => s !== name)
      : [...draft.servicosDependentes, name];
    updateDraft('servicosDependentes', deps);
  };

  const restoreDefaults = () => {
    persistStages(defaultServiceStages);
    setEditingId(undefined);
    setDraft(createEmptyServiceStage(defaultServiceStages.length + 1));
  };

  const activeCount = stages.filter((s) => s.ativo).length;

  return (
    <ScrollView style={s.scroll} contentContainerStyle={s.container}>

      {/* HEADER */}
      <View style={s.pageHeader}>
        <View style={s.pageHeaderLeft}>
          <MaterialCommunityIcons name="cog-outline" size={28} color="#6D28D9" />
          <View>
            <Text style={s.pageTitle}>Serviços e Etapas</Text>
            <Text style={s.pageSubtitle}>{activeCount} etapas ativas · {stages.length} cadastradas</Text>
          </View>
        </View>
        <Pressable onPress={restoreDefaults} style={s.restoreBtn}>
          <MaterialCommunityIcons name="restore" size={16} color="#6D28D9" />
          <Text style={s.restoreBtnText}>Restaurar</Text>
        </Pressable>
      </View>

      {/* FORM — purple border */}
      <View style={[s.section, s.sectionPurple]}>
        <Text style={[s.sectionTitle, { color: '#6D28D9' }]}>{editingId ? 'Editar etapa' : 'Nova etapa'}</Text>

        <View style={s.formGrid}>
          <Field label="Nome" value={draft.nome} onChangeText={(v) => updateDraft('nome', v)} />
          <Field label="Categoria" value={draft.categoria} onChangeText={(v) => updateDraft('categoria', v)} />
          <Field label="Unidade de medição" value={draft.unidadeMedicao} onChangeText={(v) => updateDraft('unidadeMedicao', v)} />
          <Field label="Ordem de execução" keyboardType="number-pad" value={String(draft.ordemExecucao)} onChangeText={(v) => updateDraft('ordemExecucao', Number(v) || stages.length + 1)} />
        </View>

        <View style={s.toggleRow}>
          {booleanFields.map(([field, label]) => {
            const on = Boolean(draft[field]);
            return (
              <Pressable key={field} onPress={() => updateDraft(field, !on)} style={[s.toggle, on && s.toggleOn]}>
                <MaterialCommunityIcons name={on ? 'check-circle' : 'circle-outline'} size={14} color={on ? '#6D28D9' : '#94A3B8'} />
                <Text style={[s.toggleText, on && s.toggleTextOn]}>{label}</Text>
              </Pressable>
            );
          })}
        </View>

        {sortedStages.filter((s) => s.id !== draft.id).length > 0 && (
          <View style={s.dependencyBox}>
            <Text style={s.fieldLabel}>Serviços que esta etapa trava</Text>
            <View style={s.toggleRow}>
              {sortedStages.filter((st) => st.id !== draft.id).map((st) => {
                const sel = draft.servicosDependentes.includes(st.nome);
                return (
                  <Pressable key={`dep-${st.id}`} onPress={() => toggleDependent(st.nome)} style={[s.toggle, sel && s.toggleWarn]}>
                    <MaterialCommunityIcons name={sel ? 'lock' : 'lock-open-outline'} size={13} color={sel ? '#B45309' : '#94A3B8'} />
                    <Text style={[s.toggleText, sel && s.toggleWarnText]}>{st.nome}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        )}

        <TextInput multiline onChangeText={(v) => updateDraft('observacao', v)} placeholder="Observação (opcional)" placeholderTextColor="#94A3B8" style={s.textarea} value={draft.observacao} />

        <View style={s.actionRow}>
          <Pressable onPress={saveDraft} style={s.btnPrimary}>
            <MaterialCommunityIcons name={editingId ? 'content-save' : 'plus'} size={16} color="#FFFFFF" />
            <Text style={s.btnPrimaryText}>{editingId ? 'Salvar edição' : 'Criar etapa'}</Text>
          </Pressable>
          {editingId && (
            <Pressable onPress={() => { setEditingId(undefined); setDraft(createEmptyServiceStage(stages.length + 1)); }} style={s.btnSecondary}>
              <Text style={s.btnSecondaryText}>Cancelar</Text>
            </Pressable>
          )}
        </View>
      </View>

      {/* STAGES LIST — blue border */}
      <View style={[s.section, s.sectionBlue]}>
        <Text style={[s.sectionTitle, { color: '#1D4ED8' }]}>Etapas cadastradas</Text>
        {sortedStages.map((stage) => (
          <View key={stage.id} style={[s.stageCard, !stage.ativo && s.stageInactive]}>
            <View style={s.stageTop}>
              <View style={s.stageOrder}>
                <Text style={s.stageOrderText}>{stage.ordemExecucao}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.stageName}>{stage.nome}</Text>
                <Text style={s.stageMeta}>{stage.categoria} · {stage.unidadeMedicao}</Text>
              </View>
              <View style={[s.stagePill, stage.ativo ? s.stagePillActive : s.stagePillInactive]}>
                <Text style={[s.stagePillText, stage.ativo ? s.stagePillActiveText : s.stagePillInactiveText]}>
                  {stage.ativo ? 'Ativa' : 'Inativa'}
                </Text>
              </View>
            </View>

            <View style={s.metricsRow}>
              {[
                { label: 'Checklist', on: stage.apareceNoChecklist },
                { label: 'Cronograma', on: stage.apareceNoCronograma },
                { label: 'Medição', on: stage.apareceNaMedicao },
                { label: 'Crítica', on: stage.etapaCritica },
                { label: 'Trava lib.', on: stage.travaLiberacao },
              ].map((m) => (
                <View key={m.label} style={[s.metricChip, m.on ? s.metricChipOn : s.metricChipOff]}>
                  <MaterialCommunityIcons name={m.on ? 'check' : 'close'} size={10} color={m.on ? '#047857' : '#94A3B8'} />
                  <Text style={[s.metricChipText, m.on ? s.metricChipTextOn : s.metricChipTextOff]}>{m.label}</Text>
                </View>
              ))}
            </View>

            {stage.servicosDependentes.length > 0 && (
              <View style={s.blocksRow}>
                <MaterialCommunityIcons name="lock" size={13} color="#B45309" />
                <Text style={s.blocksText}>Trava: {stage.servicosDependentes.join(', ')}</Text>
              </View>
            )}
            {stage.observacao ? <Text style={s.observacaoText}>{stage.observacao}</Text> : null}

            <View style={s.actionRow}>
              <Pressable onPress={() => moveStage(stage, -1)} style={s.btnIcon}>
                <MaterialCommunityIcons name="arrow-up" size={16} color="#475569" />
              </Pressable>
              <Pressable onPress={() => moveStage(stage, 1)} style={s.btnIcon}>
                <MaterialCommunityIcons name="arrow-down" size={16} color="#475569" />
              </Pressable>
              <Pressable onPress={() => editStage(stage)} style={s.btnSecondary}>
                <Text style={s.btnSecondaryText}>Editar</Text>
              </Pressable>
              {stage.ativo && (
                <Pressable onPress={() => inactivate(stage)} style={s.btnDanger}>
                  <Text style={s.btnDangerText}>Inativar</Text>
                </Pressable>
              )}
            </View>
          </View>
        ))}
      </View>

    </ScrollView>
  );
}

const s = StyleSheet.create({
  scroll: { backgroundColor: '#F8FAFC' },
  container: { gap: 12, padding: 16, paddingBottom: 40 },

  // page header
  pageHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 16, borderWidth: 2, borderColor: '#8B5CF6', padding: 16 },
  pageHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  pageTitle: { color: '#0F172A', fontSize: 22, fontWeight: '900' },
  pageSubtitle: { color: '#64748B', fontSize: 13, marginTop: 2 },
  restoreBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 10, borderWidth: 1, borderColor: '#DDD6FE', paddingHorizontal: 12, paddingVertical: 9 },
  restoreBtnText: { color: '#6D28D9', fontSize: 12, fontWeight: '700' },

  // sections
  section: { backgroundColor: '#FFFFFF', borderRadius: 16, borderWidth: 2, padding: 16, gap: 12 },
  sectionPurple: { borderColor: '#8B5CF6' },
  sectionBlue:   { borderColor: '#3B82F6' },
  sectionTitle: { fontSize: 15, fontWeight: '900' },

  // form
  formGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  fieldGroup: { flexGrow: 1, gap: 6, minWidth: 160 },
  fieldLabel: { color: '#475569', fontSize: 12, fontWeight: '700' },
  input: { backgroundColor: '#F8FAFC', borderColor: '#CBD5E1', borderRadius: 10, borderWidth: 1, color: '#0F172A', fontSize: 14, minHeight: 42, paddingHorizontal: 12 },
  toggleRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 5, borderColor: '#E2E8F0', borderRadius: 8, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 7, backgroundColor: '#F8FAFC' },
  toggleOn: { backgroundColor: '#EDE9FE', borderColor: '#8B5CF6' },
  toggleWarn: { backgroundColor: '#FEF3C7', borderColor: '#FCD34D' },
  toggleText: { color: '#64748B', fontSize: 12, fontWeight: '600' },
  toggleTextOn: { color: '#6D28D9' },
  toggleWarnText: { color: '#B45309' },
  dependencyBox: { backgroundColor: '#FAFAFA', borderColor: '#E2E8F0', borderRadius: 10, borderWidth: 1, gap: 8, padding: 12 },
  textarea: { backgroundColor: '#F8FAFC', borderColor: '#CBD5E1', borderRadius: 10, borderWidth: 1, color: '#0F172A', fontSize: 14, minHeight: 72, padding: 12, textAlignVertical: 'top' },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },

  // stage cards
  stageCard: { backgroundColor: '#F8FAFC', borderRadius: 12, padding: 12, gap: 10, borderWidth: 1, borderColor: '#E2E8F0' },
  stageInactive: { opacity: 0.6 },
  stageTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stageOrder: { width: 30, height: 30, borderRadius: 8, backgroundColor: '#EFF6FF', alignItems: 'center', justifyContent: 'center' },
  stageOrderText: { color: '#1D4ED8', fontSize: 13, fontWeight: '900' },
  stageName: { color: '#0F172A', fontSize: 14, fontWeight: '800' },
  stageMeta: { color: '#64748B', fontSize: 12, marginTop: 1 },
  stagePill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  stagePillActive: { backgroundColor: '#D1FAE5' },
  stagePillInactive: { backgroundColor: '#F1F5F9' },
  stagePillText: { fontSize: 11, fontWeight: '700' },
  stagePillActiveText: { color: '#047857' },
  stagePillInactiveText: { color: '#64748B' },
  metricsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  metricChip: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 6, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 4 },
  metricChipOn: { backgroundColor: '#ECFDF5', borderColor: '#A7F3D0' },
  metricChipOff: { backgroundColor: '#F8FAFC', borderColor: '#E2E8F0' },
  metricChipText: { fontSize: 11, fontWeight: '600' },
  metricChipTextOn: { color: '#047857' },
  metricChipTextOff: { color: '#94A3B8' },
  blocksRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  blocksText: { color: '#B45309', fontSize: 12, fontWeight: '600', flex: 1 },
  observacaoText: { color: '#64748B', fontSize: 12, lineHeight: 17 },

  // buttons
  btnPrimary: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#6D28D9', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10 },
  btnPrimaryText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  btnSecondary: { borderColor: '#CBD5E1', borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 9 },
  btnSecondaryText: { color: '#1D4ED8', fontSize: 12, fontWeight: '700' },
  btnDanger: { borderColor: '#F87171', borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 9 },
  btnDangerText: { color: '#B91C1C', fontSize: 12, fontWeight: '700' },
  btnIcon: { borderColor: '#E2E8F0', borderRadius: 8, borderWidth: 1, padding: 8 },
});
