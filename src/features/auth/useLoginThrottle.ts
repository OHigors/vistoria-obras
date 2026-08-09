// Bloqueio de tentativas na tela de login.
//
// O QUE ISTO É (e o que NÃO é): rate limit de CLIENTE. Não protege contra brute
// force de verdade — um atacante bate direto no endpoint /auth/v1/token, não
// nesta tela. A defesa real é o rate limit por IP do Supabase Auth (servidor),
// configurável no dashboard, cujo erro o app já trata (SignInCode 'rate_limit').
//
// O que ELE entrega: trava tentativas repetidas dentro do app, dá retorno claro
// com contagem regressiva, e poupa requisições contra o limite do servidor.
// Persistido em AsyncStorage — fechar o app não zera o bloqueio.

import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = '@login-throttle';
const FAILS_BEFORE_LOCK = 5;
// Escalada: cada ciclo de bloqueio espera mais que o anterior (30s → 2min → 5min
// → 15min, com teto). Backoff progressivo pune a insistência sem punir o engano.
const LOCK_STEPS_SEC = [30, 120, 300, 900];

type Persisted = { fails: number; locks: number; lockedUntil: number };
const EMPTY: Persisted = { fails: 0, locks: 0, lockedUntil: 0 };

export function useLoginThrottle() {
  const [remaining, setRemaining] = useState(0); // segundos restantes do bloqueio
  const stateRef = useRef<Persisted>({ ...EMPTY });
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const syncRemaining = useCallback(() => {
    const left = Math.max(0, Math.ceil((stateRef.current.lockedUntil - Date.now()) / 1000));
    setRemaining(left);
    return left;
  }, []);

  const persist = useCallback(() => {
    AsyncStorage.setItem(KEY, JSON.stringify(stateRef.current)).catch(() => {});
  }, []);

  // Carrega o estado persistido no mount (um bloqueio pode ter começado antes).
  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(KEY)
      .then((raw) => {
        if (!alive || !raw) return;
        try {
          stateRef.current = { ...EMPTY, ...JSON.parse(raw) };
        } catch {
          // dado corrompido → começa limpo
        }
        syncRemaining();
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [syncRemaining]);

  // Contagem regressiva enquanto houver bloqueio.
  useEffect(() => {
    if (remaining <= 0) {
      if (tickRef.current) {
        clearInterval(tickRef.current);
        tickRef.current = null;
      }
      return;
    }
    if (tickRef.current) return;
    tickRef.current = setInterval(() => {
      const left = syncRemaining();
      if (left <= 0 && tickRef.current) {
        clearInterval(tickRef.current);
        tickRef.current = null;
      }
    }, 1000);
    return () => {
      if (tickRef.current) {
        clearInterval(tickRef.current);
        tickRef.current = null;
      }
    };
  }, [remaining, syncRemaining]);

  // Uma falha de credencial. Ao atingir o limite, arma o bloqueio e escala o
  // próximo. Erros de rede NÃO devem chamar isto (quem chama filtra pelo código).
  const registerFailure = useCallback(() => {
    const st = stateRef.current;
    st.fails += 1;
    if (st.fails >= FAILS_BEFORE_LOCK) {
      const dur = LOCK_STEPS_SEC[Math.min(st.locks, LOCK_STEPS_SEC.length - 1)];
      st.lockedUntil = Date.now() + dur * 1000;
      st.locks += 1;
      st.fails = 0;
    }
    persist();
    syncRemaining();
  }, [persist, syncRemaining]);

  // O servidor mandou esperar (rate limit por IP): respeita, mesmo sem 5 falhas
  // locais — pode haver tentativas de outra origem contra a mesma conta.
  const registerServerLimit = useCallback(() => {
    const st = stateRef.current;
    const dur = LOCK_STEPS_SEC[Math.min(st.locks, LOCK_STEPS_SEC.length - 1)];
    st.lockedUntil = Date.now() + dur * 1000;
    st.locks += 1;
    st.fails = 0;
    persist();
    syncRemaining();
  }, [persist, syncRemaining]);

  // Login bem-sucedido: zera tudo.
  const reset = useCallback(() => {
    stateRef.current = { ...EMPTY };
    persist();
    setRemaining(0);
  }, [persist]);

  return { locked: remaining > 0, remaining, registerFailure, registerServerLimit, reset };
}

// Segundos → "m:ss" para a contagem regressiva.
export const formatCooldown = (sec: number) => {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
};
