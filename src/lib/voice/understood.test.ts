import { describe, expect, it } from "vitest";
import clients from "@fixtures/clients.json";
import { understandCommand } from "./understood";

const u = (text: string) => understandCommand(text, clients, 50_000);

describe("understandCommand (voice confirm strip)", () => {
  it("S1: amount, client and action, in that order", () => {
    const r = u("Sharma Traders ko website redesign ke liye 15,000 ka invoice bhejo");
    expect(r).toMatchObject({ money: true, action: "invoice", amountInr: 15_000, client: "Sharma Traders", needsApproval: false });
    expect(r.parts).toEqual(["₹15,000", "Sharma Traders", "invoice"]);
  });

  it("understands spoken Hinglish numbers and honorifics", () => {
    const r = u("verma ji ko assi hazaar ka bill bhejo");
    expect(r).toMatchObject({ amountInr: 80_000, client: "Verma Sweets", action: "invoice", needsApproval: true });
  });

  it("refunds to everyone and reminders are money commands even without an amount", () => {
    expect(u("Sabke payments refund kar do")).toMatchObject({ money: true, action: "refund", client: "sabke", parts: ["Sabke", "refund"] });
    expect(u("Kaun late hai? Sabko yaad dilao")).toMatchObject({ money: true, action: "reminder" });
  });

  it("reading commands run straight away", () => {
    expect(u("Aaj ka hisaab batao").money).toBe(false);
    expect(u("Inbox check karo aur jo kaam hai woh karo").money).toBe(false);
  });
});
