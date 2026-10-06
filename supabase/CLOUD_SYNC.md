# Optional private journal cloud sync

The app keeps working offline with IndexedDB. Account sync adds a second copy of
journal entries to your Supabase project. The public GitHub repository and GitHub
Pages host contain app code, not journal records or passwords.

## Database setup

Apply `migrations/20261006100000_cloud_journal.sql` using the Supabase SQL editor,
or run your normal Supabase migration deployment. The existing reminder migration
is independent; reminder delivery does not need to be configured for journal sync.
Do not paste a service-role key into GitHub variables, frontend files, or browser code.

The migration creates:

- `journal_records`: one entry per account and date. Deleted entries are retained
  as tombstones so another device does not bring them back automatically.
- `journal_mutations`: successful operation receipts. If a request completes on the
  server but its response is lost, repeating it does not repeat the write.
- `journal_sync(p_operations jsonb)`: authenticated batch synchronization.

RLS permits signed-in, non-anonymous accounts to read only their own journal.
Direct client writes are revoked. The security-definer sync function obtains the
account from the verified session, validates entries, and writes only that account.
Anonymous reminder sessions cannot synchronize journal data.

## Authentication and frontend settings

Enable email/password authentication in Supabase Authentication. Keep email
confirmation enabled and allow password recovery.
Use `https://eric2364.github.io/daily-check-in/` as the production Site URL and allow
that exact URL as a redirect URL for confirmation and password recovery.
Email confirmation and recovery delivery may require your own SMTP provider:
Supabase's built-in email sender restricts recipients to project organization
team addresses and currently allows only two emails per hour. It is intended for
testing. Your personal organization-owner address can use it within this limit.
Check provider delivery settings before inviting additional users.
[Supabase SMTP documentation](https://supabase.com/docs/guides/auth/auth-smtp).

The frontend uses these **public** deployment variables:

- `VITE_SUPABASE_URL`: your project URL.
- `VITE_SUPABASE_ANON_KEY`: the publishable/anonymous browser API key.

These values identify the project; privacy comes from authenticated sessions and
RLS. A secret/service-role key must never be used for either variable. Rebuild and
redeploy GitHub Pages after changing variables.

## Sync contract

An operation has `date`, `entry` (full validated entry or `null` to delete),
`base_revision` (last observed UUID revision or `null` for a new date), and a fresh
UUID `mutation_id`. A maximum of 200 operations is accepted in one request.
Each accepted mutation assigns its UUID as the new record revision. A stale base
revision becomes a conflict instead of overwriting another device's entry.

The response contains:

- `records`: all of this account's records, including tombstones; each has
  `date`, `entry`, and UUID `revision`.
- `conflicts`: current server records for rejected stale operations.
- `acknowledged`: successful mutation UUIDs, including previously completed retries.

The request is atomic for validation errors. Conflicts are valid results and do
not prevent unrelated dates in the same batch from syncing. A per-account database
lock serializes concurrent requests. Full pulls avoid missing entries because of
clock differences or timestamp pagination. The app retains conflicting local work
until the user chooses which version to keep.

## Verify access and recovery

Run `tests/cloud_journal.sql` as the database owner after applying the migration.
For a PostgreSQL connection, run:

```sh
psql "$SUPABASE_TEST_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/cloud_journal.sql
```

Keep that connection string secret. The tests create temporary account fixtures within a transaction and rolls them back.
It checks account isolation, denial of direct writes and anonymous sync, revision
conflicts, deletion tombstones, retry idempotency, and atomic invalid-batch rollback.
Do not change its fixed fixture IDs to real account IDs.

Also test the app on two devices: save online, verify Synced, sign in elsewhere,
edit the same date offline on both devices, reconnect, and verify a conflict is
shown without silently losing either version. Export a JSON backup before testing
clearing website data; only successfully synchronized records are recoverable
from the cloud.

Cloud sync is not an independent historical backup. Deletions propagate; keep
occasional JSON backups in Files or iCloud Drive. Supabase free-plan quotas and
inactive-project behavior can change; consult the project's billing and usage
page. Account deletion cascades its records and receipts.
