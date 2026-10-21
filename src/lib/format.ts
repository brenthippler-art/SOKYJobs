// Small display helpers, kept apart from components so they're easy to test.

// Dates come in as "2026-09-24". Parsing them as UTC and formatting in UTC
// avoids the classic bug where Central time shows the day before.
export function formatDate(iso: string, withYear = false): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    ...(withYear ? { year: "numeric" } : {}),
    timeZone: "UTC",
  }).format(new Date(`${iso}T00:00:00Z`));
}

const dollars = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const cents = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export const formatHourly = (n: number) => `${cents.format(n)}/hr`;
export const formatAnnual = (n: number) => `${dollars.format(n)} a year`;

// "Warren and Barren", "Warren, Barren, and Allen"
export function joinWords(items: string[]): string {
  if (items.length <= 2) return items.join(" and ");
  return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
}
