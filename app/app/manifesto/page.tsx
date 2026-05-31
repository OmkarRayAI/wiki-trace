import Link from "next/link";

export default function Manifesto() {
  return (
    <article className="px-8 py-20">
      <div className="max-w-[760px] mx-auto">
        <div className="eyebrow mb-5">Manifesto</div>
        <h1
          className="font-display font-semibold tracking-[-0.030em] leading-[1.05] text-ink-900 mb-10"
          style={{
            fontSize: "clamp(38px, 4.6vw, 64px)",
            fontVariationSettings: '"wdth" 95, "opsz" 56',
          }}
        >
          Stop guessing whether your AI is getting better.
        </h1>

        <div className="space-y-5 text-[16.5px] text-ink-800 leading-[1.7]">
          <p className="text-[18px] text-ink-900 font-medium">
            Every team shipping an LLM feature is operating in the dark.
          </p>
          <p>
            They watch a Slack thread fill with "the AI got it wrong again."
            They guess at why. They tweak a prompt, swap a model, add another
            chunk to the index, hope. The next release lands and the cycle
            repeats. Nobody can tell, with numbers, whether the product is
            improving or regressing.
          </p>
          <p>
            We've watched this happen at companies large and small. The
            engineers want to fix it. The PM wants to ship it. The exec wants
            to know if the program is worth the headcount. Everyone is
            looking at the same broken artifact: a prompt log, a Datadog
            dashboard built for HTTP traffic, a vector store with no story.
          </p>

          <h2
            className="font-display text-ink-900 mt-12 mb-3"
            style={{ fontSize: 26, fontWeight: 600, letterSpacing: "-0.020em" }}
          >
            What we believe
          </h2>
          <p>
            <strong>Knowledge is editorial work.</strong> A good answer comes
            from a curated knowledge page someone wrote on purpose, not from
            statistical chunks of a PDF. RAG re-derives every answer from
            zero. A wiki compiles synthesis once and keeps it current. The
            wiki pattern wins because <em>understanding</em> is the bottleneck,
            not retrieval.
          </p>
          <p>
            <strong>Every action should be traceable.</strong> When the AI
            answers a question, you should be able to see which page it picked
            up, what the model said, where the citation came from. Not
            tomorrow. Not after a debug session. Now, in plain English, with
            a click-through to the source.
          </p>
          <p>
            <strong>Quality is a number, not a vibe.</strong> Pass rate
            against a fixed eval suite, lift over a baseline, page
            contribution, open risks — these are the metrics a PM has to
            defend in front of an exec. They should be on a single page, in
            one sentence, with no spreadsheet required.
          </p>
          <p>
            <strong>The same data serves everyone.</strong> The PM watching a
            release and the engineer debugging a bad answer are looking at
            the same trace. We don't build separate tools for separate roles.
            We build one source of truth and let each role render the view
            they need.
          </p>

          <h2
            className="font-display text-ink-900 mt-12 mb-3"
            style={{ fontSize: 26, fontWeight: 600, letterSpacing: "-0.020em" }}
          >
            What we're building
          </h2>
          <p>
            wiki-trace is the dashboard your AI team didn't know it could have.
            Source documents become curated knowledge. Knowledge gets
            evaluated against real customer-style questions. Every answer is
            traced. Every regression is named. Every dollar of editorial work
            shows up as measurable lift.
          </p>
          <p>
            We're starting with the LLM-wiki pattern because it's the cleanest
            unit to instrument. We'll generalize as the customers ask us to.
          </p>

          <h2
            className="font-display text-ink-900 mt-12 mb-3"
            style={{ fontSize: 26, fontWeight: 600, letterSpacing: "-0.020em" }}
          >
            What we won't do
          </h2>
          <p>
            We won't ship a vague "AI observability" platform that monitors
            HTTP latency and calls it intelligence. We won't pretend
            prompt-engineering tools are the same problem. We won't add
            features no PM and no engineer asks for. The discipline is what
            makes this product useful.
          </p>

          <div
            className="mt-14 pt-8 flex items-center gap-3 flex-wrap"
            style={{ borderTop: "1px solid oklch(0.92 0.006 40 / 0.7)" }}
          >
            <Link href="/upload" className="btn-primary" style={{ padding: "12px 22px", fontSize: 14 }}>
              Try it on your PDF
              <span className="text-white/70 ml-0.5">›</span>
            </Link>
            <Link href="/today" className="btn-secondary" style={{ padding: "12px 20px", fontSize: 14 }}>
              See the dashboard
            </Link>
          </div>
        </div>
      </div>
    </article>
  );
}
