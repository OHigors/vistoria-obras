import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';

import { supabase } from '@/src/lib/supabase';

// `code` classifica a falha para quem chama decidir o que fazer — em especial, o
// bloqueio da tela de login só deve contar falha de CREDENCIAL ('invalid'), não
// erro de rede (senão uma internet ruim trancaria o usuário legítimo).
export type SignInCode = 'invalid' | 'unconfirmed' | 'rate_limit' | 'network' | 'other';
export type SignInResult = { error: string | null; code: SignInCode | null };

type AuthContextValue = {
  session: Session | null;
  user: User | null;
  loading: boolean; // true enquanto a sessão inicial está sendo restaurada
  signIn: (email: string, password: string) => Promise<SignInResult>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    // Restaura a sessão persistida (AsyncStorage / localStorage) na inicialização.
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setLoading(false);
    });
    // Mantém o estado em dia (login, logout, refresh de token, expiração).
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string): Promise<SignInResult> => {
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (!error) return { error: null, code: null };
    return mapAuthError(error.message);
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ session, user: session?.user ?? null, loading, signIn, signOut }),
    [session, loading, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth deve ser usado dentro de <AuthProvider>');
  return ctx;
}

// Mensagens amigáveis em PT + código da falha para os erros de auth mais comuns.
function mapAuthError(message: string): SignInResult {
  const m = message.toLowerCase();
  if (m.includes('invalid login credentials')) return { error: 'E-mail ou senha incorretos.', code: 'invalid' };
  if (m.includes('email not confirmed')) return { error: 'E-mail ainda não confirmado.', code: 'unconfirmed' };
  if (m.includes('rate limit') || m.includes('too many')) return { error: 'Muitas tentativas. Aguarde um momento e tente de novo.', code: 'rate_limit' };
  if (m.includes('network') || m.includes('fetch')) return { error: 'Sem conexão. Verifique a internet e tente de novo.', code: 'network' };
  return { error: 'Não foi possível entrar. Tente novamente.', code: 'other' };
}
