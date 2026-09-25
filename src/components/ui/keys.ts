/** True when a key press belongs to the focused control (typing, a button, a select), not to a page shortcut. */
export function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return Boolean(target.closest("input, textarea, select, button, a[href], [role='button'], [role='menuitem'], [role='option'], [role='slider']"));
}

/** True only for text entry (where "/" and Space are characters, not shortcuts). */
export function isTextTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || Boolean(target.closest("input, textarea, select"));
}

export const DEMO_EVENT = "bahi:demo-run";
export type DemoRunDetail = { scenario: string };
