"use client";

import { useSettings, type Theme } from "@/lib/store/settings";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { cn } from "@/lib/utils";

const OPTIONS: { value: Theme; swatch: string; labelKey: string }[] = [
  { value: "purple", swatch: "#6d28d9", labelKey: "common.purpleTheme" },
  { value: "dark-red", swatch: "#dc2626", labelKey: "common.darkRedTheme" },
];

export function ThemeToggle({ className }: { className?: string }) {
  const theme = useSettings((s) => s.theme);
  const setTheme = useSettings((s) => s.setTheme);
  const { t } = useTranslation();

  return (
    <div
      className={cn(
        "relative inline-flex items-center gap-1 rounded-full border border-line bg-surface/60 p-1 backdrop-blur",
        className,
      )}
      role="radiogroup"
      aria-label={t("common.theme")}
    >
      {OPTIONS.map((opt) => {
        const active = theme === opt.value;
        return (
          <button
            key={opt.value}
            role="radio"
            aria-checked={active}
            title={t(opt.labelKey)}
            onClick={() => setTheme(opt.value)}
            className={cn(
              "relative z-10 flex h-7 w-7 items-center justify-center rounded-full cursor-pointer transition-all duration-200",
              active && "border-2 border-white/70 card-shadow"
            )}
            style={active ? { backgroundColor: opt.swatch } : undefined}
          >
            <span
              className={cn(
                "h-3.5 w-3.5 rounded-full ring-1 ring-black/10 transition-all duration-200",
                active && "ring-white/60",
              )}
              style={{ backgroundColor: active ? "#fff" : opt.swatch }}
            />
          </button>
        );
      })}
    </div>
  );
}
