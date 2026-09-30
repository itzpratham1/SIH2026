import type { ReactNode } from 'react';
import styles from './styles.module.css';

export type BadgeTone = 'green' | 'amber' | 'red' | 'neutral';

interface Props {
  tone?: BadgeTone;
  children: ReactNode;
}

export default function Badge({ tone = 'neutral', children }: Props) {
  return (
    <span data-tone={tone} className={styles.badge}>
      {children}
    </span>
  );
}
