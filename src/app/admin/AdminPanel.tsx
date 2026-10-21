"use client";

import { useRef, useState, useTransition } from "react";
import { previewReport, publishReport, type Preview } from "./actions";
import { formatDate } from "@/lib/format";

// The upload flow is a small state machine:
//   pick a file -> "checking" -> "ready" (preview shown) -> "publishing" -> "published"
// Any step can land on an error message instead.
type Stage = "empty" | "checking" | "ready" | "publishing" | "published";

export default function AdminPanel({ githubReady }: { githubReady: boolean }) {
  const [stage, setStage] = useState<Stage>("empty");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [commitUrl, setCommitUrl] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  // Server actions take FormData, the same thing a <form> submits
  const asFormData = (f: File) => {
    const data = new FormData();
    data.append("report", f);
    return data;
  };

  function choose(f: File | undefined) {
    if (!f) return;
    setFile(f);
    setError(null);
    setPreview(null);
    setStage("checking");
    startTransition(async () => {
      const result = await previewReport(asFormData(f));
      if (result.ok) {
        setPreview(result.preview);
        setStage("ready");
      } else {
        setError(result.error);
        setStage("empty");
      }
    });
  }

  function publish() {
    if (!file) return;
    setError(null);
    setStage("publishing");
    startTransition(async () => {
      const result = await publishReport(asFormData(file));
      if (result.ok) {
        setCommitUrl(result.commitUrl);
        setStage("published");
      } else {
        setError(result.error);
        setStage("ready");
      }
    });
  }

  async function downloadExcel() {
    if (!file || !preview) return;
    setDownloading(true);
    try {
      const res = await fetch("/admin/excel", { method: "POST", body: asFormData(file) });
      if (!res.ok) throw new Error(await res.text());
      // Turn the response into a temporary link and click it
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `South Central Open Jobs - Cleaned ${preview.reportDate}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "The download didn't work. Try again.");
    } finally {
      setDownloading(false);
    }
  }

  function reset() {
    setStage("empty");
    setFile(null);
    setPreview(null);
    setError(null);
    setCommitUrl(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  // ---------- Published ----------
  if (stage === "published" && preview) {
    return (
      <section className="mt-8 rounded-md border-2 border-field bg-surface p-6" aria-live="polite">
        <h2 className="font-display text-2xl font-bold">Published</h2>
        <p className="mt-2 text-lg">
          The {formatDate(preview.reportDate, true)} report is saved. Vercel is rebuilding the site now, and
          the {preview.open.toLocaleString()} jobs will be live in about a minute.
        </p>
        <div className="mt-5 flex flex-wrap gap-x-6 gap-y-3 items-center">
          <button type="button" onClick={downloadExcel} disabled={downloading} className="rounded-md bg-field text-white font-bold px-5 py-2.5 hover:bg-field-dark disabled:opacity-60">
            {downloading ? "Preparing…" : "Download cleaned Excel"}
          </button>
          {commitUrl && (
            <a href={commitUrl} target="_blank" rel="noopener noreferrer" className="text-field font-bold underline underline-offset-4">
              See the change on GitHub
            </a>
          )}
          <button type="button" onClick={reset} className="text-field font-bold underline underline-offset-4">
            Upload another report
          </button>
        </div>
      </section>
    );
  }

  return (
    <div className="mt-8 space-y-6">
      {!githubReady && (
        <p className="rounded-md border-2 border-gold bg-gold-soft/40 p-4">
          Publishing is off until <code>GITHUB_TOKEN</code> and <code>GITHUB_REPO</code> are set on Vercel.
          You can still check a report and download the cleaned Excel.
        </p>
      )}

      {/* ---------- Step 1: choose the file (click or drag and drop) ---------- */}
      <label
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); choose(e.dataTransfer.files[0]); }}
        className={[
          "block rounded-md border-2 border-dashed p-8 text-center cursor-pointer transition-colors",
          "focus-within:outline focus-within:outline-3 focus-within:outline-gold",
          dragging ? "border-field bg-map-1" : "border-line bg-surface hover:border-field",
        ].join(" ")}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx"
          className="sr-only"
          onChange={(e) => choose(e.target.files?.[0])}
        />
        <span className="font-display text-xl font-bold block">
          {file ? file.name : "Choose this week's job report"}
        </span>
        <span className="text-muted block mt-1">
          {file ? "Choose a different file" : "The .xlsx file from the email. You can also drag it here."}
        </span>
      </label>

      {error && (
        <p role="alert" className="rounded-md border-2 border-[#9b2c1f] bg-surface p-4 font-bold text-[#9b2c1f]">
          {error}
        </p>
      )}

      {stage === "checking" && <p aria-live="polite" className="text-muted">Reading the report…</p>}

      {/* ---------- Step 2: preview, then publish ---------- */}
      {preview && (stage === "ready" || stage === "publishing") && (
        <section className="rounded-md border border-line bg-surface p-6" aria-labelledby="preview-heading">
          <h2 id="preview-heading" className="font-display text-2xl font-bold">
            Report from {formatDate(preview.reportDate, true)}
          </h2>

          {preview.warning && (
            <p className="mt-3 rounded-sm bg-gold-soft px-3 py-2 font-bold">{preview.warning}</p>
          )}

          <dl className="mt-5 grid grid-cols-3 gap-4">
            <Stat label="Open jobs" value={preview.open} />
            <Stat label="New this month" value={preview.newThisMonth} />
            <Stat label="Left out" value={preview.total - preview.open} />
          </dl>

          <p className="mt-5 text-muted">
            {preview.total.toLocaleString()} postings in the report. Left out:{" "}
            {preview.removed.map((r) => `${r.count.toLocaleString()} ${r.reason.toLowerCase()}`).join("; ")}.
          </p>
          <p className="mt-2 text-muted">
            Most jobs: {preview.topCounties.map((c) => `${c.county} ${c.count.toLocaleString()}`).join(", ")}.
          </p>

          {preview.unknownLocations.length > 0 && (
            <div className="mt-4 rounded-sm bg-paper p-3">
              <p className="font-bold">
                {preview.unknownLocations.length} location{preview.unknownLocations.length > 1 && "s"} weren&apos;t
                recognized and will show as &quot;Unknown&quot;:
              </p>
              <ul className="mt-1 list-disc pl-5 text-muted">
                {preview.unknownLocations.slice(0, 8).map((loc) => <li key={loc}>{loc}</li>)}
              </ul>
              <p className="mt-1 text-sm text-muted">Add the town to CITY_TO_COUNTY in src/lib/report/rules.ts to fix these next time.</p>
            </div>
          )}

          <div className="mt-6 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={publish}
              disabled={!githubReady || stage === "publishing"}
              className="rounded-md bg-field text-white font-bold px-5 py-3 hover:bg-field-dark disabled:opacity-60"
            >
              {stage === "publishing" ? "Publishing…" : "Publish to the site"}
            </button>
            <button
              type="button"
              onClick={downloadExcel}
              disabled={downloading}
              className="rounded-md border-2 border-field text-field font-bold px-5 py-2.5 hover:bg-map-1 disabled:opacity-60"
            >
              {downloading ? "Preparing…" : "Download cleaned Excel"}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="font-display text-3xl font-bold tabular-nums">{value.toLocaleString()}</dd>
    </div>
  );
}
