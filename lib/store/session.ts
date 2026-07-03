"use client";

import { create } from "zustand";
import { createClient } from "@/lib/supabase/client";

export type Role = "admin" | "reception" | "student" | "teacher" | "parent";

export interface SessionUser {
  id: string;
  name: string;
  /** Kept for UI compatibility with existing pages; holds the account email. */
  username: string;
  email: string;
  role: Role;
  /** Links to the underlying Student/Teacher/Parent/ReceptionStaff row — always
   *  equal to `id` since those tables share their primary key with auth.users. */
  entityId?: string;
}

interface SessionState {
  user: SessionUser | null;
  hydrated: boolean;
  login: (user: SessionUser) => void;
  logout: () => Promise<void>;
  setHydrated: () => void;
  /** Reads the current Supabase Auth session (if any) and keeps the store in
   *  sync with future sign-in/sign-out events. Safe to call multiple times. */
  initSession: () => Promise<void>;
}

let listenerAttached = false;

async function loadSessionUser(userId: string, email: string | null): Promise<SessionUser | null> {
  const supabase = createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, full_name")
    .eq("id", userId)
    .single();
  if (!profile) return null;
  return {
    id: userId,
    name: profile.full_name,
    username: email ?? "",
    email: email ?? "",
    role: profile.role as Role,
    entityId: userId,
  };
}

export const useSession = create<SessionState>((set) => ({
  user: null,
  hydrated: false,

  login: (user) => set({ user }),

  logout: async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    set({ user: null });
  },

  setHydrated: () => set({ hydrated: true }),

  initSession: async () => {
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (session?.user) {
      const user = await loadSessionUser(session.user.id, session.user.email ?? null);
      set({ user, hydrated: true });
    } else {
      set({ user: null, hydrated: true });
    }

    if (!listenerAttached) {
      listenerAttached = true;
      supabase.auth.onAuthStateChange(async (event, changedSession) => {
        if (event === "SIGNED_OUT" || !changedSession) {
          set({ user: null });
          return;
        }
        const user = await loadSessionUser(changedSession.user.id, changedSession.user.email ?? null);
        set({ user });
      });
    }
  },
}));
