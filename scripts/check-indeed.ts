// Checks the Indeed jobs from YOUR computer, in a real Chrome window.
//
// Indeed blocks automated requests from servers, so the weekly GitHub check
// skips them. This script opens each one in Chrome on your PC - the same as
// you clicking through them - and records which ones say "This job has
// expired on Indeed". Results go to src/data/indeed-status.json.
//
//   git pull                    # get this week's check results first
//   npm run check-indeed        # Chrome opens; leave it alone while it works
//   npm run check-indeed -- --limit 25   # try a few first
//
// If Indeed shows a "verify you're human" check, the script pauses. Finish
// the check in the Chrome window, then press Enter in the terminal. It never
// tries to get around the check itself.
//
// Takes about 5 seconds per job. You can stop any time with Ctrl+C; progress
// is saved, and the next run skips jobs checked in the last 3 days.

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import { chromium, type Page } from "playwright-core";
import type { JobReport } from "../src/lib/types";
import { indeedJobKey, parseIndeedText, type Verdict } from "../src/lib/verify/checks";
import { daysBetween, toStatusJson, type IndeedStatusFile, type StatusFile } from "../src/lib/verify/status";

const ROOT = path.join(import.meta.dirname, "..");
const DATA = path.join(ROOT, "src", "data");
const OUT = path.join(DATA, "indeed-status.json");
const TODAY = new Date().toISOString().slice(0, 10);
const PAUSE_MS = 3000; // between jobs - a person's pace, not a crawler's
const SKIP_IF_CHECKED_WITHIN_DAYS = 3;

const readJson = async <T>(file: string, fallback: T): Promise<T> => {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return fallback;
  }
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const terminal = readline.createInterface({ input: process.stdin, output: process.stdout });

async function readVerdict(page: Page): Promise<Verdict> {
  const text = await page.locator("body").innerText({ timeout: 10_000 }).catch(() => "");
  return parseIndeedText(text, await page.title());
}

async function main() {
  const limitFlag = process.argv.indexOf("--limit");
  const limit = limitFlag >= 0 ? Number(process.argv[limitFlag + 1]) : Infinity;

  const report = await readJson<JobReport>(path.join(DATA, "jobs.json"), { jobs: [] } as unknown as JobReport);
  const weekly = await readJson<StatusFile>(path.join(DATA, "job-status.json"), { checkedAt: null, jobs: {} });
  const saved = await readJson<IndeedStatusFile>(OUT, { checkedAt: null, jobs: {} });

  // Keep results only for jobs that are still on the board
  const listed = new Set(report.jobs.map((j) => j.id));
  const results: IndeedStatusFile = {
    checkedAt: saved.checkedAt,
    jobs: Object.fromEntries(Object.entries(saved.jobs).filter(([id]) => listed.has(id))),
  };

  // Jobs the weekly check handed off to us, minus ones we checked recently
  const targets = report.jobs
    .map((job) => ({ job, check: weekly.jobs[job.id] }))
    .filter(({ check }) => check?.reason === "indeed" && check.applyUrl && indeedJobKey(check.applyUrl))
    .filter(({ job }) => {
      const prev = results.jobs[job.id];
      return !prev || prev.state === "unknown" || daysBetween(prev.checkedAt, TODAY) > SKIP_IF_CHECKED_WITHIN_DAYS;
    })
    .slice(0, limit);

  if (!weekly.checkedAt) {
    console.log("No job-status.json yet. Run `git pull` after the weekly check has run at least once.");
    process.exit(1);
  }
  console.log(`${targets.length} Indeed jobs to check (about ${Math.ceil((targets.length * 5) / 60)} minutes).`);
  if (!targets.length) return;

  // A separate Chrome profile just for this script, kept in .indeed-profile/
  // (git-ignored). It uses the Chrome you already have installed.
  // If Chrome is installed somewhere unusual, set CHROME_PATH to its chrome.exe.
  const browser = await chromium.launchPersistentContext(path.join(ROOT, ".indeed-profile"), {
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: "chrome" }),
    headless: process.env.CHECK_HEADLESS === "1", // only the test script uses this
    viewport: { width: 1200, height: 900 },
  });
  const page = browser.pages()[0] ?? (await browser.newPage());

  const save = async () => {
    results.checkedAt = new Date().toISOString();
    await writeFile(OUT, toStatusJson(results));
  };
  // Ctrl+C: save what we have before quitting
  process.on("SIGINT", async () => {
    await save();
    console.log("\nStopped. Progress saved to src/data/indeed-status.json.");
    process.exit(0);
  });

  const tally = { open: 0, closed: 0, unknown: 0 };
  for (const [i, { job, check }] of targets.entries()) {
    const base = process.env.INDEED_BASE ?? "https://www.indeed.com"; // overridden only in tests
    const url = `${base}/viewjob?jk=${indeedJobKey(check!.applyUrl!)}`;
    let verdict: Verdict = { state: "unknown", reason: "error" };
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await sleep(1500); // let the page finish drawing
      verdict = await readVerdict(page);

      if (verdict.reason === "blocked") {
        const answer = await terminal.question(
          "\nIndeed wants to confirm you're human. Finish it in the Chrome window, then press Enter (or type q and Enter to stop): ",
        );
        if (answer.trim().toLowerCase() === "q") break;
        // Load the job again now that the check is done
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
        await sleep(1500);
        verdict = await readVerdict(page);
      }
    } catch {
      // timeout or navigation error - leave as unknown
    }

    results.jobs[job.id] = { ...verdict, checkedAt: TODAY };
    tally[verdict.state]++;
    console.log(`  ${i + 1}/${targets.length}  ${verdict.state.padEnd(7)}  ${job.title.slice(0, 60)}`);
    if ((i + 1) % 20 === 0) await save();
    await sleep(PAUSE_MS);
  }

  await save();
  await browser.close();
  terminal.close();
  console.log(`\nDone: ${tally.open} open, ${tally.closed} closed, ${tally.unknown} couldn't tell.`);
  console.log("Now publish the results:\n  git add src/data/indeed-status.json\n  git commit -m \"Indeed check\"\n  git push");
}

main().catch(async (err) => {
  console.error(err);
  process.exit(1);
});
