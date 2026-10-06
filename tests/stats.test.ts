import { describe, expect, it } from "vitest";
import {
  calculateStats,
  getCalendarEntries,
  getPeriodEntries,
  rollingWeightAverages,
  shiftDate,
} from "../src/stats";
import type { Entry } from "../src/types";

const entries: Entry[] = [
  { date: "2026-09-29", weight: 80, intake: 5 },
  { date: "2026-09-30", weight: 78, intake: null },
  { date: "2026-10-03", weight: null, intake: 2 },
  { date: "2026-10-06", weight: 76, intake: 4 },
];

describe("statistics", () => {
  it("selects the trailing seven calendar days inclusive of today", () => {
    expect(
      getPeriodEntries(entries, "7", "2026-10-06").map((entry) => entry.date),
    ).toEqual(["2026-09-30", "2026-10-03", "2026-10-06"]);
    expect(getPeriodEntries(entries, "30", "2026-10-06")).toHaveLength(4);
  });

  it("calculates changes and intake only from actual observations", () => {
    expect(calculateStats(entries, "7", "2026-10-06")).toEqual({
      latestWeight: 76,
      weightChange: -2,
      averageIntake: 3,
      loggedDays: 3,
      cardioDays: 0,
      totalCardioMinutes: 0,
      totalCardioCalories: 0,
    });
  });

  it("returns missing statistics rather than zeros", () => {
    expect(calculateStats([], "all", "2026-10-06")).toEqual({
      latestWeight: null,
      weightChange: null,
      averageIntake: null,
      loggedDays: 0,
      cardioDays: 0,
      totalCardioMinutes: 0,
      totalCardioCalories: 0,
    });
    expect(
      calculateStats([entries[0]], "all", "2026-10-06").weightChange,
    ).toBeNull();
  });

  it("retains latest weight even when it predates the selected period", () => {
    expect(calculateStats([entries[0]], "7", "2026-10-06")).toEqual({
      latestWeight: 80,
      weightChange: null,
      averageIntake: null,
      loggedDays: 0,
      cardioDays: 0,
      totalCardioMinutes: 0,
      totalCardioCalories: 0,
    });
  });

  it("excludes future dates and sorts input without mutation", () => {
    const unsorted = [...entries].reverse();
    expect(
      getPeriodEntries(unsorted, "all", "2026-10-03").map(
        (entry) => entry.date,
      ),
    ).toEqual(["2026-09-29", "2026-09-30", "2026-10-03"]);
    expect(unsorted[0].date).toBe("2026-10-06");
  });

  it("uses seven calendar days instead of seven measurements for the average", () => {
    expect(rollingWeightAverages(entries)).toEqual([
      { date: "2026-09-29", weight: 80, average: 80 },
      { date: "2026-09-30", weight: 78, average: 79 },
      { date: "2026-10-03", weight: null, average: 79 },
      { date: "2026-10-06", weight: 76, average: 77 },
    ]);
    expect(
      rollingWeightAverages([
        { date: "2026-01-01", weight: 70, intake: null },
        { date: "2026-01-10", weight: null, intake: 3 },
      ]).at(-1)?.average,
    ).toBeNull();
  });

  it("shifts dates correctly across year and leap-day boundaries", () => {
    expect(shiftDate("2026-01-01", -1)).toBe("2025-12-31");
    expect(shiftDate("2024-03-01", -1)).toBe("2024-02-29");
  });

  it("expands seven and thirty day windows with nulls on missing dates", () => {
    const calendar = getCalendarEntries(entries, "7", "2026-10-06");
    expect(calendar).toHaveLength(7);
    expect(calendar[0]).toEqual(entries[1]);
    expect(calendar[1]).toEqual({
      date: "2026-10-01",
      intake: null,
      weight: null,
    });
    expect(calendar.at(-1)).toEqual(entries.at(-1));
    expect(getCalendarEntries([], "30", "2026-10-06")).toHaveLength(30);
    expect(calculateStats(entries, "7", "2026-10-06").loggedDays).toBe(3);
  });

  it("expands all time from earliest observed date through today", () => {
    const calendar = getCalendarEntries(entries, "all", "2026-10-08");
    expect(calendar).toHaveLength(10);
    expect(calendar[0].date).toBe("2026-09-29");
    expect(calendar.at(-1)).toEqual({
      date: "2026-10-08",
      intake: null,
      weight: null,
    });
    expect(getCalendarEntries([], "all", "2026-10-08")).toEqual([]);
    expect(getCalendarEntries(entries, "all", "2026-09-28")).toEqual([]);
  });

  it("retains missing measurement gaps while averaging calendar-expanded history", () => {
    const calendar = getCalendarEntries(entries, "all", "2026-10-06");
    const averages = rollingWeightAverages(calendar);
    expect(averages.find((entry) => entry.date === "2026-10-01")).toEqual({
      date: "2026-10-01",
      weight: null,
      average: 79,
    });
    expect(averages.at(-1)).toEqual({
      date: "2026-10-06",
      weight: 76,
      average: 77,
    });
  });
});

it("counts only Yes cardio in the selected calendar window", () => {
  const observations: Entry[] = [
    {
      date: "2026-09-29",
      intake: null,
      weight: null,
      cardio: true,
      cardioMinutes: 90,
      cardioCalories: 700,
    },
    {
      date: "2026-09-30",
      intake: null,
      weight: null,
      cardio: true,
      cardioMinutes: 30.5,
      cardioCalories: 250,
    },
    { date: "2026-10-01", intake: null, weight: null, cardio: false },
    { date: "2026-10-03", intake: 3, weight: null },
    { date: "2026-10-04", intake: null, weight: null, cardio: true },
    {
      date: "2026-10-06",
      intake: null,
      weight: null,
      cardio: true,
      cardioMinutes: 10,
      cardioCalories: 0,
    },
    {
      date: "2026-10-07",
      intake: null,
      weight: null,
      cardio: true,
      cardioMinutes: 60,
      cardioCalories: 600,
    },
  ];
  expect(calculateStats(observations, "7", "2026-10-06")).toEqual({
    latestWeight: null,
    weightChange: null,
    averageIntake: 3,
    loggedDays: 5,
    cardioDays: 3,
    totalCardioMinutes: 40.5,
    totalCardioCalories: 250,
  });
  expect(
    calculateStats(observations, "all", "2026-10-06").totalCardioMinutes,
  ).toBe(130.5);
  const calendar = getCalendarEntries(observations, "7", "2026-10-06");
  expect(
    calendar.find((entry) => entry.date === "2026-10-02")?.cardio,
  ).toBeUndefined();
});
