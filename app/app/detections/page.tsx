import { findings, ERR_RULES, pagesIndex } from "@/lib/traces";
import { PageTitle } from "@/components/widgets";
import Link from "next/link";

const RULE_LABEL: Record<string, string> = {
  broken_wikilink: "Broken cross-reference",
  missing_source: "Missing source file",
  missing_raw_ref: "Missing inline source",
  missing_wiki_ref: "Missing inline page",
  stale_page: "Page may be stale",
  orphan_source: "Source unused",
  unscoped_page: "Page lacks audience or source",
};

export default function RisksView() {
  const fs = findings();
  const { pages } = pagesIndex();
  const errCount = fs.filter((f) => ERR_RULES.has(f.rule)).length;

  return (
    <>
      <PageTitle eyebrow="Risks" title="What could change tomorrow's answers" />

      {fs.length === 0 ? (
        <section className="glass rounded-2xl p-8">
          <div className="flex items-center gap-3 mb-3">
            <span
              className="w-2 h-2 rounded-full"
              style={{ background: "oklch(0.62 0.13 150)" }}
            />
            <span
              className="font-display text-ink-900"
              style={{ fontSize: 18, fontWeight: 600, letterSpacing: "-0.018em" }}
            >
              All clear
            </span>
          </div>
          <p className="text-[13.5px] text-ink-700 leading-relaxed max-w-[560px]">
            {pages.length === 0
              ? "We'll watch for broken references, missing sources, and stale pages once you upload content."
              : "We watch for broken references, missing sources, stale pages, and unscoped content. Nothing's wrong right now."}
          </p>
        </section>
      ) : (
        <>
          <p className="text-[14px] text-ink-700 mb-5">
            <span className="text-ink-900 font-semibold">
              {fs.length} issue{fs.length === 1 ? "" : "s"}
            </span>
            {errCount > 0 && ` · ${errCount} blocking`}.
          </p>
          <section className="glass rounded-2xl overflow-hidden">
            <table className="ink-table">
              <thead>
                <tr>
                  <th>Issue</th>
                  <th>Page</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {fs.map((f, i) => {
                  const isErr = ERR_RULES.has(f.rule);
                  return (
                    <tr key={i}>
                      <td className="w-[200px]">
                        <span className={isErr ? "badge-err" : "badge-warn"}>
                          {RULE_LABEL[f.rule] ?? f.rule}
                        </span>
                      </td>
                      <td>
                        <Link
                          className="link mono text-[12px]"
                          href={`/pages/${encodeURIComponent(f.page)}`}
                        >
                          {f.page.replace("wiki/", "")}
                        </Link>
                      </td>
                      <td className="text-[12px] text-ink-600">{f.detail}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        </>
      )}
    </>
  );
}
