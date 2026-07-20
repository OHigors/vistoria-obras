// Persistência do tutorial em AsyncStorage — uma chave versionada por módulo.
// Falha de storage nunca pode derrubar o app: na dúvida, trata como "não visto".

import AsyncStorage from '@react-native-async-storage/async-storage';

import { ALL_MODULE_IDS, TUTORIAL_VERSION, type TutorialModuleId } from './steps';

const keyFor = (id: TutorialModuleId) => `@tutorial:v${TUTORIAL_VERSION}:${id}`;

export const getDoneModules = async (): Promise<Set<TutorialModuleId>> => {
  try {
    const pairs = await AsyncStorage.multiGet(ALL_MODULE_IDS.map(keyFor));
    const done = new Set<TutorialModuleId>();
    for (const [key, value] of pairs) {
      if (value === 'done') done.add(key.slice(key.lastIndexOf(':') + 1) as TutorialModuleId);
    }
    return done;
  } catch {
    return new Set();
  }
};

export const persistModuleDone = (id: TutorialModuleId) => {
  AsyncStorage.setItem(keyFor(id), 'done').catch(() => {});
};

export const persistSkipAll = () => {
  AsyncStorage.multiSet(ALL_MODULE_IDS.map((id) => [keyFor(id), 'done'])).catch(() => {});
};

export const persistReset = () => {
  AsyncStorage.multiRemove(ALL_MODULE_IDS.map(keyFor)).catch(() => {});
};
