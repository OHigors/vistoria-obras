import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '@/src/ui/Text';
import { Skeleton } from '@/src/ui/Skeleton';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { createEmptyServiceStage, defaultServiceStages } from '@/src/data/serviceStages';
import type { ServiceStage } from '@/src/data/serviceStages';
import * as db from '@/src/data/db';
import { useObras } from '@/src/data/ObrasContext';

const booleanFields = [
  ['apareceNoChecklist', 'Checklist'],
  ['apareceNoCronograma', 'Cronograma'],
  ['apareceNaMedicao', 'Medição'],
  ['etapaCritica', 'Crítica'],
  ['travaLiberacao', 'Trava lib.'],
  ['ativo', 'Ativa'],
] as const;

function Field({ keyboardType, label, onChangeText, value, placeholder, error }: { keyboardType?: 'default' | 'number-pad'; label: string; onChangeText: (v: string) => void; value: string; placeholder?: string; error?: string }) {
  return (
    <View style={s.fieldGroup}>
      <Text style={[s.fieldLabel, error && s.fieldLabelError]}>
        {label}{error ? ' *' : ''}
      </Text>
      <TextInput
        keyboardType={keyboardType}
        onChangeText={onChangeText}
        placeholder={placeholder ?? label}
        placeholderTextColor={error ? '#FCA5A5' : '#94A3B8'}
        style={[s.input, error && s.inputError]}
        value={value}
      />
      {error ? <Text style={s.fieldErrorText}>{error}</Text> : null}
    </View>
  );
}

// dd/mm/yyyy <-> yyyy-mm-dd (ISO for Postgres `date`)
function isoToBR(iso: string) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}
function brToIso(br: string) {
  const m = br.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return '';
  return `${m[3]}-${m[2]}-${m[1]}`;
}
function maskBRDate(input: string) {
  const digits = input.replace(/\D/g, '').slice(0, 8);
  const parts = [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 8)].filter(Boolean);
  return parts.join('/');
}

function DateField({ label, value, onChangeISO }: { label: string; value: string; onChangeISO: (iso: string) => void }) {
  const [text, setText] = useState(() => isoToBR(value));
  useEffect(() => { setText(isoToBR(value)); }, [value]);
  return (
    <View style={s.fieldGroup}>
      <Text style={s.fieldLabel}>{label}</Text>
      <TextInput
        keyboardType="number-pad"
        maxLength={10}
        onChangeText={(v) => {
          const masked = maskBRDate(v);
          setText(masked);
          if (masked.length === 10) onChangeISO(brToIso(masked));
          else if (masked.length === 0) onChangeISO('');
        }}
        placeholder="dd/mm/aaaa"
        placeholderTextColor="#94A3B8"
        style={s.input}
        value={text}
      />
    </View>
  );
}

function SkeletonCard() {
  return (
    <View style={s.stageCard}>
      <View style={s.stageTop}>
        <Skeleton width={30} height={30} radius={8} />
        <View style={{ flex: 1, gap: 6 }}>
          <Skeleton height={12} width="60%" radius={4} />
          <Skeleton height={10} width="40%" radius={4} />
        </View>
        <Skeleton width={60} height={18} radius={999} />
      </View>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        <Skeleton width={70} height={18} radius={6} />
        <Skeleton width={80} height={18} radius={6} />
        <Skeleton width={70} height={18} radius={6} />
      </View>
    </View>
  );
}

const CATEGORY_PALETTE = ['#2563EB', '#7C3AED', '#0891B2', '#16A34A', '#D97706', '#DB2777', '#0EA5E9', '#65A30D', '#B45309', '#9333EA'];
const categoryColor = (cat: string) => {
  let hash = 0;
  for (let i = 0; i < cat.length; i++) hash = (hash * 31 + cat.charCodeAt(i)) >>> 0;
  return CATEGORY_PALETTE[hash % CATEGORY_PALETTE.length];
};

export default function ServiceStagesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { refreshServiceStages } = useObras();
  const scrollRef = useRef<ScrollView | null>(null);
  const formY = useRef(0);
  const [stages, setStages] = useState<ServiceStage[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string>();
  const [draft, setDraft] = useState<ServiceStage>(() => createEmptyServiceStage(1));
  const [depFilter, setDepFilter] = useState('');
  const [errors, setErrors] = useState<Partial<Record<keyof ServiceStage, string>>>({});
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [openDepGroups, setOpenDepGroups] = useState<Record<string, boolean>>({});
  const [collapsedStageGroups, setCollapsedStageGroups] = useState<Record<string, boolean>>({});
  const [stageToDelete, setStageToDelete] = useState<ServiceStage | null>(null);

  useFocusEffect(useCallback(() => {
    setLoading(true);
    const started = Date.now();
    const MIN = 600;
    db.loadServiceStages().then((loaded) => {
      const finish = () => {
        setStages(loaded);
        setDraft(createEmptyServiceStage(loaded.length + 1));
        setEditingId(undefined);
        setLoading(false);
      };
      const elapsed = Date.now() - started;
      if (elapsed >= MIN) finish();
      else setTimeout(finish, MIN - elapsed);
    });
  }, []));

  const sortedStages = useMemo(
    () => [...stages].sort((a, b) => a.ordemExecucao - b.ordemExecucao),
    [stages],
  );

  const persistStages = (next: ServiceStage[]) => {
    const ordered = next.map((s, i) => ({ ...s, ordemExecucao: i + 1 })).sort((a, b) => a.ordemExecucao - b.ordemExecucao);
    setStages(ordered);
    // Persist and broadcast the new catalog so other screens (apartment "add step"
    // modal in particular) see the change without needing a full app reload.
    db.saveServiceStages(ordered).then(() => refreshServiceStages());
  };

  const updateDraft = <F extends keyof ServiceStage>(field: F, value: ServiceStage[F]) => {
    setDraft((cur) => ({ ...cur, [field]: value }));
    if (errors[field]) setErrors((e) => ({ ...e, [field]: undefined }));
  };

  const saveDraft = () => {
    const next: Partial<Record<keyof ServiceStage, string>> = {};
    if (!draft.nome.trim()) next.nome = 'Informe o nome da etapa';
    if (!draft.categoria.trim()) next.categoria = 'Informe a categoria';
    if (!draft.unidadeMedicao.trim()) next.unidadeMedicao = 'Informe a unidade';
    if (Object.keys(next).length > 0) {
      setErrors(next);
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({ y: Math.max(formY.current - 12, 0), animated: true });
      });
      return;
    }
    setErrors({});
    const normalized: ServiceStage = { ...draft, id: draft.id || `etapa-${Date.now()}`, nome: draft.nome.trim(), categoria: draft.categoria.trim(), unidadeMedicao: draft.unidadeMedicao.trim(), observacao: draft.observacao.trim() };
    const updated = editingId ? stages.map((s) => (s.id === editingId ? normalized : s)) : [...stages, normalized];
    persistStages(updated);
    setEditingId(undefined);
    setDraft(createEmptyServiceStage(updated.length + 1));
    setDepFilter('');
  };

  const editStage = (stage: ServiceStage) => {
    setEditingId(stage.id);
    setDraft(stage);
    setDepFilter('');
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ y: Math.max(formY.current - 12, 0), animated: true });
    });
  };
  const inactivate = (stage: ServiceStage) => persistStages(stages.map((s) => (s.id === stage.id ? { ...s, ativo: false } : s)));
  const reactivate = (stage: ServiceStage) => persistStages(stages.map((s) => (s.id === stage.id ? { ...s, ativo: true } : s)));

  const confirmDelete = () => {
    if (!stageToDelete) return;
    const id = stageToDelete.id;
    const next = stages.filter((s) => s.id !== id);
    const ordered = next.map((s, i) => ({ ...s, ordemExecucao: i + 1 }));
    setStages(ordered);
    db.deleteServiceStage(id).then(() => refreshServiceStages());
    if (ordered.length > 0) db.saveServiceStages(ordered);
    if (editingId === id) {
      setEditingId(undefined);
      setDraft(createEmptyServiceStage(ordered.length + 1));
    }
    setStageToDelete(null);
  };

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

  const confirmRestore = () => {
    setRestoreOpen(false);
    persistStages(defaultServiceStages);
    setEditingId(undefined);
    setDraft(createEmptyServiceStage(defaultServiceStages.length + 1));
    setErrors({});
  };

  const cancelEdit = () => {
    setEditingId(undefined);
    setDraft(createEmptyServiceStage(stages.length + 1));
    setDepFilter('');
  };

  const activeCount = stages.filter((s) => s.ativo).length;

  const stripDiacritics = (v: string) =>
    v.toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[̀-ͯ]/g, '');

  const normalizedFilter = stripDiacritics(depFilter.trim());

  const dependencyCandidates = sortedStages.filter((st) => {
    if (st.id === draft.id) return false;
    if (!normalizedFilter) return true;
    return stripDiacritics(st.nome).includes(normalizedFilter);
  });

  const groupByCategoria = <T extends { categoria: string }>(list: T[]) => {
    const map = new Map<string, T[]>();
    for (const item of list) {
      const cat = item.categoria?.trim() || 'Sem categoria';
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(item);
    }
    return [...map.entries()];
  };

  const dependencyGroups = groupByCategoria(dependencyCandidates);
  const stageGroups = groupByCategoria(sortedStages);

  const formatDateBR = (iso: string) => {
    if (!iso) return '—';
    const [y, m, d] = iso.split('-');
    if (!y || !m || !d) return iso;
    return `${d}/${m}/${y}`;
  };

  return (
    <>
      <View style={[s.backBar, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.push('/(tabs)/cronograma' as any)} style={s.backBtn}>
          <MaterialCommunityIcons name="chevron-left" size={26} color="#0F172A" />
          <Text style={s.backBtnText}>Cronograma</Text>
        </Pressable>
      </View>
      <ScrollView ref={scrollRef} style={s.scroll} contentContainerStyle={s.container}>

      {/* HEADER */}
      <View style={s.pageHeader}>
        <View style={s.pageHeaderLeft}>
          <MaterialCommunityIcons name="cog-outline" size={28} color="#6D28D9" />
          <View>
            <Text style={s.pageTitle}>Serviços e Etapas</Text>
            {loading ? (
              <Skeleton height={13} width={180} radius={4} style={{ marginTop: 4 }} />
            ) : (
              <Text style={s.pageSubtitle}>{activeCount} etapas ativas · {stages.length} cadastradas</Text>
            )}
          </View>
        </View>
        <Pressable onPress={() => setRestoreOpen(true)} style={s.restoreBtn}>
          <MaterialCommunityIcons name="restore" size={16} color="#6D28D9" />
          <Text style={s.restoreBtnText}>Restaurar</Text>
        </Pressable>
      </View>

      {/* FORM — purple border */}
      <View
        onLayout={(e) => { formY.current = e.nativeEvent.layout.y; }}
        style={[s.section, s.sectionPurple, editingId && s.sectionEditing]}
      >
        <View style={s.formHeader}>
          <Text style={[s.sectionTitle, { color: '#6D28D9' }]}>{editingId ? 'Editar etapa' : 'Nova etapa'}</Text>
          {editingId && (
            <View style={s.editingBadge}>
              <MaterialCommunityIcons name="pencil" size={12} color="#6D28D9" />
              <Text style={s.editingBadgeText}>Editando “{draft.nome || 'etapa'}”</Text>
            </View>
          )}
        </View>

        <View style={s.formGrid}>
          <Field label="Nome" value={draft.nome} onChangeText={(v) => updateDraft('nome', v)} error={errors.nome} />
          <Field label="Categoria" value={draft.categoria} onChangeText={(v) => updateDraft('categoria', v)} error={errors.categoria} />
          <Field label="Unidade de medição" value={draft.unidadeMedicao} onChangeText={(v) => updateDraft('unidadeMedicao', v)} error={errors.unidadeMedicao} />
        </View>

        {/* Duração — start + end */}
        <View style={s.durationBox}>
          <View style={s.durationHeader}>
            <MaterialCommunityIcons name="calendar-range" size={16} color="#6D28D9" />
            <Text style={s.fieldLabel}>Duração da etapa</Text>
          </View>
          <View style={s.formGrid}>
            <DateField label="Início" value={draft.dataInicio} onChangeISO={(iso) => updateDraft('dataInicio', iso)} />
            <DateField label="Fim" value={draft.dataFim} onChangeISO={(iso) => updateDraft('dataFim', iso)} />
          </View>
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
            <View style={s.searchWrap}>
              <MaterialCommunityIcons name="magnify" size={16} color="#94A3B8" />
              <TextInput
                onChangeText={setDepFilter}
                placeholder="Filtrar etapas…"
                placeholderTextColor="#94A3B8"
                style={s.searchInput}
                value={depFilter}
              />
              {depFilter ? (
                <Pressable onPress={() => setDepFilter('')} style={s.searchClear}>
                  <MaterialCommunityIcons name="close-circle" size={16} color="#94A3B8" />
                </Pressable>
              ) : null}
            </View>
            {dependencyCandidates.length === 0 ? (
              <Text style={s.emptyDepText}>Nenhuma etapa corresponde ao filtro.</Text>
            ) : (
              dependencyGroups.map(([cat, items]) => {
                const forceOpen = Boolean(normalizedFilter);
                const isOpen = forceOpen || openDepGroups[cat] === true;
                const selectedInGroup = items.filter((st) => draft.servicosDependentes.includes(st.nome)).length;
                return (
                  <View key={`depgrp-${cat}`} style={s.depGroup}>
                    <Pressable
                      onPress={() => setOpenDepGroups((cur) => ({ ...cur, [cat]: !isOpen }))}
                      style={s.depGroupHeader}
                    >
                      <MaterialCommunityIcons name={isOpen ? 'chevron-down' : 'chevron-right'} size={16} color="#64748B" />
                      <View style={[s.depGroupDot, { backgroundColor: categoryColor(cat) }]} />
                      <Text style={s.depGroupTitle}>{cat}</Text>
                      {selectedInGroup > 0 ? (
                        <View style={s.depGroupSelPill}>
                          <MaterialCommunityIcons name="lock" size={10} color="#B45309" />
                          <Text style={s.depGroupSelText}>{selectedInGroup}</Text>
                        </View>
                      ) : null}
                      <Text style={s.depGroupCount}>{items.length}</Text>
                    </Pressable>
                    {isOpen && (
                      <View style={s.toggleRow}>
                        {items.map((st) => {
                          const sel = draft.servicosDependentes.includes(st.nome);
                          return (
                            <Pressable key={`dep-${st.id}`} onPress={() => toggleDependent(st.nome)} style={[s.toggle, sel && s.toggleWarn]}>
                              <MaterialCommunityIcons name={sel ? 'lock' : 'lock-open-outline'} size={13} color={sel ? '#B45309' : '#94A3B8'} />
                              <Text style={[s.toggleText, sel && s.toggleWarnText]}>{st.nome}</Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    )}
                  </View>
                );
              })
            )}
          </View>
        )}

        <TextInput multiline onChangeText={(v) => updateDraft('observacao', v)} placeholder="Observação (opcional)" placeholderTextColor="#94A3B8" style={s.textarea} value={draft.observacao} />

        <View style={s.actionRow}>
          <Pressable onPress={saveDraft} style={s.btnPrimary}>
            <MaterialCommunityIcons name={editingId ? 'content-save' : 'plus'} size={16} color="#FFFFFF" />
            <Text style={s.btnPrimaryText}>{editingId ? 'Salvar edição' : 'Criar etapa'}</Text>
          </Pressable>
          {editingId && (
            <Pressable onPress={cancelEdit} style={s.btnSecondary}>
              <Text style={s.btnSecondaryText}>Cancelar</Text>
            </Pressable>
          )}
        </View>
      </View>

      {/* STAGES LIST — blue border */}
      <View style={[s.section, s.sectionBlue]}>
        <Text style={[s.sectionTitle, { color: '#1D4ED8' }]}>Etapas cadastradas</Text>
        {loading ? (
          <>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </>
        ) : stageGroups.map(([cat, items]) => {
          const color = categoryColor(cat);
          const collapsed = collapsedStageGroups[cat] === true;
          const activeInGroup = items.filter((it) => it.ativo).length;
          return (
          <View key={`grp-${cat}`} style={s.stageGroup}>
            <Pressable
              onPress={() => setCollapsedStageGroups((cur) => ({ ...cur, [cat]: !collapsed }))}
              style={s.stageGroupHeader}
            >
              <MaterialCommunityIcons name={collapsed ? 'chevron-right' : 'chevron-down'} size={18} color="#64748B" />
              <View style={[s.stageGroupDot, { backgroundColor: color }]} />
              <Text style={s.stageGroupTitle}>{cat}</Text>
              <Text style={s.stageGroupCount}>
                {collapsed ? `${activeInGroup}/${items.length} ativas` : `${items.length} etapa${items.length === 1 ? '' : 's'}`}
              </Text>
            </Pressable>
            {!collapsed && items.map((stage) => (
              <View key={stage.id} style={[s.stageCard, !stage.ativo && s.stageInactive, editingId === stage.id && s.stageEditing]}>
                <View style={[s.stageStripe, { backgroundColor: color }]} />
                <View style={s.stageBody}>
            <View style={s.stageTop}>
              <View style={s.stageOrder}>
                <Text style={s.stageOrderText}>{stage.ordemExecucao}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.stageName}>{stage.nome}</Text>
                <Text style={s.stageMeta}>{stage.unidadeMedicao}</Text>
              </View>
              <View style={[s.stagePill, stage.ativo ? s.stagePillActive : s.stagePillInactive]}>
                <Text style={[s.stagePillText, stage.ativo ? s.stagePillActiveText : s.stagePillInactiveText]}>
                  {stage.ativo ? 'Ativa' : 'Inativa'}
                </Text>
              </View>
            </View>

            {Boolean(stage.dataInicio || stage.dataFim) && (
              <View style={s.durationRow}>
                <MaterialCommunityIcons name="calendar-range" size={13} color="#6D28D9" />
                <Text style={s.durationText}>
                  {formatDateBR(stage.dataInicio)} → {formatDateBR(stage.dataFim)}
                </Text>
              </View>
            )}

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
                <MaterialCommunityIcons name="pencil" size={13} color="#1D4ED8" />
                <Text style={s.btnSecondaryText}>Editar</Text>
              </Pressable>
              {stage.ativo ? (
                <Pressable onPress={() => inactivate(stage)} style={s.btnDanger}>
                  <Text style={s.btnDangerText}>Inativar</Text>
                </Pressable>
              ) : (
                <Pressable onPress={() => reactivate(stage)} style={s.btnReactivate}>
                  <MaterialCommunityIcons name="restart" size={13} color="#047857" />
                  <Text style={s.btnReactivateText}>Reativar</Text>
                </Pressable>
              )}
              <Pressable onPress={() => setStageToDelete(stage)} style={s.btnDelete}>
                <MaterialCommunityIcons name="trash-can-outline" size={14} color="#FFFFFF" />
                <Text style={s.btnDeleteText}>Excluir</Text>
              </Pressable>
            </View>
                </View>
              </View>
            ))}
          </View>
          );
        })}
      </View>

      </ScrollView>

      <Modal animationType="fade" transparent visible={restoreOpen} onRequestClose={() => setRestoreOpen(false)}>
        <Pressable style={s.modalBackdrop} onPress={() => setRestoreOpen(false)}>
          <Pressable style={s.modalCard} onPress={() => { /* swallow */ }}>
            <View style={s.modalIconWrap}>
              <MaterialCommunityIcons name="restore-alert" size={28} color="#B91C1C" />
            </View>
            <Text style={s.modalTitle}>Restaurar padrão?</Text>
            <Text style={s.modalBody}>
              Isso substitui TODAS as etapas cadastradas pela lista padrão. Edições, durações e dependências personalizadas serão perdidas.
            </Text>
            <View style={s.modalActions}>
              <Pressable onPress={() => setRestoreOpen(false)} style={s.modalCancel}>
                <Text style={s.modalCancelText}>Cancelar</Text>
              </Pressable>
              <Pressable onPress={confirmRestore} style={s.modalConfirm}>
                <MaterialCommunityIcons name="restore" size={16} color="#FFFFFF" />
                <Text style={s.modalConfirmText}>Restaurar</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal animationType="fade" transparent visible={stageToDelete !== null} onRequestClose={() => setStageToDelete(null)}>
        <Pressable style={s.modalBackdrop} onPress={() => setStageToDelete(null)}>
          <Pressable style={s.modalCard} onPress={() => { /* swallow */ }}>
            <View style={s.modalIconWrap}>
              <MaterialCommunityIcons name="trash-can-outline" size={28} color="#B91C1C" />
            </View>
            <Text style={s.modalTitle}>Excluir etapa?</Text>
            <Text style={s.modalBody}>
              A etapa “{stageToDelete?.nome}” será removida permanentemente do banco. Esta ação não pode ser desfeita.
            </Text>
            <View style={s.modalActions}>
              <Pressable onPress={() => setStageToDelete(null)} style={s.modalCancel}>
                <Text style={s.modalCancelText}>Cancelar</Text>
              </Pressable>
              <Pressable onPress={confirmDelete} style={s.modalConfirm}>
                <MaterialCommunityIcons name="trash-can-outline" size={16} color="#FFFFFF" />
                <Text style={s.modalConfirmText}>Excluir</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
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
  sectionEditing: { backgroundColor: '#FAF5FF' },
  sectionTitle: { fontSize: 15, fontWeight: '900' },
  formHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' },
  editingBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#EDE9FE', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  editingBadgeText: { color: '#6D28D9', fontSize: 11, fontWeight: '800' },

  // form
  formGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  fieldGroup: { flexGrow: 1, gap: 6, minWidth: 160 },
  fieldLabel: { color: '#475569', fontSize: 12, fontWeight: '700' },
  input: { backgroundColor: '#F8FAFC', borderColor: '#CBD5E1', borderRadius: 10, borderWidth: 1, color: '#0F172A', fontSize: 14, minHeight: 42, paddingHorizontal: 12 },
  durationBox: { backgroundColor: '#FAFAFA', borderColor: '#E2E8F0', borderRadius: 10, borderWidth: 1, gap: 10, padding: 12 },
  durationHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  toggleRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 5, borderColor: '#E2E8F0', borderRadius: 8, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 7, backgroundColor: '#F8FAFC' },
  toggleOn: { backgroundColor: '#EDE9FE', borderColor: '#8B5CF6' },
  toggleWarn: { backgroundColor: '#FEF3C7', borderColor: '#FCD34D' },
  toggleText: { color: '#64748B', fontSize: 12, fontWeight: '600' },
  toggleTextOn: { color: '#6D28D9' },
  toggleWarnText: { color: '#B45309' },
  dependencyBox: { backgroundColor: '#FAFAFA', borderColor: '#E2E8F0', borderRadius: 10, borderWidth: 1, gap: 8, padding: 12 },
  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#FFFFFF', borderColor: '#CBD5E1', borderRadius: 8, borderWidth: 1, paddingHorizontal: 10, minHeight: 38 },
  searchInput: { flex: 1, color: '#0F172A', fontSize: 13, paddingVertical: 8 },
  searchClear: { padding: 2 },
  emptyDepText: { color: '#94A3B8', fontSize: 12, fontStyle: 'italic' },
  textarea: { backgroundColor: '#F8FAFC', borderColor: '#CBD5E1', borderRadius: 10, borderWidth: 1, color: '#0F172A', fontSize: 14, minHeight: 72, padding: 12, textAlignVertical: 'top' },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },

  // stage cards
  stageCard: { backgroundColor: '#F8FAFC', borderRadius: 12, borderWidth: 1, borderColor: '#E2E8F0', flexDirection: 'row', overflow: 'hidden' },
  stageStripe: { width: 4, alignSelf: 'stretch' },
  stageBody: { flex: 1, padding: 12, gap: 10 },
  stageInactive: { opacity: 0.6 },
  stageEditing: { borderColor: '#8B5CF6', backgroundColor: '#FAF5FF' },
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
  durationRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  durationText: { color: '#6D28D9', fontSize: 12, fontWeight: '700' },
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
  btnSecondary: { flexDirection: 'row', alignItems: 'center', gap: 5, borderColor: '#CBD5E1', borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 9 },
  btnSecondaryText: { color: '#1D4ED8', fontSize: 12, fontWeight: '700' },
  btnDanger: { borderColor: '#F87171', borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 9 },
  btnDangerText: { color: '#B91C1C', fontSize: 12, fontWeight: '700' },
  btnDelete: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#B91C1C', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9 },
  btnDeleteText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
  btnReactivate: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#D1FAE5', borderColor: '#A7F3D0', borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  btnReactivateText: { color: '#047857', fontSize: 12, fontWeight: '800' },
  btnIcon: { borderColor: '#E2E8F0', borderRadius: 8, borderWidth: 1, padding: 8 },

  // grouping (mirrors the floorGroup pattern from app/(tabs)/visao-geral/[torreId].tsx)
  stageGroup: { gap: 8 },
  stageGroupHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 4 },
  stageGroupDot: { width: 10, height: 10, borderRadius: 5 },
  stageGroupTitle: { color: '#0F172A', fontSize: 13, fontWeight: '800', flex: 1 },
  stageGroupCount: { color: '#94A3B8', fontSize: 11, fontWeight: '600' },
  depGroup: { gap: 6 },
  depGroupHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 },
  depGroupDot: { width: 8, height: 8, borderRadius: 4 },
  depGroupTitle: { color: '#475569', fontSize: 12, fontWeight: '800', flex: 1 },
  depGroupCount: { color: '#94A3B8', fontSize: 11, fontWeight: '700' },
  depGroupSelPill: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#FEF3C7', borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2 },
  depGroupSelText: { color: '#B45309', fontSize: 10, fontWeight: '800' },

  // field errors
  fieldLabelError: { color: '#B91C1C' },
  inputError: { borderColor: '#F87171', backgroundColor: '#FEF2F2' },
  fieldErrorText: { color: '#B91C1C', fontSize: 11, fontWeight: '700' },

  // modal
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.55)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalCard: { width: '100%', maxWidth: 420, backgroundColor: '#FFFFFF', borderRadius: 16, padding: 22, gap: 12, alignItems: 'center' },
  modalIconWrap: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#FEE2E2', alignItems: 'center', justifyContent: 'center' },
  modalTitle: { color: '#0F172A', fontSize: 18, fontWeight: '900', textAlign: 'center' },
  modalBody: { color: '#475569', fontSize: 13, lineHeight: 18, textAlign: 'center' },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 6, alignSelf: 'stretch' },
  modalCancel: { flex: 1, alignItems: 'center', justifyContent: 'center', borderColor: '#CBD5E1', borderRadius: 10, borderWidth: 1, paddingVertical: 11 },
  modalCancelText: { color: '#1D4ED8', fontSize: 13, fontWeight: '800' },
  modalConfirm: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#B91C1C', borderRadius: 10, paddingVertical: 11 },
  modalConfirmText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
});
