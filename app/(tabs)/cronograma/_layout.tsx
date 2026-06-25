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
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="obra" options={{ headerShown: false }} />
      <Stack.Screen name="diagnostico" options={{ headerShown: false }} />
      <Stack.Screen name="servicos-etapas" options={{ headerShown: false }} />
      <Stack.Screen name="catalogos" options={{ headerShown: false }} />
      <Stack.Screen name="medicoes" options={{ headerShown: false }} />
    </Stack>
  );
}
