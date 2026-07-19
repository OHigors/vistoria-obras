import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { Text } from '@/src/ui/Text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { formatCurrency } from '@/src/data/localMeasurements';
import { useObras } from '@/src/data/ObrasContext';
import { Skeleton } from '@/src/ui/Skeleton';

export default function VisaoGeralScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { apartments, towers, measurements, loading } = useObras();

  return (
    <ScrollView
      style={s.scroll}
      contentContainerStyle={[s.container, { paddingTop: insets.top + 16 }]}
      showsVerticalScrollIndicator={false}>

      {/* TORRES */}
      <View style={s.section}>
        <Text style={s.sectionTitle}>Torres</Text>
        {loading
          ? [1, 2].map((i) => <Skeleton key={i} height={100} radius={10} />)
          : towers.map((tower) => {
              const apts = apartments.filter((a) => a.towerId === tower.id);
              const avg = apts.length ? Math.round(apts.reduce((t, a) => t + a.progress, 0) / apts.length) : 0;
              const criticalCount = apts.filter((a) => a.status === 'critical').length;
              const attentionCount = apts.filter((a) => a.status === 'attention').length;
              return (
                <Pressable
                  key={tower.id}
                  onPress={() => router.push({ pathname: '/visao-geral/corte/[torreId]', params: { torreId: tower.id } })}
                  style={s.towerCard}>
                  <View style={s.towerTop}>
                    <View style={s.towerIconWrap}>
                      <MaterialCommunityIcons name="office-building" size={20} color="#1D4ED8" />
                    </View>
                    <View style={s.towerInfo}>
                      <Text style={s.towerName}>{tower.name}</Text>
                      <Text style={s.towerMeta}>{tower.block} · {tower.position} · {apts.length} un.</Text>
                    </View>
                    <Text style={s.towerPct}>{avg}%</Text>
                  </View>
                  <View style={s.towerBar}>
                    <View style={[s.towerBarFill, { width: `${avg}%` as `${number}%` }]} />
                  </View>
                  <View style={s.towerFooter}>
                    {criticalCount > 0 && <View style={s.badgeRed}><Text style={s.badgeRedText}>{criticalCount} crítico(s)</Text></View>}
                    {attentionCount > 0 && <View style={s.badgeAmber}><Text style={s.badgeAmberText}>{attentionCount} atenção</Text></View>}
                    {criticalCount === 0 && attentionCount === 0 && <View style={s.badgeGreen}><Text style={s.badgeGreenText}>Sem alertas</Text></View>}
                    <View style={s.spacer} />
                    <MaterialCommunityIcons name="chevron-right" size={16} color="#94A3B8" />
                  </View>
                </Pressable>
              );
            })}
      </View>

      {/* FERRAMENTAS — vindas da aba Cronograma, que agora é só o cronograma */}
      {[
        { href: '/cronograma/servicos-etapas', icon: 'cog-outline', label: 'Serviços e Etapas', desc: 'Configure checklist, cronograma e medições', color: '#6D28D9', bg: '#F5F3FF' },
        { href: '/cronograma/medicoes', icon: 'ruler', label: 'Medições', desc: 'Registros financeiros por serviço', color: '#047857', bg: '#F0FDF4' },
      ].map((item) => (
        <Pressable
          key={item.href}
          onPress={() => router.push(item.href as any)}
          accessibilityRole="button"
          accessibilityLabel={`Abrir ${item.label}`}
          style={({ pressed }) => [s.toolCard, pressed && s.toolCardPressed]}>
          <View style={[s.toolIcon, { backgroundColor: item.bg }]}>
            <MaterialCommunityIcons name={item.icon as any} size={20} color={item.color} />
          </View>
          <View style={s.toolContent}>
            <Text style={[s.toolLabel, { color: item.color }]}>{item.label}</Text>
            <Text style={s.toolDesc}>{item.desc}</Text>
          </View>
          <MaterialCommunityIcons name="chevron-right" size={18} color="#94A3B8" />
        </Pressable>
      ))}

      {/* MEDIÇÕES RECENTES */}
      <View style={s.section}>
        <View style={s.sectionHeaderRow}>
          <Text style={s.sectionTitle}>Medições recentes</Text>
          <Pressable onPress={() => router.push('/cronograma/medicoes' as any)}>
            <Text style={s.sectionLink}>Ver tudo →</Text>
          </Pressable>
        </View>
        {loading ? (
          <>
            {[1, 2, 3].map((i) => (
              <View key={i} style={s.activityRow}>
                <Skeleton width={34} height={34} radius={8} />
                <View style={{ flex: 1, gap: 6 }}>
                  <Skeleton height={13} width="70%" radius={6} />
                  <Skeleton height={11} width="45%" radius={6} />
                </View>
              </View>
            ))}
          </>
        ) : measurements.slice(0, 4).length > 0 ? (
          measurements.slice(0, 4).map((m, idx) => (
            <View key={m.id} style={[s.activityRow, idx > 0 && s.activityBorder]}>
              <View style={s.activityIcon}>
                <MaterialCommunityIcons name="file-check" size={16} color="#6D28D9" />
              </View>
              <View style={s.activityContent}>
                <Text style={s.activityTitle} numberOfLines={1}>{m.service}</Text>
                <Text style={s.activityMeta}>{m.contractor} · {formatCurrency(m.totalValue)}</Text>
              </View>
              <Text style={s.activityStatus}>{m.status}</Text>
            </View>
          ))
        ) : (
          <View style={s.emptyBox}>
            <MaterialCommunityIcons name="file-document-outline" size={28} color="#CBD5E1" />
            <Text style={s.emptyText}>Nenhuma medição registrada</Text>
          </View>
        )}
      </View>

      {/* RELATÓRIOS */}
      <View style={s.section}>
        <Text style={s.sectionTitle}>Relatórios</Text>
        {[
          { href: '/visao-geral/relatorios/relatorio-geral', icon: 'table-large', label: 'Relatório Geral', desc: 'Tabela completa: apartamentos, itens em aberto, cronograma, medições e visitas.' },
          { href: '/visao-geral/relatorios/gerar-relatorio', icon: 'file-export-outline', label: 'Gerar Relatório', desc: 'Escolha tipo, filtros e seções. Exporte em CSV ou PDF.' },
        ].map((r, i) => (
          <Pressable key={r.href} onPress={() => router.push(r.href as any)} style={[s.reportCard, i > 0 && s.activityBorder]}>
            <View style={s.reportIconWrap}>
              <MaterialCommunityIcons name={r.icon as any} size={22} color="#047857" />
            </View>
            <View style={s.reportContent}>
              <Text style={s.reportTitle}>{r.label}</Text>
              <Text style={s.reportDesc}>{r.desc}</Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={18} color="#94A3B8" />
          </Pressable>
        ))}
      </View>

    </ScrollView>
  );
}

const s = StyleSheet.create({
  scroll: { backgroundColor: '#F8FAFC' },
  container: { paddingBottom: 40, gap: 12, paddingHorizontal: 16 },

  // section containers — neutral border
  section: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 16, gap: 12, borderWidth: 1, borderColor: '#E2E8F0' },

  sectionTitle: { fontSize: 15, fontWeight: '900', color: '#0F172A' },
  sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionLink: { fontSize: 12, fontWeight: '700', color: '#64748B' },
  spacer: { flex: 1 },

  // tower
  towerCard: { backgroundColor: '#F8FAFC', borderRadius: 12, padding: 12, gap: 8 },
  towerTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  towerIconWrap: { width: 36, height: 36, borderRadius: 10, backgroundColor: '#EFF6FF', alignItems: 'center', justifyContent: 'center' },
  towerInfo: { flex: 1 },
  towerName: { color: '#0F172A', fontSize: 15, fontWeight: '900' },
  towerMeta: { color: '#64748B', fontSize: 12, marginTop: 1 },
  towerPct: { fontSize: 20, fontWeight: '900', color: '#334155' },
  towerBar: { backgroundColor: '#E2E8F0', borderRadius: 999, height: 5, overflow: 'hidden' },
  towerBarFill: { height: '100%', borderRadius: 999, backgroundColor: '#475569' },
  towerFooter: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  badgeRed:   { backgroundColor: '#F1F5F9', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  badgeRedText:   { color: '#475569', fontSize: 11, fontWeight: '700' },
  badgeAmber: { backgroundColor: '#F1F5F9', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  badgeAmberText: { color: '#475569', fontSize: 11, fontWeight: '700' },
  badgeGreen: { backgroundColor: '#F1F5F9', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  badgeGreenText: { color: '#475569', fontSize: 11, fontWeight: '700' },

  // tools (Serviços e Etapas · Medições)
  toolCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  toolCardPressed: { backgroundColor: '#F8FAFC' },
  toolIcon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  toolContent: { flex: 1, gap: 2 },
  toolLabel: { fontSize: 14, fontWeight: '800' },
  toolDesc: { color: '#64748B', fontSize: 12 },

  // activity
  activityRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
  activityBorder: { borderTopWidth: 1, borderTopColor: '#F1F5F9', paddingTop: 12 },
  activityIcon: { width: 34, height: 34, borderRadius: 8, backgroundColor: '#EDE9FE', alignItems: 'center', justifyContent: 'center' },
  activityContent: { flex: 1, gap: 2 },
  activityTitle: { color: '#0F172A', fontSize: 13, fontWeight: '700' },
  activityMeta: { color: '#64748B', fontSize: 12 },
  activityStatus: { color: '#94A3B8', fontSize: 11, fontWeight: '600', maxWidth: 80, textAlign: 'right' },
  emptyBox: { padding: 16, alignItems: 'center', gap: 8 },
  emptyText: { color: '#94A3B8', fontSize: 13 },

  // reports
  reportCard: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
  reportIconWrap: { width: 40, height: 40, borderRadius: 10, backgroundColor: '#ECFDF5', alignItems: 'center', justifyContent: 'center' },
  reportContent: { flex: 1, gap: 2 },
  reportTitle: { color: '#0F172A', fontSize: 14, fontWeight: '800' },
  reportDesc: { color: '#64748B', fontSize: 12, lineHeight: 17 },
});
