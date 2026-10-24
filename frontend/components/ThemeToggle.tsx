'use client';

import { useEffect, useState } from 'react';

import { THEME_CHOICES, applyThemeChoice, readThemeChoice, type ThemeChoice } from '@/lib/theme';

import styles from './ThemeToggle.module.css';
import { Icon, type IconName } from './ui/Icon';

const OPTIONS: Record<ThemeChoice, { icon: IconName; label: string }> = {
  system: { icon: 'system', label: 'Match the system theme' },
  light: { icon: 'sun', label: 'Light theme' },
  dark: { icon: 'moon', label: 'Dark theme' },
};

/** Three pressed-state buttons: follow the system, or force light or dark. */
export function ThemeToggle() {
  // The server cannot know the stored choice; it renders "system" and the effect corrects it.
  const [choice, setChoice] = useState<ThemeChoice>('system');
  useEffect(() => setChoice(readThemeChoice()), []);

  const choose = (next: ThemeChoice) => {
    applyThemeChoice(next);
    setChoice(next);
  };

  return (
    <div className={styles.group} role="group" aria-label="Colour theme">
      {THEME_CHOICES.map((option) => (
        <button
          key={option}
          type="button"
          className={styles.option}
          aria-pressed={choice === option}
          aria-label={OPTIONS[option].label}
          title={OPTIONS[option].label}
          onClick={() => choose(option)}
        >
          <Icon name={OPTIONS[option].icon} size={18} />
        </button>
      ))}
    </div>
  );
}
