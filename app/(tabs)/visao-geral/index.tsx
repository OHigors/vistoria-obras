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

      {/* TORRES — blue border */}
      <View style={[s.section, s.sectionBlue]}>
        <Text style={[s.sectionTitle, { color: '#1D4ED8' }]}>Torres</Text>
        {loading
          ? [1, 2].map((i) => <Skeleton key={i} height={100} radius={10} />)
          : towers.map((tower) => {
              const apts = apartments.filter((a) => a.towerId === tower.id);
              const avg = apts.length ? Math.round(apts.reduce((t, a) => t + a.progress, 0) / apts.length) : 0;
              const criticalCount = apts.filter((a) => a.status === 'critical').length;
              const attentionCount = apts.filter((a) => a.status === 'attention').length;
              const barColor = criticalCount > 0 ? '#B91C1C' : attentionCount > 0 ? '#D97706' : '#1D4ED8';
              return (
                <Pressable
                  key={tower.id}
                  onPress={() => router.push({ pathname: '/visao-geral/[torreId]', params: { torreId: tower.id } })}
                  style={s.towerCard}>
                  <View style={s.towerTop}>
                    <View style={s.towerIconWrap}>
                      <MaterialCommunityIcons name="office-building" size={20} color="#1D4ED8" />
                    </View>
                    <View style={s.towerInfo}>
                      <Text style={s.towerName}>{tower.name}</Text>
                      <Text style={s.towerMeta}>{tower.block} · {tower.position} · {apts.length} un.</Text>
                    </View>
                    <Text style={[s.towerPct, { color: barColor }]}>{avg}%</Text>
                  </View>
                  <View style={s.towerBar}>
                    <View style={[s.towerBarFill, { width: `${avg}%` as `${number}%`, backgroundColor: barColor }]} />
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

      {/* MEDIÇÕES RECENTES — purple border */}
      <View style={[s.section, s.sectionPurple]}>
        <View style={s.sectionHeaderRow}>
          <Text style={[s.sectionTitle, { color: '#6D28D9' }]}>Medições recentes</Text>
          <Pressable onPress={() => router.push('/cronograma/medicoes' as any)}>
            <Text style={[s.sectionLink, { color: '#6D28D9' }]}>Ver tudo →</Text>
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

      {/* RELATÓRIOS — green border */}
      <View style={[s.section, s.sectionGreen]}>
        <Text style={[s.sectionTitle, { color: '#047857' }]}>Relatórios</Text>
        {[
          { href: '/visao-geral/relatorios/relatorio-geral', icon: 'table-large', label: 'Relatório Geral', desc: 'Tabela completa: apartamentos, pendências, cronograma, medições e visitas.' },
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

  // section containers — border color is the differentiator
  section: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 16, gap: 12, borderWidth: 2 },
  sectionBlue:   { borderColor: '#3B82F6' },
  sectionPurple: { borderColor: '#8B5CF6' },
  sectionGreen:  { borderColor: '#10B981' },

  sectionTitle: { fontSize: 15, fontWeight: '900' },
  sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionLink: { fontSize: 12, fontWeight: '700' },
  spacer: { flex: 1 },

  // tower
  towerCard: { backgroundColor: '#F8FAFC', borderRadius: 12, padding: 12, gap: 8 },
  towerTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  towerIconWrap: { width: 36, height: 36, borderRadius: 10, backgroundColor: '#EFF6FF', alignItems: 'center', justifyContent: 'center' },
  towerInfo: { flex: 1 },
  towerName: { color: '#0F172A', fontSize: 15, fontWeight: '900' },
  towerMeta: { color: '#64748B', fontSize: 12, marginTop: 1 },
  towerPct: { fontSize: 20, fontWeight: '900' },
  towerBar: { backgroundColor: '#E2E8F0', borderRadius: 999, height: 5, overflow: 'hidden' },
  towerBarFill: { height: '100%', borderRadius: 999 },
  towerFooter: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  badgeRed:   { backgroundColor: '#FEE2E2', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  badgeRedText:   { color: '#B91C1C', fontSize: 11, fontWeight: '700' },
  badgeAmber: { backgroundColor: '#FEF3C7', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  badgeAmberText: { color: '#B45309', fontSize: 11, fontWeight: '700' },
  badgeGreen: { backgroundColor: '#D1FAE5', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  badgeGreenText: { color: '#047857', fontSize: 11, fontWeight: '700' },

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
