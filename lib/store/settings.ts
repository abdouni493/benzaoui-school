"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { AttendanceOpenMode } from "@/lib/types";

export type Theme = "purple" | "dark-red";
export type Language = "fr" | "ar";

export type { AttendanceOpenMode };

/** Clé d'une feuille démarrée à la main : un pointage par séance ET par jour. */
export const rollCallKey = (date: string, sessionId: string) => `${date}|${sessionId}`;

interface SettingsState {
  theme: Theme;
  language: Language;
  hydrated: boolean;
  autoSendWhatsapp: boolean;
  autoSendEmail: boolean;
  /** Mode d'ouverture de la feuille de pointage. */
  attendanceOpenMode: AttendanceOpenMode;
  /** Mode "lead" : minutes d'avance sur le début de la séance (0 = à l'heure). */
  attendanceOpenLead: number;
  /** Mode "fixed" : heure "HH:mm" à partir de laquelle on peut pointer. */
  attendanceOpenAt: string;
  /** Feuilles démarrées à la main, par `rollCallKey(jour, séance)`. */
  rollCallStarted: Record<string, true>;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  setLanguage: (language: Language) => void;
  toggleLanguage: () => void;
  setAutoSendWhatsapp: (val: boolean) => void;
  setAutoSendEmail: (val: boolean) => void;
  setAttendanceOpenMode: (mode: AttendanceOpenMode) => void;
  setAttendanceOpenLead: (minutes: number) => void;
  setAttendanceOpenAt: (time: string) => void;
  /** Ouvre la feuille d'UNE séance, pour CE jour-là. */
  startRollCall: (date: string, sessionId: string) => void;
  /** Referme cette même feuille (pointage rouvert par erreur). */
  stopRollCall: (date: string, sessionId: string) => void;
  setHydrated: () => void;
}

/** Applies theme + direction to <html>. Keep in sync with the no-flash
 *  inline script in app/layout.tsx (which reads the same persisted key). */
function applyToDocument(theme: Theme, language: Language) {
  if (typeof document === "undefined") return;
  const el = document.documentElement;
  el.setAttribute("data-theme", theme);
  el.setAttribute("lang", language);
  el.setAttribute("dir", language === "ar" ? "rtl" : "ltr");
}

export const useSettings = create<SettingsState>()(
  persist(
    (set, get) => ({
      theme: "dark-red",
      language: "fr",
      hydrated: false,
      autoSendWhatsapp: true,
      autoSendEmail: true,
      // 30 minutes d'avance par défaut : la même fenêtre que le scan des cartes,
      // pour que le pointage manuel et le badge s'ouvrent au même moment.
      attendanceOpenMode: "lead",
      attendanceOpenLead: 30,
      attendanceOpenAt: "08:00",
      rollCallStarted: {},
      setTheme: (theme) => {
        applyToDocument(theme, get().language);
        set({ theme });
      },
      toggleTheme: () => {
        const theme = get().theme === "purple" ? "dark-red" : "purple";
        applyToDocument(theme, get().language);
        set({ theme });
      },
      setLanguage: (language) => {
        applyToDocument(get().theme, language);
        set({ language });
      },
      toggleLanguage: () => {
        const language = get().language === "fr" ? "ar" : "fr";
        applyToDocument(get().theme, language);
        set({ language });
      },
      setAutoSendWhatsapp: (autoSendWhatsapp) => set({ autoSendWhatsapp }),
      setAutoSendEmail: (autoSendEmail) => set({ autoSendEmail }),
      setAttendanceOpenMode: (attendanceOpenMode) => set({ attendanceOpenMode }),
      setAttendanceOpenLead: (minutes) =>
        set({ attendanceOpenLead: Math.min(240, Math.max(0, Math.round(minutes || 0))) }),
      setAttendanceOpenAt: (attendanceOpenAt) => set({ attendanceOpenAt }),
      // Seules les feuilles du jour demandé sont gardées : sans ce ménage, la
      // liste grossirait indéfiniment dans le stockage du navigateur, et une
      // séance démarrée hier rouvrirait toute seule aujourd'hui.
      startRollCall: (date, sessionId) =>
        set((state) => {
          const kept: Record<string, true> = {};
          for (const key of Object.keys(state.rollCallStarted)) {
            if (key.startsWith(`${date}|`)) kept[key] = true;
          }
          kept[rollCallKey(date, sessionId)] = true;
          return { rollCallStarted: kept };
        }),
      stopRollCall: (date, sessionId) =>
        set((state) => {
          const kept = { ...state.rollCallStarted };
          delete kept[rollCallKey(date, sessionId)];
          return { rollCallStarted: kept };
        }),
      setHydrated: () => set({ hydrated: true }),
    }),
    {
      name: "ecole-settings",
      partialize: (s) => ({
        theme: s.theme,
        language: s.language,
        autoSendWhatsapp: s.autoSendWhatsapp,
        autoSendEmail: s.autoSendEmail,
        attendanceOpenMode: s.attendanceOpenMode,
        attendanceOpenLead: s.attendanceOpenLead,
        attendanceOpenAt: s.attendanceOpenAt,
        rollCallStarted: s.rollCallStarted,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          applyToDocument(state.theme, state.language);
          state.setHydrated();
        }
      },
    },
  ),
);
