import { tr } from '../lib/i18n';
import { Button } from './ui/button';

// What a screen shows before its data arrives: a quiet skeleton of a page (heading, a line, a few rows) instead of the word "Loading…",
// so the layout does not jump when the content lands. If loading failed, the error is shown as an error, not as grey text that looks
// like it is still loading, with "Try again" when the screen can reload (input and speed audit, 25 Nov 2026).

export function Loading({ error, rows = 4, onRetry }: { error?: string | null; rows?: number; onRetry?: () => void }) {
  if (error) {
    return (
      <div className="error notice" role="alert">
        <span>{error}</span>
        {onRetry && (
          <>
            {' '}
            <Button size="sm" variant="outline" onClick={onRetry}>{tr('Try again')}</Button>
          </>
        )}
      </div>
    );
  }
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
