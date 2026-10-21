// POST /admin/excel  (body: form data with the report file)
// Returns the cleaned Excel workbook as a download. A Route Handler instead of
// a Server Action because it sends back a file, not data for the page.

import { cleanReport, ReportError } from "@/lib/report/clean";
import { buildCleanedWorkbook } from "@/lib/report/excel";
import { isSignedIn } from "@/lib/session";

export async function POST(request: Request) {
  if (!(await isSignedIn())) return new Response("Sign in first.", { status: 401 });

  const file = (await request.formData()).get("report");
  if (!(file instanceof File)) return new Response("No file uploaded.", { status: 400 });

  try {
    const result = await cleanReport(await file.arrayBuffer());
    const workbook = await buildCleanedWorkbook(result);
    const name = `South Central Open Jobs - Cleaned ${result.report.reportDate}.xlsx`;
    return new Response(new Uint8Array(workbook), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${name}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const message = err instanceof ReportError ? err.message : "Couldn't build the spreadsheet.";
    return new Response(message, { status: 400 });
  }
}
