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
  const fetchAll = useData((s) => s.fetchAll);
  const clearData = useData((s) => s.clear);
  const processWeeklyAbsences = useData((s) => s.processWeeklyAbsences);

  useEffect(() => {
    fetchSchool();
    initSession();
  }, [initSession, fetchSchool]);

  useEffect(() => {
    if (!hydrated) return;
    if (user) {
      fetchAll();
      // Staff load is the safety-net trigger for the automatic weekly-absence
      // billing (server-side, idempotent, throttled to once/day). The action
      // re-fetches on its own if it charged anything, so any freshly-written
      // debits show up without an extra refresh here.
      if (user.role === "admin" || user.role === "reception") {
        processWeeklyAbsences();
      }
    } else {
      clearData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, user?.id]);

  return <>{children}</>;
}
