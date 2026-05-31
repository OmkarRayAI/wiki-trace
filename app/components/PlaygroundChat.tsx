"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

/* ─── Types ───────────────────────────────────────────────────────────── */

type Action = {
  id: string;
  kind: string;
  title: string;
  description?: string;
  status: "ok" | "warn" | "err" | "info" | "running";
  attrs?: any;
};

type Turn =
  | {
      role: "user";
      id: string;
      text: string;
      attachments?: { name: string; size: number }[];
      folder?: string | null;
    }
  | {
      role: "upload";
      id: string;
      filename: string;
      bytes: number;
      actions: Action[];
      done: boolean;
      pageSlug?: string;
      traceId?: string;
    }
  | {
      role: "assistant";
      id: string;
      answer: string | null;
      actions: Action[];
      done: boolean;
      traceId?: string;
      errored: boolean;
    };

/* ─── Suggested first prompts ────────────────────────────────────────── */
const SUGGESTIONS = [
  "Summarize what's in the knowledge base",
  "What's the most important number on the latest page?",
  "List the open questions from the most recent upload",
];

const STORAGE_KEY = "wt:playground:turns:v1";
const FOLDER_KEY = "wt:playground:folder:v1";

type Folder = { name: string; count: number };

/* ─── Component ──────────────────────────────────────────────────────── */
export default function PlaygroundChat({ pageCount }: { pageCount: number }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [folder, setFolder] = useState<string | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [busy, setBusy] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Hydrate from localStorage once on mount.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Turn[];
        // Only restore turns that finished (no half-streamed states).
        const safe = parsed.filter((t) =>
          t.role === "user" || (t as any).done,
        );
        setTurns(safe);
      }
      const f = localStorage.getItem(FOLDER_KEY);
      if (f) setFolder(f);
    } catch {
      /* ignore corrupt cache */
    }
    setHydrated(true);
    inputRef.current?.focus();
  }, []);

  // Refresh folder list.
  async function refreshFolders() {
    try {
      const r = await fetch("/api/folders");
      const d = await r.json();
      setFolders(d.folders ?? []);
    } catch {
      /* ignore */
    }
  }
  useEffect(() => {
    refreshFolders();
  }, [pageCount]);

  // Persist folder selection.
  useEffect(() => {
    if (!hydrated) return;
    try {
      if (folder) localStorage.setItem(FOLDER_KEY, folder);
      else localStorage.removeItem(FOLDER_KEY);
    } catch {
      /* ignore */
    }
  }, [folder, hydrated]);

  // Persist turns to localStorage on every change (after hydration).
  useEffect(() => {
    if (!hydrated) return;
    try {
      // Only persist completed turns — partial streams are noise.
      const persistable = turns.filter(
        (t) => t.role === "user" || (t as any).done,
      );
      localStorage.setItem(STORAGE_KEY, JSON.stringify(persistable));
    } catch {
      /* quota or private mode — silently ignore */
    }
  }, [turns, hydrated]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [turns]);

  function clearChat() {
    if (busy) return;
    if (turns.length > 0 && !confirm("Clear the conversation?")) return;
    setTurns([]);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    inputRef.current?.focus();
  }

  function patchTurn(id: string, patch: Partial<Turn>) {
    setTurns((prev) =>
      prev.map((t) => (t.id === id ? ({ ...t, ...patch } as Turn) : t)),
    );
  }
  function appendAction(id: string, a: Action) {
    setTurns((prev) =>
      prev.map((t) =>
        t.id === id && (t.role === "upload" || t.role === "assistant")
          ? ({ ...t, actions: [...t.actions, a] } as Turn)
          : t,
      ),
    );
  }
  function updateLastActionByKind(
    id: string,
    matchKind: string,
    patch: Partial<Action>,
  ) {
    setTurns((prev) =>
      prev.map((t) => {
        if (t.id !== id || (t.role !== "upload" && t.role !== "assistant"))
          return t;
        const arr = [...t.actions];
        for (let i = arr.length - 1; i >= 0; i--) {
          if (arr[i].kind === matchKind) {
            arr[i] = { ...arr[i], ...patch };
            break;
          }
        }
        return { ...t, actions: arr } as Turn;
      }),
    );
  }

  async function readSSE(
    res: Response,
    onEvent: (e: any) => void,
  ): Promise<void> {
    if (!res.body) return;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const blocks = buf.split("\n\n");
      buf = blocks.pop() ?? "";
      for (const block of blocks) {
        const line = block.split("\n").find((l) => l.startsWith("data: "));
        if (!line) continue;
        try {
          onEvent(JSON.parse(line.slice(6)));
        } catch {
          /* ignore */
        }
      }
    }
  }

  async function runUpload(turnId: string, file: File, folderName: string | null) {
    const fd = new FormData();
    fd.append("file", file);
    if (folderName) fd.append("folder", folderName);
    const res = await fetch("/api/upload", { method: "POST", body: fd });
    await readSSE(res, (e) => {
      const ts = Date.now();
      if (e.type === "received") {
        appendAction(turnId, {
          id: `r-${ts}`,
          kind: "received",
          title: `Received ${e.filename}`,
          description: `${(e.bytes / 1024).toFixed(1)} KB`,
          status: "ok",
        });
      } else if (e.type === "parse_started") {
        appendAction(turnId, {
          id: `p-${ts}`,
          kind: "parse_started",
          title: "Parsing PDF with Pulse",
          description: "Extracting Markdown from every page…",
          status: "running",
        });
      } else if (e.type === "parse_done") {
        updateLastActionByKind(turnId, "parse_started", {
          kind: "parse_done",
          title: `Parsed ${e.pages ?? "?"} pages`,
          description: `${e.chars.toLocaleString()} chars · ${e.credits ?? "?"} Pulse credits`,
          status: "ok",
        });
      } else if (e.type === "parse_failed") {
        updateLastActionByKind(turnId, "parse_started", {
          kind: "parse_failed",
          title: "PDF parse failed",
          description: e.reason,
          status: "err",
        });
      } else if (e.type === "summarize_started") {
        appendAction(turnId, {
          id: `s-${ts}`,
          kind: "summarize_started",
          title: "Drafting knowledge page",
          description: e.model,
          status: "running",
        });
      } else if (e.type === "summarize_done") {
        updateLastActionByKind(turnId, "summarize_started", {
          kind: "summarize_done",
          title: "Knowledge page drafted",
          description: `${e.chars.toLocaleString()} chars of structured Markdown`,
          status: "ok",
        });
      } else if (e.type === "summarize_failed") {
        updateLastActionByKind(turnId, "summarize_started", {
          kind: "summarize_failed",
          title: "Summarization fell back to raw parse",
          description: e.reason,
          status: "warn",
        });
      } else if (e.type === "saved") {
        appendAction(turnId, {
          id: `sv-${ts}`,
          kind: "saved",
          title: `Saved ${e.page}`,
          description: "Tagged audience: product, sourced from your PDF",
          status: "ok",
        });
      } else if (e.type === "indexing") {
        appendAction(turnId, {
          id: `i-${ts}`,
          kind: "indexing",
          title: "Re-indexing knowledge base",
          description: "Refreshing pages, sources, citations, risks…",
          status: "running",
        });
      } else if (e.type === "indexed") {
        updateLastActionByKind(turnId, "indexing", {
          kind: "indexed",
          title: "Re-indexed",
          description: `Knowledge base now has ${e.pages} pages indexed`,
          status: "ok",
        });
      } else if (e.type === "indexed_failed") {
        updateLastActionByKind(turnId, "indexing", {
          kind: "indexed_failed",
          title: "Re-index failed",
          description: e.reason,
          status: "warn",
        });
      } else if (e.type === "persisted") {
        patchTurn(turnId, { traceId: e.traceId } as any);
      } else if (e.type === "done") {
        patchTurn(turnId, {
          done: true,
          pageSlug: e.pageSlug || undefined,
        } as any);
      } else if (e.type === "error") {
        appendAction(turnId, {
          id: `e-${ts}`,
          kind: "error",
          title: "Error",
          description: e.message,
          status: "err",
        });
      }
    });
  }

  async function runAsk(turnId: string, question: string) {
    const res = await fetch("/api/playground", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question }),
    });
    await readSSE(res, (e) => {
      const ts = Date.now();
      if (e.type === "selected_pages") {
        appendAction(turnId, {
          id: `pg-${ts}`,
          kind: "selected_pages",
          title: `Selected ${e.pages.length} knowledge page${e.pages.length === 1 ? "" : "s"}`,
          description: e.reason,
          status: "ok",
          attrs: { pages: e.pages },
        });
      } else if (e.type === "model_call_started") {
        appendAction(turnId, {
          id: `m-${ts}`,
          kind: "model_call_started",
          title: "Calling model",
          description: `${e.model} · prompt ${e.promptChars.toLocaleString()} chars`,
          status: "running",
        });
      } else if (e.type === "model_call_done") {
        updateLastActionByKind(turnId, "model_call_started", {
          kind: "model_call_done",
          title: "Model returned",
          description: `${e.model} · ${e.ms}ms${e.tokens ? ` · ${e.tokens} tokens` : ""}`,
          status: "ok",
        });
      } else if (e.type === "model_call_failed") {
        updateLastActionByKind(turnId, "model_call_started", {
          kind: "model_call_failed",
          title: "Model failed",
          description: `${e.model} · ${e.reason}`,
          status: "warn",
        });
      } else if (e.type === "answer") {
        patchTurn(turnId, { answer: e.text } as any);
      } else if (e.type === "citations_extracted") {
        appendAction(turnId, {
          id: `c-${ts}`,
          kind: "citations_extracted",
          title:
            e.refs.length > 0
              ? `Extracted ${e.refs.length} citation${e.refs.length === 1 ? "" : "s"}`
              : "Answer cited no knowledge pages",
          description:
            e.refs.length > 0
              ? e.refs.map((r: string) => r.replace("wiki/", "")).join(", ")
              : "Either the question wasn't answerable from the knowledge base, or the model didn't follow the citation format.",
          status: e.refs.length > 0 ? "ok" : "warn",
        });
      } else if (e.type === "persisted") {
        patchTurn(turnId, { traceId: e.traceId } as any);
      } else if (e.type === "done") {
        patchTurn(turnId, { done: true } as any);
      } else if (e.type === "error") {
        appendAction(turnId, {
          id: `e-${ts}`,
          kind: "error",
          title: "Error",
          description: e.message,
          status: "err",
        });
        patchTurn(turnId, { errored: true, done: true } as any);
      }
    });
  }

  async function send(prompt?: string) {
    const text = (prompt ?? input).trim();
    if (busy) return;
    if (!text && pendingFiles.length === 0) return;
    setBusy(true);
    setInput("");

    const userTurn: Turn = {
      role: "user",
      id: `u-${Date.now()}`,
      text,
      attachments: pendingFiles.length
        ? pendingFiles.map((f) => ({ name: f.name, size: f.size }))
        : undefined,
      folder: pendingFiles.length ? folder : null,
    };
    setTurns((prev) => [...prev, userTurn]);
    const filesToUpload = pendingFiles;
    const folderForUpload = folder;
    setPendingFiles([]);

    try {
      // 1. If PDFs were attached, run uploads sequentially as their own turns.
      for (let i = 0; i < filesToUpload.length; i++) {
        const file = filesToUpload[i];
        const uploadId = `up-${Date.now()}-${i}`;
        const uploadTurn: Turn = {
          role: "upload",
          id: uploadId,
          filename: file.name,
          bytes: file.size,
          actions: [],
          done: false,
        };
        setTurns((prev) => [...prev, uploadTurn]);
        await runUpload(uploadId, file, folderForUpload);
      }

      // Refresh folder list after any uploads (new folders may exist now).
      if (filesToUpload.length > 0) {
        await refreshFolders();
      }

      // 2. If user typed a question, run agent as an assistant turn.
      if (text) {
        const askId = `a-${Date.now()}`;
        const askTurn: Turn = {
          role: "assistant",
          id: askId,
          answer: null,
          actions: [],
          done: false,
          errored: false,
        };
        setTurns((prev) => [...prev, askTurn]);
        await runAsk(askId, text);
      }
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  function onPickFiles(fileList: FileList | null) {
    if (!fileList) return;
    const incoming = Array.from(fileList);
    const accepted: File[] = [];
    const rejected: string[] = [];
    for (const f of incoming) {
      if (f.name.toLowerCase().endsWith(".pdf")) accepted.push(f);
      else rejected.push(f.name);
    }
    if (rejected.length) {
      alert(
        `Only PDFs are supported.\nSkipped: ${rejected.slice(0, 3).join(", ")}${rejected.length > 3 ? `, +${rejected.length - 3} more` : ""}`,
      );
    }
    if (accepted.length === 0) return;
    setPendingFiles((prev) => [...prev, ...accepted]);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function removePendingFile(idx: number) {
    setPendingFiles((prev) => prev.filter((_, i) => i !== idx));
  }

  function onDropFile(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    onPickFiles(e.dataTransfer.files);
  }

  const isEmpty = turns.length === 0;

  return (
    <div
      className="flex flex-col"
      // Full-height shell so the input is always visible at the bottom.
      // 96px = main padding (32 top + 32 bottom) + sidebar margin slack.
      style={{ height: "calc(100vh - 96px)" }}
    >
      {/* Conversation — flex-1 so it fills available space, scrolls internally */}
      <div
        ref={scrollRef}
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDropFile}
        className="glass rounded-2xl overflow-y-auto p-6 space-y-6 flex-1 min-h-0"
      >
        {turns.length === 0 ? (
          <EmptyState onPick={(s) => send(s)} pageCount={pageCount} />
        ) : (
          turns.map((t) => <TurnRow key={t.id} turn={t} />)
        )}
      </div>

      {/* Tiny affordance row — sits between conversation and input */}
      <div className="flex items-center gap-2 px-1 mt-2 mb-2 text-[11px] text-ink-500 flex-shrink-0">
        <span className="flex-1 truncate">
          {pageCount > 0
            ? `Grounded on ${pageCount} curated page${pageCount === 1 ? "" : "s"}`
            : "Attach a PDF to begin"}
        </span>
        {turns.length > 0 && (
          <button
            onClick={clearChat}
            disabled={busy}
            className="text-ink-500 hover:text-ink-900 disabled:opacity-30"
          >
            Clear chat
          </button>
        )}
      </div>

      {/* Input */}
      <div className="glass-floating rounded-2xl p-2 flex-shrink-0">
        {pendingFiles.length > 0 && (
          <div className="px-2 pt-2 flex flex-wrap gap-1.5">
            {pendingFiles.map((f, i) => (
              <FileChip
                key={`${f.name}-${i}`}
                file={f}
                onRemove={() => removePendingFile(i)}
              />
            ))}
          </div>
        )}
        <div className="flex items-end gap-2 px-2 py-2">
          <button
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center
                       transition-all duration-150 ease-out-quart hover:bg-ink-100
                       text-ink-500 hover:text-ink-900 disabled:opacity-40"
            title="Attach PDF(s)"
            aria-label="Attach PDF(s)"
          >
            <PaperclipIcon />
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,.pdf"
            multiple
            className="hidden"
            onChange={(e) => {
              onPickFiles(e.target.files);
              if (fileRef.current) fileRef.current.value = "";
            }}
          />
          <FolderPicker
            value={folder}
            folders={folders}
            disabled={busy}
            onChange={setFolder}
            visible={pendingFiles.length > 0}
          />
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={1}
            placeholder={
              pendingFiles.length > 0
                ? `Add a question, or send to ingest ${pendingFiles.length} PDF${pendingFiles.length === 1 ? "" : "s"}…`
                : pageCount > 0
                ? "Ask anything from your knowledge base, or drop PDFs…"
                : "Attach PDFs to start, then ask questions…"
            }
            className="flex-1 resize-none bg-transparent outline-none text-[15px] py-2
                       placeholder:text-ink-400 text-ink-900 max-h-[160px]"
            disabled={busy}
          />
          <button
            disabled={busy || (!input.trim() && pendingFiles.length === 0)}
            onClick={() => send()}
            className="btn-primary disabled:opacity-40 flex-shrink-0"
            style={{ padding: "8px 16px" }}
          >
            {busy ? "Working…" : "Send"}
          </button>
        </div>
      </div>

      <style>{`@keyframes wt-pulse { 0%,100%{opacity:.4} 50%{opacity:1} }`}</style>
    </div>
  );
}

/* ─── Turns ──────────────────────────────────────────────────────────── */

function TurnRow({ turn }: { turn: Turn }) {
  if (turn.role === "user") {
    const attachments = turn.attachments ?? [];
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%]">
          {attachments.length > 0 && (
            <div className="flex flex-wrap justify-end gap-1.5 mb-2">
              {turn.folder && (
                <span
                  className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium"
                  style={{
                    background: "oklch(0.97 0.024 60 / 0.7)",
                    color: "oklch(0.45 0.16 35)",
                    border: "1px solid oklch(0.91 0.05 50)",
                  }}
                >
                  <FolderIcon />
                  {turn.folder}
                </span>
              )}
              {attachments.map((a, i) => (
                <FileChip key={`a-${i}`} file={a as any} static />
              ))}
            </div>
          )}
          {turn.text && (
            <div
              className="rounded-2xl px-4 py-3 text-[14.5px] leading-[1.5]"
              style={{
                background: "oklch(0.62 0.18 35)",
                color: "white",
                boxShadow:
                  "inset 0 1px 0 oklch(1 0 0 / 0.20), 0 1px 2px oklch(0.30 0.16 35 / 0.18)",
              }}
            >
              {turn.text}
            </div>
          )}
        </div>
      </div>
    );
  }
  if (turn.role === "upload") {
    return (
      <UploadTurn turn={turn as any} />
    );
  }
  return <AssistantTurn turn={turn as any} />;
}

function UploadTurn({
  turn,
}: {
  turn: {
    id: string;
    filename: string;
    bytes: number;
    actions: Action[];
    done: boolean;
    pageSlug?: string;
    traceId?: string;
  };
}) {
  // Auto-collapse the action stream when the upload finishes — keeps
  // the conversation lean. User can re-expand to inspect.
  const [showActions, setShowActions] = useState(!turn.done);
  useEffect(() => {
    if (turn.done) setShowActions(false);
  }, [turn.done]);

  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.16em] text-ink-500 mb-1.5">
        Knowledge added
      </div>
      <div
        className="rounded-2xl p-4"
        style={{
          background: "oklch(1 0 0 / 0.55)",
          border: "1px solid oklch(0.92 0.006 40 / 0.7)",
        }}
      >
        <div className="flex items-baseline justify-between gap-3 mb-3">
          <div className="text-[13.5px] text-ink-900 font-medium">
            {turn.done ? `Ingested ${turn.filename}` : `Ingesting ${turn.filename}`}
          </div>
          {turn.done && (
            <button
              onClick={() => setShowActions((v) => !v)}
              className="text-[11px] text-ink-500 hover:text-ink-900 inline-flex items-center gap-1.5"
            >
              <span>{showActions ? "▾" : "▸"}</span>
              {showActions ? "Hide" : "Show"} {turn.actions.length} steps
            </button>
          )}
        </div>
        {showActions && <ActionList actions={turn.actions} running={!turn.done} />}
        {turn.done && turn.pageSlug && (
          <div
            className="mt-4 pt-3 flex items-center gap-3 flex-wrap"
            style={{ borderTop: "1px solid oklch(0.92 0.006 40 / 0.6)" }}
          >
            <Link
              href={`/pages/${encodeURIComponent(`wiki/${turn.pageSlug}.md`)}`}
              className="link text-[12.5px] font-medium"
            >
              View knowledge page ›
            </Link>
            {turn.traceId && (
              <Link
                href={`/traces/${turn.traceId}`}
                className="text-[12px] text-ink-500 hover:text-ink-900"
              >
                Open trace
              </Link>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function AssistantTurn({
  turn,
}: {
  turn: {
    id: string;
    answer: string | null;
    actions: Action[];
    done: boolean;
    traceId?: string;
    errored: boolean;
  };
}) {
  const [showActions, setShowActions] = useState(false);
  return (
    <div className="space-y-3">
      <div
        className="rounded-2xl p-5"
        style={{
          background: "oklch(1 0 0 / 0.65)",
          border: "1px solid oklch(0.92 0.006 40 / 0.7)",
          boxShadow: "0 1px 2px oklch(0.30 0.020 40 / 0.04)",
        }}
      >
        {turn.answer ? (
          <div className="text-[15px] text-ink-900 leading-[1.6] space-y-3 [&>ul]:space-y-1.5 [&>ul]:pl-5 [&>ul]:list-disc">
            {renderAnswer(turn.answer)}
          </div>
        ) : !turn.done ? (
          <div className="flex items-center gap-2 text-[13px] text-ink-500">
            <span
              className="inline-block w-1.5 h-1.5 rounded-full"
              style={{
                background: "oklch(0.62 0.18 35)",
                animation: "wt-pulse 1s ease-in-out infinite",
              }}
            />
            Thinking…
          </div>
        ) : turn.errored ? (
          <div className="text-[13.5px] text-err">
            Something went wrong. Open the trace for details.
          </div>
        ) : null}
      </div>

      {turn.actions.length > 0 && (
        <div>
          <button
            onClick={() => setShowActions(!showActions)}
            className="text-[11.5px] text-ink-500 hover:text-ink-900 inline-flex items-center gap-1.5"
          >
            <span>{showActions ? "▾" : "▸"}</span>
            {showActions ? "Hide" : "Show"} action stream
            <span className="mono text-ink-400">
              ({turn.actions.length} steps)
            </span>
            {turn.traceId && showActions && (
              <Link
                href={`/traces/${turn.traceId}`}
                className="ml-2 link"
                onClick={(e) => e.stopPropagation()}
              >
                full trace ›
              </Link>
            )}
          </button>
          {showActions && (
            <div className="mt-2.5 pl-2">
              <ActionList actions={turn.actions} running={!turn.done} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Sub-components ─────────────────────────────────────────────────── */

function ActionList({
  actions,
  running,
}: {
  actions: Action[];
  running: boolean;
}) {
  return (
    <ol
      className="relative pl-5"
      style={{ borderLeft: "1px solid oklch(0.92 0.006 40 / 0.6)" }}
    >
      {actions.map((a) => (
        <ActionRow key={a.id} a={a} />
      ))}
      {running && (
        <li className="relative pb-1 text-[12px] text-ink-500">
          <span
            className="absolute -left-[24px] top-[6px] w-1.5 h-1.5 rounded-full"
            style={{
              background: "oklch(0.62 0.18 35)",
              boxShadow: "0 0 0 3px white",
              animation: "wt-pulse 1s ease-in-out infinite",
            }}
          />
          waiting…
        </li>
      )}
    </ol>
  );
}

function ActionRow({ a }: { a: Action }) {
  const [open, setOpen] = useState(false);
  const dot =
    a.status === "ok"
      ? "oklch(0.55 0.13 155)"
      : a.status === "warn"
      ? "oklch(0.55 0.13 75)"
      : a.status === "err"
      ? "oklch(0.55 0.18 25)"
      : a.status === "running"
      ? "oklch(0.62 0.18 35)"
      : "oklch(0.50 0.012 40)";
  return (
    <li className="relative pb-3">
      <span
        className="absolute -left-[24px] top-[6px] w-1.5 h-1.5 rounded-full"
        style={{
          background: dot,
          boxShadow: "0 0 0 3px white",
          animation:
            a.status === "running" ? "wt-pulse 1s ease-in-out infinite" : undefined,
        }}
      />
      <div
        className={a.attrs ? "cursor-pointer" : ""}
        onClick={() => a.attrs && setOpen(!open)}
      >
        <div className="text-[13px] text-ink-900 font-medium leading-snug">
          {a.title}
        </div>
        {a.description && (
          <div className="text-[11.5px] text-ink-500 leading-relaxed mt-0.5">
            {a.description}
          </div>
        )}
      </div>
      {open && a.attrs && (
        <pre
          className="mt-2 p-2 text-[10.5px] mono leading-relaxed whitespace-pre-wrap break-all rounded-lg"
          style={{
            background: "oklch(0.97 0.005 50 / 0.7)",
            border: "1px solid oklch(0.92 0.006 40 / 0.7)",
            color: "oklch(0.30 0.012 40)",
            maxHeight: 200,
            overflow: "auto",
          }}
        >
          {JSON.stringify(a.attrs, null, 2)}
        </pre>
      )}
    </li>
  );
}

function FileChip({
  file,
  onRemove,
  static: isStatic,
}: {
  file: File | { name: string; size: number };
  onRemove?: () => void;
  static?: boolean;
}) {
  return (
    <span
      className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[12px]"
      style={{
        background: isStatic ? "oklch(1 0 0 / 0.55)" : "oklch(0.97 0.024 60 / 0.7)",
        color: "oklch(0.30 0.012 40)",
        border: isStatic
          ? "1px solid oklch(0.92 0.006 40 / 0.7)"
          : "1px solid oklch(0.91 0.05 50)",
      }}
    >
      <PdfIcon />
      <span className="font-medium truncate max-w-[220px]">{file.name}</span>
      <span className="text-ink-500 mono text-[10.5px]">
        {(file.size / 1024).toFixed(0)} KB
      </span>
      {!isStatic && onRemove && (
        <button
          onClick={onRemove}
          className="text-ink-500 hover:text-ink-900 ml-0.5"
          aria-label="Remove attachment"
        >
          ×
        </button>
      )}
    </span>
  );
}

function EmptyState({
  onPick,
  pageCount,
}: {
  onPick: (s: string) => void;
  pageCount: number;
}) {
  return (
    <div className="flex flex-col items-center text-center py-3">
      <div
        className="font-display text-ink-900 mb-1.5"
        style={{
          fontSize: 20,
          fontWeight: 600,
          letterSpacing: "-0.020em",
          fontVariationSettings: '"wdth" 100, "opsz" 22',
        }}
      >
        {pageCount > 0 ? "What do you want to know?" : "Attach a PDF to begin"}
      </div>
      <p className="text-[13px] text-ink-600 max-w-[460px] mb-4 leading-relaxed">
        {pageCount > 0
          ? "Ask a question grounded on your curated knowledge, or drop a new PDF to expand it."
          : "We'll parse it, draft a knowledge page, and save it to your knowledge base — under 90 seconds."}
      </p>
      {pageCount > 0 && (
        <div className="flex flex-wrap gap-1.5 justify-center max-w-[600px]">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => onPick(s)}
              className="text-left text-[12.5px] rounded-full px-3 py-1.5 transition-colors"
              style={{
                background: "oklch(1 0 0 / 0.55)",
                color: "oklch(0.40 0.012 40)",
                border: "1px solid oklch(0.92 0.006 40 / 0.7)",
              }}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function PaperclipIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
    </svg>
  );
}

/* ─── Folder picker ─────────────────────────────────────────────────── */

function FolderPicker({
  value,
  folders,
  disabled,
  visible,
  onChange,
}: {
  value: string | null;
  folders: { name: string; count: number }[];
  disabled: boolean;
  visible: boolean;
  onChange: (v: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setCreating(false);
      }
    }
    if (open) document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  if (!visible) return null;

  function commitFolder(name: string | null) {
    onChange(name);
    setOpen(false);
    setCreating(false);
    setDraft("");
  }

  return (
    <div className="relative flex-shrink-0" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        className="h-9 px-2.5 rounded-lg flex items-center gap-1.5 text-[12px]
                   transition-all duration-150 ease-out-quart disabled:opacity-40"
        style={{
          background: value ? "oklch(0.97 0.024 60 / 0.7)" : "oklch(1 0 0 / 0.45)",
          color: value ? "oklch(0.45 0.16 35)" : "oklch(0.42 0.012 40)",
          border: value
            ? "1px solid oklch(0.91 0.05 50)"
            : "1px solid oklch(0.92 0.006 40 / 0.7)",
          fontWeight: value ? 600 : 500,
        }}
        title={value ? `Folder: ${value}` : "Pick a folder (optional)"}
      >
        <FolderIcon />
        <span className="truncate max-w-[120px]">{value ?? "No folder"}</span>
        <span className="text-[9px] text-ink-400 ml-0.5">▾</span>
      </button>

      {open && (
        <div
          className="absolute bottom-full mb-2 left-0 w-[260px] rounded-xl overflow-hidden z-20"
          style={{
            background: "oklch(0.99 0.005 50 / 0.94)",
            backdropFilter: "blur(20px) saturate(180%)",
            WebkitBackdropFilter: "blur(20px) saturate(180%)",
            border: "1px solid oklch(0.92 0.006 40 / 0.9)",
            boxShadow:
              "inset 0 1px 0 oklch(1 0 0 / 0.6), 0 8px 24px oklch(0.30 0.020 40 / 0.15)",
          }}
        >
          <div className="px-3 py-2" style={{ borderBottom: "1px solid oklch(0.92 0.006 40 / 0.7)" }}>
            <div className="text-[10px] uppercase tracking-[0.12em] text-ink-500">
              Save uploaded PDFs to
            </div>
          </div>
          <ul className="max-h-[220px] overflow-y-auto py-1">
            <FolderRow
              label="No folder"
              hint="Saves to Unfiled"
              active={value === null}
              onClick={() => commitFolder(null)}
            />
            {folders.map((f) => (
              <FolderRow
                key={f.name}
                label={f.name}
                hint={`${f.count} page${f.count === 1 ? "" : "s"}`}
                active={value === f.name}
                onClick={() => commitFolder(f.name)}
              />
            ))}
          </ul>
          <div
            className="px-1 py-1"
            style={{ borderTop: "1px solid oklch(0.92 0.006 40 / 0.7)" }}
          >
            {creating ? (
              <div className="flex items-center gap-1 px-1">
                <input
                  type="text"
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const v = draft.trim();
                      if (v) commitFolder(v);
                    } else if (e.key === "Escape") {
                      setCreating(false);
                      setDraft("");
                    }
                  }}
                  placeholder="Folder name…"
                  className="flex-1 bg-transparent outline-none text-[13px] py-1.5 px-2"
                />
                <button
                  type="button"
                  disabled={!draft.trim()}
                  onClick={() => {
                    const v = draft.trim();
                    if (v) commitFolder(v);
                  }}
                  className="text-[11.5px] text-accent-dark px-2 py-1 disabled:opacity-40"
                >
                  Add
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="w-full text-left px-3 py-2 rounded-md text-[12.5px] text-accent-dark hover:bg-accent-bg/40 flex items-center gap-2"
              >
                <span aria-hidden>+</span>
                New folder
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function FolderRow({
  label,
  hint,
  active,
  onClick,
}: {
  label: string;
  hint?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="w-full text-left px-3 py-1.5 flex items-center justify-between gap-3 transition-colors"
        style={{
          background: active ? "oklch(0.97 0.024 60 / 0.7)" : "transparent",
          color: active ? "oklch(0.45 0.16 35)" : "oklch(0.30 0.012 40)",
          fontWeight: active ? 600 : 500,
          fontSize: 12.5,
        }}
      >
        <span className="flex items-center gap-2">
          <FolderIcon />
          <span className="truncate">{label}</span>
        </span>
        {hint && <span className="text-[10.5px] text-ink-500 mono">{hint}</span>}
      </button>
    </li>
  );
}

function PdfIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

/**
 * Render a model's markdown-flavoured answer as polished React nodes —
 * no library, no escaped asterisks bleeding through. Handles:
 *   - Paragraphs (blank-line separated)
 *   - Bullet lists (lines starting with "* ", "- ", or "• ")
 *   - **bold** inline emphasis
 *   - `code` inline spans
 *   - [wiki/foo.md] / 【wiki/foo.md】 / (wiki/foo.md) citation pills
 *
 * Anything we don't explicitly handle (headings, fenced code blocks,
 * tables, links) renders as plain text so we never leak raw markup.
 */
function renderAnswer(text: string): React.ReactNode {
  // Split on blank lines into blocks.
  const blocks = text.replace(/\r\n/g, "\n").split(/\n\s*\n/);
  return (
    <>
      {blocks.map((block, i) => {
        const trimmed = block.trim();
        if (!trimmed) return null;
        const lines = trimmed.split("\n");
        const isList = lines.every((l) => /^\s*[*•\-]\s+/.test(l));
        if (isList) {
          return (
            <ul key={`b-${i}`}>
              {lines.map((l, j) => (
                <li key={`li-${i}-${j}`}>
                  {renderInline(l.replace(/^\s*[*•\-]\s+/, ""))}
                </li>
              ))}
            </ul>
          );
        }
        return <p key={`b-${i}`}>{renderInline(trimmed)}</p>;
      })}
    </>
  );
}

/** Inline pass: bold, code, citation pills. */
function renderInline(text: string): React.ReactNode {
  // Token order: try citation first (longest match), then bold, then code.
  // We do it as a single regex with capture groups for routing.
  const tokens: { type: "cite" | "bold" | "code" | "text"; value: string; href?: string }[] = [];
  const RE =
    /[\[【\(](wiki\/[A-Za-z0-9._\-/]+\.md)[\]】\)]|\*\*([^*]+)\*\*|`([^`]+)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = RE.exec(text)) !== null) {
    if (m.index > last) tokens.push({ type: "text", value: text.slice(last, m.index) });
    if (m[1]) tokens.push({ type: "cite", value: m[1] });
    else if (m[2]) tokens.push({ type: "bold", value: m[2] });
    else if (m[3]) tokens.push({ type: "code", value: m[3] });
    last = RE.lastIndex;
  }
  if (last < text.length) tokens.push({ type: "text", value: text.slice(last) });

  return tokens.map((t, i) => {
    if (t.type === "cite") {
      return (
        <Link
          key={`t-${i}`}
          href={`/pages/${encodeURIComponent(t.value)}`}
          className="pill pill-accent inline-block mx-0.5 align-baseline"
        >
          {t.value.replace("wiki/", "")}
        </Link>
      );
    }
    if (t.type === "bold") {
      return (
        <strong key={`t-${i}`} className="font-semibold text-ink-900">
          {t.value}
        </strong>
      );
    }
    if (t.type === "code") {
      return (
        <code
          key={`t-${i}`}
          className="mono text-[12.5px] px-1 py-0.5 rounded"
          style={{
            background: "oklch(0.96 0.005 50)",
            border: "1px solid oklch(0.92 0.006 40 / 0.7)",
            color: "oklch(0.30 0.012 40)",
          }}
        >
          {t.value}
        </code>
      );
    }
    return <span key={`t-${i}`}>{t.value}</span>;
  });
}
