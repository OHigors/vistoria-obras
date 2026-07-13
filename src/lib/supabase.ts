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

// Obra "ativa" — começa na do .env e é trocada em runtime quando o usuário
// escolhe outra no perfil. É um `let` exportado (live binding): db.ts lê o valor
// atual em cada chamada. Use setActiveObra para trocar.
export let OBRA_ID = process.env.EXPO_PUBLIC_OBRA_ID!;

export function setActiveObra(id: string) {
  OBRA_ID = id;
}

// No nativo, o Supabase recomenda pausar/retomar o refresh do token conforme o
// app entra/sai de foco (evita refresh em background e sessões expiradas).
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}
