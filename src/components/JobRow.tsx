import type { Job } from "@/lib/types";
import { formatAnnual, formatDate, formatHourly } from "@/lib/format";

// One job in the list. No client-side state, so no "use client" needed;
// it simply renders inside the client JobBoard.
export default function JobRow({ job }: { job: Job }) {
  const place = job.city === "(County-wide)" ? `${job.county} County` : `${job.city}, ${job.county} County`;

  return (
    <li className="py-5 grid gap-x-6 gap-y-2 sm:grid-cols-[1fr_auto]">
      <div className="min-w-0">
        <h3 className="font-display text-xl font-semibold leading-snug">
          <a
            href={job.url}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:underline underline-offset-4 decoration-2 decoration-field"
          >
            {job.title}
            <span className="sr-only"> (opens the job posting in a new tab)</span>
          </a>
        </h3>
        <p className="mt-1 font-bold">{job.employer}</p>
        <p className="text-muted">{place}</p>
        <p className="mt-2 flex flex-wrap gap-2 text-sm">
          <span className="rounded-full border border-line px-2.5 py-0.5">{job.category}</span>
          {job.agency && (
            <span className="rounded-full border border-line px-2.5 py-0.5">Staffing agency</span>
          )}
        </p>
      </div>

      <div className="flex sm:flex-col sm:items-end justify-between items-baseline gap-1 sm:text-right">
        {job.hourlyPay !== null && job.annualPay !== null ? (
          <p>
            <span className="font-display text-lg font-bold">{formatHourly(job.hourlyPay)}</span>
            <span className="block text-sm text-muted">{formatAnnual(job.annualPay)}</span>
          </p>
        ) : (
          <p className="text-muted">Pay not listed</p>
        )}
        <p className="text-sm flex items-center gap-2">
          {job.freshness === "New" && (
            <span className="rounded-sm bg-gold-soft px-1.5 py-0.5 font-bold text-ink">New</span>
          )}
          <span className="text-muted">Posted {formatDate(job.posted)}</span>
        </p>
      </div>
    </li>
  );
}
