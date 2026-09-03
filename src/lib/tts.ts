/**
 * Hebrew narration in the browser through the Web Speech API. Uses the
 * device's own Hebrew voice when there is one (Google עברית on Android and
 * desktop Chrome, Carmit on Apple devices). Nothing is sent to a server.
 */

export type NarrationMode = "off" | "system" | "all";

const STORAGE_KEY = "aiyara:narration";

export function loadNarrationMode(): NarrationMode {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === "system" || raw === "all" ? raw : "off";
  } catch {
    return "off";
  }
}

export function saveNarrationMode(mode: NarrationMode) {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* ignore */
  }
}

export function speechSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
}

let voicesReady: Promise<SpeechSynthesisVoice[]> | null = null;

/** Voices load asynchronously in most browsers; wait once for the list. */
export function hebrewVoices(): Promise<SpeechSynthesisVoice[]> {
  if (!speechSupported()) return Promise.resolve([]);
  if (voicesReady) return voicesReady;
  voicesReady = new Promise((resolve) => {
    const pick = () => window.speechSynthesis.getVoices().filter((v) => /^he(-|_|$)/i.test(v.lang) || /hebrew|עברית/i.test(v.name));
    const now = pick();
    if (now.length) return resolve(now);
    const timer = setTimeout(() => resolve(pick()), 1500);
    window.speechSynthesis.addEventListener(
      "voiceschanged",
      () => {
        clearTimeout(timer);
        resolve(pick());
      },
      { once: true },
    );
  });
  return voicesReady;
}

function preferred(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  if (!voices.length) return null;
  const score = (v: SpeechSynthesisVoice) => (/google/i.test(v.name) ? 3 : 0) + (/carmit/i.test(v.name) ? 2 : 0) + (v.localService ? 0 : 1) + (v.default ? 1 : 0);
  return [...voices].sort((a, b) => score(b) - score(a))[0] ?? null;
}

/** Strip emoji and symbols the voice would spell out. */
export function cleanForSpeech(text: string): string {
  return text
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/gu, " ")
    .replace(/[✦☀🌙🔮🩺🔔]/g, " ")
    .replace(/[«»"“”]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export async function speak(text: string, opts: { rate?: number; interrupt?: boolean } = {}): Promise<void> {
  if (!speechSupported()) return;
  const clean = cleanForSpeech(text);
  if (!clean) return;
  const voice = preferred(await hebrewVoices());
  const utterance = new SpeechSynthesisUtterance(clean);
  utterance.lang = voice?.lang ?? "he-IL";
  if (voice) utterance.voice = voice;
  utterance.rate = opts.rate ?? 1.02;
  utterance.pitch = 1;
  if (opts.interrupt) window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

export function stopSpeaking() {
  if (speechSupported()) window.speechSynthesis.cancel();
}
