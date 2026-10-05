# Daily Check-in reminders

The application records intake and weight locally. This optional backend stores only an anonymous device ID, Web Push address/keys, chosen reminder time, and delivery bookkeeping. You can use the app without it; scheduled push then remains unavailable.

## Deploy

1. Create a Supabase project. In Authentication → Providers, enable **Anonymous sign-ins**. Use the project's URL and public anon/publishable key for the frontend `.env` (never its service-role key).
2. Install the Supabase CLI, log in, and link the project: `supabase link --project-ref YOUR_PROJECT_REF`. Apply `supabase db push` from the repository root.
3. Generate a VAPID key pair with `npx web-push generate-vapid-keys`. Copy the public key to frontend `VITE_VAPID_PUBLIC_KEY`. Keep the private key server-side.
4. Set Edge Function secrets using `supabase secrets set` or the dashboard:

   | Secret | Value |
   | --- | --- |
   | `VAPID_PUBLIC_KEY` | Generated public key |
   | `VAPID_PRIVATE_KEY` | Generated private key |
   | `VAPID_SUBJECT` | A contact such as `mailto:you@example.com` |
   | `APP_URL` | Full deployed HTTPS app URL, including GitHub repository path and trailing slash |
   | `CRON_SECRET` | A generated random secret, at least 32 bytes |

   Supabase supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to its deployed functions. Do not put those privileged keys in frontend variables. Generate a cron secret with `openssl rand -hex 32`.
5. Deploy: `supabase functions deploy reminders` and `supabase functions deploy dispatch-reminders`. The checked-in config disables gateway JWT verification; **the reminders handler itself verifies user tokens with Supabase Auth**, and the dispatcher verifies its cron secret.
6. In the Supabase dashboard, enable the **pg_cron** and **pg_net** extensions. Save these Vault secrets via the dashboard: `daily_checkin_project_url` (your project URL) and `daily_checkin_cron_secret` (the same `CRON_SECRET`). Run the following SQL once:

```sql
select cron.schedule(
  'daily-checkin-reminders',
  '* * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'daily_checkin_project_url') || '/functions/v1/dispatch-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'daily_checkin_cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
```

To remove the schedule, run `select cron.unschedule('daily-checkin-reminders');`. To rotate the secret, update both Vault and the Edge Function secret. Never commit real secrets.

## Frontend API

Frontend variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_VAPID_PUBLIC_KEY`.

Use `supabase.auth.signInAnonymously()` when reminders are first enabled; reuse the existing persisted session. With an authenticated bearer token, POST to `/functions/v1/reminders`, or use `supabase.functions.invoke('reminders', { body: ... })`:

- Subscribe/update: `{ "action": "subscribe", "subscription": <PushSubscription.toJSON()>, "time": "09:00" }`.
- Disable/delete: `{ "action": "disable" }`.
- Test: `{ "action": "test" }`. Tests are limited to one per minute per device.

Success: `{ "ok": true }`. Failure: `{ "error": "Readable message" }` with an appropriate non-2xx status. Time is `HH:mm` in **Asia/Hong_Kong**. The default is 09:00. A device has one subscription. Enable notifications only after a user gesture and a successful browser subscription; display server failures and offer a retry. Do not export the anonymous auth session with health backups.

The Web Push JSON includes `title`, `body`, `url`, and `tag`. The service worker must display it using `showNotification`, then focus/open the configured app URL on click. Notifications contain no weight or intake values.

## Delivery behavior and limits

The dispatcher runs every minute and atomically claims due subscriptions before sending, so overlapping jobs cannot produce duplicate scheduled sends. It allows a ten-minute window after the scheduled time to accommodate short delays, with a batch cap of 50 per run and five concurrent provider requests. The daily date and time are computed by PostgreSQL in Hong Kong time, independent of server timezone. Marking the attempt first provides at-most-once delivery; a process failure or temporary push-provider failure is not retried that day. Check function logs and cron failures if a reminder is missed. Reminders resume the following day. Provider 404/410 responses remove only the expired subscription. iOS delivery remains best effort and depends on connectivity, permissions, and notification settings.

The endpoint validates browser push-service destinations (Apple, Google FCM, Mozilla, Windows) before any outgoing send. Database RLS exposes only a device's own subscription to that authenticated device; only server code may mutate it or invoke dispatcher/test claim functions. The API does not receive or inspect daily logs, so a daily reminder is sent even if a check-in already exists.

Clearing local storage loses the anonymous identity and requires enabling reminders again. The old subscription expires when the browser removes it; expired push addresses are pruned on dispatch. To immediately remove an old active subscription, use Settings → disable before clearing app storage.

## Verify after deployment

- Confirm unauthenticated API calls return 401 and another device cannot read the first device's row.
- On a real iPhone with iOS 16.4+, install the app using Safari → Share → Add to Home Screen; launch the installed app and enable reminders.
- Send a test while the app is closed and tap it to open the app. A second immediate test should report the rate limit.
- Set the reminder a few minutes ahead in Hong Kong time, and verify one send despite overlapping dispatcher calls.
- Disable reminders and confirm the database row is removed and subsequent scheduled delivery stops.
- Check that malformed subscriptions and times return 400; only public keys appear in built frontend assets.

Documentation: [Anonymous authentication](https://supabase.com/docs/guides/auth/auth-anonymous), [scheduled Edge Functions](https://supabase.com/docs/guides/functions/schedule-functions), [Apple Web Push](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers).

Local source checks (Deno 2): `deno task --config supabase/deno.json check` and `deno task --config supabase/deno.json test`. These check function TypeScript and exercise subscription destination/key validation and reminder-time parsing. Live PostgreSQL/RLS/cron and push delivery require the deployed project and actual device checks above.

## Hosting and monitoring

GitHub Pages is available for public repositories on GitHub Free; private repository support depends on a paid plan. Pages sites can be publicly accessible even when their source repository is private. This app has no website login; it protects health logs by keeping them in each device's local browser storage. Public frontend configuration is intended to be visible. Never publish `.env`, exported health backups, or server-only keys. See [GitHub Pages availability](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages).

Inspect scheduled job execution using `select * from cron.job_run_details order by start_time desc limit 20;`. A successful cron run only means the HTTP request was queued. Inspect actual function HTTP responses using `select id, status_code, timed_out, error_msg from net._http_response order by id desc limit 20;`, and use Edge Function Logs for provider failures. A dispatcher HTTP 200 with `failed > 0` means at least one push attempt failed; it is not retried that day. Function logs contain generic status codes rather than private push endpoints or health data. Configure a dashboard/log alert for dispatcher errors if you need operational notifications.
