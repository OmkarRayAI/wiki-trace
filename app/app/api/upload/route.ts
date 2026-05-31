import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Buffer } from "node:buffer";
import { REPO_ROOT } from "@/lib/repo";
import { pulseKey, openrouterKey } from "@/lib/env-extra";
import { pulseExtract } from "@/lib/pulse";
import { TraceBuilder } from "@/lib/jsonl-writer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

type Event =
  | { type: "received"; filename: string; bytes: number }
  | { type: "parse_started" }
  | { type: "parse_done"; chars: number; pages?: number; credits?: number }
  | { type: "parse_failed"; reason: string }
  | { type: "summarize_started"; model: string }
  | { type: "summarize_done"; chars: number }
  | { type: "summarize_failed"; reason: string }
  | { type: "saved"; page: string; rawPath: string }
  | { type: "indexing" }
  | { type: "indexed"; pages: number }
  | { type: "indexed_failed"; reason: string }
  | { type: "persisted"; traceId: string }
  | { type: "error"; message: string }
  | { type: "done"; pageSlug: string };

const SUMMARIZE_MODELS = process.env.WIKITRACE_MODEL
  ? [process.env.WIKITRACE_MODEL]
  : [
      "openai/gpt-oss-120b:free",
      "qwen/qwen3-next-80b-a3b-instruct:free",
      "meta-llama/llama-3.3-70b-instruct:free",
    ];

const SUMMARIZE_SYSTEM = `You turn a parsed PDF into a single, well-structured
knowledge page in Markdown. Output ONLY the Markdown body — no frontmatter,
no commentary, no code fences around the whole thing. The page should:

- Open with a 2-line context summary.
- Have 3-6 H2 sections with clear, scannable headings.
- Surface concrete numbers, names, dates, ratios — the things a downstream
  agent would need to answer questions.
- Use compact tables when appropriate.
- Keep it under ~1200 words.
- End with an H2 "Open threads" listing 2-4 questions a careful reader would
  still want to answer.

Do NOT invent facts that aren't in the source.`;

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/\.pdf$/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || `upload-${Date.now()}`;
}

function uniqueSlug(slug: string): string {
  const wikiDir = path.join(REPO_ROOT, "wiki");
  let candidate = slug;
  let i = 2;
  while (fs.existsSync(path.join(wikiDir, `${candidate}.md`))) {
    candidate = `${slug}-${i++}`;
    if (i > 99) break;
  }
  return candidate;
}

async function summarize(
  parsedMd: string,
  filename: string,
  apiKey: string,
): Promise<{ markdown: string; model: string }> {
  // Truncate very long parsed text — we don't need everything in the prompt.
  const trimmed = parsedMd.length > 24000 ? parsedMd.slice(0, 24000) + "\n\n[...truncated]" : parsedMd;

  for (const model of SUMMARIZE_MODELS) {
    try {
      const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
          "HTTP-Referer": "http://wikitrace.local",
          "X-Title": "wikitrace-upload",
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: SUMMARIZE_SYSTEM },
            {
              role: "user",
              content: `Source filename: ${filename}\n\nParsed content:\n\n${trimmed}`,
            },
          ],
          max_tokens: 1600,
          temperature: 0.3,
        }),
      });
      if (!r.ok) continue;
      const data = await r.json();
      const md = data?.choices?.[0]?.message?.content?.trim();
      if (md) return { markdown: md, model };
    } catch {
      /* try next */
    }
  }
  throw new Error("All summarize models failed");
}

function runIndex(): Promise<{ pages: number }> {
  return new Promise((resolve, reject) => {
    const proc = spawn("python3", ["-m", "wikitrace", "all"], {
      cwd: REPO_ROOT,
      env: process.env,
    });
    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("close", (code) => {
      if (code !== 0) return reject(new Error(`wikitrace exited ${code}: ${stderr.slice(0, 400)}`));
      // Count product pages on disk for the response.
      const wikiDir = path.join(REPO_ROOT, "wiki");
      const files = fs
        .readdirSync(wikiDir)
        .filter((f) => f.endsWith(".md"));
      resolve({ pages: files.length });
    });
    proc.on("error", reject);
  });
}

export async function POST(req: Request) {
  const ct = req.headers.get("content-type") || "";
  if (!ct.includes("multipart/form-data")) {
    return new Response("multipart/form-data required", { status: 400 });
  }

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (e: Event) => {
        controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
      };

      const trace = new TraceBuilder("upload");
      const root = trace.span("upload_run");

      try {
        const form = await req.formData();
        const file = form.get("file");
        const titleHint = (form.get("title") as string | null) ?? null;
        const folderRaw = (form.get("folder") as string | null) ?? null;
        // Sanitize folder name: trim, drop separators that would confuse paths.
        const folder = folderRaw
          ? folderRaw.trim().replace(/[\/\\<>"|?*]/g, "").slice(0, 60) || null
          : null;
        if (!(file instanceof File)) {
          send({ type: "error", message: "no file uploaded" });
          send({ type: "done", pageSlug: "" });
          trace.closeSpan(root, "error");
          trace.flush({ status: "error" });
          controller.close();
          return;
        }
        const bytes = Buffer.from(await file.arrayBuffer());
        const filename = file.name || "upload.pdf";
        send({ type: "received", filename, bytes: bytes.length });

        // 1. Save raw upload
        const uploadsDir = path.join(REPO_ROOT, "raw", "uploads");
        fs.mkdirSync(uploadsDir, { recursive: true });
        const safeName = filename.replace(/[^A-Za-z0-9._-]/g, "_");
        const stamp = Date.now();
        const rawPath = path.join("raw", "uploads", `${stamp}-${safeName}`);
        const rawAbs = path.join(REPO_ROOT, rawPath);
        fs.writeFileSync(rawAbs, bytes);

        const recvSpan = trace.span("upload_received", { filename, bytes: bytes.length, rawPath });
        trace.closeSpan(recvSpan);

        // 2. Pulse parse
        const pk = pulseKey();
        if (!pk) {
          const help =
            "Set PULSE_API_KEY in .env to parse PDFs. Free key at https://docs.runpulse.com/.";
          send({ type: "parse_failed", reason: help });
          send({ type: "error", message: help });
          send({ type: "done", pageSlug: "" });
          trace.closeSpan(root, "error");
          trace.flush({ filename, status: "error" });
          controller.close();
          return;
        }
        send({ type: "parse_started" });
        const parseSpan = trace.span("parse_pdf", { filename, bytes: bytes.length });
        let parsed: { markdown: string; page_count?: number; credits_used?: number };
        try {
          parsed = await pulseExtract(pk, filename, bytes);
          parseSpan.attrs.page_count = parsed.page_count;
          parseSpan.attrs.credits_used = parsed.credits_used;
          parseSpan.attrs.chars = parsed.markdown.length;
          trace.closeSpan(parseSpan);
        } catch (e: any) {
          trace.closeSpan(parseSpan, "error");
          parseSpan.attrs.error = e?.message ?? String(e);
          send({ type: "parse_failed", reason: e?.message ?? String(e) });
          send({ type: "error", message: "PDF parse failed" });
          send({ type: "done", pageSlug: "" });
          trace.closeSpan(root, "error");
          trace.flush({ filename, status: "error" });
          controller.close();
          return;
        }
        send({
          type: "parse_done",
          chars: parsed.markdown.length,
          pages: parsed.page_count,
          credits: parsed.credits_used,
        });

        // Save parsed companion next to the upload.
        const parsedRel = path.join("raw", "uploads", `${stamp}-${safeName.replace(/\.pdf$/i, "")}.parsed.md`);
        fs.writeFileSync(path.join(REPO_ROOT, parsedRel), parsed.markdown);

        // 3. Summarize into a knowledge page
        const ok = openrouterKey();
        let pageMarkdown: string;
        let modelUsed = "deterministic";
        if (ok) {
          send({ type: "summarize_started", model: SUMMARIZE_MODELS[0] });
          const sumSpan = trace.span("summarize", { model: SUMMARIZE_MODELS[0] });
          try {
            const result = await summarize(parsed.markdown, filename, ok);
            pageMarkdown = result.markdown;
            modelUsed = result.model;
            sumSpan.attrs.model = result.model;
            sumSpan.attrs.chars = pageMarkdown.length;
            trace.closeSpan(sumSpan);
            send({ type: "summarize_done", chars: pageMarkdown.length });
          } catch (e: any) {
            sumSpan.attrs.error = e?.message ?? String(e);
            trace.closeSpan(sumSpan, "error");
            send({ type: "summarize_failed", reason: e?.message ?? String(e) });
            // Still save a page using the parsed content directly so the demo
            // doesn't dead-end.
            pageMarkdown = `# ${titleHint || filename.replace(/\.pdf$/i, "")}\n\n${parsed.markdown.slice(0, 6000)}\n\n## Open threads\n\n- Re-summarize this page when the model is available again.`;
          }
        } else {
          pageMarkdown = `# ${titleHint || filename.replace(/\.pdf$/i, "")}\n\n${parsed.markdown.slice(0, 6000)}`;
        }

        // 4. Write wiki page
        const baseSlug = slugify(titleHint || filename);
        const slug = uniqueSlug(baseSlug);
        const today = new Date().toISOString().slice(0, 10);
        const fmLines = [
          "---",
          `title: ${titleHint || filename.replace(/\.pdf$/i, "")}`,
          "type: summary",
          "audience: product",
        ];
        if (folder) fmLines.push(`folder: ${folder}`);
        fmLines.push(
          "sources:",
          `  - ${rawPath}`,
          `  - ${parsedRel}`,
          `updated: ${today}`,
          `via: wikitrace upload`,
          "---",
          "",
        );
        const frontmatter = fmLines.join("\n");
        const wikiRel = path.join("wiki", `${slug}.md`);
        const wikiAbs = path.join(REPO_ROOT, wikiRel);
        fs.writeFileSync(wikiAbs, frontmatter + pageMarkdown.trim() + "\n");
        const saveSpan = trace.span("save_page", {
          page: wikiRel,
          chars: pageMarkdown.length,
          model: modelUsed,
        });
        trace.closeSpan(saveSpan);
        send({ type: "saved", page: wikiRel, rawPath });

        // 5. Re-index
        send({ type: "indexing" });
        const idxSpan = trace.span("reindex");
        try {
          const r = await runIndex();
          idxSpan.attrs.page_count = r.pages;
          trace.closeSpan(idxSpan);
          send({ type: "indexed", pages: r.pages });
        } catch (e: any) {
          idxSpan.attrs.error = e?.message ?? String(e);
          trace.closeSpan(idxSpan, "error");
          send({ type: "indexed_failed", reason: e?.message ?? String(e) });
        }

        // 6. Persist trace
        root.attrs = { filename, page: wikiRel, model: modelUsed };
        trace.closeSpan(root);
        trace.flush({ filename, page: wikiRel, model: modelUsed });
        send({ type: "persisted", traceId: trace.traceId });
        send({ type: "done", pageSlug: slug });
      } catch (e: any) {
        send({ type: "error", message: e?.message ?? String(e) });
        send({ type: "done", pageSlug: "" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
