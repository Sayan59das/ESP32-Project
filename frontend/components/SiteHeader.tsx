import Link from 'next/link';
import type { ReactNode } from 'react';

import styles from './SiteHeader.module.css';
import { ThemeToggle } from './ThemeToggle';

type Page = 'console' | 'project';

const pages: { id: Page; href: string; label: string }[] = [
  { id: 'console', href: '/', label: 'Console' },
  { id: 'project', href: '/project', label: 'Project' },
];

export function SiteHeader({
  current,
  banner,
  children,
}: {
  current: Page;
  banner?: string | null;
  children?: ReactNode;
}) {
  return (
    <header className={styles.header}>
      <p className={styles.brand}>EcoSort Edge</p>
      {banner ? <p className={styles.banner}>{banner}</p> : null}
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
        {children}
        <ThemeToggle />
      </div>
    </header>
  );
}
