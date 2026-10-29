// The two status files the checkers write, and how the site combines them.
//
//   src/data/job-status.json     written by GitHub Actions after each weekly upload
//   src/data/indeed-status.json  written by `npm run check-indeed` on your PC
//
// They're separate files so the weekly job and your PC never edit the same
// file - no merge conflicts when you push.

import type { CheckReason, CheckState } from "./checks";

export interface JobCheck {
  state: CheckState;
  reason: CheckReason;
  source: string; // host of the original posting, e.g. "linkedin.com"
  applyUrl: string | null; // where JobsEQ's "Apply at Original Source" points
  checkedAt: string; // "2026-10-29"
}

export interface StatusFile {
  checkedAt: string | null;
  jobs: Record<string, JobCheck>;
}

export interface IndeedCheck {
  state: CheckState;
  reason: CheckReason;
  checkedAt: string;
}

export interface IndeedStatusFile {
  checkedAt: string | null;
  jobs: Record<string, IndeedCheck>;
}

// Indeed results older than this are ignored, so a job that closed after
// your last PC check doesn't keep a stale "checked open" badge forever.
const INDEED_MAX_AGE_DAYS = 10;

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

// An Indeed "open" result older than this is ignored, so a job that closed
// after your last PC check doesn't keep a stale "Confirmed open" badge.
// (An Indeed "closed" result never expires - expired jobs don't come back.)
export function combine(
  id: string,
  weekly: StatusFile,
  indeed: IndeedStatusFile,
  today: string,
): { state: CheckState; checkedAt: string | null } {
  const check = weekly.jobs[id];
  if (!check) return { state: "unknown", checkedAt: null };
  // Indeed jobs: a check from your PC overrides the age rule, so a job you
  // confirmed open stays listed even if it's over a month old.
  if (check.reason === "indeed" || check.reason === "indeed-old") {
    const pc = indeed.jobs[id];
    const stillFresh = pc && daysBetween(pc.checkedAt, today) <= INDEED_MAX_AGE_DAYS;
    if (pc && (pc.state === "closed" || (pc.state === "open" && stillFresh))) {
      return { state: pc.state, checkedAt: pc.checkedAt };
    }
  }
  return { state: check.state, checkedAt: check.checkedAt };
}

// What the site shows: closed jobs removed, confirmed-open jobs marked.
// "Today" is the date of the weekly check (not the clock), so the page
// can be built ahead of time without depending on when the build runs.
export function applyChecks<J extends { id: string; checkedOpenOn?: string }>(
  jobs: J[],
  weekly: StatusFile,
  indeed: IndeedStatusFile,
): { jobs: J[]; closedCount: number; checkedAt: string | null } {
  const today = weekly.checkedAt?.slice(0, 10) ?? "";
  const visible: J[] = [];
  let closedCount = 0;
  for (const job of jobs) {
    const { state, checkedAt } = combine(job.id, weekly, indeed, today);
    if (state === "closed") closedCount++;
    else visible.push(state === "open" && checkedAt ? { ...job, checkedOpenOn: checkedAt } : job);
  }
  return { jobs: visible, closedCount, checkedAt: weekly.checkedAt };
}

// One job per line, so each week's git diff shows exactly what changed.
export function toStatusJson(file: StatusFile | IndeedStatusFile): string {
  const entries = Object.entries(file.jobs).sort(([a], [b]) => (a < b ? -1 : 1));
  const lines = entries.map(([id, check]) => `${JSON.stringify(id)}:${JSON.stringify(check)}`);
  return `{"checkedAt":${JSON.stringify(file.checkedAt)},"jobs":{\n${lines.join(",\n")}\n}}\n`;
}
