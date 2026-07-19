-- Atualiza a fórmula de status para "saúde de cronograma" (mesma de
-- src/data/apartmentStatus.ts), substituindo a antiga (que fazia toda obra em fase
-- inicial virar "crítico" por causa do progress < 50):
--   critical  = tem etapa atrasada, OU emergência, OU etapa crítica/trava pendente
--   excellent = >=90% e nada pendente
--   attention = tem etapa vencendo em até 3 dias
--   good      = em dia
-- "Hoje" no fuso America/Sao_Paulo para bater com o cálculo local do app.
create or replace function public.recompute_apartment_progress(p_apartment uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_n int; v_score numeric; v_pending int;
  v_late boolean; v_emergency boolean; v_due_soon boolean; v_crit boolean;
  v_progress int; v_status text;
begin
  select
    count(*) filter (where included),
    coalesce(sum(case when included then w end), 0),
    count(*) filter (where included and st = 'pending'),
    bool_or(included and st in ('pending','partial') and pe is not null and pe < v_today),
    bool_or(included and em is not null and btrim(em) <> ''),
    bool_or(included and st in ('pending','partial') and pe is not null and pe >= v_today and pe <= v_today + 3),
    bool_or(included and st in ('pending','partial') and crit_stage)
  into v_n, v_score, v_pending, v_late, v_emergency, v_due_soon, v_crit
  from (
    select ci.state as st, ci.planned_end as pe, ci.emergency as em,
      not exists (
        select 1 from service_stages ss
        where ss.obra_id = ci.obra_id and ss.nome = ci.label
          and (ss.ativo = false or ss.aparece_no_checklist = false)
      ) as included,
      exists (
        select 1 from service_stages ss
        where ss.obra_id = ci.obra_id and ss.nome = ci.label
          and ss.ativo = true and (ss.etapa_critica = true or ss.trava_liberacao = true)
      ) as crit_stage,
      (case ci.state when 'ok' then 1 when 'notApplicable' then 1 when 'partial' then 0.5 else 0 end) as w
    from checklist_items ci
    where ci.apartment_id = p_apartment and ci.deleted_at is null
  ) t;

  v_progress := case when v_n = 0 then 0 else round(100.0 * v_score / v_n) end;
  v_status := case
    when coalesce(v_late,false) or coalesce(v_emergency,false) or coalesce(v_crit,false) then 'critical'
    when v_progress >= 90 and v_pending = 0 then 'excellent'
    when coalesce(v_due_soon,false) then 'attention'
    else 'good'
  end;

  perform set_config('app.recompute', 'on', true);
  update public.apartments
    set progress = v_progress, status = v_status::apartment_status
    where id = p_apartment
      and (progress is distinct from v_progress or status is distinct from v_status::apartment_status);
end $$;
