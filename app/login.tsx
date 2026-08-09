import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Image } from 'expo-image';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Text } from '@/src/ui/Text';

import { useAuth } from '@/src/data/AuthContext';
import { formatCooldown, useLoginThrottle } from '@/src/features/auth/useLoginThrottle';

const LOGO = require('@/assets/images/slash.svg');

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const { signIn } = useAuth();
  const { locked, remaining, registerFailure, registerServerLimit, reset } = useLoginThrottle();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = email.trim().length > 0 && password.length > 0 && !submitting && !locked;

  const onSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError('');
    const result = await signIn(email, password);
    if (result.error) {
      // Só falha de credencial conta para o bloqueio; o servidor mandando esperar
      // é respeitado direto. Rede/outros não trancam — não é sinal de brute force.
      if (result.code === 'invalid') registerFailure();
      else if (result.code === 'rate_limit') registerServerLimit();
      setError(result.error);
      setSubmitting(false);
    } else {
      reset();
    }
    // Em caso de sucesso, o RootNavigator troca para (tabs) automaticamente.
  };

  return (
    <View style={s.screen}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={[s.content, { paddingTop: insets.top + 56, paddingBottom: insets.bottom + 24 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <View style={s.brand}>
            <Image source={LOGO} style={s.logo} contentFit="contain" transition={200} />
            <Text style={s.title}>Vistoria de Obras</Text>
            <Text style={s.subtitle}>Entre para acessar as vistorias da obra</Text>
          </View>

          <View style={s.card}>
            <Text style={s.label}>E-mail</Text>
            <View style={s.inputWrap}>
              <MaterialCommunityIcons name="email-outline" size={18} color="#94A3B8" />
              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder="voce@empresa.com"
                placeholderTextColor="#94A3B8"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                autoComplete="email"
                textContentType="emailAddress"
                returnKeyType="next"
                style={s.input}
              />
            </View>

            <Text style={[s.label, { marginTop: 14 }]}>Senha</Text>
            <View style={s.inputWrap}>
              <MaterialCommunityIcons name="lock-outline" size={18} color="#94A3B8" />
              <TextInput
                value={password}
                onChangeText={setPassword}
                placeholder="Sua senha"
                placeholderTextColor="#94A3B8"
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoComplete="password"
                textContentType="password"
                returnKeyType="go"
                onSubmitEditing={onSubmit}
                style={s.input}
              />
              <Pressable onPress={() => setShowPassword((v) => !v)} hitSlop={8}>
                <MaterialCommunityIcons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={18} color="#94A3B8" />
              </Pressable>
            </View>

            {/* Bloqueado tem precedência sobre o erro: enquanto trava, mostra a
                contagem em vez da mensagem de "senha incorreta". */}
            {locked ? (
              <View style={s.lockBox}>
                <MaterialCommunityIcons name="lock-clock" size={15} color="#B45309" />
                <Text style={s.lockText}>
                  Muitas tentativas. Tente novamente em {formatCooldown(remaining)}.
                </Text>
              </View>
            ) : !!error && (
              <View style={s.errorBox}>
                <MaterialCommunityIcons name="alert-circle-outline" size={15} color="#B91C1C" />
                <Text style={s.errorText}>{error}</Text>
              </View>
            )}

            <Pressable onPress={onSubmit} disabled={!canSubmit} style={[s.button, !canSubmit && s.buttonDisabled]}>
              {submitting ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={s.buttonText}>Entrar</Text>
              )}
            </Pressable>
          </View>

          <Text style={s.footnote}>Acesso concedido pelo administrador da obra.</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F8FAFC' },
  content: { flexGrow: 1, paddingHorizontal: 24, justifyContent: 'center' },

  brand: { alignItems: 'center', gap: 6, marginBottom: 26 },
  logo: { width: 168, height: 168, marginBottom: 4 },
  title: { fontSize: 24, fontWeight: '900', color: '#0F172A' },
  subtitle: { fontSize: 13.5, color: '#64748B', textAlign: 'center' },

  card: { backgroundColor: '#FFFFFF', borderRadius: 18, borderWidth: 1, borderColor: '#E2E8F0', padding: 20 },
  label: { fontSize: 12, fontWeight: '800', color: '#334155', marginBottom: 6 },
  inputWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 12, paddingHorizontal: 12,
  },
  input: { flex: 1, paddingVertical: 12, fontSize: 15, color: '#0F172A' },

  errorBox: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#FEF2F2', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, marginTop: 12,
  },
  errorText: { flex: 1, color: '#B91C1C', fontSize: 12.5, fontWeight: '600' },

  lockBox: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#FFFBEB', borderWidth: 1, borderColor: '#FDE68A',
    borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, marginTop: 12,
  },
  lockText: { flex: 1, color: '#92400E', fontSize: 12.5, fontWeight: '700' },

  button: {
    backgroundColor: '#2563EB', borderRadius: 12, paddingVertical: 14,
    alignItems: 'center', justifyContent: 'center', marginTop: 18, minHeight: 50,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },

  footnote: { fontSize: 11.5, color: '#94A3B8', textAlign: 'center', marginTop: 20 },
});
