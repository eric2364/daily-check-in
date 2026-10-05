export interface Entry {
  date: string;
  intake: number | null;
  weight: number | null;
}

export interface Settings {
  reminderEnabled: boolean;
  reminderTime: string;
}

export type Period = "7" | "30" | "all";

export interface SummaryStats {
  latestWeight: number | null;
  weightChange: number | null;
  averageIntake: number | null;
  loggedDays: number;
}

export interface WeightAverage {
  date: string;
  weight: number | null;
  average: number | null;
}
