-- RPC do dashboard (Início): calcula as etapas "Atrasada" no banco, em vez de o
-- cliente baixar ~17k checklist_items e rodar buildCronogramaFromData só para achar
-- as poucas atrasadas.
--
-- A regra replica EXATAMENTE buildCronogramaFromData (src/data/cronogramaReal.ts):
--   * item com início E fim planejados (planned_start / planned_end não nulos);
--   * state em ('pending','partial')  — 'ok' vira "Concluída"; 'notApplicable' é ignorado;
--   * NÃO existe stage correspondente (por nome) inativa ou oculta do cronograma;
--   * planned_end < hoje.
-- Vale para etapas de apartamento e de nível de torre (apartment_id nulo + tower_id).
--
-- `p_today` é a data LOCAL do aparelho (YYYY-MM-DD): garante que o "hoje" bata com o
-- cálculo do cliente independentemente do fuso do servidor.
--
-- SECURITY INVOKER + as políticas obra_scoped das tabelas garantem que o usuário só
-- enxergue dados das suas obras (passar um p_obra alheio retorna vazio).

create or replace function public.obra_dashboard(p_obra uuid, p_today date)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with late as (
    -- Etapas de apartamento
    select
      ci.id,
      ci.apartment_id::text                as unit_key,
      ci.apartment_id,
      a.number                             as apt_number,
      t.name                               as tower_name,
      null::text                           as level_code,
      ci.label,
      ci.planned_end,
      (p_today - ci.planned_end)           as delay_days
    from checklist_items ci
    join apartments a on a.id = ci.apartment_id
    left join towers t on t.id = a.tower_id
    where ci.obra_id = p_obra
      and ci.deleted_at is null
      and ci.apartment_id is not null
      and ci.planned_start is not null and ci.planned_end is not null
      and ci.state in ('pending','partial')
      and ci.planned_end < p_today
      and not exists (
        select 1 from service_stages ss
        where ss.obra_id = ci.obra_id and ss.nome = ci.label
          and (ss.ativo = false or ss.aparece_no_cronograma = false)
      )
    union all
    -- Etapas de nível de torre (apartment_id nulo, tower_id preenchido)
    select
      ci.id,
      'tower:' || ci.tower_id::text || '|' || coalesce(ci.level_code, '') as unit_key,
      null::uuid,
      null::text,
      t.name,
      ci.level_code,
      ci.label,
      ci.planned_end,
      (p_today - ci.planned_end)
    from checklist_items ci
    left join towers t on t.id = ci.tower_id
    where ci.obra_id = p_obra
      and ci.deleted_at is null
      and ci.apartment_id is null and ci.tower_id is not null
      and ci.planned_start is not null and ci.planned_end is not null
      and ci.state in ('pending','partial')
      and ci.planned_end < p_today
      and not exists (
        select 1 from service_stages ss
        where ss.obra_id = ci.obra_id and ss.nome = ci.label
          and (ss.ativo = false or ss.aparece_no_cronograma = false)
      )
  )
  select jsonb_build_object(
    'late_count', (select count(*) from late),
    'late_units', (select count(distinct unit_key) from late),
    'late', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', l.id,
          'apartment_id', l.apartment_id,
          'apt_number', l.apt_number,
          'tower_name', l.tower_name,
          'level_code', l.level_code,
          'label', l.label,
          'planned_end', l.planned_end,
          'delay_days', l.delay_days
        )
        order by l.delay_days desc
      )
      from late l
    ), '[]'::jsonb)
  );
$$;

grant execute on function public.obra_dashboard(uuid, date) to authenticated;
