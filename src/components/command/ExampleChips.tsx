"use client";

import { ChipButton } from "@/components/ui/Chip";
import { SCENARIOS } from "@/lib/scenarios";

/** The six demo scenarios (S1-S6), as the owner would say them. */
export const EXAMPLES = SCENARIOS.filter((s) => s.chip);

export function ExampleChips({ onPick, disabled }: { onPick: (command: string) => void; disabled?: boolean }) {
  return (
    <div className="mt-3">
      <p id="examples-label" className="sr-only">
        Example commands
      </p>
      <ul aria-labelledby="examples-label" className="flex flex-wrap gap-2">
        {EXAMPLES.map((ex) => (
          <li key={ex.id}>
            <ChipButton onClick={() => onPick(ex.command)} disabled={disabled} title={ex.command}>
              {ex.label}
            </ChipButton>
          </li>
        ))}
      </ul>
    </div>
  );
}
