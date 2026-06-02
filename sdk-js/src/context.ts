/** Per-call context: span stack + ambient session attrs.
 *
 * In Node, we use AsyncLocalStorage so async/await chains carry their
 * own stack. In browsers (or when AsyncLocalStorage isn't available)
 * we fall back to a module-global stack — fine for single-threaded
 * browser code, NOT safe for concurrent async work in older runtimes.
 */

import type { Span, SessionAttrs } from "./types.js";

interface ContextFrame {
  spanStack: Span[];
  session: SessionAttrs;
}

const FALLBACK: ContextFrame = { spanStack: [], session: {} };

let storage:
  | {
      getStore: () => ContextFrame | undefined;
      run: <R>(frame: ContextFrame, fn: () => R) => R;
    }
  | null = null;

async function loadStorage(): Promise<void> {
  if (storage) return;
  try {
    // Lazy-load only in Node. In browsers this throws → we keep storage = null.
    const mod = await import("node:async_hooks");
    storage = new mod.AsyncLocalStorage<ContextFrame>();
  } catch {
    storage = null;
  }
}

// Eagerly try to load; in Node this resolves before user code runs.
void loadStorage();

export function currentFrame(): ContextFrame {
  return storage?.getStore() ?? FALLBACK;
}

/** Run `fn` with a forked context — child async tasks inherit it. */
export async function withFrame<R>(
  frame: ContextFrame,
  fn: () => Promise<R> | R,
): Promise<R> {
  if (!storage) {
    // Browser fallback: mutate the global frame.
    const prev = { ...FALLBACK };
    Object.assign(FALLBACK, frame);
    try {
      return await fn();
    } finally {
      Object.assign(FALLBACK, prev);
    }
  }
  return storage.run(frame, fn) as R;
}

export function pushSpan(span: Span): void {
  const f = currentFrame();
  f.spanStack.push(span);
}

export function popSpan(span: Span): void {
  const f = currentFrame();
  const i = f.spanStack.indexOf(span);
  if (i >= 0) f.spanStack.splice(i, 1);
}

export function currentParentId(): string | null {
  const f = currentFrame();
  const stack = f.spanStack;
  return stack.length ? stack[stack.length - 1]!.id : null;
}

export function currentSession(): SessionAttrs {
  return { ...currentFrame().session };
}

export function setSessionInFrame(attrs: SessionAttrs): void {
  currentFrame().session = { ...currentFrame().session, ...attrs };
}
