import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HapticTab } from '@/components/haptic-tab';
import { IconSymbol } from '@/components/ui/icon-symbol';

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const bottomPad = Math.max(insets.bottom, 8);

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: '#2563EB',
        tabBarInactiveTintColor: '#94A3B8',
        headerShown: false,
        tabBarButton: HapticTab,
        tabBarStyle: {
          backgroundColor: '#FFFFFF',
          borderTopColor: '#E2E8F0',
          borderTopWidth: 1,
          paddingBottom: bottomPad,
          height: 56 + bottomPad,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '700',
          marginBottom: 2,
        },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Início',
          tabBarIcon: ({ color }) => <IconSymbol size={24} name="house.fill" color={color} />,
        }}
      />
      <Tabs.Screen
        name="visao-geral"
        options={{
          title: 'Visão Geral',
          tabBarIcon: ({ color }) => <IconSymbol size={24} name="building.2.fill" color={color} />,
        }}
      />
      <Tabs.Screen
        name="cronograma"
        options={{
          title: 'Cronograma',
          tabBarIcon: ({ color }) => <IconSymbol size={24} name="calendar.badge.clock" color={color} />,
        }}
      />
    </Tabs>
  );
}
