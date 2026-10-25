import Link from 'next/link';
import type { ReactNode } from 'react';

import { copy } from '@/lib/copy';
import type { SourceName } from '@/lib/types';

import styles from './SiteHeader.module.css';
import { ThemeToggle } from './ThemeToggle';
import { Badge } from './ui/Badge';

type Page = 'home' | 'console' | 'testing' | 'project';

const pages: { id: Page; href: string; label: string }[] = [
  { id: 'home', href: '/', label: 'Home' },
  { id: 'console', href: '/console', label: 'Console' },
  { id: 'testing', href: '/testing', label: 'Testing' },
  { id: 'project', href: '/project', label: 'Project' },
];

/** The brand mark: a bin with a lens set into it. */
function Mark() {
  return (
    <svg className={styles.mark} width="30" height="30" viewBox="0 0 30 30" aria-hidden="true">
      <rect x="11.5" y="3" width="7" height="3" rx="1.2" fill="currentColor" />
      <rect x="5.5" y="5.8" width="19" height="3.6" rx="1.5" fill="currentColor" />
      <path
        d="M7.6 11 H22.4 L21 25.3 C20.9 26.3 20.1 27 19.1 27 H10.9 C9.9 27 9.1 26.3 9 25.3 Z"
        fill="currentColor"
      />
      <circle cx="15" cy="18.2" r="3.3" fill="var(--surface)" />
      <circle cx="15" cy="18.2" r="1.9" fill="var(--recyclable-mark)" />
    </svg>
  );
}

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
  floating,
}: {
  /** The page being shown; left out on pages outside the navigation, such as a 404. */
  current?: Page;
  /** Stays at the top while the page scrolls under it, as on the 3D pages. */
  floating?: boolean;
  /** The run's source; null while unknown, left out on pages without live data. */
  source?: SourceName | null;
  /** Run information and the link badge. */
  meta?: ReactNode;
  /** A full-width line that must not be missed, such as paused live updates. */
  notice?: ReactNode;
}) {
  return (
    <header className={floating ? `${styles.header} ${styles.floating}` : styles.header}>
      {/* The first stop for Tab on every page; hidden until it has focus. Every page that
          uses this header has <main id="main">. */}
      <a href="#main" className={styles.skip}>
        {copy.skipToMain}
      </a>
      <div className={styles.bar}>
        <Link href="/" className={styles.brand} aria-label="EcoSort Edge, home">
          <Mark />
          <span>EcoSort Edge</span>
        </Link>
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
