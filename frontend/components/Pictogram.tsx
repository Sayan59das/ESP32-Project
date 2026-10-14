// Four item pictograms on a 24px grid: 2px stroke, square caps, miter joins, currentColor.

const paths: Record<string, string> = {
  // A drinks can: body, the two rims, and the ring pull.
  can: 'M7 4h10v16H7z M7 7h10 M7 17h10 M10 2h4',
  // A bottle: neck, shoulders, body and label band.
  glass_bottle: 'M10 2h4v5l3 3v12H7V10l3-3z M7 14h10',
  // A pen at 45 degrees: barrel, the cap's edge and the nib.
  pen: 'M16 3l5 5L9 20l-6 1 1-6z M13 6l5 5 M4 15l5 5',
  // A phone case: the shell and its camera cut-out.
  phone_case: 'M6 2h12v20H6z M9 5h4v4H9z',
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
