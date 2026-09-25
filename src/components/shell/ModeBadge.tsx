/**
 * Always visible in mock mode so fixture data is never mistaken for real business data.
 * `onCloth` styles it for the red sidebar / bottom bar.
 */
export function ModeBadge({ mode, onCloth = false }: { mode: "live" | "mock"; onCloth?: boolean }) {
  if (mode === "live") {
    return (
      <span
        className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11.5px] font-semibold ${
          onCloth ? "border-cloth-ink/40 text-cloth-ink" : "border-paid/50 text-paid-ink"
        }`}
      >
        Live sandbox
      </span>
    );
  }
  return (
    <span
      title="Sab data fixtures se hai. Koi asli payment, email ya message nahi."
      className={`num inline-flex items-center rounded-[3px] border-[1.5px] border-dashed px-2 py-0.5 text-[11px] font-semibold tracking-[0.12em] uppercase ${
        onCloth ? "border-cloth-stitch text-cloth-stitch" : "border-pending text-pending-ink"
      }`}
    >
      Mock data
    </span>
  );
}
