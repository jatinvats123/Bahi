import { TAGLINE } from "@/lib/brand";
import { ModeBadge } from "./ModeBadge";
import { NavLinks } from "./NavLinks";
import { ThemeToggle } from "./ThemeToggle";
import { Wordmark } from "./Wordmark";

/** Desktop sidebar: the bahi cover. Red linen, gold stitch, wordmark. Hidden below md. */
export function Sidebar({ businessName, mode }: { businessName: string; mode: "live" | "mock" }) {
  return (
    <aside className="bahi-cloth fixed inset-y-0 left-0 z-30 hidden w-[var(--sidebar-w)] flex-col px-6 pt-8 pb-6 md:flex">
      <div>
        <Wordmark />
        <p className="mt-2 font-serif text-[13.5px] text-cloth-ink-soft italic">{TAGLINE}</p>
      </div>

      <div className="mt-7 border-t border-dashed border-cloth-stitch/45 pt-4">
        <p className="text-[11px] font-semibold tracking-[0.14em] text-cloth-ink-soft uppercase">Khata</p>
        <p className="mt-0.5 truncate font-serif text-lg text-cloth-ink">{businessName}</p>
      </div>

      <nav aria-label="Main" className="-mx-3 mt-6">
        <NavLinks variant="sidebar" />
      </nav>

      <div className="mt-auto flex items-center justify-between gap-2 border-t border-dashed border-cloth-stitch/45 pt-4">
        <ModeBadge mode={mode} onCloth />
        <ThemeToggle className="text-cloth-ink-soft hover:bg-cloth-ink/10 hover:text-cloth-ink" />
      </div>
    </aside>
  );
}
