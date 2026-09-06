-- =============================================================================
-- ANNIVERSAIRES DES ÉLÈVES — le même calcul, côté base
-- Run once against the live project (Supabase Dashboard -> SQL Editor).
--
-- ---------------------------------------------------------------------------
-- CE QUE CE SCRIPT CHANGE, ET CE QU'IL NE CHANGE PAS
-- ---------------------------------------------------------------------------
-- IL NE CRÉE AUCUNE TABLE ET NE MODIFIE AUCUNE DONNÉE. Pas un solde, pas une
-- présence, pas une fiche élève. Il n'ajoute qu'un index, deux fonctions de
-- LECTURE, et affiche un contrôle à la fin.
--
-- L'ÉCRAN « ANNIVERSAIRES » FONCTIONNE SANS CE SCRIPT : la date de naissance
-- (`students.birth_date`) existe depuis la création de la base, et l'application
-- croise elle-même les fiches et l'emploi du temps du jour. Ce script sert à
-- trois choses, et à rien d'autre :
--
--   1. VÉRIFIER depuis l'éditeur SQL ce que l'écran annonce, sans le croire sur
--      parole (`select * from public.birthdays_on();`) ;
--   2. rendre la recherche « qui est né un 7 septembre » instantanée quand le
--      fichier élèves grandit (index) ;
--   3. donner un point d'entrée propre à tout ce qui viendra plus tard côté
--      serveur — un message WhatsApp de vœux, un export, une routine.
--
-- Ce script est IDEMPOTENT : ré-exécutable sans risque.
--
-- ---------------------------------------------------------------------------
-- LA RÈGLE, MOT POUR MOT CELLE DE L'APPLICATION
-- ---------------------------------------------------------------------------
-- Un élève est « fêté » un jour donné si le JOUR et le MOIS de sa naissance
-- tombent ce jour-là. Un 29 février se fête le 28 les trois années sur quatre où
-- il n'existe pas : sans cette règle, l'élève serait perdu tous les ans sauf un.
--
-- Il est « attendu » si, EN PLUS, l'emploi du temps du jour porte au moins une
-- de ses séances : le bon jour de semaine, et — pour une séance libre — à
-- l'intérieur de sa période de dates. C'est cette seconde liste, et elle seule,
-- qui lève une alerte dans l'application (pastille du menu, carte du tableau de
-- bord) : féliciter quelqu'un suppose qu'il passe la porte.
--
-- Le jour de semaine se lit en heure d'ALGER, comme partout ailleurs
-- (`scan_card`) : à minuit passé à Alger, il est encore la veille en UTC, et
-- l'emploi du temps du mauvais jour ferait apparaître ou disparaître des élèves.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. LA CLÉ D'ANNIVERSAIRE : "MM-DD"
-- ---------------------------------------------------------------------------
-- `to_char(date, 'MM-DD')` ferait la même chose mais n'est que STABLE (il
-- dépend des réglages de la session), et Postgres refuse d'indexer une
-- expression qui n'est pas IMMUTABLE. `extract` sur une date, elle, ne dépend
-- de rien : c'est donc elle qui porte la clé.
create or replace function public.birthday_key(d date)
returns text
language sql
immutable
strict
parallel safe
as $$
  select lpad(extract(month from d)::int::text, 2, '0')
      || '-'
      || lpad(extract(day   from d)::int::text, 2, '0');
$$;

comment on function public.birthday_key(date) is
  'Jour et mois d''une date, "MM-DD". Clé de rapprochement des anniversaires.';

-- L'index qui rend « qui est né ce jour-là » instantané. Partiel : la immense
-- majorité des lignes sans date de naissance n'a rien à y faire.
create index if not exists students_birthday_key_idx
  on public.students (public.birthday_key(birth_date))
  where birth_date is not null;

-- ---------------------------------------------------------------------------
-- 2. LE JOUR OÙ CET ANNIVERSAIRE SE FÊTE, UNE ANNÉE DONNÉE
-- ---------------------------------------------------------------------------
-- Rend la date réellement fêtée : le 29 février devient le 28 les années non
-- bissextiles. Rend NULL quand la fiche n'a pas de date de naissance.
create or replace function public.birthday_on_year(d date, p_year int)
returns date
language sql
immutable
parallel safe
as $$
  select case
    when d is null or p_year is null then null
    -- 29 février d'une année sans 29 février : fêté le 28.
    when public.birthday_key(d) = '02-29'
     and not (
       (p_year % 4 = 0 and p_year % 100 <> 0) or p_year % 400 = 0
     )
      then make_date(p_year, 2, 28)
    else make_date(p_year, extract(month from d)::int, extract(day from d)::int)
  end;
$$;

comment on function public.birthday_on_year(date, int) is
  'Date à laquelle cet anniversaire se fête l''année donnée (29/02 -> 28/02 hors année bissextile).';

-- ---------------------------------------------------------------------------
-- 3. LES ANNIVERSAIRES D'UNE JOURNÉE, AVEC L'EMPLOI DU TEMPS
-- ---------------------------------------------------------------------------
-- Une ligne par (élève fêté × séance qu'il suit ce jour-là). Un élève fêté SANS
-- séance ce jour-là rend UNE ligne, avec les colonnes de séance à NULL : c'est
-- lui qu'il ne faut PAS compter dans une alerte, et le distinguer d'un simple
-- « il n'a pas cours » vaut mieux que de le faire disparaître.
--
-- SECURITY INVOKER (le défaut, écrit ici pour qu'on n'en doute pas) : la
-- fonction lit avec les droits de l'appelant, donc la politique RLS `students`
-- s'applique. Un parent connecté n'y verra que ses propres enfants, exactement
-- comme dans le reste de l'application.
create or replace function public.birthdays_on(p_date date default null)
returns table (
  student_id    uuid,
  first_name    text,
  last_name     text,
  birth_date    date,
  age           int,
  phone         text,
  expected      boolean,
  session_id    uuid,
  session_label text,
  start_time    text,
  end_time      text,
  salle_name    text,
  teacher_name  text
)
language sql
stable
security invoker
set search_path = public
as $$
  with params as (
    -- Le jour observé, en heure d'Alger quand l'appelant n'en impose pas un.
    select coalesce(p_date, (now() at time zone 'Africa/Algiers')::date) as day_date
  ),
  ctx as (
    select
      day_date,
      extract(year from day_date)::int as day_year,
      (array['sunday','monday','tuesday','wednesday','thursday','friday','saturday']::day_of_week[])
        [extract(dow from day_date)::int + 1] as week_day
    from params
  ),
  celebrating as (
    select st.*, ctx.day_date, ctx.week_day
    from public.students st
    cross join ctx
    where st.birth_date is not null
      and public.birthday_on_year(st.birth_date, ctx.day_year) = ctx.day_date
  ),
  -- Les séances de l'élève réellement posées ce jour-là : le bon jour de
  -- semaine, et pour une séance libre, dans sa période de dates.
  mine as (
    select
      c.id as student_id,
      se.id as session_id,
      coalesce(nullif(se.title, ''), m.name) as session_label,
      se.start_time,
      se.end_time,
      sa.name as salle_name,
      nullif(trim(coalesce(t.first_name, '') || ' ' || coalesce(t.last_name, '')), '') as teacher_name
    from celebrating c
    join public.student_subscriptions ss on ss.student_id = c.id
    join public.subscriptions sub        on sub.id = ss.subscription_id
    join public.sessions se              on se.id = sub.session_id
    left join public.modules m           on m.id = se.module_id
    left join public.salles sa           on sa.id = se.salle_id
    left join public.teachers t          on t.id = se.teacher_id
    where c.week_day = any(se.days)
      and (se.period_start is null or se.period_start <= c.day_date)
      and (se.period_end   is null or se.period_end   >= c.day_date)
  )
  select
    c.id,
    c.first_name,
    c.last_name,
    c.birth_date,
    (extract(year from c.day_date)::int - extract(year from c.birth_date)::int) as age,
    c.phone,
    (mine.session_id is not null) as expected,
    mine.session_id,
    mine.session_label,
    mine.start_time,
    mine.end_time,
    mine.salle_name,
    mine.teacher_name
  from celebrating c
  left join mine on mine.student_id = c.id
  order by mine.start_time nulls last, c.first_name, c.last_name;
$$;

comment on function public.birthdays_on(date) is
  'Élèves fêtés une date donnée (aujourd''hui par défaut, heure d''Alger), avec leurs séances du jour. expected = a cours ce jour-là.';

grant execute on function public.birthday_key(date) to authenticated;
grant execute on function public.birthday_on_year(date, int) to authenticated;
grant execute on function public.birthdays_on(date) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. CONTRÔLE (lecture seule) — rien n'est corrigé ici
-- ---------------------------------------------------------------------------
-- a) Ce que l'écran doit afficher aujourd'hui :
--        select * from public.birthdays_on();
-- b) Le compte des élèves attendus (celui de la pastille du menu) :
--        select count(distinct student_id) from public.birthdays_on() where expected;
--
-- c) Et l'angle mort : une fiche sans date de naissance ne sera JAMAIS fêtée.
--    Cette requête les compte — c'est la seule chose à corriger à la main, et
--    elle se corrige depuis la fiche de l'élève, pas ici.
do $$
declare
  v_missing int;
  v_total   int;
begin
  select count(*) filter (where birth_date is null), count(*)
    into v_missing, v_total
    from public.students;

  raise notice 'Anniversaires : % élève(s) sur % sans date de naissance — ils ne seront jamais signalés tant que la case reste vide.',
    v_missing, v_total;
end $$;
