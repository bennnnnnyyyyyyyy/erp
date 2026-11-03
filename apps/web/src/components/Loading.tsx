import { tr } from '../lib/i18n';

// What a screen shows before its data arrives: a quiet skeleton of a page (heading, a line, a few rows) instead of the word "Loading…",
// so the layout does not jump when the content lands. If loading failed, the error is shown as an error, not as grey text that looks
// like it is still loading.

export function Loading({ error, rows = 4 }: { error?: string | null; rows?: number }) {
  if (error) return <p className="error notice" role="alert">{error}</p>;
  return (
    <div className="skeleton" aria-busy="true" aria-live="polite">
      <span className="sr-only">{tr('Loading…')}</span>
      <div className="sk sk-title" />
      <div className="sk sk-line" />
      <div className="sk-table">
        {Array.from({ length: rows }, (_, i) => <div key={i} className="sk sk-row" />)}
      </div>
    </div>
  );
}
