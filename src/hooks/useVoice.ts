"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useVoicePrefs } from "./voice-prefs";

/**
 * Voice input on the Web Speech API (SpeechRecognition / webkitSpeechRecognition, Chrome).
 * - Interim words stream to onInterim; the final transcript arrives on silence via onFinal.
 * - toggle() for the mic button; start() / stop() for hold-Space push-to-talk.
 * - While listening, the live input level (getUserMedia + AnalyserNode) is written to the
 *   `--mic-level` CSS variable (0..1) on the element given to attachLevel, without re-rendering.
 * - Errors come back as friendly Hinglish copy through onError.
 */

export type VoiceState = "idle" | "listening" | "processing";

// Minimal Web Speech typings (lib.dom does not ship SpeechRecognition itself).
interface SpeechAlternative {
  transcript: string;
}
interface SpeechResult {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: SpeechAlternative;
}
interface SpeechResultEvent {
  readonly resultIndex: number;
  readonly results: { readonly length: number; [index: number]: SpeechResult };
}
interface SpeechErrorEvent {
  readonly error: string;
}
export interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onresult: ((e: SpeechResultEvent) => void) | null;
  onerror: ((e: SpeechErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function recognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const noop = () => () => undefined;

/** null until mounted (server render), then whether this browser can do speech recognition. */
export function useSpeechSupported(): boolean | null {
  return useSyncExternalStore(noop, () => recognitionCtor() !== null, () => null);
}

const ERROR_COPY: Record<string, string> = {
  "not-allowed": "Mic ki permission nahi mili. Address bar mein lock icon dabakar Microphone ko Allow karein.",
  "service-not-allowed": "Browser ne voice service rok di. Chrome mein chalayein, ya type karke bhejein.",
  "no-speech": "Kuch sunai nahi diya. Mic dabakar dobara bolein.",
  "audio-capture": "Mic nahi mila. Mic lagayein ya type karke bhejein.",
  network: "Voice service tak nahi pahunch paaye (internet?). Type karke bhejein.",
  "language-not-supported": "Yeh bhasha is browser mein nahi chalti. Doosri bhasha chunein.",
};

export function voiceErrorCopy(code: string): string {
  return ERROR_COPY[code] ?? "Awaaz samajh nahi paaye. Dobara bolein ya type karein.";
}

export function useVoice(opts: { onInterim?: (text: string) => void; onFinal: (text: string) => void; onError?: (message: string, code: string) => void }) {
  const { lang } = useVoicePrefs();
  const supported = useSpeechSupported();
  const [state, setState] = useState<VoiceState>("idle");
  const rec = useRef<SpeechRecognitionLike | null>(null);
  const finalText = useRef("");
  const failed = useRef(false);
  const handlers = useRef(opts);
  const levelEl = useRef<HTMLElement | null>(null);
  const meter = useRef<{ stop: () => void } | null>(null);

  useEffect(() => {
    handlers.current = opts;
  });

  const stopMeter = useCallback(() => {
    meter.current?.stop();
    meter.current = null;
    levelEl.current?.style.setProperty("--mic-level", "0");
  }, []);

  /** Live input level while listening. Best effort: without permission it simply stays at 0. */
  const startMeter = useCallback(async () => {
    if (meter.current || !navigator.mediaDevices?.getUserMedia) return;
    let stopped = false;
    meter.current = { stop: () => void (stopped = true) };
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (stopped || !Ctx) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      const ctx = new Ctx();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const buf = new Uint8Array(analyser.fftSize);
      let smooth = 0;
      let frame = 0;
      const tick = () => {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += ((v - 128) / 128) ** 2;
        const rms = Math.sqrt(sum / buf.length);
        smooth = smooth * 0.75 + Math.min(1, rms * 4) * 0.25;
        levelEl.current?.style.setProperty("--mic-level", smooth.toFixed(3));
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
      meter.current = {
        stop: () => {
          cancelAnimationFrame(frame);
          stream.getTracks().forEach((t) => t.stop());
          void ctx.close().catch(() => undefined);
        },
      };
    } catch {
      meter.current = null;
    }
  }, []);

  const start = useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor || rec.current) return;
    const r = new Ctor();
    r.lang = lang;
    r.continuous = false;
    r.interimResults = true;
    r.maxAlternatives = 1;
    finalText.current = "";
    failed.current = false;

    r.onstart = () => {
      setState("listening");
      void startMeter();
    };
    r.onresult = (e) => {
      let interim = "";
      let final = "";
      for (let i = 0; i < e.results.length; i++) {
        const res = e.results[i];
        const text = res?.[0]?.transcript ?? "";
        if (res?.isFinal) final += text;
        else interim += text;
      }
      finalText.current = final.trim();
      handlers.current.onInterim?.(`${final}${interim}`.trim());
    };
    r.onerror = (e) => {
      if (e.error === "aborted") return;
      failed.current = true;
      handlers.current.onError?.(voiceErrorCopy(e.error), e.error);
    };
    r.onend = () => {
      rec.current = null;
      stopMeter();
      setState("idle");
      const text = finalText.current;
      if (text && !failed.current) handlers.current.onFinal(text);
    };

    rec.current = r;
    setState("listening");
    try {
      r.start();
    } catch {
      rec.current = null;
      setState("idle");
      handlers.current.onError?.(voiceErrorCopy("unknown"), "start-failed");
    }
  }, [lang, startMeter, stopMeter]);

  /** Stop listening; whatever was heard so far becomes the final transcript. */
  const stop = useCallback(() => {
    if (!rec.current) return;
    setState("processing");
    stopMeter();
    rec.current.stop();
  }, [stopMeter]);

  /** Stop and throw away what was heard (Esc). */
  const cancel = useCallback(() => {
    if (!rec.current) return;
    finalText.current = "";
    failed.current = true;
    rec.current.abort();
  }, []);

  const toggle = useCallback(() => {
    if (rec.current) stop();
    else start();
  }, [start, stop]);

  useEffect(
    () => () => {
      rec.current?.abort();
      meter.current?.stop();
    },
    [],
  );

  const attachLevel = useCallback((el: HTMLElement | null) => {
    levelEl.current = el;
  }, []);

  return { supported, state, lang, start, stop, cancel, toggle, attachLevel };
}
