import { pagesIndex, fanIn } from "@/lib/traces";
import { PageTitle, Empty } from "@/components/widgets";
import { ContentTabs } from "@/components/ContentTabs";
import Link from "next/link";

export default async function SourcesIndex() {
  const { raw, pages } = pagesIndex();
  const fan = fanIn();

  // Only show sources that are referenced by customer-facing knowledge pages.
  const visible = raw.filter((r) => (fan[r.path]?.length ?? 0) > 0);
  const totalBytes = visible.reduce((s, r) => s + r.size, 0);

  return (
    <>
      <PageTitle
        eyebrow="Knowledge"
        title="The documents your knowledge pages are built from"
        subtitle={`${visible.length} source documents currently powering the customer-facing knowledge base — ${(totalBytes / 1024 / 1024).toFixed(1)} MB total. Click into any one to see exactly which knowledge pages cite it and where in the page the citation lands.`}
      />

      <ContentTabs
        active="sources"
        countLeft={pages.length}
        countRight={visible.length}
      />

      {visible.length === 0 ? (
        <Empty>
          No source documents yet. Upload a PDF in the Playground to add one.
        </Empty>
      ) : (
        <div className="glass rounded-2xl overflow-hidden">
          <table className="ink-table">
            <thead>
              <tr>
                <th>Document</th>
                <th>Size</th>
                <th>Used by</th>
              </tr>
            </thead>
            <tbody>
              {[...visible]
                .sort((a, b) => a.path.localeCompare(b.path))
                .map((r) => {
                  const consumers = fan[r.path] ?? [];
                  return (
                    <tr key={r.path}>
                      <td>
                        <Link
                          href={`/sources/${encodeURIComponent(r.path)}`}
                          className="link mono text-xs"
                        >
                          {r.path}
                        </Link>
                        <div className="text-[11px] text-ink-400 mt-0.5">
                          {r.path.endsWith(".pdf")
                            ? "PDF"
                            : r.path.endsWith(".md")
                            ? "Markdown"
                            : "—"}
                        </div>
                      </td>
                      <td className="mono text-xs text-ink-600">
                        {(r.size / 1024).toFixed(1)} KB
                      </td>
                      <td>
                        {consumers.length === 0 ? (
                          <span className="text-xs text-ink-400">orphan</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {consumers.map((c) => (
                              <Link
                                key={c}
                                href={`/pages/${encodeURIComponent(c)}`}
                                className="pill pill-accent"
                              >
                                {c.replace("wiki/", "").replace(".md", "")}
                              </Link>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
