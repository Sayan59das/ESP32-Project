// Every user-facing sentence from the wording table, in one place.

export const copy = {
  startNewRun: 'Start new run',
  confirmTitle: 'Start a new run?',
  confirmBody:
    'This resets the counts on screen. The current run stays saved and in the CSV export.',
  confirmKeep: 'Keep current run',
  newRunStarted: 'New run started.',
  emptyLastItem: 'No items sorted yet. Place an object under the sensor.',
  emptyRecent: 'Sorted items will appear here.',

  classifierTitle: 'Classifier view (OV7675)',
  classifierNote: 'The 96 by 96 grayscale frame the model classifies, enlarged.',
  webcamTitle: 'Webcam',
  webcamNote: 'A laptop webcam view of the rig. The classifier does not use this image.',
  sourceClassifier: 'Classifier view',
  sourceWebcam: 'Webcam',

  classifierWaiting: 'Waiting for the first frame from the Nano.',
  classifierNoFrames: 'No frames are arriving. Check the USB cable, then press reset on the Nano.',
  portBusy:
    "Another program is using the Nano's serial port. Close the Arduino Serial Monitor and any Edge Impulse tool, then reload.",
  nanoNotLinked: 'No Nano found. Plug it in with a data USB cable and check SERIAL_PORT in .env.',

  webcamAsking: 'Waiting for camera permission.',
  webcamDenied: 'Camera access is blocked. Allow it in the address bar, then reload the page.',
  webcamNone: 'No camera found. Connect the webcam, then reload.',
  webcamBusy: 'The camera is in use by another app. Close it, then choose the camera again.',
  webcamInsecure:
    'This page needs https or localhost to use the camera. Open it at http://localhost:3000.',

  backendUnreachable: (url: string) =>
    `Can't reach the classifier service at ${url}. Start it with: make dev`,

  linkOpen: 'Linked',
  linkClosed: 'Not linked',
  heartbeatStale: 'Nano not responding',
  streamPaused: 'Live updates paused. Reconnecting.',
  simulatedBanner: 'Simulated data',
  replayBanner: 'Replay of a recorded session',
  notMeasured: 'Not measured yet',
  noRate: '–',
} as const;
