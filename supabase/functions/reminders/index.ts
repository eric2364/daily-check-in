import { adminClient, cors, json, pushStatus, sendReminder, validSubscription, validTime } from '../_shared/reminders.ts';

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);
  try {
    const token = request.headers.get('Authorization')?.match(/^Bearer (.+)$/i)?.[1];
    if (!token) return json({ error: 'Sign in to enable reminders.' }, 401);
    const client = adminClient();
    const { data: auth, error: authError } = await client.auth.getUser(token);
    if (authError || !auth.user) return json({ error: 'Your reminder session has expired.' }, 401);
    const userId = auth.user.id;
    if (Number(request.headers.get('Content-Length') ?? 0) > 10000) return json({ error: 'Request too large.' }, 413);
    const raw = await request.text();
    if (raw.length > 10000) return json({ error: 'Request too large.' }, 413);
    let body;
    try { body = JSON.parse(raw); } catch { return json({ error: 'Invalid JSON.' }, 400); }
    if (!body || typeof body !== 'object') return json({ error: 'Invalid request.' }, 400);

    if (body.action === 'subscribe') {
      const time = body.time ?? '09:00';
      if (!validTime(time) || !validSubscription(body.subscription)) return json({ error: 'Invalid notification subscription or reminder time.' }, 400);
      // Only persist the push fields that are used, never arbitrary caller data.
      const subscription = { endpoint: body.subscription.endpoint, keys: body.subscription.keys };
      const { error } = await client.from('reminder_subscriptions').upsert({
        user_id: userId, subscription, reminder_time: time, updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });
      if (error) throw error;
      return json({ ok: true });
    }
    if (body.action === 'disable') {
      const { error } = await client.from('reminder_subscriptions').delete().eq('user_id', userId);
      if (error) throw error;
      return json({ ok: true });
    }
    if (body.action === 'test') {
      const { data, error } = await client.rpc('claim_reminder_test', { target_user: userId });
      if (error) throw error;
      if (!data?.length) return json({ error: 'Enable reminders first, and allow one minute between tests.' }, 429);
      try { await sendReminder(data[0].subscription, true); }
      catch (error) {
        if ([404, 410].includes(pushStatus(error) ?? 0)) {
          await client.from('reminder_subscriptions').delete().eq('user_id', userId).eq('subscription->>endpoint', data[0].subscription.endpoint);
          return json({ error: 'This subscription expired. Enable reminders again.' }, 410);
        }
        console.error('Test push failed', pushStatus(error) ?? 'unknown');
        return json({ error: 'The notification service could not send the test. Try again in a minute.' }, 502);
      }
      return json({ ok: true });
    }
    return json({ error: 'Unknown reminder action.' }, 400);
  } catch {
    console.error('Reminder operation failed');
    return json({ error: 'Reminder service unavailable. Please try again.' }, 500);
  }
});
