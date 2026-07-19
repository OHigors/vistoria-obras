import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { Text } from '@/src/ui/Text';

// Faixa "somente leitura" exibida quando o papel do usuário (viewer) não pode
// editar. A segurança real é do banco (RLS por papel); isto é UX + defesa extra.
export function ReadOnlyBanner({ style }: { style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[s.banner, style]}>
      <MaterialCommunityIcons name="eye-outline" size={16} color="#B45309" />
      <Text style={s.text}>
        Modo somente leitura — seu perfil não pode editar esta obra.
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FEF3C7',
    borderColor: '#FDE68A',
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginHorizontal: 12,
    marginTop: 10,
  },
  text: { flex: 1, color: '#B45309', fontSize: 12, fontWeight: '700' },
});
