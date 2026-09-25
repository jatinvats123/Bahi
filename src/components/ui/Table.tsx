import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from "react";

/** Ledger table primitives: ruled rows, mono numerals, no zebra striping. */

export function Table({ className = "", ...rest }: HTMLAttributes<HTMLTableElement>) {
  return <table className={`w-full border-collapse text-left text-sm ${className}`} {...rest} />;
}

export function THead(props: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead {...props} />;
}

export function TBody(props: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody {...props} />;
}

export function TR({ className = "", ...rest }: HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={`border-b border-rule/70 last:border-b-0 ${className}`} {...rest} />;
}

export function TH({ className = "", scope = "col", ...rest }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope={scope}
      className={`border-b border-ink/70 px-3 pt-2 pb-2 text-[11.5px] font-semibold tracking-[0.06em] text-ink-soft uppercase ${className}`}
      {...rest}
    />
  );
}

export function TD({ className = "", ...rest }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={`px-3 py-3 align-top ${className}`} {...rest} />;
}
