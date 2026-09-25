"use client";

import { BookOpenTextIcon, ClockCounterClockwiseIcon, GearSixIcon, MicrophoneStageIcon, type Icon } from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname } from "next/navigation";

interface NavItem {
  href: string;
  label: string;
  hint: string;
  icon: Icon;
}

export const NAV: NavItem[] = [
  { href: "/", label: "Command", hint: "Hukum", icon: MicrophoneStageIcon },
  { href: "/ledger", label: "Ledger", hint: "Khata", icon: BookOpenTextIcon },
  { href: "/activity", label: "Activity", hint: "Kaam ka record", icon: ClockCounterClockwiseIcon },
  { href: "/settings", label: "Settings", hint: "Setup", icon: GearSixIcon },
];

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export function NavLinks({ variant }: { variant: "sidebar" | "bottom" }) {
  const pathname = usePathname();

  if (variant === "bottom") {
    return (
      <ul className="grid grid-cols-4">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex h-16 flex-col items-center justify-center gap-1 text-[11.5px] font-semibold tracking-wide ${
                  active ? "text-cloth-ink" : "text-cloth-ink-soft"
                }`}
              >
                <span className={`flex h-7 w-12 items-center justify-center rounded-full ${active ? "bg-cloth-ink/15" : ""}`}>
                  <Icon size={21} weight={active ? "fill" : "regular"} aria-hidden />
                </span>
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <ul className="space-y-1">
      {NAV.map(({ href, label, hint, icon: Icon }) => {
        const active = isActive(pathname, href);
        return (
          <li key={href}>
            <Link
              href={href}
              aria-current={active ? "page" : undefined}
              className={`group relative flex items-center gap-3 rounded-bahi px-3 py-2.5 transition-colors ${
                active ? "bg-cloth-ink/12 text-cloth-ink" : "text-cloth-ink-soft hover:bg-cloth-ink/7 hover:text-cloth-ink"
              }`}
            >
              {active ? <span aria-hidden className="absolute top-2 bottom-2 -left-[3px] w-[3px] rounded-full bg-cloth-stitch" /> : null}
              <Icon size={20} weight={active ? "fill" : "regular"} aria-hidden />
              <span className="flex flex-col leading-tight">
                <span className="text-[14.5px] font-semibold">{label}</span>
                <span className="text-[11.5px] text-cloth-ink-soft">{hint}</span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
