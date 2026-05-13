import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';

import { useColorScheme } from '@/hooks/use-color-scheme';

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: '#0F172A' },
          headerTintColor: '#FFFFFF',
          headerTitleStyle: { fontWeight: '700' },
          contentStyle: { backgroundColor: '#F4F7FB' },
        }}>
        <Stack.Screen name="index" options={{ title: 'Residencial Cagliari' }} />
        <Stack.Screen name="torres" options={{ title: 'Selecionar torre' }} />
        <Stack.Screen name="torres/[torreId]" options={{ title: 'Apartamentos' }} />
        <Stack.Screen name="apartamentos/[apartamentoId]" options={{ title: 'Vistoria' }} />
        <Stack.Screen name="medicoes" options={{ title: 'Medições' }} />
        <Stack.Screen name="painel-pendencias" options={{ title: 'Painel de pendências' }} />
        <Stack.Screen name="painel-cronograma" options={{ title: 'Painel de cronograma' }} />
        <Stack.Screen name="painel-medicoes" options={{ title: 'Painel de medições' }} />
        <Stack.Screen name="painel-qualidade" options={{ title: 'Painel de qualidade' }} />
        <Stack.Screen name="relatorio-geral" options={{ title: 'Relatório geral' }} />
        <Stack.Screen name="gerar-relatorio" options={{ title: 'Gerar relatório' }} />
        <Stack.Screen name="servicos-etapas" options={{ title: 'Serviços e etapas' }} />
        <Stack.Screen name="obras" options={{ title: 'Configurar obra' }} />
        <Stack.Screen name="importar-apartamentos" options={{ title: 'Importar apartamentos' }} />
        <Stack.Screen name="diagnostico" options={{ title: 'Diagnóstico do MVP' }} />
      </Stack>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}
