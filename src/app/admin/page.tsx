import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import AdminPanel from "./AdminPanel";
import LoginForm from "./LoginForm";
import { logout } from "./actions";
import { adminConfigured, isSignedIn } from "@/lib/session";
import { githubConfigured } from "@/lib/github";
import current from "@/data/jobs.json";
import weeklyChecks from "@/data/job-status.json";
import indeedChecks from "@/data/indeed-status.json";
import { applyChecks, type IndeedStatusFile, type StatusFile } from "@/lib/verify/status";

// One line on how the last weekly link check went
function LinkCheckSummary() {
  const result = applyChecks(current.jobs as { id: string }[], weeklyChecks as StatusFile, indeedChecks as IndeedStatusFile);
  if (!result.checkedAt) return <p className="w-full">Link check: hasn&apos;t run yet for this report.</p>;
  const confirmed = result.jobs.filter((j) => (j as { checkedOpenOn?: string }).checkedOpenOn).length;
  const date = new Date(result.checkedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Chicago" });
  return (
    <p className="w-full">
      Last link check {date}: {result.closedCount.toLocaleString()} closed jobs hidden,{" "}
      {confirmed.toLocaleString()} confirmed open.
    </p>
  );
}

// Keep this page out of Google. It isn't linked from anywhere either.
export const metadata: Metadata = {
  title: "Update jobs",
  robots: { index: false, follow: false },
};

export default function AdminPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 sm:px-6 py-10">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-display text-lg font-bold">South Central KY Jobs</p>
        <Link href="/" className="text-field font-bold underline underline-offset-4">
          Back to the job board
        </Link>
      </div>
      <h1 className="font-display text-4xl font-bold tracking-tight mt-6">Update the job list</h1>
      {/* Reading the sign-in cookie happens per request, so it sits behind
          Suspense; everything above it is part of the static shell. */}
      <Suspense fallback={<p className="mt-8 text-muted">Checking sign-in…</p>}>
        <AdminGate />
      </Suspense>
    </main>
  );
}

async function AdminGate() {
  // Wait for a real request before checking anything. Without this, Next
  // would run the env-var check below once at BUILD time and bake the answer
  // into the page - so changing the password on Vercel wouldn't take effect.
  await connection();

  if (!adminConfigured()) {
    return (
      <div className="mt-8 rounded-md border-2 border-gold bg-gold-soft/40 p-5">
        <p className="font-bold">The admin page isn&apos;t set up yet.</p>
        <p className="mt-2">
          Add <code>ADMIN_PASSWORD</code> and <code>SESSION_SECRET</code> in Vercel under Settings,
          Environment Variables, then redeploy.
        </p>
      </div>
    );
  }

  if (!(await isSignedIn())) return <LoginForm />;

  return (
    <>
      <div className="mt-3 flex flex-wrap items-baseline justify-between gap-3 text-muted">
        <p>
          On the site now: the report from{" "}
          {new Date(`${current.reportDate}T00:00:00Z`).toLocaleDateString("en-US", {
            month: "long", day: "numeric", year: "numeric", timeZone: "UTC",
          })}
          , {current.jobs.length.toLocaleString()} open jobs.
        </p>
        <LinkCheckSummary />
        <form action={logout}>
          <button type="submit" className="text-field font-bold underline underline-offset-4">
            Sign out
          </button>
        </form>
      </div>
      <AdminPanel githubReady={githubConfigured()} />
    </>
  );
}
