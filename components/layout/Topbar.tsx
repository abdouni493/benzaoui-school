"use client";

import { Menu } from "lucide-react";
import { ThemeToggle } from "@/components/controls/ThemeToggle";
import { LanguageSwitcher } from "@/components/controls/LanguageSwitcher";
import { useSession } from "@/lib/store/session";
import { useTranslation } from "@/lib/i18n/useTranslation";

export function Topbar({ onMenu }: { onMenu: () => void }) {
  const { t } = useTranslation();
  const user = useSession((s) => s.user);

  const initials = (user?.name ?? "")
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("");

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-line bg-surface/80 px-4 backdrop-blur md:px-6">
      <button
        onClick={onMenu}
        aria-label="Menu"
        className="flex h-10 w-10 items-center justify-center rounded-xl text-ink hover:bg-primary-50 lg:hidden"
      >
        <Menu className="h-5 w-5" />
      </button>

      <span className="hidden text-lg font-bold text-gradient-primary sm:inline">
        {t("common.appName")}
      </span>

      {/* Le scanner de carte n'est plus dans la barre de navigation : il vit sur
          l'écran Étudiants (« Scanner RFID »), et le lecteur physique reste
          écouté en permanence par GlobalRFIDListener, sur toutes les pages. */}
      <div className="ms-auto flex items-center gap-2 md:gap-3">
        <LanguageSwitcher />
        <ThemeToggle />

        <div className="flex items-center gap-2 ps-1">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-primary text-xs font-bold text-white">
            {initials || "👤"}
          </div>
          <div className="hidden leading-tight md:block">
            <p className="text-sm font-semibold text-ink">{user?.name}</p>
            <p className="text-xs text-muted">{user ? t(`roles.${user.role}`) : ""}</p>
          </div>
        </div>
      </div>
    </header>
  );
}
