import { Suspense } from "react";
import JobBoard, { JobBoardFromUrl } from "@/components/JobBoard";
import { formatDate } from "@/lib/format";
import type { JobReport } from "@/lib/types";
// The weekly data file. Importing it here bakes it into the page at build
// time, so the site is fully static - no database, no API.
import data from "@/data/jobs.json";

const report = data as JobReport;

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
          <p>
            Hourly pay is estimated from yearly pay (40 hours a week). Always check the posting
            before applying.
          </p>
        </div>
      </footer>
    </>
  );
}
