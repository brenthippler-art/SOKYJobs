import { Suspense } from "react";
import JobBoard, { JobBoardFromUrl } from "@/components/JobBoard";
import { formatDate } from "@/lib/format";
import type { JobReport } from "@/lib/types";
import { applyChecks, type IndeedStatusFile, type StatusFile } from "@/lib/verify/status";
// The data files. Importing them here bakes them into the page at build
// time, so the site is fully static - no database, no API.
import data from "@/data/jobs.json"; // weekly report (from /admin)
import weeklyChecks from "@/data/job-status.json"; // weekly link check (GitHub Actions)
import indeedChecks from "@/data/indeed-status.json"; // Indeed check (npm run check-indeed)

const fullReport = data as JobReport;
const checks = applyChecks(fullReport.jobs, weeklyChecks as StatusFile, indeedChecks as IndeedStatusFile);
// The board only ever sees jobs that aren't known to be closed
const report: JobReport = { ...fullReport, jobs: checks.jobs };

export default function Home() {
  const updated = formatDate(report.reportDate, true);

  return (
    <>
      <header className="border-b border-line print:hidden">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-4 flex flex-wrap items-center justify-between gap-2">
          <p className="font-display text-lg font-bold tracking-tight">South Central KY Jobs</p>
          <p className="text-sm text-muted">Updated {updated}</p>
        </div>
      </header>

      {/*
        The fallback is the same board with no filters. Visitors see real jobs
        immediately; if the URL has filters (?county=Warren) they apply as soon
        as the browser reads it.
      */}
      <Suspense fallback={<JobBoard report={report} />}>
        <JobBoardFromUrl report={report} />
      </Suspense>

      <footer className="border-t border-line mt-8 print:hidden">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-8 text-sm text-muted max-w-prose space-y-2">
          <p>
            Listings come from the weekly South Central open job report, dated {updated}. That
            report had {report.totalInReport.toLocaleString()} postings. We left out{" "}
            {report.removedCount.toLocaleString()} that were more than 90 days old or were repeat
            postings of the same job, since those are usually already filled.
          </p>
          {checks.checkedAt && (
            <p>
              Each week, when the new report comes in, we check every job&apos;s original
              posting. The last check, on{" "}
              {formatDate(checks.checkedAt.slice(0, 10), true)}, found{" "}
              {checks.closedCount.toLocaleString()} more that had closed, so they&apos;re hidden too.
              Jobs marked &quot;Confirmed open&quot; were still taking applications when checked.
            </p>
          )}
          <p>
            Hourly pay is estimated from yearly pay (40 hours a week). Always check the posting
            before applying.
          </p>
        </div>
      </footer>
    </>
  );
}
