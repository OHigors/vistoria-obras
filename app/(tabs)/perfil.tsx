import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Text } from '@/src/ui/Text';

import { useAuth } from '@/src/data/AuthContext';
import { useObras } from '@/src/data/ObrasContext';
import * as db from '@/src/data/db';

const HEADER = '#334155';

export default function PerfilScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, signOut } = useAuth();
  const { myObras, activeObraId, profile, switchObra, refreshProfile } = useObras();

  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [switchingId, setSwitchingId] = useState<string | null>(null);

  const displayName = profile?.name?.trim() || user?.email?.split('@')[0] || 'Usuário';
  const email = profile?.email || user?.email || '';
  const initial = displayName.charAt(0).toUpperCase();

  const startEdit = () => {
    setNameDraft(profile?.name ?? '');
    setEditing(true);
  };

  const saveName = async () => {
    const name = nameDraft.trim();
    if (!name) return;
    setSavingName(true);
    try {
      await db.updateProfileName(name);
      await refreshProfile();
      setEditing(false);
    } catch {
      // silencioso — mantém a tela; o usuário pode tentar de novo
    } finally {
      setSavingName(false);
    }
  };

  const onPickObra = async (id: string) => {
    if (id === activeObraId) {
      router.back();
      return;
    }
    setSwitchingId(id);
    await switchObra(id);
    setSwitchingId(null);
    router.back();
  };

  return (
    <View style={s.screen}>
      {/* ── Header ── */}
      <View style={[s.header, { paddingTop: insets.top + 12 }]}>
        <Pressable onPress={() => router.back()} style={s.headerBack}>
          <MaterialCommunityIcons name="chevron-left" size={26} color="rgba(255,255,255,0.9)" />
          <Text style={s.headerBackText}>Início</Text>
        </Pressable>
        <View style={s.headerRow}>
          <View style={s.avatar}>
            <Text style={s.avatarText}>{initial}</Text>
          </View>
          <View style={s.headerInfo}>
            {editing ? (
              <View style={s.nameEditRow}>
                <TextInput
                  value={nameDraft}
                  onChangeText={setNameDraft}
                  placeholder="Seu nome"
                  placeholderTextColor="rgba(255,255,255,0.5)"
                  style={s.nameInput}
                  autoFocus
                  onSubmitEditing={saveName}
                  returnKeyType="done"
                />
                <Pressable onPress={saveName} disabled={savingName || !nameDraft.trim()} hitSlop={8} style={s.nameSaveBtn}>
                  {savingName ? <ActivityIndicator color="#FFFFFF" size="small" /> : <MaterialCommunityIcons name="check" size={20} color="#FFFFFF" />}
                </Pressable>
                <Pressable onPress={() => setEditing(false)} hitSlop={8}>
                  <MaterialCommunityIcons name="close" size={20} color="rgba(255,255,255,0.7)" />
                </Pressable>
              </View>
            ) : (
              <Pressable onPress={startEdit} style={s.nameRow} hitSlop={6}>
                <Text style={s.name}>{displayName}</Text>
                <MaterialCommunityIcons name="pencil-outline" size={15} color="rgba(255,255,255,0.7)" />
              </Pressable>
            )}
            <Text style={s.email} numberOfLines={1}>{email}</Text>
          </View>
        </View>
      </View>

      <ScrollView contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 24 }]} showsVerticalScrollIndicator={false}>
        {/* ── Minhas obras ── */}
        <View style={s.sectionHeader}>
          <Text style={s.sectionTitle}>Minhas obras</Text>
          <Text style={s.sectionCount}>{myObras.length}</Text>
        </View>

        {myObras.length === 0 ? (
          <View style={[s.card, s.cardCentered]}>
            <MaterialCommunityIcons name="office-building-outline" size={30} color="#CBD5E1" />
            <Text style={s.emptyText}>Nenhuma obra atribuída ao seu usuário.</Text>
            <Text style={s.emptySub}>Peça a um administrador para liberar o acesso.</Text>
          </View>
        ) : (
          myObras.map((o) => {
            const active = o.id === activeObraId;
            return (
              <Pressable key={o.id} onPress={() => onPickObra(o.id)} style={[s.obraCard, active && s.obraCardActive]}>
                <View style={[s.obraIcon, active && s.obraIconActive]}>
                  <MaterialCommunityIcons name="office-building" size={20} color={active ? '#FFFFFF' : '#64748B'} />
                </View>
                <View style={s.obraInfo}>
                  <Text style={s.obraName}>{o.name}</Text>
                  {!!o.summary && <Text style={s.obraSummary} numberOfLines={1}>{o.summary}</Text>}
                  <View style={s.roleBadge}>
                    <Text style={s.roleBadgeText}>{o.role}</Text>
                  </View>
                </View>
                {switchingId === o.id ? (
                  <ActivityIndicator color="#2563EB" />
                ) : active ? (
                  <View style={s.activePill}>
                    <MaterialCommunityIcons name="check" size={13} color="#FFFFFF" />
                    <Text style={s.activePillText}>Ativa</Text>
                  </View>
                ) : (
                  <MaterialCommunityIcons name="chevron-right" size={20} color="#CBD5E1" />
                )}
              </Pressable>
            );
          })
        )}

        {/* ── Sair ── */}
        <Pressable onPress={() => signOut()} style={s.logoutBtn}>
          <MaterialCommunityIcons name="logout-variant" size={18} color="#B91C1C" />
          <Text style={s.logoutText}>Sair da conta</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F8FAFC' },

  header: { backgroundColor: HEADER, paddingHorizontal: 16, paddingBottom: 18, gap: 12 },
  headerBack: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', marginLeft: -4, gap: 2 },
  headerBackText: { color: 'rgba(255,255,255,0.9)', fontSize: 15, fontWeight: '600' },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatar: { width: 58, height: 58, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.18)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)', alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#FFFFFF', fontSize: 26, fontWeight: '900' },
  headerInfo: { flex: 1, gap: 2 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { color: '#FFFFFF', fontSize: 20, fontWeight: '900' },
  nameEditRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  nameInput: { flex: 1, color: '#FFFFFF', fontSize: 19, fontWeight: '800', borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.4)', paddingVertical: 2 },
  nameSaveBtn: { padding: 2 },
  email: { color: 'rgba(255,255,255,0.75)', fontSize: 13, fontWeight: '600' },

  scroll: { padding: 16, gap: 10 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4, marginBottom: 2 },
  sectionTitle: { fontSize: 13, fontWeight: '900', color: '#334155', textTransform: 'uppercase', letterSpacing: 0.5 },
  sectionCount: { fontSize: 12, fontWeight: '800', color: '#94A3B8' },

  card: { backgroundColor: '#FFFFFF', borderRadius: 14, borderWidth: 1, borderColor: '#E2E8F0', padding: 14 },
  cardCentered: { alignItems: 'center', gap: 6, paddingVertical: 24 },
  emptyText: { fontSize: 13, fontWeight: '700', color: '#475569', textAlign: 'center' },
  emptySub: { fontSize: 12, color: '#94A3B8', textAlign: 'center' },

  obraCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#FFFFFF', borderRadius: 14, borderWidth: 1, borderColor: '#E2E8F0', padding: 12 },
  obraCardActive: { borderColor: '#2563EB', backgroundColor: '#EFF6FF' },
  obraIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#F1F5F9', alignItems: 'center', justifyContent: 'center' },
  obraIconActive: { backgroundColor: '#2563EB' },
  obraInfo: { flex: 1, gap: 3 },
  obraName: { fontSize: 15, fontWeight: '800', color: '#0F172A' },
  obraSummary: { fontSize: 12, color: '#64748B' },
  roleBadge: { alignSelf: 'flex-start', backgroundColor: '#F1F5F9', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2, marginTop: 1 },
  roleBadgeText: { fontSize: 10, fontWeight: '800', color: '#64748B', textTransform: 'uppercase' },
  activePill: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#2563EB', borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 },
  activePillText: { color: '#FFFFFF', fontSize: 10.5, fontWeight: '800' },

  logoutBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#FFFFFF', borderRadius: 14, borderWidth: 1, borderColor: '#FECACA', paddingVertical: 14, marginTop: 16 },
  logoutText: { color: '#B91C1C', fontSize: 14, fontWeight: '800' },
});
