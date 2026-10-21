# South Central KY Jobs

A job board built from the weekly South Central Kentucky open job report (a JobsEQ
export). A Python script cleans the spreadsheet, removes likely-filled "ghost" jobs,
and saves the result as JSON. The Next.js site reads that JSON at build time, so the
whole site is static: no database, no API, no server costs.

## Weekly update (about 2 minutes)

1. Save the new report somewhere, e.g. `~/Downloads/South_Central_Open_Job_Report_10-26-2026.xlsx`
2. From this folder, run:

   ```bash
   python scripts/job_report_cleaner.py ~/Downloads/South_Central_Open_Job_Report_10-26-2026.xlsx --json src/data/jobs.json
   ```

   This writes the website data to `src/data/jobs.json` and also saves a cleaned
   Excel copy next to the original report.
3. Optional: check it locally with `npm run dev` and open http://localhost:3000
4. Commit and push:

   ```bash
   git add src/data/jobs.json
   git commit -m "Jobs report 10/26/2026"
   git push
   ```

   Vercel rebuilds and deploys automatically.

## First-time setup

```bash
pip install pandas openpyxl     # for the Python script
npm install                     # for the site
npm run dev
```

On Vercel: import the GitHub repo, keep the defaults (framework: Next.js), deploy.

## How it fits together

```
scripts/job_report_cleaner.py   cleans the .xlsx -> src/data/jobs.json (+ cleaned .xlsx)
src/data/jobs.json              the only thing that changes each week
src/lib/types.ts                TypeScript shape of jobs.json
src/lib/filters.ts              filter state, URL <-> filters, filtering + sorting
src/lib/format.ts               dates, money, "A, B, and C"
src/app/page.tsx                imports the JSON, renders header/footer + board
src/components/JobBoard.tsx     owns filter state, keeps the URL in sync
src/components/CountyMap.tsx    clickable county tiles with job counts
src/components/FilterPanel.tsx  sidebar (desktop) / drawer (mobile) filters
src/components/JobRow.tsx       one job in the list
src/components/PrintList.tsx    compact table used when printing
```

## Ghost-job rules (in the Python script)

- Posted more than 90 days before the report date (change with `--max-age 60`)
- Older reposts of the same title + employer + town (newest copy is kept)
- Exact duplicate links

These are best guesses. The source report marks every job "Active," so nothing
confirms a job is filled.

## Common changes

- **A town shows up as "Unknown":** add it to `CITY_TO_COUNTY` in the Python script.
- **Add a county to the map:** add it to `MAP_COUNTIES` in `src/lib/filters.ts` and
  give it a grid position in `TILES` in `src/components/CountyMap.tsx`.
- **Change colors or fonts:** `src/app/globals.css` (the `@theme` block).
