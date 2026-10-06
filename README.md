# Daily Check-in

A simple iPhone Home Screen app: record perceived intake from 1–5, optionally add weight in kilograms and cardio, and see trends over time. No MacBook or Apple developer membership required.

**App:** https://eric2364.github.io/daily-check-in/  
**Source:** https://github.com/eric2364/daily-check-in

## Install on your iPhone

You do not build or compile on your phone. GitHub builds the app and hosts it.

1. Open the app link above **in Safari**.
2. Tap **Share** → **Add to Home Screen**. If shown, turn on **Open as Web App**.
3. Tap **Add**, then open **Daily Check-in** from its new Home Screen icon.
4. Allow the first load to finish while online. Subsequent logging and graphs work offline.
5. Choose an intake level, weight, and/or cardio record and tap **Save check-in**. The date defaults to today in Hong Kong time.
6. For a missed day, change the date. To change an existing entry, use **History → Edit**.

## Export your data as CSV

Open **Settings → Export spreadsheet (CSV)**. On iPhone, use the download/share controls to save it to Files or share it. The exported CSV includes every entry, including data restored from a JSON backup:

```csv
date,intake_level,weight_kg,cardio_done,cardio_type,cardio_minutes,cardio_calories
2026-10-05,3,70.2,Yes,Walking,30,180
2026-10-06,4,,No,,,
```

Empty cells mean not recorded. Open CSV in Numbers, Excel, or Google Sheets. **Export backup** downloads a versioned JSON file; **Restore from backup** imports it after preview/confirmation. Matching dates are replaced, other dates kept. CSV is an analysis export; restoration accepts the app's JSON backup.

Logs stay in this browser/app's IndexedDB. Clearing website data, uninstalling, storage eviction, or changing phone/hosting address may lose access. Export backups regularly. Safari and the installed app may have separate data containers: start using the installed app consistently.

## Features

- One editable entry per Hong Kong date; intake, weight, or cardio alone is enough.
- Optional cardio Yes/No, activity type, minutes, and manually entered calories burned. Leave it unanswered when not recorded. Yes can be saved without details; No clears details.
- Cardio days, total recorded minutes/calories, and a minutes trend for the selected period. Calories are your estimate, not calculated by the app.
- Intake labels: very low, low, usual, high, very high. These are impressions, not calorie estimates or nutrition advice.
- Weight/intake graphs over 7 days, 30 days, or all time, with calendar gaps for missing days.
- Seven-calendar-day weight average, latest recorded weight, period weight change, average intake, days logged.
- Local offline journal, JSON backup/restore, CSV export, installation guidance.
- Optional daily Web Push reminder, default **09:00 Asia/Hong_Kong**, adjustable in Settings. Notification click opens Today.

## Enable notifications

Reminders require a configured Supabase backend and an iPhone on **iOS 16.4 or later**. Installing the frontend alone does **not** enable scheduled notifications. The app clearly shows when the service is not connected.

Deploy the backend following [supabase/README.md](supabase/README.md), then add these public repository **Actions variables** under Settings → Secrets and variables → Actions → Variables:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_VAPID_PUBLIC_KEY`

Run the Pages workflow again. Open the installed app → **Settings → Daily reminder**, allow notifications, and tap **Send a test reminder**. Set a reminder a few minutes ahead to verify scheduling before relying on 09:00.

The backend receives only anonymous push subscriptions and reminder settings, never weight, intake, or cardio logs. VAPID private keys, service-role keys, and cron secrets stay on the server. Delivery depends on your connection, iPhone Focus/notification settings, and backend availability. Until setup is complete, a repeating Apple Reminders alert can remind you to open the app.

## Development

Node.js 22 or later:

```sh
npm ci
npm run dev
npm test
npm run build
npm run preview
```

The service worker registers only in the production build; use `npm run preview` to test offline behavior. Copy `.env.example` to `.env.local` and replace its placeholder values only when configuring reminders. Do not commit real secrets.

## GitHub hosting and ongoing versions

The repository is public at the owner's request so free GitHub Pages can host it. The code is public; your journal data is not in GitHub.

In repository **Settings → Pages → Source**, choose **GitHub Actions**. The **Deploy GitHub Pages** workflow tests, builds, and publishes on changes to `main`, or can be run manually under **Actions**. **Check app** also validates the reminder functions. Use `git add`, `git commit`, and `git push` for future changes; GitHub keeps version history and automatically deploys the frontend. The cardio release is tagged `v1.1.0`. Existing entries and version 1 JSON backups remain compatible. New backups use version 2.

Each build stamps a unique offline cache version. New versions wait until existing app windows close, then become active on reopening; this avoids interrupting unsaved forms. Backend migrations/functions need separate Supabase deployment when changed.

Alternative hosting configuration for Netlify is included but not required. Changing the deployed URL does not migrate existing local logs: export a JSON backup from the old app, then restore it at the new address.

## Validation

Automated tests cover data validation, Hong Kong date boundaries, IndexedDB persistence, atomic backups, CSV, missing-day charts/statistics, and service worker caching/notification navigation. Supabase has Deno type checks and tests for push subscription validation and Web Push cryptography. Real iPhone installation and notification delivery require a device check after backend setup.

## How the app works

Read the [illustrated PDF guide](output/pdf/daily-check-in-guide.pdf) for installation, phone storage, HTML/CSS/JavaScript, offline operation, backups, updates, and when this approach fits future personal apps. The guide source is `docs/build_guide.py`.
