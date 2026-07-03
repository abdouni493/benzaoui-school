import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge conditional class names, de-duping conflicting Tailwind utilities. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Format an amount as Algerian Dinar, locale-aware. */
export function formatDA(amount: number, locale: string = "fr"): string {
  const formatted = new Intl.NumberFormat(locale === "ar" ? "ar-DZ" : "fr-DZ", {
    maximumFractionDigits: 0,
  }).format(Math.abs(amount));
  return amount < 0 ? `-${formatted} DA` : `${formatted} DA`;
}

import type { Day } from "@/lib/types";

const DAY_ORDER: Day[] = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

export function todayDayKey(d: Date = new Date()): Day {
  return DAY_ORDER[d.getDay()];
}

export function formatDate(dateStr: string, withTime = false): string {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleString("fr-DZ", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  });
}
