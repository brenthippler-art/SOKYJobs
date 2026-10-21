// Clean a report on your own computer (the by-hand option).
//
//   npm run clean -- ~/Downloads/South_Central_Open_Job_Report_10-26-2026.xlsx
//   npm run clean -- report.xlsx --max-age 60
//
// Writes src/data/jobs.json and saves "<report> - Cleaned.xlsx" next to the
// original. Same code the /admin upload page runs.

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { cleanReport, toJobsJson, ReportError } from "../src/lib/report/clean";
import { buildCleanedWorkbook } from "../src/lib/report/excel";

async function main() {
  const args = process.argv.slice(2);
  const input = args.find((a) => !a.startsWith("--"));
  const maxAgeFlag = args.indexOf("--max-age");
  const maxAge = maxAgeFlag >= 0 ? Number(args[maxAgeFlag + 1]) : undefined;
  if (!input) {
    console.error("Usage: npm run clean -- <report.xlsx> [--max-age 90]");
    process.exit(1);
  }

  const file = await readFile(input);
  // Buffer -> ArrayBuffer (exactly the bytes of the file)
  const data = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer;
  const result = await cleanReport(data, maxAge);
  const { report, removed, unknownLocations } = result;

  const jsonPath = path.join(import.meta.dirname, "..", "src", "data", "jobs.json");
  await writeFile(jsonPath, toJobsJson(report));

  const parsed = path.parse(input);
  const excelPath = path.join(parsed.dir, `${parsed.name} - Cleaned.xlsx`);
  await writeFile(excelPath, await buildCleanedWorkbook(result));

  console.log(`Report date: ${report.reportDate}`);
  console.log(`${report.totalInReport.toLocaleString()} postings -> ${report.jobs.length.toLocaleString()} open, ${removed.length.toLocaleString()} likely filled`);
  if (unknownLocations.length) {
    console.log(`Locations not recognized (add to CITY_TO_COUNTY in src/lib/report/rules.ts):\n  ${unknownLocations.join("\n  ")}`);
  }
  console.log(`Saved: ${path.relative(process.cwd(), jsonPath)}`);
  console.log(`Saved: ${excelPath}`);
}

main().catch((err) => {
  console.error(err instanceof ReportError ? err.message : err);
  process.exit(1);
});
