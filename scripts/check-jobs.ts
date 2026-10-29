// Checks every listed job and writes src/data/job-status.json.
// Runs after each weekly upload, in GitHub Actions (.github/workflows/check-jobs.yml).
// You can also run it yourself:   npm run check-jobs
//                         or try:  npm run check-jobs -- --limit 50
//
// For each job:
//   1. Load its JobsEQ page. Gone, or "no longer available from the source"
//      -> closed. Otherwise grab the "Apply at Original Source" link.
//   2. Check that original posting:
//        LinkedIn -> LinkedIn's public job page
//        Indeed   -> skipped here (Indeed blocks this); `npm run check-indeed` on your PC
//        Others   -> the employer's page, looking for "expired"/"not found"
//                    wording or the job title itself

import { readFile, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";
import type { JobReport } from "../src/lib/types";
import {
  hostOf, linkedInGuestUrl, parseGeneric, parseJobsEq, parseLinkedIn, sourceOf,
  type Verdict,
} from "../src/lib/verify/checks";
import { daysBetween, toStatusJson, type JobCheck, type StatusFile } from "../src/lib/verify/status";

const DATA = path.join(import.meta.dirname, "..", "src", "data");
const USER_AGENT = "SOKYJobsLinkChecker/1.0 (+https://soky-jobs.vercel.app; checks whether job postings are still open)";
const TODAY = new Date().toISOString().slice(0, 10);

// How hard we're willing to hit each site: [requests at once, pause between requests in ms]
const PACE: Record<string, [number, number]> = {
  "jobseq.eqsuite.com": [3, 250],
  "linkedin.com": [1, 1500],
  default: [2, 500],
};
// Stop asking a site after this many refusals in a row - it's clearly blocking us
const GIVE_UP_AFTER = 8;
// Keep a definite answer from a previous check for this long if this run's check fails
const REUSE_DAYS = 10; // a bit over a week, since checks run weekly

// ---------------------------------------------------------------------------
// Polite fetching: per-site limits, pauses, and a "give up" switch
// ---------------------------------------------------------------------------

interface Gate { active: number; waiting: (() => void)[]; lastStart: number; refusals: number }
const gates = new Map<string, Gate>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Only used by the test script, to point real hostnames at local fake servers
const rewrites: Record<string, string> = process.env.CHECK_URL_REWRITE ? JSON.parse(process.env.CHECK_URL_REWRITE) : {};
function rewrite(url: string): string {
  for (const [from, to] of Object.entries(rewrites)) if (url.startsWith(from)) return to + url.slice(from.length);
  return url;
}

async function politeFetch(url: string): Promise<{ status: number; html: string } | null> {
  const host = hostOf(url);
  const [limit, basePause] = PACE[host] ?? PACE.default;
  const pause = basePause * Number(process.env.CHECK_PACE_SCALE ?? 1); // tests set this to 0
  const gate = gates.get(host) ?? { active: 0, waiting: [], lastStart: 0, refusals: 0 };
  gates.set(host, gate);
  if (gate.refusals >= GIVE_UP_AFTER) return { status: 429, html: "" };

  // Wait for a free slot for this site, then for the pause since the last request
  while (gate.active >= limit) await new Promise<void>((resolve) => gate.waiting.push(resolve));
  gate.active++;
  const wait = gate.lastStart + pause - Date.now();
  gate.lastStart = Date.now() + Math.max(0, wait);
  if (wait > 0) await sleep(wait);

  try {
    const res = await fetch(rewrite(url), {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml" },
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
    });
    const html = await res.text();
    gate.refusals = [403, 429, 999].includes(res.status) ? gate.refusals + 1 : 0;
    return { status: res.status, html };
  } catch {
    return null; // timeout or network error
  } finally {
    gate.active--;
    gate.waiting.shift()?.();
  }
}

// Run fn over items with at most `limit` running at once
async function eachLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]);
  });
  await Promise.all(workers);
}

// ---------------------------------------------------------------------------
// Checking one job
// ---------------------------------------------------------------------------

async function checkJob(job: JobReport["jobs"][number]): Promise<JobCheck> {
  const result = (v: Verdict, applyUrl: string | null): JobCheck => ({
    ...v,
    source: applyUrl ? hostOf(applyUrl) : "",
    applyUrl,
    checkedAt: TODAY,
  });

  // Step 1: JobsEQ. The ?lic=&uid= tracking part of the link isn't needed.
  const jobseqUrl = job.url.split("?")[0];
  const page = await politeFetch(jobseqUrl);
  if (!page) return result({ state: "unknown", reason: "error" }, null);
  const jobseq = parseJobsEq(page.status, page.html);
  if (jobseq.state === "closed" || !jobseq.applyUrl) return result(jobseq, null);
  const applyUrl = jobseq.applyUrl;

  // Step 2: the original posting
  const source = sourceOf(applyUrl);
  if (source === "indeed") return result({ state: "unknown", reason: "indeed" }, applyUrl);

  if (source === "linkedin") {
    const guest = linkedInGuestUrl(applyUrl);
    if (!guest) return result({ state: "unknown", reason: "unclear" }, applyUrl);
    const li = await politeFetch(guest);
    return result(li ? parseLinkedIn(li.status, li.html) : { state: "unknown", reason: "error" }, applyUrl);
  }

  const original = await politeFetch(applyUrl);
  return result(original ? parseGeneric(original.status, original.html, job.title) : { state: "unknown", reason: "error" }, applyUrl);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

async function main() {
  const limitFlag = process.argv.indexOf("--limit");
  const limit = limitFlag >= 0 ? Number(process.argv[limitFlag + 1]) : Infinity;

  const report = await readJson<JobReport>(path.join(DATA, "jobs.json"), { jobs: [] } as unknown as JobReport);
  const statusPath = path.join(DATA, "job-status.json");
  const previous = await readJson<StatusFile>(statusPath, { checkedAt: null, jobs: {} });

  const jobs = report.jobs.slice(0, limit);
  const next: StatusFile = { checkedAt: new Date().toISOString(), jobs: {} };
  let done = 0;
  const started = Date.now();

  await eachLimit(jobs, 8, async (job) => {
    const before = previous.jobs[job.id];
    // Closed stays closed - no need to ask again
    if (before?.state === "closed") {
      next.jobs[job.id] = before;
    } else {
      const now = await checkJob(job);
      // A failed check this time shouldn't erase a clear answer from earlier this week
      const failed = now.state === "unknown" && (now.reason === "blocked" || now.reason === "error");
      const recent = before && before.state !== "unknown" && daysBetween(before.checkedAt, TODAY) <= REUSE_DAYS;
      next.jobs[job.id] = failed && recent ? before : now;
    }
    if (++done % 100 === 0) console.log(`  ${done} / ${jobs.length} checked (${Math.round((Date.now() - started) / 1000)}s)`);
  });

  await writeFile(statusPath, toStatusJson(next));
  await printSummary(next, jobs.length, Date.now() - started);
}

async function printSummary(file: StatusFile, total: number, ms: number) {
  const checks = Object.values(file.jobs);
  const count = (fn: (c: JobCheck) => boolean) => checks.filter(fn).length;
  const bySource = (src: string) => (c: JobCheck) =>
    src === "other" ? !["linkedin.com", "indeed.com"].includes(c.source) && c.source !== "" : c.source === src;

  const rows = [
    ["All jobs", () => true],
    ["LinkedIn", bySource("linkedin.com")],
    ["Indeed", bySource("indeed.com")],
    ["Employer sites", bySource("other")],
    ["No apply link / JobsEQ only", (c: JobCheck) => c.source === ""],
  ] as const;

  const reasons = new Map<string, number>();
  for (const c of checks) reasons.set(c.reason, (reasons.get(c.reason) ?? 0) + 1);

  const lines = [
    `## Job link check: ${total.toLocaleString()} jobs in ${Math.round(ms / 60000)} min`,
    "",
    "| | Open | Closed (hidden) | Couldn't tell |",
    "|---|---:|---:|---:|",
    ...rows.map(([label, fn]) => {
      const f = fn as (c: JobCheck) => boolean;
      return `| ${label} | ${count((c) => f(c) && c.state === "open")} | ${count((c) => f(c) && c.state === "closed")} | ${count((c) => f(c) && c.state === "unknown")} |`;
    }),
    "",
    "**Reasons:** " + [...reasons].sort((a, b) => b[1] - a[1]).map(([r, n]) => `${r} ${n}`).join(", "),
    "",
    "Sites that stopped answering: " +
      ([...gates].filter(([, g]) => g.refusals >= GIVE_UP_AFTER).map(([h]) => h).join(", ") || "none"),
  ];
  console.log(lines.join("\n"));
  // In GitHub Actions this shows up as a table on the run's page
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, lines.join("\n") + "\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
