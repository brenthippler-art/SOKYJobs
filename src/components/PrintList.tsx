import type { Job } from "@/lib/types";
import { formatDate, formatHourly } from "@/lib/format";

const PRINT_LIMIT = 200;

// Hidden on screen; when someone clicks "Print this list" the browser prints
// this compact table instead of the interactive page. Useful for clients who
// don't have a phone or internet access.
export default function PrintList({ jobs, heading, reportDate }: { jobs: Job[]; heading: string; reportDate: string }) {
  const shown = jobs.slice(0, PRINT_LIMIT);
  return (
    <div className="hidden print:block">
      <h1 className="text-xl font-bold">{heading}</h1>
      <p className="mb-3">
        South central Kentucky open jobs, from the report dated {formatDate(reportDate, true)}.
        {jobs.length > PRINT_LIMIT && ` First ${PRINT_LIMIT} shown.`}
      </p>
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b-2 border-black">
            <th className="py-1 pr-2">Job</th>
            <th className="py-1 pr-2">Employer</th>
            <th className="py-1 pr-2">Town</th>
            <th className="py-1 pr-2">Pay</th>
            <th className="py-1">Posted</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((job) => (
            <tr key={job.id} className="border-b border-gray-300 align-top break-inside-avoid">
              <td className="py-1 pr-2">{job.title}</td>
              <td className="py-1 pr-2">{job.employer}</td>
              <td className="py-1 pr-2">{job.city}</td>
              <td className="py-1 pr-2">{job.hourlyPay ? formatHourly(job.hourlyPay) : "-"}</td>
              <td className="py-1">{formatDate(job.posted)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
