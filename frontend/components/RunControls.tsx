'use client';

import { useEffect, useRef, useState } from 'react';

import { API_BASE, ApiError, api, urls } from '@/lib/api';
import { copy } from '@/lib/copy';
import { shortTime } from '@/lib/format';
import type { Run, State } from '@/lib/types';

import styles from './RunControls.module.css';
import { Button, buttonClass } from './ui/Button';
import { Dialog } from './ui/Dialog';
import { Icon } from './ui/Icon';

const CONFIRMATION_MS = 4000;

export function RunControls({
  run,
  onStarted,
  announce,
}: {
  run: Run | null;
  onStarted: (state: State) => void;
  announce: (message: string) => void;
}) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const keep = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (notice === null) return;
    const timer = setTimeout(() => setNotice(null), CONFIRMATION_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  // The server starts the run and answers with the new state; nothing is reset here.
  const confirm = async () => {
    setBusy(true);
    try {
      const state = await api.startNewRun();
      onStarted(state);
      setNotice(copy.newRunStarted);
      announce(copy.newRunStarted);
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      setNotice(copy.backendUnreachable(API_BASE));
    } finally {
      setBusy(false);
      setAsking(false);
    }
  };

  return (
    <>
      <p className={styles.run}>
        {run ? (
          <>
            <span className={styles.runId}>Run {run.id}</span>, started {shortTime(run.started_at)}
          </>
        ) : (
          'No run yet'
        )}
      </p>
      <div className={styles.actions}>
        <Button variant="primary" icon="plus" onClick={() => setAsking(true)}>
          {copy.startNewRun}
        </Button>
        <a className={buttonClass('secondary')} href={urls.exportCsv} download>
          <Icon name="download" size={18} />
          <span>{copy.exportCsv}</span>
        </a>
      </div>
      <p className={styles.note}>{copy.exportNote}</p>
      {notice !== null ? (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      ) : null}
      <Dialog
        open={asking}
        onClose={() => setAsking(false)}
        titleId="new-run-title"
        title={copy.confirmTitle}
        description={copy.confirmBody}
        initialFocus={keep}
        footer={
          <>
            <Button variant="primary" disabled={busy} onClick={() => void confirm()}>
              {copy.startNewRun}
            </Button>
            <Button ref={keep} onClick={() => setAsking(false)}>
              {copy.confirmKeep}
            </Button>
          </>
        }
      />
    </>
  );
}
