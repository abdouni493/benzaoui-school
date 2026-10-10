-- ---------------------------------------------------------------------------
-- La réduction d'un élève ne touche plus la part de l'enseignant
-- ---------------------------------------------------------------------------
-- Une réduction (pourcentage ou montant) accordée à un élève sur un
-- abonnement est un geste de l'ÉCOLE : l'élève paie moins, l'école encaisse
-- moins, mais l'enseignant au pourcentage touche toujours son pourcentage du
-- prix NORMAL de la séance. Jusqu'ici scan_card / mark_attendance calculaient
-- la part sur le prix remisé — la réduction était donc partagée.
--
-- Plutôt que de réécrire ces deux grosses fonctions, un déclencheur recalcule
-- la part au moment où la ligne de rémunération est écrite : si le tarif de
-- l'élève est remisé, la part repart du tarif sans remise.

-- Même cascade que student_session_price, sans appliquer la réduction.
create or replace function public.student_session_gross_price(
  p_student_id uuid,
  p_session_id uuid,
  p_date date default current_date
)
returns integer
language sql stable set search_path = public as $fn$
  select coalesce(
    (select sub.price_per_session
       from public.subscriptions sub
       join public.student_subscriptions ss
         on ss.subscription_id = sub.id and ss.student_id = p_student_id
      where sub.session_id = p_session_id
      limit 1),
    (select sub.price_per_session
       from public.student_subscriptions ss
       join public.subscriptions sub on sub.id = ss.subscription_id
       join public.sessions enr on enr.id = sub.session_id
       join public.sessions cur on cur.id = p_session_id
      where ss.student_id = p_student_id
        and enr.module_id = cur.module_id
        and enr.class_id  = cur.class_id
        and (ss.expiry_date is null or ss.expiry_date >= p_date)
      limit 1),
    nullif((select sub.price_per_session from public.subscriptions sub
             where sub.session_id = p_session_id limit 1), 0),
    nullif((select se.open_price from public.sessions se where se.id = p_session_id), 0),
    0);
$fn$;

grant execute on function public.student_session_gross_price(uuid, uuid, date) to authenticated;

create or replace function public.teacher_due_ignores_discount()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_date date := (new.date at time zone 'Africa/Algiers')::date;
  v_net int;
  v_gross int;
  v_pct numeric;
begin
  -- Une part à 0 (séance offerte, élève gratuit) ou déjà réglée ne bouge pas.
  if new.paid or coalesce(new.amount, 0) <= 0 then
    return new;
  end if;

  select percentage into v_pct from public.teachers
   where id = new.teacher_id and payment_type = 'percentage';
  if v_pct is null then
    return new;
  end if;

  v_net   := public.student_session_price(new.student_id, new.session_id, v_date);
  v_gross := public.student_session_gross_price(new.student_id, new.session_id, v_date);
  if v_gross > v_net then
    new.amount := round(v_gross * v_pct / 100.0);
  end if;
  return new;
end;
$$;

drop trigger if exists teacher_due_ignores_discount on public.unpaid_teacher_sessions;
create trigger teacher_due_ignores_discount
  before insert or update of amount on public.unpaid_teacher_sessions
  for each row execute function public.teacher_due_ignores_discount();

-- Rattrapage : les parts encore dues d'élèves remisés repassent au prix normal.
update public.unpaid_teacher_sessions set amount = amount
 where paid = false and amount > 0;
