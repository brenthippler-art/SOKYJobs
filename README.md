# South Central KY Jobs

A job board for south central Kentucky, built from the weekly open job report that
reentry case managers use to match people with work.

**Live site:** _add your Vercel URL here_

![Job board on desktop](docs/screenshots/board-desktop.png)

## The problem

The South Central Kentucky Reentry Council distributes a weekly JobsEQ export with
thousands of postings. It's a great resource but hard to use:

- Every job is marked "Active," including postings from 2016. Half the list is more
  than three months old, and many jobs are reposted several times.
- Locations are written about 650 different ways ("Bowling Green, Kentucky",
  "42104", "3075 Scottsville Rd, Bowling Green", GPS coordinates).
- There's no usable job category, and 75% of postings list no pay.

Case managers need to answer one question fast: *what real, current jobs are
within reach of this person?*

## What I built

- **A cleaning pipeline** that removes likely-filled jobs (older than 90 days, or
  older reposts of the same job), normalizes every location to a town and county,
  groups occupations into 22 plain-English categories, fixes ALL-CAPS titles,
  estimates hourly pay, and labels staffing agencies.
- **A job board** where you pick counties from a tile map, then filter by type of
  work, pay, and posting date. Filters live in the URL, so a case manager can text
  a client a link like `?county=Barren&type=Food%20Service`. Lists print as a
  compact table for clients without internet.
- **A password-protected admin page** (`/admin`) where a new report is uploaded,
  previewed, and published. Publishing commits the new data to GitHub, and Vercel
  redeploys automatically. It also produces a cleaned Excel workbook for anyone
  who prefers a spreadsheet.

![Admin upload preview](docs/screenshots/admin-preview.png)

## Stack

Next.js 16 (App Router, Cache Components, Server Actions) · TypeScript ·
Tailwind CSS v4 · exceljs · GitHub Contents API · Vercel

## Technical decisions

- **Static site, data in git.** `src/data/jobs.json` is imported at build time,
  so the public site is fully static: no database, no API, no runtime cost.
  Every weekly update is a commit, which gives a free history of the job market.
  The JSON is written one job per line so each commit's diff shows exactly which
  jobs were added and removed.
- **Upload publishes through GitHub, not a database.** The admin page commits
  `jobs.json` with the GitHub Contents API, which triggers the same Vercel
  deploy as a manual push. Because the file is over 1 MB, the API is called with
  the `application/vnd.github.object` media type, which is the only way GitHub
  returns the file's `sha` at that size.
- **Cleaning rules live in one place.** `src/lib/report/` has no Next.js
  dependencies, so the same code runs in a Server Action on Vercel and in
  `npm run clean` on a laptop. It was ported from an earlier Python script and
  checked against it: identical output for all 2,233 jobs.
- **Location parsing takes the last town name in the text**, because street
  names are often town names ("3075 Scottsville Rd, Bowling Green").
- **Simple, signed sessions.** There's one admin, so the password lives in an
  environment variable and an HMAC-signed, httpOnly, SameSite=Strict cookie
  remembers the sign-in for 12 hours. Every Server Action re-checks the session
  itself, and comparisons use `timingSafeEqual`.
- **Preview, then publish.** Uploading only previews. Publishing re-cleans the
  file on the server rather than trusting data sent back from the browser, and
  warns if the report is older than the one already live.
- **Cache Components gotcha:** the admin gate calls `connection()` first.
  Without it, Next prerenders the "is the password configured?" check at build
  time and bakes the answer into the page.

## Accessibility and testing

- Body text is set in Atkinson Hyperlegible (designed by the Braille Institute
  for low-vision readers) at a 17px base. All text and UI color pairs meet WCAG AA
  (4.5:1 or better).
- County tiles are real buttons with `aria-pressed` and labels like "Warren
  County, 1,295 jobs"; the selected state uses a checkmark, not just color.
- The result count is an `aria-live` region; the mobile filter drawer is a
  native `<dialog>` (focus trapping and Esc for free); visible focus everywhere;
  reduced motion respected.
- Tested with Playwright: desktop and mobile layouts, keyboard-only county
  selection, print view, and the full admin flow (wrong password, bad file,
  preview, Excel download, publish against a mock GitHub API, sign out,
  unauthenticated requests rejected).

![Job board on mobile](docs/screenshots/board-mobile.png)

## Setup

```bash
npm install
cp .env.example .env.local   # fill in values to test /admin locally
npm run dev                  # http://localhost:3000
```

### Deploying on Vercel

1. Import the GitHub repo into Vercel (defaults are fine).
2. Create a GitHub fine-grained token: Settings > Developer settings >
   Fine-grained tokens. Repository access: only this repo. Permissions:
   Contents, Read and write.
3. In Vercel, Project > Settings > Environment Variables, add `ADMIN_PASSWORD`,
   `SESSION_SECRET`, `GITHUB_TOKEN`, and `GITHUB_REPO` (see `.env.example`).
4. Redeploy so the variables take effect.

### Weekly update

**From the website:** go to `/admin`, sign in, choose the report, check the
preview, click **Publish to the site**. Live in about a minute.

**From your laptop:**

```bash
npm run clean -- ~/Downloads/South_Central_Open_Job_Report_10-26-2026.xlsx
git add src/data/jobs.json
git commit -m "Jobs report 10/26/2026"
git push
```

### Common changes

- **A town shows as "Unknown":** add it to `CITY_TO_COUNTY` in `src/lib/report/rules.ts`.
- **Change the 90-day cutoff or other rules:** `src/lib/report/rules.ts`.
- **Add a county to the map:** `MAP_COUNTIES` in `src/lib/filters.ts`, plus a grid
  position in `TILES` in `src/components/CountyMap.tsx`.
- **Colors and fonts:** the `@theme` block in `src/app/globals.css`.

## Project map

```
src/lib/report/rules.ts       towns, counties, categories, cutoffs (edit these)
src/lib/report/clean.ts       spreadsheet -> clean jobs + removed list
src/lib/report/excel.ts       cleaned Excel workbook
src/lib/session.ts            admin password check + signed cookie
src/lib/github.ts             commits jobs.json to the repo
src/app/admin/                upload page, server actions, Excel download route
src/app/page.tsx              public job board (imports jobs.json)
src/components/               board, county map, filters, job rows, print view
scripts/clean-report.ts       npm run clean
```
