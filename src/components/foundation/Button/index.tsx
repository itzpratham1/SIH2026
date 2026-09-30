import type { ButtonHTMLAttributes, ReactNode } from 'react';
import styles from './styles.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'danger';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  children: ReactNode;
}

export default function Button({
  variant = 'primary',
  children,
  type = 'button',
  ...rest
}: Props) {
  return (
    <button
      type={type}
      data-variant={variant}
      className={styles.button}
      {...rest}
    >
      {children}
    </button>
  );
}
