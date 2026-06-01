import { useFocusEffect } from '@react-navigation/native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { Text } from '@/src/ui/Text';
import { Skeleton } from '@/src/ui/Skeleton';
import { useToast } from '@/src/ui/Toast';
import * as db from '@/src/data/db';
import type { ServiceCategory } from '@/src/data/serviceCategories';
import type { ServiceUnit } from '@/src/data/serviceUnits';
import type { Worker } from '@/src/data/serviceWorkers';
import { useObras } from '@/src/data/ObrasContext';

const CATEGORY_PALETTE = ['#2563EB', '#7C3AED', '#0891B2', '#16A34A', '#D97706', '#DB2777', '#0EA5E9', '#65A30D', '#B45309', '#9333EA'];
const colorFor = (s: string) => {
  let hash = 0;
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  return CATEGORY_PALETTE[hash % CATEGORY_PALETTE.length];
};

type Tab = 'categorias' | 'unidades' | 'colaboradores';

type Item = { id: string; nome: string };

type DeleteState =
  | { kind: 'idle' }
  | { kind: 'confirm'; item: Item; usage: number; checking: boolean };

export default function CatalogosScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { tab: initialTab } = useLocalSearchParams<{ tab?: string }>();
  const { refreshServiceCategories, refreshServiceUnits, refreshServiceStages } = useObras();

  const [tab, setTab] = useState<Tab>(
    initialTab === 'unidades' ? 'unidades' : initialTab === 'colaboradores' ? 'colaboradores' : 'categorias'
  );

  return (
    <>
      <View style={[s.backBar, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.push('/(tabs)/cronograma/servicos-etapas' as any)} style={s.backBtn}>
          <MaterialCommunityIcons name="chevron-left" size={26} color="#0F172A" />
          <Text style={s.backBtnText}>Serviços e Etapas</Text>
        </Pressable>
      </View>

      <View style={s.toggleWrap}>
        <View style={s.viewToggle}>
          <ToggleBtn
            active={tab === 'categorias'}
            icon="tag-multiple-outline"
            label="Categorias"
            onPress={() => setTab('categorias')}
          />
          <ToggleBtn
            active={tab === 'unidades'}
            icon="ruler"
            label="Unidades"
            onPress={() => setTab('unidades')}
          />
          <ToggleBtn
            active={tab === 'colaboradores'}
            icon="account-hard-hat-outline"
            label="Colaboradores"
            onPress={() => setTab('colaboradores')}
          />
        </View>
      </View>

      {tab === 'categorias' ? (
        <CatalogPanel
          key="cat"
          title="categoria"
          placeholder="Ex.: Estrutura, Acabamento, Instalações…"
          load={db.loadServiceCategories}
          save={(item) => db.saveServiceCategory({ id: item.id, nome: item.nome })}
          rename={(id, oldNome, newNome) => db.renameServiceCategory(id, oldNome, newNome)}
          countUsage={(nome) => db.countStagesUsingCategory(nome)}
          remove={(id) => db.deleteServiceCategory(id)}
          afterMutation={async () => {
            await refreshServiceCategories();
            await refreshServiceStages();
          }}
        />
      ) : tab === 'unidades' ? (
        <CatalogPanel
          key="unit"
          title="unidade"
          placeholder="Ex.: m², kg, un, h…"
          load={db.loadServiceUnits}
          save={(item) => db.saveServiceUnit({ id: item.id, nome: item.nome })}
          rename={(id, oldNome, newNome) => db.renameServiceUnit(id, oldNome, newNome)}
          countUsage={(nome) => db.countStagesUsingUnit(nome)}
          remove={(id) => db.deleteServiceUnit(id)}
          afterMutation={async () => {
            await refreshServiceUnits();
            await refreshServiceStages();
          }}
        />
      ) : (
        <WorkerPanel key="workers" />
      )}
    </>
  );
}

function ToggleBtn({
  active,
  icon,
  label,
  onPress,
}: {
  active: boolean;
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={[s.viewBtn, active && s.viewBtnActive]}>
      <MaterialCommunityIcons name={icon} size={16} color={active ? '#6D28D9' : '#94A3B8'} />
      <Text style={[s.viewBtnText, active && s.viewBtnTextActive]}>{label}</Text>
    </Pressable>
  );
}

function CatalogPanel({
  title,
  placeholder,
  load,
  save,
  rename,
  countUsage,
  remove,
  afterMutation,
}: {
  title: string;
  placeholder: string;
  load: () => Promise<Item[]>;
  save: (item: Item) => Promise<void>;
  rename: (id: string, oldNome: string, newNome: string) => Promise<void>;
  countUsage: (nome: string) => Promise<number>;
  remove: (id: string) => Promise<void>;
  afterMutation: () => Promise<void>;
}) {
  const toast = useToast();
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [draftNome, setDraftNome] = useState('');
  const [editingId, setEditingId] = useState<string | undefined>();
  const [editingOriginalNome, setEditingOriginalNome] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [deleteState, setDeleteState] = useState<DeleteState>({ kind: 'idle' });
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    const data = await load();
    setItems(data.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')));
  }, [load]);

  useFocusEffect(useCallback(() => {
    setLoading(true);
    const started = Date.now();
    const MIN = 300;
    reload().finally(() => {
      const elapsed = Date.now() - started;
      const finish = () => setLoading(false);
      if (elapsed >= MIN) finish();
      else setTimeout(finish, MIN - elapsed);
    });
  }, [reload]));

  const cancelEdit = () => {
    setEditingId(undefined);
    setEditingOriginalNome('');
    setDraftNome('');
    setError(undefined);
  };

  const doSave = async () => {
    const nome = draftNome.trim();
    if (!nome) {
      setError(`Informe o nome da ${title}`);
      return;
    }
    const dup = items.find(
      (c) => c.nome.toLocaleLowerCase('pt-BR') === nome.toLocaleLowerCase('pt-BR') && c.id !== editingId,
    );
    if (dup) {
      setError(`Já existe uma ${title} com este nome`);
      return;
    }
    setBusy(true);
    const wasEditing = !!editingId;
    const cap = title[0].toUpperCase() + title.slice(1);
    toast.saving(wasEditing ? `Atualizando ${title}…` : `Criando ${title}…`);
    try {
      if (editingId) {
        await rename(editingId, editingOriginalNome, nome);
      } else {
        await save({ id: '', nome });
      }
      await reload();
      await afterMutation();
      cancelEdit();
      toast.saved(wasEditing ? `${cap} atualizada` : `${cap} criada`);
    } catch {
      toast.error(wasEditing ? `Erro ao atualizar ${title}` : `Erro ao criar ${title}`);
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (item: Item) => {
    setEditingId(item.id);
    setEditingOriginalNome(item.nome);
    setDraftNome(item.nome);
    setError(undefined);
  };

  const askDelete = async (item: Item) => {
    setDeleteState({ kind: 'confirm', item, usage: 0, checking: true });
    const usage = await countUsage(item.nome);
    setDeleteState({ kind: 'confirm', item, usage, checking: false });
  };

  const confirmDelete = async () => {
    if (deleteState.kind !== 'confirm' || deleteState.usage > 0) return;
    setBusy(true);
    const cap = title[0].toUpperCase() + title.slice(1);
    toast.saving(`Excluindo ${title}…`);
    try {
      await remove(deleteState.item.id);
      await reload();
      await afterMutation();
      setDeleteState({ kind: 'idle' });
      if (editingId === deleteState.item.id) cancelEdit();
      toast.saved(`${cap} excluída`);
    } catch {
      toast.error(`Erro ao excluir ${title}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <ScrollView style={s.scroll} contentContainerStyle={s.container}>
        {/* FORM */}
        <View style={[s.section, s.sectionPurple, editingId && s.sectionEditing]}>
          <View style={s.formHeader}>
            <Text style={[s.sectionTitle, { color: '#6D28D9' }]}>{editingId ? `Editar ${title}` : `Nova ${title}`}</Text>
            {editingId && (
              <View style={s.editingBadge}>
                <MaterialCommunityIcons name="pencil" size={12} color="#6D28D9" />
                <Text style={s.editingBadgeText} numberOfLines={1}>Editando “{editingOriginalNome}”</Text>
              </View>
            )}
          </View>

          <View style={s.fieldGroup}>
            <Text style={[s.fieldLabel, error && s.fieldLabelError]}>
              Nome{error ? ' *' : ''}
            </Text>
            <TextInput
              autoCapitalize="sentences"
              onChangeText={(v) => { setDraftNome(v); if (error) setError(undefined); }}
              placeholder={placeholder}
              placeholderTextColor={error ? '#FCA5A5' : '#94A3B8'}
              style={[s.input, error && s.inputError]}
              value={draftNome}
            />
            {error ? <Text style={s.fieldErrorText}>{error}</Text> : null}
          </View>

          <View style={s.actionRow}>
            <Pressable disabled={busy} onPress={doSave} style={[s.btnPrimary, busy && { opacity: 0.6 }]}>
              <MaterialCommunityIcons name={editingId ? 'content-save' : 'plus'} size={16} color="#FFFFFF" />
              <Text style={s.btnPrimaryText}>{editingId ? 'Salvar edição' : `Criar ${title}`}</Text>
            </Pressable>
            {editingId && (
              <Pressable onPress={cancelEdit} style={s.btnSecondary}>
                <Text style={s.btnSecondaryText}>Cancelar</Text>
              </Pressable>
            )}
          </View>
        </View>

        {/* LIST */}
        <View style={[s.section, s.sectionBlue]}>
          <Text style={[s.sectionTitle, { color: '#1D4ED8' }]}>
            {title[0].toUpperCase() + title.slice(1)}s cadastradas
          </Text>
          {loading ? (
            <View style={s.itemList}>
              <SkeletonRow first />
              <SkeletonRow />
              <SkeletonRow />
            </View>
          ) : items.length === 0 ? (
            <View style={s.emptyWrap}>
              <MaterialCommunityIcons name="tray-remove" size={28} color="#CBD5E1" />
              <Text style={s.emptyText}>Nenhuma {title} cadastrada ainda</Text>
            </View>
          ) : (
            <View style={s.itemList}>
              {items.map((item, idx) => {
                const isEditing = editingId === item.id;
                return (
                  <View key={item.id} style={[s.itemRow, idx === 0 && s.itemRowFirst, isEditing && s.itemRowEditing]}>
                    <View style={[s.itemDot, { backgroundColor: colorFor(item.nome) }]} />
                    <Text style={s.itemName} numberOfLines={1} ellipsizeMode="tail">{item.nome}</Text>
                    <View style={s.itemIconActions}>
                      <Pressable onPress={() => startEdit(item)} style={s.iconBtn} hitSlop={6}>
                        <MaterialCommunityIcons name="pencil-outline" size={16} color="#1D4ED8" />
                      </Pressable>
                      <Pressable onPress={() => askDelete(item)} style={[s.iconBtn, s.iconBtnDanger]} hitSlop={6}>
                        <MaterialCommunityIcons name="trash-can-outline" size={16} color="#B91C1C" />
                      </Pressable>
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </View>
      </ScrollView>

      <Modal animationType="fade" transparent visible={deleteState.kind === 'confirm'} onRequestClose={() => setDeleteState({ kind: 'idle' })}>
        <Pressable style={s.modalBackdrop} onPress={() => setDeleteState({ kind: 'idle' })}>
          <Pressable style={s.modalCard} onPress={() => { /* swallow */ }}>
            <View style={[s.modalIconWrap, deleteState.kind === 'confirm' && deleteState.usage > 0 && { backgroundColor: '#FEF3C7' }]}>
              <MaterialCommunityIcons
                name={deleteState.kind === 'confirm' && deleteState.usage > 0 ? 'alert' : 'trash-can-outline'}
                size={28}
                color={deleteState.kind === 'confirm' && deleteState.usage > 0 ? '#B45309' : '#B91C1C'}
              />
            </View>
            {deleteState.kind === 'confirm' && (
              <>
                <Text style={s.modalTitle}>
                  {deleteState.checking
                    ? 'Verificando uso…'
                    : deleteState.usage > 0
                      ? `${title[0].toUpperCase() + title.slice(1)} em uso`
                      : `Excluir ${title}?`}
                </Text>
                <Text style={s.modalBody}>
                  {deleteState.checking
                    ? `Verificando se "${deleteState.item.nome}" está sendo usada por alguma etapa.`
                    : deleteState.usage > 0
                      ? `"${deleteState.item.nome}" está vinculada a ${deleteState.usage} etapa${deleteState.usage === 1 ? '' : 's'}. Renomeie ou remova essas etapas antes de excluir.`
                      : `A ${title} "${deleteState.item.nome}" será removida permanentemente.`}
                </Text>
                <View style={s.modalActions}>
                  <Pressable onPress={() => setDeleteState({ kind: 'idle' })} style={s.modalCancel}>
                    <Text style={s.modalCancelText}>{deleteState.usage > 0 ? 'Fechar' : 'Cancelar'}</Text>
                  </Pressable>
                  {!deleteState.checking && deleteState.usage === 0 && (
                    <Pressable disabled={busy} onPress={confirmDelete} style={[s.modalConfirm, busy && { opacity: 0.6 }]}>
                      <MaterialCommunityIcons name="trash-can-outline" size={16} color="#FFFFFF" />
                      <Text style={s.modalConfirmText}>Excluir</Text>
                    </Pressable>
                  )}
                </View>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

function WorkerPanel() {
  const toast = useToast();
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [loading, setLoading] = useState(true);
  const [draftNome, setDraftNome] = useState('');
  const [draftFuncao, setDraftFuncao] = useState('');
  const [editingId, setEditingId] = useState<string | undefined>();
  const [editingOriginalNome, setEditingOriginalNome] = useState('');
  const [errors, setErrors] = useState<{ nome?: string; funcao?: string }>({});
  const [deleteTarget, setDeleteTarget] = useState<Worker | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    const data = await db.loadWorkers();
    setWorkers(data.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')));
  }, []);

  useFocusEffect(useCallback(() => {
    setLoading(true);
    const started = Date.now();
    reload().finally(() => {
      const elapsed = Date.now() - started;
      const finish = () => setLoading(false);
      if (elapsed >= 300) finish();
      else setTimeout(finish, 300 - elapsed);
    });
  }, [reload]));

  const cancelEdit = () => {
    setEditingId(undefined);
    setEditingOriginalNome('');
    setDraftNome('');
    setDraftFuncao('');
    setErrors({});
  };

  const doSave = async () => {
    const nome = draftNome.trim();
    const funcao = draftFuncao.trim();
    const nextErrors: typeof errors = {};
    if (!nome) nextErrors.nome = 'Informe o nome do colaborador';
    if (!funcao) nextErrors.funcao = 'Informe a função';
    if (Object.keys(nextErrors).length) { setErrors(nextErrors); return; }

    setBusy(true);
    toast.saving(editingId ? 'Atualizando colaborador…' : 'Criando colaborador…');
    try {
      await db.saveWorker({ id: editingId ?? '', nome, funcao });
      await reload();
      cancelEdit();
      toast.saved(editingId ? 'Colaborador atualizado' : 'Colaborador criado');
    } catch {
      toast.error(editingId ? 'Erro ao atualizar colaborador' : 'Erro ao criar colaborador');
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (w: Worker) => {
    setEditingId(w.id);
    setEditingOriginalNome(w.nome);
    setDraftNome(w.nome);
    setDraftFuncao(w.funcao);
    setErrors({});
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    toast.saving('Excluindo colaborador…');
    try {
      await db.deleteWorker(deleteTarget.id);
      await reload();
      if (editingId === deleteTarget.id) cancelEdit();
      setDeleteTarget(null);
      toast.saved('Colaborador excluído');
    } catch {
      toast.error('Erro ao excluir colaborador');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <ScrollView style={s.scroll} contentContainerStyle={s.container}>
        <View style={[s.section, s.sectionPurple, editingId !== undefined && s.sectionEditing]}>
          <View style={s.formHeader}>
            <Text style={[s.sectionTitle, { color: '#6D28D9' }]}>
              {editingId !== undefined ? 'Editar colaborador' : 'Novo colaborador'}
            </Text>
            {editingId !== undefined && (
              <View style={s.editingBadge}>
                <MaterialCommunityIcons name="pencil" size={12} color="#6D28D9" />
                <Text style={s.editingBadgeText} numberOfLines={1}>Editando "{editingOriginalNome}"</Text>
              </View>
            )}
          </View>

          <View style={s.fieldGroup}>
            <Text style={[s.fieldLabel, errors.nome && s.fieldLabelError]}>Nome{errors.nome ? ' *' : ''}</Text>
            <TextInput
              autoCapitalize="words"
              onChangeText={(v) => { setDraftNome(v); if (errors.nome) setErrors((e) => ({ ...e, nome: undefined })); }}
              placeholder="Nome do colaborador"
              placeholderTextColor={errors.nome ? '#FCA5A5' : '#94A3B8'}
              style={[s.input, errors.nome && s.inputError]}
              value={draftNome}
            />
            {errors.nome ? <Text style={s.fieldErrorText}>{errors.nome}</Text> : null}
          </View>

          <View style={s.fieldGroup}>
            <Text style={[s.fieldLabel, errors.funcao && s.fieldLabelError]}>Função{errors.funcao ? ' *' : ''}</Text>
            <TextInput
              autoCapitalize="sentences"
              onChangeText={(v) => { setDraftFuncao(v); if (errors.funcao) setErrors((e) => ({ ...e, funcao: undefined })); }}
              placeholder="Ex.: Pedreiro, Azulejista, Eletricista…"
              placeholderTextColor={errors.funcao ? '#FCA5A5' : '#94A3B8'}
              style={[s.input, errors.funcao && s.inputError]}
              value={draftFuncao}
            />
            {errors.funcao ? <Text style={s.fieldErrorText}>{errors.funcao}</Text> : null}
          </View>

          <View style={s.actionRow}>
            <Pressable disabled={busy} onPress={doSave} style={[s.btnPrimary, busy && { opacity: 0.6 }]}>
              <MaterialCommunityIcons name={editingId !== undefined ? 'content-save' : 'plus'} size={16} color="#FFFFFF" />
              <Text style={s.btnPrimaryText}>{editingId !== undefined ? 'Salvar edição' : 'Criar colaborador'}</Text>
            </Pressable>
            {editingId !== undefined && (
              <Pressable onPress={cancelEdit} style={s.btnSecondary}>
                <Text style={s.btnSecondaryText}>Cancelar</Text>
              </Pressable>
            )}
          </View>
        </View>

        <View style={[s.section, s.sectionBlue]}>
          <Text style={[s.sectionTitle, { color: '#1D4ED8' }]}>Colaboradores cadastrados</Text>
          {loading ? (
            <View style={s.itemList}>
              <WorkerSkeletonRow first />
              <WorkerSkeletonRow />
              <WorkerSkeletonRow />
            </View>
          ) : workers.length === 0 ? (
            <View style={s.emptyWrap}>
              <MaterialCommunityIcons name="account-off-outline" size={28} color="#CBD5E1" />
              <Text style={s.emptyText}>Nenhum colaborador cadastrado ainda</Text>
            </View>
          ) : (
            <View style={s.itemList}>
              {workers.map((w, idx) => {
                const isEditing = editingId === w.id;
                return (
                  <View key={w.id} style={[s.itemRow, idx === 0 && s.itemRowFirst, isEditing && s.itemRowEditing]}>
                    <View style={[s.workerAvatar, { backgroundColor: colorFor(w.nome) }]}>
                      <Text style={s.workerAvatarText}>{w.nome.charAt(0).toUpperCase()}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.itemName} numberOfLines={1}>{w.nome}</Text>
                      <Text style={s.workerFuncao} numberOfLines={1}>{w.funcao}</Text>
                    </View>
                    <View style={s.itemIconActions}>
                      <Pressable onPress={() => startEdit(w)} style={s.iconBtn} hitSlop={6}>
                        <MaterialCommunityIcons name="pencil-outline" size={16} color="#1D4ED8" />
                      </Pressable>
                      <Pressable onPress={() => setDeleteTarget(w)} style={[s.iconBtn, s.iconBtnDanger]} hitSlop={6}>
                        <MaterialCommunityIcons name="trash-can-outline" size={16} color="#B91C1C" />
                      </Pressable>
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </View>
      </ScrollView>

      <Modal animationType="fade" transparent visible={!!deleteTarget} onRequestClose={() => setDeleteTarget(null)}>
        <Pressable style={s.modalBackdrop} onPress={() => setDeleteTarget(null)}>
          <Pressable style={s.modalCard} onPress={() => {}}>
            <View style={s.modalIconWrap}>
              <MaterialCommunityIcons name="account-remove-outline" size={28} color="#B91C1C" />
            </View>
            {deleteTarget && (
              <>
                <Text style={s.modalTitle}>Excluir colaborador?</Text>
                <Text style={s.modalBody}>
                  "{deleteTarget.nome}" será removido permanentemente. Atribuições existentes serão desvinculadas.
                </Text>
                <View style={s.modalActions}>
                  <Pressable onPress={() => setDeleteTarget(null)} style={s.modalCancel}>
                    <Text style={s.modalCancelText}>Cancelar</Text>
                  </Pressable>
                  <Pressable disabled={busy} onPress={confirmDelete} style={[s.modalConfirm, busy && { opacity: 0.6 }]}>
                    <MaterialCommunityIcons name="trash-can-outline" size={16} color="#FFFFFF" />
                    <Text style={s.modalConfirmText}>Excluir</Text>
                  </Pressable>
                </View>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

function WorkerSkeletonRow({ first }: { first?: boolean }) {
  return (
    <View style={[s.itemRow, first && s.itemRowFirst]}>
      <Skeleton width={32} height={32} radius={16} />
      <View style={{ flex: 1, gap: 4 }}>
        <Skeleton height={12} width="50%" radius={4} />
        <Skeleton height={10} width="30%" radius={4} />
      </View>
      <Skeleton width={28} height={28} radius={8} />
      <Skeleton width={28} height={28} radius={8} />
    </View>
  );
}

function SkeletonRow({ first }: { first?: boolean }) {
  return (
    <View style={[s.itemRow, first && s.itemRowFirst]}>
      <Skeleton width={10} height={10} radius={5} />
      <View style={{ flex: 1 }}>
        <Skeleton height={12} width="55%" radius={4} />
      </View>
      <Skeleton width={28} height={28} radius={8} />
      <Skeleton width={28} height={28} radius={8} />
    </View>
  );
}

const s = StyleSheet.create({
  backBar: { paddingHorizontal: 8, paddingBottom: 4, backgroundColor: '#F8FAFC' },
  backBtn: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 2, paddingVertical: 6, paddingHorizontal: 4 },
  backBtnText: { color: '#0F172A', fontSize: 15, fontWeight: '600' },

  // Segmented control — mirrors the Lista/Mapa toggle on app/(tabs)/visao-geral/[torreId].tsx
  toggleWrap: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 8, backgroundColor: '#F8FAFC' },
  viewToggle: { flexDirection: 'row', backgroundColor: '#F1F5F9', borderRadius: 12, padding: 3, gap: 3 },
  viewBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 10 },
  viewBtnActive: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E2E8F0' },
  viewBtnText: { color: '#94A3B8', fontSize: 13, fontWeight: '700' },
  viewBtnTextActive: { color: '#6D28D9' },

  scroll: { backgroundColor: '#F8FAFC' },
  container: { gap: 12, padding: 16, paddingBottom: 40 },

  section: { backgroundColor: '#FFFFFF', borderRadius: 14, borderWidth: 1, padding: 14, gap: 12 },
  sectionPurple: { borderColor: '#8B5CF6' },
  sectionBlue: { borderColor: '#3B82F6' },
  sectionEditing: { backgroundColor: '#FAF5FF' },
  sectionTitle: { fontSize: 15, fontWeight: '900' },

  formHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' },
  editingBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#EDE9FE', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, maxWidth: '100%' },
  editingBadgeText: { color: '#6D28D9', fontSize: 11, fontWeight: '800', flexShrink: 1 },

  fieldGroup: { gap: 6 },
  fieldLabel: { color: '#475569', fontSize: 12, fontWeight: '700' },
  fieldLabelError: { color: '#B91C1C' },
  input: { backgroundColor: '#F8FAFC', borderColor: '#CBD5E1', borderRadius: 10, borderWidth: 1, color: '#0F172A', fontSize: 14, minHeight: 42, paddingHorizontal: 12 },
  inputError: { borderColor: '#F87171', backgroundColor: '#FEF2F2' },
  fieldErrorText: { color: '#B91C1C', fontSize: 11, fontWeight: '700' },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },

  // Compact single-row item: dot + name + icon buttons, separated by hairlines for density.
  itemList: { borderRadius: 10, borderWidth: 1, borderColor: '#E2E8F0', overflow: 'hidden', backgroundColor: '#FFFFFF' },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#E2E8F0', backgroundColor: '#FFFFFF' },
  itemRowFirst: { borderTopWidth: 0 },
  itemRowEditing: { backgroundColor: '#FAF5FF' },
  itemDot: { width: 8, height: 8, borderRadius: 4 },
  itemName: { flex: 1, color: '#0F172A', fontSize: 13, fontWeight: '700' },
  itemIconActions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  iconBtn: { width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#EFF6FF' },
  iconBtnDanger: { backgroundColor: '#FEE2E2' },

  emptyWrap: { alignItems: 'center', justifyContent: 'center', paddingVertical: 24, gap: 8 },
  emptyText: { color: '#94A3B8', fontSize: 12, fontStyle: 'italic' },
  workerAvatar: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  workerAvatarText: { color: '#FFFFFF', fontSize: 13, fontWeight: '900' },
  workerFuncao: { color: '#64748B', fontSize: 11, fontWeight: '600', marginTop: 1 },

  btnPrimary: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#6D28D9', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10 },
  btnPrimaryText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  btnSecondary: { flexDirection: 'row', alignItems: 'center', gap: 5, borderColor: '#CBD5E1', borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 9 },
  btnSecondaryText: { color: '#1D4ED8', fontSize: 12, fontWeight: '700' },
  btnDelete: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#B91C1C', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9 },
  btnDeleteText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },

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
