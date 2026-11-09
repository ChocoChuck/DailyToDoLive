# Daily Tracker — Supabase edition (static frontend)

No Node server, npm, build step, or SQLite. Uses HTML + CSS + vanilla JS + Supabase Auth and Postgres with Row Level Security (RLS). Your data stays private to your signed-in account.

## Set up (about 5 steps)

1. Create a Supabase project at https://supabase.com/dashboard .
2. Open **SQL Editor**, paste the entire `schema.sql`, and **Run** it **once**. Use a new project or inspect for naming conflicts first. The SQL creates separate `tracker_`-prefixed tables, triggers, and functions.
3. In Supabase **Project Settings > API Keys** (or **Connect**), copy your **Project URL** and **publishable** key (`sb_publishable_...`), or the legacy **anon** key. Replace the two placeholders in `config.js`. NEVER use a `service_role` or secret key in `config.js`.
4. In **Authentication > URL Configuration**, set the Site URL to your deployed domain. If you use email confirmation, add that deployed domain under Redirect URLs as well. In **Authentication > Providers > Email**, decide whether email confirmation is required. New signups may need to click an emailed link before they can log in.
5. Upload `index.html`, `style.css`, `app.js`, and `config.js` to any **static** host (GitHub Pages, Cloudflare Pages, Netlify, or Railway static deployment). You do **not** need to upload `schema.sql`. On GitHub Pages, open the published Pages URL, **not** a raw GitHub file. Files use relative paths, so subpaths work.

For local testing, open `index.html` in a browser. If the browser rejects `file://` behavior, use VS Code Live Server or `python3 -m http.server 8080` (only a local static file server; not a Node backend).

## Features

- Original five daily goals automatically populated for each new account.
- Tap to mark complete; automatic note saving; historical editing back one calendar year.
- Goals added today, archived (soft-deleted) today without losing earlier scores and notes.
- Daily percentage and chronological history, including blank days since your account start / earliest backdated entry.
- 7-day, 30-day, 183-day (~6 month), 365-day, all-time average calculated from daily percentages.
- New York calendar dates on all devices; checks and writes enforced server-side using the New York date.
- Supabase authentication and per-user RLS (read policies); insert/update done through checked Postgres RPC functions.

## Important: transferring your previous SQLite data

**This new app does not automatically import `tracker.db`.** That file uses a different database engine and schema. Keep its backup (`sqlite3 tracker.db ".backup 'tracker-backup.db'"`) before switching. The new Supabase account starts with five default goals and a fresh history. To import your previous entries/goals correctly, you will need a one-time migration that translates old integer goal IDs to new UUIDs, maps `day` and notes, and retains the old created/archive dates and started_on value. Do not simply upload `tracker.db` to Supabase or publish it to GitHub.

## Security notes

- `config.js` may be public because the **publishable key** is intended for browser use. Data privacy is provided by Auth + RLS + explicit ownership checks in RPC functions.
- You must keep Supabase secret/service keys and passwords out of your source code.
- The web app requires an internet connection to read/write data.
- If you rename SQL objects, update the JS queries and RPC names accordingly.
- No offline sync: edits must be successfully saved before closing the tab. Check the "Saved" status.

### Optional: import your existing SQLite history

The ZIP includes `import_sqlite.py` (Python standard library only; **not** a server). If you want your old records in Supabase:

1. Back up your SQLite database while the old Node app is stopped: `sqlite3 tracker.db ".backup 'tracker-backup.db'"`.
2. Set up Supabase with `schema.sql`, then create your account in the new app and confirm your email if required.
3. In Supabase **Authentication > Users**, copy **your user's UUID** (not a password or API key).
4. From the folder containing `import_sqlite.py`, run: `python3 import_sqlite.py /path/to/tracker-backup.db YOUR_AUTH_USER_UUID`.
5. Review the locally generated **`import-tracker.sql`**, then run it in Supabase **SQL Editor**. It imports original goal names, activation/archive dates, checkmarks, notes, and started date. **Only use this on a new tracker account** before creating new activity; the script replaces the account's five untouched starter goals. It aborts if the account already has entries or doesn't have exactly five goals.
6. Refresh the dashboard. Keep the original SQLite backup and the generated SQL private. The import file may contain personal notes.

**Important:** The import needs your *old tracker database* and your signed-up Supabase Auth user UUID; it does not run automatically and should not be included in a public deployment.
