import { Link } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import type { Apartment, Tower } from '@/src/data/mockObras';
import {
  getConfiguredApartments,
  getImportedBuildingData,
  saveImportedBuildingData,
} from '@/src/data/mockObras';
import { getActiveProject } from '@/src/data/localProjects';

type RowStatus = 'OK' | 'Duplicado' | 'Atenção' | 'Erro';

type ParsedImportRow = {
  id: string;
  lineNumber: number;
  torreOficial: string;
  bloco: string;
  posicao: string;
  apartamento: string;
  nomeNoForms: string;
  towerId: string;
  towerName: string;
  apartmentId: string;
  pavimento: string;
  status: RowStatus;
  messages: string[];
};

type ImportPreview = {
  rows: ParsedImportRow[];
  errors: string[];
};

const requiredHeaders = ['Torre oficial', 'Bloco', 'Posição', 'Apartamento', 'Nome no Forms'];

const normalizeText = (value: string) =>
  value
    .trim()
    .toLocaleLowerCase('pt-BR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');

const normalizeHeader = (value: string) => normalizeText(value).replace(/[^a-z0-9]/g, '');

const makeTowerId = (torreOficial: string) =>
  `torre-${torreOficial.trim().replace(/[^a-zA-Z0-9]+/g, '-').toLocaleLowerCase('pt-BR')}`;

const makeApartmentId = (torreOficial: string, apartamento: string) =>
  `ap-${torreOficial.trim()}-${apartamento.trim()}`;

const getFloorLabel = (apartmentNumber: string) => {
  const firstDigit = apartmentNumber.trim()[0];
  return firstDigit ? `${firstDigit}º pavimento` : 'pavimento não informado';
};

const splitLine = (line: string) => {
  if (line.includes('\t')) {
    return line.split('\t').map((cell) => cell.trim());
  }

  return line.split(/ {2,}|;/).map((cell) => cell.trim());
};

const positionMatchesFormsName = (position: string, formsName: string) => {
  const normalizedPosition = normalizeText(position);
  const normalizedFormsName = normalizeText(formsName);

  if (!normalizedPosition || !normalizedFormsName) {
    return true;
  }

  return normalizedFormsName.includes(normalizedPosition);
};

const parseImportText = (rawText: string): ImportPreview => {
  const errors: string[] = [];
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return { rows: [], errors: ['Cole os dados da planilha antes de pré-visualizar.'] };
  }

  const headerCells = splitLine(lines[0]);
  const headerMap = new Map<string, number>();
  headerCells.forEach((header, index) => headerMap.set(normalizeHeader(header), index));

  const missingHeaders = requiredHeaders.filter(
    (header) => !headerMap.has(normalizeHeader(header)),
  );

  if (missingHeaders.length > 0) {
    return {
      rows: [],
      errors: [`Cabeçalho incompleto. Colunas faltando: ${missingHeaders.join(', ')}.`],
    };
  }

  const rows = lines.slice(1).map((line, index): ParsedImportRow => {
    const cells = splitLine(line);
    const getCell = (header: string) => cells[headerMap.get(normalizeHeader(header)) ?? -1] ?? '';
    const torreOficial = getCell('Torre oficial');
    const bloco = getCell('Bloco');
    const posicao = getCell('Posição');
    const apartamento = getCell('Apartamento');
    const nomeNoForms = getCell('Nome no Forms');
    const messages: string[] = [];

    if (!torreOficial || !bloco || !posicao || !apartamento || !nomeNoForms) {
      messages.push('Dados incompletos.');
    }

    if (!positionMatchesFormsName(posicao, nomeNoForms)) {
      messages.push(
        `Posição = ${posicao}, mas Nome no Forms não contém a mesma posição.`,
      );
    }

    const towerId = makeTowerId(torreOficial);
    const apartmentId = makeApartmentId(torreOficial, apartamento);
    const towerName = nomeNoForms || `Torre ${torreOficial} / Bloco ${bloco} / ${posicao}`;

    return {
      id: `${index + 2}-${towerId}-${apartamento}`,
      lineNumber: index + 2,
      apartamento,
      apartmentId,
      bloco,
      messages,
      nomeNoForms,
      pavimento: getFloorLabel(apartamento),
      posicao,
      status: messages.some((message) => message === 'Dados incompletos.')
        ? 'Erro'
        : messages.length
          ? 'Atenção'
          : 'OK',
      torreOficial,
      towerId,
      towerName,
    };
  });

  const rowCounts = new Map<string, number>();
  rows.forEach((row) => {
    const key = `${row.towerId}-${row.apartamento}`;
    rowCounts.set(key, (rowCounts.get(key) ?? 0) + 1);
  });

  const existingApartments = getConfiguredApartments();
  const existingKeys = new Set(
    existingApartments.map((apartment) => `${apartment.towerId}-${apartment.number}`),
  );

  const rowsWithDuplicates = rows.map((row) => {
    const key = `${row.towerId}-${row.apartamento}`;
    const duplicateInText = (rowCounts.get(key) ?? 0) > 1;
    const duplicateInApp = existingKeys.has(key);
    const messages = [...row.messages];

    if (duplicateInText) {
      messages.push(`Torre ${row.torreOficial} possui apartamento ${row.apartamento} duplicado.`);
    } else if (duplicateInApp) {
      messages.push('Apartamento já existe no app.');
    }

    const status: RowStatus = duplicateInText
      ? 'Duplicado'
      : row.status === 'Erro'
        ? 'Erro'
        : duplicateInApp || row.status === 'Atenção'
          ? 'Atenção'
          : 'OK';

    return {
      ...row,
      messages,
      status,
    };
  });

  return { rows: rowsWithDuplicates, errors };
};

const buildImportedData = (rows: ParsedImportRow[]) => {
  const activeProject = getActiveProject();
  const towerMap = new Map<string, Tower>();
  const apartmentMap = new Map<string, Apartment>();

  rows
    .filter((row) => row.status !== 'Erro' && row.status !== 'Duplicado')
    .forEach((row) => {
      towerMap.set(row.towerId, {
        id: row.towerId,
        ativo: true,
        block: `Bloco ${row.bloco}`,
        description: `${row.towerName}. Dados importados da planilha.`,
        name: row.towerName,
        nomeNoForms: row.nomeNoForms,
        obraId: activeProject.id,
        position: row.posicao,
        torreOficial: row.torreOficial,
      });

      apartmentMap.set(`${row.towerId}-${row.apartamento}`, {
        id: row.apartmentId,
        ativo: true,
        block: row.bloco,
        checklist: [],
        floor: row.pavimento,
        lastInspection: 'Sem vistoria',
        nomeNoForms: row.nomeNoForms,
        notes: 'Apartamento importado da planilha. Ainda sem dados de vistoria.',
        number: row.apartamento,
        obraId: activeProject.id,
        pendencias: 0,
        percentualVistoriado: 0,
        fotos: 0,
        itensConcluidos: 0,
        medicoes: 0,
        position: row.posicao,
        progress: 0,
        servicosTravados: 0,
        status: 'attention',
        statusVisual: 'Sem dados',
        totalItens: 0,
        towerId: row.towerId,
        visitas: 0,
      });
    });

  return {
    apartments: [...apartmentMap.values()].sort((a, b) =>
      a.towerId === b.towerId
        ? Number(a.number) - Number(b.number)
        : a.towerId.localeCompare(b.towerId),
    ),
    towers: [...towerMap.values()].sort((a, b) => a.id.localeCompare(b.id)),
  };
};

const getPreviewStats = (rows: ParsedImportRow[]) => {
  const towerIds = new Set(rows.map((row) => row.towerId).filter(Boolean));
  const apartmentKeys = new Set(rows.map((row) => `${row.towerId}-${row.apartamento}`));
  const duplicates = rows.filter((row) => row.status === 'Duplicado');
  const incomplete = rows.filter((row) => row.messages.includes('Dados incompletos.'));
  const divergence = rows.filter((row) =>
    row.messages.some((message) => message.includes('Nome no Forms')),
  );

  return {
    apartments: apartmentKeys.size,
    divergence: divergence.length,
    duplicates: duplicates.length,
    incomplete: incomplete.length,
    lines: rows.length,
    towers: towerIds.size,
  };
};

export default function ImportApartmentsScreen() {
  const [rawText, setRawText] = useState('');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [feedback, setFeedback] = useState('');

  const stats = useMemo(() => getPreviewStats(preview?.rows ?? []), [preview]);
  const canImport = Boolean(preview?.rows.length) && !preview?.rows.some((row) => row.status === 'Erro' || row.status === 'Duplicado');

  const handlePreview = () => {
    setFeedback('');
    setPreview(parseImportText(rawText));
  };

  const handleImport = () => {
    if (!preview) {
      setFeedback('Pré-visualize a importação antes de salvar.');
      return;
    }

    const blockingRows = preview.rows.filter((row) => row.status === 'Erro' || row.status === 'Duplicado');
    if (blockingRows.length > 0) {
      setFeedback('Corrija linhas com Erro ou Duplicado antes de importar.');
      return;
    }

    const rowsWithExistingApartment = preview.rows.filter((row) =>
      getConfiguredApartments().some(
        (apartment) => apartment.towerId === row.towerId && apartment.number === row.apartamento,
      ),
    );
    let rowsToImport = preview.rows;

    if (rowsWithExistingApartment.length > 0) {
      const duplicateAction =
        typeof window !== 'undefined'
          ? window.prompt(
              'Alguns apartamentos já existem. Digite "ignorar", "atualizar" ou "cancelar".',
              'ignorar',
            )
          : 'cancelar';
      const normalizedAction = normalizeText(duplicateAction ?? '');

      if (normalizedAction === 'cancelar' || !normalizedAction) {
        setFeedback('Importação cancelada. Nenhum dado foi alterado.');
        return;
      }

      if (normalizedAction === 'ignorar') {
        const existingKeys = new Set(
          rowsWithExistingApartment.map((row) => `${row.towerId}-${row.apartamento}`),
        );
        rowsToImport = preview.rows.filter(
          (row) => !existingKeys.has(`${row.towerId}-${row.apartamento}`),
        );
      } else if (normalizedAction !== 'atualizar') {
        setFeedback('Opção inválida. Use ignorar, atualizar ou cancelar.');
        return;
      }
    }

    const importedData = buildImportedData(rowsToImport);
    const currentImportedData = getImportedBuildingData();
    const mergedTowers = new Map(currentImportedData.towers.map((tower) => [tower.id, tower]));
    const mergedApartments = new Map(
      currentImportedData.apartments.map((apartment) => [`${apartment.towerId}-${apartment.number}`, apartment]),
    );

    importedData.towers.forEach((tower) => mergedTowers.set(tower.id, tower));
    importedData.apartments.forEach((apartment) =>
      mergedApartments.set(`${apartment.towerId}-${apartment.number}`, apartment),
    );

    saveImportedBuildingData([...mergedTowers.values()], [...mergedApartments.values()]);
    setFeedback(
      `Importação concluída: ${importedData.towers.length} torre(s) e ${importedData.apartments.length} apartamento(s).`,
    );
    setPreview(parseImportText(rawText));
  };

  const handleClear = () => {
    setRawText('');
    setPreview(null);
    setFeedback('');
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Importar apartamentos</Text>
        <Text style={styles.subtitle}>
          Cole os dados copiados da planilha para cadastrar torres e apartamentos no app.
        </Text>
      </View>

      <View style={styles.panel}>
        <Text style={styles.label}>Dados da planilha</Text>
        <TextInput
          multiline
          onChangeText={setRawText}
          placeholder={'Torre oficial\tBloco\tPosição\tApartamento\tNome no Forms\n1\tB\tFrente Mar\t11\tTorre 1 / Bloco B / Frente mar'}
          placeholderTextColor="#94A3B8"
          style={styles.textArea}
          textAlignVertical="top"
          value={rawText}
        />

        <View style={styles.actions}>
          <Pressable onPress={handlePreview} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>Pré-visualizar importação</Text>
          </Pressable>
          <Pressable
            disabled={!canImport}
            onPress={handleImport}
            style={[styles.secondaryButton, !canImport && styles.disabledButton]}>
            <Text style={[styles.secondaryButtonText, !canImport && styles.disabledButtonText]}>
              Importar apartamentos
            </Text>
          </Pressable>
          <Pressable onPress={handleClear} style={styles.ghostButton}>
            <Text style={styles.ghostButtonText}>Limpar</Text>
          </Pressable>
        </View>

        {feedback ? <Text style={styles.feedback}>{feedback}</Text> : null}
      </View>

      {preview ? (
        <View style={styles.panel}>
          <Text style={styles.sectionTitle}>Pré-visualização</Text>
          {preview.errors.length > 0 ? (
            preview.errors.map((error) => (
              <Text key={error} style={styles.errorText}>
                {error}
              </Text>
            ))
          ) : (
            <>
              <View style={styles.statsGrid}>
                <SummaryCard label="linhas lidas" value={stats.lines} />
                <SummaryCard label="torres" value={stats.towers} />
                <SummaryCard label="apartamentos" value={stats.apartments} />
                <SummaryCard label="duplicados" value={stats.duplicates} />
                <SummaryCard label="incompletos" value={stats.incomplete} />
                <SummaryCard label="divergências" value={stats.divergence} />
              </View>

              <View style={styles.notice}>
                <Text style={styles.noticeText}>
                  Referência da obra: Torre 1 = 54 apartamentos, Torre 2 = 54 apartamentos,
                  total esperado = 108 apartamentos. A prévia alerta duplicidades como Torre 1
                  apartamento 92 duplicado e ajuda a identificar ausências como apartamento 96.
                </Text>
              </View>

              <View style={styles.table}>
                {preview.rows.map((row) => (
                  <View key={row.id} style={styles.rowCard}>
                    <View style={styles.rowHeader}>
                      <Text style={styles.rowTitle}>
                        Torre {row.torreOficial} / Bloco {row.bloco} / AP {row.apartamento}
                      </Text>
                      <Text style={[styles.statusPill, styles[`status${row.status}`]]}>
                        {row.status}
                      </Text>
                    </View>
                    <Text style={styles.rowText}>Posição: {row.posicao}</Text>
                    <Text style={styles.rowText}>Pavimento: {row.pavimento}</Text>
                    <Text style={styles.rowText}>Nome no Forms: {row.nomeNoForms}</Text>
                    {row.messages.length > 0 ? (
                      <Text style={styles.messageText}>{row.messages.join(' ')}</Text>
                    ) : (
                      <Text style={styles.okText}>Linha pronta para importação.</Text>
                    )}
                  </View>
                ))}
              </View>
            </>
          )}
        </View>
      ) : null}

      <View style={styles.panel}>
        <Text style={styles.sectionTitle}>Depois de importar</Text>
        <Text style={styles.subtitle}>
          O dashboard, a tela de torres, a lista/mapa de apartamentos e o diagnóstico passam a ler
          os apartamentos salvos localmente neste navegador.
        </Text>
        <Link href="/" asChild>
          <Pressable style={styles.ghostButton}>
            <Text style={styles.ghostButtonText}>Voltar para o dashboard</Text>
          </Pressable>
        </Link>
      </View>
    </ScrollView>
  );
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.summaryCard}>
      <Text style={styles.summaryValue}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 16,
    padding: 20,
  },
  header: {
    backgroundColor: '#0F172A',
    borderRadius: 8,
    gap: 8,
    padding: 20,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '900',
  },
  subtitle: {
    color: '#64748B',
    fontSize: 14,
    lineHeight: 21,
  },
  panel: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0',
    borderRadius: 8,
    borderWidth: 1,
    gap: 12,
    padding: 16,
  },
  label: {
    color: '#0F172A',
    fontSize: 14,
    fontWeight: '900',
  },
  textArea: {
    backgroundColor: '#F8FAFC',
    borderColor: '#CBD5E1',
    borderRadius: 8,
    borderWidth: 1,
    color: '#0F172A',
    fontSize: 13,
    minHeight: 180,
    padding: 12,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: '#2563EB',
    borderRadius: 8,
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
  },
  secondaryButton: {
    alignItems: 'center',
    borderColor: '#2563EB',
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  secondaryButtonText: {
    color: '#2563EB',
    fontSize: 13,
    fontWeight: '900',
  },
  ghostButton: {
    alignItems: 'center',
    borderColor: '#CBD5E1',
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  ghostButtonText: {
    color: '#475569',
    fontSize: 13,
    fontWeight: '900',
  },
  disabledButton: {
    backgroundColor: '#F1F5F9',
    borderColor: '#CBD5E1',
  },
  disabledButtonText: {
    color: '#94A3B8',
  },
  feedback: {
    color: '#047857',
    fontSize: 13,
    fontWeight: '800',
  },
  sectionTitle: {
    color: '#0F172A',
    fontSize: 18,
    fontWeight: '900',
  },
  errorText: {
    color: '#B91C1C',
    fontSize: 13,
    fontWeight: '800',
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  summaryCard: {
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
    borderRadius: 8,
    borderWidth: 1,
    flexGrow: 1,
    minWidth: 130,
    padding: 12,
  },
  summaryValue: {
    color: '#0F172A',
    fontSize: 22,
    fontWeight: '900',
  },
  summaryLabel: {
    color: '#64748B',
    fontSize: 12,
    marginTop: 2,
  },
  notice: {
    backgroundColor: '#FFFBEB',
    borderColor: '#FBBF24',
    borderRadius: 8,
    borderWidth: 1,
    padding: 12,
  },
  noticeText: {
    color: '#92400E',
    fontSize: 13,
    lineHeight: 19,
  },
  table: {
    gap: 10,
  },
  rowCard: {
    borderColor: '#E2E8F0',
    borderRadius: 8,
    borderWidth: 1,
    gap: 5,
    padding: 12,
  },
  rowHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'space-between',
  },
  rowTitle: {
    color: '#0F172A',
    flex: 1,
    fontSize: 14,
    fontWeight: '900',
    minWidth: 190,
  },
  rowText: {
    color: '#475569',
    fontSize: 13,
  },
  statusPill: {
    borderRadius: 999,
    fontSize: 11,
    fontWeight: '900',
    overflow: 'hidden',
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  statusOK: {
    backgroundColor: '#D1FAE5',
    color: '#047857',
  },
  statusDuplicado: {
    backgroundColor: '#FEE2E2',
    color: '#B91C1C',
  },
  statusAtenção: {
    backgroundColor: '#FEF3C7',
    color: '#B45309',
  },
  statusErro: {
    backgroundColor: '#FEE2E2',
    color: '#B91C1C',
  },
  messageText: {
    color: '#B45309',
    fontSize: 12,
    fontWeight: '800',
  },
  okText: {
    color: '#047857',
    fontSize: 12,
    fontWeight: '800',
  },
});
