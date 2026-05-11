export const consolidatedReportHeader = [
  'tipo_registro',
  'obra',
  'torre',
  'apartamento',
  'pavimento',
  'status_apartamento',
  'percentual_vistoriado',
  'servico',
  'status_servico',
  'dias_atraso',
  'bloqueado_por',
  'pendencias',
  'criticidade',
  'empreiteiro',
  'quantidade',
  'unidade',
  'valor_unitario',
  'valor_total',
  'status_medicao',
  'periodo_inicio',
  'periodo_fim',
  'data_registro',
  'observacao',
] as const;

export const hasKeyValueCellPattern = (values: readonly string[]) =>
  values.some((value) => /^[a-zA-Z_]+=.*/.test(value));
