import React from 'react';
import { Text as RNText, TextProps, StyleSheet } from 'react-native';

const WEIGHT_MAP: Record<string, string> = {
  '100': 'Inter_100Thin',
  '200': 'Inter_200ExtraLight',
  '300': 'Inter_300Light',
  '400': 'Inter_400Regular',
  '500': 'Inter_500Medium',
  '600': 'Inter_600SemiBold',
  '700': 'Inter_700Bold',
  '800': 'Inter_800ExtraBold',
  '900': 'Inter_900Black',
  normal: 'Inter_400Regular',
  bold: 'Inter_700Bold',
};

export function Text({ style, ...props }: TextProps) {
  const flat = StyleSheet.flatten(style) ?? {};
  const weight = String(flat.fontWeight ?? '400');
  const fontFamily = WEIGHT_MAP[weight] ?? 'Inter_400Regular';
  return <RNText style={[{ fontFamily }, flat, { fontWeight: undefined }]} {...props} />;
}
