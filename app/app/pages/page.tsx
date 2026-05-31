import { pagesIndex } from "@/lib/traces";
import { PageTitle, Empty } from "@/components/widgets";
import Link from "next/link";

export default async function PagesIndex() {
  const { pages } = pagesIndex();

  return (
    <>
      <PageTitle
        eyebrow="Knowledge"
        title="Pages your AI answers from"
      />

      {pages.length === 0 ? (
        <Empty>
          No knowledge pages yet.{" "}
          <Link href="/playground" className="link">Drop a PDF in the Playground</Link>{" "}
          to add one.
        </Empty>
      ) : (
        <div className="glass rounded-2xl overflow-hidden">
          <ul>
            {pages
              .slice()
              .sort((a, b) => a.page.localeCompare(b.page))
              .map((p, i) => (
                <li
                  key={p.page}
                  style={
                    i === 0
                      ? {}
                      : { borderTop: "1px solid oklch(0.93 0.012 60 / 0.7)" }
                  }
                >
                  <Link
                    href={`/pages/${encodeURIComponent(p.page)}`}
                    className="px-5 py-4 flex items-baseline justify-between gap-3 hover:bg-accent-bg/30 transition-colors"
                  >
                    <span className="flex-1 min-w-0">
                      <span className="block text-[14px] text-ink-900 font-medium truncate">
                        {p.title || p.page.replace("wiki/", "").replace(".md", "")}
                      </span>
                      <span className="block text-[11.5px] text-ink-500 mono mt-0.5 truncate">
                        {p.page.replace("wiki/", "")}
                      </span>
                    </span>
                    <span className="text-[11.5px] text-ink-500 mono whitespace-nowrap">
                      {p.updated || ""}
                    </span>
                  </Link>
                </li>
              ))}
          </ul>
        </div>
      )}
    </>
  );
}
