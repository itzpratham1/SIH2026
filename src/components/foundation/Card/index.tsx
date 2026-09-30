import type { ReactNode } from 'react';
import styles from './styles.module.css';

interface Props {
  title?: string;
  children: ReactNode;
}

export default function Card({ title, children }: Props) {
  return (
    <article className={styles.card}>
      {title && <h3 className={styles.title}>{title}</h3>}
      <div className={styles.body}>{children}</div>
    </article>
  );
}
