import { describe, expect, it } from "vitest";
import { amountMismatch, extractAmounts, parseAmountInr } from "./amount";

describe("parseAmountInr", () => {
  it.each([
    ["15000", 15_000],
    ["15,000", 15_000],
    ["₹1,50,000", 150_000],
    ["Rs 15,000", 15_000],
    ["Rs. 2500", 2_500],
    ["80k", 80_000],
    ["80 k", 80_000],
    ["1.5 lakh", 150_000],
    ["1.5L", 150_000],
    ["2 lakh", 200_000],
    ["2 lakh 50 hazaar", 250_000],
    ["1 crore", 10_000_000],
    ["pandrah hazaar", 15_000],
    ["pandra hazar", 15_000],
    ["assi hazaar", 80_000],
    ["bees hazaar", 20_000],
    ["sava lakh", 125_000],
    ["sawa lakh", 125_000],
    ["sava do lakh", 225_000],
    ["dedh lakh", 150_000],
    ["dhai lakh", 250_000],
    ["saadhe teen hazaar", 3_500],
    ["paune do lakh", 175_000],
    ["ek lakh bees hazaar", 120_000],
    ["do hazaar paanch sau", 2_500],
    ["pandrah sau", 1_500],
    ["chalis hazaar rupaye", 40_000],
    ["fifteen thousand", 15_000],
    ["ek lakh", 100_000],
  ])("%s -> %d", (phrase, expected) => {
    expect(parseAmountInr(phrase)).toBe(expected);
  });

  it("returns null when there is no amount", () => {
    expect(parseAmountInr("Sharma ji ko invoice bhej do")).toBeNull();
    expect(parseAmountInr("")).toBeNull();
    expect(parseAmountInr("so jao")).toBeNull();
  });
});

describe("extractAmounts", () => {
  it("finds the amount inside a full Hinglish command", () => {
    expect(extractAmounts("Sharma Traders ko website redesign ke liye 15,000 ka invoice bhejo")).toEqual([15_000]);
    expect(extractAmounts("Sharma ji ko pandrah hazaar ka invoice bhej do")).toEqual([15_000]);
    expect(extractAmounts("Verma Sweets ko 80,000 ka invoice bhejo")).toEqual([80_000]);
  });

  it("keeps separate numbers apart and ignores invoice ids", () => {
    expect(extractAmounts("8 videos ke liye 32000 ka invoice")).toEqual([8, 32_000]);
    expect(extractAmounts("INV-2026-0131 ka status batao")).toEqual([]);
  });

  it("does not read 'bhej do' as 2", () => {
    expect(extractAmounts("invoice bhej do")).toEqual([]);
  });
});

describe("amountMismatch", () => {
  it("accepts the owner's amount", () => {
    expect(amountMismatch(15_000, { command: "Sharma ko 15,000 ka invoice bhejo" })).toBeNull();
    expect(amountMismatch(125_000, { phrase: "sava lakh" })).toBeNull();
  });

  it("flags a model number that differs from the owner's words", () => {
    expect(amountMismatch(1_500, { command: "Sharma ko pandrah hazaar ka invoice bhejo" })).toMatch(/15000/);
    expect(amountMismatch(12_500, { phrase: "sava lakh" })).toMatch(/125000/);
  });

  it("has nothing to check when the command has no amount (inbox runs)", () => {
    expect(amountMismatch(12_000, { command: "Inbox check karo aur jo kaam hai woh karo" })).toBeNull();
  });
});
