// Every user-facing sentence from the wording table, in one place.

export const copy = {
  startNewRun: 'Start new run',
  confirmTitle: 'Start a new run?',
  confirmBody:
    'This resets the counts on screen. The current run stays saved and in the CSV export.',
  confirmKeep: 'Keep current run',
  newRunStarted: 'New run started.',
  emptyLastItem: 'No items sorted yet. Place an object in front of the camera.',
  emptyRecent: 'Sorted items will appear here.',

  classifierTitle: 'Classifier view (OV7675)',
  classifierNote: 'The grayscale frame the model classifies, enlarged.',
  webcamTitle: 'Webcam',
  webcamNote: 'A laptop webcam view of the rig. The classifier does not use this image.',
  sourceClassifier: 'Classifier view',
  sourceWebcam: 'Webcam',

  classifierWaiting: 'Waiting for the first frame from the camera.',
  classifierNoFrames:
    "No frames are arriving. Check the camera board's USB cable and that the camera bridge window is running.",
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
    `Can't reach the classifier service at ${url}. Start it with run_all.bat`,

  linkOpen: 'Linked',
  linkClosed: 'Not linked',
  heartbeatStale: 'Camera not responding',
  streamPaused: 'Live updates paused. Reconnecting.',
  simulatedBanner: 'Simulated data',
  replayBanner: 'Replay of a recorded session',
  notMeasured: 'Not measured yet',
  noRate: '–',
} as const;
