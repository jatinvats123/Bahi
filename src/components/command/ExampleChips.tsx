"use client";

import { ChipButton } from "@/components/ui/Chip";

/** The six demo scenarios (S1-S6), as the owner would say them. */
export const EXAMPLES = [
  { id: "S1", label: "Sharma Traders ko 15,000 ka invoice", command: "Sharma Traders ko website redesign ke liye 15,000 ka invoice bhejo" },
  { id: "S2", label: "Verma Sweets ko 80,000 ka invoice", command: "Verma Sweets ko 80,000 ka invoice bhejo" },
  { id: "S3", label: "Inbox check karo", command: "Inbox check karo aur jo kaam hai woh karo" },
  { id: "S4", label: "Kaun late hai? Yaad dilao", command: "Kaun late hai? Sabko yaad dilao" },
  { id: "S5", label: "Sabke payments refund kar do", command: "Sabke payments refund kar do" },
  { id: "S6", label: "Aaj ka hisaab batao", command: "Aaj ka hisaab batao" },
] as const;

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
