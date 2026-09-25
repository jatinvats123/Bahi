"use client";

import { useSyncExternalStore } from "react";

/**
 * Voice preferences (recognition language, spoken replies muted), persisted in localStorage.
 * Storage can throw (private mode, blocked site data), so every access is guarded and the
 * defaults always work. The server snapshot is the default, so SSR and hydration agree.
 */

export const VOICE_LANGS = [
  { id: "en-IN", label: "English (India)", short: "EN-IN", hint: "Hinglish ke liye best" },
  { id: "hi-IN", label: "हिन्दी", short: "HI", hint: "Devanagari mein likhega" },
  { id: "en-US", label: "English (US)", short: "EN-US", hint: "" },
] as const;
export type VoiceLang = (typeof VOICE_LANGS)[number]["id"];

export interface VoicePrefs {
  lang: VoiceLang;
  muted: boolean;
}

const KEY = "bahi-voice";
const DEFAULTS: VoicePrefs = { lang: "en-IN", muted: false };
const listeners = new Set<() => void>();
let snapshot: VoicePrefs | null = null;

function read(): VoicePrefs {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const v = JSON.parse(raw) as Partial<VoicePrefs>;
    return {
      lang: VOICE_LANGS.some((l) => l.id === v.lang) ? (v.lang as VoiceLang) : DEFAULTS.lang,
      muted: typeof v.muted === "boolean" ? v.muted : DEFAULTS.muted,
    };
  } catch {
    return DEFAULTS;
  }
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEY) return;
    snapshot = read();
    cb();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

function getSnapshot(): VoicePrefs {
  snapshot ??= read();
  return snapshot;
}

export function setVoicePrefs(patch: Partial<VoicePrefs>): void {
  snapshot = { ...getSnapshot(), ...patch };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(snapshot));
  } catch {
    // storage blocked: the choice lasts for this page only
  }
  for (const l of listeners) l();
}

export function useVoicePrefs(): VoicePrefs {
  return useSyncExternalStore(subscribe, getSnapshot, () => DEFAULTS);
}
