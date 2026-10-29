// Run with: npm test
// The HTML here is copied from real pages (trimmed), captured Oct 29, 2026.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  indeedJobKey, linkedInGuestUrl, parseGeneric, parseIndeedText, parseJobsEq, parseLinkedIn, sourceOf,
} from "./checks";

// ---------- JobsEQ ----------

const JOBSEQ_OPEN = `<div class="job-field job-date">Posted on: <span class="date">September 24, 2026</span></div>
  <div class="job-cta">
    <a href="https://www.linkedin.com/jobs/view/4471661397/" rel="nofollow" target="_blank" class="cta-button">Apply at Original Source</a>
  </div>`;

const JOBSEQ_CLOSED = `<div class="job-field job-date">Posted on: <span class="date">October 13, 2026</span></div>
  <div class="job-cta">
    <span class="inactive">This job is no longer available from the source.</span>
  </div>`;

test("JobsEQ: open job gives us the apply link", () => {
  assert.deepEqual(parseJobsEq(200, JOBSEQ_OPEN), {
    state: "unknown", reason: "unclear", applyUrl: "https://www.linkedin.com/jobs/view/4471661397/",
  });
});

test("JobsEQ: attribute order doesn't matter, &amp; is decoded", () => {
  const html = `<a class="cta-button" target="_blank" href="https://x.icims.com/jobs/1/job?a=1&amp;b=2">Apply</a>`;
  assert.equal(parseJobsEq(200, html).applyUrl, "https://x.icims.com/jobs/1/job?a=1&b=2");
});

test("JobsEQ: 'no longer available from the source' is closed", () => {
  assert.deepEqual(parseJobsEq(200, JOBSEQ_CLOSED), { state: "closed", reason: "jobseq-inactive", applyUrl: null });
});

test("JobsEQ: 404 is closed", () => {
  assert.equal(parseJobsEq(404, "Job Not Found").reason, "jobseq-removed");
});

test("JobsEQ: blocked or broken is unknown, never closed", () => {
  assert.equal(parseJobsEq(429, "").state, "unknown");
  assert.equal(parseJobsEq(503, "").state, "unknown");
});

// ---------- LinkedIn ----------

const LINKEDIN_CLOSED = `<figure class="closed-job closed-job__flavor topcard__flavor-row">
  <span class="closed-job__icon closed-job__icon--error-pebble lazy-load"></span>
  <figcaption class="closed-job__flavor--closed">No longer accepting applications</figcaption>
</figure> </h4> <div class="top-card-layout__cta-container flex">`;

const LINKEDIN_OPEN = `<!----> </h4> <div class="top-card-layout__cta-container flex flex-wrap">
  <button class="sign-up-modal__outlet top-card-layout__cta mt-2 top-card-layout__cta--primary btn-md btn-primary">`;

test("LinkedIn: guest URL from the different link shapes", () => {
  const api = "https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/4471661397";
  assert.equal(linkedInGuestUrl("https://www.linkedin.com/jobs/view/4471661397/"), api);
  assert.equal(linkedInGuestUrl("https://www.linkedin.com/jobs/view/sales-associate-at-dollar-general-4471661397"), api);
  assert.equal(linkedInGuestUrl("https://www.linkedin.com/jobs/search/?currentJobId=4471661397"), api);
  assert.equal(linkedInGuestUrl("https://www.linkedin.com/company/dollar-general"), null);
});

test("LinkedIn: closed, open, removed, throttled", () => {
  assert.equal(parseLinkedIn(200, LINKEDIN_CLOSED).state, "closed");
  assert.equal(parseLinkedIn(200, LINKEDIN_OPEN).state, "open");
  assert.equal(parseLinkedIn(404, "").reason, "source-gone");
  assert.equal(parseLinkedIn(429, "").state, "unknown");
  assert.equal(parseLinkedIn(999, "").reason, "blocked");
});

// ---------- Indeed ----------

test("Indeed: job key and page text", () => {
  assert.equal(indeedJobKey("https://www.indeed.com/viewjob?jk=044ffde7fa8e5803"), "044ffde7fa8e5803");
  assert.equal(indeedJobKey("https://www.indeed.com/rc/clk?from=x&jk=044ffde7fa8e5803"), "044ffde7fa8e5803");
  assert.equal(parseIndeedText("Long-Term Acute Care RN\nThis job has expired on Indeed", "RN - Indeed.com").state, "closed");
  assert.equal(parseIndeedText("Cashier\nApply now\nFull job description", "Cashier - Indeed.com").state, "open");
  assert.equal(parseIndeedText("Checking your browser", "Just a moment...").reason, "blocked");
});

// ---------- Employer career sites ----------

const LONG = " Lorem ipsum dolor sit amet, benefits include paid time off, health insurance and retirement.".repeat(6);

test("Generic: job page that shows the job title is open", () => {
  const html = `<html><body><h1>Cashier - Weekday Morning</h1><p>${LONG}</p><a>Apply</a></body></html>`;
  assert.equal(parseGeneric(200, html, "Cashier - Weekday Morning").state, "open");
});

test("Generic: expired wording is closed", () => {
  const html = `<html><body><h1>Dietary Aide</h1><p>Sorry, this job has expired.</p>${LONG}</body></html>`;
  assert.equal(parseGeneric(200, html, "Dietary Aide").reason, "source-closed");
});

test("Generic: error text hidden in JavaScript does NOT count", () => {
  const html = `<html><head><script>var msgs={gone:"This job is no longer available"}</script></head>
    <body><h1>Material Handler</h1><p>${LONG}</p></body></html>`;
  assert.equal(parseGeneric(200, html, "Material Handler").state, "open");
});

test("Generic: harmless 'not available' wording does NOT count", () => {
  const html = `<body><h1>Store Perishable Manager</h1><p>Relocation assistance is not available for this position.</p>${LONG}</body>`;
  assert.equal(parseGeneric(200, html, "Store Perishable Manager").state, "open");
});

test("Generic: redirected to a search page (title missing) is unknown", () => {
  const html = `<body><h1>Search our openings</h1><p>${LONG}</p></body>`;
  assert.equal(parseGeneric(200, html, "Utility Packaging 1st Shift").state, "unknown");
});

test("Generic: JavaScript-only page (nearly empty) is unknown", () => {
  assert.equal(parseGeneric(200, `<html><body><div id="root"></div><script>${LONG}</script></body></html>`, "Teller").reason, "unclear");
});

test("Generic: 404 closed, 403 unknown", () => {
  assert.equal(parseGeneric(404, "", "Teller").state, "closed");
  assert.equal(parseGeneric(403, "", "Teller").state, "unknown");
});

test("sourceOf", () => {
  assert.equal(sourceOf("https://www.linkedin.com/jobs/view/1/"), "linkedin");
  assert.equal(sourceOf("https://www.indeed.com/viewjob?jk=abc"), "indeed");
  assert.equal(sourceOf("https://jobs.lever.co/x/y"), "other");
});
