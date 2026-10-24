// Every user-facing sentence from the wording table, in one place.

export const copy = {
  startNewRun: 'Start new run',
  confirmTitle: 'Start a new run?',
  confirmBody:
    'This resets the counts on screen. The current run stays saved and in the CSV export.',
  confirmKeep: 'Keep current run',
  newRunStarted: 'New run started.',
  newRunFailed:
    'The new run did not start: the classifier service did not answer. The current run continues.',
  exportCsv: 'Export CSV',
  exportNote: 'Every event of every run, with confidence and inference time.',
  emptyLastItem: 'No items sorted yet',
  emptyRecentTitle: 'Nothing in this run yet',
  emptyRecent: 'Sorted items will appear here, newest first.',
  // The counting rhythm, taught on an empty run.
  rhythm: [
    'Place one item in front of the camera.',
    'Hold it still until the verdict shows.',
    'It is counted in its bin, or marked unsure and left out.',
    'Remove it before the next item.',
  ],
  unavailable: 'Not available while the classifier service is unreachable.',
  noCounts: 'No counts',
  logCap: (n: number) => `The latest ${n} items. Export CSV for the whole run.`,
  nothingSorted: 'Nothing sorted yet',
  sharesLater: 'Shares appear once an item is sorted.',

  classifierTitle: 'What the classifier sees',
  classifierNote: 'The 160 by 120 grayscale frame the model reads, enlarged. Not video.',
  webcamTitle: 'Webcam',
  webcamNote: 'A laptop webcam view of the rig. The classifier does not use this image.',
  sourceClassifier: 'Classifier frame',
  sourceWebcam: 'Webcam',

  chip: {
    ready: 'Ready, place an item',
    counted: 'Counted, remove the item',
    unsure: 'Unsure, remove the item',
    waiting: 'Waiting for frames',
    'no-frames': 'No frames',
    connecting: 'Connecting',
    reconnecting: 'Reconnecting',
    'not-linked': 'Not linked',
    'not-responding': 'Camera not responding',
    unreachable: 'Service unreachable',
    'preview-paused': 'Preview paused',
    webcam: 'Webcam, not used by the classifier',
  },

  // Pausing stops the picture on this screen only; the camera bridge keeps counting.
  pausePreview: 'Pause',
  pausePreviewLabel: 'Pause preview',
  resumePreview: 'Resume',
  resumePreviewLabel: 'Resume preview',
  previewPausedTitle: 'Preview paused',
  previewPausedBody:
    'Counting continues and verdicts still show here. Choose Resume to see the camera again.',
  linkPreviewPaused: 'Preview paused on this screen.',
  skipToMain: 'Skip to main content',

  classifierWaiting: 'Waiting for the first frame from the camera.',
  classifierNoFrames:
    "No frames are arriving. Check the camera board's USB cable and that the camera bridge window is running.",
  cameraNotResponding:
    'The link is open but the camera has stopped answering. Check the camera bridge window; it reconnects by itself.',
  portBusy:
    'The camera link is not available. Start the camera bridge (run_all.bat does), and close the Arduino Serial Monitor and live.py: only one program can use the camera.',
  nanoNotLinked:
    'No camera board found. Plug it in with a data USB cable, then check the camera bridge window and .env.',

  webcamAsking: 'Waiting for camera permission.',
  webcamDenied: 'Camera access is blocked. Allow it in the address bar, then reload the page.',
  webcamNone: 'No camera found. Connect the webcam, then reload.',
  webcamBusy: 'The camera is in use by another app. Close it, then choose the camera again.',
  webcamInsecure:
    'This page needs https or localhost to use the camera. Open it at http://localhost:3000.',

  backendUnreachable: (url: string) =>
    `Can't reach the classifier service at ${url}. Start it with run_all.bat.`,

  // The header notice while live data is not flowing.
  unreachableTitle: 'Classifier service unreachable',
  retrying: 'The console keeps trying by itself.',
  pausedTitle: 'Live updates paused',
  pausedBody: (since: string) =>
    `The live connection dropped ${since} ago and is reconnecting by itself.`,
  lastKnownCounts: 'The counts shown are the last ones received and may be behind.',
  liveResumed: 'Live updates resumed.',

  errorTitle: 'Something went wrong on this page',
  errorBody: 'The page hit an error and stopped updating.',
  errorCountsSafe: 'The counts are safe: the classifier service keeps them, not this page.',
  errorRetry: 'Try again',
  errorReload: 'Reload the console',
  notFoundTitle: 'Page not found',
  notFoundBody: 'There is no page at this address.',

  linkOpen: 'Linked',
  linkClosed: 'Not linked',
  heartbeatStale: 'Camera not responding',
  linkReconnecting: 'Reconnecting',
  linkUnreachable: 'Service unreachable',
  streamPaused: 'Live updates paused. Reconnecting by itself.',
  deviceReset: (n: number) =>
    n === 1
      ? 'The camera board restarted once during this run. Counts before and after are kept.'
      : `The camera board restarted ${n} times during this run. Counts before and after are kept.`,
  liveBanner: 'Live',
  simulatedBanner: 'Simulated data',
  replayBanner: 'Replay of a recorded session',
  notMeasured: 'Not measured yet',
  unsureNote: 'Not confident enough to pick a bin, so it is counted in neither.',
  inferenceLabel: 'Model inference time',
} as const;
