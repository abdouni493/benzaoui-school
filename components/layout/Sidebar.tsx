"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { NAV_BY_ROLE, type NavItem } from "@/lib/nav";
import { useSession } from "@/lib/store/session";
import { useData } from "@/lib/store/data";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { cn } from "@/lib/utils";

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(href + "/");
}

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useTranslation();
  const user = useSession((s) => s.user);
  const logout = useSession((s) => s.logout);
  const school = useData((s) => s.school);

  const role = user?.role ?? "admin";
  const items = NAV_BY_ROLE[role];

  const handleClick = (item: NavItem) => {
    if (item.action === "logout") {
      logout();
      router.push("/login");
    }
    onNavigate?.();
  };

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col bg-sidebar-bg border-r border-sidebar-border text-sidebar-text transition-colors duration-300">
      {/* Brand */}
      <div className="flex items-center gap-3 px-5 py-5 border-b border-sidebar-border/60">
        {school.logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={school.logo}
            alt={school.name}
            className="h-10 w-10 shrink-0 rounded-xl object-cover shadow-sm"
          />
        ) : (
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sidebar-logo-bg text-sidebar-logo-color text-xl font-semibold shadow-sm transition-colors duration-300">
            🏫
          </div>
        )}
        <div className="min-w-0 leading-tight">
          <p className="truncate text-sm font-bold text-sidebar-text">{school.name || t("common.appName")}</p>
          <p className="text-[10px] font-bold text-sidebar-muted uppercase tracking-wider mt-0.5">{t(`roles.${role}`)}</p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {items.map((item) => {
          const active = item.action !== "logout" && isActive(pathname, item.href);
          const content = (
            <>
              <span className="text-lg leading-none">{item.emoji}</span>
              <span className="truncate">{t(`nav.${item.key}`)}</span>
            </>
          );

          const classes = cn(
            "relative z-0 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200 cursor-pointer select-none",
            active 
              ? "bg-gradient-primary shadow-md shadow-primary/15 text-white font-semibold" 
              : "text-sidebar-muted hover:bg-sidebar-hover hover:text-sidebar-text",
          );

          if (item.action === "logout") {
            return (
              <button
                key={item.key}
                onClick={() => handleClick(item)}
                className={cn(classes, "mt-4 w-full text-start text-danger/80 hover:bg-danger/10 hover:text-danger")}
              >
                {content}
              </button>
            );
          }

          return (
            <Link
              key={item.key}
              href={item.href}
              onClick={() => handleClick(item)}
              className={classes}
            >
              {content}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
