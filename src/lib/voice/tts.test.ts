import { describe, expect, it } from "vitest";
import { pickVoice, speakable, type VoiceLike } from "./tts";

const v = (name: string, lang: string, extra: Partial<VoiceLike> = {}): VoiceLike => ({ name, lang, localService: true, default: false, ...extra });

const WINDOWS_CHROME = [
  v("Microsoft David - English (United States)", "en-US", { default: true }),
  v("Microsoft Heera - English (India)", "en-IN"),
  v("Microsoft Kalpana - Hindi (India)", "hi-IN"),
  v("Google US English", "en-US", { localService: false }),
  v("Google हिन्दी", "hi-IN", { localService: false }),
];

describe("pickVoice", () => {
  it("prefers an Indian English voice for Hinglish text, whatever the chosen language", () => {
    expect(pickVoice(WINDOWS_CHROME, "en-US", "Sharma Traders ko invoice bhej diya.")?.name).toMatch(/Heera/);
    expect(pickVoice(WINDOWS_CHROME, "hi-IN", "Aaj ka hisaab")?.name).toMatch(/Heera/);
  });

  it("uses a Hindi voice for Devanagari, preferring the better quality one", () => {
    expect(pickVoice(WINDOWS_CHROME, "en-IN", "आज का हिसाब")?.name).toBe("Google हिन्दी");
  });

  it("prefers natural / online voices within a language and handles underscore langs", () => {
    const voices = [v("Basic India", "en_IN"), v("Microsoft Neerja Online (Natural) - English (India)", "en-IN", { localService: false })];
    expect(pickVoice(voices, "en-IN", "hello")?.name).toMatch(/Neerja/);
  });

  it("falls back to any English voice, then anything", () => {
    expect(pickVoice([v("Only UK", "en-GB")], "en-IN", "x")?.name).toBe("Only UK");
    expect(pickVoice([v("Français", "fr-FR", { default: true })], "en-IN", "x")?.name).toBe("Français");
    expect(pickVoice([], "en-IN", "x")).toBeNull();
  });
});

describe("speakable", () => {
  it("reads rupee amounts naturally and skips ids", () => {
    expect(speakable("Aaj ₹1,85,000 milna baaki hai.")).toBe("Aaj 1,85,000 rupaye milna baaki hai.");
    expect(speakable("Rs 15,000 ka invoice INV2-ZVZR-KJA3-Q8JY-39XF bheja")).toBe("15,000 rupaye ka invoice invoice bheja");
    expect(speakable("**Done**")).toBe("Done");
  });
});
