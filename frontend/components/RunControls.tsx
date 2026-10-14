'use client';

import { useEffect, useRef, useState } from 'react';

import { API_BASE, ApiError, api } from '@/lib/api';
import { copy } from '@/lib/copy';
import type { State } from '@/lib/types';

import styles from './RunControls.module.css';

const CONFIRMATION_MS = 4000;

export function RunControls({
  onStarted,
  announce,
}: {
  onStarted: (state: State) => void;
  announce: (message: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (notice === null) return;
    const timer = setTimeout(() => setNotice(null), CONFIRMATION_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  const confirm = async () => {
    setBusy(true);
    try {
      const state = await api.startNewRun();
      onStarted(state);
      setNotice(copy.newRunStarted);
      announce(copy.newRunStarted);
      dialog.current?.close();
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      setNotice(copy.backendUnreachable(API_BASE));
      dialog.current?.close();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.controls}>
      {notice !== null ? <p className={styles.notice}>{notice}</p> : null}
      <button type="button" className={styles.primary} onClick={() => dialog.current?.showModal()}>
        {copy.startNewRun}
      </button>
      <dialog ref={dialog} className={styles.dialog} aria-labelledby="new-run-title">
        <h2 id="new-run-title" className={styles.title}>
          {copy.confirmTitle}
        </h2>
        <p className={styles.body}>{copy.confirmBody}</p>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.primary}
            disabled={busy}
            onClick={() => void confirm()}
          >
            {copy.startNewRun}
          </button>
          <button
            type="button"
            className={styles.secondary}
            autoFocus
            onClick={() => dialog.current?.close()}
          >
            {copy.confirmKeep}
          </button>
        </div>
      </dialog>
    </div>
  );
}
