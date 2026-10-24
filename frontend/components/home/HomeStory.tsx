import Link from 'next/link';

import { ChapterNav } from '@/components/scene/ChapterNav';
import { Kicker } from '@/components/scene/Kicker';
import { Stage } from '@/components/scene/Stage';
import styles from '@/components/scene/Story.module.css';
import { SiteHeader } from '@/components/SiteHeader';
import { buttonClass } from '@/components/ui/Button';
import { Icon, type IconName } from '@/components/ui/Icon';
import { type TestingData, totals } from '@/lib/testing';

import { homeLabels } from './labels';

// The words of the home story. DRAFT: written from what the project's own README and design
// notes say (what it does, how it counts, what it refuses to fake), with no statistics about
// the world and no claims about why anyone should care that the project does not itself make.
// Edit freely: nothing else depends on the exact wording.

const CHAPTERS = [
  { label: 'EcoSort Edge' },
  { label: 'Why we built it' },
  { label: 'How it sees' },
  { label: 'Three outcomes' },
  { label: 'Counted once' },
  { label: 'The server owns the truth' },
  { label: 'Built to be tested' },
  { label: 'See it work' },
];

const RHYTHM: { icon: IconName; word: string; detail: string }[] = [
  { icon: 'ready', word: 'Ready', detail: 'The view is empty.' },
  { icon: 'inView', word: 'Item in view', detail: 'The scene changes.' },
  { icon: 'counted', word: 'Counted', detail: 'One verdict, once.' },
  { icon: 'remove', word: 'Remove the item', detail: 'Then the next one.' },
];

export function HomeStory({ testing }: { testing: TestingData }) {
  const sum = totals(testing.suites);
  const stagedSuites = (testing.suites ?? []).slice(0, 3).map((s) => ({
    label: s.label,
    passed: s.passed,
    failed: s.failed,
    skipped: s.skipped,
  }));

  return (
    <>
      <SiteHeader current="home" floating />
      <Stage scene="home" labels={homeLabels(testing.suites)} data={{ suites: stagedSuites }} />
      <ChapterNav chapters={CHAPTERS} />

      <main id="main" className={styles.main}>
        {/* 0 */}
        <section
          id="chapter-0"
          className={`${styles.chapter} ${styles.first}`}
          data-chapter="0"
          aria-labelledby="home-title"
        >
          <div className={styles.sticky}>
            <div data-avoid className={styles.hero}>
              <p className={styles.heroKicker}>A camera, a small network, one laptop</p>
              <h1 id="home-title" className={styles.heroTitle}>
                <span>EcoSort</span> <span className={styles.heroEdge}>Edge</span>
              </h1>
              <p className={styles.heroLede}>
                It tells recyclable from trash, counts each item once, and shows its working.
                Everything runs on this one machine, with no cloud.
              </p>
              <div className={styles.actions}>
                <Link href="/console" className={buttonClass('primary')}>
                  Open the console
                </Link>
                <Link href="/testing" className={buttonClass('secondary')}>
                  See how we tested it
                </Link>
              </div>
              <ul className={styles.pills}>
                <li>Offline by design</li>
                <li>Counts each item once</li>
                <li>Says when it is unsure</li>
              </ul>
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
          aria-labelledby="why-title"
        >
          <div className={styles.sticky}>
            <article data-avoid className={`${styles.card} ${styles.right}`}>
              <Kicker n={2}>Why we built it</Kicker>
              <h2 id="why-title" className={styles.title}>
                A sorting decision, made where you can see it.
              </h2>
              <p>
                Every item that goes into a bin is a small decision: recyclable, or not. We wanted a
                bin that makes that decision with you, and shows its working: the picture it saw,
                the answer it gave, and how sure it was.
              </p>
              <p>
                So EcoSort Edge counts each item once, in the right place. And when it is not sure,
                it says so instead of guessing.
              </p>
            </article>
          </div>
        </section>

        {/* 2 */}
        <section
          id="chapter-2"
          className={styles.chapter}
          data-chapter="2"
          aria-labelledby="sees-title"
        >
          <div className={styles.sticky}>
            <article data-avoid className={`${styles.card} ${styles.left}`}>
              <Kicker n={3}>How it sees</Kicker>
              <h2 id="sees-title" className={styles.title}>
                A small camera, a small picture.
              </h2>
              <p>
                The camera board sends a grayscale frame 160 pixels wide and 120 tall, about
                nineteen thousand pixels. A small neural network, trained on our own photos, reads
                it and answers with a label and a confidence.
              </p>
              <p className={styles.more}>
                The console shows you exactly that frame, enlarged and left pixelated. It is not
                video: it is what the model reads.
              </p>
              <ul className={styles.facts}>
                <li>
                  <strong>160 × 120</strong> pixels, one grey value each
                </li>
                <li>
                  <strong>293,970</strong> parameters in the network
                </li>
                <li>
                  <strong>269</strong> frames, all photographed by us
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
          aria-labelledby="outcomes-title"
        >
          <div className={styles.sticky}>
            <article data-avoid className={`${styles.card} ${styles.left}`}>
              <Kicker n={4}>Three outcomes</Kicker>
              <h2 id="outcomes-title" className={styles.title}>
                Recyclable. Trash. Unsure.
              </h2>
              <p>
                Every verdict lands in one of three places. Recyclable and Trash are counted. If the
                model is less than 60% sure, the item is marked Unsure: it is shown, and counted in
                neither bin.
              </p>
              <ul className={styles.outcomes}>
                <li className={styles.outRecyclable}>
                  <Icon name="recyclable" size={20} /> Recyclable
                </li>
                <li className={styles.outTrash}>
                  <Icon name="trash" size={20} /> Trash
                </li>
                <li className={styles.outUnsure}>
                  <Icon name="unsure" size={20} /> Unsure
                </li>
              </ul>
              <p className={`${styles.note} ${styles.more}`}>
                Unsure is not an error. It is the system being honest. The scene is an illustration
                of sorting; the numbers in the console come from the server.
              </p>
            </article>
          </div>
        </section>

        {/* 4 */}
        <section
          id="chapter-4"
          className={styles.chapter}
          data-chapter="4"
          aria-labelledby="once-title"
        >
          <div className={styles.sticky}>
            <article data-avoid className={`${styles.card} ${styles.right}`}>
              <Kicker n={5}>Counted once</Kicker>
              <h2 id="once-title" className={styles.title}>
                Place an item. Remove it. That is one.
              </h2>
              <ol className={styles.rhythm}>
                {RHYTHM.map((step) => (
                  <li key={step.word}>
                    <Icon name={step.icon} size={20} />
                    <span>
                      <strong>{step.word}</strong> {step.detail}
                    </span>
                  </li>
                ))}
              </ol>
              <p>
                The camera bridge first learns what the empty view looks like. It counts an item
                once, when the scene changes and the model&rsquo;s answer settles. A change in the
                room&rsquo;s light is not an item, and the same item is never counted twice.
              </p>
            </article>
          </div>
        </section>

        {/* 5 */}
        <section
          id="chapter-5"
          className={styles.chapter}
          data-chapter="5"
          aria-labelledby="truth-title"
        >
          <div className={`${styles.sticky} ${styles.stickyBottom}`}>
            <article data-avoid className={`${styles.card} ${styles.wide}`}>
              <Kicker n={6}>The server owns the truth</Kicker>
              <h2 id="truth-title" className={styles.title}>
                Every number comes from one place.
              </h2>
              <p>
                The camera bridge sends each verdict, with the frame it was made from, to the
                website bridge. The bridge checks it, keeps it and counts. The console only
                displays: the browser never adds to a count.
              </p>
              <ul className={styles.facts}>
                <li>
                  <strong>Offline</strong>: no page makes a request outside this machine
                </li>
                <li>
                  <strong>Labelled</strong>: simulated data always says Simulated
                </li>
                <li>
                  <strong>Honest</strong>: a figure nobody measured says Not measured yet
                </li>
              </ul>
            </article>
          </div>
        </section>

        {/* 6 */}
        <section
          id="chapter-6"
          className={styles.chapter}
          data-chapter="6"
          aria-labelledby="tested-title"
        >
          <div className={styles.sticky}>
            <article data-avoid className={`${styles.card} ${styles.right}`}>
              <Kicker n={7}>Built to be tested</Kicker>
              <h2 id="tested-title" className={styles.title}>
                We test what we claim.
              </h2>
              <p>
                {sum !== null
                  ? `${sum.passed} automated checks passed in the last recorded run${
                      sum.failed > 0 ? `, and ${sum.failed} failed` : ''
                    }. They cover the counting, the camera going dark, the accessibility of every page in both themes, and that nothing leaves the machine.`
                  : 'The counting, the camera going dark, the accessibility of every page in both themes, and that nothing leaves the machine are all tested. The recorded results are on the testing page.'}
              </p>
              <Link href="/testing" className={buttonClass('primary')}>
                See the testing
              </Link>
            </article>
          </div>
        </section>

        {/* 7 */}
        <section
          id="chapter-7"
          className={`${styles.chapter} ${styles.last}`}
          data-chapter="7"
          aria-labelledby="work-title"
        >
          <div className={styles.sticky}>
            <article data-avoid className={`${styles.card} ${styles.left}`}>
              <Kicker n={8}>See it work</Kicker>
              <h2 id="work-title" className={styles.title}>
                Put an item in front of the camera.
              </h2>
              <p>
                Run <code>run_all.bat</code>, open the console, and watch the count go up by one.
              </p>
              <div className={styles.actions}>
                <Link href="/console" className={buttonClass('primary')}>
                  Open the console
                </Link>
                <Link href="/project" className={buttonClass('secondary')}>
                  How it works, in detail
                </Link>
                <Link href="/testing" className={buttonClass('secondary')}>
                  Testing
                </Link>
              </div>
            </article>
          </div>
        </section>
      </main>
    </>
  );
}
