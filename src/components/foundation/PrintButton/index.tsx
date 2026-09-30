import styles from './styles.module.css';

interface Props {
  label?: string;
}

export default function PrintButton({ label = 'Print / Export PDF' }: Props) {
  function handlePrint() {
    window.print();
  }

  return (
    <button
      type="button"
      onClick={handlePrint}
      className={styles.printButton}
      data-print-hide="true"
    >
      <span aria-hidden="true">🖨️</span> {label}
    </button>
  );
}
