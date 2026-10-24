import { Badge } from '@/components/ui/Badge';
import { NotMeasured } from '@/components/ui/Measured';
import { copy } from '@/lib/copy';
import type { Scenario, Suite, TestingData } from '@/lib/testing';

import { type Facts, number } from './derive';
import styles from './Results.module.css';

// The full figures, on a plain page below the story: every number the 3D scene and the words
// above are made from, with what each one is and when it was recorded.

function SuiteCard({ suite }: { suite: Suite }) {
  const clean = suite.failed === 0;
  return (
    <li className={styles.card}>
      <div className={styles.cardHead}>
        <h4 className={styles.cardTitle}>{suite.label}</h4>
        {clean ? (
          <Badge tone="recyclable" icon="counted">
            All passed
          </Badge>
        ) : (
          <Badge tone="alert" icon="alert">
            {number(suite.failed)} failed
          </Badge>
        )}
      </div>
      <p>{suite.what}</p>
      <dl className={styles.stats}>
        <div>
          <dt>Passed</dt>
          <dd>{number(suite.passed)}</dd>
        </div>
        <div>
          <dt>Failed</dt>
          <dd>{number(suite.failed)}</dd>
        </div>
        <div>
          <dt>Skipped</dt>
          <dd>{number(suite.skipped)}</dd>
        </div>
        <div>
          <dt>Time</dt>
          <dd>{suite.seconds === null ? <NotMeasured /> : `${suite.seconds.toFixed(1)} s`}</dd>
        </div>
      </dl>
    </li>
  );
}

function ScenarioCard({ scenario }: { scenario: Scenario }) {
  return (
    <li className={styles.card}>
      <div className={styles.cardHead}>
        <h4 className={styles.cardTitle}>{scenario.title}</h4>
        {scenario.passed ? (
          <Badge tone="recyclable" icon="counted">
            Passed
          </Badge>
        ) : (
          <Badge tone="alert" icon="alert">
            Failed
          </Badge>
        )}
      </div>
      <p>{scenario.what}</p>
      <dl className={styles.stats}>
        <div>
          <dt>Items counted</dt>
          <dd>{number(scenario.counted)}</dd>
        </div>
        <div>
          <dt>The console is told</dt>
          <dd>{scenario.alive ? 'Camera responding' : 'Camera not responding'}</dd>
        </div>
        <div>
          <dt>The bridge reported</dt>
          <dd>{scenario.reported ?? 'Nothing wrong'}</dd>
        </div>
      </dl>
      <p className={styles.expect}>
        <strong>Must:</strong> {scenario.expectation}
      </p>
    </li>
  );
}

export function Results({
  testing,
  facts,
  when,
}: {
  testing: TestingData;
  facts: Facts;
  when: string | null;
}) {
  const { dataset } = facts;
  const classes = dataset
    ? [
        { name: 'Recyclable', ...dataset.recyclable },
        { name: 'Non-recyclable', ...dataset.trash },
      ]
    : [];

  return (
    <section
      id="results"
      className={styles.results}
      aria-labelledby="results-title"
      data-covers-stage
    >
      <div className={styles.inner}>
        <header className={styles.intro}>
          <h2 id="results-title" className={styles.h2}>
            The full results
          </h2>
          <p className={styles.provenance}>
            {when === null ? (
              <>
                <NotMeasured label="Not recorded yet" /> Run{' '}
                <code>python scripts/record_tests.py</code> to record them.
              </>
            ) : (
              <>
                Recorded {when}
                {testing.commit ? (
                  <>
                    , commit <code>{testing.commit}</code>
                  </>
                ) : null}
                . A commit marked &ldquo;uncommitted changes&rdquo; was run on files not yet saved
                to git.
              </>
            )}
          </p>
        </header>

        <section aria-labelledby="r-suites" className={styles.block}>
          <h3 id="r-suites" className={styles.h3}>
            Automated checks
          </h3>
          {testing.suites === null ? (
            <p>
              <NotMeasured />
            </p>
          ) : (
            <ul className={styles.cards}>
              {testing.suites.map((suite) => (
                <SuiteCard key={suite.id} suite={suite} />
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="r-dark" className={styles.block}>
          <h3 id="r-dark" className={styles.h3}>
            When the camera goes dark
          </h3>
          {testing.scenarioNote ? <p className={styles.lede}>{testing.scenarioNote}</p> : null}
          {testing.scenarios === null ? (
            <p>
              <NotMeasured />
            </p>
          ) : (
            <ul className={styles.cards}>
              {testing.scenarios.map((scenario) => (
                <ScenarioCard key={scenario.id} scenario={scenario} />
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="r-model" className={styles.block}>
          <h3 id="r-model" className={styles.h3}>
            The model and its photographs
          </h3>
          {dataset === null ? (
            <p>
              <NotMeasured />
            </p>
          ) : (
            <>
              <table className={styles.table}>
                <caption className="visually-hidden">
                  Frames used to teach the model and to test it, by class
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Class</th>
                    <th scope="col">Taught with</th>
                    <th scope="col">Held back to test</th>
                    <th scope="col">Answered right</th>
                  </tr>
                </thead>
                <tbody>
                  {classes.map((c) => (
                    <tr key={c.name}>
                      <th scope="row">{c.name}</th>
                      <td>{number(c.training)}</td>
                      <td>{number(c.validation)}</td>
                      <td>
                        {number(c.correct)} of {number(c.validation)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row">Both</th>
                    <td>{number(dataset.frames - dataset.heldBack)}</td>
                    <td>{number(dataset.heldBack)}</td>
                    <td>
                      {number(dataset.right)} of {number(dataset.heldBack)}
                    </td>
                  </tr>
                </tfoot>
              </table>
              <p className={styles.lede}>
                {dataset.parameters === null
                  ? null
                  : `The network has ${number(dataset.parameters)} parameters. `}
                The held-back frames were photographed in the same sessions as the others, so this
                score is optimistic: it shows the model can tell these two kinds of thing apart in
                our setup, not that it will do as well on other items in other rooms.
              </p>
            </>
          )}
        </section>

        <section aria-labelledby="r-rig" className={styles.block}>
          <h3 id="r-rig" className={styles.h3}>
            The real rig
          </h3>
          {testing.media === null ? (
            <ul className={styles.cards}>
              {['A photograph of the rig', 'A video of it counting an item'].map((what) => (
                <li key={what} className={styles.slot}>
                  <p>{what}</p>
                  <NotMeasured label={copy.notAdded} />
                </li>
              ))}
            </ul>
          ) : (
            <ul className={styles.cards}>
              {testing.media.map((item) => (
                <li key={item.file} className={styles.media}>
                  <figure>
                    {item.kind === 'image' ? (
                      // eslint-disable-next-line @next/next/no-img-element -- a file served from this site
                      <img src={`/testing/${item.file}`} alt={item.caption} loading="lazy" />
                    ) : (
                      <video
                        src={`/testing/${item.file}`}
                        controls
                        preload="none"
                        aria-label={item.caption}
                      />
                    )}
                    <figcaption>{item.caption}</figcaption>
                  </figure>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="r-how" className={styles.block}>
          <h3 id="r-how" className={styles.h3}>
            How this was recorded
          </h3>
          <p className={styles.lede}>
            <code>python scripts/record_tests.py</code> runs each suite and writes{' '}
            <code>data/testing.json</code>, which is the only place this page reads. It replays the
            camera-off scenarios with the real trained model on a scene built from our own training
            frames, and counts the model&rsquo;s held-back frames. Add <code>--skip browser</code>{' '}
            to leave out the slow browser suite; a part that is not run keeps its last recorded
            figures.
          </p>
        </section>
      </div>
    </section>
  );
}
