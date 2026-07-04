"use client";

import { useSettings, type Language } from "@/lib/store/settings";
import { cn } from "@/lib/utils";

const OPTIONS: { value: Language; label: string }[] = [
  { value: "fr", label: "FR" },
  { value: "ar", label: "ع" },
];

export function LanguageSwitcher({ className }: { className?: string }) {
  const language = useSettings((s) => s.language);
  const setLanguage = useSettings((s) => s.setLanguage);

  return (
    <div
      className={cn(
        "relative inline-flex items-center gap-1 rounded-full border border-line bg-surface/60 p-1 backdrop-blur",
        className,
      )}
      role="radiogroup"
      aria-label="Language"
    >
      {OPTIONS.map((opt) => {
        const active = language === opt.value;
        return (
          <button
            key={opt.value}
            role="radio"
            aria-checked={active}
            onClick={() => setLanguage(opt.value)}
            className={cn(
              "relative z-10 h-7 w-9 rounded-full text-sm font-semibold transition-all duration-200 cursor-pointer",
              active ? "bg-gradient-primary text-white" : "text-muted hover:text-ink",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
