import { describe, expect, it } from "vitest";
import {
  dayLabelIST,
  formatDateIST,
  formatDuration,
  formatINR,
  formatIST,
  formatNumberIN,
  formatTimeIST,
  istDateKey,
} from "./format";

describe("formatINR", () => {
  it("uses Indian digit grouping", () => {
    expect(formatINR(150000)).toBe("₹1,50,000");
    expect(formatINR(15000)).toBe("₹15,000");
    expect(formatINR(0)).toBe("₹0");
  });

  it("handles crores, paise, negatives and junk", () => {
    expect(formatINR(12345678)).toBe("₹1,23,45,678");
    expect(formatINR(1234.5)).toBe("₹1,234.50");
    expect(formatINR(-2500)).toBe("-₹2,500");
    expect(formatINR(Number.NaN)).toBe("₹0");
  });

  it("formats bare numbers with Indian grouping", () => {
    expect(formatNumberIN(150000)).toBe("1,50,000");
  });
});

describe("IST formatting", () => {
  // 08:44:07 UTC is 14:14:07 IST
  const t = "2026-09-26T08:44:07Z";

  it("formats date and time in IST", () => {
    expect(formatIST(t)).toBe("26 Sep, 2:14 PM");
    expect(formatIST(new Date(t))).toBe("26 Sep, 2:14 PM");
  });

  it("crosses midnight into the IST day", () => {
    expect(formatIST("2026-09-25T18:45:00Z")).toBe("26 Sep, 12:15 AM");
    expect(istDateKey("2026-09-25T18:45:00Z")).toBe("2026-09-26");
    expect(istDateKey("2026-09-25T18:29:59Z")).toBe("2026-09-25");
  });

  it("formats time and date parts", () => {
    expect(formatTimeIST(t)).toBe("2:14 PM");
    expect(formatTimeIST(t, { seconds: true })).toBe("2:14:07 PM");
    expect(formatDateIST(t)).toBe("26 Sep");
    expect(formatDateIST(t, { year: true })).toBe("26 Sep 2026");
  });

  it("labels days relative to now", () => {
    const now = "2026-09-26T08:44:07Z";
    expect(dayLabelIST("2026-09-26T01:00:00Z", now)).toBe("Aaj");
    expect(dayLabelIST("2026-09-25T10:00:00Z", now)).toBe("Kal");
    expect(dayLabelIST("2026-09-20T10:00:00Z", now)).toBe("20 Sep");
  });
});

describe("formatDuration", () => {
  it("switches from ms to seconds", () => {
    expect(formatDuration(412)).toBe("412 ms");
    expect(formatDuration(1234)).toBe("1.2 s");
    expect(formatDuration(-1)).toBe("0 ms");
  });
});
