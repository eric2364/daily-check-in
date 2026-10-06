import { useEffect, useState } from "react";
import { Cloud, RefreshCw } from "lucide-react";
import {
  copyGuestEntries,
  getCloudState,
  getGuestEntries,
  resolveConflict,
  resetPassword,
  updatePassword,
  signIn,
  signOut,
  signUp,
  subscribeCloud,
  syncNow,
} from "./cloud";
import type { Entry } from "./types";

function entrySummary(entry: Entry | null) {
  if (!entry) return "Deleted entry";
  return (
    [
      entry.intake == null ? null : `Intake ${entry.intake}/5`,
      entry.weight == null ? null : `${entry.weight} kg`,
      entry.cardio === false
        ? "No cardio"
        : entry.cardio === true
          ? [
              entry.cardioType || "Cardio",
              entry.cardioMinutes == null ? null : `${entry.cardioMinutes} min`,
              entry.cardioCalories == null
                ? null
                : `${entry.cardioCalories} kcal`,
            ]
              .filter(Boolean)
              .join(" · ")
          : null,
    ]
      .filter(Boolean)
      .join(" · ") || "No recorded values"
  );
}

export default function CloudPanel() {
  const [state, setState] = useState(getCloudState);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [recoveryPassword, setRecoveryPassword] = useState("");
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [guestCount, setGuestCount] = useState(0);
  const [copyConfirm, setCopyConfirm] = useState(false);
  useEffect(() => subscribeCloud(() => setState(getCloudState())), []);
  useEffect(() => {
    let current = true;
    getGuestEntries()
      .then((rows) => {
        if (current) setGuestCount(rows.length);
      })
      .catch(() => {
        if (current) setGuestCount(0);
      });
    return () => {
      current = false;
    };
  }, [state.user?.id, state.revision]);
  useEffect(() => {
    setCopyConfirm(false);
    setPassword("");
    setRecoveryPassword("");
  }, [state.user?.id]);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not complete this action. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  const pending = state.pendingCount > 0 || state.conflicts.length > 0;
  const status =
    state.status === "syncing"
      ? "Syncing…"
      : state.status === "offline"
        ? "Offline · changes stay on this device"
        : state.status === "conflict"
          ? "Review conflicting entries"
          : state.status === "error"
            ? "Sync needs attention"
            : state.pendingCount
              ? "Changes waiting to sync"
              : state.lastSyncedAt
                ? "Synced"
                : "Ready to sync";
  return (
    <section className="card settings-card cloud-panel">
      <div className="mini-heading">
        <Cloud size={20} />
        <h2>Your cloud account</h2>
      </div>
      {state.passwordRecovery && (
        <form
          className="cloud-auth-form cloud-confirm"
          onSubmit={(event) => {
            event.preventDefault();
            run(async () => {
              await updatePassword(recoveryPassword);
              setRecoveryPassword("");
              setMessage("Your password has been updated.");
            });
          }}
        >
          <strong>Choose a new password</strong>
          <label htmlFor="recovery-password">
            New password
            <input
              id="recovery-password"
              type="password"
              autoComplete="new-password"
              required
              minLength={6}
              disabled={busy}
              value={recoveryPassword}
              onChange={(event) => setRecoveryPassword(event.target.value)}
            />
          </label>
          <button className="primary-button" type="submit" disabled={busy}>
            Update password
          </button>
        </form>
      )}
      {!state.configured ? (
        <p>
          Cloud accounts are not configured for this deployment yet. Your
          journal works locally, and you can export a backup below.
        </p>
      ) : !state.initialized ? (
        <p>Checking your account…</p>
      ) : state.user ? (
        <>
          <p>
            Signed in as <strong>{state.user.email || "your account"}</strong>.
            Entries in this account are saved locally and synced to your private
            account when online. Sign in to the same account on another device
            to access them.
          </p>
          <div className="cloud-status" role="status">
            <span className="pill">{status}</span>
            <span>
              {state.pendingCount} pending change
              {state.pendingCount === 1 ? "" : "s"}
            </span>
            {state.lastSyncedAt && (
              <span>
                Last synced{" "}
                {new Date(state.lastSyncedAt).toLocaleString("en-HK", {
                  timeZone: "Asia/Hong_Kong",
                  hour: "2-digit",
                  minute: "2-digit",
                  day: "numeric",
                  month: "short",
                })}{" "}
                HKT
              </span>
            )}
          </div>
          <div className="cloud-actions">
            <button
              className="secondary-button"
              disabled={busy || state.status === "syncing"}
              onClick={() =>
                run(async () => {
                  await syncNow();
                })
              }
            >
              <RefreshCw size={16} />
              Sync now
            </button>
            <button
              className="text-button"
              disabled={busy || pending || state.status === "syncing"}
              onClick={() =>
                run(async () => {
                  await signOut();
                  setPassword("");
                  setMessage(
                    "Signed out. Your account data is retained. You are now viewing your separate device journal.",
                  );
                })
              }
            >
              Sign out
            </button>
          </div>
          {pending && (
            <p className="fine-print">
              Sync pending changes and resolve conflicts before signing out.
              This keeps unsynced entries safe.
            </p>
          )}
          {state.conflicts.map((conflict) => (
            <div className="cloud-conflict" key={conflict.date}>
              <h3>Choose the entry for {conflict.date}</h3>
              <p>
                This date changed on both devices. Choose which version to keep
                for this account.
              </p>
              <div className="cloud-conflict-values">
                <div>
                  <strong>This device</strong>
                  <p>{entrySummary(conflict.local)}</p>
                </div>
                <div>
                  <strong>Cloud</strong>
                  <p>{entrySummary(conflict.remote)}</p>
                </div>
              </div>
              <div className="cloud-actions">
                <button
                  className="secondary-button"
                  disabled={busy}
                  onClick={() =>
                    run(() => resolveConflict(conflict.date, "local"))
                  }
                >
                  Use this device
                </button>
                <button
                  className="secondary-button"
                  disabled={busy}
                  onClick={() =>
                    run(() => resolveConflict(conflict.date, "remote"))
                  }
                >
                  Use cloud
                </button>
              </div>
            </div>
          ))}
          {guestCount > 0 && (
            <div className="cloud-confirm">
              <strong>
                {guestCount} check-in{guestCount === 1 ? "" : "s"} in your
                separate device journal
              </strong>
              <p>
                These entries were saved without an account and are not uploaded
                automatically. Copy them only if they belong to you.
              </p>
              {!copyConfirm ? (
                <button
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => setCopyConfirm(true)}
                >
                  Copy device journal to my account
                </button>
              ) : (
                <>
                  <p>
                    Copy all {guestCount} entries to this account? The copy will
                    stop if an account entry already uses one of these dates, so
                    existing entries are protected. The separate device journal
                    will be kept.
                  </p>
                  <div className="cloud-actions">
                    <button
                      className="primary-button"
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          await copyGuestEntries();
                          setCopyConfirm(false);
                          setMessage(
                            "Device entries copied to your account and queued to sync.",
                          );
                        })
                      }
                    >
                      Confirm copy
                    </button>
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() => setCopyConfirm(false)}
                    >
                      Cancel
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
          <p className="fine-print">
            Signing out keeps account data and returns to your separate device
            journal. Export a backup before clearing browser storage. Account
            data is private to your login; the app source code is public.
          </p>
        </>
      ) : (
        <>
          <p>
            An account is optional. Sign in or create one to sync your intake,
            weight, and cardio entries across devices. Your existing device
            journal stays separate until you choose to copy it.
          </p>
          <form
            className="cloud-auth-form"
            onSubmit={(event) => {
              event.preventDefault();
              run(async () => {
                if (mode === "signup") {
                  const result = await signUp(email.trim(), password);
                  setPassword("");
                  setMessage(
                    result.confirmationRequired
                      ? "Check your email for a confirmation link. After confirming, return here and sign in."
                      : "Your account is ready. Your device journal has not been uploaded automatically.",
                  );
                } else {
                  await signIn(email.trim(), password);
                  setPassword("");
                  setMessage(
                    "Signed in. Your separate device journal has not been uploaded automatically.",
                  );
                }
              });
            }}
          >
            <label htmlFor="cloud-email">
              Email
              <input
                id="cloud-email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={busy}
              />
            </label>
            <label htmlFor="cloud-password">
              Password
              <input
                id="cloud-password"
                type="password"
                autoComplete={
                  mode === "signup" ? "new-password" : "current-password"
                }
                minLength={mode === "signup" ? 6 : undefined}
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={busy}
              />
            </label>
            {mode === "signup" && (
              <p className="fine-print">
                Use at least 6 characters. Creating an account enables cloud
                storage for new entries saved while signed in.
              </p>
            )}
            <div className="cloud-actions">
              <button className="primary-button" disabled={busy} type="submit">
                {busy
                  ? "Please wait…"
                  : mode === "signup"
                    ? "Create account"
                    : "Sign in"}
              </button>
              <button
                className="text-button"
                disabled={busy}
                type="button"
                onClick={() => {
                  setMode(mode === "signup" ? "login" : "signup");
                  setError("");
                  setMessage("");
                }}
              >
                {mode === "signup"
                  ? "Already have an account?"
                  : "Create an account"}
              </button>
            </div>
            {mode === "login" && (
              <button
                className="text-button"
                type="button"
                disabled={busy || !email.trim()}
                onClick={() =>
                  run(async () => {
                    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
                      throw new Error("Enter your email address first.");
                    await resetPassword(email.trim());
                    setMessage(
                      "If an account exists for this email, you will receive a password reset link. Open it, then choose a new password here.",
                    );
                  })
                }
              >
                Forgot password? Send a reset link
              </button>
            )}
          </form>
          <p className="fine-print">
            Without an account, entries stay on this device. Account entries
            upload to the cloud; use a backup for an extra copy.
          </p>
        </>
      )}
      {(state.error || error) && (
        <p className="cloud-message error" role="alert">
          {error || state.error}
        </p>
      )}
      {message && (
        <p className="cloud-message" role="status">
          {message}
        </p>
      )}
    </section>
  );
}
