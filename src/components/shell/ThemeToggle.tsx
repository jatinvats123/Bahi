"use client";

import { MoonIcon, SunIcon } from "@phosphor-icons/react";
import { resolvedTheme, setThemePref } from "./theme";

/**
 * Flips between light and dark. Icons are swapped with CSS (data-theme), so the
 * server and client render identical markup and there is no hydration flash.
 */
export function ThemeToggle({ className = "" }: { className?: string }) {
  return (
    <button
      type="button"
      onClick={() => setThemePref(resolvedTheme() === "dark" ? "light" : "dark")}
      className={`inline-flex size-9 items-center justify-center rounded-bahi transition-colors ${className}`}
      aria-label="Light ya dark theme badlo"
      title="Theme badlo"
    >
      <MoonIcon size={18} weight="duotone" className="dark:hidden" aria-hidden />
      <SunIcon size={18} weight="duotone" className="hidden dark:block" aria-hidden />
    </button>
  );
}
