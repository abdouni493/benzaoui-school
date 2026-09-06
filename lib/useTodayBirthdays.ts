"use client";

import { useMemo } from "react";
import { useData } from "@/lib/store/data";
import { birthdayRosterOf, type BirthdayRoster } from "@/lib/birthdays";
import { todayIso } from "@/lib/helpers";

export interface TodayBirthdays extends BirthdayRoster {
  /** la journée observée, "YYYY-MM-DD" en heure locale */
  date: string;
}

/**
 * Les anniversaires d'AUJOURD'HUI, lus sur le miroir déjà chargé.
 *
 * La date est recalculée à chaque rendu : l'application reste ouverte des
 * journées entières à l'accueil, et une date figée au montage aurait continué
 * d'annoncer les anniversaires de la veille après minuit.
 *
 * Le même calcul sert la pastille du menu, l'alerte du tableau de bord, les
 * 🎂 de l'emploi du temps et la page Anniversaires : une seule règle, donc
 * jamais deux comptes différents à l'écran.
 */
export function useTodayBirthdays(): TodayBirthdays {
  const students = useData((s) => s.students);
  const sessions = useData((s) => s.sessions);
  const subscriptions = useData((s) => s.subscriptions);
  const date = todayIso();

  const roster = useMemo(
    () => birthdayRosterOf({ students, sessions, subscriptions, date }),
    [students, sessions, subscriptions, date],
  );

  return { ...roster, date };
}
