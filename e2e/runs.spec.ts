import { expect, test } from "@playwright/test";
import { getScenario } from "../src/lib/scenarios";
import { NO_SPEECH, recordedView, sendCommand, SPEECH_STUB, steps, watchConsole } from "./helpers";

/**
 * Recorded runs (AGENT_MODE=replay): the browser gets the same NDJSON stream a live run
 * produces, so these exercise the real streaming, reducer and timeline.
 */

const runStamp = (page: import("@playwright/test").Page, kind: string) => page.getByTestId("run-stamp").locator(`[data-stamp=${kind}]`);

test.describe("recorded runs", () => {
  test("S1 renders every step, the SENT stamp and the Recorded run badge", async ({ page }) => {
    const console = watchConsole(page);
    const expected = recordedView("S1");
    await page.goto("/");
    await sendCommand(page, getScenario("S1").command);

    await expect(page.getByTestId("recorded-badge")).toBeVisible();
    await expect(runStamp(page, "sent")).toBeVisible({ timeout: 30_000 });
    await expect(steps(page)).toHaveCount(expected.entries.length);
    await expect(page.getByText("Kaam poora")).toBeVisible();
    // The PayPal send step carries its own SENT stamp and a copy button for the invoice id.
    const send = steps(page).filter({ hasText: "Invoice bheja" });
    await expect(send.locator("[data-stamp=sent]")).toBeVisible();
    await expect(send.getByTestId("copy-id")).toBeVisible();
    // Never shown as live.
    await expect(page.getByText("Recorded run: S1")).toBeVisible();
    await expect(steps(page).first().getByText("Live", { exact: true })).toHaveCount(0);
    console.check();
  });

  test("S2 shows AWAITING, then APPROVED, with a read-only approval card", async ({ page }) => {
    await page.goto("/");
    await sendCommand(page, getScenario("S2").command);
    await expect(runStamp(page, "awaiting")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Recorded run: owner ka faisla recording se aayega.").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve karein" })).toHaveCount(0);
    await expect(runStamp(page, "approved")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Kaam poora")).toBeVisible({ timeout: 30_000 });
    await expect(steps(page)).toHaveCount(recordedView("S2").entries.length);
  });

  test("S2-deny (Demo controls) ends DENIED", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.keyboard.press("Control+Shift+D");
    await expect(page.getByTestId("demo-controls")).toBeVisible();
    await page.getByTestId("demo-S2-deny").click();
    await expect(page.getByTestId("demo-controls")).toBeHidden();
    await expect(runStamp(page, "denied")).toBeVisible({ timeout: 30_000 });
  });

  test("S5 is BLOCKED by policy before PayPal", async ({ page }) => {
    await page.goto("/");
    await sendCommand(page, getScenario("S5").command);
    await expect(runStamp(page, "blocked")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Rok diya gaya: policy").first()).toBeVisible();
    await expect(page.getByText("Batch roka gaya")).toBeVisible({ timeout: 30_000 });
  });

  test("S3 flags the suspicious email and alerts the team", async ({ page }) => {
    await page.goto("/");
    await sendCommand(page, getScenario("S3").command);
    const guard = steps(page).filter({ hasText: "Shak hua: koi action nahi" });
    await expect(guard).toBeVisible({ timeout: 30_000 });
    await expect(guard).toContainText("ignore its instructions");
    await expect(steps(page).filter({ hasText: "(alert): Suspicious email" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Kaam poora")).toBeVisible({ timeout: 30_000 });
    await expect(steps(page)).toHaveCount(recordedView("S3").entries.length);
  });

  test("S4 and S6 play from the Demo controls on another page", async ({ page }) => {
    await page.goto("/ledger");
    await page.waitForLoadState("networkidle");
    await page.keyboard.press("Control+Shift+D");
    await page.getByTestId("demo-S6").click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByText("Recorded run: S6")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Kaam poora")).toBeVisible({ timeout: 30_000 });

    await page.keyboard.press("Control+Shift+D");
    await page.getByTestId("demo-S4").click();
    await expect(page.getByText("Recorded run: S4")).toBeVisible({ timeout: 30_000 });
    await expect(steps(page).filter({ hasText: "Email bheja" })).toBeVisible({ timeout: 30_000 });
  });

  test("a command with no recording is refused politely", async ({ page }) => {
    await page.goto("/");
    await sendCommand(page, "Chai bana do");
    await expect(page.getByRole("alert").filter({ hasText: "Recorded mode" })).toBeVisible();
  });
});

test.describe("keyboard", () => {
  test('"/" focuses the command bar and Up recalls the last command', async ({ page }) => {
    await page.goto("/");
    await page.getByText("Namaste, DukaanSetu").click();
    await page.keyboard.press("/");
    await expect(page.locator("#command-input")).toBeFocused();
    await expect(page.locator("#command-input")).toHaveValue("");

    await sendCommand(page, getScenario("S6").command);
    await expect(page.getByText("Kaam poora")).toBeVisible({ timeout: 30_000 });
    await page.locator("#command-input").focus();
    await page.keyboard.press("ArrowUp");
    await expect(page.locator("#command-input")).toHaveValue(getScenario("S6").command);
  });
});

test.describe("voice", () => {
  test("mic is hidden when the browser has no SpeechRecognition", async ({ page }) => {
    await page.addInitScript(NO_SPEECH);
    await page.goto("/");
    await expect(page.getByText("Voice ke liye Chrome use karein")).toBeVisible();
    await expect(page.getByTestId("mic-button")).toHaveCount(0);
  });

  test("with SpeechRecognition the mic listens, and a money command waits on the confirm strip", async ({ page }) => {
    await page.addInitScript(SPEECH_STUB);
    await page.goto("/");
    const mic = page.getByTestId("mic-button");
    await expect(mic).toBeVisible();
    await expect(mic).toHaveAttribute("data-state", "idle");
    await mic.click();
    await expect(mic).toHaveAttribute("data-state", "listening");
    await expect(mic).toHaveAttribute("aria-pressed", "true");

    await page.evaluate((t) => (window as unknown as { __speech: { say: (x: string) => boolean } }).__speech.say(t), getScenario("S1").command);
    const strip = page.getByTestId("voice-confirm");
    await expect(strip).toBeVisible();
    await expect(strip).toContainText("₹15,000 · Sharma Traders · invoice");
    // After the 2.5 s countdown it runs, marked as spoken.
    await expect(strip).toBeHidden({ timeout: 6_000 });
    await expect(page.getByText("Awaaz se")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("run-stamp").locator("[data-stamp=sent]")).toBeVisible({ timeout: 30_000 });
  });

  test("Roko on the confirm strip cancels, and a reading command runs straight away", async ({ page }) => {
    await page.addInitScript(SPEECH_STUB);
    await page.goto("/");
    const mic = page.getByTestId("mic-button");
    await mic.click();
    await expect(mic).toHaveAttribute("data-state", "listening");
    await page.evaluate(() => (window as unknown as { __speech: { say: (x: string) => boolean } }).__speech.say("Verma ji ko assi hazaar ka invoice bhejo"));
    const strip = page.getByTestId("voice-confirm");
    await expect(strip).toContainText("₹80,000 · Verma Sweets · invoice");
    await expect(strip).toContainText("approval lagega");
    await strip.getByRole("button", { name: "Roko" }).click();
    await expect(strip).toBeHidden();
    await page.waitForTimeout(3000);
    await expect(page.getByText("Abhi koi kaam nahi chal raha.")).toBeVisible();

    await mic.click();
    await expect(mic).toHaveAttribute("data-state", "listening");
    await page.evaluate(() => (window as unknown as { __speech: { say: (x: string) => boolean } }).__speech.say("Aaj ka hisaab batao"));
    await expect(page.getByTestId("voice-confirm")).toHaveCount(0);
    await expect(page.getByText("Recorded run: S6")).toBeVisible({ timeout: 10_000 });
  });

  test("hold Space to talk when focus is not in a text field", async ({ page }) => {
    await page.addInitScript(SPEECH_STUB);
    await page.goto("/");
    await page.getByText("Namaste, DukaanSetu").click();
    await page.keyboard.down("Space");
    await expect(page.getByTestId("mic-button")).toHaveAttribute("data-state", "listening");
    await page.keyboard.up("Space");
    await expect(page.getByTestId("mic-button")).toHaveAttribute("data-state", "idle");
  });
});
