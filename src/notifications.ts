import { createClient } from "@supabase/supabase-js";
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
const vapid = import.meta.env.VITE_VAPID_PUBLIC_KEY;
export const remindersConfigured = Boolean(url && key && vapid);
const client = url && key ? createClient(url, key) : null;
function applicationServerKey(value: string): Uint8Array<ArrayBuffer> {
  const raw = atob(
    value
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(Math.ceil(value.length / 4) * 4, "="),
  );
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
async function call(action: string, extra: Record<string, unknown> = {}) {
  if (!client)
    throw new Error(
      "Reminders need the online service configured first. Your daily logs still work.",
    );
  const {
    data: { session },
  } = await client.auth.getSession();
  if (!session) {
    const { error } = await client.auth.signInAnonymously();
    if (error) throw error;
  }
  const { data, error } = await client.functions.invoke("reminders", {
    body: { action, ...extra },
  });
  if (error) {
    const response = (error as unknown as { context?: Response }).context;
    if (response?.json) {
      try {
        const detail = await response.json();
        if (detail.error) throw new Error(detail.error);
      } catch (detail) {
        if (detail instanceof Error && !(detail instanceof SyntaxError))
          throw detail;
      }
    }
    throw new Error(
      "Could not reach the reminder service. Check your connection and try again.",
    );
  }
  if (data?.error) throw new Error(data.error);
}
export function isStandalone() {
  return (
    matchMedia("(display-mode: standalone)").matches ||
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
  );
}
export async function enableReminders(time: string) {
  if (!remindersConfigured)
    throw new Error(
      "Reminders need the online service configured first. Your daily logs still work.",
    );
  if (
    !("serviceWorker" in navigator) ||
    !("PushManager" in window) ||
    !("Notification" in window)
  )
    throw new Error(
      "Install this app on your Home Screen using Safari first. Notifications require iOS 16.4 or later.",
    );
  if (/iPhone|iPad|iPod/.test(navigator.userAgent) && !isStandalone())
    throw new Error(
      "Open Daily Check-in from your Home Screen to enable notifications.",
    );
  const permission = await Notification.requestPermission();
  if (permission !== "granted")
    throw new Error(
      "Notifications are not allowed. You can change this in iPhone Settings → Notifications.",
    );
  const registration = await Promise.race([
    navigator.serviceWorker.ready,
    new Promise<never>((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(
              "Offline support is not ready yet. Reopen the installed app while online and try again.",
            ),
          ),
        15000,
      ),
    ),
  ]);
  const subscription =
    (await registration.pushManager.getSubscription()) ||
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: applicationServerKey(vapid),
    }));
  await call("subscribe", { subscription: subscription.toJSON(), time });
}
export async function disableReminders() {
  await call("disable");
  const registration = await navigator.serviceWorker.getRegistration();
  await (await registration?.pushManager.getSubscription())?.unsubscribe();
}
export async function testReminder() {
  await call("test");
}
