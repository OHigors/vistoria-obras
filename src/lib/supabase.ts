import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

export const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL!,
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
  {
    auth: {
      // Web usa o storage padrão (localStorage); nativo persiste via AsyncStorage.
      storage: Platform.OS === 'web' ? undefined : AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      // Só faz sentido para redirect de OAuth/magic-link (não usamos).
      detectSessionInUrl: false,
    },
  },
);

export const OBRA_ID = process.env.EXPO_PUBLIC_OBRA_ID!;

// No nativo, o Supabase recomenda pausar/retomar o refresh do token conforme o
// app entra/sai de foco (evita refresh em background e sessões expiradas).
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}
