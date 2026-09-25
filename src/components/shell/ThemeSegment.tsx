"use client";

import { DesktopIcon, MoonIcon, SunIcon } from "@phosphor-icons/react";
import { setThemePref, useThemePref, type ThemePref } from "./theme";

const OPTIONS: { value: ThemePref; label: string; icon: typeof SunIcon }[] = [
  { value: "system", label: "System", icon: DesktopIcon },
  { value: "light", label: "Light", icon: SunIcon },
  { value: "dark", label: "Dark", icon: MoonIcon },
];

export function ThemeSegment() {
  const pref = useThemePref();
  return (
    <div role="radiogroup" aria-label="Theme" className="inline-flex rounded-bahi border border-rule bg-paper p-1">
      {OPTIONS.map(({ value, label, icon: Icon }) => {
        const checked = pref === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={checked}
            onClick={() => setThemePref(value)}
            className={`inline-flex h-8 items-center gap-1.5 rounded-[4px] px-3 text-[13px] font-semibold transition-colors ${
              checked ? "bg-ink text-paper" : "text-ink-soft hover:text-ink"
            }`}
          >
            <Icon size={15} weight={checked ? "fill" : "regular"} aria-hidden />
            {label}
          </button>
        );
      })}
    </div>
  );
}
