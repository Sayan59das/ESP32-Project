import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type { CSSProperties, ReactNode } from 'react';
import type { Metadata } from 'next';

import { FlowDiagram } from '@/components/FlowDiagram';
import { OUTCOMES } from '@/components/outcome';
import { SiteHeader } from '@/components/SiteHeader';
import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { measured, NotMeasured } from '@/components/ui/Measured';
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
const ms = (v: number) => `${v} ms`;
const kb = (v: number) => `${v} KB`;

const SECTIONS = [
  { id: 'what', title: 'What it does and how it works' },
  { id: 'how', title: 'How one item gets sorted' },
  { id: 'results', title: 'Results' },
  { id: 'confusion', title: 'Confusion matrix' },
  { id: 'limits', title: 'Known limits' },
  { id: 'parts', title: 'Wiring and parts' },
  { id: 'credits', title: 'Credits and licences' },
] as const;

type SectionId = (typeof SECTIONS)[number]['id'];

const TYPEFACES: Credit[] = [
  {
    name: 'Archivo, The Archivo Project Authors (Omnibus-Type)',
    licence: 'SIL Open Font License 1.1',
    url: null,
  },
  {
    name: 'Atkinson Hyperlegible Next, The Atkinson Hyperlegible Next Project Authors',
    licence: 'SIL Open Font License 1.1',
    url: null,
  },
];

const WEBSITE_SOFTWARE: Credit[] = [
  { name: 'Next.js and React', licence: 'MIT', url: null },
  { name: 'FastAPI', licence: 'MIT', url: null },
  { name: 'Uvicorn', licence: 'BSD-3-Clause', url: null },
  { name: 'Pydantic', licence: 'MIT', url: null },
  { name: 'pyserial', licence: 'BSD-3-Clause', url: null },
  { name: 'Pillow', licence: 'MIT-CMU', url: null },
  { name: 'NumPy, which runs the model', licence: 'BSD-3-Clause', url: null },
];

const TRAINING_SOFTWARE: Credit[] = [
  { name: 'PyTorch and torchvision', licence: 'BSD-3-Clause', url: null },
  { name: 'OpenCV', licence: 'Apache-2.0', url: null },
  { name: 'scikit-learn', licence: 'BSD-3-Clause', url: null },
  { name: 'Matplotlib', licence: 'Matplotlib License (PSF-based)', url: null },
];

function CreditList({ items }: { items: Credit[] }) {
  return (
    <ul className={styles.credits}>
      {items.map((c) => (
        <li key={c.name}>
          <span className={styles.creditName}>{c.url ? <a href={c.url}>{c.name}</a> : c.name}</span>
          <span className={styles.creditLicence}>{c.licence}</span>
        </li>
      ))}
    </ul>
  );
}

function Section({ id, children }: { id: SectionId; children: ReactNode }) {
  const title = SECTIONS.find((s) => s.id === id)?.title ?? id;
  return (
    <section className={styles.section} id={id} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className={styles.h2}>
        {title}
      </h2>
      {children}
    </section>
  );
}

/** A large measured value with its label, or "Not measured yet". */
function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.stat}>
      <dt className={styles.statLabel}>{label}</dt>
      <dd className={styles.statValue}>{children}</dd>
    </div>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.detail}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
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
        <div className={styles.intro}>
          <h1 className={styles.h1}>How EcoSort Edge works</h1>
          <p className={styles.lede}>
            A camera, a small neural network and one laptop that sort single items of waste into
            recyclable or non-recyclable, and count each one once.
          </p>
          <dl className={styles.facts}>
            <div className={styles.fact}>
              <dt>Camera</dt>
              <dd>OV7675, 160 by 120 grayscale</dd>
            </div>
            <div className={styles.fact}>
              <dt>The model&rsquo;s answers</dt>
              <dd>Recyclable or non-recyclable</dd>
            </div>
            <div className={styles.fact}>
              <dt>Unsure</dt>
              <dd>Below 60% confidence, counted in neither bin</dd>
            </div>
            <div className={styles.fact}>
              <dt>Network</dt>
              <dd>None. Everything runs on this laptop</dd>
            </div>
          </dl>
          <nav className={styles.toc} aria-label="On this page">
            <p className={styles.tocTitle}>On this page</p>
            <ol className={styles.tocList}>
              {SECTIONS.map((s) => (
                <li key={s.id}>
                  <a href={`#${s.id}`}>{s.title}</a>
                </li>
              ))}
            </ol>
          </nav>
        </div>

        {problem !== null ? (
          <p className={styles.problem}>
            <Icon name="alert" size={20} />
            <span>{problem}</span>
          </p>
        ) : null}

        <Section id="what">
          <p className={styles.prose}>
            EcoSort Edge sorts single items of waste into recyclable or non-recyclable. An OV7675
            camera on an Arduino streams small grayscale frames to the laptop over USB. A small
            neural network trained on our own photos labels each frame, and when an item is placed
            in view it is counted once, in the matching bin. A lookup table in the website bridge,
            not the model, decides which bin a label belongs to.
          </p>
          <p className={styles.prose}>
            Everything runs on this one laptop with no network. The camera bridge reads the camera
            and runs the model. The website bridge checks each verdict, stores it with the frame the
            model saw, keeps the counts and serves this console. The browser never adds to a
            counter.
          </p>
        </Section>

        <Section id="how">
          <FlowDiagram />
          <h3 className={styles.h3}>Three outcomes</h3>
          <ul className={styles.outcomes}>
            <li>
              <Badge tone={OUTCOMES.recyclable.tone} icon={OUTCOMES.recyclable.icon}>
                {OUTCOMES.recyclable.word}
              </Badge>
              <span>Counted in the recyclable bin.</span>
            </li>
            <li>
              <Badge tone={OUTCOMES.trash.tone} icon={OUTCOMES.trash.icon}>
                {OUTCOMES.trash.word}
              </Badge>
              <span>Non-recyclable items, counted in the trash bin.</span>
            </li>
            <li>
              <Badge tone={OUTCOMES.unsure.tone} icon={OUTCOMES.unsure.icon}>
                {OUTCOMES.unsure.word}
              </Badge>
              <span>
                The model is less than 60% sure. Shown, but counted in neither bin; remove the item
                as usual.
              </span>
            </li>
          </ul>
        </Section>

        <Section id="results">
          {/* The honest reading comes first, before any number. */}
          <div className={styles.caution} role="note" aria-labelledby="caution-title">
            <p id="caution-title" className={styles.cautionTitle}>
              Read any accuracy here with care
            </p>
            <p>
              The model has only been checked on validation frames from the same capture sessions as
              its training frames: the same rig, the same light, the same background. A score on
              frames like those is optimistic. Expect lower accuracy with a different bin, different
              light or a different angle. A fair figure needs test frames captured separately.
            </p>
          </div>
          <p className={styles.note}>
            Every value below comes from data/metrics.json. A value that has not been measured says
            so.
          </p>
          <dl className={styles.stats}>
            <Stat label="Overall test accuracy">{measured(m.overall_test_accuracy, accuracy)}</Stat>
            <Stat label="Inference time, median">{measured(m.latency_ms_p50, ms)}</Stat>
            <Stat label="Inference time, 95th percentile">{measured(m.latency_ms_p95, ms)}</Stat>
          </dl>
          <p className={styles.note}>
            Inference time is the model alone on one frame, wherever it runs (by default the camera
            bridge on this laptop). It is not the time from placing an item to its count changing on
            screen.
          </p>

          <h3 className={styles.h3}>Per class, on the test set</h3>
          {classes.length > 0 ? (
            <table className={styles.table}>
              <caption className="visually-hidden">
                Test images and test accuracy for each class
              </caption>
              <thead>
                <tr>
                  <th scope="col" className={styles.head}>
                    Item
                  </th>
                  <th scope="col" className={styles.headNumber}>
                    Test images
                  </th>
                  <th scope="col" className={styles.headNumber}>
                    Test accuracy
                  </th>
                </tr>
              </thead>
              <tbody>
                {classes.map((label) => (
                  <tr key={label}>
                    <th scope="row" className={styles.rowHead}>
                      {labelText(label)}
                    </th>
                    <td className={styles.number}>
                      {measured(m.test_images_per_class?.[label] ?? null, String)}
                    </td>
                    <td className={styles.number}>
                      {measured(m.test_accuracy_per_class?.[label] ?? null, accuracy)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className={styles.inline}>
              Test images and accuracy for each class: <NotMeasured />
            </p>
          )}

          <h3 className={styles.h3}>The model</h3>
          <dl className={styles.details}>
            <Detail label="Model input">{measured(m.model_input, String)}</Detail>
            <Detail label="Model architecture">{measured(m.model_architecture, String)}</Detail>
            <Detail label="Dataset notes">{measured(m.dataset_notes, String)}</Detail>
            <Detail label="Peak RAM, on a board">{measured(m.ram_kb_peak, kb)}</Detail>
            <Detail label="Flash, on a board">{measured(m.flash_kb, kb)}</Detail>
          </dl>
          <p className={styles.note}>
            RAM and flash apply only when the model runs on an Arduino Nano instead of the laptop,
            the optional firmware path.
          </p>
        </Section>

        <Section id="confusion">
          {matrix === null ? (
            <div className={styles.emptyMatrix}>
              <NotMeasured />
              <p className={styles.prose}>
                Add <code>confusion_matrix</code> to data/metrics.json: the labels, then one row for
                each true item giving how often the model predicted each label.
              </p>
            </div>
          ) : (
            <>
              <p id="confusion-note" className={styles.note}>
                Rows are the true item, columns what the model predicted. The diagonal, in bold, is
                correct; the shading is each row&rsquo;s share.
              </p>
              <div
                className={styles.scroll}
                role="region"
                aria-labelledby="confusion-title"
                tabIndex={0}
              >
                <table className={styles.matrix} aria-describedby="confusion-note">
                  <caption className="visually-hidden">Confusion matrix on the test set</caption>
                  <thead>
                    <tr>
                      <td className={styles.corner} />
                      <th scope="colgroup" colSpan={matrix.labels.length} className={styles.axis}>
                        Predicted
                      </th>
                    </tr>
                    <tr>
                      <th scope="col" className={styles.head}>
                        True item
                      </th>
                      {matrix.labels.map((label) => (
                        <th key={label} scope="col" className={styles.headNumber}>
                          {labelText(label)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {matrix.rows.map((row, r) => {
                      const total = row.reduce((sum, cell) => sum + cell, 0);
                      return (
                        <tr key={matrix.labels[r]}>
                          <th scope="row" className={styles.rowHead}>
                            {labelText(matrix.labels[r] ?? '')}
                          </th>
                          {row.map((cell, c) => (
                            <td
                              key={c}
                              className={
                                r === c ? `${styles.cell} ${styles.diagonal}` : styles.cell
                              }
                              style={{ '--share': total > 0 ? cell / total : 0 } as CSSProperties}
                            >
                              {cell}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Section>

        <Section id="limits">
          <ul className={styles.limits}>
            <li>
              The model has two answers, recyclable and non-recyclable. Anything else is forced into
              one of them, or reported as unsure when its confidence is below 60%; it cannot say
              &ldquo;this is something new&rdquo;. It has no &ldquo;empty&rdquo; answer either, so
              the camera bridge recognises an empty view by comparing it with the empty background.
            </li>
            <li>
              The camera is 160 by 120 pixels and grayscale, so thin or small objects are only a few
              pixels wide, and how an object lies in front of the camera matters.
            </li>
            <li>
              Glass is hard in grayscale: a clear bottle is mostly reflections and the background
              showing through it.
            </li>
            <li>
              Every frame so far comes from one rig, one light and one background, so accuracy
              measured on those frames says little about a different bin, light or angle.
            </li>
            <li>
              An item is counted when the view changes from the empty background and the
              model&rsquo;s answer settles, and not again until the view is empty. Start the camera
              bridge with an empty view, and clear the view between items: two items placed one
              straight after the other count as one.
            </li>
            <li>
              The console shows the 160 by 120 grayscale frame the model reads, not full-resolution
              video.
            </li>
          </ul>
        </Section>

        <Section id="parts">
          <ul className={styles.list}>
            <li>An Arduino board streaming the camera, with the OV7675 camera module</li>
            <li>A USB data cable to the laptop (a charge-only cable carries no data)</li>
            <li>A laptop to run the model, both bridges and this console</li>
            {m.ir_sensor !== null ? <li>Trigger sensor: {m.ir_sensor}</li> : null}
          </ul>
          {m.wiring === null ? (
            <p className={styles.note}>
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
                    <td className={styles.text}>{w.from}</td>
                    <td className={styles.text}>{w.to}</td>
                    <td className={styles.text}>{w.note ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        <Section id="credits">
          <h3 className={styles.h3}>Datasets</h3>
          {m.datasets === null ? (
            <p className={styles.prose}>
              The training frames were captured for this project with Model/capture.py. No public
              dataset is listed in data/metrics.json.
            </p>
          ) : (
            <CreditList items={m.datasets} />
          )}
          <h3 className={styles.h3}>Typefaces</h3>
          <CreditList items={TYPEFACES} />
          <h3 className={styles.h3}>Software the website runs on</h3>
          <CreditList items={[...WEBSITE_SOFTWARE, ...(m.credits ?? [])]} />
          <h3 className={styles.h3}>Software used only to train the model</h3>
          <CreditList items={TRAINING_SOFTWARE} />
        </Section>
      </main>
    </>
  );
}
