# Changelog

## 1.2.0 — 2026-10-06

Added email/password login, email confirmation and password recovery, separate guest/account journals, and offline-first Supabase sync. Pending changes persist locally; revision conflicts require an explicit choice. Existing guest data is copied only on confirmation. Database access rules isolate accounts, and sync retries and deletion tombstones prevent accidental overwrite or resurrection. Updated the guide for cloud storage and backups.

## 1.1.0 — 2026-10-06

Added optional daily cardio Yes/No, activity type, minutes, and manually entered calories burned; cardio history, period totals, and a minutes graph. CSV exports include cardio and safely quote free text. Version 2 JSON backups preserve cardio while accepting existing version 1 backups and local entries. Included a beginner PDF guide to installation, local storage, offline use, and future personal web apps.

## 1.0.2 — 2026-10-06

Use the native iPhone share sheet for CSV/JSON exports, including Save to Files.

## 1.0.1 — 2026-10-06

Added previous/next day controls and more robust date input handling.

## 1.0.0 — 2026-10-06

Initial release: local daily intake/weight journal, calendar-based trends, seven-day rolling weight average, history editing/deletion, JSON backups and CSV export, installable offline Home Screen app, and optional Supabase daily Web Push reminders at 09:00 Hong Kong time.
