// The shape of src/data/jobs.json, written by scripts/job_report_cleaner.py.
// If you add a field in the Python script, add it here too.

export type Freshness = "New" | "Recent" | "Aging";

export interface Job {
  id: string;
  title: string;
  employer: string;
  city: string;
  county: string;
  zip: string | null;
  category: string;
  occupation: string | null;
  annualPay: number | null;
  hourlyPay: number | null;
  payRange: string;
  agency: boolean;
  posted: string; // "2026-09-24"
  daysOld: number; // days between posting and the report date
  freshness: Freshness;
  url: string;
  // Set by the link checker when the original posting was confirmed open
  // ("2026-10-29"). Missing = not confirmed either way.
  checkedOpenOn?: string;
}

export interface JobReport {
  reportDate: string;
  totalInReport: number;
  removedCount: number;
  jobs: Job[];
}
