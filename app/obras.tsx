import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  createProjectId,
  deleteProjectLocalData,
  getActiveProjectId,
  getLocalProjects,
  resetProjectOperationalData,
  saveLocalProjects,
  setActiveProjectId,
} from '@/src/data/localProjects';
import type { LocalProject } from '@/src/data/localProjects';

const emptyDraft = {
  nome: '',
  endereco: '',
  construtora: '',
  responsavel: '',
  dataInicio: '',
  observacao: '',
};

const maskDateBr = (value: string) => {
  const digits = value.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
};

const isValidDateBr = (value: string) => {
  if (!value) return true;
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return false;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(year, month - 1, day);

  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
};

export default function ProjectsScreen() {
  const [projects, setProjects] = useState<LocalProject[]>([]);
  const [activeProjectId, setActiveProjectIdState] = useState('');
  const [draft, setDraft] = useState(emptyDraft);
  const [feedback, setFeedback] = useState('');

  const reload = useCallback(() => {
    setProjects(getLocalProjects());
    setActiveProjectIdState(getActiveProjectId());
  }, []);

  useFocusEffect(reload);

  const createProject = () => {
    if (!draft.nome.trim()) {
      setFeedback('Informe o nome da obra.');
      return;
    }

    if (!isValidDateBr(draft.dataInicio)) {
      setFeedback('Data inválida. Use DD/MM/AAAA, exemplo: 06/02/2023.');
      return;
    }

    const newProject: LocalProject = {
      id: createProjectId(draft.nome),
      nome: draft.nome.trim(),
      endereco: draft.endereco.trim(),
      construtora: draft.construtora.trim(),
      responsavel: draft.responsavel.trim(),
      dataInicio: draft.dataInicio.trim(),
      observacao: draft.observacao.trim(),
      createdAt: new Date().toISOString(),
      active: true,
    };
    const nextProjects = [...projects.map((project) => ({ ...project, active: false })), newProject];

    saveLocalProjects(nextProjects);
    setActiveProjectId(newProject.id);
    setDraft(emptyDraft);
    setFeedback('Nova obra criada e definida como obra ativa.');
    reload();
  };

  const activateProject = (projectId: string) => {
    setActiveProjectId(projectId);
    setFeedback('Obra ativa alterada.');
    reload();
  };

  const resetProject = (project: LocalProject) => {
    const confirmed =
      typeof window !== 'undefined' &&
      window.confirm(
        `Reiniciar dados da obra "${project.nome}"? Vistorias, fotos, visitas, medições, cronograma, pendências e relatórios gerados serão limpos. Obra, torres, apartamentos, etapas e subetapas serão mantidos.`,
      );

    if (!confirmed) return;

    resetProjectOperationalData(project.id);
    setFeedback('Dados operacionais da obra reiniciados.');
  };

  const deleteProject = (project: LocalProject) => {
    const confirmed =
      typeof window !== 'undefined' &&
      window.confirm(
        'Esta ação apagará os dados locais desta obra neste navegador.',
      );

    if (!confirmed) return;

    const typedName =
      typeof window !== 'undefined'
        ? window.prompt(`Digite o nome da obra para confirmar: ${project.nome}`)
        : '';

    if (typedName !== project.nome) {
      setFeedback('Exclusão cancelada. O nome digitado não confere.');
      return;
    }

    deleteProjectLocalData(project.id);
    setFeedback('Obra excluída deste navegador.');
    reload();
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Configurar obra</Text>
        <Text style={styles.subtitle}>
          Crie uma nova obra, altere a obra ativa ou reinicie os dados locais de teste.
        </Text>
      </View>

      <View style={styles.panel}>
        <Text style={styles.sectionTitle}>Nova obra</Text>
        <View style={styles.formGrid}>
          <Field label="Nome da obra" value={draft.nome} onChangeText={(nome) => setDraft((current) => ({ ...current, nome }))} />
          <Field label="Endereço, opcional" value={draft.endereco} onChangeText={(endereco) => setDraft((current) => ({ ...current, endereco }))} />
          <Field label="Construtora, opcional" value={draft.construtora} onChangeText={(construtora) => setDraft((current) => ({ ...current, construtora }))} />
          <Field label="Responsável, opcional" value={draft.responsavel} onChangeText={(responsavel) => setDraft((current) => ({ ...current, responsavel }))} />
          <Field label="Data de início, opcional" value={draft.dataInicio} onChangeText={(dataInicio) => setDraft((current) => ({ ...current, dataInicio: maskDateBr(dataInicio) }))} />
        </View>
        <TextInput
          multiline
          onChangeText={(observacao) => setDraft((current) => ({ ...current, observacao }))}
          placeholder="Observação"
          placeholderTextColor="#94A3B8"
          style={styles.textArea}
          value={draft.observacao}
        />
        <Pressable onPress={createProject} style={styles.primaryButton}>
          <Text style={styles.primaryButtonText}>Nova obra</Text>
        </Pressable>
        {feedback ? <Text style={styles.feedback}>{feedback}</Text> : null}
      </View>

      <View style={styles.panel}>
        <Text style={styles.sectionTitle}>Obras cadastradas</Text>
        {projects.map((project) => {
          const isActive = project.id === activeProjectId;

          return (
            <View key={project.id} style={[styles.projectCard, isActive && styles.activeCard]}>
              <View style={styles.projectHeader}>
                <View style={styles.projectTitleGroup}>
                  <Text style={styles.projectName}>{project.nome}</Text>
                  <Text style={styles.projectMeta}>{project.endereco || 'Endereço não informado'}</Text>
                  <Text style={styles.projectMeta}>Responsável: {project.responsavel || 'não informado'}</Text>
                </View>
                <Text style={[styles.badge, isActive ? styles.activeBadge : styles.neutralBadge]}>
                  {isActive ? 'Obra ativa' : 'Inativa'}
                </Text>
              </View>

              {project.observacao ? <Text style={styles.projectMeta}>{project.observacao}</Text> : null}

              <View style={styles.actions}>
                {!isActive ? (
                  <Pressable onPress={() => activateProject(project.id)} style={styles.secondaryButton}>
                    <Text style={styles.secondaryButtonText}>Definir como ativa</Text>
                  </Pressable>
                ) : null}
                <Pressable onPress={() => resetProject(project)} style={styles.secondaryButton}>
                  <Text style={styles.secondaryButtonText}>Reiniciar dados da obra</Text>
                </Pressable>
                <Pressable onPress={() => deleteProject(project)} style={styles.dangerButton}>
                  <Text style={styles.dangerButtonText}>Excluir obra</Text>
                </Pressable>
              </View>
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}

function Field({
  label,
  onChangeText,
  value,
}: {
  label: string;
  onChangeText: (value: string) => void;
  value: string;
}) {
  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        onChangeText={onChangeText}
        placeholder={label}
        placeholderTextColor="#94A3B8"
        style={styles.input}
        value={value}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  activeBadge: { backgroundColor: '#D1FAE5', color: '#047857' },
  activeCard: { borderColor: '#6EE7B7' },
  badge: { borderRadius: 999, fontSize: 12, fontWeight: '900', overflow: 'hidden', paddingHorizontal: 10, paddingVertical: 6 },
  container: { gap: 16, padding: 20 },
  dangerButton: { borderColor: '#FCA5A5', borderRadius: 8, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10 },
  dangerButtonText: { color: '#B91C1C', fontSize: 12, fontWeight: '900' },
  feedback: { color: '#047857', fontSize: 13, fontWeight: '800' },
  fieldGroup: { flexGrow: 1, gap: 6, minWidth: 190 },
  fieldLabel: { color: '#475569', fontSize: 12, fontWeight: '900' },
  formGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  header: { backgroundColor: '#0F172A', borderRadius: 8, gap: 8, padding: 20 },
  input: { backgroundColor: '#F8FAFC', borderColor: '#CBD5E1', borderRadius: 8, borderWidth: 1, color: '#0F172A', fontSize: 14, minHeight: 42, paddingHorizontal: 10 },
  neutralBadge: { backgroundColor: '#E2E8F0', color: '#64748B' },
  panel: { backgroundColor: '#FFFFFF', borderColor: '#E2E8F0', borderRadius: 8, borderWidth: 1, gap: 12, padding: 16 },
  primaryButton: { alignItems: 'center', backgroundColor: '#2563EB', borderRadius: 8, minHeight: 44, justifyContent: 'center', paddingHorizontal: 14 },
  primaryButtonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '900' },
  projectCard: { borderColor: '#E2E8F0', borderRadius: 8, borderWidth: 1, gap: 10, padding: 14 },
  projectHeader: { alignItems: 'flex-start', flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'space-between' },
  projectMeta: { color: '#64748B', fontSize: 13, lineHeight: 19 },
  projectName: { color: '#0F172A', fontSize: 16, fontWeight: '900' },
  projectTitleGroup: { flex: 1, minWidth: 190 },
  secondaryButton: { borderColor: '#CBD5E1', borderRadius: 8, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10 },
  secondaryButtonText: { color: '#2563EB', fontSize: 12, fontWeight: '900' },
  sectionTitle: { color: '#0F172A', fontSize: 18, fontWeight: '900' },
  subtitle: { color: '#CBD5E1', fontSize: 14, lineHeight: 21 },
  textArea: { backgroundColor: '#F8FAFC', borderColor: '#CBD5E1', borderRadius: 8, borderWidth: 1, color: '#0F172A', fontSize: 14, minHeight: 90, padding: 10, textAlignVertical: 'top' },
  title: { color: '#FFFFFF', fontSize: 28, fontWeight: '900' },
});
