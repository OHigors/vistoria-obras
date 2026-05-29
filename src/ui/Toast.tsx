import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { Text } from '@/src/ui/Text';

export type ToastStatus = 'saving' | 'saved' | 'error';

type ToastState = { id: number; status: ToastStatus; message: string };

type ToastContextValue = {
  show: (status: ToastStatus, message?: string) => void;
  saving: (message?: string) => void;
  saved: (message?: string) => void;
  error: (message?: string) => void;
};

const DEFAULTS: Record<ToastStatus, string> = {
  saving: 'Salvando…',
  saved: 'Salvo',
  error: 'Erro ao salvar',
};

const ToastContext = createContext<ToastContextValue>({
  show: () => {},
  saving: () => {},
  saved: () => {},
  error: () => {},
});

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<ToastState | undefined>();
  const counterRef = useRef(0);
  const anim = useRef(new Animated.Value(0)).current;
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((status: ToastStatus, message?: string) => {
    counterRef.current += 1;
    setState({ id: counterRef.current, status, message: message ?? DEFAULTS[status] });
    Animated.timing(anim, { toValue: 1, duration: 180, useNativeDriver: true }).start();
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    if (status !== 'saving') {
      hideTimerRef.current = setTimeout(() => {
        Animated.timing(anim, { toValue: 0, duration: 220, useNativeDriver: true }).start(() => setState(undefined));
      }, 1600);
    }
  }, [anim]);

  const saving = useCallback((m?: string) => show('saving', m), [show]);
  const saved = useCallback((m?: string) => show('saved', m), [show]);
  const error = useCallback((m?: string) => show('error', m), [show]);

  return (
    <ToastContext.Provider value={{ show, saving, saved, error }}>
      <View style={{ flex: 1 }}>
        {children}
        {state && <ToastView state={state} anim={anim} />}
      </View>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

function ToastView({ state, anim }: { state: ToastState; anim: Animated.Value }) {
  const insets = useSafeAreaInsets();
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        s.toast,
        { bottom: insets.bottom + 80 },
        state.status === 'saved' && s.toastSaved,
        state.status === 'error' && s.toastError,
        {
          opacity: anim,
          transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }],
        },
      ]}>
      <MaterialCommunityIcons
        name={state.status === 'saving' ? 'cloud-upload-outline' : state.status === 'saved' ? 'cloud-check' : 'cloud-alert'}
        size={16}
        color="#FFFFFF"
      />
      <Text style={s.text}>{state.message}</Text>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  toast: {
    position: 'absolute', left: 24, right: 24,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 10, paddingHorizontal: 18, borderRadius: 999,
    backgroundColor: '#0F172A',
    shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 4,
    zIndex: 9999,
  },
  toastSaved: { backgroundColor: '#047857' },
  toastError: { backgroundColor: '#B91C1C' },
  text: { color: '#FFFFFF', fontSize: 13, fontWeight: '800', letterSpacing: 0.2 },
});
