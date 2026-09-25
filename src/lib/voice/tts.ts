/**
 * Choosing a speechSynthesis voice and preparing text for it. Pure, so it is unit tested with
 * fake voice lists. Bahi's replies are Hinglish in Latin script, which an Indian English voice
 * reads most naturally, so en-IN wins for Latin text whatever the recognition language is;
 * Devanagari text goes to a Hindi voice.
 */

export interface VoiceLike {
  name: string;
  lang: string;
  localService: boolean;
  default: boolean;
}

const norm = (lang: string) => lang.replace("_", "-").toLowerCase();

function quality(v: VoiceLike): number {
  if (/natural|neural|online/i.test(v.name)) return 3;
  if (/google/i.test(v.name)) return 2;
  if (!v.localService) return 1;
  return 0;
}

export function preferredLangs(text: string, chosen: string): string[] {
  const devanagari = /[ऀ-ॿ]/.test(text);
  const order = devanagari ? ["hi-IN", "en-IN", chosen] : ["en-IN", chosen, "hi-IN", "en-GB", "en-US"];
  return [...new Set(order.map(norm))];
}

export function pickVoice<V extends VoiceLike>(voices: readonly V[], chosen: string, text: string): V | null {
  if (voices.length === 0) return null;
  for (const lang of preferredLangs(text, chosen)) {
    const matches = voices.filter((v) => norm(v.lang) === lang);
    if (matches.length) return [...matches].sort((a, b) => quality(b) - quality(a) || Number(b.default) - Number(a.default))[0] ?? null;
  }
  return voices.find((v) => norm(v.lang).startsWith("en")) ?? voices.find((v) => v.default) ?? voices[0] ?? null;
}

/** "₹1,85,000" reads as "1,85,000 rupaye"; invoice ids and markdown stay out of the voice. */
export function speakable(text: string): string {
  return text
    .replace(/(?:₹|\bRs\.?\s?)\s?([\d,]+(?:\.\d+)?)/g, "$1 rupaye")
    .replace(/\bINV2(?:-[A-Z0-9]{4}){4}\b/g, "invoice")
    .replace(/[*_`#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
