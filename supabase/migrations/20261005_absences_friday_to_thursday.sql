-- =============================================================================
-- Absences hebdomadaires : semaine du VENDREDI au JEUDI, facturée le jeudi soir
-- Run once against the live project (Supabase Dashboard -> SQL Editor).
--
-- Règle (client) : pour chaque emploi du temps auquel l'élève est inscrit, si
-- aucune présence n'est enregistrée entre le vendredi et le jeudi, la semaine
-- devient une ABSENCE : le prix de la séance est retiré de son solde (dette
-- permise), et l'absence apparaît dans « Présences » de la fiche élève et dans
-- « Mes présences » de son compte.
--
-- Pourquoi aucune absence n'avait JAMAIS été facturée :
--   process_weekly_absences() se terminait par
--     update public.school set absence_penalty_last_run = v_today;
--   sans WHERE. Supabase charge `safeupdate` pour les appels de l'API REST :
--   « UPDATE requires a WHERE clause » — la fonction entière échouait et était
--   annulée, à chaque chargement de l'accueil. Résultat en ligne : 0 ligne dans
--   absence_penalties, absence_penalty_last_run toujours NULL.
--
-- Ce script :
--   1. réécrit la fonction (même logique que 20260912) avec un WHERE ;
--   2. enregistre la semaine comme vendredi -> JEUDI inclus (period_end = jeudi),
--      la facturation se déclenchant dès que le jeudi est terminé ;
--   3. fait partir la facturation de la semaine en cours (vendredi 02/10/2026),
--      pour que la première exécution réussie ne facture pas d'un coup les
--      8 semaines passées à tous les élèves.
-- =============================================================================

update public.school
   set absence_week_start_day = 5,             -- vendredi
       absence_penalty_since  = date '2026-10-02',
       absence_penalty_last_run = null
 where id is not null;

create or replace function public.process_weekly_absences(p_when timestamptz default now())
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_role user_role := public.current_role();
  v_today date := (p_when at time zone 'Africa/Algiers')::date;
  v_floor date;
  v_enabled boolean;
  v_last_run date;
  v_start_dow smallint;
  v_charged int := 0;
  v_students int := 0;
  v_prev_student uuid;
  v_enr record;
  v_cost int;
  v_window int;
  v_aligned boolean;
  v_last_att date;
  v_last_pen date;
  v_anchor date;
  v_pen_anchor date;
  v_period_start date;
  v_period_end date;   -- dernier jour INCLUS de la semaine (le jeudi)
  v_pen_id uuid;
  v_new_balance int;
  v_module_name text;
  v_group_name text;
  v_present boolean;
  c_max_weeks constant int := 8;
  v_iter int;
begin
  if auth.uid() is not null and (v_role is null or v_role not in ('admin', 'reception')) then
    raise exception 'not authorized';
  end if;

  select coalesce(absence_penalty_enabled, true),
         coalesce(absence_penalty_since, v_today),
         absence_penalty_last_run,
         coalesce(absence_week_start_day, 5)
    into v_enabled, v_floor, v_last_run, v_start_dow
  from public.school
  limit 1;

  if not coalesce(v_enabled, true) then
    return jsonb_build_object('ok', true, 'enabled', false, 'charged', 0, 'students', 0);
  end if;

  if v_last_run is not null and v_last_run >= v_today then
    return jsonb_build_object('ok', true, 'skipped', true, 'charged', 0, 'students', 0);
  end if;

  for v_enr in
    select ss.student_id,
           ss.subscription_id,
           greatest(ss.start_date, se.billing_start_date) as enr_start,
           st.is_free           as is_free,
           st.created_at::date  as student_since,
           public.discounted_price(sub.price_per_session, ss.discount_type, ss.discount_value) as price,
           se.id                as session_id,
           se.module_id         as module_id,
           se.class_id          as class_id,
           se.is_open           as is_open,
           se.period_start      as se_period_start,
           se.period_end        as se_period_end,
           coalesce(mar.enabled, true)     as rule_enabled,
           coalesce(mar.days_window, 7)    as rule_window
    from public.student_subscriptions ss
    join public.students st       on st.id = ss.student_id
    join public.subscriptions sub on sub.id = ss.subscription_id
    join public.sessions se       on se.id = sub.session_id
    left join public.module_absence_rules mar on mar.module_id = se.module_id
    where coalesce(sub.price_per_session, 0) > 0
    order by ss.student_id
  loop
    if not v_enr.rule_enabled then
      continue;
    end if;

    v_cost := case when v_enr.is_free then 0 else coalesce(v_enr.price, 0) end;
    if v_cost <= 0 then
      continue;
    end if;

    v_window := greatest(coalesce(v_enr.rule_window, 7), 1);
    v_aligned := (v_window = 7);

    select max((timezone('Africa/Algiers', a.occurred_at))::date)
      into v_last_att
    from public.attendance a
    join public.sessions ase on ase.id = a.session_id
    where a.student_id = v_enr.student_id
      and ase.module_id = v_enr.module_id
      and ase.class_id  = v_enr.class_id
      and a.status in ('present', 'late');

    select max(period_end) into v_last_pen
    from public.absence_penalties
    where student_id = v_enr.student_id
      and subscription_id = v_enr.subscription_id;

    if v_aligned then
      v_anchor := public.week_anchor(
        greatest(
          v_floor,
          coalesce(v_enr.enr_start, v_floor),
          coalesce(v_enr.student_since, v_floor)
        ), v_start_dow);

      -- Semaine suivant la dernière déjà facturée (period_end = jeudi, son
      -- vendredi d'ancrage est antérieur : on passe au vendredi suivant).
      if v_last_pen is not null then
        v_pen_anchor := public.week_anchor(v_last_pen, v_start_dow);
        if v_pen_anchor <= v_last_pen then
          v_pen_anchor := v_pen_anchor + v_window;
        end if;
        v_anchor := greatest(v_anchor, v_pen_anchor);
      end if;

      v_anchor := greatest(v_anchor,
        public.week_anchor(v_today, v_start_dow) - (c_max_weeks * v_window));
    else
      v_anchor := greatest(
        v_floor,
        coalesce(v_enr.enr_start, v_floor),
        coalesce(v_last_att, v_floor),
        coalesce(v_enr.student_since, v_floor),
        coalesce(v_last_pen, v_floor)
      );
    end if;

    v_iter := 0;
    loop
      v_iter := v_iter + 1;
      exit when v_iter > c_max_weeks + 1;

      if v_aligned then
        -- Vendredi -> jeudi ; facturable une fois le jeudi terminé.
        v_period_start := v_anchor;
        v_period_end   := v_anchor + v_window - 1;
        exit when v_period_end >= v_today;
      else
        v_period_start := v_anchor + 1;
        v_period_end   := v_anchor + v_window;
        exit when v_today - v_anchor < v_window;
      end if;

      if v_period_end < greatest(v_floor, coalesce(v_enr.enr_start, v_floor)) then
        v_anchor := v_anchor + v_window;
        continue;
      end if;

      if v_enr.is_open
         and ((v_enr.se_period_end is not null and v_enr.se_period_end < v_period_start)
           or (v_enr.se_period_start is not null and v_enr.se_period_start > v_period_end)) then
        v_anchor := v_anchor + v_window;
        continue;
      end if;

      -- Période gratuite chevauchant la semaine : rien n'est facturé.
      if exists (
        select 1 from public.free_periods fp
        where fp.active
          and (fp.all_classes or v_enr.class_id = any (fp.class_ids))
          and fp.start_date <= v_period_end
          and fp.end_date  >= v_period_start
      ) then
        v_anchor := v_anchor + v_window;
        continue;
      end if;

      select exists (
        select 1
        from public.attendance a
        join public.sessions ase on ase.id = a.session_id
        where a.student_id = v_enr.student_id
          and ase.module_id = v_enr.module_id
          and ase.class_id  = v_enr.class_id
          and a.status in ('present', 'late')
          and (timezone('Africa/Algiers', a.occurred_at))::date between v_period_start and v_period_end
      ) into v_present;

      if v_present then
        v_anchor := v_anchor + v_window;
        continue;
      end if;

      begin
        insert into public.absence_penalties
          (student_id, subscription_id, session_id, module_id,
           period_start, period_end, amount, balance_after)
        values
          (v_enr.student_id, v_enr.subscription_id, v_enr.session_id, v_enr.module_id,
           v_period_start, v_period_end, v_cost, 0)
        returning id into v_pen_id;
      exception when unique_violation then
        v_anchor := v_anchor + v_window;
        continue;
      end;

      update public.students
        set balance = balance - v_cost
        where id = v_enr.student_id
        returning balance into v_new_balance;

      update public.absence_penalties
        set balance_after = v_new_balance
        where id = v_pen_id;

      select m.name into v_module_name from public.modules m where m.id = v_enr.module_id;
      select g.name into v_group_name
        from public.groups g
        join public.sessions gse on gse.group_id = g.id
        where gse.id = v_enr.session_id;

      insert into public.balance_tx (student_id, amount, date, type, description, module_id)
      values (
        v_enr.student_id, -v_cost, p_when, 'deduction',
        'Absence hebdomadaire — ' || coalesce(v_module_name, 'module')
          || coalesce(' (' || v_group_name || ')', '')
          || ' — semaine du ' || to_char(v_period_start, 'DD/MM/YYYY')
          || ' au ' || to_char(v_period_end, 'DD/MM/YYYY')
          || ' — solde: ' || v_new_balance || ' DA'
          || case when v_new_balance < 0 then ' (dette)' else '' end,
        v_enr.module_id
      );

      if v_enr.student_id is distinct from v_prev_student then
        v_students := v_students + 1;
        v_prev_student := v_enr.student_id;
      end if;
      v_charged := v_charged + 1;
      v_anchor := v_anchor + v_window;
    end loop;
  end loop;

  -- LE correctif : sans WHERE, safeupdate refuse l'UPDATE et annule tout.
  update public.school set absence_penalty_last_run = v_today where id is not null;

  return jsonb_build_object('ok', true, 'enabled', true, 'charged', v_charged, 'students', v_students);
end;
$$;

revoke execute on function public.process_weekly_absences(timestamptz) from public, anon;
grant execute on function public.process_weekly_absences(timestamptz) to authenticated;

notify pgrst, 'reload schema';
