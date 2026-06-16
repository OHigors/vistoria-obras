import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '@/src/ui/Text';
import { Skeleton } from '@/src/ui/Skeleton';
import { useToast } from '@/src/ui/Toast';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { categoryOrderIndex, createEmptyServiceStage, defaultServiceStages } from '@/src/data/serviceStages';
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

function CatalogSelectField({
  label,
  value,
  options,
  onChange,
  onManage,
  placeholder,
  sheetTitle,
  manageLabel,
  manageIcon,
  error,
}: {
  label: string;
  value: string;
  options: { id: string; nome: string }[];
  onChange: (v: string) => void;
  onManage: () => void;
  placeholder: string;
  sheetTitle: string;
  manageLabel: string;
  manageIcon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  error?: string;
}) {
  const [open, setOpen] = useState(false);
  const selectedExists = options.some((c) => c.nome === value);
  return (
    <View style={s.fieldGroup}>
      <Text style={[s.fieldLabel, error && s.fieldLabelError]}>
        {label}{error ? ' *' : ''}
      </Text>
      <Pressable onPress={() => setOpen(true)} style={[s.input, s.selectInput, error && s.inputError]}>
        <Text style={[s.selectInputText, !value && s.selectInputPlaceholder]}>
          {value || placeholder}
        </Text>
        <MaterialCommunityIcons name="chevron-down" size={18} color="#94A3B8" />
      </Pressable>
      {error ? <Text style={s.fieldErrorText}>{error}</Text> : null}

      <Modal animationType="fade" transparent visible={open} onRequestClose={() => setOpen(false)}>
        <Pressable style={s.selectBackdrop} onPress={() => setOpen(false)}>
          <Pressable style={s.selectSheet} onPress={(e) => e.stopPropagation()}>
            <View style={s.selectHeader}>
              <Text style={s.selectTitle}>{sheetTitle}</Text>
              <Pressable onPress={() => setOpen(false)} style={s.selectClose}>
                <MaterialCommunityIcons name="close" size={20} color="#475569" />
              </Pressable>
            </View>
            <ScrollView style={s.selectList}>
              {options.length === 0 ? (
                <Text style={s.emptyDepText}>Nenhum item cadastrado. Use "{manageLabel}" para criar.</Text>
              ) : (
                <View style={s.selectGroup}>
                  {value && !selectedExists ? (
                    <Pressable style={[s.selectItem, s.selectItemSelected]}>
                      <View style={[s.depGroupDot, { backgroundColor: categoryColor(value) }]} />
                      <Text style={[s.selectItemLabel, s.selectItemLabelSelected]} numberOfLines={1}>{value} (atual)</Text>
                    </Pressable>
                  ) : null}
                  {options.map((opt) => {
                    const isSelected = opt.nome === value;
                    return (
                      <Pressable
                        key={opt.id}
                        onPress={() => { onChange(opt.nome); setOpen(false); }}
                        style={[s.selectItem, isSelected && s.selectItemSelected]}
                      >
                        <View style={[s.depGroupDot, { backgroundColor: categoryColor(opt.nome) }]} />
                        <Text style={[s.selectItemLabel, isSelected && s.selectItemLabelSelected]} numberOfLines={1}>
                          {opt.nome}
                        </Text>
                        {isSelected && <MaterialCommunityIcons name="check" size={16} color="#6D28D9" />}
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </ScrollView>
            <Pressable onPress={() => { setOpen(false); onManage(); }} style={s.selectManageBtn}>
              <MaterialCommunityIcons name={manageIcon} size={16} color="#6D28D9" />
              <Text style={s.selectManageText}>{manageLabel}</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
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
  const { refreshServiceStages, refreshData, serviceCategories, serviceUnits } = useObras();
  const toast = useToast();
  const scrollRef = useRef<ScrollView | null>(null);
  const [stages, setStages] = useState<ServiceStage[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string>();
  const [draft, setDraft] = useState<ServiceStage>(() => createEmptyServiceStage(1));
  const [depFilter, setDepFilter] = useState('');
  const [subFilter, setSubFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [nameSearch, setNameSearch] = useState('');
  const [listOpen, setListOpen] = useState(false);
  const [showSubSection, setShowSubSection] = useState(false);
  const [showDepSection, setShowDepSection] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof ServiceStage, string>>>({});
  const [formOpen, setFormOpen] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [openDepGroups, setOpenDepGroups] = useState<Record<string, boolean>>({});
  const [openSubGroups, setOpenSubGroups] = useState<Record<string, boolean>>({});
  const [collapsedStageGroups, setCollapsedStageGroups] = useState<Record<string, boolean>>({});
  const [stageToDelete, setStageToDelete] = useState<ServiceStage | null>(null);
  const [showBackToTop, setShowBackToTop] = useState(false);

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
        // Start with every stage group collapsed so the page is quick to scan.
        const cats = new Set<string>();
        for (const st of loaded) cats.add((st.categoria || 'Sem categoria').trim() || 'Sem categoria');
        const collapsed: Record<string, boolean> = {};
        cats.forEach((c) => { collapsed[c] = true; });
        setCollapsedStageGroups(collapsed);
      };
      const elapsed = Date.now() - started;
      if (elapsed >= MIN) finish();
      else setTimeout(finish, MIN - elapsed);
    });
  }, []));

  const sortedStages = useMemo(
    () => [...stages].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')),
    [stages],
  );

  const persistStages = (next: ServiceStage[]) => {
    const ordered = next.map((s, i) => ({ ...s, ordemExecucao: i + 1 })).sort((a, b) => a.ordemExecucao - b.ordemExecucao);
    setStages(ordered);
    // Persist and broadcast the new catalog so other screens (apartment "add step"
    // modal in particular) see the change without needing a full app reload.
    db.saveServiceStages(ordered)
      .then(() => refreshServiceStages())
      .catch(() => toast.error('Erro ao salvar etapas'));
  };

  const updateDraft = <F extends keyof ServiceStage>(field: F, value: ServiceStage[F]) => {
    setDraft((cur) => ({ ...cur, [field]: value }));
    if (errors[field]) setErrors((e) => ({ ...e, [field]: undefined }));
  };

  const saveDraft = () => {
    const next: Partial<Record<keyof ServiceStage, string>> = {};
    const trimmedName = draft.nome.trim();
    if (!trimmedName) {
      next.nome = 'Informe o nome da etapa';
    } else {
      // The DB enforces UNIQUE (obra_id, nome); catch duplicates here so the user
      // gets a clear field error instead of a 409 from the upsert.
      const nameKey = trimmedName.toLocaleLowerCase('pt-BR');
      const duplicate = stages.some(
        (st) => st.id !== draft.id && st.nome.trim().toLocaleLowerCase('pt-BR') === nameKey,
      );
      if (duplicate) next.nome = 'Já existe uma etapa com esse nome';
    }
    if (!draft.categoria.trim()) next.categoria = 'Informe a categoria';
    if (!draft.unidadeMedicao.trim()) next.unidadeMedicao = 'Informe a unidade';
    if (Object.keys(next).length > 0) {
      setErrors(next);
      return;
    }
    setErrors({});
    const prevStages = stages;
    const normalized: ServiceStage = { ...draft, id: draft.id || crypto.randomUUID(), nome: draft.nome.trim(), categoria: draft.categoria.trim(), unidadeMedicao: draft.unidadeMedicao.trim(), observacao: draft.observacao.trim() };
    const updated = editingId ? stages.map((s) => (s.id === editingId ? normalized : s)) : [...stages, normalized];
    const ordered = updated.map((s, i) => ({ ...s, ordemExecucao: i + 1 })).sort((a, b) => a.ordemExecucao - b.ordemExecucao);
    setStages(ordered);
    setEditingId(undefined);
    setDraft(createEmptyServiceStage(updated.length + 1));
    setDepFilter('');
    setSubFilter('');
    setFormOpen(false);
    const wasEditing = !!editingId;
    toast.saving(wasEditing ? 'Atualizando etapa…' : 'Criando etapa…');
    // New stages are NOT auto-added to apartments — a step only enters a checklist
    // through the add-step popup, where its area (Interior/Exterior) is chosen.
    db.saveServiceStages(ordered)
      .then(() => Promise.all([refreshServiceStages(), refreshData()]))
      .then(() => toast.saved(wasEditing ? 'Etapa atualizada' : 'Etapa criada'))
      .catch(() => {
        // Roll back the optimistic change so a rejected stage doesn't linger.
        setStages(prevStages);
        toast.error(wasEditing ? 'Erro ao atualizar etapa' : 'Erro ao criar etapa');
      });
  };

  const editStage = (stage: ServiceStage) => {
    setEditingId(stage.id);
    setDraft(stage);
    setDepFilter('');
    setSubFilter('');
    setShowSubSection(stage.subEtapas.length > 0);
    setShowDepSection(stage.servicosDependentes.length > 0);
    setFormOpen(true);
  };
  const inactivate = (stage: ServiceStage) => persistStages(stages.map((s) => (s.id === stage.id ? { ...s, ativo: false } : s)));
  const reactivate = (stage: ServiceStage) => persistStages(stages.map((s) => (s.id === stage.id ? { ...s, ativo: true } : s)));

  const confirmDelete = () => {
    if (!stageToDelete) return;
    const id = stageToDelete.id;
    const next = stages.filter((s) => s.id !== id);
    const ordered = next.map((s, i) => ({ ...s, ordemExecucao: i + 1 }));
    setStages(ordered);
    toast.saving('Excluindo etapa…');
    const tasks: Promise<unknown>[] = [db.deleteServiceStage(id)];
    if (ordered.length > 0) tasks.push(db.saveServiceStages(ordered));
    Promise.all(tasks)
      .then(() => refreshServiceStages())
      .then(() => toast.saved('Etapa excluída'))
      .catch(() => toast.error('Erro ao excluir etapa'));
    if (editingId === id) {
      setEditingId(undefined);
      setDraft(createEmptyServiceStage(ordered.length + 1));
    }
    setStageToDelete(null);
  };

  const toggleDependent = (name: string) => {
    const deps = draft.servicosDependentes.includes(name)
      ? draft.servicosDependentes.filter((s) => s !== name)
      : [...draft.servicosDependentes, name];
    updateDraft('servicosDependentes', deps);
  };

  const toggleSubEtapa = (name: string) => {
    const subs = draft.subEtapas.includes(name)
      ? draft.subEtapas.filter((s) => s !== name)
      : [...draft.subEtapas, name];
    updateDraft('subEtapas', subs);
  };

  // The two checkboxes reveal/hide the sub-etapas and "trava" pickers. Unchecking
  // clears whatever was selected so we never persist hidden data.
  const toggleSubSection = () => {
    const next = !showSubSection;
    setShowSubSection(next);
    if (!next && draft.subEtapas.length > 0) updateDraft('subEtapas', []);
  };
  const toggleDepSection = () => {
    const next = !showDepSection;
    setShowDepSection(next);
    if (!next && draft.servicosDependentes.length > 0) updateDraft('servicosDependentes', []);
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
    setSubFilter('');
    setShowSubSection(false);
    setShowDepSection(false);
    setFormOpen(false);
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

  // Candidates that can be sub-steps of the stage being edited. A stage cannot be
  // its own sub-step, and a stage that itself has sub-steps (a group) cannot be
  // nested as a sub-step — keeping the hierarchy a single level deep.
  const normalizedSubFilter = stripDiacritics(subFilter.trim());
  const subStepCandidates = sortedStages.filter((st) => {
    if (st.id === draft.id) return false;
    if (st.subEtapas.length > 0) return false;
    if (!normalizedSubFilter) return true;
    return stripDiacritics(st.nome).includes(normalizedSubFilter);
  });

  const groupByCategoria = <T extends { categoria: string }>(list: T[]) => {
    const map = new Map<string, T[]>();
    for (const item of list) {
      const cat = item.categoria?.trim() || 'Sem categoria';
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(item);
    }
    return [...map.entries()].sort(([a], [b]) => categoryOrderIndex(a) - categoryOrderIndex(b) || a.localeCompare(b, 'pt-BR'));
  };

  const dependencyGroups = groupByCategoria(dependencyCandidates);
  const subStepGroups = groupByCategoria(subStepCandidates);

  // Distinct categories (with active/total counts) for the filter strip.
  const categoryOptions = useMemo(() => {
    const map = new Map<string, { total: number; active: number }>();
    for (const st of stages) {
      const cat = (st.categoria || 'Sem categoria').trim() || 'Sem categoria';
      const cur = map.get(cat) ?? { total: 0, active: 0 };
      cur.total += 1;
      if (st.ativo) cur.active += 1;
      map.set(cat, cur);
    }
    return [...map.entries()]
      .sort(([a], [b]) => categoryOrderIndex(a) - categoryOrderIndex(b) || a.localeCompare(b, 'pt-BR'))
      .map(([nome, counts]) => ({ nome, ...counts }));
  }, [stages]);

  // Keep the active category filter valid as the catalog changes.
  useEffect(() => {
    if (categoryFilter !== 'all' && !categoryOptions.some((c) => c.nome === categoryFilter)) {
      setCategoryFilter('all');
    }
  }, [categoryFilter, categoryOptions]);

  // Combined filter: free-text search (name or category) + selected category chip.
  const normalizedNameSearch = stripDiacritics(nameSearch.trim());
  const filteredStages = sortedStages.filter((st) => {
    const cat = (st.categoria || 'Sem categoria').trim() || 'Sem categoria';
    if (categoryFilter !== 'all' && cat !== categoryFilter) return false;
    if (!normalizedNameSearch) return true;
    return (
      stripDiacritics(st.nome).includes(normalizedNameSearch) ||
      stripDiacritics(cat).includes(normalizedNameSearch)
    );
  });
  const stageGroups = groupByCategoria(filteredStages);
  // While searching/filtering, expand groups so matches are visible immediately.
  const forceGroupsOpen = normalizedNameSearch.length > 0 || categoryFilter !== 'all';

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
      <ScrollView
        ref={scrollRef}
        style={s.scroll}
        contentContainerStyle={s.container}
        scrollEventThrottle={64}
        onScroll={(e) => {
          const y = e.nativeEvent.contentOffset.y;
          if (y > 400 && !showBackToTop) setShowBackToTop(true);
          else if (y <= 400 && showBackToTop) setShowBackToTop(false);
        }}
      >

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
        <View style={s.headerActions}>
          <Pressable
            accessibilityLabel="Nova etapa"
            onPress={() => {
              setEditingId(undefined);
              setDraft(createEmptyServiceStage(stages.length + 1));
              setDepFilter('');
              setSubFilter('');
              setShowSubSection(false);
              setShowDepSection(false);
              setErrors({});
              setFormOpen(true);
            }}
            style={s.headerIconBtn}
          >
            <MaterialCommunityIcons name="plus" size={20} color="#6D28D9" />
          </Pressable>
          <Pressable
            accessibilityLabel="Gerenciar categorias e unidades"
            onPress={() => router.push('/(tabs)/cronograma/catalogos' as any)}
            style={s.headerIconBtn}
          >
            <MaterialCommunityIcons name="tag-multiple-outline" size={18} color="#6D28D9" />
          </Pressable>
        </View>
      </View>

      {/* STAGES LIST — collapsible card */}
      <View style={s.listCard}>
        <Pressable onPress={() => setListOpen((o) => !o)} style={s.listCardHeader}>
          <View style={s.listCardIcon}>
            <MaterialCommunityIcons name="format-list-bulleted" size={20} color="#1D4ED8" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.listCardTitle}>Etapas cadastradas</Text>
            {loading ? (
              <Skeleton height={11} width={140} radius={4} style={{ marginTop: 4 }} />
            ) : (
              <Text style={s.listCardSub}>{activeCount} ativas · {stages.length} cadastradas</Text>
            )}
          </View>
          <MaterialCommunityIcons name={listOpen ? 'chevron-up' : 'chevron-down'} size={24} color="#94A3B8" />
        </Pressable>

        {listOpen && (
          <View style={s.listCardBody}>
            <View style={s.searchRow}>
              <MaterialCommunityIcons name="magnify" size={18} color="#94A3B8" />
              <TextInput
                onChangeText={setNameSearch}
                placeholder="Pesquisar etapa…"
                placeholderTextColor="#94A3B8"
                style={s.searchInput}
                value={nameSearch}
              />
              {nameSearch.length > 0 && (
                <Pressable onPress={() => setNameSearch('')} style={s.searchClear}>
                  <MaterialCommunityIcons name="close-circle" size={16} color="#94A3B8" />
                </Pressable>
              )}
            </View>

            {categoryOptions.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filterChipRow}>
                <Pressable
                  onPress={() => setCategoryFilter('all')}
                  style={[s.catChip, categoryFilter === 'all' && s.catChipActive]}>
                  <Text style={[s.catChipText, categoryFilter === 'all' && s.catChipTextActive]}>Todas</Text>
                  <View style={[s.catChipCount, categoryFilter === 'all' && s.catChipCountActive]}>
                    <Text style={[s.catChipCountText, categoryFilter === 'all' && s.catChipCountTextActive]}>{stages.length}</Text>
                  </View>
                </Pressable>
                {categoryOptions.map((cat) => {
                  const active = categoryFilter === cat.nome;
                  return (
                    <Pressable
                      key={cat.nome}
                      onPress={() => setCategoryFilter(active ? 'all' : cat.nome)}
                      style={[s.catChip, active && s.catChipActive]}>
                      <View style={[s.catChipDot, { backgroundColor: categoryColor(cat.nome) }]} />
                      <Text style={[s.catChipText, active && s.catChipTextActive]} numberOfLines={1}>{cat.nome}</Text>
                      <View style={[s.catChipCount, active && s.catChipCountActive]}>
                        <Text style={[s.catChipCountText, active && s.catChipCountTextActive]}>{cat.total}</Text>
                      </View>
                    </Pressable>
                  );
                })}
              </ScrollView>
            )}

            {loading ? (
              <>
                <SkeletonCard />
                <SkeletonCard />
                <SkeletonCard />
              </>
            ) : stageGroups.length === 0 ? (
              <View style={s.listEmpty}>
                <MaterialCommunityIcons name="magnify-close" size={28} color="#CBD5E1" />
                <Text style={s.listEmptyText}>Nenhuma etapa encontrada.</Text>
              </View>
            ) : stageGroups.map(([cat, items]) => {
          const color = categoryColor(cat);
          const collapsed = !forceGroupsOpen && collapsedStageGroups[cat] === true;
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
              <View key={stage.id} style={[s.stageCard, editingId === stage.id && s.stageEditing]}>
                <View style={[s.stageStripe, { backgroundColor: color }]} />
                <View style={s.stageBody}>
                  <View style={[s.stageContent, !stage.ativo && s.stageInactiveContent]}>
                    <View style={s.stageTop}>
                      <View style={{ flex: 1 }}>
                        <Text style={s.stageName}>{stage.nome}</Text>
                        <Text style={s.stageMeta}>{stage.unidadeMedicao}</Text>
                      </View>
                      {stage.subEtapas.length > 0 && (
                        <View style={s.groupBadge}>
                          <MaterialCommunityIcons name="layers-outline" size={11} color="#0891B2" />
                          <Text style={s.groupBadgeText}>Grupo</Text>
                        </View>
                      )}
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

                    {stage.subEtapas.length > 0 && (
                      <View style={s.subStepsRow}>
                        <MaterialCommunityIcons name="layers-outline" size={13} color="#0891B2" />
                        <Text style={s.subStepsText}>
                          Conclui ao terminar: {stage.subEtapas.join(', ')}
                        </Text>
                      </View>
                    )}

                    {stage.servicosDependentes.length > 0 && (
                      <View style={s.blocksRow}>
                        <MaterialCommunityIcons name="lock" size={13} color="#B45309" />
                        <Text style={s.blocksText}>Trava: {stage.servicosDependentes.join(', ')}</Text>
                      </View>
                    )}
                  </View>

                  <View style={s.actionRow}>
                    {stage.ativo ? (
                      <Pressable onPress={() => inactivate(stage)} style={s.btnDanger}>
                        <Text style={s.btnDangerText}>Inativar</Text>
                      </Pressable>
                    ) : (
                      <Pressable onPress={() => reactivate(stage)} style={s.btnReactivate}>
                        <MaterialCommunityIcons name="restart" size={13} color="#047857" />
                        <Text style={s.btnReactivateText}>Ativar</Text>
                      </Pressable>
                    )}
                    <Pressable onPress={() => editStage(stage)} style={s.btnSecondary}>
                      <MaterialCommunityIcons name="pencil" size={13} color="#1D4ED8" />
                      <Text style={s.btnSecondaryText}>Editar</Text>
                    </Pressable>
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
        )}
      </View>

      </ScrollView>

      {showBackToTop && (
        <Pressable
          onPress={() => scrollRef.current?.scrollTo({ y: 0, animated: false })}
          style={s.backToTopFab}
          testID="back-to-top">
          <MaterialCommunityIcons name="chevron-up" size={22} color="#FFFFFF" />
        </Pressable>
      )}

      {/* FORM MODAL */}
      <Modal animationType="slide" transparent visible={formOpen} onRequestClose={cancelEdit}>
        <Pressable style={s.selectBackdrop} onPress={cancelEdit}>
          <Pressable style={s.formSheet} onPress={(e) => e.stopPropagation()}>
            {/* grab handle */}
            <View style={s.formSheetHandle} />
            {/* header */}
            <View style={s.formSheetHeader}>
              <View style={s.formSheetHeaderLeft}>
                <MaterialCommunityIcons name={editingId ? 'pencil' : 'plus-circle-outline'} size={20} color="#6D28D9" />
                <Text style={s.formSheetTitle}>{editingId ? 'Editar etapa' : 'Nova etapa'}</Text>
              </View>
              <Pressable onPress={cancelEdit} style={s.selectClose}>
                <MaterialCommunityIcons name="close" size={20} color="#475569" />
              </Pressable>
            </View>

            <ScrollView style={s.formSheetScroll} contentContainerStyle={s.formSheetContent} keyboardShouldPersistTaps="handled">
              <View style={s.formColumn}>
                <Field label="Nome" value={draft.nome} onChangeText={(v) => updateDraft('nome', v)} error={errors.nome} />
                <CatalogSelectField
                  label="Categoria"
                  value={draft.categoria}
                  options={serviceCategories}
                  onChange={(v) => updateDraft('categoria', v)}
                  onManage={() => { cancelEdit(); router.push('/(tabs)/cronograma/catalogos?tab=categorias' as any); }}
                  placeholder="Selecione a categoria"
                  sheetTitle="Categoria"
                  manageLabel="Gerenciar categorias"
                  manageIcon="tag-multiple-outline"
                  error={errors.categoria}
                />
                <CatalogSelectField
                  label="Unidade de medição"
                  value={draft.unidadeMedicao}
                  options={serviceUnits}
                  onChange={(v) => updateDraft('unidadeMedicao', v)}
                  onManage={() => { cancelEdit(); router.push('/(tabs)/cronograma/catalogos?tab=unidades' as any); }}
                  placeholder="Selecione a unidade"
                  sheetTitle="Unidade de medição"
                  manageLabel="Gerenciar unidades"
                  manageIcon="ruler"
                  error={errors.unidadeMedicao}
                />
              </View>

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

              {sortedStages.some((st) => st.id !== draft.id) && (
                <Pressable
                  onPress={toggleSubSection}
                  style={s.checkOption}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: showSubSection }}>
                  <MaterialCommunityIcons name={showSubSection ? 'checkbox-marked' : 'checkbox-blank-outline'} size={22} color={showSubSection ? '#0891B2' : '#94A3B8'} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.checkOptionText}>Etapa possui sub-etapas</Text>
                    <Text style={s.checkOptionHint}>Agrupa outras etapas, conclui automaticamente quando todas terminarem.</Text>
                  </View>
                </Pressable>
              )}

              {showSubSection && (
                <View style={s.subStepBox}>
                  <View style={s.subStepHeader}>
                    <View style={s.subStepHeaderIcon}>
                      <MaterialCommunityIcons name="layers-triple-outline" size={16} color="#0891B2" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.subStepTitle}>Sub-etapas</Text>
                      <Text style={s.subStepHint}>
                        Agrupe outras etapas dentro desta. Quando todas forem concluídas, esta etapa é concluída automaticamente.
                      </Text>
                    </View>
                  </View>

                  {draft.subEtapas.length > 0 && (
                    <View style={s.subStepActiveBanner}>
                      <MaterialCommunityIcons name="information-outline" size={14} color="#0E7490" />
                      <Text style={s.subStepActiveText}>
                        {draft.subEtapas.length} sub-etapa{draft.subEtapas.length === 1 ? '' : 's'} · o status desta etapa passa a ser automático, sem marcação manual no checklist.
                      </Text>
                    </View>
                  )}

                  <View style={s.searchWrap}>
                    <MaterialCommunityIcons name="magnify" size={16} color="#94A3B8" />
                    <TextInput
                      onChangeText={setSubFilter}
                      placeholder="Filtrar etapas…"
                      placeholderTextColor="#94A3B8"
                      style={s.searchInput}
                      value={subFilter}
                    />
                    {subFilter ? (
                      <Pressable onPress={() => setSubFilter('')} style={s.searchClear}>
                        <MaterialCommunityIcons name="close-circle" size={16} color="#94A3B8" />
                      </Pressable>
                    ) : null}
                  </View>
                  {subStepCandidates.length === 0 ? (
                    <Text style={s.emptyDepText}>
                      {normalizedSubFilter ? 'Nenhuma etapa corresponde ao filtro.' : 'Nenhuma etapa disponível como sub-etapa.'}
                    </Text>
                  ) : (
                    subStepGroups.map(([cat, items]) => {
                      const forceOpen = Boolean(normalizedSubFilter);
                      const isOpen = forceOpen || openSubGroups[cat] === true;
                      const selectedInGroup = items.filter((st) => draft.subEtapas.includes(st.nome)).length;
                      return (
                        <View key={`subgrp-${cat}`} style={s.depGroup}>
                          <Pressable
                            onPress={() => setOpenSubGroups((cur) => ({ ...cur, [cat]: !isOpen }))}
                            style={s.depGroupHeader}
                          >
                            <MaterialCommunityIcons name={isOpen ? 'chevron-down' : 'chevron-right'} size={16} color="#64748B" />
                            <View style={[s.depGroupDot, { backgroundColor: categoryColor(cat) }]} />
                            <Text style={s.depGroupTitle}>{cat}</Text>
                            {selectedInGroup > 0 ? (
                              <View style={s.subGroupSelPill}>
                                <MaterialCommunityIcons name="layers-outline" size={10} color="#0891B2" />
                                <Text style={s.subGroupSelText}>{selectedInGroup}</Text>
                              </View>
                            ) : null}
                            <Text style={s.depGroupCount}>{items.length}</Text>
                          </Pressable>
                          {isOpen && (
                            <View style={s.toggleRow}>
                              {items.map((st) => {
                                const sel = draft.subEtapas.includes(st.nome);
                                return (
                                  <Pressable key={`sub-${st.id}`} onPress={() => toggleSubEtapa(st.nome)} style={[s.toggle, sel && s.toggleTeal]}>
                                    <MaterialCommunityIcons name={sel ? 'layers' : 'layers-outline'} size={13} color={sel ? '#0891B2' : '#94A3B8'} />
                                    <Text style={[s.toggleText, sel && s.toggleTealText]}>{st.nome}</Text>
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

              {sortedStages.some((st) => st.id !== draft.id) && (
                <Pressable
                  onPress={toggleDepSection}
                  style={s.checkOption}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: showDepSection }}>
                  <MaterialCommunityIcons name={showDepSection ? 'checkbox-marked' : 'checkbox-blank-outline'} size={22} color={showDepSection ? '#B45309' : '#94A3B8'} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.checkOptionText}>Etapa trava outros serviços</Text>
                  </View>
                </Pressable>
              )}

              {showDepSection && (
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
                <Pressable onPress={cancelEdit} style={s.btnSecondary}>
                  <Text style={s.btnSecondaryText}>Cancelar</Text>
                </Pressable>
              </View>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

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
  pageHeader: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 16, borderWidth: 2, borderColor: '#8B5CF6', padding: 16 },
  pageHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  pageTitle: { color: '#0F172A', fontSize: 22, fontWeight: '900' },
  pageSubtitle: { color: '#64748B', fontSize: 13, marginTop: 2 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 0 },
  headerIconBtn: { width: 38, height: 38, borderRadius: 10, borderWidth: 1, borderColor: '#DDD6FE', alignItems: 'center', justifyContent: 'center' },
  headerIconBtnPrimary: { backgroundColor: '#EDE9FE', borderColor: '#8B5CF6' },
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
  formColumn: { gap: 10 },
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
  stageBody: { flex: 1, padding: 14, gap: 14 },
  stageContent: { gap: 14 },
  stageInactiveContent: { opacity: 0.55 },
  stageEditing: { borderColor: '#8B5CF6', backgroundColor: '#FAF5FF' },
  stageTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
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
  backToTopFab: {
    position: 'absolute', right: 20, bottom: 24, width: 44, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#64748B',
    shadowColor: '#000', shadowOpacity: 0.22, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 6,
  },

  // grouping (mirrors the floorGroup pattern from app/(tabs)/visao-geral/[torreId].tsx)
  stageGroup: { gap: 12 },
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

  // category filter strip
  filterBar: { backgroundColor: '#FFFFFF', borderRadius: 14, borderWidth: 1, borderColor: '#E2E8F0', padding: 12, gap: 10 },
  filterBarHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  filterBarTitle: { color: '#475569', fontSize: 12, fontWeight: '800', flex: 1 },
  filterClearBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#F5F3FF', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  filterClearText: { color: '#6D28D9', fontSize: 11, fontWeight: '800' },
  filterChipRow: { flexDirection: 'row', gap: 8, paddingRight: 4 },
  catChip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#F8FAFC', borderColor: '#E2E8F0', borderWidth: 1, borderRadius: 999, paddingLeft: 12, paddingRight: 8, paddingVertical: 7, maxWidth: 200 },
  catChipActive: { backgroundColor: '#EDE9FE', borderColor: '#8B5CF6' },
  catChipDot: { width: 9, height: 9, borderRadius: 5 },
  catChipText: { color: '#475569', fontSize: 12, fontWeight: '700', flexShrink: 1 },
  catChipTextActive: { color: '#6D28D9' },
  catChipCount: { backgroundColor: '#E2E8F0', borderRadius: 999, minWidth: 20, paddingHorizontal: 6, paddingVertical: 1, alignItems: 'center' },
  catChipCountActive: { backgroundColor: '#DDD6FE' },
  catChipCountText: { color: '#64748B', fontSize: 10, fontWeight: '800' },
  catChipCountTextActive: { color: '#6D28D9' },

  // collapsible "Etapas cadastradas" card
  listCard: { backgroundColor: '#FFFFFF', borderRadius: 16, borderWidth: 2, borderColor: '#3B82F6', overflow: 'hidden' },
  listCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 },
  listCardIcon: { width: 40, height: 40, borderRadius: 10, backgroundColor: '#EFF6FF', alignItems: 'center', justifyContent: 'center' },
  listCardTitle: { color: '#0F172A', fontSize: 16, fontWeight: '900' },
  listCardSub: { color: '#64748B', fontSize: 12, marginTop: 2, fontWeight: '600' },
  listCardBody: { gap: 12, paddingHorizontal: 16, paddingBottom: 16, borderTopWidth: 1, borderTopColor: '#EFF6FF', paddingTop: 14 },
  listEmpty: { alignItems: 'center', gap: 8, paddingVertical: 28 },
  listEmptyText: { color: '#94A3B8', fontSize: 13, fontWeight: '600' },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#F8FAFC', borderColor: '#E2E8F0', borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, minHeight: 44 },

  // config checkboxes (form)
  configChecks: { gap: 8 },
  checkOption: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: '#F8FAFC', borderColor: '#E2E8F0', borderWidth: 1, borderRadius: 10, padding: 12 },
  checkOptionText: { color: '#0F172A', fontSize: 13, fontWeight: '700' },
  checkOptionHint: { color: '#64748B', fontSize: 11, lineHeight: 15, marginTop: 2 },

  // group stage badge + sub-steps (card)
  groupBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#E0F2FE', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  groupBadgeText: { color: '#0891B2', fontSize: 10, fontWeight: '800' },
  subStepsRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  subStepsText: { color: '#0E7490', fontSize: 12, fontWeight: '600', flex: 1 },

  // sub-step picker (form)
  subStepBox: { backgroundColor: '#F0FDFA', borderColor: '#99F6E4', borderRadius: 10, borderWidth: 1, gap: 10, padding: 12 },
  subStepHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  subStepHeaderIcon: { width: 30, height: 30, borderRadius: 8, backgroundColor: '#CFFAFE', alignItems: 'center', justifyContent: 'center' },
  subStepTitle: { color: '#0F172A', fontSize: 13, fontWeight: '800' },
  subStepHint: { color: '#0E7490', fontSize: 11, lineHeight: 15, marginTop: 2 },
  subStepActiveBanner: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#CFFAFE', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 },
  subStepActiveText: { color: '#0E7490', fontSize: 11, fontWeight: '700', flex: 1, lineHeight: 15 },
  subGroupSelPill: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#CFFAFE', borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2 },
  subGroupSelText: { color: '#0891B2', fontSize: 10, fontWeight: '800' },
  toggleTeal: { backgroundColor: '#CFFAFE', borderColor: '#67E8F9' },
  toggleTealText: { color: '#0E7490' },

  // area picker (form)
  areaPickerRow: { flexDirection: 'row', gap: 8 },
  areaPicker: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 11, borderRadius: 10, backgroundColor: '#F1F5F9' },
  areaPickerExteriorActive: { backgroundColor: '#D97706' },
  areaPickerInteriorActive: { backgroundColor: '#0891B2' },
  areaPickerText: { color: '#94A3B8', fontSize: 13, fontWeight: '700' },
  areaPickerTextActiveExt: { color: '#FFFFFF' },
  areaPickerTextActiveInt: { color: '#FFFFFF' },

  // area chip (card)
  areaChipExt: { backgroundColor: '#FEF3C7', borderColor: '#FDE68A' },
  areaChipInt: { backgroundColor: '#E0F2FE', borderColor: '#BAE6FD' },
  areaChipExtText: { color: '#92400E' },
  areaChipIntText: { color: '#0369A1' },

  // field errors
  fieldLabelError: { color: '#B91C1C' },
  inputError: { borderColor: '#F87171', backgroundColor: '#FEF2F2' },
  fieldErrorText: { color: '#B91C1C', fontSize: 11, fontWeight: '700' },

  // unit select
  selectInput: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingRight: 10, paddingVertical: 10 },
  selectInputText: { color: '#0F172A', fontSize: 14, fontWeight: '600', flex: 1 },
  selectInputPlaceholder: { color: '#94A3B8', fontWeight: '400' },
  selectBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.55)', justifyContent: 'flex-end' },
  selectSheet: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 18, borderTopRightRadius: 18, maxHeight: '75%', paddingBottom: 12 },
  selectHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingTop: 16, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: '#E2E8F0' },
  selectTitle: { color: '#0F172A', fontSize: 16, fontWeight: '800' },
  selectClose: { padding: 6, borderRadius: 999 },
  selectList: { paddingHorizontal: 12, paddingTop: 8 },
  selectGroup: { gap: 4, marginBottom: 12 },
  selectGroupTitle: { color: '#6D28D9', fontSize: 11, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.6, paddingHorizontal: 8 },
  selectItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10 },
  selectItemSelected: { backgroundColor: '#F5F3FF' },
  selectItemValue: { color: '#0F172A', fontSize: 14, fontWeight: '800', minWidth: 36 },
  selectItemValueSelected: { color: '#6D28D9' },
  selectItemLabel: { color: '#475569', fontSize: 13, flex: 1 },
  selectItemLabelSelected: { color: '#5B21B6', fontWeight: '600' },
  selectManageBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginHorizontal: 16, marginTop: 8, paddingVertical: 11, borderRadius: 10, borderWidth: 1, borderColor: '#DDD6FE', backgroundColor: '#F5F3FF' },
  selectManageText: { color: '#6D28D9', fontSize: 13, fontWeight: '800' },

  // form sheet
  formSheet: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '92%', paddingBottom: 0 },
  formSheetHandle: { width: 36, height: 4, backgroundColor: '#E2E8F0', borderRadius: 2, alignSelf: 'center', marginTop: 10, marginBottom: 4 },
  formSheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingTop: 10, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  formSheetHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  formSheetTitle: { color: '#0F172A', fontSize: 16, fontWeight: '800' },
  formSheetScroll: { flexGrow: 0 },
  formSheetContent: { gap: 14, padding: 18, paddingBottom: 36 },

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
