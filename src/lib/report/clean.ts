// Turns the raw JobsEQ spreadsheet into clean jobs + a list of removed
// "likely filled" postings. This is a line-for-line port of the old Python
// script, so the rules (and results) are the same.
//
// It has no Next.js or browser dependencies, which is why the same code runs
// on Vercel (from the admin page) and on your laptop (npm run clean).

import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import type { Freshness, Job, JobReport } from "../types";
import {
  ACRONYMS, AGENCY_PATTERN, AGING_DAYS, CITY_COORDS, CITY_TO_COUNTY, CITY_TYPOS,
  DEFAULT_MAX_AGE, FRESH_DAYS, LOCATION_OVERRIDES, SOC_CATEGORIES, SOC_OVERRIDES,
} from "./rules";

export interface RemovedJob extends Job {
  reason: string;
}

export interface CleanResult {
  report: JobReport; // what the website uses
  removed: RemovedJob[]; // the "Likely filled" list
  originalLocations: Map<string, string>; // job id -> raw location text (for Excel)
  unknownLocations: string[]; // raw locations no rule could place
}

// A friendly error the admin page can show as-is
export class ReportError extends Error {}

const DAY_MS = 24 * 60 * 60 * 1000;
const REQUIRED_COLUMNS = ["Job Title", "Employer", "Reported Location", "Start", "Wage", "Occupation Name", "SOC", "Url"];

// =============================================================================
// 1. Reading the spreadsheet
// =============================================================================

// exceljs gives back strings, numbers, Dates, or objects for links/rich text.
// This flattens any of them to plain text.
function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    if ("text" in value && typeof value.text === "string") return value.text;
    if ("richText" in value) return value.richText.map((r) => r.text).join("");
    if ("hyperlink" in value) return String(value.hyperlink);
    if ("result" in value) return String(value.result ?? "");
    return "";
  }
  return String(value);
}

interface RawRow {
  title: string;
  employer: string;
  location: string;
  start: Date;
  wage: number;
  occupation: string;
  soc: string;
  url: string;
}

async function readWorkbook(data: ArrayBuffer): Promise<{ rows: RawRow[]; reportDate: Date }> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(data);
  } catch {
    throw new ReportError("That file couldn't be opened as an Excel (.xlsx) file.");
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new ReportError("The spreadsheet has no sheets.");

  // The header isn't on row 1 (row 1 is a title), so look for it.
  let headerRow = 0;
  sheet.eachRow((row, n) => {
    if (!headerRow && cellText(row.getCell(1).value).trim() === "Job Title") headerRow = n;
  });
  if (!headerRow) {
    throw new ReportError("Couldn't find the \"Job Title\" header. Is this the South Central open job report?");
  }

  // Map column names to column numbers, so column order doesn't matter
  const col: Record<string, number> = {};
  sheet.getRow(headerRow).eachCell((cell, n) => (col[cellText(cell.value).trim()] = n));
  const missing = REQUIRED_COLUMNS.filter((name) => !col[name]);
  if (missing.length) throw new ReportError(`The report is missing these columns: ${missing.join(", ")}.`);

  const rows: RawRow[] = [];
  let latestStart = 0;
  sheet.eachRow((row, n) => {
    if (n <= headerRow) return;
    const get = (name: string) => row.getCell(col[name]).value;
    const url = cellText(get("Url")).trim();
    const start = get("Start");
    // Footer rows ("Source: JobsEQ", "Exported on...") have no URL - skip them
    if (!url || !(start instanceof Date)) return;
    latestStart = Math.max(latestStart, start.getTime());
    rows.push({
      title: cellText(get("Job Title")),
      employer: cellText(get("Employer")),
      location: cellText(get("Reported Location")),
      start,
      wage: Number(cellText(get("Wage"))) || 0,
      occupation: cellText(get("Occupation Name")),
      soc: cellText(get("SOC")),
      url,
    });
  });
  if (!rows.length) throw new ReportError("The report doesn't contain any job rows.");

  // Title row says "...active as of 10/19/2026". Ages are measured from that
  // date, not from the day the file happens to be uploaded.
  const title = cellText(sheet.getRow(1).getCell(1).value);
  const m = title.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  const reportDate = m ? new Date(Date.UTC(+m[3], +m[1] - 1, +m[2])) : new Date(latestStart);

  return { rows, reportDate };
}

// =============================================================================
// 2. Cleaning helpers - one small function per messy column
// =============================================================================

export function fixText(text: string): string {
  return text
    .replaceAll("â\u0080\u0093", "–") // broken en dash
    .replaceAll(" â ", " – ")
    .replace(/\s+/g, " ")
    .trim();
}

// "CREW MEMBER - CDL A" -> "Crew Member - CDL A". Mixed-case titles are left alone.
export function tidyTitle(raw: string): string {
  const title = fixText(raw);
  const letters = [...title].filter((c) => /\p{L}/u.test(c));
  const upper = letters.filter((c) => c === c.toUpperCase() && c !== c.toLowerCase());
  if (!letters.length || upper.length / letters.length < 0.7) return title;
  return title
    .split(" ")
    .map((word) => {
      const core = word.replace(/[^A-Za-z]/g, "");
      if (ACRONYMS.has(core.toUpperCase())) return word;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

const titleCase = (s: string) => s.toLowerCase().replace(/(^|[^a-z])([a-z])/g, (_, a, b) => a + b.toUpperCase());

// Longest names first, so a longer town name wins over a shorter one inside it
const CITY_NAMES = [...Object.keys(CITY_TO_COUNTY), ...Object.keys(CITY_TYPOS)].sort((a, b) => b.length - a.length);
const CITY_REGEX = new RegExp(
  `\\b(${CITY_NAMES.map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`,
  "gi",
);

// Street names are often town names too: in "3075 Scottsville Rd, Bowling Green"
// the town is Bowling Green. So we always take the LAST town name in the text.
function lastCity(text: string): string | null {
  const matches = [...text.matchAll(CITY_REGEX)];
  if (!matches.length) return null;
  const name = titleCase(matches.at(-1)![1]);
  return CITY_TYPOS[name] ?? name;
}

function nearestCity(lat: number, lon: number): string {
  const distance = ([clat, clon]: [number, number]) =>
    Math.hypot(lat - clat, (lon - clon) * Math.cos((lat * Math.PI) / 180));
  let best = "";
  let bestDistance = Infinity;
  for (const [city, coords] of Object.entries(CITY_COORDS)) {
    const d = distance(coords);
    if (d < bestDistance) [best, bestDistance] = [city, d];
  }
  return best;
}

// Learn ZIP -> town from rows that list both (e.g. "Franklin, KY 42134")
function buildZipLookup(locations: string[]): Map<string, string> {
  const counts = new Map<string, Map<string, number>>();
  for (const text of locations) {
    const city = lastCity(text);
    const zip = text.match(/\b(4[0-2]\d{3})\b/)?.[1];
    if (!city || !zip) continue;
    if (!counts.has(zip)) counts.set(zip, new Map());
    const forZip = counts.get(zip)!;
    forZip.set(city, (forZip.get(city) ?? 0) + 1);
  }
  // If a ZIP appears with several towns, use the most common one
  const lookup = new Map<string, string>();
  for (const [zip, cities] of counts) {
    let best = "";
    let bestCount = -1;
    for (const [city, n] of cities) if (n > bestCount) [best, bestCount] = [city, n];
    lookup.set(zip, best);
  }
  return lookup;
}

// Any of the ~650 location spellings -> { city, county, zip }
function parseLocation(raw: string, zipLookup: Map<string, string>) {
  const text = raw.trim();
  const zip = text.match(/\b(4[0-2]\d{3})(?:-\d{4})?\b/)?.[1] ?? null; // KY ZIPs

  if (LOCATION_OVERRIDES[text]) {
    const [city, county] = LOCATION_OVERRIDES[text];
    return { city, county, zip };
  }
  const city = lastCity(text);
  if (city) return { city, county: CITY_TO_COUNTY[city], zip };

  const countyMatch = text.match(/(\w+) County/i); // "Hart County, Kentucky"
  if (countyMatch) return { city: "(County-wide)", county: titleCase(countyMatch[1]), zip };

  if (zip && zipLookup.has(zip)) {
    const zipCity = zipLookup.get(zip)!;
    return { city: zipCity, county: CITY_TO_COUNTY[zipCity], zip };
  }

  const coords = text.match(/^(-?\d+\.\d+),\s*(-?\d+\.\d+)$/); // "36.99, -86.42"
  if (coords) {
    const near = nearestCity(Number(coords[1]), Number(coords[2]));
    return { city: near, county: CITY_TO_COUNTY[near], zip };
  }

  return { city: "Unknown", county: "Unknown", zip };
}

function payRange(hourly: number | null): string {
  if (hourly === null) return "Not listed";
  if (hourly < 15) return "Under $15/hr";
  if (hourly < 20) return "$15-20/hr";
  if (hourly < 25) return "$20-25/hr";
  if (hourly < 35) return "$25-35/hr";
  return "$35+/hr";
}

// For duplicate matching: "CREW MEMBER *" == "Crew Member"
const titleKey = (title: string) => title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// Plain code-point comparison (same order Python and Excel use for A-Z sorting)
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

// =============================================================================
// 3. The pipeline
// =============================================================================

export async function cleanReport(data: ArrayBuffer, maxAge = DEFAULT_MAX_AGE): Promise<CleanResult> {
  const { rows, reportDate } = await readWorkbook(data);
  const zipLookup = buildZipLookup(rows.map((r) => r.location));
  const originalLocations = new Map<string, string>();

  // Build one clean Job per row
  const jobs: Job[] = rows.map((row) => {
    const { city, county, zip } = parseLocation(row.location, zipLookup);
    const annual = row.wage > 0 ? row.wage : null;
    const hourly = annual === null ? null : Math.round((annual / 2080) * 100) / 100; // 2080 = 40 hrs x 52 wks
    const daysOld = Math.round((reportDate.getTime() - row.start.getTime()) / DAY_MS);
    const freshness: Freshness = daysOld <= FRESH_DAYS ? "New" : daysOld <= AGING_DAYS ? "Recent" : "Aging";
    const employer = fixText(row.employer);
    const id = createHash("md5").update(row.url).digest("hex").slice(0, 10);
    originalLocations.set(id, row.location);
    return {
      id,
      title: tidyTitle(row.title),
      employer,
      city,
      county,
      zip,
      category: SOC_OVERRIDES[row.soc] ?? SOC_CATEGORIES[row.soc.slice(0, 2)] ?? "Other",
      occupation: row.occupation || null,
      annualPay: annual,
      hourlyPay: hourly,
      payRange: payRange(hourly),
      agency: AGENCY_PATTERN.test(row.employer),
      posted: row.start.toISOString().slice(0, 10),
      daysOld,
      freshness,
      url: row.url,
    };
  });

  // ---- Ghost-job rules. reasons[i] stays "" if job i is kept. ----
  const reasons = jobs.map(() => "");

  // Rule 1: exact same link listed twice
  const seenUrls = new Set<string>();
  jobs.forEach((job, i) => {
    if (seenUrls.has(job.url)) reasons[i] = "Exact duplicate listing";
    seenUrls.add(job.url);
  });

  // Rule 2: same title + employer + town posted more than once. Walk from
  // newest to oldest; the first one we meet is kept, later ones are reposts.
  const newestFirst = jobs.map((_, i) => i).sort((a, b) => jobs[a].daysOld - jobs[b].daysOld);
  const seenKeys = new Set<string>();
  for (const i of newestFirst) {
    const key = `${titleKey(jobs[i].title)}|${jobs[i].employer.toLowerCase()}|${jobs[i].city}`;
    if (seenKeys.has(key) && !reasons[i]) reasons[i] = "Older repost (newer copy kept)";
    seenKeys.add(key);
  }

  // Rule 3: too old. Most real openings fill within a couple of months.
  jobs.forEach((job, i) => {
    if (!reasons[i] && job.daysOld > maxAge) {
      reasons[i] = `Posted ${Math.round(job.daysOld / 30.4)} months ago`;
    }
  });

  const kept = jobs
    .filter((_, i) => !reasons[i])
    .sort(
      (a, b) =>
        compare(a.county, b.county) || compare(a.city, b.city) ||
        compare(a.category, b.category) || a.daysOld - b.daysOld,
    );
  const removed = jobs
    .map((job, i) => ({ ...job, reason: reasons[i] }))
    .filter((job) => job.reason)
    .sort((a, b) => a.daysOld - b.daysOld);

  const unknownLocations = [
    ...new Set(kept.filter((j) => j.county === "Unknown").map((j) => originalLocations.get(j.id)!)),
  ];

  return {
    report: {
      reportDate: reportDate.toISOString().slice(0, 10),
      totalInReport: jobs.length,
      removedCount: removed.length,
      jobs: kept,
    },
    removed,
    originalLocations,
    unknownLocations,
  };
}

// The jobs.json text that gets committed. One job per line, so each week's
// GitHub diff shows exactly which jobs were added and removed.
export function toJobsJson(report: JobReport): string {
  const { jobs, ...meta } = report;
  const head = JSON.stringify(meta).slice(0, -1); // drop the closing }
  return `${head},"jobs":[\n${jobs.map((j) => JSON.stringify(j)).join(",\n")}\n]}\n`;
}
