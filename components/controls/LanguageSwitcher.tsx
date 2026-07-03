"use client";

import { motion } from "framer-motion";
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
              "relative z-10 h-7 w-9 rounded-full text-sm font-semibold transition-colors cursor-pointer",
              active ? "text-white" : "text-muted hover:text-ink",
            )}
          >
            {active && (
              <motion.span
                layoutId="lang-pill"
                className="absolute inset-0 -z-10 rounded-full bg-gradient-primary"
                transition={{ type: "spring", stiffness: 400, damping: 30 }}
              />
            )}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
