"use client";

import { ArrowRightIcon, MicrophoneIcon, SpeakerHighIcon, SpeakerSlashIcon, StopCircleIcon, StopIcon } from "@phosphor-icons/react";
import type { FormEvent, KeyboardEvent, Ref } from "react";
import { Button } from "@/components/ui/Button";
import { VOICE_LANGS, type VoiceLang } from "@/hooks/voice-prefs";

export type MicState = "idle" | "listening" | "processing";

export interface MicControls {
  /** null while unknown (server render), false when the browser has no SpeechRecognition. */
  supported: boolean | null;
  state: MicState;
  onToggle: () => void;
  /** Receives the live input level as the --mic-level CSS variable. */
  attachLevel: (el: HTMLElement | null) => void;
  lang: VoiceLang;
  onLang: (lang: VoiceLang) => void;
}

export interface SpeakerControls {
  supported: boolean | null;
  muted: boolean;
  onToggleMute: () => void;
}

function MicButton({ state, onToggle, attachLevel }: Pick<MicControls, "state" | "onToggle" | "attachLevel">) {
  const listening = state === "listening";
  const processing = state === "processing";
  return (
    <span ref={attachLevel} className="relative inline-flex size-14 shrink-0">
      {listening ? (
        <>
          <span aria-hidden className="mic-level-ring outer pointer-events-none absolute inset-0 rounded-full border-2 border-bahi" />
          <span aria-hidden className="mic-level-ring pointer-events-none absolute inset-0 rounded-full border-2 border-bahi" />
        </>
      ) : null}
      <button
        type="button"
        onClick={onToggle}
        disabled={processing}
        aria-pressed={listening}
        data-testid="mic-button"
        data-state={state}
        aria-label={listening ? "Sunna band karo" : processing ? "Samajh raha hoon" : "Bol ke batao"}
        aria-describedby="mic-status"
        title="Bol ke batao (Space dabakar rakho)"
        className={`relative inline-flex size-14 items-center justify-center rounded-full bg-bahi-fill text-on-bahi shadow-[inset_0_-2px_0_rgb(0_0_0/0.22),0_6px_16px_-8px_rgb(142_27_23/0.7)] transition-transform duration-150 active:scale-[0.97] disabled:cursor-progress ${
          listening ? "ring-2 ring-bahi/40 ring-offset-2 ring-offset-paper-raised" : ""
        }`}
      >
        {listening ? (
          <StopIcon size={22} weight="fill" aria-hidden />
        ) : processing ? (
          <span aria-hidden className="flex h-6 items-center gap-[3px]">
            {[0, 1, 2, 3].map((i) => (
              <span
                key={i}
                className="block h-full w-[3px] origin-center rounded-full bg-on-bahi"
                style={{ animation: `wave-bar 0.9s ease-in-out ${i * 0.12}s infinite` }}
              />
            ))}
          </span>
        ) : (
          <MicrophoneIcon size={24} weight="fill" aria-hidden />
        )}
      </button>
    </span>
  );
}

function statusLine(busy: boolean, mic: MicControls): string {
  if (busy) return "Kaam chal raha hai. Rokna ho to Roko dabao.";
  if (mic.supported === false) return "Voice ke liye Chrome use karein. Abhi type karke Enter dabao.";
  if (mic.state === "listening") return "Sun raha hoon. Chup hote hi bhej denge. Rokna ho to mic dabao ya Esc.";
  if (mic.state === "processing") return "Samajh raha hoon";
  return "Bol ke batao ya type karo. Enter se bhejo, / se yahan aao.";
}

export function CommandBar({
  value,
  onChange,
  onSubmit,
  mic,
  speaker,
  busy,
  onStop,
  inputRef,
  onRecall,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (v: string) => void;
  mic: MicControls;
  speaker: SpeakerControls;
  /** A run is streaming: the send button becomes Stop. */
  busy?: boolean;
  onStop?: () => void;
  inputRef: Ref<HTMLTextAreaElement>;
  /** Up arrow in an empty box: returns an earlier command, or null. */
  onRecall?: () => string | null;
}) {
  function submit(e?: FormEvent) {
    e?.preventDefault();
    const text = value.trim();
    if (text) onSubmit(text);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (!busy) submit();
      return;
    }
    const el = e.currentTarget;
    if (e.key === "ArrowUp" && onRecall && (value === "" || (el.selectionStart === 0 && el.selectionEnd === 0))) {
      const prev = onRecall();
      if (prev !== null) {
        e.preventDefault();
        onChange(prev);
      }
    }
  }

  return (
    <div>
      <form onSubmit={submit} className="paper-card flex items-end gap-3 p-3 focus-within:border-ink-faint md:gap-4 md:p-4">
        {/* Reserve the mic's space until support is known, so the bar does not jump after hydration. */}
        {mic.supported ? <MicButton state={mic.state} onToggle={mic.onToggle} attachLevel={mic.attachLevel} /> : mic.supported === null ? <span aria-hidden className="size-14 shrink-0" /> : null}
        <textarea
          ref={inputRef}
          id="command-input"
          rows={1}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Jaise: Verma ko 80,000 ka invoice bhejo"
          autoComplete="off"
          spellCheck={false}
          aria-describedby="mic-status"
          aria-keyshortcuts="/"
          className="max-h-40 min-h-14 min-w-0 flex-1 resize-none bg-transparent py-3.5 text-[17px] leading-snug text-ink outline-none [field-sizing:content] placeholder:text-ink-faint-text focus-visible:outline-none md:text-[19px]"
        />
        {busy ? (
          <>
            <Button variant="secondary" size="lg" onClick={onStop} className="max-sm:hidden">
              <StopCircleIcon size={18} weight="fill" aria-hidden className="text-bahi-ink" />
              Roko
            </Button>
            <Button variant="secondary" size="lg" onClick={onStop} className="w-12 px-0 sm:hidden" aria-label="Roko">
              <StopCircleIcon size={20} weight="fill" aria-hidden className="text-bahi-ink" />
            </Button>
          </>
        ) : (
          <>
            <Button type="submit" variant="primary" size="lg" className="max-sm:hidden">
              Bhejo
              <ArrowRightIcon size={18} weight="bold" aria-hidden />
            </Button>
            <Button type="submit" variant="primary" size="lg" className="w-12 px-0 sm:hidden" aria-label="Bhejo">
              <ArrowRightIcon size={20} weight="bold" aria-hidden />
            </Button>
          </>
        )}
      </form>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 pl-1">
        <p id="mic-status" aria-live="polite" className="min-w-0 text-[13px] text-ink-soft">
          {statusLine(Boolean(busy), mic)}
        </p>
        <div className="flex items-center gap-1">
          {mic.supported ? (
            <label className="inline-flex items-center gap-1.5 rounded-bahi px-1.5 py-1 text-[12.5px] text-ink-soft">
              <span className="sr-only">Awaaz ki bhasha</span>
              <span aria-hidden>Bhasha</span>
              <select
                value={mic.lang}
                title={VOICE_LANGS.find((l) => l.id === mic.lang)?.hint || undefined}
                onChange={(e) => mic.onLang(e.target.value as VoiceLang)}
                disabled={mic.state !== "idle"}
                data-testid="voice-lang"
                className="num cursor-pointer rounded-[4px] border border-rule bg-paper-raised px-1.5 py-0.5 text-[12px] font-semibold text-ink disabled:cursor-not-allowed disabled:opacity-60"
              >
                {VOICE_LANGS.map((l) => (
                  <option key={l.id} value={l.id} title={l.hint || l.label}>
                    {l.short}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {speaker.supported ? (
            <button
              type="button"
              onClick={speaker.onToggleMute}
              aria-pressed={speaker.muted}
              data-testid="mute-toggle"
              title={speaker.muted ? "Jawab bol ke sunaye (abhi band)" : "Jawab bolna band karein"}
              className="inline-flex items-center gap-1.5 rounded-bahi px-2 py-1 text-[12.5px] font-semibold text-ink-soft transition-colors hover:bg-paper-sunk hover:text-ink"
            >
              {speaker.muted ? <SpeakerSlashIcon size={16} weight="bold" aria-hidden /> : <SpeakerHighIcon size={16} weight="bold" aria-hidden />}
              {speaker.muted ? "Awaaz band" : "Awaaz chalu"}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
