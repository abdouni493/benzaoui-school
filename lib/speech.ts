"use client";

/**
 * Voice announcements for the RFID check-in, using the browser's built-in
 * Web Speech API (SpeechSynthesisUtterance) — no external service, no cost.
 *
 * NOTE — voice availability & quality vary by OS/browser: Windows + Chrome
 * (the entrance kiosk target) usually ships decent French voices out of the
 * box, but ARABIC voices must be tested on the actual machine. When no Arabic
 * voice is installed we log a console.warn and fall back to the default
 * voice, so we know to switch to pre-recorded audio later if needed.
 */

import type { Language } from "@/lib/store/settings";

export type SpeechCaseType = "good" | "low" | "expired";

const MESSAGES: Record<Language, Record<SpeechCaseType, (name: string) => string>> = {
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

/** Best installed voice for the language (matched on the BCP-47 prefix),
 *  preferring local (non-network) voices for kiosk reliability. */
function pickVoice(lang: Language): SpeechSynthesisVoice | undefined {
  const candidates = window.speechSynthesis
    .getVoices()
    .filter((v) => v.lang.toLowerCase().startsWith(lang));
  return candidates.find((v) => v.localService) ?? candidates[0];
}

/**
 * Speak the check-in verdict. `studentName` is only used for the "expired"
 * case. Any announcement still playing is cancelled first, so a new scan
 * interrupts the previous message.
 */
export function speakMessage(
  caseType: SpeechCaseType,
  studentName: string,
  lang: Language,
): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    console.warn("[speech] Web Speech API not available in this browser — announcement skipped.");
    return;
  }

  const speak = () => {
    const utterance = new SpeechSynthesisUtterance(MESSAGES[lang][caseType](studentName));
    utterance.lang = lang === "ar" ? "ar-SA" : "fr-FR";
    utterance.rate = 0.95;
    utterance.pitch = 1;

    const voice = pickVoice(lang);
    if (voice) {
      utterance.voice = voice;
    } else if (lang === "ar") {
      console.warn(
        "[speech] No Arabic TTS voice installed on this device — using the browser default. " +
          "If pronunciation is unusable, plan a fallback to pre-recorded audio files.",
      );
    }

    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  };

  // Chrome loads its voice list asynchronously: the first getVoices() call
  // can return []. Wait for `voiceschanged`, with a timeout fallback because
  // some platforms never fire the event.
  if (window.speechSynthesis.getVoices().length === 0) {
    let spoken = false;
    const onReady = () => {
      if (spoken) return;
      spoken = true;
      window.speechSynthesis.removeEventListener("voiceschanged", onReady);
      speak();
    };
    window.speechSynthesis.addEventListener("voiceschanged", onReady);
    window.setTimeout(onReady, 400);
  } else {
    speak();
  }
}

/**
 * Map a check-in RPC result to the announcement case, or null when nothing
 * should be spoken (cooldown ignores, already-present, scheduling rejects…).
 */
export function speechCaseForScan(result: {
  ok: boolean;
  messageKey: string;
  lowBalance?: boolean;
}): SpeechCaseType | null {
  if (result.messageKey === "scan.expired") return "expired";
  if (result.ok && (result.messageKey === "scan.success" || result.messageKey === "scan.successLate")) {
    return result.lowBalance ? "low" : "good";
  }
  return null;
}
