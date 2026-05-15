import { Stack } from 'expo-router';

export default function CronogramaLayout() {
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
      <Stack.Screen name="index" options={{ title: 'Cronograma' }} />
      <Stack.Screen name="diagnostico" options={{ title: 'Diagnóstico do MVP' }} />
      <Stack.Screen name="servicos-etapas" options={{ title: 'Serviços e Etapas' }} />
      <Stack.Screen name="medicoes" options={{ title: 'Medições' }} />
    </Stack>
  );
}
