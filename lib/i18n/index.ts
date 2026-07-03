import { fr, type Dictionary } from "./fr";
import { ar } from "./ar";
import type { Language } from "@/lib/store/settings";

export const dictionaries: Record<Language, Dictionary> = { fr, ar };
export type { Dictionary };

/** Resolve a dot-path key (e.g. "nav.dashboard") against a dictionary,
 *  falling back to French and finally the raw key. Supports {placeholder}
 *  interpolation. */
export function translate(
  language: Language,
  key: string,
  vars?: Record<string, string | number>,
): string {
  const lookup = (dict: Dictionary): string | undefined =>
    key.split(".").reduce<unknown>((acc, part) => {
      if (acc && typeof acc === "object" && part in (acc as object)) {
        return (acc as Record<string, unknown>)[part];
      }
      return undefined;
    }, dict) as string | undefined;

  let value = lookup(dictionaries[language]);
  if (value === undefined && language !== "fr") value = lookup(fr);
  if (value === undefined) return key;

  if (vars) {
    return value.replace(/\{(\w+)\}/g, (_, name) =>
      name in vars ? String(vars[name]) : `{${name}}`,
    );
  }
  return value;
}
