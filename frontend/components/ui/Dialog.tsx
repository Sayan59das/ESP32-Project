'use client';

import { useEffect, useRef, type KeyboardEvent, type ReactNode, type RefObject } from 'react';

import styles from './Dialog.module.css';
import { Icon } from './Icon';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A modal built on the native <dialog>: showModal() makes the page behind it inert and
 * closes on Escape. This adds what the element does not promise everywhere: focus moves to
 * `initialFocus` on open, Tab wraps inside the dialog, and focus returns to the opener.
 */
export function Dialog({
  open,
  onClose,
  titleId,
  title,
  description,
  initialFocus,
  wide,
  closeLabel = 'Close',
  showClose = true,
  footer,
  children,
}: {
  open: boolean;
  onClose: () => void;
  titleId: string;
  title: ReactNode;
  description?: ReactNode;
  initialFocus?: RefObject<HTMLElement>;
  wide?: boolean;
  closeLabel?: string;
  showClose?: boolean;
  footer?: ReactNode;
  children?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    if (open && !el.open) {
      opener.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      el.showModal();
      initialFocus?.current?.focus();
    } else if (!open && el.open) {
      el.close();
    }
  }, [open, initialFocus]);

  // The native close event fires for Escape, form[method=dialog] and close() alike.
  const handleClose = () => {
    const back = opener.current;
    opener.current = null;
    if (back?.isConnected) back.focus();
    if (open) onClose();
  };

  // showModal() keeps focus off the page, but Tab can still leave for the browser's own
  // toolbar. Wrap it inside the dialog instead.
  const keepFocusInside = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key !== 'Tab' || ref.current === null) return;
    const focusable = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (el) => el.offsetParent !== null,
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (first === undefined || last === undefined) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <dialog
      ref={ref}
      className={wide ? `${styles.dialog} ${styles.wide}` : styles.dialog}
      aria-labelledby={titleId}
      onClose={handleClose}
      onKeyDown={keepFocusInside}
    >
      <div className={styles.header}>
        <h2 id={titleId} className={styles.title}>
          {title}
        </h2>
        {showClose ? (
          <button
            type="button"
            className={styles.close}
            aria-label={closeLabel}
            onClick={() => ref.current?.close()}
          >
            <Icon name="close" size={20} />
          </button>
        ) : null}
      </div>
      {description ? <p className={styles.description}>{description}</p> : null}
      {children ? <div className={styles.body}>{children}</div> : null}
      {footer ? <div className={styles.footer}>{footer}</div> : null}
    </dialog>
  );
}
