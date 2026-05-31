import fs_ from "node:fs";
import path from "node:path";
import {
  pagesIndex,
  findingsForPage,
  pageContribution,
  ERR_RULES,
  snippetAround,
} from "@/lib/traces";
import { REPO_ROOT } from "@/lib/repo";
import { PageTitle, CrumbBack, EvalBadge, PercentBar } from "@/components/widgets";
import Link from "next/link";
import { notFound } from "next/navigation";

export default async function PageDetail({
  params,
}: {
  params: Promise<{ rel: string[] }>;
}) {
  const { rel: relParts } = await params;
  const rel = decodeURIComponent(relParts.join("/"));
  const { pages } = pagesIndex();
  const page = pages.find((p) => p.page === rel);
  if (!page) notFound();

  const fs = findingsForPage(rel);
  const contrib = pageContribution()[rel];

  const inBody = (page.events ?? []).filter((c) => c.range);
  const declared = page.declared_sources ?? [];

  // Read the source markdown so we can render quoted snippets.
  const absPath = path.join(REPO_ROOT, rel);
  let pageText = "";
  try { pageText = fs_.readFileSync(absPath, "utf8"); } catch { /* ignore */ }

  return (
    <>
      <CrumbBack href="/pages" label="Pages" />
      <PageTitle
        eyebrow={page.page_type ?? "page"}
        title={page.title ?? rel}
        subtitle={<span className="mono">{rel}</span>}
        right={
          fs.length === 0 ? (
            <span className="badge-ok">healthy</span>
          ) : fs.some((f) => ERR_RULES.has(f.rule)) ? (
            <span className="badge-err">{fs.length} issue{fs.length === 1 ? "" : "s"}</span>
          ) : (
            <span className="badge-warn">{fs.length} warning{fs.length === 1 ? "" : "s"}</span>
          )
        }
      />

      <div className="grid grid-cols-3 gap-6">
        <section className="col-span-2 space-y-6">
          {contrib && (
            <div className="glass rounded-2xl p-5">
              <div className="text-[11px] uppercase tracking-wide text-ink-500 mb-2">
                Eval contribution
              </div>
              <div className="flex items-center gap-3 mb-3">
                <PercentBar
                  value={contrib.correct_cells}
                  total={contrib.cells}
                  width={200}
                />
                <EvalBadge
                  correct={contrib.correct_cells}
                  total={contrib.cells}
                />
                <span className="text-xs text-ink-500 ml-auto">
                  {contrib.qids.length} qids · {contrib.agents.length} agents
                </span>
              </div>
              <div className="flex flex-wrap gap-1">
                {contrib.qids.map((q) => (
                  <span key={q} className="pill">{q}</span>
                ))}
              </div>
            </div>
          )}

          <div className="glass rounded-2xl overflow-hidden">
            <header className="px-5 py-3 border-b border-ink-100">
              <div className="text-[11px] uppercase tracking-wide text-ink-500">
                In-body citations
              </div>
              <div className="text-sm text-ink-700">
                {inBody.length} reference{inBody.length === 1 ? "" : "s"} — quoted from your markdown, with the citation highlighted
              </div>
            </header>
            {inBody.length === 0 ? (
              <div className="p-5 text-sm text-ink-500">No citations in body.</div>
            ) : (
              <ol className="divide-y divide-ink-100">
                {inBody.map((c, i) => {
                  const target = c.source ?? "";
                  const kind = c.claim ?? "?";
                  const linkHref =
                    kind === "wikilink"
                      ? `/pages/${encodeURIComponent("wiki/" + target + ".md")}`
                      : kind === "wiki_ref"
                      ? `/pages/${encodeURIComponent(target)}`
                      : kind === "raw_ref"
                      ? `/sources/${encodeURIComponent(target)}`
                      : null;
                  const snip = pageText && c.range
                    ? snippetAround(pageText, c.range[0], c.range[1], 80)
                    : null;
                  return (
                    <li key={i} className="px-5 py-4">
                      <div className="flex items-baseline gap-2 mb-1.5">
                        <span className="pill text-[10px]">{kind}</span>
                        {linkHref ? (
                          <Link href={linkHref} className="link mono text-xs">
                            {kind === "wikilink" ? `[[${target}]]` : target}
                          </Link>
                        ) : (
                          <span className="mono text-xs">{target}</span>
                        )}
                        <span className="ml-auto mono text-[11px] text-ink-400">
                          {c.range ? `bytes ${c.range[0]}–${c.range[1]}` : ""}
                        </span>
                      </div>
                      {snip ? (
                        <p className="text-[13px] leading-relaxed text-ink-700">
                          <span className="text-ink-400">…{snip.before}</span>
                          <mark className="bg-accent-bg text-accent-dark px-0.5 rounded">
                            {snip.match}
                          </mark>
                          <span className="text-ink-400">{snip.after}…</span>
                        </p>
                      ) : (
                        <p className="text-xs text-ink-400 italic">
                          (snippet unavailable — couldn't read source)
                        </p>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
          </div>

          {fs.length > 0 && (
            <div className="glass rounded-2xl overflow-hidden">
              <header className="px-5 py-3 border-b border-ink-100">
                <div className="text-[11px] uppercase tracking-wide text-ink-500">
                  Detections
                </div>
              </header>
              <table className="ink-table">
                <tbody>
                  {fs.map((f, i) => (
                    <tr key={i}>
                      <td>
                        <span
                          className={
                            ERR_RULES.has(f.rule) ? "badge-err" : "badge-warn"
                          }
                        >
                          {f.rule}
                        </span>
                      </td>
                      <td className="mono text-xs">{f.target}</td>
                      <td className="text-xs text-ink-600">{f.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <aside className="space-y-6">
          <div className="glass rounded-2xl p-5">
            <div className="text-[11px] uppercase tracking-wide text-ink-500 mb-2">
              Metadata
            </div>
            <dl className="text-sm space-y-1.5">
              <div className="flex justify-between">
                <dt className="text-ink-500">Updated</dt>
                <dd className="mono">{page.updated ?? "—"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-500">Size</dt>
                <dd className="mono">{page.size.toLocaleString()} B</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-500">Citations</dt>
                <dd className="mono">{page.citation_count}</dd>
              </div>
            </dl>
          </div>

          <div className="glass rounded-2xl p-5">
            <div className="text-[11px] uppercase tracking-wide text-ink-500 mb-2">
              Declared sources
            </div>
            {declared.length === 0 ? (
              <div className="text-xs text-ink-500">none</div>
            ) : (
              <ul className="text-xs space-y-1.5">
                {declared.map((s) => (
                  <li key={s} className="mono break-all">
                    {s.startsWith("http") ? (
                      <a
                        className="link"
                        href={s}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {s}
                      </a>
                    ) : (
                      s
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>
    </>
  );
}
