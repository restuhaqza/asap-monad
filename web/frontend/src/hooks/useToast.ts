/** Single global toast: spinner while busy, auto-hide when idle. */

import { useCallback, useEffect, useRef, useState } from 'react';

export interface ToastState {
  id: number;
  message: string;
  busy: boolean;
}

/** `show(msg, busy)` returns a dismiss function, mirroring the old `toast()`. */
export type ShowToast = (message: string, busy?: boolean) => () => void;

export function useToast(autoHideMs = 4000) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sequence = useRef(0);

  const clearTimer = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const show = useCallback<ShowToast>(
    (message, busy = false) => {
      const id = sequence.current + 1;
      sequence.current = id;
      clearTimer();
      setToast({ id, message, busy });

      if (!busy) {
        timer.current = setTimeout(() => {
          setToast((current) => (current?.id === id ? null : current));
        }, autoHideMs);
      }

      return () => {
        setToast((current) => (current?.id === id ? null : current));
      };
    },
    [autoHideMs, clearTimer],
  );

  useEffect(() => clearTimer, [clearTimer]);

  return { toast, show };
}
