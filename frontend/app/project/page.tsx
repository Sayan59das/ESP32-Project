import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { FlowDiagram } from '@/components/FlowDiagram';
import { SiteHeader } from '@/components/SiteHeader';
import { copy } from '@/lib/copy';
import { type Credit, type Metrics, labelText, parseMetrics } from '@/lib/metrics';

import styles from './project.module.css';

export const metadata: Metadata = { title: 'Project, EcoSort Edge' };

// Read on every request, so editing data/metrics.json only needs a reload.
export const dynamic = 'force-dynamic';

const METRICS_FILE = path.resolve(process.cwd(), '..', 'data', 'metrics.json');

async function loadMetrics(): Promise<{ metrics: Metrics; problem: string | null }> {
  let raw: string;
  try {
    raw = await readFile(METRICS_FILE, 'utf8');
  } catch {
    return {
      metrics: parseMetrics(null),
      problem: 'data/metrics.json was not found, so nothing below is shown as measured.',
    };
  }
  try {
    return { metrics: parseMetrics(JSON.parse(raw)), problem: null };
  } catch {
    return {
      metrics: parseMetrics(null),
      problem: 'data/metrics.json is not valid JSON, so nothing below is shown as measured.',
    };
  }
}

const accuracy = (v: number) => `${(v * 100).toFixed(1)}%`;

function show<T>(value: T | null, format: (v: T) => ReactNode): ReactNode {
  return value === null ? (
    <span className={styles.missing}>{copy.notMeasured}</span>
  ) : (
    format(value)
  );
}

const SOFTWARE: Credit[] = [
  { name: 'Archivo typeface, Omnibus-Type', licence: 'SIL Open Font License 1.1', url: null },
  { name: 'Next.js and React', licence: 'MIT', url: null },
  { name: 'FastAPI', licence: 'MIT', url: null },
  { name: 'pyserial', licence: 'BSD-3-Clause', url: null },
  { name: 'Pillow', licence: 'MIT-CMU', url: null },
];

function CreditList({ items }: { items: Credit[] }) {
  return (
    <ul className={styles.list}>
      {items.map((c) => (
        <li key={c.name}>
          {c.url ? <a href={c.url}>{c.name}</a> : c.name}, {c.licence}
        </li>
      ))}
    </ul>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <tr>
      <th scope="row" className={styles.head}>
        {label}
      </th>
      <td className={styles.cell}>{children}</td>
    </tr>
  );
}

export default async function ProjectPage() {
  const { metrics: m, problem } = await loadMetrics();
  const classes = [
    ...new Set([
      ...Object.keys(m.test_images_per_class ?? {}),
      ...Object.keys(m.test_accuracy_per_class ?? {}),
    ]),
  ];
  const matrix = m.confusion_matrix;

  return (
    <>
      <SiteHeader current="project" />
      <main className={styles.main}>
        <h1 className={styles.h1}>How EcoSort Edge works</h1>
        {problem !== null ? <p className={styles.problem}>{problem}</p> : null}

        <section className={styles.section} aria-labelledby="what">
          <h2 id="what" className={styles.h2}>
            What it does and why it runs on the device
          </h2>
          <p className={styles.prose}>
            EcoSort Edge sorts single items of waste into recyclable or trash. An Arduino Nano 33
            BLE Sense Lite waits for an infrared sensor to see an object, takes a frame with its
            OV7675 camera, and classifies it on the microcontroller as a can, a glass bottle, a pen
            or a phone case. A lookup table, not the model, decides which bin each item goes in:
            cans and glass bottles are recyclable, pens and phone cases are trash.
          </p>
          <p className={styles.prose}>
            Classifying on the board means no image has to leave it, no network is needed, and the
            answer never waits on a server. The laptop only listens: a small bridge reads the
            Nano&rsquo;s USB serial output, checks it, stores every verdict with the frame the model
            saw, and serves the console.
          </p>
        </section>

        <section className={styles.section} aria-labelledby="how">
          <h2 id="how" className={styles.h2}>
            How one item gets sorted
          </h2>
          <FlowDiagram />
        </section>

        <section className={styles.section} aria-labelledby="results">
          <h2 id="results" className={styles.h2}>
            Results
          </h2>
          <p className={styles.note}>
            Every value comes from data/metrics.json. A value that has not been measured says so.
          </p>
          {classes.length > 0 ? (
            <table className={styles.table}>
              <caption className={styles.caption}>Per class, on the test set</caption>
              <thead>
                <tr>
                  <th scope="col" className={styles.head}>
                    Item
                  </th>
                  <th scope="col" className={`${styles.head} ${styles.num}`}>
                    Test images
                  </th>
                  <th scope="col" className={`${styles.head} ${styles.num}`}>
                    Test accuracy
                  </th>
                </tr>
              </thead>
              <tbody>
                {classes.map((label) => (
                  <tr key={label}>
                    <th scope="row" className={styles.head}>
                      {labelText(label)}
                    </th>
                    <td className={styles.num}>
                      {show(m.test_images_per_class?.[label] ?? null, String)}
                    </td>
                    <td className={styles.num}>
                      {show(m.test_accuracy_per_class?.[label] ?? null, accuracy)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className={styles.prose}>
              Test images and accuracy per class:{' '}
              <span className={styles.missing}>{copy.notMeasured}</span>
            </p>
          )}
          <table className={styles.table}>
            <caption className={styles.caption}>The model on the Nano</caption>
            <tbody>
              <Row label="Overall test accuracy">{show(m.overall_test_accuracy, accuracy)}</Row>
              <Row label="Inference time, median">{show(m.latency_ms_p50, (v) => `${v} ms`)}</Row>
              <Row label="Inference time, 95th percentile">
                {show(m.latency_ms_p95, (v) => `${v} ms`)}
              </Row>
              <Row label="Peak RAM">{show(m.ram_kb_peak, (v) => `${v} KB`)}</Row>
              <Row label="Flash">{show(m.flash_kb, (v) => `${v} KB`)}</Row>
              <Row label="Model input">{show(m.model_input, String)}</Row>
              <Row label="Model architecture">{show(m.model_architecture, String)}</Row>
              <Row label="Dataset notes">{show(m.dataset_notes, String)}</Row>
            </tbody>
          </table>
          <p className={styles.note}>
            Inference time is measured on the Nano for the classifier alone. It is not the time from
            an object arriving to its count changing on screen.
          </p>
        </section>

        <section className={styles.section} aria-labelledby="confusion">
          <h2 id="confusion" className={styles.h2}>
            Confusion matrix
          </h2>
          {matrix === null ? (
            <p className={styles.prose}>No confusion matrix in data/metrics.json yet.</p>
          ) : (
            <div className={styles.scroll} role="region" aria-labelledby="confusion" tabIndex={0}>
              <table className={styles.matrix}>
                <caption className={styles.caption}>
                  Rows are the true item, columns what the model predicted. The diagonal is correct.
                </caption>
                <thead>
                  <tr>
                    <td className={styles.cell} />
                    {matrix.labels.map((label) => (
                      <th key={label} scope="col" className={`${styles.head} ${styles.num}`}>
                        {labelText(label)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {matrix.rows.map((row, r) => (
                    <tr key={matrix.labels[r]}>
                      <th scope="row" className={styles.head}>
                        {labelText(matrix.labels[r] ?? '')}
                      </th>
                      {row.map((cell, c) => (
                        <td key={c} className={r === c ? styles.diagonal : styles.num}>
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className={styles.section} aria-labelledby="limits">
          <h2 id="limits" className={styles.h2}>
            Known limits
          </h2>
          <ul className={styles.list}>
            <li>
              We know four items. Anything else is forced into one of them, or reported as unsure
              when the score is low; the model cannot say &ldquo;this is something new&rdquo;.
            </li>
            <li>
              At 96 by 96 pixels a pen is only a few pixels wide, so how it lies under the camera
              matters more than for the other items.
            </li>
            <li>
              Glass is hard in grayscale: a clear bottle is mostly reflections and the background
              showing through it.
            </li>
            <li>
              Our test images come from the same fixed rig, light and background as the training
              images, so the test accuracy says little about a different bin, light or angle.
            </li>
            <li>
              The counts assume the firmware&rsquo;s debounce holds, one object for one trigger. An
              object that lingers or bounces could be counted twice.
            </li>
            <li>
              The console shows the 96 by 96 grayscale frame the model reads, not full-resolution
              video.
            </li>
          </ul>
        </section>

        <section className={styles.section} aria-labelledby="parts">
          <h2 id="parts" className={styles.h2}>
            Wiring and parts
          </h2>
          <ul className={styles.list}>
            <li>Arduino Nano 33 BLE Sense Lite</li>
            <li>OV7675 camera module</li>
            <li>
              Infrared proximity sensor
              {m.ir_sensor ? `: ${m.ir_sensor}` : ' (model not recorded yet)'}
            </li>
            <li>USB data cable to the laptop (a charge-only cable carries no data)</li>
            <li>
              ESP32, optional: receives a text copy of the EVT lines on the Nano&rsquo;s Serial1 for
              a separate wireless dashboard. This console does not need it.
            </li>
          </ul>
          {m.wiring === null ? (
            <p className={styles.prose}>
              Pin connections are not recorded yet. Add them to data/metrics.json as wiring.
            </p>
          ) : (
            <table className={styles.table}>
              <caption className={styles.caption}>Connections</caption>
              <thead>
                <tr>
                  <th scope="col" className={styles.head}>
                    From
                  </th>
                  <th scope="col" className={styles.head}>
                    To
                  </th>
                  <th scope="col" className={styles.head}>
                    Note
                  </th>
                </tr>
              </thead>
              <tbody>
                {m.wiring.map((w) => (
                  <tr key={`${w.from}-${w.to}`}>
                    <td className={styles.cell}>{w.from}</td>
                    <td className={styles.cell}>{w.to}</td>
                    <td className={styles.cell}>{w.note ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className={styles.section} aria-labelledby="credits">
          <h2 id="credits" className={styles.h2}>
            Credits and licences
          </h2>
          <h3 className={styles.h3}>Datasets</h3>
          {m.datasets === null ? (
            <p className={styles.prose}>No public dataset is listed in data/metrics.json.</p>
          ) : (
            <CreditList items={m.datasets} />
          )}
          <h3 className={styles.h3}>Software and type</h3>
          <CreditList items={[...SOFTWARE, ...(m.credits ?? [])]} />
        </section>
      </main>
    </>
  );
}
