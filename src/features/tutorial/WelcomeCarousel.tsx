// Carrossel de boas-vindas — aparece uma única vez, no primeiro uso após o
// login. Orientação conceitual em 4 slides; os coach marks contextuais ficam
// por conta de cada tela. "Pular tudo" é a única saída que desliga o tutorial
// inteiro; o back do Android fecha só o carrossel (menos destrutivo).

import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { Text } from '@/src/ui/Text';
import { WELCOME_SLIDES } from './steps';
import { useTutorial } from './TutorialContext';

export function WelcomeCarousel() {
  const { welcomeVisible, closeWelcome, skipAllModules, readOnly } = useTutorial();
  const { width: winW } = useWindowDimensions();
  const [page, setPage] = useState(0);
  const scrollRef = useRef<ScrollView>(null);

  const cardW = Math.min(winW - 40, 360);
  const isLast = page === WELCOME_SLIDES.length - 1;

  // Reaberto (ex.: "Rever tutorial")? Volta ao primeiro slide.
  useEffect(() => {
    if (welcomeVisible) setPage(0);
  }, [welcomeVisible]);

  const goTo = (next: number) => {
    setPage(next);
    scrollRef.current?.scrollTo({ x: next * cardW, animated: true });
  };

  return (
    <Modal
      visible={welcomeVisible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onShow={() => scrollRef.current?.scrollTo({ x: 0, animated: false })}
      onRequestClose={closeWelcome}>
      <View style={s.backdrop}>
        <View style={[s.card, { width: cardW }]}>
          <View style={s.topRow}>
            {!isLast ? (
              <Pressable
                onPress={skipAllModules}
                accessibilityRole="button"
                accessibilityLabel="Pular os tutoriais de todas as telas"
                hitSlop={8}
                style={s.topSkip}>
                <Text style={s.topSkipText}>Pular tutorial</Text>
              </Pressable>
            ) : (
              <View style={s.topSkip} />
            )}
          </View>

          <ScrollView
            ref={scrollRef}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            style={{ width: cardW }}
            onMomentumScrollEnd={(e) =>
              setPage(Math.max(0, Math.min(WELCOME_SLIDES.length - 1, Math.round(e.nativeEvent.contentOffset.x / cardW))))
            }>
            {WELCOME_SLIDES.map((slide) => (
              <View key={slide.title} style={[s.slide, { width: cardW }]}>
                <View style={s.iconWrap}>
                  <MaterialCommunityIcons name={slide.icon as never} size={44} color="#2563EB" />
                </View>
                <Text style={s.title}>{slide.title}</Text>
                <Text style={s.text}>{readOnly && slide.textViewer ? slide.textViewer : slide.text}</Text>
              </View>
            ))}
          </ScrollView>

          {/* Mesma trilha segmentada dos coach marks: o tutorial inteiro fala
              a mesma língua visual. */}
          <View style={s.rail}>
            {WELCOME_SLIDES.map((slide, i) => (
              <View key={slide.title} style={[s.railSeg, i <= page && s.railSegOn]} />
            ))}
          </View>

          <View style={s.footer}>
            {isLast ? (
              <>
                <Pressable
                  onPress={closeWelcome}
                  accessibilityRole="button"
                  accessibilityLabel="Começar o tour pelas telas"
                  style={({ pressed }) => [s.primaryBtn, pressed && s.primaryBtnPressed]}>
                  <Text style={s.primaryText}>Começar tour</Text>
                </Pressable>
                <Pressable
                  onPress={skipAllModules}
                  accessibilityRole="button"
                  accessibilityLabel="Pular os tutoriais de todas as telas"
                  hitSlop={8}
                  style={s.ghostBtn}>
                  <Text style={s.ghostText}>Pular tutorial</Text>
                </Pressable>
              </>
            ) : (
              <Pressable
                onPress={() => goTo(page + 1)}
                accessibilityRole="button"
                accessibilityLabel="Próximo slide"
                style={({ pressed }) => [s.primaryBtn, pressed && s.primaryBtnPressed]}>
                <Text style={s.primaryText}>Avançar</Text>
              </Pressable>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    overflow: 'hidden',
    paddingBottom: 20,
  },

  topRow: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 16, paddingTop: 14 },
  topSkip: { paddingVertical: 4, paddingHorizontal: 4, minHeight: 24 },
  topSkipText: { color: '#94A3B8', fontSize: 12.5, fontWeight: '700' },

  slide: { paddingHorizontal: 24, paddingVertical: 16, alignItems: 'center', gap: 12 },
  iconWrap: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { color: '#0F172A', fontSize: 21, fontWeight: '900', textAlign: 'center', letterSpacing: -0.3 },
  text: { color: '#475569', fontSize: 14, lineHeight: 22, textAlign: 'center' },

  rail: { flexDirection: 'row', gap: 3, marginHorizontal: 24, marginTop: 6, marginBottom: 16 },
  railSeg: { flex: 1, height: 3, borderRadius: 2, backgroundColor: '#E2E8F0' },
  railSegOn: { backgroundColor: '#2563EB' },

  footer: { paddingHorizontal: 24, gap: 8 },
  primaryBtn: {
    backgroundColor: '#2563EB',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  primaryBtnPressed: { backgroundColor: '#1D4ED8' },
  primaryText: { color: '#FFFFFF', fontSize: 14.5, fontWeight: '800' },
  ghostBtn: { alignItems: 'center', paddingVertical: 10, minHeight: 44, justifyContent: 'center' },
  ghostText: { color: '#64748B', fontSize: 13, fontWeight: '700' },
});
