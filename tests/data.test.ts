import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  deleteEntry,
  exportCsv,
  exportJson,
  getSettings,
  importEntries,
  listEntries,
  parseJsonBackup,
  saveEntry,
  saveSettings,
  todayHkt,
  validateEntry,
  validateSettings,
} from "../src/data";

const today = "2026-10-06";

describe("dates and entry validation", () => {
  it("uses the Hong Kong date across midnight", () => {
    expect(todayHkt(new Date("2026-10-05T15:59:00Z"))).toBe("2026-10-05");
    expect(todayHkt(new Date("2026-10-05T16:00:00Z"))).toBe("2026-10-06");
  });

  it("accepts partial entries and both measurements", () => {
    expect(
      validateEntry({ date: today, intake: 3, weight: null }, today).intake,
    ).toBe(3);
    expect(
      validateEntry({ date: today, intake: null, weight: 70.2 }, today).weight,
    ).toBe(70.2);
    expect(
      validateEntry({ date: "2024-02-29", intake: 5, weight: 1000 }, today)
        .date,
    ).toBe("2024-02-29");
  });

  it.each([
    "2026-02-29",
    "2026-02-30",
    "2026-13-01",
    "2026-1-01",
    "2026-10-07",
    "not-a-date",
  ])("rejects invalid or future date %s", (date) => {
    expect(() =>
      validateEntry({ date, intake: 3, weight: null }, today),
    ).toThrow();
  });

  it.each([0, 6, 1.5, NaN, "3", undefined])(
    "rejects invalid intake %s",
    (intake) => {
      expect(() =>
        validateEntry({ date: today, intake, weight: null }, today),
      ).toThrow();
    },
  );

  it.each([0, -1, 1001, Infinity, NaN, "70", undefined])(
    "rejects invalid weight %s",
    (weight) => {
      expect(() =>
        validateEntry({ date: today, intake: null, weight }, today),
      ).toThrow();
    },
  );

  it("rejects an empty entry", () => {
    expect(() =>
      validateEntry({ date: today, intake: null, weight: null }, today),
    ).toThrow(/Add an intake/);
  });

  it("validates reminder settings", () => {
    expect(
      validateSettings({ reminderEnabled: false, reminderTime: "09:00" })
        .reminderTime,
    ).toBe("09:00");
    expect(() =>
      validateSettings({ reminderEnabled: true, reminderTime: "24:00" }),
    ).toThrow();
    expect(() =>
      validateSettings({ reminderEnabled: true, reminderTime: "9:00" }),
    ).toThrow();
  });
});

describe("backup files", () => {
  const entries = [
    { date: "2020-01-02", intake: null, weight: 72.5 },
    { date: "2020-01-01", intake: 2, weight: null },
  ];

  it("round trips partial measurements and sorts dates", () => {
    expect(parseJsonBackup(exportJson(entries))).toEqual([
      entries[1],
      entries[0],
    ]);
  });

  it("writes missing CSV measurements as empty cells", () => {
    expect(exportCsv(entries)).toBe(
      "date,intake_level,weight_kg\r\n2020-01-01,2,\r\n2020-01-02,,72.5\r\n",
    );
  });

  it("rejects unsupported versions, malformed files, and invalid rows", () => {
    expect(() => parseJsonBackup("{")).toThrow(/valid JSON/);
    expect(() =>
      parseJsonBackup(JSON.stringify({ version: 2, entries })),
    ).toThrow(/version/);
    expect(() =>
      parseJsonBackup(JSON.stringify({ version: 1, entries: null })),
    ).toThrow(/array/);
    expect(() =>
      parseJsonBackup(
        JSON.stringify({
          version: 1,
          entries: [{ ...entries[0], weight: -1 }],
        }),
      ),
    ).toThrow(/Weight/);
    expect(() =>
      parseJsonBackup(
        JSON.stringify({ version: 1, entries: [entries[0], entries[0]] }),
      ),
    ).toThrow(/duplicate/);
  });
});

describe("persistent local data", () => {
  beforeEach(async () => {
    for (const entry of await listEntries()) await deleteEntry(entry.date);
    await saveSettings({ reminderEnabled: false, reminderTime: "09:00" });
  });

  it("creates, overwrites, lists in date order, and deletes entries", async () => {
    await saveEntry({ date: "2020-01-02", intake: 3, weight: null });
    await saveEntry({ date: "2020-01-01", intake: null, weight: 70 });
    await saveEntry({ date: "2020-01-02", intake: 4, weight: 69 });
    expect(await listEntries()).toEqual([
      { date: "2020-01-01", intake: null, weight: 70 },
      { date: "2020-01-02", intake: 4, weight: 69 },
    ]);
    await deleteEntry("2020-01-01");
    expect(await listEntries()).toHaveLength(1);
  });

  it("persists settings", async () => {
    await saveSettings({ reminderEnabled: true, reminderTime: "21:45" });
    expect(await getSettings()).toEqual({
      reminderEnabled: true,
      reminderTime: "21:45",
    });
  });

  it("merges an import and replaces only matching dates", async () => {
    await saveEntry({ date: "2020-01-01", intake: 3, weight: 70 });
    await saveEntry({ date: "2020-01-02", intake: 3, weight: 69 });
    await importEntries([
      { date: "2020-01-01", intake: 4, weight: null },
      { date: "2020-01-03", intake: null, weight: 68 },
    ]);
    expect(await listEntries()).toEqual([
      { date: "2020-01-01", intake: 4, weight: null },
      { date: "2020-01-02", intake: 3, weight: 69 },
      { date: "2020-01-03", intake: null, weight: 68 },
    ]);
  });

  it("rejects a bad import before changing any stored records", async () => {
    const original = { date: "2020-01-01", intake: 3, weight: 70 };
    await saveEntry(original);
    await expect(
      importEntries([
        { date: "2020-01-01", intake: 5, weight: 65 },
        { date: "2020-01-02", intake: null, weight: -1 },
      ]),
    ).rejects.toThrow();
    expect(await listEntries()).toEqual([original]);
  });

  it("exports restored entries to CSV without losing numeric fields or missing cells", async () => {
    const backup = exportJson([
      { date: "2020-01-03", intake: null, weight: 72.55 },
      { date: "2020-01-01", intake: 1, weight: null },
      { date: "2020-01-02", intake: 5, weight: 73.125 },
    ]);
    await importEntries(parseJsonBackup(backup));
    expect(exportCsv(await listEntries())).toBe(
      "date,intake_level,weight_kg\r\n2020-01-01,1,\r\n2020-01-02,5,73.125\r\n2020-01-03,,72.55\r\n",
    );
  });
});
