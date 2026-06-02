/** wrap(), tool() — JS equivalents of Python's @trace and @tool.
 *
 * JS decorators are still settling across runtimes (Stage 3, Stage 2,
 * legacy TS), so the primary surface is a `wrap()` function — call it
 * once on a function and you get an instrumented version. Works with
 * sync and async fns, captures args/return/errors.
 *
 * The TS decorator at the bottom is for users on TS 5.0+ who can use
 * Stage 3 syntax — it just calls wrap() under the hood.
 */

import { span, runSyncSpan, currentTraceId } from "./sdk.js";
import type { Span } from "./types.js";

export interface WrapOptions {
  name?: string;
  captureArgs?: boolean;
  captureReturn?: boolean;
  attrs?: Record<string, unknown>;
}

type AnyFn = (...args: unknown[]) => unknown;

function summarizeArgs(args: unknown[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (let i = 0; i < args.length; i++) {
    const v = args[i];
    const k = `arg.${i}`;
    if (typeof v === "string") {
      out[k] = v.length <= 200 ? v : `${v.slice(0, 200)}...`;
      out[`${k}.len`] = v.length;
    } else if (typeof v === "number" || typeof v === "boolean" || v === null) {
      out[k] = v;
    } else if (Array.isArray(v)) {
      out[`${k}.type`] = "array";
      out[`${k}.len`] = v.length;
    } else if (v && typeof v === "object") {
      out[`${k}.type`] = "object";
      out[`${k}.len`] = Object.keys(v).length;
    } else {
      out[`${k}.type`] = typeof v;
    }
  }
  return out;
}

function summarizeReturn(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) return { "return.type": value === null ? "null" : "undefined" };
  if (typeof value === "string") return { "return.type": "string", "return.len": value.length };
  if (typeof value === "number" || typeof value === "boolean") {
    return { "return.type": typeof value, "return.value": value };
  }
  if (Array.isArray(value)) return { "return.type": "array", "return.len": value.length };
  if (typeof value === "object") return { "return.type": "object", "return.len": Object.keys(value).length };
  return { "return.type": typeof value };
}

/** Wrap a function in a wikitrace span.
 *
 * If the underlying fn is async (returns a Promise), the wrapper is
 * async too. If fn is sync, the wrapper is sync — the user gets the
 * raw return value, not a Promise. This matches the natural JS
 * expectation: `wrap(syncFn)(...)` should be sync. */
export function wrap<F extends AnyFn>(fn: F, opts: WrapOptions = {}): F {
  const spanName = opts.name ?? fn.name ?? "anonymous";
  const captureArgs = opts.captureArgs ?? true;
  const captureReturn = opts.captureReturn ?? true;
  const extra = opts.attrs ?? {};
  const isAsync = fn.constructor.name === "AsyncFunction";

  let wrapped: F;
  if (isAsync) {
    wrapped = async function asyncWrapped(this: unknown, ...args: unknown[]) {
      if (currentTraceId() === null) return await (fn as AnyFn).apply(this, args);
      const attrs = { ...extra, ...(captureArgs ? summarizeArgs(args) : {}) };
      return await span(
        spanName,
        async (rec: Span) => {
          const result = await (fn as AnyFn).apply(this, args);
          if (captureReturn && rec.attrs) Object.assign(rec.attrs, summarizeReturn(result));
          return result;
        },
        attrs,
      );
    } as unknown as F;
  } else {
    wrapped = function syncWrapped(this: unknown, ...args: unknown[]) {
      if (currentTraceId() === null) return (fn as AnyFn).apply(this, args);
      // Build the span manually so we can stay synchronous.
      const attrs = { ...extra, ...(captureArgs ? summarizeArgs(args) : {}) };
      return runSyncSpan(spanName, attrs, () => (fn as AnyFn).apply(this, args), captureReturn);
    } as unknown as F;
  }

  Object.defineProperty(wrapped, "name", { value: spanName, configurable: true });
  return wrapped;
}

/** Wrap a function as a tool — emits a tool_call span tagged with the tool name. */
export function tool<F extends AnyFn>(
  fn: F,
  opts: Omit<WrapOptions, "name"> & { name?: string } = {},
): F {
  const toolName = opts.name ?? fn.name ?? "tool";
  return wrap(fn, {
    ...opts,
    name: "tool_call",
    attrs: { tool: toolName, ...(opts.attrs ?? {}) },
  });
}

/** TS Stage 3 method decorator. Use on TS 5.0+. */
export function trace(_target: unknown, ctx: ClassMethodDecoratorContext) {
  return function (this: unknown, ...args: unknown[]) {
    // The original method is bound by the runtime; we just wrap on first use.
    const orig = (ctx as unknown as { value?: AnyFn }).value;
    if (typeof orig !== "function") return undefined;
    const spanName = String(ctx.name);
    return wrap(orig as AnyFn, { name: spanName }).apply(this, args);
  };
}
