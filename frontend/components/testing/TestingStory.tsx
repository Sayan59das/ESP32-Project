import Link from 'next/link';
import type { ReactNode } from 'react';

import { ChapterNav } from '@/components/scene/ChapterNav';
import { Kicker } from '@/components/scene/Kicker';
import { Stage } from '@/components/scene/Stage';
import styles from '@/components/scene/Story.module.css';
import { SiteHeader } from '@/components/SiteHeader';
import { buttonClass } from '@/components/ui/Button';
import { NotMeasured } from '@/components/ui/Measured';
import { copy } from '@/lib/copy';
import type { TestingData } from '@/lib/testing';

import { type Dataset, factsOf, number, recordedOn } from './derive';
import { testingLabels } from './labels';
import { Results } from './Results';
import mine from './TestingStory.module.css';

// The words of the testing story. DRAFT, like the home story: written from what the project's
// own scripts and tests do, with every figure taken from data/testing.json. Edit freely.

const CHAPTERS = [
  { label: 'Tested, and shown' },
  { label: 'What is checked' },
  { label: 'When the camera goes dark' },
  { label: 'What it learned' },
  { label: 'The real rig' },
  { label: 'Run it again' },
];

function Figure({ value, label }: { value: ReactNode | null; label: string }) {
  return (
    <div className={mine.figure}>
      <dt>{label}</dt>
      <dd>{value ?? <NotMeasured />}</dd>
    </div>
  );
}

function heldBackSentence(dataset: Dataset): string {
  return dataset.right === dataset.heldBack
    ? `the model got all ${number(dataset.heldBack)} right`
    : `the model got ${number(dataset.right)} of ${number(dataset.heldBack)} right`;
}

export function TestingStory({ testing }: { testing: TestingData }) {
  const facts = factsOf(testing);
  const { sum, scenarios, dataset } = facts;
  const when = recordedOn(testing.recordedAt);

  const stageData = {
    suites: (testing.suites ?? []).map((s) => ({
      label: s.label,
      passed: s.passed,
      failed: s.failed,
    })),
    scenarios: (testing.scenarios ?? []).map((s) => ({
      id: s.id,
      passed: s.passed,
      counted: s.counted,
    })),
    dataset: dataset === null ? null : { recyclable: dataset.recyclable, trash: dataset.trash },
    media: (testing.media ?? []).map((m) => ({ kind: m.kind, file: m.file })),
  };

  return (
    <>
      <SiteHeader current="testing" floating />
      <Stage scene="testing" labels={testingLabels(testing)} data={stageData} />
      <ChapterNav chapters={CHAPTERS} />

      <main id="main" className={styles.main}>
        {/* 0 */}
        <section
          id="chapter-0"
          className={`${styles.chapter} ${styles.first}`}
          data-chapter="0"
          aria-labelledby="testing-title"
        >
          <div className={styles.sticky}>
            <div data-avoid className={styles.hero}>
              <p className={styles.heroKicker}>How we know it works</p>
              <h1 id="testing-title" className={styles.heroTitle}>
                <span>Tested,</span> <span className={styles.heroEdge}>and shown.</span>
              </h1>
              <p className={`${styles.heroLede} ${styles.more}`}>
                Every number on this page was measured by a script, not typed in. Where nothing has
                been measured, it says so.
              </p>
              <dl className={mine.figures}>
                <Figure
                  value={sum === null ? null : number(sum.passed)}
                  label="automated checks passed"
                />
                <Figure value={sum === null ? null : number(sum.failed)} label="failed" />
                <Figure
                  value={scenarios === null ? null : `${scenarios.passed} of ${scenarios.total}`}
                  label="camera-off scenarios passed"
                />
              </dl>
              <p className={mine.provenance}>
                {when === null ? (
                  <>
                    <NotMeasured label="Not recorded yet" /> Run{' '}
                    <code>python scripts/record_tests.py</code>.
                  </>
                ) : (
                  <>
                    Recorded {when}
                    {testing.commit ? (
                      <>
                        , commit <code>{testing.commit}</code>
                      </>
                    ) : null}
                    .
                  </>
                )}
              </p>
              <div className={styles.actions}>
                <a href="#results" className={buttonClass('primary')}>
                  See the full results
                </a>
                <Link href="/" className={buttonClass('secondary')}>
                  Back to the story
                </Link>
              </div>
            </div>
            <p className={styles.scrollHint} aria-hidden="true">
              <span>Scroll</span>
              <i />
            </p>
          </div>
        </section>

        {/* 1 */}
        <section
          id="chapter-1"
          className={styles.chapter}
          data-chapter="1"
          aria-labelledby="checks-title"
        >
          <div className={styles.sticky}>
            <article data-avoid className={`${styles.card} ${styles.left}`}>
              <Kicker n={2}>What is checked</Kicker>
              <h2 id="checks-title" className={styles.title}>
                Four sets of automated checks.
              </h2>
              <p>
                The backend and the camera bridge, the console&rsquo;s own logic, the whole site in
                a real browser, and every pair of colours for contrast. One script runs them all and
                saves what happened.
              </p>
              {testing.suites === null ? (
                <p>
                  <NotMeasured />
                </p>
              ) : (
                <ul className={styles.facts}>
                  {testing.suites.map((suite) => (
                    <li key={suite.id}>
                      <strong>{suite.label}</strong>: {number(suite.passed)} passed,{' '}
                      {number(suite.failed)} failed
                    </li>
                  ))}
                </ul>
              )}
            </article>
          </div>
        </section>

        {/* 2 */}
        <section
          id="chapter-2"
          className={styles.chapter}
          data-chapter="2"
          aria-labelledby="dark-title"
        >
          <div className={`${styles.sticky} ${styles.stickyBottom}`}>
            <article data-avoid className={`${styles.card} ${styles.wide}`}>
              <Kicker n={3}>When the camera goes dark</Kicker>
              <h2 id="dark-title" className={styles.title}>
                Switch the camera off. Nothing is counted.
              </h2>
              <p>
                A camera that stops showing a picture must never produce a count. We feed the real
                model and the real counting gate seven kinds of bad picture: switched off, covered,
                the lights out, flat grey, frozen, unplugged, and back on again.
              </p>
              <ul className={styles.facts}>
                <li>
                  {scenarios === null ? (
                    <NotMeasured />
                  ) : (
                    <>
                      <strong>
                        {scenarios.passed} of {scenarios.total}
                      </strong>{' '}
                      scenarios passed
                    </>
                  )}
                </li>
                <li>
                  <strong>Zero</strong> items counted while the picture was dead
                </li>
                <li>
                  <strong>One</strong> item counted, once, when the picture came back
                </li>
              </ul>
            </article>
          </div>
        </section>

        {/* 3 */}
        <section
          id="chapter-3"
          className={styles.chapter}
          data-chapter="3"
          aria-labelledby="learned-title"
        >
          <div className={styles.sticky}>
            <article data-avoid className={`${styles.card} ${styles.right}`}>
              <Kicker n={4}>What it learned</Kicker>
              <h2 id="learned-title" className={styles.title}>
                Tested on frames it never trained on.
              </h2>
              {dataset === null ? (
                <p>
                  <NotMeasured />
                </p>
              ) : (
                <>
                  <ul className={styles.facts}>
                    <li>
                      <strong>{number(dataset.frames)}</strong> frames, all photographed by us:{' '}
                      {number(dataset.recyclable.training + dataset.recyclable.validation)}{' '}
                      recyclable, {number(dataset.trash.training + dataset.trash.validation)}{' '}
                      non-recyclable
                    </li>
                    <li>
                      <strong>{number(dataset.heldBack)}</strong> held back to test:{' '}
                      {heldBackSentence(dataset)}
                    </li>
                    {dataset.parameters === null ? null : (
                      <li>
                        <strong>{number(dataset.parameters)}</strong> parameters in the network
                      </li>
                    )}
                  </ul>
                  <p className={`${styles.note} ${styles.more}`}>
                    The held-back frames come from the same sessions as the others, so this score is
                    optimistic. It shows the model can tell these two kinds of thing apart in our
                    setup, not that it will do as well on other items in other rooms.
                  </p>
                </>
              )}
            </article>
          </div>
        </section>

        {/* 4 */}
        <section
          id="chapter-4"
          className={styles.chapter}
          data-chapter="4"
          aria-labelledby="rig-title"
        >
          <div className={styles.sticky}>
            <article data-avoid className={`${styles.card} ${styles.left}`}>
              <Kicker n={5}>The real rig</Kicker>
              <h2 id="rig-title" className={styles.title}>
                Photographs and video of the rig.
              </h2>
              {facts.media === 0 ? (
                <>
                  <p>
                    <NotMeasured label={copy.notAdded} />
                  </p>
                  <p className={styles.more}>
                    The frames stand empty until real files are added: put them in{' '}
                    <code>frontend/public/testing</code> and list them in{' '}
                    <code>data/testing.json</code>. Nothing is shown here that was not put here.
                  </p>
                </>
              ) : (
                <p>
                  {facts.media} {facts.media === 1 ? 'file' : 'files'} from the real rig, shown in
                  full below.
                </p>
              )}
            </article>
          </div>
        </section>

        {/* 5 */}
        <section
          id="chapter-5"
          className={`${styles.chapter} ${styles.last}`}
          data-chapter="5"
          aria-labelledby="again-title"
        >
          <div className={styles.sticky}>
            <article data-avoid className={`${styles.card} ${styles.right}`}>
              <Kicker n={6}>Run it again</Kicker>
              <h2 id="again-title" className={styles.title}>
                Re-run all of it.
              </h2>
              <p>
                One command runs every check, replays the camera-off scenarios and saves the
                results. Reload this page and the numbers follow.
              </p>
              <p>
                <code>python scripts/record_tests.py</code>
              </p>
              <div className={styles.actions}>
                <a href="#results" className={buttonClass('primary')}>
                  The full results
                </a>
                <Link href="/console" className={buttonClass('secondary')}>
                  Open the console
                </Link>
              </div>
            </article>
          </div>
        </section>

        <Results testing={testing} facts={facts} when={when} />
      </main>
    </>
  );
}
