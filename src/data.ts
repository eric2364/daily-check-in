import type { Entry, Settings } from "./types";

const DATABASE_NAME = "daily-check-in";
const DATABASE_VERSION = 1;
export const DEFAULT_SETTINGS: Settings = {
  reminderEnabled: false,
  reminderTime: "09:00",
};
let databasePromise: Promise<IDBDatabase> | undefined;

export function todayHkt(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: string) =>
    parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function validateEntry(input: unknown, today = todayHkt()): Entry {
  if (!input || typeof input !== "object")
    throw new Error("Each entry must be an object.");
  const candidate = input as Record<string, unknown>;
  const { date } = candidate;
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("Choose a valid date.");
  }
  const parsed = new Date(`${date}T00:00:00Z`);
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== date
  ) {
    throw new Error("Choose a valid date.");
  }
  if (date > today) throw new Error("Entries cannot be dated in the future.");
  const intake = candidate.intake;
  const weight = candidate.weight;
  if (
    intake !== null &&
    (typeof intake !== "number" ||
      !Number.isInteger(intake) ||
      intake < 1 ||
      intake > 5)
  ) {
    throw new Error("Intake must be a whole number from 1 to 5.");
  }
  if (
    weight !== null &&
    (typeof weight !== "number" ||
      !Number.isFinite(weight) ||
      weight <= 0 ||
      weight > 1000)
  ) {
    throw new Error("Weight must be greater than 0 and no more than 1,000 kg.");
  }
  const { cardio, cardioType, cardioMinutes, cardioCalories } = candidate;
  if (cardio !== undefined && cardio !== null && typeof cardio !== "boolean") {
    throw new Error("Cardio must be Yes or No.");
  }
  if (
    cardioType !== undefined &&
    (typeof cardioType !== "string" || cardioType.length > 100)
  ) {
    throw new Error("Cardio type must be text of no more than 100 characters.");
  }
  for (const [label, value, maximum] of [
    ["Cardio minutes", cardioMinutes, 1440],
    ["Burned calories", cardioCalories, 10000],
  ] as const) {
    if (
      value !== undefined &&
      value !== null &&
      (typeof value !== "number" ||
        !Number.isFinite(value) ||
        value < 0 ||
        value > maximum)
    ) {
      throw new Error(
        `${label} must be between 0 and ${maximum.toLocaleString("en-US")}.`,
      );
    }
  }
  if (
    cardio !== true &&
    cardio !== false &&
    ((typeof cardioType === "string" && cardioType.trim() !== "") ||
      cardioMinutes != null ||
      cardioCalories != null)
  ) {
    throw new Error("Select Yes for cardio before adding its details.");
  }
  if (intake === null && weight === null && cardio !== true && cardio !== false)
    throw new Error(
      "Add an intake level, weight, or cardio answer before saving.",
    );
  // Legacy records retain their original shape; no database migration is needed.
  const cardioFields =
    cardio === undefined &&
    cardioType === undefined &&
    cardioMinutes === undefined &&
    cardioCalories === undefined
      ? {}
      : {
          cardio: cardio ?? null,
          cardioType: cardio === true ? (cardioType ?? "").trim() : "",
          cardioMinutes:
            cardio === true
              ? ((cardioMinutes as number | null | undefined) ?? null)
              : null,
          cardioCalories:
            cardio === true
              ? ((cardioCalories as number | null | undefined) ?? null)
              : null,
        };
  return {
    date,
    intake: intake as number | null,
    weight: weight as number | null,
    ...cardioFields,
  };
}

export function validateSettings(input: Settings): Settings {
  if (
    typeof input.reminderEnabled !== "boolean" ||
    typeof input.reminderTime !== "string" ||
    input.reminderTime.length !== 5 ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.reminderTime)
  ) {
    throw new Error("Choose a valid reminder time.");
  }
  return {
    reminderEnabled: input.reminderEnabled,
    reminderTime: input.reminderTime,
  };
}

function database(): Promise<IDBDatabase> {
  if (!databasePromise) {
    databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
      if (!globalThis.indexedDB) {
        reject(
          new Error("This browser does not support local storage for the app."),
        );
        return;
      }
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("entries"))
          db.createObjectStore("entries", { keyPath: "date" });
        if (!db.objectStoreNames.contains("settings"))
          db.createObjectStore("settings");
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          databasePromise = undefined;
        };
        resolve(db);
      };
      request.onerror = () =>
        reject(request.error ?? new Error("Could not open your local data."));
      request.onblocked = () =>
        reject(new Error("Close other Daily Check-in tabs and try again."));
    }).catch((error) => {
      databasePromise = undefined;
      throw error;
    });
  }
  return databasePromise;
}

async function read<T>(store: string, key?: IDBValidKey): Promise<T> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(store, "readonly");
    const request =
      key === undefined
        ? transaction.objectStore(store).getAll()
        : transaction.objectStore(store).get(key);
    request.onsuccess = () => resolve(request.result as T);
    request.onerror = () =>
      reject(request.error ?? new Error("Could not read your local data."));
  });
}

async function write(
  store: string,
  operation: (store: IDBObjectStore) => void,
): Promise<void> {
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(store, "readwrite");
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("Could not save your data."));
    transaction.onabort = () =>
      reject(
        transaction.error ?? new Error("Saving your data was interrupted."),
      );
    operation(transaction.objectStore(store));
  });
}

export async function listEntries(): Promise<Entry[]> {
  return (await read<Entry[]>("entries")).sort((a, b) =>
    a.date.localeCompare(b.date),
  );
}

export async function saveEntry(entry: Entry): Promise<void> {
  const valid = validateEntry(entry);
  await write("entries", (store) => {
    store.put(valid);
  });
}

export async function deleteEntry(date: string): Promise<void> {
  await write("entries", (store) => {
    store.delete(date);
  });
}

export async function getSettings(): Promise<Settings> {
  return (
    (await read<Settings | undefined>("settings", "preferences")) ?? {
      ...DEFAULT_SETTINGS,
    }
  );
}

export async function saveSettings(settings: Settings): Promise<void> {
  const valid = validateSettings(settings);
  await write("settings", (store) => {
    store.put(valid, "preferences");
  });
}

/** Merge a validated backup atomically. Incoming dates replace existing matching dates. */
export async function importEntries(entries: Entry[]): Promise<void> {
  const valid = validateEntries(entries);
  await write("entries", (store) => {
    valid.forEach((entry) => store.put(entry));
  });
}

function validateEntries(input: unknown): Entry[] {
  if (!Array.isArray(input))
    throw new Error("The backup must contain an entries array.");
  const dates = new Set<string>();
  return input
    .map((value) => {
      const entry = validateEntry(value);
      if (dates.has(entry.date))
        throw new Error(
          `The backup contains duplicate entries for ${entry.date}.`,
        );
      dates.add(entry.date);
      return entry;
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function exportJson(entries: Entry[]): string {
  return JSON.stringify(
    {
      version: 2,
      exportedAt: new Date().toISOString(),
      entries: validateEntries(entries),
    },
    null,
    2,
  );
}

export function parseJsonBackup(text: string): Entry[] {
  let backup: unknown;
  try {
    backup = JSON.parse(text);
  } catch {
    throw new Error("This file is not valid JSON.");
  }
  if (
    !backup ||
    typeof backup !== "object" ||
    ![1, 2].includes((backup as Record<string, unknown>).version as number)
  ) {
    throw new Error(
      "This backup version is not supported. Choose a Daily Check-in version 1 or 2 backup.",
    );
  }
  return validateEntries((backup as Record<string, unknown>).entries);
}

/** Quote CSV delimiters and neutralize spreadsheet formulas in user-entered text. */
function csvText(value: string): string {
  const safe = /^[\s]*[=+\-@]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '\"\"')}"` : safe;
}

export function exportCsv(entries: Entry[]): string {
  const rows = validateEntries(entries).map((entry) =>
    [
      entry.date,
      entry.intake ?? "",
      entry.weight ?? "",
      entry.cardio === true ? "Yes" : entry.cardio === false ? "No" : "",
      csvText(entry.cardioType ?? ""),
      entry.cardioMinutes ?? "",
      entry.cardioCalories ?? "",
    ].join(","),
  );
  return (
    [
      "date,intake_level,weight_kg,cardio_done,cardio_type,cardio_minutes,cardio_calories",
      ...rows,
    ].join("\r\n") + "\r\n"
  );
}
