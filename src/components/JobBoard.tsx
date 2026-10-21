"use client";

import { useDeferredValue, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import CountyMap from "./CountyMap";
import FilterPanel from "./FilterPanel";
import JobRow from "./JobRow";
import PrintList from "./PrintList";
import type { JobReport } from "@/lib/types";
import {
  DEFAULT_FILTERS,
  ELSEWHERE,
  type Filters,
  type SortKey,
  activeFilterCount,
  countBy,
  countyGroup,
  filtersFromParams,
  filtersToParams,
  matches,
  sortJobs,
} from "@/lib/filters";
import { joinWords } from "@/lib/format";

const PAGE_SIZE = 25;

// [] -> ""   ["Warren"] -> " in Warren County"
// ["Warren", "Barren"] -> " in Warren and Barren counties"
// ["Warren", "Elsewhere"] -> " in Warren County and other areas"
function describePlace(counties: string[]): string {
  if (counties.length === 0) return "";
  const named = counties.filter((c) => c !== ELSEWHERE);
  const parts: string[] = [];
  if (named.length) parts.push(`${joinWords(named)} ${named.length > 1 ? "counties" : "County"}`);
  if (counties.includes(ELSEWHERE)) parts.push("other areas");
  return ` in ${parts.join(" and ")}`;
}

// Reads the starting filters from the URL. Kept in its own component because
// useSearchParams() can't run during the static build - page.tsx wraps this
// in <Suspense> and shows the unfiltered board until the URL is known.
export function JobBoardFromUrl({ report }: { report: JobReport }) {
  const params = useSearchParams();
  return <JobBoard report={report} initialFilters={filtersFromParams(params)} syncUrl />;
}

interface Props {
  report: JobReport;
  initialFilters?: Filters;
  syncUrl?: boolean;
}

export default function JobBoard({ report, initialFilters = DEFAULT_FILTERS, syncUrl = false }: Props) {
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [copied, setCopied] = useState(false);
  const drawerRef = useRef<HTMLDialogElement>(null);

  // Typing in search updates `filters` right away (so the input feels instant),
  // while the list re-filters from this slightly delayed copy.
  const deferred = useDeferredValue(filters);

  // Every change goes through here: update state, reset paging, update URL.
  function update(patch: Partial<Filters>) {
    const next = { ...filters, ...patch };
    setFilters(next);
    setLimit(PAGE_SIZE);
    if (syncUrl) {
      const qs = filtersToParams(next);
      window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
    }
  }

  function toggleCounty(county: string) {
    const on = filters.counties.includes(county);
    update({ counties: on ? filters.counties.filter((c) => c !== county) : [...filters.counties, county] });
  }

  // useMemo: only recompute when the inputs change, not on every render
  const results = useMemo(
    () => sortJobs(report.jobs.filter((job) => matches(job, deferred)), deferred.sort),
    [report.jobs, deferred],
  );
  const countyCounts = useMemo(
    () => countBy(report.jobs.filter((job) => matches(job, deferred, "county")), (j) => countyGroup(j.county)),
    [report.jobs, deferred],
  );
  const categoryCounts = useMemo(
    () => countBy(report.jobs.filter((job) => matches(job, deferred, "category")), (j) => j.category),
    [report.jobs, deferred],
  );

  const activeCount = activeFilterCount(filters);
  const where = describePlace(filters.counties);

  async function copyLink() {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  return (
    <>
      <div className="print:hidden">
        {/* ---------- Hero: headline + county map ---------- */}
        <section className="mx-auto max-w-6xl px-4 sm:px-6 pt-8 pb-10 grid gap-8 lg:grid-cols-[1fr_26rem] lg:items-end">
          <div className="max-w-xl">
            <Image
              src="/map.png"
              alt="Map of Kentucky with the south central region highlighted"
              width={1200}
              height={530}
              priority
              className="mb-6 w-full max-w-[18rem] sm:max-w-sm h-auto"
            />
            <h1 className="font-display text-[2.6rem] sm:text-6xl font-bold leading-[0.95] tracking-tight">
              Find a job you can get to.
            </h1>
            <p className="mt-5 text-lg leading-relaxed">
              {report.jobs.length.toLocaleString()} openings across south central Kentucky, all
              posted in the last 90 days. Pick the counties you can reach, then narrow it down by
              type of work and pay.
            </p>
          </div>
          <div>
            <CountyMap counts={countyCounts} selected={filters.counties} onToggle={toggleCounty} />
            <p className="mt-3 text-sm text-muted">
              Tap one or more counties. Numbers show matching jobs in each.
            </p>
          </div>
        </section>

        {/* ---------- Search bar (sticks to the top while scrolling) ---------- */}
        <div className="sticky top-0 z-10 bg-ink text-white shadow-[0_1px_0_var(--color-ink)]">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 py-3 flex flex-wrap gap-2 sm:gap-3 items-center">
            <label className="flex-1 min-w-[12rem]">
              <span className="sr-only">Search job titles or employers</span>
              <input
                type="search"
                value={filters.q}
                onChange={(e) => update({ q: e.target.value })}
                placeholder="Search job titles or employers"
                className="w-full rounded-md bg-surface text-ink px-3.5 py-2.5 placeholder:text-muted"
              />
            </label>
            <label className="flex items-center gap-2">
              <span className="text-sm">Sort</span>
              <select
                value={filters.sort}
                onChange={(e) => update({ sort: e.target.value as SortKey })}
                className="rounded-md bg-surface text-ink px-2.5 py-2.5"
              >
                <option value="newest">Newest</option>
                <option value="pay">Highest pay</option>
                <option value="employer">Employer A–Z</option>
              </select>
            </label>
            <button
              type="button"
              onClick={() => drawerRef.current?.showModal()}
              className="lg:hidden rounded-md bg-gold text-ink font-bold px-4 py-2.5"
            >
              Filters{activeCount > 0 && ` (${activeCount})`}
            </button>
          </div>
        </div>

        {/* ---------- Sidebar + results ---------- */}
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-8 grid gap-10 lg:grid-cols-[15rem_1fr]">
          <aside className="hidden lg:block" aria-label="Filters">
            <FilterPanel filters={filters} categoryCounts={categoryCounts} onChange={update} />
          </aside>

          <main id="results">
            <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-3 border-b-2 border-ink pb-3">
              <h2 className="font-display text-2xl font-bold" aria-live="polite">
                {results.length.toLocaleString()} {results.length === 1 ? "job" : "jobs"}
                {where}
              </h2>
              <div className="flex flex-wrap gap-x-5 gap-y-2 text-field font-bold">
                {activeCount > 0 && (
                  <button type="button" onClick={() => update({ ...DEFAULT_FILTERS, sort: filters.sort })} className="underline underline-offset-4">
                    Clear filters
                  </button>
                )}
                {syncUrl && (
                  <button type="button" onClick={copyLink} className="underline underline-offset-4">
                    {copied ? "Link copied" : "Copy link to this list"}
                  </button>
                )}
                <button type="button" onClick={() => window.print()} className="underline underline-offset-4">
                  Print this list
                </button>
              </div>
            </div>

            {results.length === 0 ? (
              <div className="py-12 max-w-md">
                <p className="font-display text-xl font-semibold">No jobs match all of these filters.</p>
                <p className="mt-2 text-muted">
                  Try another county, remove a job type, or lower the pay minimum.
                </p>
                <button
                  type="button"
                  onClick={() => update({ ...DEFAULT_FILTERS, sort: filters.sort })}
                  className="mt-4 rounded-md bg-field text-white font-bold px-4 py-2.5 hover:bg-field-dark"
                >
                  Clear filters
                </button>
              </div>
            ) : (
              <>
                <ul className="divide-y divide-line">
                  {results.slice(0, limit).map((job) => (
                    <JobRow key={job.id} job={job} />
                  ))}
                </ul>
                {limit < results.length && (
                  <div className="pt-6 border-t border-line flex flex-wrap items-center gap-4">
                    <button
                      type="button"
                      onClick={() => setLimit((n) => n + PAGE_SIZE)}
                      className="rounded-md bg-field text-white font-bold px-5 py-3 hover:bg-field-dark"
                    >
                      Show {Math.min(PAGE_SIZE, results.length - limit)} more
                    </button>
                    <span className="text-muted">
                      Showing {limit} of {results.length.toLocaleString()}
                    </span>
                  </div>
                )}
              </>
            )}
          </main>
        </div>
      </div>

      {/* ---------- Mobile filter drawer (native <dialog> handles focus + Esc) ---------- */}
      <dialog
        ref={drawerRef}
        aria-label="Filters"
        className="m-0 ml-auto h-full max-h-none w-[min(22rem,90vw)] bg-paper text-ink p-0"
        onClick={(e) => e.target === drawerRef.current && drawerRef.current?.close()}
      >
        <div className="flex flex-col h-full">
          <div className="flex items-center justify-between px-5 py-4 border-b border-line">
            <h2 className="font-display text-xl font-bold">Filters</h2>
            <button type="button" onClick={() => drawerRef.current?.close()} className="text-field font-bold underline underline-offset-4">
              Close
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-6">
            <FilterPanel filters={filters} categoryCounts={categoryCounts} onChange={update} />
          </div>
          <div className="px-5 py-4 border-t border-line">
            <button
              type="button"
              onClick={() => drawerRef.current?.close()}
              className="w-full rounded-md bg-field text-white font-bold px-4 py-3"
            >
              Show {results.length.toLocaleString()} jobs
            </button>
          </div>
        </div>
      </dialog>

      <PrintList jobs={results} heading={`${results.length} jobs${where}`} reportDate={report.reportDate} />
    </>
  );
}
