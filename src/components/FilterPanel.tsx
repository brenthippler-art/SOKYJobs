"use client";

import { useState } from "react";
import type { Filters } from "@/lib/filters";

interface Props {
  filters: Filters;
  categoryCounts: Map<string, number>; // ignoring the category filter itself
  onChange: (patch: Partial<Filters>) => void;
}

const SHOW_FIRST = 8;
const MIN_PAY_OPTIONS = [12, 15, 18, 20, 25];

export default function FilterPanel({ filters, categoryCounts, onChange }: Props) {
  const [showAllTypes, setShowAllTypes] = useState(false);

  // Most common job types first; selected ones always stay visible
  const categories = [...categoryCounts.entries()].sort((a, b) => b[1] - a[1]);
  const visible = showAllTypes
    ? categories
    : categories.filter(([c], i) => i < SHOW_FIRST || filters.categories.includes(c));

  function toggleCategory(category: string) {
    const on = filters.categories.includes(category);
    onChange({
      categories: on
        ? filters.categories.filter((c) => c !== category)
        : [...filters.categories, category],
    });
  }

  return (
    <div className="space-y-7">
      <fieldset>
        <legend className="font-display font-semibold text-lg mb-2">Type of work</legend>
        <ul className="space-y-0.5">
          {visible.map(([category, count]) => (
            <li key={category}>
              <label className="flex items-center gap-3 py-1.5 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={filters.categories.includes(category)}
                  onChange={() => toggleCategory(category)}
                  className="size-5 accent-field shrink-0"
                />
                <span className="flex-1 group-hover:underline underline-offset-2">{category}</span>
                <span className="text-muted tabular-nums text-sm">{count}</span>
              </label>
            </li>
          ))}
        </ul>
        {categories.length > SHOW_FIRST && (
          <button
            type="button"
            onClick={() => setShowAllTypes((v) => !v)}
            className="mt-2 text-field font-bold underline underline-offset-4"
          >
            {showAllTypes ? "Show fewer" : `Show all ${categories.length} types`}
          </button>
        )}
      </fieldset>

      <fieldset>
        <legend className="font-display font-semibold text-lg mb-2">Posted</legend>
        {[
          { label: "Any time (last 90 days)", value: null },
          { label: "Last 60 days", value: 60 },
          { label: "Last 30 days", value: 30 },
        ].map((option) => (
          <label key={option.label} className="flex items-center gap-3 py-1.5 cursor-pointer">
            <input
              type="radio"
              name="posted"
              checked={filters.postedWithin === option.value}
              onChange={() => onChange({ postedWithin: option.value as Filters["postedWithin"] })}
              className="size-5 accent-field"
            />
            {option.label}
          </label>
        ))}
        <p className="text-sm text-muted mt-1">Newer postings are more likely to still be open.</p>
      </fieldset>

      <fieldset>
        <legend className="font-display font-semibold text-lg mb-2">Pay</legend>
        <label className="flex items-center gap-3 py-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={filters.payListed}
            onChange={(e) => onChange({ payListed: e.target.checked })}
            className="size-5 accent-field"
          />
          Only jobs that list pay
        </label>
        <label className="block mt-2">
          <span className="block mb-1">At least</span>
          <select
            value={filters.minHourly ?? ""}
            onChange={(e) => onChange({ minHourly: e.target.value ? Number(e.target.value) : null })}
            className="w-full rounded-md border border-line bg-surface px-3 py-2"
          >
            <option value="">Any pay</option>
            {MIN_PAY_OPTIONS.map((n) => (
              <option key={n} value={n}>
                ${n} an hour
              </option>
            ))}
          </select>
        </label>
        <p className="text-sm text-muted mt-2">
          Most employers don&apos;t list pay. Setting a minimum hides those jobs.
        </p>
      </fieldset>

      <fieldset>
        <legend className="font-display font-semibold text-lg mb-2">Employer</legend>
        <label className="flex items-center gap-3 py-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={filters.hideAgencies}
            onChange={(e) => onChange({ hideAgencies: e.target.checked })}
            className="size-5 accent-field"
          />
          Hide staffing agencies
        </label>
      </fieldset>
    </div>
  );
}
