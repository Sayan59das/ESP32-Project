import type { ReactNode } from 'react';

import styles from './ErrorScreen.module.css';
import { SiteHeader } from './SiteHeader';
import { Icon, type IconName } from './ui/Icon';

/** A whole-page state: an error the page could not recover from, or a missing page. Says
 *  what happened, what is not affected, and offers the way back. `bare` drops the site
 *  header, for the global error page, where the header itself may be what failed. */
export function ErrorScreen({
  title,
  icon,
  actions,
  reference,
  bare,
  children,
}: {
  title: string;
  icon?: IconName;
  actions: ReactNode;
  /** The error digest, so a report can be matched to the server log. */
  reference?: string;
  bare?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={styles.page}>
      {bare ? (
        <header className={styles.bareHeader}>
          <p className={styles.brand}>EcoSort Edge</p>
        </header>
      ) : (
        <SiteHeader />
      )}
      <main className={styles.main}>
        <div className={styles.panel}>
          {icon ? <Icon name={icon} size={32} className={styles.icon} /> : null}
          <h1 className={styles.title}>{title}</h1>
          <div className={styles.body}>{children}</div>
          <div className={styles.actions}>{actions}</div>
          {reference ? (
            <p className={styles.reference}>
              Error reference: <code>{reference}</code>
            </p>
          ) : null}
        </div>
      </main>
    </div>
  );
}
