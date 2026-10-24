// Two item pictograms on a 24px grid: 2px stroke, square caps, miter joins, currentColor.

const paths: Record<string, string> = {
  // Recyclable: an arrow chasing its own tail.
  recyclable: 'M20 12a8 8 0 1 1-2.5-5.8 M20 3v6h-6',
  // Non-recyclable: a bin with its lid, handle and two slats.
  trash: 'M4 6h16 M9 6V3h6v3 M6 6l1 15h10l1-15 M10 10v7 M14 10v7',
};

export function hasPictogram(label: string): boolean {
  return label in paths;
}

export function Pictogram({ label, size = 24 }: { label: string; size?: number }) {
  const d = paths[label];
  if (d === undefined) return null;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
      focusable="false"
    >
      <path d={d} />
    </svg>
  );
}
