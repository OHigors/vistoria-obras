// Overlay dos coach marks.
//
// O recorte é UM único View: a área escura é feita com as BORDAS dele (topo,
// esquerda, direita e base), e o miolo transparente é o elemento em foco. A
// versão anterior usava quatro retângulos translúcidos encostados — como
// measureInWindow devolve frações de pixel, sobravam folgas de sub-pixel entre
// eles e apareciam fios claros atravessando a tela até o elemento. Com uma
// superfície só, não existe emenda para vazar.
//
// O destaque é um visor de marcas de corte (cantos em L), vocabulário da
// prancha técnica que a tela de Corte já usa — em vez de um anel brilhante.

import { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, BackHandler, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { Text } from '@/src/ui/Text';
import { MODULE_LABELS } from './steps';
import { useTutorial } from './TutorialContext';

type Rect = { x: number; y: number; width: number; height: number };

const SCRIM = 'rgba(15, 23, 42, 0.74)';
const HOLE_PAD = 8;
const BALLOON_GAP = 14;
// Espaço mínimo para o balão caber acima/abaixo do alvo sem espremer o texto.
const BALLOON_SPACE = 210;

export function CoachMarkOverlay() {
  const {
    activeModule,
    activeSteps,
    stepIndex,
    advanceStep,
    skipActiveModule,
    skipAllModules,
    getAnchorNode,
    readOnly,
  } = useTutorial();
  const step = activeModule ? activeSteps[stepIndex] : null;

  const win = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const rootRef = useRef<View>(null);
  const [rootSize, setRootSize] = useState({ w: win.width, h: win.height });
  const [rect, setRect] = useState<Rect | null>(null);
  const [measured, setMeasured] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [skipOpen, setSkipOpen] = useState(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then(setReduceMotion)
      .catch(() => {});
  }, []);

  // Mede a âncora do passo ativo. O scrim bloqueia qualquer interação, então a
  // posição não muda durante o passo — medir uma vez (com retry curto) basta.
  useEffect(() => {
    if (!step) return;
    setRect(null);
    setMeasured(false);
    setSkipOpen(false);
    const node = getAnchorNode(step.id);
    if (!node) {
      setMeasured(true); // sem âncora registrada → card central, sem espera
      return;
    }
    let cancelled = false;
    let tries = 0;
    const attempt = () => {
      if (cancelled) return;
      tries += 1;
      node.measureInWindow((x, y, w, h) => {
        if (cancelled) return;
        const finish = (originX: number, originY: number) => {
          if (cancelled) return;
          if (w > 0 && h > 0) {
            setRect({ x: x - originX, y: y - originY, width: w, height: h });
            setMeasured(true);
          } else if (tries < 5) {
            setTimeout(attempt, 150);
          } else {
            setMeasured(true);
          }
        };
        // Converte para o referencial do overlay (medindo o próprio root),
        // para não depender de como a plataforma trata a barra de status.
        const root = rootRef.current;
        if (root) root.measureInWindow((ox, oy) => finish(ox, oy));
        else finish(0, 0);
      });
    };
    attempt();
    return () => {
      cancelled = true;
    };
  }, [step, getAnchorNode]);

  // Leitores de tela: anuncia o conteúdo a cada passo.
  useEffect(() => {
    if (!step) return;
    const text = readOnly && step.textViewer ? step.textViewer : step.text;
    AccessibilityInfo.announceForAccessibility(`${step.title}. ${text}`);
  }, [step, readOnly]);

  // Back do Android: fecha a escolha de pular, ou abre-a — nunca sai calado.
  useEffect(() => {
    if (!step) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setSkipOpen((cur) => !cur);
      return true;
    });
    return () => sub.remove();
  }, [step]);

  // Entrada do balão a cada passo + respiro sutil nas marcas de canto.
  const enter = useSharedValue(0);
  const pulse = useSharedValue(1);
  useEffect(() => {
    if (!step) return;
    enter.value = 0;
    enter.value = withTiming(1, { duration: 220, easing: Easing.out(Easing.cubic) });
  }, [step, measured, enter]);
  useEffect(() => {
    if (reduceMotion) {
      pulse.value = 1;
      return;
    }
    pulse.value = withRepeat(
      withSequence(
        withTiming(0.45, { duration: 900, easing: Easing.inOut(Easing.ease) }),
        withTiming(1, { duration: 900, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
      false,
    );
  }, [reduceMotion, pulse]);

  const enterStyle = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ translateY: (1 - enter.value) * 10 }],
  }));
  const pulseStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

  const W = rootSize.w;
  const H = rootSize.h;

  // Retângulo do recorte, já em pixels inteiros e preso à tela: as bordas do
  // scrim são calculadas a partir dele e não podem ficar negativas.
  const hole = useMemo(() => {
    if (!rect) return null;
    const outOfView =
      rect.x + rect.width <= 0 || rect.x >= W || rect.y + rect.height <= 0 || rect.y >= H;
    if (outOfView) return null;
    const x = Math.max(0, Math.round(rect.x - HOLE_PAD));
    const y = Math.max(0, Math.round(rect.y - HOLE_PAD));
    const w = Math.min(Math.round(rect.width + HOLE_PAD * 2), W - x);
    const h = Math.min(Math.round(rect.height + HOLE_PAD * 2), H - y);
    if (w <= 0 || h <= 0) return null;
    return { x, y, w, h };
  }, [rect, W, H]);

  if (!step) return null;

  // Alvo ocupando quase toda a tela não é destaque — vira card central.
  const spotlight = hole && hole.h <= H * 0.62 ? hole : null;

  const text = readOnly && step.textViewer
    ? step.textViewer
    : !spotlight && step.textFallback
      ? step.textFallback
      : step.text;
  const isLast = stepIndex + 1 >= activeSteps.length;

  const spaceBelow = spotlight ? H - (spotlight.y + spotlight.h) - insets.bottom - BALLOON_GAP : 0;
  const spaceAbove = spotlight ? spotlight.y - insets.top - BALLOON_GAP : 0;
  const placement = !spotlight
    ? 'center'
    : spaceBelow >= BALLOON_SPACE
      ? 'below'
      : spaceAbove >= BALLOON_SPACE
        ? 'above'
        : 'center';

  const balloonPos =
    placement === 'below'
      ? { top: spotlight!.y + spotlight!.h + BALLOON_GAP }
      : placement === 'above'
        ? { bottom: H - spotlight!.y + BALLOON_GAP }
        : { top: 0, bottom: 0, justifyContent: 'center' as const };

  // Braço das marcas de canto proporcional ao alvo: num alvo pequeno, marcas
  // grandes viram moldura e engolem o elemento.
  const arm = spotlight ? Math.max(12, Math.min(24, Math.min(spotlight.w, spotlight.h) * 0.32)) : 0;

  return (
    <View
      ref={rootRef}
      collapsable={false}
      style={s.root}
      onLayout={(e) => setRootSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
      accessibilityViewIsModal>
      {/* Base que captura TODO toque — nada vaza para a tela, nem pelo recorte. */}
      <Pressable style={StyleSheet.absoluteFill} onPress={() => {}} accessible={false} />

      {measured && spotlight ? (
        <>
          {/* Uma superfície só: as bordas formam a área escura, o miolo é o alvo. */}
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: W,
              height: H,
              borderColor: SCRIM,
              borderTopWidth: spotlight.y,
              borderLeftWidth: spotlight.x,
              borderRightWidth: W - spotlight.x - spotlight.w,
              borderBottomWidth: H - spotlight.y - spotlight.h,
            }}
          />
          <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, pulseStyle]}>
            <View style={[s.bracket, s.bracketTL, { top: spotlight.y, left: spotlight.x, width: arm, height: arm }]} />
            <View style={[s.bracket, s.bracketTR, { top: spotlight.y, left: spotlight.x + spotlight.w - arm, width: arm, height: arm }]} />
            <View style={[s.bracket, s.bracketBL, { top: spotlight.y + spotlight.h - arm, left: spotlight.x, width: arm, height: arm }]} />
            <View style={[s.bracket, s.bracketBR, { top: spotlight.y + spotlight.h - arm, left: spotlight.x + spotlight.w - arm, width: arm, height: arm }]} />
          </Animated.View>
        </>
      ) : (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: SCRIM }]} />
      )}

      {measured && (
        <Animated.View style={[s.balloonWrap, balloonPos, enterStyle]} pointerEvents="box-none">
          <View style={s.balloon}>
            {skipOpen ? (
              <>
                <Text style={s.title}>Pular tutorial</Text>
                <Text style={s.text}>
                  Você pode rever o tutorial quando quiser em Perfil › Rever tutorial.
                </Text>
                <View style={s.skipActions}>
                  <Pressable
                    onPress={skipActiveModule}
                    accessibilityRole="button"
                    accessibilityLabel={`Pular o tutorial da tela ${MODULE_LABELS[activeModule!]}`}
                    style={({ pressed }) => [s.choiceBtn, pressed && s.choiceBtnPressed]}>
                    <Text style={s.choiceText}>Pular só esta tela</Text>
                  </Pressable>
                  <Pressable
                    onPress={skipAllModules}
                    accessibilityRole="button"
                    accessibilityLabel="Pular os tutoriais de todas as telas"
                    style={({ pressed }) => [s.choiceBtnStrong, pressed && s.choiceBtnStrongPressed]}>
                    <Text style={s.choiceTextStrong}>Pular todos os tutoriais</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setSkipOpen(false)}
                    accessibilityRole="button"
                    accessibilityLabel="Voltar ao tutorial"
                    style={s.backBtn}>
                    <Text style={s.backText}>Voltar ao tour</Text>
                  </Pressable>
                </View>
              </>
            ) : (
              <>
                <Text style={s.eyebrow}>{MODULE_LABELS[activeModule!]}</Text>
                {/* Trilha segmentada: ecoa as faixas empilhadas do corte. */}
                <View style={s.rail}>
                  {activeSteps.map((st, i) => (
                    <View key={st.id} style={[s.railSeg, i <= stepIndex && s.railSegOn]} />
                  ))}
                </View>
                <Text style={s.title}>{step.title}</Text>
                <Text style={s.text}>{text}</Text>
                <View style={s.footer}>
                  <Pressable
                    onPress={() => setSkipOpen(true)}
                    accessibilityRole="button"
                    accessibilityLabel="Opções para pular o tutorial"
                    hitSlop={8}
                    style={s.skipBtn}>
                    <Text style={s.skipText}>Pular</Text>
                  </Pressable>
                  <Pressable
                    onPress={advanceStep}
                    accessibilityRole="button"
                    accessibilityLabel={isLast ? 'Concluir tutorial desta tela' : 'Ir para o próximo passo'}
                    style={({ pressed }) => [s.nextBtn, pressed && s.nextBtnPressed]}>
                    <Text style={s.nextText}>{isLast ? 'Concluir' : 'Avançar'}</Text>
                  </Pressable>
                </View>
              </>
            )}
          </View>
        </Animated.View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { ...StyleSheet.absoluteFillObject, zIndex: 1000 },

  // marcas de canto (visor) — vocabulário da prancha técnica do Corte
  bracket: { position: 'absolute', borderColor: '#FFFFFF' },
  bracketTL: { borderTopWidth: 2, borderLeftWidth: 2, borderTopLeftRadius: 5 },
  bracketTR: { borderTopWidth: 2, borderRightWidth: 2, borderTopRightRadius: 5 },
  bracketBL: { borderBottomWidth: 2, borderLeftWidth: 2, borderBottomLeftRadius: 5 },
  bracketBR: { borderBottomWidth: 2, borderRightWidth: 2, borderBottomRightRadius: 5 },

  balloonWrap: { position: 'absolute', left: 16, right: 16, alignItems: 'center' },
  balloon: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    paddingVertical: 18,
    paddingHorizontal: 18,
    gap: 8,
    shadowColor: '#0F172A',
    shadowOpacity: 0.3,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
  },

  eyebrow: {
    color: '#94A3B8',
    fontSize: 10.5,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  rail: { flexDirection: 'row', gap: 3, marginBottom: 2 },
  railSeg: { flex: 1, height: 3, borderRadius: 2, backgroundColor: '#E2E8F0' },
  railSegOn: { backgroundColor: '#2563EB' },

  title: { color: '#0F172A', fontSize: 17, fontWeight: '900', letterSpacing: -0.2 },
  text: { color: '#475569', fontSize: 14, lineHeight: 21 },

  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 },
  skipBtn: { paddingVertical: 11, paddingHorizontal: 4, minHeight: 44, justifyContent: 'center' },
  skipText: { color: '#64748B', fontSize: 13.5, fontWeight: '700' },
  nextBtn: {
    backgroundColor: '#2563EB',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 22,
    minHeight: 44,
    justifyContent: 'center',
  },
  nextBtnPressed: { backgroundColor: '#1D4ED8' },
  nextText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },

  // escolha de pular — empilhada, cada opção com alvo de toque cheio
  skipActions: { gap: 8, marginTop: 8 },
  choiceBtn: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingVertical: 13,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  choiceBtnPressed: { backgroundColor: '#F8FAFC' },
  choiceText: { color: '#334155', fontSize: 14, fontWeight: '800' },
  choiceBtnStrong: {
    backgroundColor: '#334155',
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  choiceBtnStrongPressed: { backgroundColor: '#1E293B' },
  choiceTextStrong: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  backBtn: { alignItems: 'center', paddingVertical: 10, minHeight: 44, justifyContent: 'center' },
  backText: { color: '#64748B', fontSize: 13, fontWeight: '700' },
});
