-- =============================================================================
-- Correction d'une transaction du solde d'un élève (fiche étudiant → onglet
-- « Transactions » → Modifier / Supprimer).
-- Run once against the live project (Supabase Dashboard -> SQL Editor).
--
--   1. update_balance_tx — modifie montant / description / date / type d'une
--      ligne de balance_tx ET reporte l'écart sur students.balance dans la
--      MÊME transaction (jamais de solde qui diverge de son historique).
--   2. delete_balance_tx — supprime la ligne et annule son effet sur le solde.
--
-- Les deux savent aussi corriger la caisse : un « topup » a créé une entrée
-- cash_transactions (« Versement … ») au moment du versement, donc la
-- correction/annulation écrit une écriture compensatoire signée (jamais de
-- suppression d'historique de caisse). Les autres types (deduction,
-- debt_payment, registration) n'ont jamais touché la caisse : rien à corriger.
--
-- Volontairement NON traité : supprimer une ligne 'registration' ne remet pas
-- students.registration_due à sa valeur d'avant (la ligne peut être un doublon
-- à nettoyer aussi bien qu'un règlement à défaire) ; idem pour les présences /
-- absences hebdomadaires, dont la ligne de présence reste visible dans l'onglet
-- « Présences » (utiliser « Annuler la présence » pour un remboursement lié).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. update_balance_tx
-- ---------------------------------------------------------------------------
create or replace function public.update_balance_tx(
  p_tx_id uuid,
  p_amount integer,
  p_description text default null,
  p_date timestamptz default null,
  p_type balance_tx_type default null,
  p_adjust_cash boolean default true
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_role user_role := public.current_role();
  v_tx public.balance_tx%rowtype;
  v_student public.students%rowtype;
  v_delta integer;
  v_new_balance integer;
begin
  if v_role is null or v_role not in ('admin', 'reception') then
    raise exception 'not authorized';
  end if;

  select * into v_tx from public.balance_tx where id = p_tx_id;
  if not found then
    raise exception 'transaction not found';
  end if;

  select * into v_student from public.students where id = v_tx.student_id;
  if not found then
    raise exception 'student not found';
  end if;

  v_delta := p_amount - v_tx.amount;

  -- Mise à jour relative : deux corrections simultanées ne peuvent pas
  -- s'écraser l'une l'autre.
  update public.students
    set balance = balance + v_delta
    where id = v_tx.student_id
    returning balance into v_new_balance;

  -- Les valeurs de repli viennent de v_tx (et non des colonnes) pour qu'aucun
  -- nom de colonne ("date", "type") ne puisse être lu comme un mot-clé.
  update public.balance_tx
    set amount      = p_amount,
        description = coalesce(p_description, v_tx.description),
        date        = coalesce(p_date, v_tx.date),
        type        = coalesce(p_type, v_tx.type)
    where id = p_tx_id;

  if p_adjust_cash and v_tx.type = 'topup' and v_delta <> 0 then
    insert into public.cash_transactions (type, amount, date, description)
    values (
      'student_payment', v_delta, now(),
      'Correction versement ' || v_student.first_name || ' ' || v_student.last_name
        || ' (' || v_tx.amount || ' DA → ' || p_amount || ' DA)'
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'newBalance', v_new_balance,
    'delta', v_delta,
    'cashAdjusted', p_adjust_cash and v_tx.type = 'topup' and v_delta <> 0
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. delete_balance_tx
-- ---------------------------------------------------------------------------
create or replace function public.delete_balance_tx(
  p_tx_id uuid,
  p_adjust_cash boolean default true
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_role user_role := public.current_role();
  v_tx public.balance_tx%rowtype;
  v_student public.students%rowtype;
  v_new_balance integer;
begin
  if v_role is null or v_role not in ('admin', 'reception') then
    raise exception 'not authorized';
  end if;

  select * into v_tx from public.balance_tx where id = p_tx_id;
  if not found then
    raise exception 'transaction not found';
  end if;

  select * into v_student from public.students where id = v_tx.student_id;
  if not found then
    raise exception 'student not found';
  end if;

  update public.students
    set balance = balance - v_tx.amount
    where id = v_tx.student_id
    returning balance into v_new_balance;

  delete from public.balance_tx where id = p_tx_id;

  if p_adjust_cash and v_tx.type = 'topup' and v_tx.amount <> 0 then
    insert into public.cash_transactions (type, amount, date, description)
    values (
      'student_payment', -v_tx.amount, now(),
      'Annulation versement ' || v_student.first_name || ' ' || v_student.last_name
        || ' (' || v_tx.amount || ' DA)'
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'newBalance', v_new_balance,
    'reverted', v_tx.amount,
    'cashAdjusted', p_adjust_cash and v_tx.type = 'topup' and v_tx.amount <> 0
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Grants — personnel connecté uniquement (le rôle est revérifié dans la
--    fonction, qui est SECURITY DEFINER).
-- ---------------------------------------------------------------------------
revoke execute on function public.update_balance_tx(uuid, integer, text, timestamptz, balance_tx_type, boolean) from public, anon;
revoke execute on function public.delete_balance_tx(uuid, boolean) from public, anon;

grant execute on function public.update_balance_tx(uuid, integer, text, timestamptz, balance_tx_type, boolean) to authenticated;
grant execute on function public.delete_balance_tx(uuid, boolean) to authenticated;
