# Torn Run Tracker

A Vue dashboard for the `Runs` tab in a Google spreadsheet. The frontend reads all eight columns through the Vercel API. **Refresh** imports up to three new Torn runs, then reads the consolidated sheet.

## Local development

1. Set `GOOGLE_SPREADSHEET_ID`, `GOOGLE_CLIENT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `ADMIN_SECRET`, `TORN_API_KEY`, and `TORN_FRIEND_ID` in `.env.local`.
2. Share the spreadsheet with the service account email as an editor. Name its tab `Runs`.
3. Run `pnpm run dev:full` and open the local URL printed by Vercel.
4. Enter your `ADMIN_SECRET` in the access screen. It stays in page memory and is cleared when you lock or reload the page.

`pnpm run dev` starts only the Vite frontend; use `dev:full` for the API routes. Run `pnpm test` for the event matching and sheet row tests, and `pnpm run build` to type check and build the frontend.

## Import rules

The importer reads Torn user logs for money sent (4800), money received (4810), and abroad purchases (4201). It matches a `deposit` message sent to `TORN_FRIEND_ID`, `xanN` messages received from that friend within 24 hours before a Xanax purchase in South Africa and after the previous Xanax purchase, and that purchase. Repeated matching labels for one purchase contribute one Pasabuy Qty value (for example, three `xan5` transfers mean 5, not 15). If the labels differ, the run is skipped rather than guessing a quantity. The received money amount is not used by the sheet; Pasabuy Cost remains the sheet formula `Pasabuy Qty × SA Price`. The purchase date and time are converted from UTC to Manila time. It only imports purchases on or after November 5, 2026 00:00 UTC and writes the sheet's formulas for Main Xanax Cost, Pasabuy Cost, and Change with each new row. Refresh updates the Pasabuy Qty of an existing imported row if its Torn quantity changes. Separate purchases on the same Manila date create separate rows. The purchase log ID is stored in spreadsheet developer metadata, not in a visible column. It ignores older logs whose messages do not follow the new labels.

The browser limits Refresh to once every five minutes. The API also stores its last sync attempt in Google Sheets developer metadata, so a new Vercel process returns `429` during the cooldown. To prevent repeated requests from invoking a Vercel Function at all, keep the Vercel WAF rule named **Torn sync cooldown** enabled for `POST /api/sync` (one request per 300 seconds per IP).

## Production setup

Configure the same six variables listed above in Vercel's Production environment before deploying. The local `.env.local` file is only used for local development. Check that the WAF rule is published and enabled before deploying; a draft rule does not block function invocations. Deploy directly from this folder with `pnpm exec vercel --prod`; Git is not required.
