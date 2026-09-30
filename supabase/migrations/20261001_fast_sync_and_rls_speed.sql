-- =============================================================================
-- Vitesse : l'application ne recharge plus TOUTE la base après chaque geste
-- Run once against the live project (Supabase Dashboard -> SQL Editor).
-- IDEMPOTENT : ré-exécutable sans risque. Aucune donnée n'est modifiée.
--
-- Le symptôme
-- -----------
-- Sur le compte administrateur, tout était lent : l'ouverture, chaque scan,
-- chaque versement, chaque enregistrement. La cause n'était pas le réseau mais
-- la méthode : après CHAQUE écriture, le navigateur relisait les 38 tables de
-- l'école en entier, page par page — l'historique des soldes, toutes les
-- présences, toute la caisse — pour n'en garder que les deux ou trois lignes
-- qui venaient de changer. Plus l'école vivait, plus chaque clic coûtait.
--
-- Ce que ce script apporte
-- ------------------------
--   1. `updated_at` sur chaque table lue par l'application, tenu par un
--      déclencheur : la base sait désormais QUAND une ligne a changé.
--   2. `sync_deletions` : la trace des lignes supprimées (une présence annulée,
--      une transaction retirée), sans laquelle le navigateur les garderait.
--   3. `sync_changes(p_since)` : UNE requête qui rend tout ce qui a changé
--      depuis la dernière fois — quelques lignes au lieu de milliers.
--   4. Les policies RLS réécrites pour être évaluées UNE fois par requête au
--      lieu d'une fois par ligne (`(select public.is_staff())`). Les droits ne
--      changent pas d'un iota : mêmes lignes visibles, mêmes comptes.
--
-- Sans ce script, l'application fonctionne comme avant (rechargement complet) ;
-- avec lui, elle ne télécharge plus que ce qui a changé.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- 1. `updated_at` sur chaque table synchronisée
-- ---------------------------------------------------------------------------
-- La valeur par défaut `now()` est évaluée UNE fois par `add column` (Postgres
-- 11+) : aucune réécriture de table, l'ajout est instantané même sur les
-- grosses tables. Le déclencheur la tient ensuite à jour, à l'insertion comme
-- à la modification — la valeur envoyée par un client est ignorée : seule
-- l'horloge du serveur fait foi.

create or replace function public.sync_touch_updated_at()
returns trigger
language plpgsql as $fn$
begin
  new.updated_at := now();
  return new;
end;
$fn$;

do $do$
declare
  v_t text;
begin
  foreach v_t in array array[
    'school', 'profiles', 'filieres', 'modules', 'groups', 'salles', 'classes',
    'teachers', 'teacher_payments', 'reception_staff', 'worker_shifts',
    'worker_payments', 'student_credentials', 'module_absence_rules', 'sessions',
    'subscriptions', 'free_periods', 'students', 'balance_tx', 'attendance',
    'absence_penalties', 'unpaid_teacher_sessions', 'teacher_acomptes',
    'teacher_absences', 'subjects', 'announcements', 'expense_categories',
    'expenses', 'cash_transactions', 'parents', 'notifications', 'coursework',
    'independent_sessions', 'private_sessions', 'private_session_modules',
    'private_session_students'
  ] loop
    -- Une table d'une migration pas encore passée est simplement ignorée.
    if to_regclass('public.' || v_t) is null then
      continue;
    end if;

    execute format(
      'alter table public.%I add column if not exists updated_at timestamptz not null default now()',
      v_t
    );
    execute format('drop trigger if exists trg_sync_updated_at on public.%I', v_t);
    execute format(
      'create trigger trg_sync_updated_at before insert or update on public.%I '
      'for each row execute function public.sync_touch_updated_at()',
      v_t
    );
    execute format(
      'create index if not exists %I on public.%I (updated_at)',
      v_t || '_updated_at_idx', v_t
    );
  end loop;
end $do$;


-- ---------------------------------------------------------------------------
-- 2. Les lignes « embarquées » : un changement ailleurs date aussi la fiche
-- ---------------------------------------------------------------------------
-- La fiche élève est lue AVEC ses inscriptions (`student_subscriptions`), et la
-- fiche parent AVEC la liste de ses enfants. Inscrire un élève à un module ne
-- touche pas la ligne `students` : sans ces déclencheurs, la synchronisation
-- ne verrait jamais la nouvelle inscription.
--
-- SECURITY DEFINER : le déclencheur ne fait que dater la fiche (`updated_at`),
-- il doit le faire quel que soit le compte qui a modifié l'inscription.

create or replace function public.sync_touch_student_from_enrollment()
returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    update public.students set updated_at = now() where id = old.student_id;
  end if;
  if tg_op in ('INSERT', 'UPDATE') and (tg_op = 'INSERT' or new.student_id is distinct from old.student_id) then
    update public.students set updated_at = now() where id = new.student_id;
  end if;
  return null;
end;
$fn$;

drop trigger if exists trg_sync_touch_student on public.student_subscriptions;
create trigger trg_sync_touch_student
  after insert or update or delete on public.student_subscriptions
  for each row execute function public.sync_touch_student_from_enrollment();

create or replace function public.sync_touch_parent_from_student()
returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  if tg_op in ('UPDATE', 'DELETE') and old.parent_id is not null then
    if tg_op = 'DELETE' or new.parent_id is distinct from old.parent_id then
      update public.parents set updated_at = now() where id = old.parent_id;
    end if;
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.parent_id is not null then
    if tg_op = 'INSERT' or new.parent_id is distinct from old.parent_id then
      update public.parents set updated_at = now() where id = new.parent_id;
    end if;
  end if;
  return null;
end;
$fn$;

drop trigger if exists trg_sync_touch_parent on public.students;
create trigger trg_sync_touch_parent
  after insert or update of parent_id or delete on public.students
  for each row execute function public.sync_touch_parent_from_student();

revoke execute on function public.sync_touch_student_from_enrollment() from public, anon, authenticated;
revoke execute on function public.sync_touch_parent_from_student() from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 3. La trace des suppressions
-- ---------------------------------------------------------------------------
-- Une ligne supprimée ne peut pas dire elle-même qu'elle a disparu. Chaque
-- suppression laisse donc ici sa table et sa clé — rien d'autre : ni montant,
-- ni nom. La trace s'efface d'elle-même après 45 jours.

create table if not exists public.sync_deletions (
  id bigserial primary key,
  table_name text not null,
  row_key text not null,
  deleted_at timestamptz not null default now()
);

create index if not exists sync_deletions_deleted_at_idx on public.sync_deletions (deleted_at);

alter table public.sync_deletions enable row level security;

-- Lecture seule pour les comptes connectés : une clé de ligne supprimée n'est
-- pas une information. Aucune policy d'écriture : seul le déclencheur écrit.
drop policy if exists sync_deletions_select on public.sync_deletions;
create policy sync_deletions_select on public.sync_deletions for select to authenticated
  using (true);

revoke insert, update, delete, truncate on public.sync_deletions from anon, authenticated;
grant select on public.sync_deletions to authenticated;

-- TG_ARGV[0] = la colonne clé de la table (`id`, sauf les deux tables dont la
-- clé primaire est une référence).
create or replace function public.sync_record_deletion()
returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  insert into public.sync_deletions (table_name, row_key)
  values (tg_table_name, to_jsonb(old) ->> tg_argv[0]);
  -- Ménage occasionnel : un appel sur cinquante suffit à garder la table petite.
  if random() < 0.02 then
    delete from public.sync_deletions where deleted_at < now() - interval '45 days';
  end if;
  return old;
end;
$fn$;

revoke execute on function public.sync_record_deletion() from public, anon, authenticated;

do $do$
declare
  v_pair text[];
begin
  foreach v_pair slice 1 in array array[
    ['profiles', 'id'], ['filieres', 'id'], ['modules', 'id'], ['groups', 'id'],
    ['salles', 'id'], ['classes', 'id'], ['teachers', 'id'],
    ['teacher_payments', 'id'], ['reception_staff', 'id'], ['worker_shifts', 'id'],
    ['worker_payments', 'id'], ['student_credentials', 'student_id'],
    ['module_absence_rules', 'module_id'], ['sessions', 'id'],
    ['subscriptions', 'id'], ['free_periods', 'id'], ['students', 'id'],
    ['balance_tx', 'id'], ['attendance', 'id'], ['absence_penalties', 'id'],
    ['unpaid_teacher_sessions', 'id'], ['teacher_acomptes', 'id'],
    ['teacher_absences', 'id'], ['subjects', 'id'], ['announcements', 'id'],
    ['expense_categories', 'id'], ['expenses', 'id'], ['cash_transactions', 'id'],
    ['parents', 'id'], ['notifications', 'id'], ['coursework', 'id'],
    ['independent_sessions', 'id'], ['private_sessions', 'id'],
    ['private_session_modules', 'id'], ['private_session_students', 'id']
  ] loop
    if to_regclass('public.' || v_pair[1]) is null then
      continue;
    end if;
    execute format('drop trigger if exists trg_sync_record_deletion on public.%I', v_pair[1]);
    execute format(
      'create trigger trg_sync_record_deletion after delete on public.%I '
      'for each row execute function public.sync_record_deletion(%L)',
      v_pair[1], v_pair[2]
    );
  end loop;
end $do$;


-- ---------------------------------------------------------------------------
-- 4. `sync_changes` : tout ce qui a changé, en UNE requête
-- ---------------------------------------------------------------------------
-- SECURITY INVOKER : chaque ligne passe par les policies RLS du compte qui
-- appelle, exactement comme une lecture directe. Un parent ne reçoit que ce
-- qu'il voit déjà ; la fonction n'ouvre aucune porte.
--
-- STABLE : toutes les lectures partagent le même instantané de la base, donc
-- une réponse cohérente d'une table à l'autre.
--
-- Recouvrement de 2 minutes : une transaction commencée juste avant l'appel
-- précédent mais validée juste après porte une date antérieure au curseur. On
-- relit donc un peu en arrière ; une ligne reçue deux fois ne coûte rien, une
-- ligne jamais reçue fausserait un solde.
--
-- Sans curseur (`p_since` nul), elle ne rend que l'heure du serveur : c'est le
-- point de départ d'un chargement complet.

create or replace function public.sync_changes(p_since timestamptz default null)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $fn$
declare
  v_now timestamptz := now();
  v_since timestamptz;
  v_tables jsonb := '{}'::jsonb;
  v_rows jsonb;
  v_deleted jsonb;
  v_t text;
begin
  if p_since is null then
    return jsonb_build_object('now', v_now, 'tables', '{}'::jsonb, 'deleted', '[]'::jsonb);
  end if;

  v_since := p_since - interval '2 minutes';

  foreach v_t in array array[
    'school', 'profiles', 'filieres', 'modules', 'groups', 'salles', 'classes',
    'teachers', 'teacher_payments', 'reception_staff', 'worker_shifts',
    'worker_payments', 'student_credentials', 'module_absence_rules', 'sessions',
    'subscriptions', 'free_periods', 'students', 'balance_tx', 'attendance',
    'absence_penalties', 'unpaid_teacher_sessions', 'teacher_acomptes',
    'teacher_absences', 'subjects', 'announcements', 'expense_categories',
    'expenses', 'cash_transactions', 'parents', 'notifications', 'coursework',
    'independent_sessions', 'private_sessions', 'private_session_modules',
    'private_session_students'
  ] loop
    -- Table absente, ou colonne pas encore posée : on passe, sans échouer.
    if not exists (
      select 1 from pg_attribute
      where attrelid = to_regclass('public.' || v_t)
        and attname = 'updated_at'
        and not attisdropped
    ) then
      continue;
    end if;

    if v_t = 'students' then
      -- Même forme que la lecture de l'application : la fiche + ses inscriptions.
      select coalesce(jsonb_agg(
               to_jsonb(s) || jsonb_build_object(
                 'student_subscriptions',
                 coalesce((select jsonb_agg(to_jsonb(ss))
                             from public.student_subscriptions ss
                            where ss.student_id = s.id), '[]'::jsonb)
               )), '[]'::jsonb)
        into v_rows
        from public.students s
       where s.updated_at > v_since;
    elsif v_t = 'parents' then
      -- La fiche parent + l'identifiant de chacun de ses enfants.
      select coalesce(jsonb_agg(
               to_jsonb(p) || jsonb_build_object(
                 'students',
                 coalesce((select jsonb_agg(jsonb_build_object('id', st.id))
                             from public.students st
                            where st.parent_id = p.id), '[]'::jsonb)
               )), '[]'::jsonb)
        into v_rows
        from public.parents p
       where p.updated_at > v_since;
    else
      execute format(
        'select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) from public.%I t where t.updated_at > $1',
        v_t
      ) into v_rows using v_since;
    end if;

    if jsonb_array_length(v_rows) > 0 then
      v_tables := v_tables || jsonb_build_object(v_t, v_rows);
    end if;
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object('table', d.table_name, 'key', d.row_key)), '[]'::jsonb)
    into v_deleted
    from public.sync_deletions d
   where d.deleted_at > v_since;

  return jsonb_build_object('now', v_now, 'tables', v_tables, 'deleted', v_deleted);
end;
$fn$;

revoke execute on function public.sync_changes(timestamptz) from public, anon;
grant execute on function public.sync_changes(timestamptz) to authenticated;


-- ---------------------------------------------------------------------------
-- 5. Policies RLS : évaluées une fois par requête, plus une fois par ligne
-- ---------------------------------------------------------------------------
-- `public.is_staff()` écrit nu dans une policy est appelé pour CHAQUE ligne
-- lue — et chaque appel relit le profil du compte. Sur l'historique des soldes
-- ou des présences, des milliers d'appels identiques par lecture.
--
-- Entouré d'un `select`, Postgres le calcule une seule fois (InitPlan) puis
-- réutilise le résultat. Même chose pour `auth.uid()` et `current_role()`.
-- Les fonctions qui dépendent de la LIGNE (`is_my_child(student_id)`,
-- `teaches_session(session_id)`…) restent telles quelles : elles ne peuvent
-- pas être calculées d'avance.
--
-- CHAQUE policy ci-dessous garde exactement sa condition d'origine.

-- ---- helpers : « personnel seulement », la forme la plus courante ------------
do $do$
declare
  v_pair text[];
begin
  -- [table, policy] : policies FOR ALL réservées au personnel.
  foreach v_pair slice 1 in array array[
    ['absence_penalties', 'absence_penalties_write'],
    ['announcements', 'announcements_write'],
    ['balance_tx', 'balance_tx_write'],
    ['cash_transactions', 'cash_transactions_all'],
    ['classes', 'classes_write'],
    ['coursework', 'coursework_write'],
    ['expense_categories', 'expense_categories_all'],
    ['expenses', 'expenses_all'],
    ['filieres', 'filieres_write'],
    ['free_periods', 'free_periods_write'],
    ['groups', 'groups_write'],
    ['independent_sessions', 'independent_sessions_all'],
    ['module_absence_rules', 'module_absence_rules_write'],
    ['modules', 'modules_write'],
    ['private_session_modules', 'private_session_modules_write'],
    ['private_session_students', 'private_session_students_write'],
    ['private_sessions', 'private_sessions_write'],
    ['salles', 'salles_write'],
    ['sessions', 'sessions_write'],
    ['student_credentials', 'student_credentials_staff'],
    ['student_subscriptions', 'student_subscriptions_write'],
    ['subscriptions', 'subscriptions_write'],
    ['teacher_absences', 'teacher_absences_write'],
    ['teacher_acomptes', 'teacher_acomptes_write'],
    ['teacher_payments', 'teacher_payments_write'],
    ['unpaid_teacher_sessions', 'unpaid_teacher_sessions_write'],
    ['whatsapp_contacts', 'whatsapp_contacts_all'],
    ['whatsapp_messages', 'whatsapp_messages_all'],
    ['whatsapp_outbox', 'whatsapp_outbox_all'],
    ['worker_payments', 'worker_payments_write'],
    ['worker_shifts', 'worker_shifts_write']
  ] loop
    if to_regclass('public.' || v_pair[1]) is null then
      continue;
    end if;
    execute format('drop policy if exists %I on public.%I', v_pair[2], v_pair[1]);
    execute format(
      'create policy %I on public.%I for all to authenticated '
      'using ((select public.is_staff())) with check ((select public.is_staff()))',
      v_pair[2], v_pair[1]
    );
  end loop;
end $do$;

-- ---- school --------------------------------------------------------------------
drop policy if exists school_write on public.school;
create policy school_write on public.school for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- ---- profiles ------------------------------------------------------------------
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.is_staff()));

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()))
  with check (id = (select auth.uid()) or (select public.is_admin()));

-- ---- teachers ------------------------------------------------------------------
drop policy if exists teachers_insert on public.teachers;
create policy teachers_insert on public.teachers for insert to authenticated
  with check ((select public.is_staff()));

drop policy if exists teachers_update on public.teachers;
create policy teachers_update on public.teachers for update to authenticated
  using ((select public.is_staff()) or id = (select auth.uid()))
  with check ((select public.is_staff()) or id = (select auth.uid()));

drop policy if exists teachers_delete on public.teachers;
create policy teachers_delete on public.teachers for delete to authenticated
  using ((select public.is_staff()));

-- ---- reception_staff (travailleurs) -------------------------------------------
drop policy if exists reception_staff_select on public.reception_staff;
create policy reception_staff_select on public.reception_staff for select to authenticated
  using ((select public.is_staff()) or id = (select auth.uid()));

drop policy if exists reception_staff_insert on public.reception_staff;
create policy reception_staff_insert on public.reception_staff for insert to authenticated
  with check ((select public.is_staff()));

drop policy if exists reception_staff_update on public.reception_staff;
create policy reception_staff_update on public.reception_staff for update to authenticated
  using ((select public.is_staff()) or id = (select auth.uid()))
  with check ((select public.is_staff()) or id = (select auth.uid()));

drop policy if exists reception_staff_delete on public.reception_staff;
create policy reception_staff_delete on public.reception_staff for delete to authenticated
  using ((select public.is_staff()));

-- ---- parents -------------------------------------------------------------------
drop policy if exists parents_select on public.parents;
create policy parents_select on public.parents for select to authenticated
  using ((select public.is_staff()) or id = (select auth.uid()) or exists (
    select 1 from public.students st where st.parent_id = parents.id and st.id = (select auth.uid())
  ));

drop policy if exists parents_insert on public.parents;
create policy parents_insert on public.parents for insert to authenticated
  with check ((select public.is_staff()));

drop policy if exists parents_update on public.parents;
create policy parents_update on public.parents for update to authenticated
  using ((select public.is_staff()) or id = (select auth.uid()))
  with check ((select public.is_staff()) or id = (select auth.uid()));

drop policy if exists parents_delete on public.parents;
create policy parents_delete on public.parents for delete to authenticated
  using ((select public.is_staff()));

-- ---- students ------------------------------------------------------------------
drop policy if exists students_select on public.students;
create policy students_select on public.students for select to authenticated
  using (
    (select public.is_staff())
    or id = (select auth.uid())
    or parent_id = (select auth.uid())
    or public.teaches_student(id)
  );

drop policy if exists students_insert on public.students;
create policy students_insert on public.students for insert to authenticated
  with check ((select public.is_staff()));

drop policy if exists students_update on public.students;
create policy students_update on public.students for update to authenticated
  using ((select public.is_staff()) or id = (select auth.uid()))
  with check ((select public.is_staff()) or id = (select auth.uid()));

drop policy if exists students_delete on public.students;
create policy students_delete on public.students for delete to authenticated
  using ((select public.is_staff()));

-- ---- balance_tx / absence_penalties / attendance -------------------------------
drop policy if exists balance_tx_select on public.balance_tx;
create policy balance_tx_select on public.balance_tx for select to authenticated
  using (
    (select public.is_staff())
    or student_id = (select auth.uid())
    or public.is_my_child(student_id)
    or public.teaches_student(student_id)
  );

do $do$ begin
  if to_regclass('public.absence_penalties') is not null then
    execute 'drop policy if exists absence_penalties_select on public.absence_penalties';
    execute $pol$
      create policy absence_penalties_select on public.absence_penalties for select to authenticated
        using (
          (select public.is_staff())
          or student_id = (select auth.uid())
          or public.is_my_child(student_id)
          or public.teaches_student(student_id)
        )
    $pol$;
  end if;
end $do$;

drop policy if exists attendance_select on public.attendance;
create policy attendance_select on public.attendance for select to authenticated
  using (
    (select public.is_staff())
    or student_id = (select auth.uid())
    or public.is_my_child(student_id)
    or public.teaches_session(session_id)
  );

drop policy if exists attendance_write on public.attendance;
create policy attendance_write on public.attendance for all to authenticated
  using ((select public.is_staff()) or public.teaches_session(session_id))
  with check ((select public.is_staff()) or public.teaches_session(session_id));

-- ---- enseignants : dues, acomptes, absences, règlements ------------------------
drop policy if exists unpaid_teacher_sessions_select on public.unpaid_teacher_sessions;
create policy unpaid_teacher_sessions_select on public.unpaid_teacher_sessions for select to authenticated
  using ((select public.is_staff()) or teacher_id = (select auth.uid()));

drop policy if exists teacher_acomptes_select on public.teacher_acomptes;
create policy teacher_acomptes_select on public.teacher_acomptes for select to authenticated
  using ((select public.is_staff()) or staff_id = (select auth.uid()));

drop policy if exists teacher_absences_select on public.teacher_absences;
create policy teacher_absences_select on public.teacher_absences for select to authenticated
  using ((select public.is_staff()) or staff_id = (select auth.uid()));

do $do$ begin
  if to_regclass('public.teacher_payments') is not null then
    execute 'drop policy if exists teacher_payments_select on public.teacher_payments';
    execute $pol$
      create policy teacher_payments_select on public.teacher_payments for select to authenticated
        using ((select public.is_staff()) or teacher_id = (select auth.uid()))
    $pol$;
  end if;
end $do$;

-- ---- travailleurs : pointages et règlements ------------------------------------
do $do$ begin
  if to_regclass('public.worker_shifts') is not null then
    execute 'drop policy if exists worker_shifts_select on public.worker_shifts';
    execute $pol$
      create policy worker_shifts_select on public.worker_shifts for select to authenticated
        using ((select public.is_staff()) or worker_id = (select auth.uid()))
    $pol$;
  end if;
  if to_regclass('public.worker_payments') is not null then
    execute 'drop policy if exists worker_payments_select on public.worker_payments';
    execute $pol$
      create policy worker_payments_select on public.worker_payments for select to authenticated
        using ((select public.is_staff()) or worker_id = (select auth.uid()))
    $pol$;
  end if;
end $do$;

-- ---- contenus : matières, annonces, notifications, stages ----------------------
drop policy if exists subjects_write on public.subjects;
create policy subjects_write on public.subjects for all to authenticated
  using ((select public.is_staff()) or public.teaches_session(session_id))
  with check ((select public.is_staff()) or public.teaches_session(session_id));

do $do$ begin
  -- La version ciblée par groupes (20260810) a besoin de sa fonction ; sur une
  -- base qui ne l'a pas, la policy d'origine est laissée en place.
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'sees_announcement_groups')
     and exists (select 1 from pg_attribute
                 where attrelid = 'public.announcements'::regclass
                   and attname = 'include_parents' and not attisdropped) then
    execute 'drop policy if exists announcements_select on public.announcements';
    execute $pol$
      create policy announcements_select on public.announcements for select to authenticated
        using (
          (select public.is_staff())
          or (
            public.sees_announcement_groups(target_group_ids)
            and (
              audience = 'all'
              or (audience = 'students' and (select public.current_role()) = 'student')
              or (audience = 'teachers' and (select public.current_role()) = 'teacher')
              or (audience = 'parents'  and (select public.current_role()) = 'parent')
              or (include_parents and (select public.current_role()) = 'parent'
                  and coalesce(array_length(target_group_ids, 1), 0) > 0)
            )
          )
        )
    $pol$;
  end if;
end $do$;

drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications for select to authenticated
  using ((select public.is_staff()) or parent_id = (select auth.uid()));

drop policy if exists notifications_insert on public.notifications;
create policy notifications_insert on public.notifications for insert to authenticated
  with check ((select public.is_staff()));

drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications for update to authenticated
  using ((select public.is_staff()) or parent_id = (select auth.uid()))
  with check ((select public.is_staff()) or parent_id = (select auth.uid()));

drop policy if exists notifications_delete on public.notifications;
create policy notifications_delete on public.notifications for delete to authenticated
  using ((select public.is_staff()));

drop policy if exists coursework_select on public.coursework;
create policy coursework_select on public.coursework for select to authenticated
  using ((select public.is_staff()) or teacher_id = (select auth.uid()));

-- ---- séances particulières (sans récursion, cf. 20260916) ----------------------
do $do$ begin
  if to_regclass('public.private_sessions') is not null
     and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'teaches_private_session') then
    execute 'drop policy if exists private_sessions_select on public.private_sessions';
    execute $pol$
      create policy private_sessions_select on public.private_sessions for select to authenticated
        using (
          (select public.is_staff())
          or student_id = (select auth.uid())
          or public.is_my_child(student_id)
          or public.teaches_private_session(private_sessions.id)
          or public.attends_private_session(private_sessions.id)
        )
    $pol$;

    execute 'drop policy if exists private_session_modules_select on public.private_session_modules';
    execute $pol$
      create policy private_session_modules_select on public.private_session_modules for select to authenticated
        using (
          (select public.is_staff())
          or teacher_id = (select auth.uid())
          or public.attends_private_session(private_session_id)
        )
    $pol$;
  end if;

  if to_regclass('public.private_session_students') is not null
     and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'teaches_private_session') then
    execute 'drop policy if exists private_session_students_select on public.private_session_students';
    execute $pol$
      create policy private_session_students_select on public.private_session_students
        for select to authenticated
        using (
          (select public.is_staff())
          or student_id = (select auth.uid())
          or public.is_my_child(student_id)
          or public.teaches_private_session(private_session_id)
        )
    $pol$;
  end if;
end $do$;


-- ---------------------------------------------------------------------------
-- 6. Index utiles aux écrans les plus lus
-- ---------------------------------------------------------------------------
-- La fiche élève, la fiche classe et le tableau de bord lisent l'historique
-- d'un élève et les présences d'un créneau, du plus récent au plus ancien.
create index if not exists balance_tx_student_date_idx on public.balance_tx (student_id, date desc);
create index if not exists attendance_session_date_idx on public.attendance (session_id, occurred_at desc);
create index if not exists cash_transactions_date_idx on public.cash_transactions (date desc);


-- ---------------------------------------------------------------------------
-- 7. Rechargement du cache de schéma de l'API REST
-- ---------------------------------------------------------------------------
notify pgrst, 'reload schema';


-- ---------------------------------------------------------------------------
-- 8. Inventaire : ce script a-t-il tout posé ?
--    Le résultat doit être VIDE. Chaque ligne nomme ce qui manque encore.
-- ---------------------------------------------------------------------------
with synced (table_name) as (values
  ('school'), ('profiles'), ('filieres'), ('modules'), ('groups'), ('salles'),
  ('classes'), ('teachers'), ('teacher_payments'), ('reception_staff'),
  ('worker_shifts'), ('worker_payments'), ('student_credentials'),
  ('module_absence_rules'), ('sessions'), ('subscriptions'), ('free_periods'),
  ('students'), ('balance_tx'), ('attendance'), ('absence_penalties'),
  ('unpaid_teacher_sessions'), ('teacher_acomptes'), ('teacher_absences'),
  ('subjects'), ('announcements'), ('expense_categories'), ('expenses'),
  ('cash_transactions'), ('parents'), ('notifications'), ('coursework'),
  ('independent_sessions'), ('private_sessions'), ('private_session_modules'),
  ('private_session_students')
)
select 'TABLE MANQUANTE (migration antérieure à passer)' as quoi, table_name as objet
from synced
where to_regclass('public.' || table_name) is null
union all
select 'COLONNE updated_at MANQUANTE', table_name
from synced
where to_regclass('public.' || table_name) is not null
  and not exists (select 1 from pg_attribute
                  where attrelid = to_regclass('public.' || table_name)
                    and attname = 'updated_at' and not attisdropped)
union all
select 'DÉCLENCHEUR updated_at MANQUANT', table_name
from synced
where to_regclass('public.' || table_name) is not null
  and not exists (select 1 from pg_trigger
                  where tgrelid = to_regclass('public.' || table_name)
                    and tgname = 'trg_sync_updated_at')
union all
select 'FONCTION MANQUANTE', 'sync_changes'
where not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'sync_changes')
union all
-- Une policy qui appelle encore is_staff() / is_admin() ligne par ligne : un
-- appel nu de plus que d'appels entourés d'un SELECT.
select 'POLICY NON OPTIMISÉE', p.tablename || ' / ' || p.policyname
from pg_policies p
cross join lateral (
  select replace(coalesce(p.qual, '') || ' ' || coalesce(p.with_check, ''), 'public.', '') as expr
) e
where p.schemaname = 'public'
  and (regexp_count(e.expr, 'is_staff\(\)') > regexp_count(e.expr, 'SELECT is_staff\(\)')
    or regexp_count(e.expr, 'is_admin\(\)') > regexp_count(e.expr, 'SELECT is_admin\(\)'));
