import { spawn } from "node:child_process";
import { REPO_ROOT } from "@/lib/repo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 600;

type Event =
  | { type: "start"; runId?: string; agents: string[]; models: string[]; questionCount: number }
  | { type: "cell_started"; qid: string; agent: string; model: string }
  | { type: "cell_scored"; qid: string; agent: string; model: string; correct: number; total: number; latency: number }
  | { type: "cell_error"; qid: string; agent: string; model: string; error: string }
  | { type: "log"; line: string }
  | { type: "ingest_started" }
  | { type: "ingest_done" }
  | { type: "done"; runId: string; ok: boolean }
  | { type: "error"; message: string };

export async function POST(req: Request) {
  const { limit, agent, model } = await req.json();
  const argv = ["-m", "eval.run"];
  if (limit) argv.push("--limit", String(limit));
  if (agent && agent !== "all") argv.push("--agent", agent);
  if (model && model !== "all") argv.push("--model", model);

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (e: Event) => controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));

      let runId = "";
      let currentCell: { qid: string; agent: string; model: string } | null = null;
      let agents: string[] = [];
      let models: string[] = [];

      const proc = spawn("python3", argv, {
        cwd: REPO_ROOT,
        env: { ...process.env, PYTHONPATH: REPO_ROOT },
      });

      proc.stderr.on("data", (data: Buffer) => {
        const lines = data.toString().split("\n");
        for (const line of lines) {
          if (!line.trim()) continue;
          // Run: /path/to/eval/runs/20260531-031245
          const runMatch = line.match(/Run: .*runs\/([0-9-]+)/);
          if (runMatch) {
            runId = runMatch[1];
            send({ type: "start", runId, agents, models, questionCount: limit ?? 50 });
            continue;
          }
          // -> q1-msme-vs-retail | wiki | claude-sonnet-4-6
          const cellMatch = line.match(/^->\s+([^\s|]+)\s+\|\s+(\w+)\s+\|\s+(\S+)/);
          if (cellMatch) {
            currentCell = { qid: cellMatch[1], agent: cellMatch[2], model: cellMatch[3] };
            if (!agents.includes(currentCell.agent)) agents.push(currentCell.agent);
            if (!models.includes(currentCell.model)) models.push(currentCell.model);
            send({ type: "cell_started", ...currentCell });
            continue;
          }
          //    score: 3/3  (12.5s)
          const scoreMatch = line.match(/score:\s+(\d+)\/(\d+)\s+\(([\d.]+)s\)/);
          if (scoreMatch && currentCell) {
            send({
              type: "cell_scored",
              ...currentCell,
              correct: parseInt(scoreMatch[1], 10),
              total: parseInt(scoreMatch[2], 10),
              latency: parseFloat(scoreMatch[3]),
            });
            continue;
          }
          // Default: just log it
          send({ type: "log", line });
        }
      });

      proc.on("close", async (code) => {
        if (code !== 0 && !runId) {
          send({ type: "error", message: `eval.run exited with code ${code}` });
          send({ type: "done", runId, ok: false });
          controller.close();
          return;
        }

        // Run wikitrace ingest-evals so the dashboard shows the new run.
        send({ type: "ingest_started" });
        const ingest = spawn("python3", ["-m", "wikitrace", "ingest-evals"], {
          cwd: REPO_ROOT,
          env: process.env,
        });
        ingest.on("close", () => {
          send({ type: "ingest_done" });
          send({ type: "done", runId, ok: code === 0 });
          controller.close();
        });
        ingest.on("error", () => {
          send({ type: "ingest_done" });
          send({ type: "done", runId, ok: code === 0 });
          controller.close();
        });
      });

      proc.on("error", (e) => {
        send({ type: "error", message: e.message });
        send({ type: "done", runId: "", ok: false });
        controller.close();
      });
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
