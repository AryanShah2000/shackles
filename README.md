# three

Three habits. One score. An installable web app (PWA) with no build step and optional Neon sync.

## Deploy

1. Put these files at the root of your GitHub repo.
2. In Vercel, import the repo. Framework preset: **Other**. Leave build command and output directory empty.
3. Deploy, then open the URL on your phone.

## Install on your phone

- iPhone: open the site in Safari, tap Share, then **Add to Home Screen**.
- Android: open in Chrome, tap the menu, then **Install app** or **Add to Home screen**.

Set up your habits after installing, not before. On iPhone the home screen app has its own storage, separate from Safari.

## How it works

- Up to three habits. Each is a good or bad habit with a set of days.
- Scoring: every finished day, each green habit gives +1. Every slip is -1, so three slips in a day is -3.
- Good habit: mark it done for +1. A missed day is 0.
- Bad habit: +1 for each clean day, paid out at midnight. Each slip you log is -1 (the button turns into "I slipped again"; Undo removes the last one).
- Days a habit is not scheduled are rest days and score nothing.
- Master grid: yellow is a zero day, greener as the day gets more positive, redder as it gets more negative. Open days show as an outlined square.
- Total points replaces the streak. The hero also shows today and the last 7 days.
- Tap a past square on a habit to fix a day. Tap a habit's name to open its grid and Edit link.
- History tab: every tap is logged with its exact local time and the points it moved.

## Reset

Moving to points wiped the scores. Habits are kept, everything else starts at 0 (local storage key `three.v2`). On the server, the first request after deploy drops the old `three_state` table and creates `three_points`. This is irreversible.

## Data and sync

The app always saves to the browser (localStorage) first, so it works offline. Optionally it syncs to a Neon Postgres database through `api/data.js`.

Set up sync:

1. In the Vercel project, open **Storage** and connect your Neon database. This adds `DATABASE_URL`. An existing Neon database works, the app only creates one table named `three_points`.
2. In **Settings, Environment Variables**, add `APP_PASSCODE` with a long private passcode.
3. Redeploy.
4. In the app footer, tap **Turn on sync** and enter the passcode. Do this once on each device.

Sync is single user. The newest edit wins, so edit on one device at a time. Wrong passcode attempts are slowed down on the server.

**Back up** and **Restore** at the bottom of the app still work as a manual copy.

## Updating

Edit the files and push. If you change cached files, bump `CACHE` in `sw.js` so installed apps refresh.
