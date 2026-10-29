// Rules for deciding whether a job is still open, one function per site.
//
// Each function takes what came back from a web request (status code + HTML)
// and returns a verdict. They don't make requests themselves, which keeps them
// easy to test: we feed them saved copies of real pages.
//
// The verdict is deliberately cautious. "closed" means a site clearly said so.
// "open" means a site clearly showed the job. Anything else is "unknown", and
// unknown jobs stay on the board - hiding a real job is worse than showing a
// dead one.

export type CheckState = "open" | "closed" | "unknown";

export type CheckReason =
  | "jobseq-removed" // JobsEQ page is gone (404)
  | "jobseq-inactive" // JobsEQ says "no longer available from the source"
  | "no-apply-link" // JobsEQ page has no link to follow
  | "source-closed" // original posting says it's closed/expired
  | "source-gone" // original posting returns 404/410
  | "source-open" // original posting is up and shows the job
  | "indeed" // Indeed blocks automated checks; checked from your PC instead
  | "blocked" // site refused the request (403, 429, bot check)
  | "unclear" // page loaded but didn't clearly show the job either way
  | "error"; // timeout, network error, server error

export interface Verdict {
  state: CheckState;
  reason: CheckReason;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Visible text only. Scripts and styles are removed first, because job sites
// often ship error messages like "This job is no longer available" inside
// their JavaScript even on pages where the job is open.
export function visibleText(html: string): string {
  return html
    .replace(/<head[\s\S]*?<\/head>/gi, " ") // <title> and meta tags aren't on the page itself
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

const BLOCKED_STATUSES = new Set([401, 403, 429, 999]); // 999 = LinkedIn's "go away"

export type Source = "linkedin" | "indeed" | "other";

export function sourceOf(url: string): Source {
  const host = hostOf(url);
  if (host.endsWith("linkedin.com")) return "linkedin";
  if (host.endsWith("indeed.com")) return "indeed";
  return "other";
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// Step 1: JobsEQ
// ---------------------------------------------------------------------------

export interface JobsEqResult extends Verdict {
  applyUrl: string | null;
}

// Open job:    <div class="job-cta"><a href="..." class="cta-button">Apply at Original Source</a></div>
// Closed job:  <div class="job-cta"><span class="inactive">This job is no longer available from the source.</span></div>
// Removed job: 404 "Job Not Found"
export function parseJobsEq(status: number, html: string): JobsEqResult {
  if (status === 404 || status === 410) return { state: "closed", reason: "jobseq-removed", applyUrl: null };
  if (BLOCKED_STATUSES.has(status)) return { state: "unknown", reason: "blocked", applyUrl: null };
  if (status !== 200) return { state: "unknown", reason: "error", applyUrl: null };

  if (/no longer available from the source/i.test(html)) {
    return { state: "closed", reason: "jobseq-inactive", applyUrl: null };
  }
  // Find the <a ...> tag that has class "cta-button", whatever order its
  // attributes are in, then pull the href out of it.
  const tag = html.match(/<a\b[^>]*\bclass="[^"]*\bcta-button\b[^"]*"[^>]*>/i)?.[0];
  const href = tag?.match(/\bhref="([^"]+)"/i)?.[1];
  if (!href) return { state: "unknown", reason: "no-apply-link", applyUrl: null };
  return { state: "unknown", reason: "unclear", applyUrl: href.replace(/&amp;/g, "&") };
}

// ---------------------------------------------------------------------------
// Step 2a: LinkedIn
// ---------------------------------------------------------------------------

// LinkedIn's signed-out "guest" version of a job page. Same info, simpler page.
export function linkedInGuestUrl(applyUrl: string): string | null {
  const id = applyUrl.match(/\/jobs\/view\/(?:[^/]*?-)?(\d{6,})/)?.[1] ?? applyUrl.match(/currentJobId=(\d{6,})/)?.[1];
  return id ? `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${id}` : null;
}

// Closed: <figure class="closed-job ..."><figcaption>No longer accepting applications</figcaption></figure>
// Open:   an apply button with class "top-card-layout__cta" and no closed-job figure
export function parseLinkedIn(status: number, html: string): Verdict {
  if (status === 404 || status === 410) return { state: "closed", reason: "source-gone" };
  if (BLOCKED_STATUSES.has(status)) return { state: "unknown", reason: "blocked" };
  if (status !== 200) return { state: "unknown", reason: "error" };
  if (/class="[^"]*\bclosed-job\b/.test(html) || /no longer accepting applications/i.test(html)) {
    return { state: "closed", reason: "source-closed" };
  }
  if (/top-card-layout__cta/.test(html)) return { state: "open", reason: "source-open" };
  return { state: "unknown", reason: "unclear" };
}

// ---------------------------------------------------------------------------
// Step 2b: Indeed (only used by the Chrome script on your PC)
// ---------------------------------------------------------------------------

export function indeedJobKey(applyUrl: string): string | null {
  return applyUrl.match(/[?&](?:jk|vjk)=([a-f0-9]{8,})/i)?.[1] ?? null;
}

// Indeed shows "This job has expired on Indeed" on dead postings.
export function parseIndeedText(pageText: string, title: string): Verdict {
  const text = pageText.toLowerCase();
  if (/just a moment|verify you are human|additional verification required/i.test(`${title} ${pageText.slice(0, 500)}`)) {
    return { state: "unknown", reason: "blocked" };
  }
  if (text.includes("this job has expired") || text.includes("job you were looking for was not found") || text.includes("this job is no longer available")) {
    return { state: "closed", reason: "source-closed" };
  }
  if (/apply now|apply on company site|easily apply/.test(text)) return { state: "open", reason: "source-open" };
  return { state: "unknown", reason: "unclear" };
}

// ---------------------------------------------------------------------------
// Step 2c: Everyone else (employer career sites: iCIMS, Workday, Lever, ...)
// ---------------------------------------------------------------------------

// Wording career sites use for dead postings. Kept specific on purpose:
// a loose phrase like "not available" would match "relocation is not
// available for this position" on a perfectly good job.
const CLOSED_PHRASES = [
  "no longer accepting applications",
  "this job has expired",
  "this job posting has expired",
  "this posting has expired",
  "job posting is no longer available",
  "this job is no longer available",
  "this position is no longer available",
  "position has been filled",
  "this job has been filled",
  "the job you are looking for is no longer",
  "the job you're looking for is no longer",
  "the position you are looking for is no longer",
  "job you are trying to apply for has been filled",
  "this job is closed",
  "this requisition is no longer",
  "sorry, this job has expired",
  "job not found",
  "the page you are looking for doesn't exist",
];

const STOP_WORDS = new Set(["and", "the", "for", "with", "from", "full", "part", "time", "shift", "only", "older"]);

// To call a job "open" we want proof the page is about THIS job, not a
// search page the site redirected us to. So: most of the meaningful words
// in the job title should appear on the page.
function mentionsTitle(text: string, title: string): boolean {
  const words = title
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w.length >= 4 && !STOP_WORDS.has(w));
  if (!words.length) return false;
  const found = words.filter((w) => text.includes(w)).length;
  return found / words.length >= 0.6;
}

export function parseGeneric(status: number, html: string, jobTitle: string): Verdict {
  if (status === 404 || status === 410) return { state: "closed", reason: "source-gone" };
  if (BLOCKED_STATUSES.has(status)) return { state: "unknown", reason: "blocked" };
  if (status < 200 || status >= 300) return { state: "unknown", reason: "error" };

    // Phenom career sites (CVS, Aerotek, O'Reilly, Humana...) put a hidden
  // "the job you are trying to apply for has been filled" message on EVERY
  // job page and only show it when the job is gone. So for Phenom, ignore the
  // wording and read the job data embedded in the page instead:
  //   open:   "jobDetail":{"status":200,"hits":1, ...the job...}
  //   closed: "jobDetail":{"status":200,"hits":0, "data":{}}   (or a 410)
  const phenom = html.match(/"jobDetail"\s*:\s*\{\s*"status"\s*:\s*\d+\s*,\s*"hits"\s*:\s*(\d+)/);
  if (phenom) {
    return Number(phenom[1]) > 0 ? { state: "open", reason: "source-open" } : { state: "closed", reason: "source-closed" };
  }

  const text = visibleText(html);
  const showsJob = mentionsTitle(text, jobTitle);
  if (CLOSED_PHRASES.some((p) => text.includes(p))) {
    // Safety net for other sites with hidden messages like Phenom's: if the
    // page ALSO shows this job's title and an apply button, it's mixed
    // signals - don't hide the job.
    const hasApplyButton = /\bapply now\b|\bapply for this (job|position)\b/.test(text);
    if (showsJob && hasApplyButton) return { state: "unknown", reason: "unclear" };
    return { state: "closed", reason: "source-closed" };
  }
  // Pages built entirely in JavaScript (Workday, many apply portals) come back
  // nearly empty. We can't tell either way, so don't guess.
  if (text.length < 400) return { state: "unknown", reason: "unclear" };
  if (showsJob) return { state: "open", reason: "source-open" };
  return { state: "unknown", reason: "unclear" };
}
