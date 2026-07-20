// Provider + hooks do tutorial. Regras centrais:
// - Coach marks só depois do carrossel de boas-vindas ('welcome' concluído).
// - Um módulo ativo por vez; cada módulo dispara UMA vez por tela (persistido).
// - Sair da tela no meio cancela SEM marcar concluído — volta a oferecer depois.
// - Passos com requiresWrite são omitidos para quem não pode escrever; enquanto
//   o papel não resolveu (role === null), módulos com esses passos aguardam.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import type { View } from 'react-native';

import { useObras } from '@/src/data/ObrasContext';
import { ALL_MODULE_IDS, COACH_MODULES, type CoachModuleId, type TutorialModuleId, type TutorialStep } from './steps';
import { getDoneModules, persistModuleDone, persistReset, persistSkipAll } from './storage';

type ActiveModule = { module: CoachModuleId; steps: TutorialStep[]; index: number };

type TutorialContextValue = {
  hydrated: boolean;
  doneModules: Set<TutorialModuleId>;
  welcomeVisible: boolean;
  activeModule: CoachModuleId | null;
  activeSteps: TutorialStep[];
  stepIndex: number;
  /** Sem permissão de escrita — seleciona os textos de visualização. */
  readOnly: boolean;
  role: string | null;
  tryActivate: (id: CoachModuleId) => void;
  cancelModule: (id: CoachModuleId) => void;
  advanceStep: () => void;
  skipActiveModule: () => void;
  closeWelcome: () => void;
  skipAllModules: () => void;
  resetTutorial: () => void;
  registerAnchor: (stepId: string, node: View | null) => void;
  getAnchorNode: (stepId: string) => View | null;
};

const TutorialContext = createContext<TutorialContextValue | null>(null);

export function TutorialProvider({ children }: { children: React.ReactNode }) {
  const { canWrite, role } = useObras();

  // null = ainda não hidratado do AsyncStorage.
  const [done, setDone] = useState<Set<TutorialModuleId> | null>(null);
  const [active, setActive] = useState<ActiveModule | null>(null);
  const anchorNodes = useRef(new Map<string, View>());

  // Espelhos em ref para manter os callbacks estáveis (evita reativar efeitos
  // das telas a cada render do contexto de obras).
  const canWriteRef = useRef(canWrite);
  canWriteRef.current = canWrite;
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    let alive = true;
    getDoneModules().then((set) => {
      if (alive) setDone(set);
    });
    return () => {
      alive = false;
    };
  }, []);

  const hydrated = done !== null;
  const doneModules = useMemo(() => done ?? new Set<TutorialModuleId>(), [done]);
  const welcomeVisible = hydrated && !doneModules.has('welcome');

  const completeModule = useCallback((id: TutorialModuleId) => {
    setDone((cur) => {
      const next = new Set(cur ?? []);
      next.add(id);
      return next;
    });
    persistModuleDone(id);
  }, []);

  const tryActivate = useCallback(
    (id: CoachModuleId) => {
      setActive((cur) => {
        if (cur) return cur; // já existe um módulo em cena
        const steps = COACH_MODULES[id].filter((st) => !st.requiresWrite || canWriteRef.current);
        if (steps.length === 0) return cur;
        return { module: id, steps, index: 0 };
      });
    },
    [],
  );

  const cancelModule = useCallback((id: CoachModuleId) => {
    setActive((cur) => (cur?.module === id ? null : cur));
  }, []);

  const advanceStep = useCallback(() => {
    const cur = activeRef.current;
    if (!cur) return;
    if (cur.index + 1 >= cur.steps.length) {
      completeModule(cur.module);
      setActive(null);
    } else {
      setActive({ ...cur, index: cur.index + 1 });
    }
  }, [completeModule]);

  const skipActiveModule = useCallback(() => {
    const cur = activeRef.current;
    if (!cur) return;
    completeModule(cur.module);
    setActive(null);
  }, [completeModule]);

  // "Começar tour" e o back do Android fecham só o carrossel — os coach marks
  // contextuais continuam liberados. "Pular tudo" é a única saída total.
  const closeWelcome = useCallback(() => completeModule('welcome'), [completeModule]);

  const skipAllModules = useCallback(() => {
    setDone(new Set<TutorialModuleId>(ALL_MODULE_IDS));
    persistSkipAll();
    setActive(null);
  }, []);

  const resetTutorial = useCallback(() => {
    setDone(new Set());
    persistReset();
    setActive(null);
  }, []);

  const registerAnchor = useCallback((stepId: string, node: View | null) => {
    if (node) anchorNodes.current.set(stepId, node);
    else anchorNodes.current.delete(stepId);
  }, []);

  const getAnchorNode = useCallback(
    (stepId: string) => anchorNodes.current.get(stepId) ?? null,
    [],
  );

  const value = useMemo<TutorialContextValue>(
    () => ({
      hydrated,
      doneModules,
      welcomeVisible,
      activeModule: active?.module ?? null,
      activeSteps: active?.steps ?? [],
      stepIndex: active?.index ?? 0,
      readOnly: !canWrite,
      role,
      tryActivate,
      cancelModule,
      advanceStep,
      skipActiveModule,
      closeWelcome,
      skipAllModules,
      resetTutorial,
      registerAnchor,
      getAnchorNode,
    }),
    [
      hydrated,
      doneModules,
      welcomeVisible,
      active,
      canWrite,
      role,
      tryActivate,
      cancelModule,
      advanceStep,
      skipActiveModule,
      closeWelcome,
      skipAllModules,
      resetTutorial,
      registerAnchor,
      getAnchorNode,
    ],
  );

  return <TutorialContext.Provider value={value}>{children}</TutorialContext.Provider>;
}

export function useTutorial() {
  const ctx = useContext(TutorialContext);
  if (!ctx) throw new Error('useTutorial precisa estar dentro de <TutorialProvider>');
  return ctx;
}

/**
 * Registra a tela como um módulo do tutorial. `ready` deve ser o "carregou de
 * verdade" da tela (skeletons encerrados) — o módulo só dispara com a tela
 * focada, pronta, e espera 400 ms para o layout assentar.
 */
export function useTutorialScreen(moduleId: CoachModuleId, ready: boolean) {
  const { hydrated, doneModules, role, tryActivate, cancelModule } = useTutorial();

  useFocusEffect(
    useCallback(() => {
      // Módulos com passos de escrita aguardam o papel resolver: com role nulo o
      // canWrite é otimista (true) e um viewer veria passos de criação.
      const needsRole = COACH_MODULES[moduleId].some((st) => st.requiresWrite) && role === null;
      if (!hydrated || !doneModules.has('welcome') || doneModules.has(moduleId) || !ready || needsRole) {
        return;
      }
      const timer = setTimeout(() => tryActivate(moduleId), 400);
      return () => {
        clearTimeout(timer);
        cancelModule(moduleId);
      };
    }, [moduleId, hydrated, doneModules, role, ready, tryActivate, cancelModule]),
  );
}

/**
 * Âncora de um passo: espalhe o retorno no elemento-alvo
 * (`<View {...anchor}>`). `collapsable: false` garante que o Android não
 * otimize a view e a medição funcione.
 */
export function useTutorialAnchor(stepId: string) {
  const { registerAnchor } = useTutorial();
  const ref = useCallback((node: View | null) => registerAnchor(stepId, node), [registerAnchor, stepId]);
  return useMemo(() => ({ ref, collapsable: false as const }), [ref]);
}
