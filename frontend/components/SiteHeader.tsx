import Link from 'next/link';
import type { ReactNode } from 'react';

import { copy } from '@/lib/copy';
import type { SourceName } from '@/lib/types';

import styles from './SiteHeader.module.css';
import { ThemeToggle } from './ThemeToggle';
import { Badge } from './ui/Badge';

type Page = 'console' | 'project';

const pages: { id: Page; href: string; label: string }[] = [
  { id: 'console', href: '/', label: 'Console' },
  { id: 'project', href: '/project', label: 'Project' },
];

/** Simulated or replayed data must never pass for a real run: those badges are inverse,
 *  the strongest treatment on the page. Live gets the quieter signal badge. */
export function SourceBadge({ source }: { source: SourceName }) {
  if (source === 'sim')
    return (
      <Badge tone="inverse" icon="simulated">
        {copy.simulatedBanner}
      </Badge>
    );
  if (source === 'replay')
    return (
      <Badge tone="inverse" icon="replay">
        {copy.replayBanner}
      </Badge>
    );
  return (
    <Badge tone="signal" icon="signal">
      {copy.liveBanner}
    </Badge>
  );
}

export function SiteHeader({
  current,
  source,
  meta,
  notice,
}: {
  /** The page being shown; left out on pages outside the navigation, such as a 404. */
  current?: Page;
  /** The run's source; null while unknown, left out on pages without live data. */
  source?: SourceName | null;
  /** Run information and the link badge. */
  meta?: ReactNode;
  /** A full-width line that must not be missed, such as paused live updates. */
  notice?: ReactNode;
}) {
  return (
    <header className={styles.header}>
      <div className={styles.bar}>
        <p className={styles.brand}>EcoSort Edge</p>
        {source ? <SourceBadge source={source} /> : null}
        <nav aria-label="Pages">
          <ul className={styles.nav}>
            {pages.map((page) => (
              <li key={page.id}>
                <Link
                  href={page.href}
                  className={page.id === current ? styles.linkCurrent : styles.link}
                  aria-current={page.id === current ? 'page' : undefined}
                >
                  {page.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className={styles.tools}>
          {meta}
          <ThemeToggle />
        </div>
      </div>
      {notice}
    </header>
  );
}
