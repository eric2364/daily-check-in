import { adminClient, env, json, pushStatus, sendReminder } from '../_shared/reminders.ts';

Deno.serve(async request => {
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);
  try {
    if (request.headers.get('x-cron-secret') !== env('CRON_SECRET')) return json({ error: 'Unauthorized.' }, 401);
    const client = adminClient();
    // The database atomically claims each subscription before sending. Overlap
    // between cron invocations cannot send the same scheduled reminder twice.
    const { data, error } = await client.rpc('claim_due_reminders');
    if (error) throw error;
    let sent = 0;
    let failed = 0;
    const rows = [...(data ?? [])];
    // Five concurrent sends keep the 50-item batch below the hosted function
    // time limit even when push services reach our ten-second timeout.
    await Promise.all(Array.from({ length: Math.min(5, rows.length) }, async () => {
      while (rows.length) {
        const row = rows.shift()!;
        try {
          await sendReminder(row.subscription);
          sent++;
        } catch (error) {
          failed++;
          if ([404, 410].includes(pushStatus(error) ?? 0)) {
            // Keep a newly registered subscription if the old one expired mid-send.
            await client.from('reminder_subscriptions').delete().eq('user_id', row.user_id).eq('subscription->>endpoint', row.subscription.endpoint);
          }
          console.error('Scheduled push failed', pushStatus(error) ?? 'unknown');
        }
      }
    }));
    return json({ ok: true, sent, failed });
  } catch {
    console.error('Reminder dispatch failed');
    return json({ error: 'Reminder dispatch unavailable.' }, 500);
  }
});
