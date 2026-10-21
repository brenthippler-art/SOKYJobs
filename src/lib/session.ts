// Admin sign-in. There's one admin (you), so instead of a user database the
// password lives in an environment variable on Vercel, and a signed cookie
// remembers that you've entered it.
//
// The cookie looks like  "1761100000000.3f9a..."  =  <expires>.<signature>
// The signature is an HMAC of the expiry time using SESSION_SECRET. Anyone can
// read the expiry, but nobody can change it or forge a cookie without the
// secret, because the signature would no longer match.

import "server-only";
import { createHmac, createHash, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

const COOKIE = "admin_session";
const SESSION_HOURS = 12;

export function adminConfigured(): boolean {
  return Boolean(process.env.ADMIN_PASSWORD && process.env.SESSION_SECRET);
}

function sign(expires: string): string {
  return createHmac("sha256", process.env.SESSION_SECRET!).update(`admin|${expires}`).digest("hex");
}

// Compare two strings without leaking how many characters matched (a normal
// === stops at the first difference, which an attacker could time).
// Hashing first makes both sides the same length, which timingSafeEqual needs.
function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function passwordMatches(attempt: string): boolean {
  return adminConfigured() && safeEqual(attempt, process.env.ADMIN_PASSWORD!);
}

export async function startSession(): Promise<void> {
  const expires = String(Date.now() + SESSION_HOURS * 60 * 60 * 1000);
  (await cookies()).set(COOKIE, `${expires}.${sign(expires)}`, {
    httpOnly: true, // JavaScript in the page can't read it
    secure: process.env.NODE_ENV === "production", // HTTPS only on Vercel
    sameSite: "strict", // not sent when another site links or posts here
    path: "/admin",
    maxAge: SESSION_HOURS * 60 * 60,
  });
}

export async function endSession(): Promise<void> {
  (await cookies()).delete({ name: COOKIE, path: "/admin" });
}

export async function isSignedIn(): Promise<boolean> {
  if (!adminConfigured()) return false;
  const value = (await cookies()).get(COOKIE)?.value;
  if (!value) return false;
  const [expires, signature] = value.split(".");
  if (!expires || !signature || Number(expires) < Date.now()) return false;
  return safeEqual(signature, sign(expires));
}
