"use client";

import { useCallback } from "react";
import { useSettings } from "@/lib/store/settings";
import { translate } from "./index";

/** Primary translation hook. Reactive to the global language setting. */
export function useTranslation() {
  const language = useSettings((s) => s.language);
  const dir: "rtl" | "ltr" = language === "ar" ? "rtl" : "ltr";

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) =>
      translate(language, key, vars),
    [language],
  );

  return { t, language, dir, isRTL: dir === "rtl" };
}
