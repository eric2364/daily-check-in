import { todayHkt } from "./data";
import type { Entry, Period, SummaryStats, WeightAverage } from "./types";

export function shiftDate(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function getPeriodEntries(
  entries: Entry[],
  period: Period,
  today = todayHkt(),
): Entry[] {
  const start = period === "all" ? "" : shiftDate(today, -(Number(period) - 1));
  return entries
    .filter((entry) => entry.date >= start && entry.date <= today)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Chart-only calendar rows. Missing days must not be saved or counted as logged days. */
export function getCalendarEntries(
  entries: Entry[],
  period: Period,
  today = todayHkt(),
): Entry[] {
  const selected = getPeriodEntries(entries, period, today);
  if (period === "all" && selected.length === 0) return [];
  const start =
    period === "all"
      ? selected[0].date
      : shiftDate(today, -(Number(period) - 1));
  const observed = new Map(selected.map((entry) => [entry.date, entry]));
  const calendar: Entry[] = [];
  for (let date = start; date <= today; date = shiftDate(date, 1)) {
    calendar.push(observed.get(date) ?? { date, intake: null, weight: null });
  }
  return calendar;
}

export function calculateStats(
  entries: Entry[],
  period: Period,
  today = todayHkt(),
): SummaryStats {
  const selected = getPeriodEntries(entries, period, today);
  const weights = selected.filter((entry) => entry.weight !== null);
  const intakes = selected.filter((entry) => entry.intake !== null);
  const allWeights = getPeriodEntries(entries, "all", today).filter(
    (entry) => entry.weight !== null,
  );
  return {
    latestWeight: allWeights.at(-1)?.weight ?? null,
    weightChange:
      weights.length >= 2 ? weights.at(-1)!.weight! - weights[0].weight! : null,
    averageIntake: intakes.length
      ? intakes.reduce((sum, entry) => sum + entry.intake!, 0) / intakes.length
      : null,
    loggedDays: selected.length,
  };
}

/** Each average uses observed weights on this date and the previous six calendar days. */
export function rollingWeightAverages(entries: Entry[]): WeightAverage[] {
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  let first = 0;
  let sum = 0;
  let count = 0;
  return sorted.map((entry, index) => {
    const start = shiftDate(entry.date, -6);
    if (entry.weight !== null) {
      sum += entry.weight;
      count += 1;
    }
    while (first <= index && sorted[first].date < start) {
      if (sorted[first].weight !== null) {
        sum -= sorted[first].weight!;
        count -= 1;
      }
      first += 1;
    }
    return {
      date: entry.date,
      weight: entry.weight,
      average: count ? sum / count : null,
    };
  });
}
