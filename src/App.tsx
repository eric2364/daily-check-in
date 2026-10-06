import { useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowDownToLine,
  ArrowUpFromLine,
  Bell,
  Check,
  CheckCheck,
  ChevronRight,
  ChevronLeft,
  CircleHelp,
  Feather,
  History,
  Plus,
  Settings as SettingsIcon,
  TrendingUp,
  Trash2,
  X,
} from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
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
} from "./data";
import {
  calculateStats,
  getCalendarEntries,
  rollingWeightAverages,
  shiftDate,
} from "./stats";
import type { Entry, Settings } from "./types";
import CloudPanel from "./CloudPanel";
import { getCloudState, initializeCloud, subscribeCloud } from "./cloud";
import {
  disableReminders,
  enableReminders,
  remindersConfigured,
  testReminder,
} from "./notifications";
const levels = ["Very low", "Low", "Usual", "High", "Very high"];
const levelHints = [
  "Much less than usual",
  "A little less than usual",
  "About your usual amount",
  "A little more than usual",
  "Much more than usual",
];
type Tab = "today" | "trends" | "history" | "settings";
const defaultSettings: Settings = {
  reminderTime: "09:00",
  reminderEnabled: false,
};
function dateLabel(date: string, short = false) {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: short ? "short" : "long",
    ...(short ? {} : { weekday: "long" }),
    timeZone: "UTC",
  }).format(new Date(date + "T12:00:00Z"));
}
function number(value: number | null, suffix = "") {
  return value === null ? "—" : `${value.toFixed(1)}${suffix}`;
}
async function download(content: string, name: string, type: string) {
  const file = new File([content], name, { type });
  // iPhone's native share sheet offers Save to Files and spreadsheet apps.
  if (
    /iPhone|iPad|iPod/.test(navigator.userAgent) &&
    navigator.canShare?.({ files: [file] })
  ) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
    }
  }
  const url = URL.createObjectURL(file);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
export default function App() {
  const [tab, setTab] = useState<Tab>("today");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [journalOwner, setJournalOwner] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [today, setToday] = useState(todayHkt());
  const previousToday = useRef(today);
  const [date, setDate] = useState(todayHkt());
  useEffect(() => {
    if (date === previousToday.current) setDate(today);
    previousToday.current = today;
  }, [today]);
  const [intake, setIntake] = useState<number | null>(null);
  const [weight, setWeight] = useState("");
  const [cardio, setCardio] = useState<boolean | null>(null);
  const [cardioType, setCardioType] = useState("");
  const [cardioMinutes, setCardioMinutes] = useState("");
  const [cardioCalories, setCardioCalories] = useState("");
  const [period, setPeriod] = useState<"7" | "30" | "all">("30");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState<Entry[] | null>(null);
  const [remove, setRemove] = useState<Entry | null>(null);
  const [help, setHelp] = useState(false);
  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (event.data?.type === "OPEN_TODAY") {
        setDate(todayHkt());
        setTab("today");
      }
    };
    navigator.serviceWorker?.addEventListener("message", listener);
    return () =>
      navigator.serviceWorker?.removeEventListener("message", listener);
  }, []);
  const importInput = useRef<HTMLInputElement>(null);
  const edited = entries.find((e) => e.date === date);
  const editedSnapshot = JSON.stringify(edited ?? null);
  const loggedToday = entries.some((e) => e.date === today);
  const stats = calculateStats(entries, period, today);
  const graphEntries = getCalendarEntries(entries, period, today);
  const averageByDate = new Map(
    rollingWeightAverages(getCalendarEntries(entries, "all", today)).map(
      (row) => [row.date, row.average],
    ),
  );
  const averages = graphEntries.map((entry) => ({
    ...entry,
    average: averageByDate.get(entry.date) ?? null,
  }));
  const cardioGraph = graphEntries.map((entry) => ({
    date: entry.date,
    minutes:
      entry.cardio === false
        ? 0
        : entry.cardio === true
          ? (entry.cardioMinutes ?? null)
          : null,
  }));
  const allStats = calculateStats(entries, "all", today);
  useEffect(() => {
    let alive = true;
    let generation = 0;
    let scope = getCloudState().user?.id ?? null;
    let revision = -1;
    const refresh = async () => {
      const state = getCloudState();
      const nextScope = state.user?.id ?? null;
      if (nextScope !== scope) {
        scope = nextScope;
        setJournalOwner(nextScope);
        setEntries([]);
        setPending(null);
        setRemove(null);
        setIntake(null);
        setWeight("");
        setCardio(null);
        setCardioType("");
        setCardioMinutes("");
        setCardioCalories("");
        setError("");
        setLoaded(false);
      }
      if (revision === state.revision) return;
      revision = state.revision;
      const currentGeneration = ++generation;
      try {
        const [logs, prefs] = await Promise.all([listEntries(), getSettings()]);
        if (alive && currentGeneration === generation) {
          setEntries(logs);
          setSettings(prefs);
          setLoaded(true);
        }
      } catch (reason) {
        if (alive && currentGeneration === generation)
          setError(
            reason instanceof Error
              ? reason.message
              : "Could not open your journal.",
          );
      }
    };
    const unsubscribe = subscribeCloud(() => {
      void refresh();
    });
    initializeCloud()
      .then(() => refresh())
      .catch((reason) => {
        if (alive)
          setError(
            reason instanceof Error
              ? reason.message
              : "Could not check your account.",
          );
      });
    return () => {
      alive = false;
      generation += 1;
      unsubscribe();
    };
  }, []);
  useEffect(() => {
    setIntake(edited?.intake ?? null);
    setWeight(edited?.weight?.toString() ?? "");
    setCardio(edited?.cardio ?? null);
    setCardioType(edited?.cardioType ?? "");
    setCardioMinutes(edited?.cardioMinutes?.toString() ?? "");
    setCardioCalories(edited?.cardioCalories?.toString() ?? "");
  }, [date, editedSnapshot, journalOwner]);
  useEffect(() => {
    const timer = setInterval(() => setToday(todayHkt()), 30000);
    const onFocus = () => setToday(todayHkt());
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4500);
    return () => clearTimeout(timer);
  }, [notice]);
  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await task();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Something went wrong. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    await run(async () => {
      await saveEntry({
        date,
        intake,
        weight: weight.trim() ? Number(weight) : null,
        cardio,
        cardioType: cardio === true ? cardioType : "",
        cardioMinutes:
          cardio === true && cardioMinutes.trim()
            ? Number(cardioMinutes)
            : null,
        cardioCalories:
          cardio === true && cardioCalories.trim()
            ? Number(cardioCalories)
            : null,
      });
      setNotice("Check-in saved. A little reflection goes a long way.");
    });
  }
  function edit(entry: Entry) {
    setDate(entry.date);
    setTab("today");
    setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  async function updateReminder(
    enabled: boolean,
    time = settings.reminderTime,
  ) {
    await run(async () => {
      if (enabled) await enableReminders(time);
      else await disableReminders();
      const next = { reminderEnabled: enabled, reminderTime: time };
      await saveSettings(next);
      setSettings(next);
      setNotice(
        enabled
          ? "Daily reminder set for " + time + " Hong Kong time."
          : "Daily reminders turned off.",
      );
    });
  }
  const nav = [
    { id: "today", label: "Check-in", Icon: Plus },
    { id: "trends", label: "Trends", Icon: TrendingUp },
    { id: "history", label: "History", Icon: History },
    { id: "settings", label: "Settings", Icon: SettingsIcon },
  ] as const;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setTab("today");
          }}
        >
          <span className="brand-icon">
            <Feather size={24} />
          </span>
          <span>
            Daily<span className="brand-light">check-in</span>
          </span>
        </a>
        <p className="sidebar-caption">A little more mindful, every day.</p>
        <nav>
          {nav.map(({ id, label, Icon }) => (
            <button
              key={id}
              className={tab === id ? "nav-item active" : "nav-item"}
              onClick={() => {
                setTab(id);
                setError("");
              }}
            >
              <Icon size={19} />
              <span>{label}</span>
              {id === "today" && loggedToday && <Check size={15} />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <span className="privacy-dot" />
          Your journal stays on this device<p>Small steps. Your own pace.</p>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <span className="mobile-brand">
            <Feather size={19} /> Daily check-in
          </span>
          <span className="topbar-label">YOUR PERSONAL JOURNAL</span>
          <button
            className="round-button"
            aria-label="How this app works"
            onClick={() => setHelp(true)}
          >
            <CircleHelp size={20} />
          </button>
        </header>
        {error && (
          <div className="alert error" role="alert">
            {error}
            <button aria-label="Dismiss error" onClick={() => setError("")}>
              <X size={17} />
            </button>
          </div>
        )}
        {notice && (
          <div className="toast" role="status">
            <CheckCheck size={19} />
            {notice}
          </div>
        )}
        {!loaded ? (
          <div className="empty-state">
            {error
              ? "Your journal could not be opened. Reload to try again."
              : "Opening your journal…"}
          </div>
        ) : (
          <>
            {tab === "today" && (
              <>
                <div className="page-title">
                  <span className="eyebrow">MAKE A MOMENT FOR YOURSELF</span>
                  <h1>
                    Your daily check-in<span className="title-dot">.</span>
                  </h1>
                  <p>No counting every calorie. Just notice how you feel.</p>
                </div>
                <div className="today-layout">
                  <section className="card entry-card">
                    <div className="card-heading">
                      <div>
                        <span className="eyebrow">
                          {date === today ? "TODAY’S ENTRY" : "YOUR ENTRY"}
                        </span>
                        <h2>{dateLabel(date)}</h2>
                      </div>
                      <span className={`pill ${edited ? "saved-pill" : ""}`}>
                        {edited ? (
                          <>
                            <Check size={13} /> Saved
                          </>
                        ) : (
                          "Not logged yet"
                        )}
                      </span>
                    </div>
                    <div className="date-row">
                      <label htmlFor="entry-date">Check-in date</label>
                      <button
                        className="date-arrow"
                        aria-label="Previous day"
                        onClick={() => setDate(shiftDate(date, -1))}
                      >
                        <ChevronLeft size={16} />
                      </button>
                      <input
                        id="entry-date"
                        aria-label="Check-in date"
                        type="date"
                        max={today}
                        value={date}
                        onInput={(e) => {
                          if (e.currentTarget.value)
                            setDate(e.currentTarget.value);
                        }}
                        onChange={(e) => {
                          if (e.target.value) setDate(e.target.value);
                        }}
                      />
                      <button
                        className="date-arrow"
                        aria-label="Next day"
                        disabled={date >= today}
                        onClick={() => setDate(shiftDate(date, 1))}
                      >
                        <ChevronRight size={16} />
                      </button>
                      {date !== today && (
                        <button
                          className="text-button"
                          onClick={() => setDate(today)}
                        >
                          Today
                        </button>
                      )}
                    </div>
                    <div className="input-section">
                      <div className="section-label">
                        <span className="step-number">01</span>
                        <h3>How much did you eat?</h3>
                        <span className="optional">Optional</span>
                      </div>
                      <p className="field-description">
                        Your impression of your intake, compared with usual.
                      </p>
                      <div className="intake-options">
                        {levels.map((label, i) => (
                          <button
                            key={label}
                            aria-pressed={intake === i + 1}
                            className={`intake-option level-${i + 1} ${intake === i + 1 ? "selected" : ""}`}
                            onClick={() =>
                              setIntake(intake === i + 1 ? null : i + 1)
                            }
                          >
                            <span className="level-number">{i + 1}</span>
                            <span>{label}</span>
                          </button>
                        ))}
                      </div>
                      <div className="scale-caption">
                        <span>Less than usual</span>
                        <span>More than usual</span>
                      </div>
                      {intake && (
                        <p className="selection-hint">
                          <Check size={14} />
                          {levelHints[intake - 1]}
                        </p>
                      )}
                    </div>
                    <div className="input-section weight-section">
                      <div className="section-label">
                        <span className="step-number">02</span>
                        <h3>What’s your weight?</h3>
                        <span className="optional">Optional</span>
                      </div>
                      <p className="field-description">
                        If you weighed yourself today, add it here.
                      </p>
                      <div className="weight-input">
                        <input
                          id="weight"
                          aria-label="Weight in kilograms"
                          type="number"
                          inputMode="decimal"
                          min="0.1"
                          max="1000"
                          step="0.1"
                          placeholder="— — . —"
                          value={weight}
                          onChange={(e) => setWeight(e.target.value)}
                        />
                        <label htmlFor="weight">kg</label>
                      </div>
                      <span className="fine-print">
                        Intake, weight, or a cardio answer is enough for a
                        check-in.
                      </span>
                    </div>
                    <div className="input-section cardio-section">
                      <div className="section-label">
                        <span className="step-number">03</span>
                        <h3>Did you do cardio?</h3>
                        <span className="optional">Optional</span>
                      </div>
                      <p className="field-description">
                        Record your movement, even on a rest day.
                      </p>
                      <div
                        className="cardio-options"
                        role="group"
                        aria-label="Did you do cardio?"
                      >
                        {[true, false].map((answer) => (
                          <button
                            key={String(answer)}
                            type="button"
                            aria-pressed={cardio === answer}
                            className={`secondary-button ${cardio === answer ? "selected" : ""}`}
                            onClick={() => {
                              const next = cardio === answer ? null : answer;
                              setCardio(next);
                              if (next !== true) {
                                setCardioType("");
                                setCardioMinutes("");
                                setCardioCalories("");
                              }
                            }}
                          >
                            {answer ? "Yes" : "No"}
                          </button>
                        ))}
                        {cardio !== null && (
                          <button
                            className="text-button"
                            type="button"
                            onClick={() => {
                              setCardio(null);
                              setCardioType("");
                              setCardioMinutes("");
                              setCardioCalories("");
                            }}
                          >
                            Clear answer
                          </button>
                        )}
                      </div>
                      {cardio === true && (
                        <div className="cardio-fields">
                          <label htmlFor="cardio-type">
                            Cardio type{" "}
                            <span className="optional">Optional</span>
                            <input
                              id="cardio-type"
                              type="text"
                              maxLength={100}
                              placeholder="e.g. Walking, cycling, running"
                              value={cardioType}
                              onChange={(e) => setCardioType(e.target.value)}
                            />
                          </label>
                          <label htmlFor="cardio-minutes">
                            Minutes <span className="optional">Optional</span>
                            <input
                              id="cardio-minutes"
                              max="1440"
                              type="number"
                              inputMode="decimal"
                              min="0"
                              step="any"
                              placeholder="e.g. 30"
                              value={cardioMinutes}
                              onChange={(e) => setCardioMinutes(e.target.value)}
                            />
                          </label>
                          <label htmlFor="cardio-calories">
                            Calories burned (kcal){" "}
                            <span className="optional">Optional</span>
                            <input
                              id="cardio-calories"
                              max="10000"
                              type="number"
                              inputMode="decimal"
                              min="0"
                              step="any"
                              placeholder="e.g. 150"
                              value={cardioCalories}
                              onChange={(e) =>
                                setCardioCalories(e.target.value)
                              }
                            />
                          </label>
                          <p className="fine-print">
                            Enter your own estimate or a value from your watch.
                            Calories are not calculated by this app.
                          </p>
                        </div>
                      )}
                    </div>
                    <button
                      className="primary-button save-button"
                      disabled={
                        busy || (!intake && !weight.trim() && cardio === null)
                      }
                      onClick={save}
                    >
                      <Check size={19} />
                      {busy
                        ? "Saving…"
                        : edited
                          ? "Update check-in"
                          : "Save check-in"}
                    </button>
                    <p className="save-caption">
                      Just for you. No good or bad scores.
                    </p>
                  </section>
                  <aside className="today-aside">
                    <section className="reflection-card">
                      <div className="leaf-circle">
                        <Feather size={29} />
                      </div>
                      <span className="eyebrow">PROGRESS, NOT PERFECTION</span>
                      <h2>
                        A small habit.
                        <br />A clearer picture.
                      </h2>
                      <p>
                        A few seconds today can help you notice patterns over
                        time. Every check-in counts.
                      </p>
                      <div className="reflection-line" />
                    </section>
                    <section className="card snapshot">
                      <div className="mini-heading">
                        <Activity size={18} />
                        <h3>Your journey so far</h3>
                      </div>
                      <div className="snapshot-stats">
                        <div>
                          <strong>{allStats.loggedDays}</strong>
                          <span>
                            {allStats.loggedDays === 1
                              ? "day checked in"
                              : "days checked in"}
                          </span>
                        </div>
                        <div>
                          <strong>
                            {number(allStats.latestWeight)}
                            <small> kg</small>
                          </strong>
                          <span>latest weight</span>
                        </div>
                      </div>
                      <button
                        className="text-button"
                        onClick={() => setTab("trends")}
                      >
                        See your trends <ChevronRight size={16} />
                      </button>
                    </section>
                    <div className="reminder-note">
                      <Bell size={18} />
                      <span>
                        {settings.reminderEnabled
                          ? `Your daily nudge · ${settings.reminderTime} HKT`
                          : "A gentle nudge makes a habit easier."}
                        <button onClick={() => setTab("settings")}>
                          {settings.reminderEnabled
                            ? "Manage reminder"
                            : "Set up a daily reminder"}{" "}
                          <ChevronRight size={12} />
                        </button>
                      </span>
                    </div>
                  </aside>
                </div>
              </>
            )}
            {tab === "trends" && (
              <>
                <div className="page-title">
                  <span className="eyebrow">THE BIGGER PICTURE</span>
                  <h1>
                    Your trends<span className="title-dot">.</span>
                  </h1>
                  <p>Notice the patterns, one day at a time.</p>
                </div>
                <div className="period-picker" aria-label="Date range">
                  {(["7", "30", "all"] as const).map((p) => (
                    <button
                      key={p}
                      aria-pressed={period === p}
                      className={p === period ? "selected" : ""}
                      onClick={() => setPeriod(p)}
                    >
                      {p === "all" ? "All time" : `${p} days`}
                    </button>
                  ))}
                </div>
                <div className="stats-grid">
                  {[
                    ["Latest weight", number(stats.latestWeight, " kg")],
                    [
                      "Weight change",
                      stats.weightChange === null
                        ? "—"
                        : `${stats.weightChange > 0 ? "+" : ""}${number(stats.weightChange, " kg")}`,
                    ],
                    ["Average intake", number(stats.averageIntake, " / 5")],
                    ["Days logged", String(stats.loggedDays)],
                    ["Cardio days", String(stats.cardioDays)],
                    [
                      "Cardio minutes",
                      `${stats.totalCardioMinutes.toLocaleString()} min`,
                    ],
                    [
                      "Calories burned",
                      `${stats.totalCardioCalories.toLocaleString()} kcal`,
                    ],
                  ].map(([label, value]) => (
                    <section className="card stat" key={label}>
                      <span>{label}</span>
                      <strong>{value}</strong>
                    </section>
                  ))}
                </div>
                <section className="card chart-card">
                  <div className="chart-heading">
                    <div>
                      <h2>Weight over time</h2>
                      <p>A single measurement is just one moment.</p>
                    </div>
                    <span className="chart-unit">kg</span>
                  </div>
                  {graphEntries.some((e) => e.weight !== null) ? (
                    <>
                      <div className="chart-legend">
                        <span>
                          <i />
                          Daily weight
                        </span>
                        <span>
                          <i className="average-dot" />
                          7-day average
                        </span>
                      </div>
                      <div className="chart">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart
                            data={averages}
                            margin={{
                              top: 12,
                              right: 18,
                              bottom: 4,
                              left: -18,
                            }}
                          >
                            <CartesianGrid vertical={false} stroke="#e8ede8" />
                            <XAxis
                              dataKey="date"
                              tickFormatter={(d) => dateLabel(d, true)}
                              tick={{ fontSize: 11 }}
                              minTickGap={30}
                              axisLine={false}
                              tickLine={false}
                            />
                            <YAxis
                              domain={["auto", "auto"]}
                              tick={{ fontSize: 11 }}
                              axisLine={false}
                              tickLine={false}
                            />
                            <Tooltip
                              labelFormatter={(d) => dateLabel(String(d), true)}
                              formatter={(v, n) => [
                                `${Number(v).toFixed(1)} kg`,
                                n === "average"
                                  ? "7-day average"
                                  : "Daily weight",
                              ]}
                            />
                            <Line
                              dataKey="weight"
                              name="weight"
                              type="linear"
                              stroke="#a0b9ab"
                              strokeWidth={2}
                              dot={{ r: 4, fill: "#a0b9ab" }}
                              connectNulls={false}
                            />
                            <Line
                              dataKey="average"
                              name="average"
                              type="monotone"
                              stroke="#2c6b50"
                              strokeWidth={3}
                              dot={false}
                            />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                      <p className="fine-print">
                        Average uses available weigh-ins from the previous seven
                        calendar days.
                      </p>
                    </>
                  ) : (
                    <Empty text="Your weight trend will appear after your first weigh-in." />
                  )}
                </section>
                <section className="card chart-card">
                  <div className="chart-heading">
                    <div>
                      <h2>Perceived intake</h2>
                      <p>1 = very low · 3 = usual · 5 = very high</p>
                    </div>
                  </div>
                  {graphEntries.some((e) => e.intake !== null) ? (
                    <div className="chart">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart
                          data={graphEntries}
                          margin={{ top: 12, right: 18, bottom: 4, left: -18 }}
                        >
                          <CartesianGrid vertical={false} stroke="#e8ede8" />
                          <XAxis
                            dataKey="date"
                            tickFormatter={(d) => dateLabel(d, true)}
                            tick={{ fontSize: 11 }}
                            minTickGap={30}
                            axisLine={false}
                            tickLine={false}
                          />
                          <YAxis
                            domain={[1, 5]}
                            ticks={[1, 2, 3, 4, 5]}
                            tick={{ fontSize: 11 }}
                            axisLine={false}
                            tickLine={false}
                          />
                          <Tooltip
                            labelFormatter={(d) => dateLabel(String(d), true)}
                            formatter={(v) => [
                              `${v} · ${levels[Number(v) - 1]}`,
                              "Intake",
                            ]}
                          />
                          <Line
                            dataKey="intake"
                            type="linear"
                            stroke="#c29959"
                            strokeWidth={2}
                            dot={{ r: 4, fill: "#c29959" }}
                            connectNulls={false}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <Empty text="Log how much you ate to start noticing patterns." />
                  )}
                </section>
                <section className="card chart-card">
                  <div className="chart-heading">
                    <div>
                      <h2>Cardio over time</h2>
                      <p>Your recorded minutes of movement.</p>
                    </div>
                    <span className="chart-unit">min</span>
                  </div>
                  {cardioGraph.some((entry) => entry.minutes !== null) ? (
                    <div className="chart">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart
                          data={cardioGraph}
                          margin={{ top: 12, right: 18, bottom: 4, left: -18 }}
                        >
                          <CartesianGrid vertical={false} stroke="#e8ede8" />
                          <XAxis
                            dataKey="date"
                            tickFormatter={(d) => dateLabel(d, true)}
                            tick={{ fontSize: 11 }}
                            minTickGap={30}
                            axisLine={false}
                            tickLine={false}
                          />
                          <YAxis
                            domain={[0, "auto"]}
                            tick={{ fontSize: 11 }}
                            axisLine={false}
                            tickLine={false}
                          />
                          <Tooltip
                            labelFormatter={(d) => dateLabel(String(d), true)}
                            formatter={(v) => [`${v} min`, "Cardio"]}
                          />
                          <Line
                            dataKey="minutes"
                            type="linear"
                            stroke="#2c6b50"
                            strokeWidth={2}
                            dot={{ r: 4, fill: "#2c6b50" }}
                            connectNulls={false}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <Empty text="Record cardio minutes or a rest day to start your cardio trend." />
                  )}
                  <p className="fine-print">
                    No cardio = 0 minutes. Missing answers or minutes leave a
                    gap. Totals include only recorded values; calories are your
                    manual estimates.
                  </p>
                </section>
              </>
            )}
            {tab === "history" && (
              <>
                <div className="page-title">
                  <span className="eyebrow">ONE DAY AT A TIME</span>
                  <h1>
                    Your journal<span className="title-dot">.</span>
                  </h1>
                  <p>
                    {entries.length
                      ? `${entries.length} little moments of reflection.`
                      : "Your check-ins will feel right at home here."}
                  </p>
                </div>
                <section className="card history-card">
                  {!entries.length ? (
                    <Empty text="No entries yet. Start with today." />
                  ) : (
                    [...entries].reverse().map((entry) => (
                      <div className="history-row" key={entry.date}>
                        <div className="history-date">
                          <span>
                            {new Date(entry.date + "T12:00Z").getUTCDate()}
                          </span>
                          <div>
                            <strong>{dateLabel(entry.date, true)}</strong>
                            <small>
                              {entry.date.slice(0, 4)}
                              {entry.date === today ? " · Today" : ""}
                            </small>
                          </div>
                        </div>
                        <div className="history-values">
                          <span className="history-intake">
                            {entry.intake === null
                              ? "No intake"
                              : `${entry.intake} · ${levels[entry.intake - 1]}`}
                          </span>
                          <strong>{number(entry.weight, " kg")}</strong>
                          <span className="history-cardio">
                            {entry.cardio === true
                              ? [
                                  entry.cardioType || "Cardio",
                                  entry.cardioMinutes != null
                                    ? `${entry.cardioMinutes} min`
                                    : null,
                                  entry.cardioCalories != null
                                    ? `${entry.cardioCalories} kcal`
                                    : null,
                                ]
                                  .filter(Boolean)
                                  .join(" · ")
                              : entry.cardio === false
                                ? "No cardio"
                                : "Cardio not recorded"}
                          </span>
                        </div>
                        <button
                          className="text-button"
                          onClick={() => edit(entry)}
                        >
                          Edit
                        </button>
                        <button
                          className="round-button"
                          aria-label={`Delete entry for ${entry.date}`}
                          onClick={() => setRemove(entry)}
                        >
                          <Trash2 size={17} />
                        </button>
                      </div>
                    ))
                  )}
                </section>
              </>
            )}
            {tab === "settings" && (
              <>
                <div className="page-title">
                  <span className="eyebrow">MAKE IT YOURS</span>
                  <h1>
                    A little housekeeping<span className="title-dot">.</span>
                  </h1>
                  <p>Gentle reminders. A safe copy of your journal.</p>
                </div>
                <div className="settings-grid">
                  <CloudPanel />
                  <section className="card settings-card">
                    <div className="mini-heading">
                      <Bell size={20} />
                      <h2>A daily nudge</h2>
                    </div>
                    <p>
                      A gentle reminder to check in, even when the app is
                      closed.
                    </p>
                    <label className="setting-row">
                      <span>Daily reminder</span>
                      <input
                        type="checkbox"
                        role="switch"
                        checked={settings.reminderEnabled}
                        disabled={busy}
                        onChange={(e) => updateReminder(e.target.checked)}
                      />
                    </label>
                    <label className="setting-row">
                      <span>Hong Kong time</span>
                      <input
                        aria-label="Reminder time"
                        type="time"
                        value={settings.reminderTime}
                        disabled={busy}
                        onChange={(e) => {
                          const time = e.target.value;
                          if (!time) return;
                          if (settings.reminderEnabled) {
                            updateReminder(true, time);
                          } else
                            run(async () => {
                              const next = { ...settings, reminderTime: time };
                              await saveSettings(next);
                              setSettings(next);
                            });
                        }}
                      />
                    </label>
                    <p className="fine-print">
                      Sent every day, whether or not you have logged. Your
                      phone’s notification settings may delay alerts.
                    </p>
                    {!remindersConfigured && (
                      <div className="setup-note">
                        The reminder service isn’t connected yet. See the
                        project’s setup guide to enable it. Your journal works
                        without it.
                      </div>
                    )}
                    <button
                      className="secondary-button"
                      disabled={busy || !settings.reminderEnabled}
                      onClick={() =>
                        run(async () => {
                          await testReminder();
                          setNotice(
                            "Test reminder sent. Check your notifications.",
                          );
                        })
                      }
                    >
                      <Bell size={16} />
                      Send a test reminder
                    </button>
                  </section>
                  <section className="card settings-card">
                    <div className="mini-heading">
                      <ArrowDownToLine size={20} />
                      <h2>Keep a safe copy</h2>
                    </div>
                    <p>
                      Export a backup before clearing storage or switching
                      phones. Device-only entries stay here; signed-in account
                      entries also sync to the cloud. Both exports include your
                      cardio records.
                    </p>
                    <button
                      className="secondary-button"
                      onClick={() =>
                        download(
                          exportJson(entries),
                          `daily-check-in-${today}.json`,
                          "application/json",
                        )
                      }
                    >
                      <ArrowDownToLine size={16} />
                      Export backup
                    </button>
                    <button
                      className="secondary-button"
                      onClick={() =>
                        download(
                          exportCsv(entries),
                          `daily-check-in-${today}.csv`,
                          "text/csv",
                        )
                      }
                    >
                      <ArrowDownToLine size={16} />
                      Export spreadsheet (CSV)
                    </button>
                    <button
                      className="secondary-button"
                      disabled={busy}
                      onClick={() => importInput.current?.click()}
                    >
                      <ArrowUpFromLine size={16} />
                      Restore from backup
                    </button>
                    <input
                      ref={importInput}
                      hidden
                      type="file"
                      accept=".json,application/json"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = "";
                        if (file)
                          run(async () =>
                            setPending(parseJsonBackup(await file.text())),
                          );
                      }}
                    />
                    <p className="fine-print">
                      Backup exports include the journal you are currently
                      viewing. Reminders use a separate notification service.
                    </p>
                  </section>
                  <section className="card settings-card install-card">
                    <div className="mini-heading">
                      <Plus size={20} />
                      <h2>At home on your iPhone</h2>
                    </div>
                    <ol>
                      <li>Open this app’s link in Safari.</li>
                      <li>
                        Tap Share, then <strong>Add to Home Screen</strong>.
                      </li>
                      <li>Enable “Open as Web App” if shown, then tap Add.</li>
                      <li>Open the new icon to set up notifications.</li>
                    </ol>
                    <p className="fine-print">
                      Works offline after your first visit. Notifications need
                      iOS 16.4 or later and an internet connection.
                    </p>
                  </section>
                </div>
              </>
            )}
          </>
        )}
        <footer className="page-footer">
          <Feather size={14} />
          <span>Less tracking. More awareness.</span>
          <span className="footer-version">v1.2.0</span>
        </footer>
      </main>
      <nav className="mobile-nav">
        {nav.map(({ id, label, Icon }) => (
          <button
            key={id}
            className={tab === id ? "active" : ""}
            onClick={() => {
              setTab(id);
              setError("");
            }}
          >
            <Icon size={20} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      {pending && (
        <Modal title="Restore your journal?" close={() => setPending(null)}>
          <p role="alert">{error}</p>
          <p>
            {pending.length} entries in this backup.{" "}
            {
              pending.filter((e) => entries.some((x) => x.date === e.date))
                .length
            }{" "}
            existing dates will be replaced. Other dates will be kept.
          </p>
          <div className="modal-actions">
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() => setPending(null)}
            >
              Cancel
            </button>
            <button
              className="primary-button"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await importEntries(pending);
                  setPending(null);
                  setNotice("Your backup has been restored.");
                })
              }
            >
              Restore backup
            </button>
          </div>
        </Modal>
      )}
      {remove && (
        <Modal title="Delete this check-in?" close={() => setRemove(null)}>
          <p role="alert">{error}</p>
          <p>
            The entry for {dateLabel(remove.date)} will be removed from this
            device.
          </p>
          <div className="modal-actions">
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() => setRemove(null)}
            >
              Keep entry
            </button>
            <button
              className="primary-button danger"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await deleteEntry(remove.date);
                  setRemove(null);
                  setNotice("Check-in deleted.");
                })
              }
            >
              Delete entry
            </button>
          </div>
        </Modal>
      )}
      {help && (
        <Modal title="Your own daily check-in" close={() => setHelp(false)}>
          <p>
            Choose a perceived intake level from 1 (very low) to 5 (very high),
            add your weight if you like, and record cardio with Yes or No. For
            Yes, you can add a type, minutes, and your own burned calorie
            estimate. Save any one of these to check in. Intake levels are
            personal impressions, not calorie estimates.
          </p>
          <p>
            Your graphs help you reflect over time. Entries stay on this device
            unless you choose a cloud account in Settings. Account entries sync
            across devices when online. Export a backup occasionally.
          </p>
          <button className="primary-button" onClick={() => setHelp(false)}>
            Got it
          </button>
        </Modal>
      )}
    </div>
  );
}
function Empty({ text }: { text: string }) {
  return (
    <div className="empty-state">
      <TrendingUp size={26} />
      <p>{text}</p>
    </div>
  );
}
function Modal({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog ref={ref} className="modal" onCancel={close}>
      <div className="modal-heading">
        <h2>{title}</h2>
        <button
          className="round-button"
          aria-label="Close dialog"
          onClick={close}
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
