"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { pickVoice, speakable } from "@/lib/voice/tts";
import { useVoicePrefs } from "./voice-prefs";

/**
 * Spoken replies through speechSynthesis. speak() does nothing while muted; cancel() stops at once
 * (a new command, Esc, mute). Never called on page load: the Command page only speaks `speak`
 * events that arrive after the owner started a run in this tab.
 */

const noop = () => () => undefined;

export function useSpeechOutputSupported(): boolean | null {
  return useSyncExternalStore(noop, () => typeof window !== "undefined" && "speechSynthesis" in window, () => null);
}

export function useSpeech() {
  const { lang, muted } = useVoicePrefs();
  const supported = useSpeechOutputSupported();
  const [speaking, setSpeaking] = useState(false);
  const [voiceName, setVoiceName] = useState<string | null>(null);
  const voices = useRef<SpeechSynthesisVoice[]>([]);

  useEffect(() => {
    if (!supported) return;
    const load = () => {
      voices.current = window.speechSynthesis.getVoices();
      setVoiceName(pickVoice(voices.current, lang, "Namaste")?.name ?? null);
    };
    load();
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", load);
  }, [supported, lang]);

  const cancel = useCallback(() => {
    if (!supported) return;
    window.speechSynthesis.cancel();
    setSpeaking(false);
  }, [supported]);

  const speak = useCallback(
    (text: string) => {
      if (!supported || muted) return;
      const line = speakable(text);
      if (!line) return;
      const u = new SpeechSynthesisUtterance(line);
      const voice = pickVoice(voices.current.length ? voices.current : window.speechSynthesis.getVoices(), lang, line);
      if (voice) {
        u.voice = voice;
        u.lang = voice.lang;
      } else {
        u.lang = "en-IN";
      }
      u.rate = 1;
      u.onstart = () => setSpeaking(true);
      u.onend = () => setSpeaking(false);
      u.onerror = () => setSpeaking(false);
      window.speechSynthesis.speak(u);
    },
    [supported, muted, lang],
  );

  // Muting mid-sentence stops the voice.
  // (The utterance's end / error event resets `speaking`.)
  useEffect(() => {
    if (muted && supported) window.speechSynthesis.cancel();
  }, [muted, supported]);

  return { supported, speaking, voiceName, speak, cancel, muted };
}
