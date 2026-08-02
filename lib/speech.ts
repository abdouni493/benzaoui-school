"use client";

/**
 * Voice announcements for the RFID check-in, played from the pre-recorded
 * audio files in `public/speech/` so the voice is identical on every device
 * (including the Vercel-hosted version — no dependency on locally installed
 * TTS voices).
 *
 * The browser's Web Speech API is kept only as a last-resort fallback when
 * the audio file itself cannot be played (file missing, decode error…).
 *
 * scan.notEligible and scan.noSessionToday deliberately have NO clip: several
 * séances of different levels run at the same time, so those rejections stay
 * visual-only (toast) to avoid announcing a wrong "not your séance" verdict.
 */

import type { Language } from "@/lib/store/settings";

export type SpeechCaseType =
  | "good"
  | "low"
  | "expired"
  | "late"
  | "notFound"
  | "cooldown"
  | "alreadyPresent"
  | "tooEarly"
  | "sessionEnded";

/** Served statically from `public/speech/` at the site root. */
const AUDIO_FILES: Record<SpeechCaseType, string> = {
  good: "/speech/you_can_enter.mp3",
  low: "/speech/soon_expire.mp3",
  expired: "/speech/sorry_you_cant_enter.mp3",
  late: "/speech/late_arrival.mp3",
  notFound: "/speech/card_not_found.mp3",
  cooldown: "/speech/already_scanned.mp3",
  alreadyPresent: "/speech/already_present.mp3",
  tooEarly: "/speech/too_early.mp3",
  sessionEnded: "/speech/session_ended.mp3",
};

const FALLBACK_MESSAGES: Record<Language, Record<SpeechCaseType, (name: string) => string>> = {
  fr: {
    good: () => "Bienvenue, vous pouvez entrer.",
    low: () => "Bienvenue, vous pouvez entrer, mais votre solde est bientôt épuisé.",
    expired: (name) => `Désolé ${name}, vous ne pouvez pas entrer car votre solde est épuisé.`,
    late: () => "Vous pouvez entrer, mais vous êtes en retard. Merci d'arriver à l'heure la prochaine fois.",
    notFound: () => "Carte non reconnue. Veuillez vous présenter à la réception.",
    cooldown: () => "Votre passage est déjà enregistré. Vous pouvez entrer.",
    alreadyPresent: () => "Vous êtes déjà pointé pour cette séance. Bonne séance.",
    tooEarly: () => "Vous êtes en avance. Votre séance n'a pas encore commencé, merci de patienter.",
    sessionEnded: () => "Désolé, votre séance est déjà terminée. Veuillez vous adresser à la réception.",
  },
  ar: {
    good: () => "مرحبًا، يمكنك الدخول.",
    low: () => "مرحبًا، يمكنك الدخول، لكن رصيدك سينتهي قريبًا.",
    expired: (name) => `عذرًا ${name}، لا يمكنك الدخول لأن رصيدك قد انتهى.`,
    late: () => "يمكنك الدخول، لكنك متأخر. يرجى الحضور في الوقت المحدد المرة القادمة.",
    notFound: () => "البطاقة غير معروفة. يرجى التوجه إلى الاستقبال.",
    cooldown: () => "تم تسجيل دخولك من قبل. يمكنك الدخول.",
    alreadyPresent: () => "حضورك مسجل مسبقًا لهذه الحصة. حصة موفقة.",
    tooEarly: () => "لقد أتيت مبكرًا. لم تبدأ حصتك بعد، يرجى الانتظار.",
    sessionEnded: () => "عذرًا، لقد انتهت حصتك. يرجى التوجه إلى الاستقبال.",
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
 * Map a check-in RPC result to the announcement clip, or null when nothing
 * should be played (notEligible / noSessionToday / technical error).
 *
 *  - sufficient balance → "you can enter" (or "late arrival" when late)
 *  - balance soon exhausted → "soon to expire" (takes priority over lateness)
 *  - balance exhausted / in debt / subscription expired → "sorry"
 *  - unknown card / double swipe / already badged / too early / séance over
 *    → their dedicated clips
 */
export function speechCaseForScan(result: {
  ok: boolean;
  messageKey: string;
  lowBalance?: boolean;
}): SpeechCaseType | null {
  switch (result.messageKey) {
    case "scan.expired":
    case "scan.debtBlocked":
    case "scan.subscriptionExpired":
      return "expired";
    case "scan.notFound":
      return "notFound";
    case "scan.cooldown":
      return "cooldown";
    case "scan.alreadyPresent":
      return "alreadyPresent";
    case "scan.tooEarly":
      return "tooEarly";
    case "scan.sessionEnded":
      return "sessionEnded";
    case "scan.success":
      return result.ok ? (result.lowBalance ? "low" : "good") : null;
    case "scan.successLate":
      return result.ok ? (result.lowBalance ? "low" : "late") : null;
    default:
      return null;
  }
}
