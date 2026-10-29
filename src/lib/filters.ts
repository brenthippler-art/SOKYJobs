import type { Job } from "./types";

// Everything the visitor can filter by. This object is the single source of
// truth: the UI reads it, and it's mirrored into the URL so a filtered view
// can be shared as a link.
export interface Filters {
  q: string;
  counties: string[];
  categories: string[];
  postedWithin: 30 | 60 | null; // null = any time in the list
  payListed: boolean;
  minHourly: number | null;
  hideAgencies: boolean;
  confirmedOnly: boolean; // only jobs the link checker confirmed open
  sort: SortKey;
}

export type SortKey = "newest" | "pay" | "employer";

export const DEFAULT_FILTERS: Filters = {
  q: "",
  counties: [],
  categories: [],
  postedWithin: null,
  payListed: false,
  minHourly: null,
  hideAgencies: false,
  confirmedOnly: false,
  sort: "newest",
};

// Counties drawn on the map. Anything else falls under "Elsewhere".
export const MAP_COUNTIES = [
  "Ohio", "Grayson", "Butler", "Edmonson", "Hart", "Logan", "Warren",
  "Barren", "Metcalfe", "Adair", "Simpson", "Allen", "Monroe",
];
export const ELSEWHERE = "Elsewhere";

export function countyGroup(county: string): string {
  return MAP_COUNTIES.includes(county) ? county : ELSEWHERE;
}

// ---------------------------------------------------------------------------
// URL <-> Filters
// e.g. ?county=Warren,Barren&type=Food%20Service&posted=30&sort=pay
// ---------------------------------------------------------------------------

const list = (value: string | null) => (value ? value.split(",").filter(Boolean) : []);

export function filtersFromParams(params: URLSearchParams): Filters {
  const posted = Number(params.get("posted"));
  const min = Number(params.get("min"));
  const sort = params.get("sort");
  return {
    q: params.get("q") ?? "",
    counties: list(params.get("county")),
    categories: list(params.get("type")),
    postedWithin: posted === 30 || posted === 60 ? posted : null,
    payListed: params.get("pay") === "listed",
    minHourly: min > 0 ? min : null,
    hideAgencies: params.get("agencies") === "hide",
    confirmedOnly: params.get("confirmed") === "1",
    sort: sort === "pay" || sort === "employer" ? sort : "newest",
  };
}

export function filtersToParams(f: Filters): string {
  const p = new URLSearchParams();
  if (f.q) p.set("q", f.q);
  if (f.counties.length) p.set("county", f.counties.join(","));
  if (f.categories.length) p.set("type", f.categories.join(","));
  if (f.postedWithin) p.set("posted", String(f.postedWithin));
  if (f.payListed) p.set("pay", "listed");
  if (f.minHourly) p.set("min", String(f.minHourly));
  if (f.hideAgencies) p.set("agencies", "hide");
  if (f.confirmedOnly) p.set("confirmed", "1");
  if (f.sort !== "newest") p.set("sort", f.sort);
  return p.toString();
}

// ---------------------------------------------------------------------------
// Filtering and sorting
// ---------------------------------------------------------------------------

// `skip` lets the county map ask "how many jobs match everything EXCEPT the
// county filter?" so each tile can show its own count.
export function matches(job: Job, f: Filters, skip?: "county" | "category"): boolean {
  if (skip !== "county" && f.counties.length && !f.counties.includes(countyGroup(job.county))) {
    return false;
  }
  if (skip !== "category" && f.categories.length && !f.categories.includes(job.category)) {
    return false;
  }
  if (f.postedWithin && job.daysOld > f.postedWithin) return false;
  if (f.payListed && job.hourlyPay === null) return false;
  if (f.minHourly && (job.hourlyPay === null || job.hourlyPay < f.minHourly)) return false;
  if (f.hideAgencies && job.agency) return false;
  if (f.confirmedOnly && !job.checkedOpenOn) return false;
  if (f.q) {
    const haystack = `${job.title} ${job.employer} ${job.occupation ?? ""}`.toLowerCase();
    // every word typed must appear somewhere: "cdl driver" finds "Driver - CDL A"
    const words = f.q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.every((w) => haystack.includes(w))) return false;
  }
  return true;
}

export function sortJobs(jobs: Job[], sort: SortKey): Job[] {
  const copy = [...jobs]; // never sort the original array in place
  if (sort === "pay") {
    // jobs without pay go to the bottom
    copy.sort((a, b) => (b.hourlyPay ?? -1) - (a.hourlyPay ?? -1));
  } else if (sort === "employer") {
    copy.sort((a, b) => a.employer.localeCompare(b.employer));
  } else {
    copy.sort((a, b) => a.daysOld - b.daysOld);
  }
  return copy;
}

export function countBy<T extends string>(jobs: Job[], key: (job: Job) => T): Map<T, number> {
  const counts = new Map<T, number>();
  for (const job of jobs) counts.set(key(job), (counts.get(key(job)) ?? 0) + 1);
  return counts;
}

export function activeFilterCount(f: Filters): number {
  return (
    f.counties.length +
    f.categories.length +
    (f.postedWithin ? 1 : 0) +
    (f.payListed ? 1 : 0) +
    (f.minHourly ? 1 : 0) +
    (f.hideAgencies ? 1 : 0) +
    (f.confirmedOnly ? 1 : 0) +
    (f.q ? 1 : 0)
  );
}
