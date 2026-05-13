import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  createEmptyServiceStage,
  createEmptyServiceSubstage,
  defaultResidentialServiceStages,
  getServiceStagesFromStorage,
  saveServiceStagesToStorage,
  serviceStagePhases,
} from '@/src/data/serviceStages';
import type { ServiceStage, ServiceSubstage } from '@/src/data/serviceStages';

const booleanFields = [
  ['apareceNoChecklist', 'Checklist'],
  ['apareceNoCronograma', 'Cronograma'],
  ['apareceNaMedicao', 'Medição'],
  ['etapaCritica', 'Crítica'],
  ['travaLiberacao', 'Trava liberação'],
  ['ativo', 'Ativa'],
] as const;

const substageBooleanFields = [
  ['apareceNoChecklist', 'Checklist'],
  ['apareceNoCronograma', 'Cronograma'],
  ['apareceNaMedicao', 'Medição'],
  ['travaLiberacao', 'Trava liberação'],
  ['ativo', 'Ativa'],
] as const;

const isServiceUsed = (serviceId: string) => {
  if (typeof window === 'undefined') return false;

  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    const value = key ? window.localStorage.getItem(key) : '';
    if (value?.includes(serviceId)) return true;
  }

  return false;
};

export default function ServiceStagesScreen() {
  const [stages, setStages] = useState<ServiceStage[]>([]);
  const [editingId, setEditingId] = useState<string>();
  const [draft, setDraft] = useState<ServiceStage>(() => createEmptyServiceStage(1));
  const [phaseFilter, setPhaseFilter] = useState<(typeof serviceStagePhases)[number]>('Todas');

  useFocusEffect(
    useCallback(() => {
      const loadedStages = getServiceStagesFromStorage();
      setStages(loadedStages);
      setDraft(createEmptyServiceStage(loadedStages.length + 1));
      setEditingId(undefined);
    }, []),
  );

  const sortedStages = useMemo(
    () =>
      [...stages]
        .filter((stage) => phaseFilter === 'Todas' || stage.fase === phaseFilter)
        .sort((first, second) => first.ordemExecucao - second.ordemExecucao),
    [phaseFilter, stages],
  );

  const persistStages = (nextStages: ServiceStage[]) => {
    const orderedStages = nextStages
      .map((stage, index) => ({ ...stage, ordemExecucao: index + 1 }))
      .sort((first, second) => first.ordemExecucao - second.ordemExecucao);

    setStages(orderedStages);
    saveServiceStagesToStorage(orderedStages);
  };

  const updateDraft = <Field extends keyof ServiceStage>(field: Field, value: ServiceStage[Field]) => {
    setDraft((currentDraft) => ({ ...currentDraft, [field]: value }));
  };

  const updateSubstage = <Field extends keyof ServiceSubstage>(
    substageId: string,
    field: Field,
    value: ServiceSubstage[Field],
  ) => {
    setDraft((currentDraft) => ({
      ...currentDraft,
      subetapas: currentDraft.subetapas.map((substage) =>
        substage.id === substageId ? { ...substage, [field]: value } : substage,
      ),
    }));
  };

  const saveDraft = () => {
    if (!draft.nome.trim()) return;

    const normalizedDraft: ServiceStage = {
      ...draft,
      id: draft.id || `etapa-${Date.now()}`,
      nome: draft.nome.trim(),
      fase: draft.fase.trim() || 'Estrutura',
      categoria: draft.categoria.trim() || 'Execução',
      unidadeMedicao: draft.unidadeMedicao.trim() || 'un',
      observacao: draft.observacao.trim(),
      subetapas: draft.subetapas
        .filter((substage) => substage.nome.trim())
        .map((substage, index) => ({
          ...substage,
          nome: substage.nome.trim(),
          etapaId: draft.id,
          ordem: index + 1,
        })),
    };
    const nextStages = editingId
      ? stages.map((stage) => (stage.id === editingId ? normalizedDraft : stage))
      : [...stages, normalizedDraft];

    persistStages(nextStages);
    setEditingId(undefined);
    setDraft(createEmptyServiceStage(nextStages.length + 1));
  };

  const editStage = (stage: ServiceStage) => {
    setEditingId(stage.id);
    setDraft(stage);
  };

  const removeOrInactivateStage = (stage: ServiceStage) => {
    const used = isServiceUsed(stage.id);

    if (used) {
      persistStages(stages.map((item) => (item.id === stage.id ? { ...item, ativo: false } : item)));
      return;
    }

    persistStages(stages.filter((item) => item.id !== stage.id));
  };

  const moveStage = (stage: ServiceStage, direction: -1 | 1) => {
    const orderedStages = [...stages].sort((first, second) => first.ordemExecucao - second.ordemExecucao);
    const currentIndex = orderedStages.findIndex((item) => item.id === stage.id);
    const nextIndex = currentIndex + direction;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= orderedStages.length) return;
    [orderedStages[currentIndex], orderedStages[nextIndex]] = [orderedStages[nextIndex], orderedStages[currentIndex]];
    persistStages(orderedStages);
  };

  const addSubstage = () => {
    setDraft((currentDraft) => ({
      ...currentDraft,
      subetapas: [
        ...currentDraft.subetapas,
        createEmptyServiceSubstage(currentDraft.id, currentDraft.subetapas.length + 1),
      ],
    }));
  };

  const removeSubstage = (substageId: string) => {
    setDraft((currentDraft) => ({
      ...currentDraft,
      subetapas: isServiceUsed(substageId)
        ? currentDraft.subetapas.map((substage) =>
            substage.id === substageId ? { ...substage, ativo: false } : substage,
          )
        : currentDraft.subetapas.filter((substage) => substage.id !== substageId),
    }));
  };

  const restoreDefaults = () => {
    const confirmed =
      typeof window !== 'undefined' &&
      window.confirm(
        'Restaurar apenas etapas e subetapas padrão? Isso não apaga vistorias, medições ou apartamentos.',
      );
    if (!confirmed) return;
    persistStages(defaultResidentialServiceStages);
    setEditingId(undefined);
    setDraft(createEmptyServiceStage(defaultResidentialServiceStages.length + 1));
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.header}>
        <View style={styles.titleGroup}>
          <Text style={styles.title}>Serviços e etapas</Text>
          <Text style={styles.subtitle}>
            Configure fases, etapas e subetapas usadas em checklist, cronograma, dependências, medição e relatórios.
          </Text>
        </View>
        <Pressable onPress={restoreDefaults} style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonText}>Restaurar padrão</Text>
        </Pressable>
      </View>

      <View style={styles.panel}>
        <Text style={styles.sectionTitle}>{editingId ? 'Editar etapa' : 'Nova etapa'}</Text>
        <View style={styles.formGrid}>
          <Field label="Nome" value={draft.nome} onChangeText={(value) => updateDraft('nome', value)} />
          <Field label="Fase" value={draft.fase} onChangeText={(value) => updateDraft('fase', value)} />
          <Field label="Categoria" value={draft.categoria} onChangeText={(value) => updateDraft('categoria', value)} />
          <Field label="Unidade de medição" value={draft.unidadeMedicao} onChangeText={(value) => updateDraft('unidadeMedicao', value)} />
          <Field
            label="Ordem de execução"
            keyboardType="number-pad"
            value={String(draft.ordemExecucao)}
            onChangeText={(value) => updateDraft('ordemExecucao', Number(value) || stages.length + 1)}
          />
        </View>

        <View style={styles.optionRow}>
          {booleanFields.map(([field, label]) => {
            const selected = Boolean(draft[field]);
            return (
              <Pressable key={field} onPress={() => updateDraft(field, !selected)} style={[styles.chip, selected && styles.chipSelected]}>
                <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.substageBox}>
          <View style={styles.substageHeader}>
            <Text style={styles.fieldLabel}>Subetapas</Text>
            <Pressable onPress={addSubstage} style={styles.secondaryButton}>
              <Text style={styles.secondaryButtonText}>Criar subetapa</Text>
            </Pressable>
          </View>

          {draft.subetapas.length === 0 ? (
            <Text style={styles.emptyText}>Sem subetapas. Se ficar assim, a própria etapa será usada nos módulos.</Text>
          ) : (
            draft.subetapas.map((substage) => (
              <View key={substage.id} style={styles.substageCard}>
                <View style={styles.formGrid}>
                  <Field label="Nome da subetapa" value={substage.nome} onChangeText={(value) => updateSubstage(substage.id, 'nome', value)} />
                  <Field label="Unidade" value={substage.unidadeMedicao} onChangeText={(value) => updateSubstage(substage.id, 'unidadeMedicao', value)} />
                </View>
                <View style={styles.optionRow}>
                  {substageBooleanFields.map(([field, label]) => {
                    const selected = Boolean(substage[field]);
                    return (
                      <Pressable key={`${substage.id}-${field}`} onPress={() => updateSubstage(substage.id, field, !selected)} style={[styles.chip, selected && styles.chipSelected]}>
                        <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                <Pressable onPress={() => removeSubstage(substage.id)} style={styles.dangerButton}>
                  <Text style={styles.dangerButtonText}>Apagar subetapa</Text>
                </Pressable>
              </View>
            ))
          )}
        </View>

        <TextInput
          multiline
          onChangeText={(value) => updateDraft('observacao', value)}
          placeholder="Observação"
          placeholderTextColor="#94A3B8"
          style={styles.commentInput}
          value={draft.observacao}
        />

        <View style={styles.actionRow}>
          <Pressable onPress={saveDraft} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>{editingId ? 'Salvar edição' : 'Criar etapa'}</Text>
          </Pressable>
          {editingId ? (
            <Pressable
              onPress={() => {
                setEditingId(undefined);
                setDraft(createEmptyServiceStage(stages.length + 1));
              }}
              style={styles.secondaryButton}>
              <Text style={styles.secondaryButtonText}>Cancelar</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      <View style={styles.panel}>
        <Text style={styles.sectionTitle}>Filtrar por fase</Text>
        <View style={styles.optionRow}>
          {serviceStagePhases.map((phase) => {
            const selected = phaseFilter === phase;
            return (
              <Pressable key={phase} onPress={() => setPhaseFilter(phase)} style={[styles.chip, selected && styles.chipSelected]}>
                <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{phase}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.panel}>
        <Text style={styles.sectionTitle}>Etapas cadastradas</Text>
        {sortedStages.map((stage) => (
          <View key={stage.id} style={[styles.stageCard, !stage.ativo && styles.inactiveCard]}>
            <View style={styles.stageHeader}>
              <View style={styles.stageTitleGroup}>
                <Text style={styles.stageTitle}>{stage.ordemExecucao}. {stage.nome}</Text>
                <Text style={styles.stageMeta}>{stage.fase} / {stage.categoria} / {stage.unidadeMedicao}</Text>
              </View>
              <Text style={[styles.statusPill, stage.ativo ? styles.activePill : styles.inactivePill]}>
                {stage.ativo ? 'Ativa' : 'Inativa'}
              </Text>
            </View>

            <View style={styles.metricGrid}>
              <Text style={styles.metric}>Checklist: {stage.apareceNoChecklist ? 'sim' : 'não'}</Text>
              <Text style={styles.metric}>Cronograma: {stage.apareceNoCronograma ? 'sim' : 'não'}</Text>
              <Text style={styles.metric}>Medição: {stage.apareceNaMedicao ? 'sim' : 'não'}</Text>
              <Text style={styles.metric}>Subetapas: {stage.subetapas.length}</Text>
            </View>

            {stage.subetapas.length ? (
              <Text style={styles.detailText}>
                {stage.subetapas.map((substage) => substage.nome).join(', ')}
              </Text>
            ) : null}

            <View style={styles.actionRow}>
              <Pressable onPress={() => moveStage(stage, -1)} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>Subir</Text></Pressable>
              <Pressable onPress={() => moveStage(stage, 1)} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>Descer</Text></Pressable>
              <Pressable onPress={() => editStage(stage)} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>Editar</Text></Pressable>
              <Pressable onPress={() => removeOrInactivateStage(stage)} style={styles.dangerButton}><Text style={styles.dangerButtonText}>{stage.ativo ? 'Apagar/Inativar' : 'Apagar'}</Text></Pressable>
            </View>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

function Field({
  keyboardType,
  label,
  onChangeText,
  value,
}: {
  keyboardType?: 'default' | 'number-pad';
  label: string;
  onChangeText: (value: string) => void;
  value: string;
}) {
  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput keyboardType={keyboardType} onChangeText={onChangeText} placeholder={label} placeholderTextColor="#94A3B8" style={styles.input} value={value} />
    </View>
  );
}

const styles = StyleSheet.create({
  actionRow: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  activePill: { backgroundColor: '#D1FAE5', color: '#047857' },
  chip: { borderColor: '#CBD5E1', borderRadius: 999, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 7 },
  chipSelected: { backgroundColor: '#DBEAFE', borderColor: '#2563EB' },
  chipText: { color: '#475569', fontSize: 12, fontWeight: '800' },
  chipTextSelected: { color: '#2563EB' },
  commentInput: { backgroundColor: '#F8FAFC', borderColor: '#CBD5E1', borderRadius: 8, borderWidth: 1, color: '#0F172A', fontSize: 14, minHeight: 84, padding: 10, textAlignVertical: 'top' },
  container: { gap: 14, padding: 20 },
  dangerButton: { borderColor: '#FCA5A5', borderRadius: 8, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 9 },
  dangerButtonText: { color: '#B91C1C', fontSize: 12, fontWeight: '900' },
  detailText: { color: '#475569', fontSize: 13, lineHeight: 18 },
  emptyText: { color: '#64748B', fontSize: 13 },
  fieldGroup: { flexGrow: 1, gap: 6, minWidth: 180 },
  fieldLabel: { color: '#475569', fontSize: 12, fontWeight: '900' },
  formGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  header: { alignItems: 'flex-start', backgroundColor: '#FFFFFF', borderColor: '#E2E8F0', borderRadius: 8, borderWidth: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between', padding: 18 },
  inactiveCard: { opacity: 0.72 },
  inactivePill: { backgroundColor: '#E2E8F0', color: '#64748B' },
  input: { backgroundColor: '#F8FAFC', borderColor: '#CBD5E1', borderRadius: 8, borderWidth: 1, color: '#0F172A', fontSize: 14, minHeight: 42, paddingHorizontal: 10 },
  metric: { backgroundColor: '#F8FAFC', borderColor: '#E2E8F0', borderRadius: 999, borderWidth: 1, color: '#475569', fontSize: 12, fontWeight: '800', paddingHorizontal: 10, paddingVertical: 6 },
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  optionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  panel: { backgroundColor: '#FFFFFF', borderColor: '#E2E8F0', borderRadius: 8, borderWidth: 1, gap: 12, padding: 16 },
  primaryButton: { backgroundColor: '#2563EB', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 11 },
  primaryButtonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '900' },
  secondaryButton: { borderColor: '#CBD5E1', borderRadius: 8, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 9 },
  secondaryButtonText: { color: '#2563EB', fontSize: 12, fontWeight: '900' },
  sectionTitle: { color: '#0F172A', fontSize: 18, fontWeight: '900' },
  stageCard: { backgroundColor: '#FFFFFF', borderColor: '#E2E8F0', borderRadius: 8, borderWidth: 1, gap: 10, padding: 14 },
  stageHeader: { alignItems: 'flex-start', flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'space-between' },
  stageMeta: { color: '#64748B', fontSize: 13 },
  stageTitle: { color: '#0F172A', fontSize: 15, fontWeight: '900', lineHeight: 20 },
  stageTitleGroup: { flex: 1, gap: 3, minWidth: 190 },
  statusPill: { borderRadius: 999, fontSize: 12, fontWeight: '900', overflow: 'hidden', paddingHorizontal: 10, paddingVertical: 6 },
  substageBox: { backgroundColor: '#F8FAFC', borderColor: '#E2E8F0', borderRadius: 8, borderWidth: 1, gap: 10, padding: 12 },
  substageCard: { backgroundColor: '#FFFFFF', borderColor: '#E2E8F0', borderRadius: 8, borderWidth: 1, gap: 10, padding: 12 },
  substageHeader: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between' },
  subtitle: { color: '#64748B', fontSize: 14, lineHeight: 20, marginTop: 4, maxWidth: 620 },
  title: { color: '#0F172A', fontSize: 28, fontWeight: '900' },
  titleGroup: { flex: 1, minWidth: 220 },
});
