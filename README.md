# three

Three habits. One streak. An installable web app (PWA) with no build step.

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
- Good habit: mark it done. Done is green, missed is red.
- Bad habit: green while unmarked. Mark a slip and the day turns red.
- Master grid: a day is green only if every habit is on track. Otherwise red.
- Streak: consecutive green days. An unfinished today does not break it.
- Days a habit is not scheduled count as rest days and never break a streak.
- Tap a past square on a habit to fix a day.

## Data

Everything is stored in the browser (localStorage) on that device. Use **Back up** and **Restore** at the bottom of the app to move data between devices.

## Updating

Edit the files and push. If you change cached files, bump `CACHE` in `sw.js` so installed apps refresh.
