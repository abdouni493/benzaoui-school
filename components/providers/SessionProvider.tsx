"use client";

import { useEffect } from "react";
import { useSession } from "@/lib/store/session";
import { useData } from "@/lib/store/data";

/** Bootstraps the Supabase Auth session once at the root of the app, before
 *  the login page or AppShell's auth guard read `hydrated`/`user`. Also drives
 *  the data store: the "school" branding row is public (needed pre-login),
 *  everything else loads once a session exists and is cleared on sign-out. */
export function SessionProvider({ children }: { children: React.ReactNode }) {
  const initSession = useSession((s) => s.initSession);
  const user = useSession((s) => s.user);
  const hydrated = useSession((s) => s.hydrated);
  const fetchSchool = useData((s) => s.fetchSchool);
  const startData = useData((s) => s.start);
  const clearData = useData((s) => s.clear);

  useEffect(() => {
    fetchSchool();
    initSession();
  }, [initSession, fetchSchool]);

  useEffect(() => {
    if (!hydrated) return;
    if (user) {
      // La copie locale s'affiche aussitôt (si elle existe), puis seules les
      // lignes changées depuis sont téléchargées ; sinon, chargement complet.
      //
      // La facturation automatique des absences a été RETIRÉE : plus aucune
      // séance n'est débitée du solde d'un élève à cause d'une absence. On ne
      // déclenche donc plus process_weekly_absences() au chargement du staff.
      void startData(user.id);
    } else {
      clearData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, user?.id]);

  return <>{children}</>;
}
