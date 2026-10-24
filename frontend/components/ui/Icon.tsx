// Inline icons on a 24px grid: 2px stroke, square caps, miter joins, currentColor.
// Bundled with the page, so no icon ever needs the network.

const paths = {
  // Outcomes. Each is also told apart by its text label, never by colour alone.
  recyclable: 'M20 12a8 8 0 1 1-2.5-5.8 M20 3v6h-6', // an arrow chasing its own tail
  trash: 'M4 6h16 M9 6V3h6v3 M6 6l1 15h10l1-15 M10 10v7 M14 10v7', // a bin with two slats
  unsure: 'M3 3h18v18H3z M9.5 9.5a2.5 2.5 0 1 1 3.6 2.2c-.7.4-1.1.9-1.1 1.8v.5 M12 16.5v1', // a framed question mark
  // Camera and counting states
  camera: 'M3 7h4l2-3h6l2 3h4v13H3z M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  ready: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 12h.01', // an empty, waiting view
  inView: 'M3 8V3h5 M16 3h5v5 M21 16v5h-5 M8 21H3v-5 M9 9h6v6H9z', // a framed object
  counted: 'M5 12.5l4.5 4.5L19 7', // a tick
  waiting: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 7v5l3 2', // a clock
  remove: 'M13 4H4v16h9 M9 12h12 M17 8l4 4-4 4', // an arrow out of the frame
  // System
  signal: 'M3 12h4l2-6 4 12 2-6h6', // a pulse: the link is alive
  alert: 'M12 3L2 21h20z M12 10v5 M12 18v1',
  reset: 'M12 3v8 M6.3 6.3a8 8 0 1 0 11.4 0', // power: the device restarted
  simulated: 'M9 3h6 M10 3v6l-5 11h14l-5-11V3', // a flask
  replay: 'M4 4v6h6 M5 15a8 8 0 1 0 1.8-8.2L4 10',
  // Actions and theme
  download: 'M12 3v12 M7 10l5 5 5-5 M4 20h16',
  plus: 'M12 5v14 M5 12h14',
  close: 'M6 6l12 12 M18 6L6 18',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M12 2v2 M12 20v2 M4.9 4.9l1.4 1.4 M17.7 17.7l1.4 1.4 M2 12h2 M20 12h2 M4.9 19.1l1.4-1.4 M17.7 6.3l1.4-1.4',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z',
  system: 'M3 4h18v12H3z M8 20h8 M12 16v4', // a monitor: follow the system setting
} as const;

export type IconName = keyof typeof paths;

export function isIconName(name: string): name is IconName {
  return name in paths;
}

/** Decorative by default. Pass `label` only when the icon is the sole carrier of meaning. */
export function Icon({
  name,
  size = 20,
  label,
  className,
}: {
  name: IconName;
  size?: number;
  label?: string;
  className?: string;
}) {
  const a11y = label
    ? ({ role: 'img', 'aria-label': label } as const)
    : ({ 'aria-hidden': true } as const);
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
      focusable="false"
      className={className}
      {...a11y}
    >
      <path d={paths[name]} />
    </svg>
  );
}
