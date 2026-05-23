import { Stack, useRouter } from 'expo-router';
import { Pressable } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

function BackBtn({ href }: { href: string }) {
  const router = useRouter();
  return (
    <Pressable onPress={() => router.push(href as any)} style={{ paddingLeft: 4, paddingRight: 12, paddingVertical: 4 }}>
      <MaterialCommunityIcons name="chevron-left" size={28} color="#0F172A" />
    </Pressable>
  );
}

export default function VisaoGeralLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerStyle: { backgroundColor: '#FFFFFF' },
        headerTintColor: '#0F172A',
        headerTitleStyle: { fontWeight: '800', fontSize: 17 },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: '#F8FAFC' },
      }}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="[torreId]" options={{ headerShown: false }} />
      <Stack.Screen name="apartamentos/[apartamentoId]" options={{ headerShown: false }} />
      <Stack.Screen name="relatorios/relatorio-geral" options={{ headerShown: false }} />
      <Stack.Screen name="relatorios/gerar-relatorio" options={{ headerShown: false }} />
    </Stack>
  );
}
