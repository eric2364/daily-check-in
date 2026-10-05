import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import webpush from 'npm:web-push@3.6.7';

export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

export function env(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing server configuration: ${name}`);
  return value;
}

export function adminClient() {
  return createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export interface Subscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export function validSubscription(value: unknown): value is Subscription {
  if (!value || typeof value !== 'object') return false;
  const subscription = value as Subscription;
  if (typeof subscription.endpoint !== 'string' || subscription.endpoint.length > 4096) return false;
  try {
    const url = new URL(subscription.endpoint);
    // Push subscriptions are outbound request destinations. Restrict them to
    // known browser push services, so users cannot turn this into an SSRF proxy.
    const allowed = ['web.push.apple.com', 'fcm.googleapis.com', 'updates.push.services.mozilla.com', 'notify.windows.com'];
    if (url.protocol !== 'https:' || url.port || url.username || url.password ||
      !allowed.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) return false;
  } catch { return false; }
  if (!subscription.keys || typeof subscription.keys.p256dh !== 'string' || typeof subscription.keys.auth !== 'string') return false;
  return /^[A-Za-z0-9_-]{87}$/.test(subscription.keys.p256dh) && /^[A-Za-z0-9_-]{22}$/.test(subscription.keys.auth);
}

export function validTime(value: unknown): value is string {
  return typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export async function sendReminder(subscription: Subscription, test = false) {
  const appUrl = env('APP_URL');
  if (new URL(appUrl).protocol !== 'https:') throw new Error('APP_URL must use HTTPS');
  webpush.setVapidDetails(env('VAPID_SUBJECT'), env('VAPID_PUBLIC_KEY'), env('VAPID_PRIVATE_KEY'));
  await webpush.sendNotification(subscription, JSON.stringify({
    title: 'Daily Check-in',
    body: test ? 'Your reminders are ready. Tap to open your daily check-in.' : 'A moment for yourself: record today’s intake and weight.',
    url: appUrl,
    tag: test ? 'daily-check-in-test' : 'daily-check-in-reminder',
  }), { TTL: 3600, urgency: 'normal', timeout: 10000 });
}

export function pushStatus(error: unknown): number | undefined {
  return error && typeof error === 'object' && 'statusCode' in error
    ? Number(error.statusCode) : undefined;
}
