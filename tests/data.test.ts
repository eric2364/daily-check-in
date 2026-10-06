import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
      "date,intake_level,weight_kg,cardio_done,cardio_type,cardio_minutes,cardio_calories\r\n2020-01-01,2,,,,,\r\n2020-01-02,,72.5,,,,\r\n",
    );
  });

  it("rejects unsupported versions, malformed files, and invalid rows", () => {
    expect(() => parseJsonBackup("{")).toThrow(/valid JSON/);
    expect(() =>
      parseJsonBackup(JSON.stringify({ version: 3, entries })),
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
      "date,intake_level,weight_kg,cardio_done,cardio_type,cardio_minutes,cardio_calories\r\n2020-01-01,1,,,,,\r\n2020-01-02,5,73.125,,,,\r\n2020-01-03,,72.55,,,,\r\n",
    );
  });
});

describe("cardio compatibility and validation", () => {
  const base = { date: "2020-01-01", intake: null, weight: null };

  it("allows a cardio-only Yes or No and leaves legacy observations unknown", () => {
    expect(validateEntry({ ...base, cardio: true })).toEqual({
      ...base,
      cardio: true,
      cardioType: "",
      cardioMinutes: null,
      cardioCalories: null,
    });
    expect(validateEntry({ ...base, cardio: false }).cardio).toBe(false);
    expect(validateEntry({ ...base, intake: 3 })).toEqual({
      ...base,
      intake: 3,
    });
  });

  it("normalizes No without retaining old workout details", () => {
    expect(
      validateEntry({
        ...base,
        cardio: false,
        cardioType: "Run",
        cardioMinutes: 45,
        cardioCalories: 300,
      }),
    ).toEqual({
      ...base,
      cardio: false,
      cardioType: "",
      cardioMinutes: null,
      cardioCalories: null,
    });
  });

  it.each([
    { cardio: "Y" },
    { cardio: 1 },
    { cardio: true, cardioType: 7 },
    { cardio: true, cardioType: "x".repeat(101) },
    { cardio: true, cardioMinutes: -1 },
    { cardio: true, cardioMinutes: 1441 },
    { cardio: true, cardioMinutes: NaN },
    { cardio: true, cardioMinutes: "30" },
    { cardio: true, cardioCalories: -1 },
    { cardio: true, cardioCalories: 10001 },
    { cardio: true, cardioCalories: Infinity },
    { cardio: null, cardioType: "Run" },
    { cardioMinutes: 20 },
  ])("rejects invalid cardio data %j", (cardioFields) => {
    expect(() =>
      validateEntry({ ...base, intake: 3, ...cardioFields }),
    ).toThrow();
  });

  it("accepts manual decimal estimates and boundary values including zero", () => {
    expect(
      validateEntry({
        ...base,
        cardio: true,
        cardioType: "  Walk  ",
        cardioMinutes: 30.5,
        cardioCalories: 0,
      }),
    ).toMatchObject({
      cardioType: "Walk",
      cardioMinutes: 30.5,
      cardioCalories: 0,
    });
    expect(
      validateEntry({
        ...base,
        cardio: true,
        cardioMinutes: 1440,
        cardioCalories: 10000,
      }).cardioMinutes,
    ).toBe(1440);
  });

  it("round trips version 2 workouts and still imports version 1 records unchanged", () => {
    const workout = validateEntry({
      ...base,
      cardio: true,
      cardioType: "Bike",
      cardioMinutes: 20,
      cardioCalories: 200,
    });
    const backup = exportJson([workout]);
    expect(JSON.parse(backup).version).toBe(2);
    expect(parseJsonBackup(backup)).toEqual([workout]);
    const legacy = { ...base, weight: 70 };
    expect(
      parseJsonBackup(JSON.stringify({ version: 1, entries: [legacy] })),
    ).toEqual([legacy]);
  });

  it("quotes CSV text and neutralizes spreadsheet formula prefixes", () => {
    const csv = exportCsv([
      {
        ...base,
        cardio: true,
        cardioType: 'Walk, "brisk"\nindoors',
        cardioMinutes: 30,
        cardioCalories: 0,
      },
      { ...base, date: "2020-01-02", cardio: true, cardioType: "=SUM(1,2)" },
      { ...base, date: "2020-01-03", cardio: false },
      { ...base, date: "2020-01-04", intake: 3 },
    ]);
    expect(csv).toContain(
      '2020-01-01,,,Yes,"Walk, ""brisk""\nindoors",30,0\r\n',
    );
    expect(csv).toContain('2020-01-02,,,Yes,"\'=SUM(1,2)",,\r\n');
    expect(csv).toContain("2020-01-03,,,No,,,\r\n");
    expect(csv).toContain("2020-01-04,3,,,,,\r\n");
  });

  it("persists workouts and rejects invalid cardio import atomically", async () => {
    const workout = validateEntry({
      ...base,
      date: "2020-02-01",
      cardio: true,
      cardioType: "Run",
      cardioMinutes: 45,
      cardioCalories: 400,
    });
    await saveEntry(workout);
    await expect(
      importEntries([
        { ...workout, cardioMinutes: 20 },
        { ...workout, date: "2020-02-02", cardioCalories: -1 },
      ]),
    ).rejects.toThrow();
    expect(
      (await listEntries()).find((entry) => entry.date === workout.date),
    ).toEqual(workout);
    await deleteEntry(workout.date);
  });
});

it("retains cardio-only entries across a fresh module session and backup restore", async () => {
  const workout = validateEntry({
    date: "2020-03-01",
    intake: null,
    weight: null,
    cardio: true,
    cardioType: "Cycling",
    cardioMinutes: 12.5,
    cardioCalories: 105.25,
  });
  const rest = validateEntry({
    date: "2020-03-02",
    intake: null,
    weight: null,
    cardio: false,
  });
  await saveEntry(workout);
  await saveEntry(rest);
  vi.resetModules();
  const fresh = await import("../src/data");
  const reloaded = (await fresh.listEntries()).filter((entry) =>
    entry.date.startsWith("2020-03"),
  );
  expect(reloaded).toEqual([workout, rest]);
  const backup = fresh.exportJson(reloaded);
  await fresh.deleteEntry(workout.date);
  await fresh.deleteEntry(rest.date);
  await fresh.importEntries(fresh.parseJsonBackup(backup));
  expect(
    (await fresh.listEntries()).filter((entry) =>
      entry.date.startsWith("2020-03"),
    ),
  ).toEqual([workout, rest]);
  await fresh.saveEntry({ ...workout, cardio: false });
  expect(
    (await fresh.listEntries()).find((entry) => entry.date === workout.date),
  ).toEqual({
    ...workout,
    cardio: false,
    cardioType: "",
    cardioMinutes: null,
    cardioCalories: null,
  });
  await fresh.deleteEntry(workout.date);
  await fresh.deleteEntry(rest.date);
  expect(
    (await fresh.listEntries()).some((entry) =>
      entry.date.startsWith("2020-03"),
    ),
  ).toBe(false);
});
