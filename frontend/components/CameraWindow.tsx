'use client';

import { useEffect, useRef, useState } from 'react';

import { API_BASE, urls } from '@/lib/api';
import { copy } from '@/lib/copy';
import { binWord, itemName, percent } from '@/lib/format';
import { portBusy } from '@/lib/reducer';
import type { Event, ItemCount, Link, SourceName } from '@/lib/types';

import styles from './CameraWindow.module.css';

type ImageSource = 'classifier' | 'webcam';
type WebcamStatus = 'asking' | 'denied' | 'none' | 'busy' | 'insecure' | 'live';

const SOURCE_KEY = 'ecosort.cameraSource';
const DEVICE_KEY = 'ecosort.cameraDevice';
const VERDICT_HOLD_MS = 2500;
const NO_FRAMES_AFTER_MS = 5000;

// localStorage is a convenience only: private windows and blocked storage must still work.
function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage is unavailable; the choice just won't be remembered.
  }
}

/** Resolves once the window's load event has fired. An MJPEG <img> never finishes loading,
 *  so mounting it earlier would hold the page's load event open forever. */
function usePageLoaded(): boolean {
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (document.readyState === 'complete') {
      setLoaded(true);
      return;
    }
    const done = () => setLoaded(true);
    window.addEventListener('load', done, { once: true });
    return () => window.removeEventListener('load', done);
  }, []);
  return loaded;
}

function webcamStatusFor(error: unknown): WebcamStatus {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'none';
  return 'busy';
}

const webcamMessages: Record<Exclude<WebcamStatus, 'live'>, string> = {
  asking: copy.webcamAsking,
  denied: copy.webcamDenied,
  none: copy.webcamNone,
  busy: copy.webcamBusy,
  insecure: copy.webcamInsecure,
};

function Webcam({ onStatus }: { onStatus: (status: WebcamStatus) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string | null>(() => readStored(DEVICE_KEY));

  useEffect(() => {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      onStatus('insecure');
      return;
    }
    let stream: MediaStream | null = null;
    let cancelled = false;
    onStatus('asking');
    const constraints: MediaStreamConstraints = {
      audio: false,
      video: deviceId ? { deviceId: { exact: deviceId } } : true,
    };
    navigator.mediaDevices
      .getUserMedia(constraints)
      .then(async (media) => {
        if (cancelled) {
          media.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = media;
        if (video.current) video.current.srcObject = media;
        onStatus('live');
        const all = await navigator.mediaDevices.enumerateDevices();
        if (!cancelled) setDevices(all.filter((d) => d.kind === 'videoinput'));
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (
          deviceId !== null &&
          error instanceof DOMException &&
          error.name === 'OverconstrainedError'
        ) {
          setDeviceId(null); // the remembered camera is gone; fall back to the default one
          return;
        }
        onStatus(webcamStatusFor(error));
      });
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [deviceId, onStatus]);

  return (
    <>
      <video ref={video} className={styles.feed} autoPlay muted playsInline />
      {devices.length > 1 ? (
        <label className={styles.devicePicker}>
          <span className="visually-hidden">Camera</span>
          <select
            className={styles.select}
            value={deviceId ?? devices[0]?.deviceId ?? ''}
            onChange={(e) => {
              setDeviceId(e.target.value);
              writeStored(DEVICE_KEY, e.target.value);
            }}
          >
            {devices.map((d, i) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `Camera ${i + 1}`}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </>
  );
}

interface Props {
  link: Link | null;
  runSource: SourceName | null;
  backendUnreachable: boolean;
  latest: { event: Event; at: number } | null;
  items: ItemCount[];
  connection: number;
  now: number;
  className?: string;
}

export function CameraWindow({
  link,
  runSource,
  backendUnreachable,
  latest,
  items,
  connection,
  now,
  className,
}: Props) {
  const pageLoaded = usePageLoaded();
  const [source, setSource] = useState<ImageSource>('classifier');
  const [webcamStatus, setWebcamStatus] = useState<WebcamStatus>('asking');
  const [feedFailed, setFeedFailed] = useState(false);
  const [viewSince, setViewSince] = useState(() => Date.now());
  const [verdict, setVerdict] = useState<Event | null>(null);

  useEffect(() => {
    if (readStored(SOURCE_KEY) === 'webcam') setSource('webcam');
  }, []);

  // A new stream connection (for example after the bridge restarts) gets a fresh feed.
  useEffect(() => {
    setFeedFailed(false);
    setViewSince(Date.now());
  }, [connection, source]);

  // Hold the exact frame the model classified for a moment, with its verdict.
  useEffect(() => {
    if (latest === null) return;
    setVerdict(latest.event);
    const timer = setTimeout(() => setVerdict(null), VERDICT_HOLD_MS);
    return () => clearTimeout(timer);
  }, [latest]);

  const choose = (next: ImageSource) => {
    setSource(next);
    writeStored(SOURCE_KEY, next);
  };

  let message: string | null = null;
  if (source === 'webcam') {
    message = webcamStatus === 'live' ? null : webcamMessages[webcamStatus];
  } else if (backendUnreachable) {
    message = copy.backendUnreachable(API_BASE);
  } else if (link === null) {
    message = copy.classifierWaiting;
  } else if (!link.source_open) {
    message = portBusy(link) ? copy.portBusy : copy.nanoNotLinked;
  } else if (feedFailed || !((link.preview_fps ?? 0) > 0)) {
    message =
      now - viewSince < NO_FRAMES_AFTER_MS ? copy.classifierWaiting : copy.classifierNoFrames;
  }

  const simulatedTag =
    runSource === 'sim' ? copy.simulatedBanner : runSource === 'replay' ? copy.replayBanner : null;
  const verdictName = verdict ? itemName(verdict, items) : '';
  const verdictText = verdict
    ? verdict.bin === 'unsure'
      ? `Unsure, not counted, ${percent(verdict.confidence)}`
      : `${verdictName}, ${binWord(verdict.bin).toLowerCase()}, ${percent(verdict.confidence)}`
    : '';
  const stripClass =
    verdict?.bin === 'recyclable'
      ? styles.stripRecyclable
      : verdict?.bin === 'trash'
        ? styles.stripTrash
        : styles.stripUnsure;

  return (
    <section className={`${styles.window} ${className ?? ''}`} aria-labelledby="camera-title">
      <div className={styles.header}>
        <h2 id="camera-title" className={styles.title}>
          {source === 'classifier' ? copy.classifierTitle : copy.webcamTitle}
        </h2>
        <fieldset className={styles.toggle}>
          <legend className="visually-hidden">Image source</legend>
          {(['classifier', 'webcam'] as const).map((option) => (
            <label
              key={option}
              className={option === source ? `${styles.option} ${styles.optionOn}` : styles.option}
            >
              <input
                type="radio"
                name="image-source"
                className={styles.radio}
                checked={option === source}
                onChange={() => choose(option)}
              />
              {option === 'classifier' ? copy.sourceClassifier : copy.sourceWebcam}
            </label>
          ))}
        </fieldset>
        <p className={styles.note}>
          {source === 'classifier' ? copy.classifierNote : copy.webcamNote}
        </p>
      </div>
      <div className={styles.viewport} data-testid="camera-viewport">
        {source === 'classifier' && pageLoaded && !backendUnreachable ? (
          // eslint-disable-next-line @next/next/no-img-element -- a live MJPEG stream
          <img
            key={connection}
            className={feedFailed ? `${styles.feed} ${styles.feedHidden}` : styles.feed}
            src={`${urls.camera}?connection=${connection}`}
            alt="Live classifier view: the 96 by 96 grayscale frame from the OV7675, enlarged"
            onError={() => setFeedFailed(true)}
          />
        ) : null}
        {source === 'webcam' ? <Webcam onStatus={setWebcamStatus} /> : null}
        {verdict !== null && source === 'classifier' && verdict.has_frame ? (
          // eslint-disable-next-line @next/next/no-img-element -- a stored 96x96 PNG, drawn pixelated
          <img
            className={styles.feed}
            src={urls.frame(verdict.id)}
            alt={`The frame the model classified as ${verdictName.toLowerCase()}`}
          />
        ) : null}
        {message !== null ? <p className={styles.message}>{message}</p> : null}
        {simulatedTag !== null ? <p className={styles.tag}>{simulatedTag}</p> : null}
        {verdict !== null ? (
          <p className={`${styles.strip} ${stripClass}`} aria-hidden="true">
            {verdictText}
          </p>
        ) : null}
      </div>
    </section>
  );
}
