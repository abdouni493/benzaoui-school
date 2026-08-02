"use client";

/**
 * Voice announcements for the RFID check-in, played from the pre-recorded
 * audio files in `public/speech/` so the voice is identical on every device
 * (including the Vercel-hosted version — no dependency on locally installed
 * TTS voices).
 *
 * The browser's Web Speech API is kept only as a last-resort fallback when
 * the audio file itself cannot be played (file missing, decode error…).
 */

import type { Language } from "@/lib/store/settings";

export type SpeechCaseType = "good" | "low" | "expired";

/** Served statically from `public/speech/` at the site root. */
const AUDIO_FILES: Record<SpeechCaseType, string> = {
  good: "/speech/you_can_enter.mp3",
  low: "/speech/soon_expire.mp3",
  expired: "/speech/sorry_you_cant_enter.mp3",
};

const FALLBACK_MESSAGES: Record<Language, Record<SpeechCaseType, (name: string) => string>> = {
  fr: {
    good: () => "Bienvenue, vous pouvez entrer.",
    low: () => "Bienvenue, vous pouvez entrer, mais votre solde est bientôt épuisé.",
    expired: (name) => `Désolé ${name}, vous ne pouvez pas entrer car votre solde est épuisé.`,
  },
  ar: {
    good: () => "مرحبًا، يمكنك الدخول.",
    low: () => "مرحبًا، يمكنك الدخول، لكن رصيدك سينتهي قريبًا.",
    expired: (name) => `عذرًا ${name}، لا يمكنك الدخول لأن رصيدك قد انتهى.`,
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

/** Warm the three clips (call once on app mount) so the first scan of the
 *  day doesn't wait on a network fetch of the MP3. */
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
 * Map a check-in RPC result to the announcement clip, or null when nothing
 * should be played (cooldown ignores, wrong-schedule rejects…).
 *
 *  - sufficient balance → "you can enter"
 *  - balance soon exhausted → "soon to expire"
 *  - balance exhausted / in debt / subscription expired → "sorry"
 */
export function speechCaseForScan(result: {
  ok: boolean;
  messageKey: string;
  lowBalance?: boolean;
}): SpeechCaseType | null {
  if (
    result.messageKey === "scan.expired" ||
    result.messageKey === "scan.debtBlocked" ||
    result.messageKey === "scan.subscriptionExpired"
  ) {
    return "expired";
  }
  if (result.ok && (result.messageKey === "scan.success" || result.messageKey === "scan.successLate")) {
    return result.lowBalance ? "low" : "good";
  }
  return null;
}
