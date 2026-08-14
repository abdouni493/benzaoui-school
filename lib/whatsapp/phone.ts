/** Normalisation des numéros vers le MSISDN international attendu par Meta.
 *
 *  Les numéros saisis dans l'application n'ont aucun format imposé : on croise
 *  du "+213 555 12 34 56", du "0555123456", du "213555123456". L'API WhatsApp
 *  Cloud de Meta attend, elle, le numéro en chiffres bruts avec indicatif pays
 *  et SANS "+" (ex. "213555123456") — c'est ce MSISDN qui part dans le champ
 *  `to` de l'appel Graph. Aucun identifiant de discussion "@c.us" ici : c'était
 *  une spécificité de l'ancienne passerelle WhatsApp Web, Meta n'en veut pas. */

/** Indicatif appliqué à un numéro saisi en format national (Algérie par défaut). */
export const DEFAULT_COUNTRY_CODE = "213";

/** Longueur d'un numéro national algérien sans le 0 initial (ex. 555123456). */
const DZ_NATIONAL_LENGTH = 9;

export interface NormalizedPhone {
  /** chiffres uniquement, indicatif pays inclus, sans "+" — ex. "213555123456".
   *  C'est la valeur envoyée à Meta dans le champ `to`. */
  msisdn: string;
  /** rendu lisible pour l'interface — ex. "+213 555 123 456" */
  display: string;
}

/** Convertit un numéro saisi librement en numéro international en chiffres.
 *  Renvoie `null` si l'entrée ne peut pas donner un numéro plausible. */
export function toInternational(
  raw: string | null | undefined,
  countryCode: string = DEFAULT_COUNTRY_CODE,
): string | null {
  if (!raw) return null;

  let digits = raw.replace(/\D/g, "");
  if (!digits) return null;

  // Préfixe international composé : 00213… → 213…
  if (digits.startsWith("00")) digits = digits.slice(2);

  // Déjà international.
  if (digits.startsWith(countryCode) && digits.length > countryCode.length) {
    // "213 0555…" : un 0 national traîne derrière l'indicatif, on l'enlève.
    const rest = digits.slice(countryCode.length);
    return countryCode + (rest.startsWith("0") ? rest.slice(1) : rest);
  }

  // Format national : 0555123456 → 213555123456
  if (digits.startsWith("0")) {
    const rest = digits.slice(1);
    if (rest.length < 8) return null;
    return countryCode + rest;
  }

  // Numéro nu sans indicatif ni 0 : 555123456 → 213555123456
  if (digits.length === DZ_NATIONAL_LENGTH) return countryCode + digits;

  // Autre indicatif pays saisi tel quel (parent à l'étranger) : on garde,
  // à condition que ça ressemble encore à un numéro.
  if (digits.length >= 10 && digits.length <= 15) return digits;

  return null;
}

/** Normalise un numéro pour l'envoi. Renvoie `null` si le numéro est inexploitable. */
export function normalizePhone(
  raw: string | null | undefined,
  countryCode: string = DEFAULT_COUNTRY_CODE,
): NormalizedPhone | null {
  const msisdn = toInternational(raw, countryCode);
  if (!msisdn) return null;

  return {
    msisdn,
    display: formatDisplay(msisdn, countryCode),
  };
}

/** `true` si le numéro peut être converti en MSISDN international. */
export function isSendablePhone(
  raw: string | null | undefined,
  countryCode: string = DEFAULT_COUNTRY_CODE,
): boolean {
  return toInternational(raw, countryCode) !== null;
}

function formatDisplay(msisdn: string, countryCode: string): string {
  if (!msisdn.startsWith(countryCode)) return `+${msisdn}`;

  const national = msisdn.slice(countryCode.length);
  // 555123456 → 555 123 456
  const grouped = national.replace(/(\d{3})(?=\d)/g, "$1 ").trim();
  return `+${countryCode} ${grouped}`;
}
