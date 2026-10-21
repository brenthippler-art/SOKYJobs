"use server";

// Server Actions: functions the admin page calls that run on the server.
// Each one checks the session itself - never trust that the page did it,
// because anyone can call these endpoints directly.

import { refresh } from "next/cache";
import { cleanReport, toJobsJson, ReportError, type CleanResult } from "@/lib/report/clean";
import { publishJobsJson, PublishError, githubConfigured } from "@/lib/github";
import { endSession, isSignedIn, passwordMatches, startSession } from "@/lib/session";
import { formatDate } from "@/lib/format";
import current from "@/data/jobs.json";

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // Vercel's request limit is 4.5 MB

// ---------------------------------------------------------------------------
// Sign in / out
// ---------------------------------------------------------------------------

export async function login(_prev: { error?: string }, formData: FormData): Promise<{ error?: string }> {
  const password = String(formData.get("password") ?? "");
  if (!passwordMatches(password)) {
    // Slow down anyone trying to guess passwords
    await new Promise((resolve) => setTimeout(resolve, 1000));
    return { error: "That password isn't right." };
  }
  await startSession();
  // We're already on /admin, so instead of redirecting, tell the browser to
  // re-render the page - this time the cookie is there and it shows the upload panel.
  refresh();
  return {};
}

export async function logout(): Promise<void> {
  await endSession();
  refresh();
}

// ---------------------------------------------------------------------------
// Upload helpers
// ---------------------------------------------------------------------------

async function readUpload(formData: FormData): Promise<CleanResult> {
  const file = formData.get("report");
  if (!(file instanceof File) || file.size === 0) throw new ReportError("Choose a report file first.");
  if (!file.name.toLowerCase().endsWith(".xlsx")) throw new ReportError("The report needs to be an .xlsx file.");
  if (file.size > MAX_UPLOAD_BYTES) throw new ReportError("That file is over 4 MB, which is too big to upload here.");
  return cleanReport(await file.arrayBuffer());
}

function errorMessage(err: unknown): string {
  if (err instanceof ReportError || err instanceof PublishError) return err.message;
  console.error(err); // shows up in Vercel's logs
  return "Something went wrong reading that file. Check that it's the JobsEQ export and try again.";
}

// ---------------------------------------------------------------------------
// Step 1: preview - clean the file and report what would change
// ---------------------------------------------------------------------------

export interface Preview {
  reportDate: string;
  total: number;
  open: number;
  newThisMonth: number;
  removed: { reason: string; count: number }[];
  topCounties: { county: string; count: number }[];
  unknownLocations: string[];
  warning: string | null;
}

export type PreviewResult = { ok: true; preview: Preview } | { ok: false; error: string };

export async function previewReport(formData: FormData): Promise<PreviewResult> {
  if (!(await isSignedIn())) return { ok: false, error: "Your sign-in expired. Reload the page and sign in again." };
  try {
    const { report, removed, unknownLocations } = await readUpload(formData);

    const reasons = new Map<string, number>();
    for (const job of removed) {
      const reason = job.reason.startsWith("Posted") ? "Posted more than 90 days ago" : job.reason;
      reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
    }
    const counties = new Map<string, number>();
    for (const job of report.jobs) counties.set(job.county, (counties.get(job.county) ?? 0) + 1);

    // Catch the easy mistake of uploading last week's file again
    let warning: string | null = null;
    if (report.reportDate < current.reportDate) {
      warning = `This report (${formatDate(report.reportDate, true)}) is older than the one on the site now (${formatDate(current.reportDate, true)}).`;
    } else if (report.reportDate === current.reportDate) {
      warning = `The site already shows a report dated ${formatDate(report.reportDate, true)}. Publishing will replace it.`;
    }

    return {
      ok: true,
      preview: {
        reportDate: report.reportDate,
        total: report.totalInReport,
        open: report.jobs.length,
        newThisMonth: report.jobs.filter((j) => j.freshness === "New").length,
        removed: [...reasons].map(([reason, count]) => ({ reason, count })),
        topCounties: [...counties]
          .map(([county, count]) => ({ county, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 5),
        unknownLocations,
        warning,
      },
    };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

// ---------------------------------------------------------------------------
// Step 2: publish - clean again (never trust data sent back from the browser)
// and commit jobs.json to GitHub, which triggers the Vercel redeploy
// ---------------------------------------------------------------------------

export type PublishResult = { ok: true; commitUrl: string; reportDate: string } | { ok: false; error: string };

export async function publishReport(formData: FormData): Promise<PublishResult> {
  if (!(await isSignedIn())) return { ok: false, error: "Your sign-in expired. Reload the page and sign in again." };
  if (!githubConfigured()) return { ok: false, error: "GITHUB_TOKEN and GITHUB_REPO aren't set on Vercel yet." };
  try {
    const { report } = await readUpload(formData);
    const date = formatDate(report.reportDate, true);
    const { commitUrl } = await publishJobsJson(
      toJobsJson(report),
      `Jobs report ${date}: ${report.jobs.length} open jobs (uploaded from /admin)`,
    );
    return { ok: true, commitUrl, reportDate: report.reportDate };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}
