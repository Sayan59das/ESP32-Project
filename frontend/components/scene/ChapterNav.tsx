'use client';

import { useEffect, useState } from 'react';

import { chapterPosition, currentChapter } from '@/lib/scene/chapters';

import styles from './ChapterNav.module.css';

export interface ChapterLink {
  label: string;
}

/**
 * Where you are in the story, and a way to jump to any chapter. Real links to real sections, so
 * it works with the keyboard and without the 3D layer.
 */
export function ChapterNav({ chapters }: { chapters: ChapterLink[] }) {
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    let frame = 0;
    const measure = () => {
      const sections = [...document.querySelectorAll<HTMLElement>('[data-chapter]')];
      const top = window.scrollY;
      const spans = sections.map((el) => {
        const box = el.getBoundingClientRect();
        return { top: box.top + top, height: box.height };
      });
      setCurrent(currentChapter(chapterPosition(spans, top, window.innerHeight), spans.length));
    };
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);

  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    <>
      <nav data-avoid className={styles.nav} aria-label="Story chapters">
        <ol className={styles.dots}>
          {chapters.map((chapter, i) => (
            <li key={chapter.label}>
              <a
                href={`#chapter-${i}`}
                className={i === current ? `${styles.dot} ${styles.dotOn}` : styles.dot}
                aria-current={i === current ? 'step' : undefined}
              >
                <span className="visually-hidden">
                  {i + 1}. {chapter.label}
                </span>
              </a>
            </li>
          ))}
        </ol>
      </nav>
      {/* Outside the nav: it is pinned to the corner, and the nav is a transformed box. */}
      <p data-avoid className={styles.counter} aria-hidden="true">
        <span className={styles.number}>
          {pad(current + 1)} / {pad(chapters.length)}
        </span>
        <span className={styles.name}>{chapters[current]?.label}</span>
      </p>
    </>
  );
}
