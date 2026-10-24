'use client';

import { useEffect, useRef, useState } from 'react';

import { API_BASE, urls } from '@/lib/api';
import { cameraState, isFault, type CameraState } from '@/lib/cameraState';
import { copy } from '@/lib/copy';
import { itemName, percent } from '@/lib/format';
import { portBusy, type LinkLabel } from '@/lib/reducer';
import type { Event, ItemCount, Link, SourceName } from '@/lib/types';

import styles from './CameraWindow.module.css';
import { OUTCOMES } from './outcome';
import { Badge } from './ui/Badge';
import { Icon, type IconName } from './ui/Icon';

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
      <video ref={video} className={styles.webcamFeed} autoPlay muted playsInline />
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

const CHIP_ICONS: Record<CameraState, IconName> = {
  ready: 'ready',
  counted: 'counted',
  unsure: 'unsure',
  waiting: 'waiting',
  'no-frames': 'alert',
  connecting: 'waiting',
  reconnecting: 'waiting',
  'not-linked': 'alert',
  'not-responding': 'alert',
  unreachable: 'alert',
};

/** The message and next step for a camera state that stops the counting loop. */
function faultMessage(state: CameraState, link: Link | null): string {
  switch (state) {
    case 'unreachable':
      return copy.backendUnreachable(API_BASE);
    case 'not-linked':
      return link !== null && portBusy(link) ? copy.portBusy : copy.nanoNotLinked;
    case 'not-responding':
      return copy.cameraNotResponding;
    default:
      return copy.classifierNoFrames;
  }
}

interface Props {
  link: Link | null;
  linkLabel: LinkLabel;
  paused: boolean;
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
  linkLabel,
  paused,
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

  const state = cameraState({
    backendUnreachable,
    paused,
    link,
    linkLabel,
    verdict,
    framesFlowing: !feedFailed && (link?.preview_fps ?? 0) > 0,
    framesOverdue: now - viewSince >= NO_FRAMES_AFTER_MS,
  });

  const classifier = source === 'classifier';
  const fault = classifier && isFault(state) ? faultMessage(state, link) : null;
  const webcamMessage =
    !classifier && webcamStatus !== 'live' ? webcamMessages[webcamStatus] : null;
  const waitingMessage =
    classifier && (state === 'waiting' || state === 'connecting') ? copy.classifierWaiting : null;

  const simulatedTag =
    runSource === 'sim' ? copy.simulatedBanner : runSource === 'replay' ? copy.replayBanner : null;
  const outcome = verdict ? OUTCOMES[verdict.bin] : null;
  const verdictName = verdict ? itemName(verdict, items) : '';

  return (
    <section
      className={[styles.window, className].filter(Boolean).join(' ')}
      aria-labelledby="camera-title"
    >
      <div className={styles.header}>
        <h2 id="camera-title" className={styles.title}>
          <Icon name="camera" size={20} />
          {classifier ? copy.classifierTitle : copy.webcamTitle}
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
        <p className={styles.note}>{classifier ? copy.classifierNote : copy.webcamNote}</p>
      </div>
      <div className={styles.viewport} data-testid="camera-viewport">
        {classifier && pageLoaded && !backendUnreachable ? (
          // eslint-disable-next-line @next/next/no-img-element -- a live MJPEG stream
          <img
            key={connection}
            className={feedFailed ? `${styles.feed} ${styles.feedHidden}` : styles.feed}
            src={`${urls.camera}?connection=${connection}`}
            alt="Live classifier view: the grayscale frame from the camera, enlarged"
            onError={() => setFeedFailed(true)}
          />
        ) : null}
        {!classifier ? <Webcam onStatus={setWebcamStatus} /> : null}
        {verdict !== null && classifier && verdict.has_frame ? (
          // eslint-disable-next-line @next/next/no-img-element -- a stored PNG, drawn pixelated
          <img
            className={styles.feed}
            src={urls.frame(verdict.id)}
            alt={`The frame the model classified as ${verdictName.toLowerCase()}`}
          />
        ) : null}

        {/* Viewfinder marks: this is an instrument's view, not a video player. */}
        <span className={styles.corners} aria-hidden="true" />

        {fault !== null || webcamMessage !== null || waitingMessage !== null ? (
          <div
            className={fault !== null ? `${styles.message} ${styles.messageFault}` : styles.message}
          >
            <Icon name={fault !== null ? 'alert' : 'waiting'} size={28} />
            <p className={styles.messageTitle}>
              {classifier ? copy.chip[state] : copy.webcamTitle}
            </p>
            <p className={styles.messageBody}>{fault ?? webcamMessage ?? waitingMessage}</p>
          </div>
        ) : null}

        <div className={styles.overlayTop}>
          {simulatedTag !== null ? (
            <Badge tone="inverse" icon={runSource === 'replay' ? 'replay' : 'simulated'}>
              {simulatedTag}
            </Badge>
          ) : null}
          <p className={`${styles.chip} ${styles[`chip-${classifier ? state : 'webcam'}`] ?? ''}`}>
            <Icon name={classifier ? CHIP_ICONS[state] : 'camera'} size={16} />
            <span>{classifier ? copy.chip[state] : copy.chip.webcam}</span>
          </p>
        </div>

        {verdict !== null && outcome !== null ? (
          <p
            className={`${styles.strip} ${styles[`strip-${verdict.bin}`] ?? ''}`}
            aria-hidden="true"
          >
            <Icon name={outcome.icon} size={24} />
            <span className={styles.stripWord}>{outcome.word}</span>
            <span className={styles.stripMeta}>
              {verdict.bin === 'unsure'
                ? `not counted, ${percent(verdict.confidence)}`
                : verdictName === outcome.word
                  ? percent(verdict.confidence)
                  : `${verdictName}, ${percent(verdict.confidence)}`}
            </span>
          </p>
        ) : null}
      </div>
    </section>
  );
}
