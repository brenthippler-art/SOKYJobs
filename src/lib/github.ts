// Saves jobs.json to the GitHub repo. Vercel watches the repo, so this commit
// is what triggers the redeploy - exactly like pushing from your laptop.
//
// Needs three environment variables on Vercel:
//   GITHUB_TOKEN   fine-grained token, this repo only, "Contents: Read and write"
//   GITHUB_REPO    e.g. "brenthippler-art/soky-jobs"
//   GITHUB_BRANCH  optional, defaults to "main"

import "server-only";

const FILE_PATH = "src/data/jobs.json";
// Only overridden by the local test script; on Vercel it's always GitHub
const API = process.env.GITHUB_API_URL ?? "https://api.github.com";

export class PublishError extends Error {}

export function githubConfigured(): boolean {
  return Boolean(process.env.GITHUB_TOKEN && process.env.GITHUB_REPO);
}

function headers(accept = "application/vnd.github+json") {
  return {
    Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
    Accept: accept,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "soky-jobs-admin",
  };
}

function explain(status: number): string {
  if (status === 401) return "GitHub rejected the token. It may have expired - make a new one and update GITHUB_TOKEN on Vercel.";
  if (status === 403 || status === 404) {
    return "The GitHub token can't write to this repo. Check GITHUB_REPO and that the token has Contents: Read and write.";
  }
  if (status === 409) return "The file changed on GitHub at the same moment. Try publishing again.";
  return `GitHub returned an error (${status}). Try again in a minute.`;
}

export async function publishJobsJson(content: string, message: string): Promise<{ commitUrl: string }> {
  const repo = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || "main";
  const url = `${API}/repos/${repo}/contents/${FILE_PATH}`;

  // 1. Get the current file's "sha" (its version id). GitHub requires it to
  //    replace a file, so two uploads can't silently overwrite each other.
  //    jobs.json is over 1 MB, and for files that size GitHub only returns
  //    the sha with this "object" media type.
  const current = await fetch(`${url}?ref=${encodeURIComponent(branch)}`, {
    headers: headers("application/vnd.github.object"),
    cache: "no-store",
  });
  if (!current.ok && current.status !== 404) throw new PublishError(explain(current.status));
  const sha: string | undefined = current.ok ? (await current.json()).sha : undefined;

  // 2. Write the new version. The content must be base64-encoded.
  const res = await fetch(url, {
    method: "PUT",
    headers: { ...headers(), "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      content: Buffer.from(content, "utf8").toString("base64"),
      sha,
      branch,
    }),
    cache: "no-store",
  });
  if (!res.ok) throw new PublishError(explain(res.status));

  const body = await res.json();
  return { commitUrl: body.commit?.html_url ?? `https://github.com/${repo}/commits/${branch}` };
}
