"use client";

/**
 * Voice announcements for the RFID check-in, played from the pre-recorded
 * audio files in `public/speech/` so the voice is identical on every device
 * (including the Vercel-hosted version — no dependency on locally installed
 * TTS voices).
 *
 * There are exactly FIVE verdicts, one clip each:
 *   1. debt                — the student's balance is negative (dette)
 *   2. creditInsufficient  — balance too low to cover the séance / expired
 *   3. welcome             — accepted, the student may enter
 *   4. alreadyScanned      — card swiped again (cooldown or already present)
 *   5. cardNotFound        — unknown badge
 *
 * Every other rejection (trop tôt, séance terminée, séance d'un autre niveau,
 * aucune séance aujourd'hui) stays VISUAL-ONLY: several séances of different
 * levels run at the same time, so announcing a verdict out loud there would be
 * misleading. `speechCaseForScan` returns null for those.
 *
 * The browser's Web Speech API is kept only as a last-resort fallback when the
 * audio file itself cannot be played (file missing, decode error…).
 */

import type { Language } from "@/lib/store/settings";

export type SpeechCaseType =
  | "debt"
  | "creditInsufficient"
  | "welcome"
  | "alreadyScanned"
  | "cardNotFound";

/** Served statically from `public/speech/` at the site root.
 *  File names are lowercase on purpose — the Vercel filesystem is
 *  case-sensitive, a mismatch would silently 404 into the TTS fallback. */
const AUDIO_FILES: Record<SpeechCaseType, string> = {
  debt: "/speech/debt.mp3",
  creditInsufficient: "/speech/credit_insufficient.mp3",
  welcome: "/speech/welcome.mp3",
  alreadyScanned: "/speech/already_scanned.mp3",
  cardNotFound: "/speech/card_not_found.mp3",
};

const FALLBACK_MESSAGES: Record<Language, Record<SpeechCaseType, (name: string) => string>> = {
  fr: {
    debt: (name) => `Désolé ${name}, vous ne pouvez pas entrer : votre compte est en dette.`,
    creditInsufficient: (name) => `Désolé ${name}, vous ne pouvez pas entrer car votre solde est épuisé.`,
    welcome: () => "Bienvenue, vous pouvez entrer.",
    alreadyScanned: () => "Votre passage est déjà enregistré.",
    cardNotFound: () => "Carte non reconnue. Veuillez vous présenter à la réception.",
  },
  ar: {
    debt: (name) => `عذرًا ${name}، لا يمكنك الدخول: حسابك عليه دين.`,
    creditInsufficient: (name) => `عذرًا ${name}، لا يمكنك الدخول لأن رصيدك قد انتهى.`,
    welcome: () => "مرحبًا، يمكنك الدخول.",
    alreadyScanned: () => "تم تسجيل دخولك من قبل.",
    cardNotFound: () => "البطاقة غير معروفة. يرجى التوجه إلى الاستقبال.",
  },
};

const audioCache = new Map<SpeechCaseType, HTMLAudioElement>();
let currentAudio: HTMLAudioElement | null = null;

function getAudio(caseType: SpeechCaseType): HTMLAudioElement {
  let audio = audioCache.get(caseType);
  if (!audio) {
    audio = new Audio(AUDIO_FILES[caseType]);
    audio.preload = "auto";
    audioCache.set(caseType, audio);
  }
  return audio;
}

/** Warm the clips (call once on app mount) so the first scan of the day
 *  doesn't wait on a network fetch of the MP3. */
export function preloadSpeech(): void {
  if (typeof window === "undefined" || typeof Audio === "undefined") return;
  (Object.keys(AUDIO_FILES) as SpeechCaseType[]).forEach(getAudio);
}

/**
 * Play the check-in verdict clip. Any announcement still playing is stopped
 * first, so a new scan interrupts the previous message. `studentName` and
 * `lang` are only used by the TTS fallback.
 */
export function speakMessage(
  caseType: SpeechCaseType,
  studentName: string,
  lang: Language,
): void {
  if (typeof window === "undefined" || typeof Audio === "undefined") return;

  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
  }

  const audio = getAudio(caseType);
  audio.currentTime = 0;
  currentAudio = audio;

  audio.play().catch((err) => {
    console.warn(`[speech] Could not play ${AUDIO_FILES[caseType]} (${err}) — falling back to TTS.`);
    speakFallback(caseType, studentName, lang);
  });
}

function speakFallback(caseType: SpeechCaseType, studentName: string, lang: Language): void {
  if (!("speechSynthesis" in window)) return;
  const utterance = new SpeechSynthesisUtterance(FALLBACK_MESSAGES[lang][caseType](studentName));
  utterance.lang = lang === "ar" ? "ar-SA" : "fr-FR";
  utterance.rate = 0.95;
  const voice = window.speechSynthesis
    .getVoices()
    .filter((v) => v.lang.toLowerCase().startsWith(lang))
    .sort((a, b) => Number(b.localService) - Number(a.localService))[0];
  if (voice) utterance.voice = voice;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

/**
 * Map a check-in RPC result to one of the five clips, or null when nothing
 * should be announced.
 *
 * A rejection for money is split in two: `debt` when the balance is already
 * negative (the RPC sets `debt: true`), `creditInsufficient` otherwise.
 */
export function speechCaseForScan(result: {
  ok: boolean;
  messageKey: string;
  debt?: boolean;
  newBalance?: number;
}): SpeechCaseType | null {
  const inDebt = result.debt ?? (result.newBalance !== undefined && result.newBalance < 0);

  switch (result.messageKey) {
    case "scan.notFound":
      return "cardNotFound";

    case "scan.cooldown":
    case "scan.alreadyPresent":
      return "alreadyScanned";

    case "scan.debtBlocked":
      return "debt";

    case "scan.expired":
    case "scan.subscriptionExpired":
      return inDebt ? "debt" : "creditInsufficient";

    case "scan.successDebt":
      return "debt";

    case "scan.success":
    case "scan.successLate":
      if (!result.ok) return null;
      return inDebt ? "debt" : "welcome";

    // scan.tooEarly / scan.sessionEnded / scan.notEligible / scan.noSessionToday
    // and technical errors stay visual-only.
    default:
      return null;
  }
}
