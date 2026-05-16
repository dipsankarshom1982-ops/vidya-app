/**
 * firestoreListener.ts
 *
 * Wraps onSnapshot with:
 * - Automatic retry on WebChannel transport errors
 * - Exponential backoff (1s → 2s → 4s → max 30s)
 * - Error logging with actionable messages
 */

import { onSnapshot, Query, Unsubscribe } from "firebase/firestore";

const MAX_RETRY_DELAY = 30_000; // 30 seconds

export function safeOnSnapshot<T>(
  q: Query<T>,
  onData: (docs: T[]) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  let unsub: Unsubscribe | null = null;
  let retryDelay = 1000;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const attach = () => {
    if (stopped) return;

    unsub = onSnapshot(
      q,
      (snap) => {
        // Success — reset backoff
        retryDelay = 1000;
        const data = snap.docs.map((d) => ({ id: d.id, ...d.data() } as T));
        onData(data);
      },
      (error: any) => {
        const isTransportError =
          error?.message === undefined ||
          error?.name === undefined ||
          error?.code === "unavailable" ||
          error?.code === "resource-exhausted";

        if (isTransportError) {
          console.warn(
            `[Firestore] WebChannel error — retrying in ${retryDelay / 1000}s`,
            error
          );

          // Detach broken listener
          unsub?.();
          unsub = null;

          // Retry with backoff
          retryTimer = setTimeout(() => {
            retryDelay = Math.min(retryDelay * 2, MAX_RETRY_DELAY);
            attach();
          }, retryDelay);
        } else {
          // Non-transport error (permissions, missing index etc.) — don't retry
          console.error("[Firestore] Listener error:", error);
          onError?.(error);
        }
      }
    );
  };

  attach();

  // Return a cleanup function that stops retrying
  return () => {
    stopped = true;
    if (retryTimer) clearTimeout(retryTimer);
    unsub?.();
  };
}