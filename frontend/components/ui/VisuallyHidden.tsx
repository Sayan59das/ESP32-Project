import type { ReactNode } from 'react';

/** Text for assistive tech only. Uses the global .visually-hidden class. */
export function VisuallyHidden({
  as: Tag = 'span',
  id,
  children,
}: {
  as?: 'span' | 'p' | 'h1' | 'h2' | 'div';
  id?: string;
  children: ReactNode;
}) {
  return (
    <Tag id={id} className="visually-hidden">
      {children}
    </Tag>
  );
}
