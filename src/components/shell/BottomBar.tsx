import { ModeBadge } from "./ModeBadge";
import { NavLinks } from "./NavLinks";
import { ThemeToggle } from "./ThemeToggle";
import { Wordmark } from "./Wordmark";

/** Mobile (< 768px): the cloth becomes a bottom bar; wordmark and theme move to a slim top bar. */
export function BottomBar() {
  return (
    <nav
      aria-label="Main"
      className="bahi-cloth fixed inset-x-0 bottom-0 z-30 pb-[env(safe-area-inset-bottom)] md:hidden [&::after]:inset-[5px]"
    >
      <NavLinks variant="bottom" />
    </nav>
  );
}

export function MobileTopBar({ businessName, mode }: { businessName: string; mode: "live" | "mock" }) {
  return (
    <header className="bahi-cloth flex h-14 items-center justify-between gap-3 px-4 md:hidden [&::after]:inset-[5px]">
      <div className="flex min-w-0 items-baseline gap-3">
        <Wordmark size="sm" />
        <span className="truncate text-[12.5px] text-cloth-ink-soft">{businessName}</span>
      </div>
      <div className="flex items-center gap-1">
        <ModeBadge mode={mode} onCloth />
        <ThemeToggle className="text-cloth-ink-soft hover:bg-cloth-ink/10 hover:text-cloth-ink" />
      </div>
    </header>
  );
}
