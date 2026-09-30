import { useState, useEffect } from 'react';
import type { Persona } from '../../../lib/types';
import styles from './styles.module.css';

const PERSONAS: { id: Persona; label: string; icon: string }[] = [
  { id: 'citizen', label: 'Citizen', icon: '👤' },
  { id: 'lmo', label: 'LMO Officer', icon: '👮' },
  { id: 'trader', label: 'Trader', icon: '🏪' },
  { id: 'admin', label: 'Admin', icon: '🏛️' },
];

interface Props {
  initial?: Persona;
  onChange?: (persona: Persona) => void;
}

export default function PersonaSwitcher({ initial = 'citizen', onChange }: Props) {
  const [active, setActive] = useState<Persona>(initial);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const path = window.location.pathname;
      const params = new URLSearchParams(window.location.search);
      const qPersona = params.get('persona') as Persona;
      if (['citizen', 'lmo', 'trader', 'admin'].includes(qPersona)) {
        setActive(qPersona);
        return;
      }
      if (path.startsWith('/verify')) {
        setActive('citizen');
      } else if (path.startsWith('/inspect')) {
        setActive('lmo');
      } else {
        const stored = window.localStorage.getItem('weighguard-persona') as Persona;
        if (['citizen', 'lmo', 'trader', 'admin'].includes(stored)) {
          setActive(stored);
        }
      }
    }
  }, []);

  function select(persona: Persona) {
    setActive(persona);
    onChange?.(persona);
    try {
      window.localStorage.setItem('weighguard-persona', persona);
      window.dispatchEvent(
        new CustomEvent('weighguard:persona', { detail: persona }),
      );

      if (typeof window !== 'undefined') {
        const path = window.location.pathname;
        if (persona === 'citizen' && !path.startsWith('/verify')) {
          window.location.href = '/verify';
        } else if (persona === 'lmo' && !path.startsWith('/dashboard') && !path.startsWith('/inspect')) {
          window.location.href = '/dashboard?persona=lmo';
        } else if ((persona === 'trader' || persona === 'admin') && !path.startsWith('/dashboard')) {
          window.location.href = `/dashboard?persona=${persona}`;
        }
      }
    } catch {
      // storage unavailable — selection still applies locally
    }
  }

  return (
    <nav aria-label="Persona quick switcher" className={styles.switcher}>
      {PERSONAS.map((persona) => (
        <button
          key={persona.id}
          type="button"
          aria-pressed={active === persona.id}
          data-active={active === persona.id}
          onClick={() => select(persona.id)}
          className={styles.option}
        >
          <span aria-hidden="true" className={styles.icon}>
            {persona.icon}
          </span>
          <span className={styles.label}>{persona.label}</span>
        </button>
      ))}
    </nav>
  );
}
