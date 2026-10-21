"use client";

import { ELSEWHERE } from "@/lib/filters";

// Each county is a square tile placed roughly where it sits geographically.
// [column, row] on a 5 x 4 grid - west is left, north is up.
const TILES: Record<string, [number, number]> = {
  Ohio: [1, 0], Grayson: [2, 0], [ELSEWHERE]: [4, 0],
  Butler: [1, 1], Edmonson: [2, 1], Hart: [3, 1],
  Logan: [0, 2], Warren: [1, 2], Barren: [2, 2], Metcalfe: [3, 2], Adair: [4, 2],
  Simpson: [1, 3], Allen: [2, 3], Monroe: [3, 3],
};

// More jobs = darker tile. Steps roughly triple each time, because Warren
// alone has more jobs than every other county combined.
function shade(count: number) {
  if (count === 0) return "bg-map-0 text-muted";
  if (count <= 30) return "bg-map-1 text-ink";
  if (count <= 100) return "bg-map-2 text-ink";
  if (count <= 400) return "bg-map-3 text-white";
  return "bg-map-4 text-white";
}

interface Props {
  counts: Map<string, number>; // jobs per county, ignoring the county filter
  selected: string[];
  onToggle: (county: string) => void;
}

export default function CountyMap({ counts, selected, onToggle }: Props) {
  return (
    <div
      role="group"
      aria-label="Counties"
      className="grid grid-cols-5 gap-1.5 sm:gap-2 w-full max-w-[26rem]"
    >
      {Object.entries(TILES).map(([county, [col, row]]) => {
        const count = counts.get(county) ?? 0;
        const isOn = selected.includes(county);
        const isElsewhere = county === ELSEWHERE;
        return (
          <button
            key={county}
            type="button"
            onClick={() => onToggle(county)}
            aria-pressed={isOn}
            aria-label={`${isElsewhere ? "Other areas" : `${county} County`}, ${count} jobs`}
            style={{ gridColumn: col + 1, gridRow: row + 1 }}
            className={[
              "relative aspect-square rounded-md p-1.5 sm:p-2 text-left flex flex-col justify-between",
              "transition-[transform,background-color] duration-150 active:scale-95",
              isOn
                ? "bg-gold text-ink ring-2 ring-ink ring-offset-2 ring-offset-paper"
                : shade(count),
              isElsewhere && !isOn ? "border-2 border-dashed border-line !bg-transparent !text-ink" : "",
            ].join(" ")}
          >
            <span className="font-display font-semibold leading-tight text-[0.66rem] sm:text-[0.8rem] tracking-[-0.01em]">
              {isElsewhere ? "Other" : county}
            </span>
            <span className="flex items-end justify-between">
              <span className="font-display tabular-nums text-sm sm:text-lg font-bold leading-none">
                {count.toLocaleString()}
              </span>
              {isOn && (
                <svg aria-hidden="true" viewBox="0 0 16 16" className="size-3.5 sm:size-4">
                  <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2.5" />
                </svg>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
