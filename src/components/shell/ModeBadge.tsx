/**
 * Always visible in mock mode (and in replay mode, "Recorded") so fixture data is never mistaken for real business data.
 * `onCloth` styles it for the red sidebar / bottom bar.
 */
export function ModeBadge({
  mode,
  agentMode = "live",
  onCloth = false,
  compact = false,
}: {
  mode: "live" | "mock";
  agentMode?: "live" | "replay";
  onCloth?: boolean;
  /** One badge instead of two (the slim mobile top bar). */
  compact?: boolean;
}) {
  if (agentMode === "replay" && compact) {
    return (
      <span
        title={`Recorded runs${mode === "mock" ? ", mock data" : ""}: commands asli agent ko nahi jaate.`}
        className={`num inline-flex items-center rounded-[3px] border-[1.5px] border-dashed px-1.5 py-0.5 text-[10.5px] font-semibold tracking-[0.1em] whitespace-nowrap uppercase ${
          onCloth ? "border-cloth-stitch text-cloth-stitch" : "border-approval text-approval-ink"
        }`}
      >
        {mode === "mock" ? "Mock + Rec" : "Recorded"}
      </span>
    );
  }
  if (agentMode === "replay") {
    return (
      <span className="flex flex-wrap items-center gap-1.5">
        <DataBadge mode={mode} onCloth={onCloth} />
        <span
          title="Commands asli agent ko nahi jaate: pehle record kiye gaye live runs dobara chalte hain."
          className={`num inline-flex items-center rounded-[3px] border-[1.5px] border-dashed px-2 py-0.5 text-[11px] font-semibold tracking-[0.12em] uppercase ${
            onCloth ? "border-cloth-ink/70 text-cloth-ink" : "border-approval text-approval-ink"
          }`}
        >
          Recorded
        </span>
      </span>
    );
  }
  return <DataBadge mode={mode} onCloth={onCloth} />;
}

function DataBadge({ mode, onCloth }: { mode: "live" | "mock"; onCloth: boolean }) {
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
