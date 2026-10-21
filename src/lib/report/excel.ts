// Builds the cleaned Excel workbook your wife uses (same four tabs the Python
// script made). Used by the admin page's "Download cleaned Excel" button and
// by `npm run clean`.

import ExcelJS from "exceljs";
import type { CleanResult, RemovedJob } from "./clean";
import type { Job } from "../types";

const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3A5F" } };
const FRESH_FILLS: Record<string, string> = { New: "FFD9F2E3", Recent: "FFFFF4CC", Aging: "FFFBE3D6" };

const COLUMNS: { header: string; width: number; value: (j: Job, original: string) => ExcelJS.CellValue; format?: string }[] = [
  { header: "Job Title", width: 45, value: (j) => j.title },
  { header: "Employer", width: 30, value: (j) => j.employer },
  { header: "City", width: 16, value: (j) => j.city },
  { header: "County", width: 11, value: (j) => j.county },
  { header: "ZIP", width: 7, value: (j) => j.zip ?? "" },
  { header: "Category", width: 24, value: (j) => j.category },
  { header: "Occupation", width: 32, value: (j) => j.occupation ?? "" },
  { header: "Annual Pay", width: 12, value: (j) => j.annualPay, format: '"$"#,##0' },
  { header: "Est. Hourly", width: 11, value: (j) => j.hourlyPay, format: '"$"0.00' },
  { header: "Pay Range", width: 13, value: (j) => j.payRange },
  { header: "Agency?", width: 20, value: (j) => (j.agency ? "Staffing/Travel agency" : "") },
  // Dates stored at UTC midnight display as the right day in Excel
  { header: "Posted", width: 11, value: (j) => new Date(`${j.posted}T00:00:00Z`), format: "mm/dd/yyyy" },
  { header: "Days Old", width: 9, value: (j) => j.daysOld },
  { header: "Freshness", width: 10, value: (j) => j.freshness },
  { header: "Link", width: 10, value: (j) => ({ text: "Open", hyperlink: j.url }) },
  { header: "Original Location", width: 30, value: (_, original) => original },
];

function addJobSheet(wb: ExcelJS.Workbook, name: string, jobs: (Job | RemovedJob)[], original: Map<string, string>, withReason: boolean) {
  const ws = wb.addWorksheet(name, { views: [{ state: "frozen", xSplit: 1, ySplit: 1 }] });
  const cols = withReason
    ? [...COLUMNS, { header: "Why Removed", width: 30, value: (j: Job) => (j as RemovedJob).reason }]
    : COLUMNS;

  ws.columns = cols.map((c) => ({ header: c.header, width: c.width, style: c.format ? { numFmt: c.format } : {} }));
  ws.getRow(1).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = HEADER_FILL;
  });

  for (const job of jobs) {
    const row = ws.addRow(cols.map((c) => c.value(job, original.get(job.id) ?? "")));
    row.getCell(15).font = { color: { argb: "FF0563C1" }, underline: true };
    const fill = FRESH_FILLS[job.freshness];
    if (fill) row.getCell(14).fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
  }
  // Filter/sort dropdowns on every column
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
}

function addSummary(wb: ExcelJS.Workbook, jobs: Job[]) {
  const ws = wb.addWorksheet("Summary", { views: [{ state: "frozen", xSplit: 1, ySplit: 3 }] });
  ws.addRow(["Open jobs by county and category"]).font = { bold: true, size: 14 };
  ws.addRow([]);

  const categories = [...new Set(jobs.map((j) => j.category))].sort();
  const counties = new Map<string, Map<string, number>>();
  for (const j of jobs) {
    if (!counties.has(j.county)) counties.set(j.county, new Map());
    const m = counties.get(j.county)!;
    m.set(j.category, (m.get(j.category) ?? 0) + 1);
  }
  const header = ws.addRow(["County", ...categories, "Total"]);
  header.height = 45;
  header.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = HEADER_FILL;
    cell.alignment = { wrapText: true, vertical: "top" };
  });

  const rows = [...counties.entries()]
    .map(([county, m]) => [county, ...categories.map((c) => m.get(c) ?? 0)] as [string, ...number[]])
    .map((r) => [...r, (r.slice(1) as number[]).reduce((a, b) => a + b, 0)] as (string | number)[])
    .sort((a, b) => (b.at(-1) as number) - (a.at(-1) as number));
  rows.forEach((r) => ws.addRow(r));
  ws.addRow(["Total", ...categories.map((c) => jobs.filter((j) => j.category === c).length), jobs.length]).font = { bold: true };

  ws.getColumn(1).width = 14;
  for (let i = 2; i <= categories.length + 2; i++) ws.getColumn(i).width = 11;
}

function addInstructions(wb: ExcelJS.Workbook, result: CleanResult) {
  const { report, removed } = result;
  const ws = wb.addWorksheet("How To Use");
  ws.getColumn(1).width = 110;

  const reasonCounts = new Map<string, number>();
  for (const r of removed) {
    const reason = r.reason.startsWith("Posted") ? "Posted more than 90 days ago" : r.reason;
    reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
  }
  const date = new Date(`${report.reportDate}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "long", day: "numeric", year: "numeric", timeZone: "UTC",
  });

  const lines: [string, boolean][] = [
    ["South Central KY Open Jobs - Cleaned", true],
    [`Source report dated ${date}`, false],
    ["", false],
    [`${report.totalInReport.toLocaleString()} postings in the original report`, false],
    [`${report.jobs.length.toLocaleString()} kept on the 'Open Jobs' tab`, true],
    [`${removed.length.toLocaleString()} moved to the 'Likely Filled' tab:`, false],
    ...[...reasonCounts].map(([reason, n]): [string, boolean] => [`     ${n.toLocaleString()}  ${reason}`, false]),
    ["", false],
    ["HOW TO USE", true],
    ["- Every column header on 'Open Jobs' has a dropdown arrow. Click it to filter or sort.", false],
    ["- Filter County or City to find jobs close to someone. Filter Category to match their experience.", false],
    ["- Freshness: New = posted in the last 30 days (green), Recent = 31-60 days (yellow), Aging = 61-90 days (orange).", false],
    ["- 'Open' in the Link column goes to the original posting.", false],
    ["- Pay: most postings don't list pay. 'Est. Hourly' is annual pay / 2080 hours.", false],
    ["- Agency?: staffing or travel agencies. Local temp agencies can be a good first step.", false],
    ["", false],
    ["NOTE", true],
    ["'Likely Filled' is a best guess based on age and reposts. The job report itself marks everything 'Active',", false],
    ["so nothing here confirms a job is filled. Check the link before referring someone.", false],
  ];
  lines.forEach(([text, bold], i) => {
    ws.addRow([text]).font = { bold, size: i === 0 ? 14 : 11 };
  });
}

export async function buildCleanedWorkbook(result: CleanResult): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  addInstructions(wb, result);
  addJobSheet(wb, "Open Jobs", result.report.jobs, result.originalLocations, false);
  addSummary(wb, result.report.jobs);
  addJobSheet(wb, "Likely Filled", result.removed, result.originalLocations, true);
  wb.views = [{ x: 0, y: 0, width: 20000, height: 12000, firstSheet: 0, activeTab: 1, visibility: "visible" }];
  return Buffer.from(await wb.xlsx.writeBuffer());
}
