"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Theme = "purple" | "dark-red";
export type Language = "fr" | "ar";

interface SettingsState {
  theme: Theme;
  language: Language;
  hydrated: boolean;
  autoSendWhatsapp: boolean;
  autoSendEmail: boolean;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  setLanguage: (language: Language) => void;
  toggleLanguage: () => void;
  setAutoSendWhatsapp: (val: boolean) => void;
  setAutoSendEmail: (val: boolean) => void;
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
      setHydrated: () => set({ hydrated: true }),
    }),
    {
      name: "ecole-settings",
      partialize: (s) => ({
        theme: s.theme,
        language: s.language,
        autoSendWhatsapp: s.autoSendWhatsapp,
        autoSendEmail: s.autoSendEmail,
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
