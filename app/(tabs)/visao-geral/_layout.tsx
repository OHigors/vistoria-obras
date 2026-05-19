import { Stack } from 'expo-router';

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
      <Stack.Screen name="[torreId]" options={{ title: 'Apartamentos' }} />
      <Stack.Screen
        name="apartamentos/[apartamentoId]"
        options={{
          headerTransparent: true,
          headerBlurEffect: 'none',
          headerStyle: { backgroundColor: 'transparent' },
          headerShadowVisible: false,
          headerTitle: '',
          headerTintColor: '#FFFFFF',
          headerBackTitle: '',
        }}
      />
      <Stack.Screen name="relatorios/relatorio-geral" options={{ title: 'Relatório Geral' }} />
      <Stack.Screen name="relatorios/gerar-relatorio" options={{ title: 'Gerar Relatório' }} />
    </Stack>
  );
}
