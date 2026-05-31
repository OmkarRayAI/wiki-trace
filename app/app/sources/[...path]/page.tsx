import fs_ from "node:fs";
import path from "node:path";
import {
  pagesIndex,
  sourceCitations,
  sourceEvalUsage,
  snippetAround,
  fanIn,
} from "@/lib/traces";
import { REPO_ROOT } from "@/lib/repo";
import { PageTitle, CrumbBack, EvalBadge, Empty } from "@/components/widgets";
import Link from "next/link";
import { notFound } from "next/navigation";

/** Look for a parsed Markdown companion file for a PDF. */
function parsedCompanion(rel: string): string | null {
  if (!rel.endsWith(".pdf")) return null;
  const stem = rel.replace(/\.pdf$/, "");
  const candidates = [
    `${stem}.parsed.md`,
    rel.replace(/^raw\//, "raw/parsed/").replace(/\.pdf$/, ".parsed.md"),
  ];
  for (const c of candidates) {
    if (fs_.existsSync(path.join(REPO_ROOT, c))) return c;
  }
  return null;
}

/** Best-effort: grep log.md for a parse cost hint about this file. */
function parseCostHint(rel: string): string | null {
  const log = path.join(REPO_ROOT, "log.md");
  if (!fs_.existsSync(log)) return null;
  const text = fs_.readFileSync(log, "utf8");
  const stem = path.basename(rel);
  // Search for nearby "credits" mentions in the same paragraph as the file name.
  const idx = text.indexOf(stem);
  if (idx === -1) return null;
  const start = Math.max(0, idx - 500);
  const end = Math.min(text.length, idx + 500);
  const window = text.slice(start, end);
  const m = window.match(/(\d+)\s+credits?/i);
  return m ? m[0] : null;
}

export default async function SourceDetail({
  params,
}: {
  params: Promise<{ path: string[] }>;
}) {
  const { path: pathParts } = await params;
  const rel = decodeURIComponent(pathParts.join("/"));
  const { raw } = pagesIndex();
  const file = raw.find((r) => r.path === rel);
  if (!file) notFound();

  const cites = sourceCitations(rel);
  const usage = sourceEvalUsage(rel);
  const fan = fanIn()[rel] ?? [];
  const companion = parsedCompanion(rel);
  const costHint = parseCostHint(rel);
  const isPdf = rel.endsWith(".pdf");

  // For each citing page, read its markdown so we can show snippet of one ref.
  const pageTextCache: Record<string, string> = {};
  const previewSnippets: Array<{ page: string; before: string; match: string; after: string; range: [number, number] }> = [];
  for (const c of cites) {
    if (!c.ranges.length) continue;
    if (!pageTextCache[c.page]) {
      try {
        pageTextCache[c.page] = fs_.readFileSync(
          path.join(REPO_ROOT, c.page),
          "utf8",
        );
      } catch {
        pageTextCache[c.page] = "";
      }
    }
    const text = pageTextCache[c.page];
    if (!text) continue;
    const [s, e] = c.ranges[0];
    const snip = snippetAround(text, s, e, 90);
    previewSnippets.push({ page: c.page, ...snip, range: [s, e] });
  }

  const totalReferences = cites.reduce((s, c) => s + c.referenceCount, 0);
  const declaredOnly = cites.filter((c) => c.declaredInFrontmatter && c.referenceCount === 0);

  return (
    <>
      <CrumbBack href="/sources" label="Sources" />
      <PageTitle
        eyebrow={isPdf ? "PDF source" : "Source"}
        title={path.basename(rel)}
        subtitle={<span className="mono text-xs">{rel}</span>}
        right={
          fan.length === 0 ? (
            <span className="badge-warn">orphan</span>
          ) : (
            <span className="pill pill-accent">
              {fan.length} citing page{fan.length === 1 ? "" : "s"}
            </span>
          )
        }
      />

      <div className="grid grid-cols-3 gap-6">
        <section className="col-span-2 space-y-6">
          {/* CITING PAGES */}
          <div className="glass rounded-2xl overflow-hidden">
            <header className="px-5 py-3 border-b border-ink-100">
              <div className="text-[11px] uppercase tracking-wide text-ink-500">
                Citing pages
              </div>
              <div className="text-sm text-ink-700">
                {cites.length} page{cites.length === 1 ? "" : "s"} reference
                this source · {totalReferences} in-body reference
                {totalReferences === 1 ? "" : "s"}
              </div>
            </header>
            {cites.length === 0 ? (
              <div className="p-5 text-sm text-ink-500">
                No wiki page declares or cites this source.
              </div>
            ) : (
              <table className="ink-table">
                <thead>
                  <tr>
                    <th>Page</th>
                    <th>Where</th>
                    <th>Ranges</th>
                  </tr>
                </thead>
                <tbody>
                  {cites.map((c) => (
                    <tr key={c.page}>
                      <td>
                        <Link
                          className="link mono text-xs"
                          href={`/pages/${encodeURIComponent(c.page)}`}
                        >
                          {c.page.replace("wiki/", "")}
                        </Link>
                      </td>
                      <td className="text-xs">
                        {c.declaredInFrontmatter && (
                          <span className="pill mr-1">frontmatter</span>
                        )}
                        {c.referenceCount > 0 && (
                          <span className="pill pill-accent">
                            {c.referenceCount} body ref
                            {c.referenceCount === 1 ? "" : "s"}
                          </span>
                        )}
                      </td>
                      <td className="mono text-[11px] text-ink-500">
                        {c.ranges
                          .slice(0, 4)
                          .map((r) => `${r[0]}–${r[1]}`)
                          .join(", ")}
                        {c.ranges.length > 4 ? "…" : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* PREVIEW SNIPPETS */}
          {previewSnippets.length > 0 && (
            <div className="glass rounded-2xl overflow-hidden">
              <header className="px-5 py-3 border-b border-ink-100">
                <div className="text-[11px] uppercase tracking-wide text-ink-500">
                  How citing pages reference this source
                </div>
                <div className="text-sm text-ink-700">
                  First reference per page, ±90 chars of context
                </div>
              </header>
              <ol className="divide-y divide-ink-100">
                {previewSnippets.map((s, i) => (
                  <li key={i} className="px-5 py-4">
                    <div className="flex items-baseline gap-2 mb-1.5">
                      <Link
                        className="link mono text-xs"
                        href={`/pages/${encodeURIComponent(s.page)}`}
                      >
                        {s.page.replace("wiki/", "")}
                      </Link>
                      <span className="ml-auto mono text-[11px] text-ink-400">
                        bytes {s.range[0]}–{s.range[1]}
                      </span>
                    </div>
                    <p className="text-[13px] leading-relaxed text-ink-700">
                      <span className="text-ink-400">…{s.before}</span>
                      <mark className="bg-accent-bg text-accent-dark px-0.5 rounded">
                        {s.match}
                      </mark>
                      <span className="text-ink-400">{s.after}…</span>
                    </p>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/* EVAL USAGE */}
          {usage.totalCells > 0 && (
            <div className="glass rounded-2xl overflow-hidden">
              <header className="px-5 py-3 border-b border-ink-100">
                <div className="text-[11px] uppercase tracking-wide text-ink-500">
                  Eval cells citing this source
                </div>
                <div className="text-sm text-ink-700">
                  {usage.totalCells} cell{usage.totalCells === 1 ? "" : "s"}{" "}
                  mentioned this path in the answer · {usage.fullyCorrect}{" "}
                  fully correct
                </div>
              </header>
              <table className="ink-table">
                <thead>
                  <tr>
                    <th>Question</th>
                    <th>Cells</th>
                    <th>Fully correct</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(usage.byQid)
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([qid, v]) => (
                      <tr key={qid}>
                        <td>
                          <span className="mono text-xs">{qid}</span>
                        </td>
                        <td className="mono text-xs">{v.cells}</td>
                        <td>
                          <EvalBadge correct={v.correct} total={v.cells} />
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* SIDEBAR */}
        <aside className="space-y-6">
          <div className="glass rounded-2xl p-5">
            <div className="text-[11px] uppercase tracking-wide text-ink-500 mb-2">
              File
            </div>
            <dl className="text-sm space-y-1.5 text-ink-700">
              <div className="flex justify-between gap-2">
                <dt className="text-ink-500">Path</dt>
                <dd className="mono text-[11px] break-all text-right">{rel}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-500">Size</dt>
                <dd className="mono text-xs">
                  {(file.size / 1024).toFixed(1)} KB
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-500">Modified</dt>
                <dd className="mono text-xs">
                  {new Date(file.mtime * 1000).toISOString().slice(0, 10)}
                </dd>
              </div>
            </dl>
          </div>

          {(companion || costHint) && (
            <div className="glass rounded-2xl p-5">
              <div className="text-[11px] uppercase tracking-wide text-ink-500 mb-2">
                Parsed companion
              </div>
              {companion ? (
                <Link
                  href={`/sources/${encodeURIComponent(companion)}`}
                  className="link mono text-xs break-all"
                >
                  {companion}
                </Link>
              ) : (
                <div className="text-xs text-ink-500 italic">
                  No parsed Markdown found
                </div>
              )}
              {costHint && (
                <div className="mt-3 pt-3 border-t border-ink-100">
                  <div className="text-[11px] uppercase tracking-wide text-ink-500 mb-1">
                    Parse cost
                  </div>
                  <div className="text-sm font-mono">{costHint}</div>
                  <div className="text-[11px] text-ink-400 mt-0.5">
                    via{" "}
                    <Link href="/pages/wiki%2Fpulse.md" className="link">
                      wiki/pulse.md
                    </Link>
                  </div>
                </div>
              )}
            </div>
          )}

          {declaredOnly.length > 0 && (
            <div className="glass rounded-2xl p-5">
              <div className="text-[11px] uppercase tracking-wide text-amber-700 mb-2">
                Declared but never cited
              </div>
              <p className="text-xs text-ink-600 mb-2">
                These pages list this source in frontmatter but never reference
                it in body — a candidate for an{" "}
                <code className="mono text-[11px]">orphan_source</code> finding.
              </p>
              <ul className="text-xs space-y-1">
                {declaredOnly.map((c) => (
                  <li key={c.page}>
                    <Link
                      className="link mono"
                      href={`/pages/${encodeURIComponent(c.page)}`}
                    >
                      {c.page.replace("wiki/", "")}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>
    </>
  );
}
