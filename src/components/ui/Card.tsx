import type { ReactNode } from "react";

export function Card({
  children,
  className = "",
  as: Tag = "section",
  labelledBy,
}: {
  children: ReactNode;
  className?: string;
  as?: "section" | "div" | "article" | "aside";
  labelledBy?: string;
}) {
  return (
    <Tag className={`paper-card ${className}`} aria-labelledby={labelledBy}>
      {children}
    </Tag>
  );
}

export function CardHeader({ id, title, hint, action }: { id?: string; title: ReactNode; hint?: ReactNode; action?: ReactNode }) {
  return (
    <header className="flex items-start justify-between gap-3 border-b border-rule px-4 pt-3.5 pb-3">
      <div className="min-w-0">
        <h2 id={id} className="text-[17px] leading-tight font-medium text-ink">
          {title}
        </h2>
        {hint ? <p className="mt-0.5 text-[12.5px] text-ink-soft">{hint}</p> : null}
      </div>
      {action}
    </header>
  );
}
