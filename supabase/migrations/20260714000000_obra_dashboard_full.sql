-- Expande obra_dashboard: além das "Atrasadas", agrega tudo que o Início deriva de
-- checklist_items (emergências, observações, total de etapas e pendências por
-- serviço), para o Início não precisar mais baixar os ~17k itens. As regras são
-- idênticas às do cliente. SECURITY INVOKER + RLS obra_scoped garantem o escopo.
create or replace function public.obra_dashboard(p_obra uuid, p_today date)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with late as (
    select ci.id, ci.apartment_id::text as unit_key, ci.apartment_id, a.number as apt_number,
           t.name as tower_name, null::text as level_code, ci.label, ci.planned_end,
           (p_today - ci.planned_end) as delay_days
    from checklist_items ci
    join apartments a on a.id = ci.apartment_id
    left join towers t on t.id = a.tower_id
    where ci.obra_id = p_obra and ci.deleted_at is null and ci.apartment_id is not null
      and ci.planned_start is not null and ci.planned_end is not null
      and ci.state in ('pending','partial') and ci.planned_end < p_today
      and not exists (select 1 from service_stages ss where ss.obra_id=ci.obra_id and ss.nome=ci.label and (ss.ativo=false or ss.aparece_no_cronograma=false))
    union all
    select ci.id, 'tower:'||ci.tower_id::text||'|'||coalesce(ci.level_code,''), null::uuid, null::text,
           t.name, ci.level_code, ci.label, ci.planned_end, (p_today - ci.planned_end)
    from checklist_items ci
    left join towers t on t.id = ci.tower_id
    where ci.obra_id = p_obra and ci.deleted_at is null and ci.apartment_id is null and ci.tower_id is not null
      and ci.planned_start is not null and ci.planned_end is not null
      and ci.state in ('pending','partial') and ci.planned_end < p_today
      and not exists (select 1 from service_stages ss where ss.obra_id=ci.obra_id and ss.nome=ci.label and (ss.ativo=false or ss.aparece_no_cronograma=false))
  ),
  emg as (
    select 'apt' as scope, ci.apartment_id::text as apt_id, null::text as tower_id, t.name as tower_name,
           a.number as apt_number, null::text as level_code, ci.label, ci.emergency as text
    from checklist_items ci
    join apartments a on a.id = ci.apartment_id
    left join towers t on t.id = a.tower_id
    where ci.obra_id=p_obra and ci.deleted_at is null and ci.apartment_id is not null
      and ci.emergency is not null and btrim(ci.emergency) <> ''
    union all
    select 'tower', null, ci.tower_id::text, t.name, null, ci.level_code, ci.label, ci.emergency
    from checklist_items ci
    left join towers t on t.id = ci.tower_id
    where ci.obra_id=p_obra and ci.deleted_at is null and ci.apartment_id is null and ci.tower_id is not null
      and ci.emergency is not null and btrim(ci.emergency) <> ''
  ),
  obs as (
    select 'apt' as scope, ci.id as item_id, ci.apartment_id::text as apt_id, null::text as tower_id,
           t.name as tower_name, a.number as apt_number, null::text as level_code, ci.label, ci.comment as text
    from checklist_items ci
    join apartments a on a.id = ci.apartment_id
    left join towers t on t.id = a.tower_id
    where ci.obra_id=p_obra and ci.deleted_at is null and ci.apartment_id is not null
      and ci.comment is not null and btrim(ci.comment) <> ''
    union all
    select 'tower', ci.id, null, ci.tower_id::text, t.name, null, ci.level_code, ci.label, ci.comment
    from checklist_items ci
    left join towers t on t.id = ci.tower_id
    where ci.obra_id=p_obra and ci.deleted_at is null and ci.apartment_id is null and ci.tower_id is not null
      and ci.comment is not null and btrim(ci.comment) <> ''
  ),
  pend as (
    select ci.label, count(distinct ci.apartment_id) as apartments
    from checklist_items ci
    where ci.obra_id=p_obra and ci.deleted_at is null and ci.apartment_id is not null
      and ci.state in ('pending','partial')
    group by ci.label
  )
  select jsonb_build_object(
    'late_count', (select count(*) from late),
    'late_units', (select count(distinct unit_key) from late),
    'late', coalesce((select jsonb_agg(jsonb_build_object(
       'id',l.id,'apartment_id',l.apartment_id,'apt_number',l.apt_number,'tower_name',l.tower_name,
       'level_code',l.level_code,'label',l.label,'planned_end',l.planned_end,'delay_days',l.delay_days
     ) order by l.delay_days desc) from late l), '[]'::jsonb),
    'emergency_units',
       (select count(distinct apt_id) from emg where scope='apt')
       + (select count(distinct tower_id||'|'||coalesce(level_code,'')) from emg where scope='tower'),
    'emergency', coalesce((select jsonb_agg(jsonb_build_object(
       'scope',e.scope,'apt_id',e.apt_id,'tower_id',e.tower_id,'tower_name',e.tower_name,
       'apt_number',e.apt_number,'level_code',e.level_code,'label',e.label,'text',e.text
     )) from emg e), '[]'::jsonb),
    'obs_count', (select count(*) from obs),
    'obs_units',
       (select count(distinct apt_id) from obs where scope='apt')
       + (select count(distinct tower_id||'|'||coalesce(level_code,'')) from obs where scope='tower'),
    'observations', coalesce((select jsonb_agg(jsonb_build_object(
       'scope',o.scope,'item_id',o.item_id,'apt_id',o.apt_id,'tower_id',o.tower_id,'tower_name',o.tower_name,
       'apt_number',o.apt_number,'level_code',o.level_code,'label',o.label,'text',o.text
     )) from obs o), '[]'::jsonb),
    'total_steps',
       (select count(*) from checklist_items ci where ci.obra_id=p_obra and ci.deleted_at is null and ci.apartment_id is not null)
       + (select count(*) from checklist_items ci where ci.obra_id=p_obra and ci.deleted_at is null and ci.apartment_id is null and ci.tower_id is not null),
    'pending_by_service', coalesce((select jsonb_agg(jsonb_build_object('label',p.label,'apartments',p.apartments)) from pend p), '[]'::jsonb)
  );
$$;

grant execute on function public.obra_dashboard(uuid, date) to authenticated;
