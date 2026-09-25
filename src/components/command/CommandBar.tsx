"use client";

import { ArrowRightIcon, MicrophoneIcon, StopCircleIcon, StopIcon } from "@phosphor-icons/react";
import { useRef, type FormEvent, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/Button";

export type MicState = "idle" | "listening" | "processing";

const MIC_STATUS: Record<MicState, string> = {
  idle: "Bol ke batao ya type karo. Enter se bhejo.",
  listening: "Sun raha hoon. Rukne ke liye mic dabao ya Esc.",
  processing: "Samajh raha hoon",
};

function MicButton({ state, onClick }: { state: MicState; onClick: () => void }) {
  const listening = state === "listening";
  const processing = state === "processing";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={processing}
      aria-pressed={listening}
      aria-label={listening ? "Sunna band karo" : processing ? "Samajh raha hoon" : "Bol ke batao"}
      aria-describedby="mic-status"
      className={`relative inline-flex size-14 shrink-0 items-center justify-center rounded-full bg-bahi-fill text-on-bahi shadow-[inset_0_-2px_0_rgb(0_0_0/0.22),0_6px_16px_-8px_rgb(142_27_23/0.7)] transition-transform duration-150 active:scale-[0.97] disabled:cursor-progress ${
        listening ? "ring-2 ring-bahi/40 ring-offset-2 ring-offset-paper-raised" : ""
      }`}
    >
      {listening ? (
        <>
          <span aria-hidden className="absolute inset-0 rounded-full border-2 border-bahi [animation:mic-ring_1.4s_ease-out_infinite]" />
          <span aria-hidden className="absolute inset-0 rounded-full border-2 border-bahi [animation:mic-ring_1.4s_ease-out_0.7s_infinite]" />
          <StopIcon size={22} weight="fill" aria-hidden />
        </>
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
  );
}

export function CommandBar({
  value,
  onChange,
  onSubmit,
  micState,
  onMic,
  busy,
  onStop,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (v: string) => void;
  micState: MicState;
  onMic: () => void;
  /** A run is streaming: the send button becomes Stop. */
  busy?: boolean;
  onStop?: () => void;
}) {
  const inputRef = useRef<HTMLTextAreaElement>(null);

  function submit(e?: FormEvent) {
    e?.preventDefault();
    const text = value.trim();
    if (text) onSubmit(text);
    else inputRef.current?.focus();
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (!busy) submit();
    }
  }

  return (
    <div>
      <form onSubmit={submit} className="paper-card flex items-end gap-3 p-3 focus-within:border-ink-faint md:gap-4 md:p-4">
        <MicButton state={micState} onClick={onMic} />
        <textarea
          ref={inputRef}
          id="command-input"
          rows={1}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Jaise: Verma Sweets ko 80,000 ka invoice bhejo"
          autoComplete="off"
          spellCheck={false}
          className="max-h-40 min-h-14 flex-1 resize-none bg-transparent py-3.5 text-[17px] leading-snug text-ink outline-none [field-sizing:content] placeholder:text-ink-faint-text focus-visible:outline-none md:text-[19px]"
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
      <p id="mic-status" aria-live="polite" className="mt-2 pl-1 text-[13px] text-ink-soft">
        {busy ? "Kaam chal raha hai. Rokna ho to Roko dabao." : MIC_STATUS[micState]}
      </p>
    </div>
  );
}
