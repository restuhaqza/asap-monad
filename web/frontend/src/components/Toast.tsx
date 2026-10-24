/** Single global toast. Busy toasts spin and never auto-hide. */

import type { ToastState } from '../hooks/useToast';

export function Toast({ toast }: { toast: ToastState | null }) {
  return (
    <div id="toast" className={toast ? 'on' : ''} role="status" aria-live="polite">
      <span id="toast-icon">{toast?.busy ? <span className="spin" /> : <span className="dot" />}</span>
      <span id="toast-msg">{toast?.message ?? ''}</span>
    </div>
  );
}
