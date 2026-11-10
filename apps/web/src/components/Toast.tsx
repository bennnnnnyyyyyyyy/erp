import { createPortal } from 'react-dom';
import { tr } from '../lib/i18n';

// Error popup (Ben, 10 Nov 2026 walkthrough: "give me a popup" instead of a line of text lost in the form). Drop it where the
// `<p className="error">` was: it renders nothing when there is no message, otherwise a popup at the top of the screen that stays until
// it is closed or the message changes. role="alert" so screen readers read it out. No dependency.

export function ErrorToast({ message, onClose }: { message: string | null | undefined; onClose: () => void }) {
  if (!message || typeof document === 'undefined') return null;
  return createPortal(
    <div className="toast-host">
      <div className="toast" role="alert" key={message}>
        <span>{message}</span>
        <button type="button" onClick={onClose} aria-label={tr('Close')}>
          ×
        </button>
      </div>
    </div>,
    document.body,
  );
}
