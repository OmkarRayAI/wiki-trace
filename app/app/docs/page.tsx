import Link from "next/link";
import { PageTitle } from "@/components/widgets";

export default function Docs() {
  return (
    <>
      <PageTitle
        eyebrow="Documentation"
        title="Everything you need to use wiki-trace"
        subtitle="Quick start, core concepts, how-to guides, and answers to common questions. About a 5-minute read end-to-end."
      />

      <div className="grid grid-cols-[220px_1fr] gap-10 max-w-[1080px]">
        {/* Sticky TOC */}
        <aside className="sticky top-10 self-start hidden lg:block">
          <div className="eyebrow mb-3">On this page</div>
          <nav className="space-y-1.5 text-[13px]">
            <TocLink href="#quick-start" label="Quick start" />
            <TocLink href="#concepts" label="Core concepts" />
            <TocLink href="#playground" label="Playground" indent />
            <TocLink href="#knowledge" label="Knowledge" indent />
            <TocLink href="#evaluations" label="Evaluations" indent />
            <TocLink href="#risks" label="Risks" indent />
            <TocLink href="#activity" label="Activity" indent />
            <TocLink href="#how-to" label="How-to guides" />
            <TocLink href="#bring-your-own-rag" label="Bring your own RAG" />
            <TocLink href="#byo-requirements" label="Requirements" indent />
            <TocLink href="#shortcuts" label="Keyboard shortcuts" />
            <TocLink href="#faq" label="FAQ" />
            <TocLink href="#privacy" label="Privacy & security" />
          </nav>
        </aside>

        {/* Content */}
        <article className="space-y-12 max-w-[720px]">
          {/* QUICK START */}
          <Section id="quick-start" title="Quick start">
            <p>
              wiki-trace turns source documents into a curated knowledge base
              that grounds your LLM agent. Every step is traced. The
              fastest path to a working setup is three steps:
            </p>
            <Steps>
              <Step
                n="1"
                title="Drop a PDF in Playground"
                body="Open Playground (or click + New chat). Drag a PDF onto the chat, or use the paperclip. We parse it, draft a structured knowledge page, save it with provenance, and re-index — under 90 seconds end-to-end."
                cta={{ label: "Open Playground", href: "/playground" }}
              />
              <Step
                n="2"
                title="Ask a question"
                body="In the same chat, type a question grounded in what you uploaded. The agent picks the right pages, calls the model, and surfaces the answer with clickable citation pills. Watch the action stream to see every step."
              />
              <Step
                n="3"
                title="Check the receipts"
                body="Open Overview to see runs, actions traced, pages curated, and risks. Open Activity for the full replayable log. Each trace links back to the page it grounded on."
                cta={{ label: "Open Overview", href: "/today" }}
              />
            </Steps>
          </Section>

          {/* CONCEPTS */}
          <Section id="concepts" title="Core concepts">
            <Glossary>
              <Term name="Knowledge page">
                A curated Markdown file in your knowledge base. Has frontmatter
                with sources, audience, and an optional folder. Generated from
                an uploaded PDF, but you can edit it like any Markdown file.
              </Term>
              <Term name="Source document">
                The raw input — a PDF, deck, or Markdown file — that a knowledge
                page was built from. Stored under{" "}
                <code className="mono text-[12px]">raw/uploads/</code>. Each
                upload also produces a parsed Markdown companion next to the
                PDF for inspection.
              </Term>
              <Term name="Trace">
                A single run of any pipeline — an upload, a question, a scan,
                an evaluation. Traces are append-only and replayable. Each one
                contains a list of typed{" "}
                <em>actions</em> (page selected, model called, citation
                extracted, etc.).
              </Term>
              <Term name="Pass rate">
                Out of all expected facts in the evaluation suite, what
                fraction did the AI get right? The headline quality number.
              </Term>
              <Term name="Lift">
                Pass rate of the wiki-grounded agent <em>minus</em> pass rate
                of the RAG-only baseline, on the same questions. The number
                that justifies the curation work.
              </Term>
              <Term name="Page contribution">
                For each knowledge page, how many evaluation cells cited it,
                and what fraction of those cells were fully correct. Tells you
                which pages are doing the work — and which aren't.
              </Term>
            </Glossary>

            <Subsection id="playground" title="Playground">
              Where you build and ask. The chat input has a paperclip for PDFs
              and a folder picker for organizing them. Send: questions go to
              the agent, attached PDFs go through the upload pipeline.
              Conversations persist across reload via local storage; clear
              them with the "Clear chat" button.
            </Subsection>

            <Subsection id="knowledge" title="Knowledge">
              Two views of the same content: knowledge pages (the curated
              layer) and source documents (the raw inputs). Pages group by
              folder. Click any page to see its sources, who cites it, and
              its evaluation contribution.
            </Subsection>

            <Subsection id="evaluations" title="Evaluations">
              Score the AI against a frozen set of customer-style questions
              with known correct answers. Each question is graded fact by
              fact via an LLM judge.
              <br /><br />
              <strong>Authoring questions:</strong> Edit{" "}
              <code className="mono text-[12px]">eval/golden/questions.jsonl</code>.
              One question per line, JSON shape:
              <CodeBlock>
{`{"id":"q1","question":"...","expected_facts":["fact 1","fact 2"]}`}
              </CodeBlock>
              5–10 questions is enough to start. Make them cross-document if
              you want to show the wiki advantage clearly.
              <br /><br />
              <strong>Running an evaluation:</strong> Click "Run evaluation"
              on the Evaluations page. A 3-question run takes ~2 minutes and
              uses ~6 model calls. Results land in the runs list when done.
            </Subsection>

            <Subsection id="risks" title="Risks">
              Six checks run continuously on the knowledge base: broken
              cross-references, missing source files, missing inline
              references, stale pages (source updated after the page),
              orphan sources (declared but never cited), and unscoped pages
              (no audience tag, no source backing). Risk levels:{" "}
              <span className="badge-err">Blocking</span>{" "}
              <span className="badge-warn">Watch</span>{" "}
              <span className="badge-muted">FYI</span>.
            </Subsection>

            <Subsection id="activity" title="Activity">
              Every trace, sortable by pipeline. Click any run to see the
              full action timeline plus a plain-English AI summary. Open{" "}
              <code className="mono text-[12px]">/traces</code> directly or
              click "Open trace" from any answer in Playground.
            </Subsection>
          </Section>

          {/* HOW-TO */}
          <Section id="how-to" title="How-to guides">
            <HowTo
              q="How do I add a new PDF to my knowledge base?"
              a="Open Playground. Click the paperclip in the chat input, pick a PDF (or drag one onto the chat). Optionally pick a folder. Send. Watch the live action stream as we parse and save it."
            />
            <HowTo
              q="How do I organize pages into folders?"
              a="When uploading, click the folder chip in the chat input next to the paperclip. Select an existing folder or create a new one inline. The folder gets written into the page's frontmatter and the Knowledge view groups by folder header."
            />
            <HowTo
              q="How do I author evaluation questions?"
              a={`Create eval/golden/questions.jsonl in your repo. One question per line, JSON shape: {"id": "...", "question": "...", "expected_facts": ["fact1", "fact2"]}. Save the file, refresh the Evaluations page — questions surface automatically.`}
            />
            <HowTo
              q="How do I check whether the AI is improving over time?"
              a="Run an evaluation, then run another after your next content change. The Evaluations page shows a release-over-release pass-rate trend chart once you have at least two runs that share the same agent label."
            />
            <HowTo
              q="How do I find out which page produced a wrong answer?"
              a="Open the run from Activity or Evaluations. The action timeline shows which knowledge pages were selected, what the model returned, and which citations were extracted. The full payload of any step is one click away."
            />
            <HowTo
              q="How do I share a specific trace with my team?"
              a={`Every trace has a permalink at /traces/<id>. Open the trace, copy the URL. The page renders a plain-English summary plus the full timeline — no engineering context required to read.`}
            />
          </Section>

          {/* BYO-RAG */}
          <Section id="bring-your-own-rag" title="Bring your own RAG">
            <p>
              Already have a working RAG pipeline? Don't replace it. Wrap
              it. wiki-trace adds the quality dashboard your retriever
              doesn't have without changing how you retrieve or generate.
            </p>

            <Subsection id="byo-requirements" title="Requirements (read first)">
              <p>
                Not every RAG stack works today. Check these four
                conditions before you spend time integrating:
              </p>
              <ul className="list-disc pl-5 space-y-2 mt-3">
                <li>
                  <strong>Python</strong>, or willing to write a 30-line
                  JSONL-emitter shim in your language of choice. Node/Go/Rust
                  ports are planned but not shipped.
                </li>
                <li>
                  <strong>Stable, reusable chunk IDs</strong> from your
                  retriever — FAISS row indices, Pinecone vector IDs,
                  doc-id+offset hashes. If your IDs regenerate every run,
                  page-contribution metrics are meaningless; fix that
                  first.
                </li>
                <li>
                  <strong>A scoring function</strong> that returns{" "}
                  <code className="mono text-[12px]">(correct, total)</code>{" "}
                  per answer cell. LLM-as-judge, regex matchers, manual
                  labels — anything works as long as it produces those two
                  numbers.
                </li>
                <li>
                  <strong>Local disk write access</strong> for{" "}
                  <code className="mono text-[12px]">.wikitrace/spans.jsonl</code>.
                  Lambda / Vercel Edge / read-only environments need a
                  remote span backend we haven't shipped yet.
                </li>
              </ul>
              <p className="mt-3">
                Also: closed retrieval services that hide their chunks
                (e.g. Bedrock Knowledge Bases end-to-end mode) won't work
                — without chunk IDs, contribution attribution has nothing
                to attribute to. Use the same service in retrieval-only
                mode if available.
              </p>
            </Subsection>

            <Subsection id="byo-what-you-get" title="What you get">
              <ul className="list-disc pl-5 space-y-1.5">
                <li>
                  <strong>Pass rate over time</strong> — frozen evaluation
                  suite, scored fact by fact, release-over-release trend
                </li>
                <li>
                  <strong>Chunk contribution</strong> — same metric we
                  apply to curated wiki pages, applied to your retriever's
                  chunks. See exactly which chunks produce correct answers.
                </li>
                <li>
                  <strong>Action timelines</strong> — every retrieval,
                  every model call, every citation captured as a typed
                  event. PMs read the plain-English summary; engineers
                  drill into the JSON payload.
                </li>
                <li>
                  <strong>Risks</strong> — broken references, missing
                  source files, stale content. Independent of how you
                  retrieve.
                </li>
              </ul>
            </Subsection>

            <Subsection id="byo-30-line-recipe" title="30-line recipe">
              <p>
                Wrap each agent call in a <code className="mono text-[12px]">wikitrace.span()</code>{" "}
                and emit{" "}
                <code className="mono text-[12px]">chunk_refs=[...]</code>{" "}
                with the IDs of the chunks your retriever returned. That's
                the whole integration:
              </p>
              <CodeBlock>
{`import wikitrace

wikitrace.init(pipeline="eval", attrs={"run_id": "..."})

with wikitrace.span("eval", run_id=run_id):
    for q in questions:
        with wikitrace.span("question", qid=q["id"], question=q["question"]):
            # Your existing pipeline — no change
            chunks = my_retriever.search(q["question"], k=5)
            answer = my_llm.generate(q["question"], chunks)
            correct, total = my_judge(answer, q["expected_facts"])

            # The one thing you add: the agent_call span with chunk_refs
            with wikitrace.span(
                "agent_call",
                qid=q["id"],
                agent="my-rag",
                model="gpt-4o-mini",
                correct=correct,
                total=total,
                score=correct / total,
                chunk_refs=[c["id"] for c in chunks],   # ← key line
            ):
                pass

wikitrace.end()`}
              </CodeBlock>
              <p className="mt-3">
                That's it. Open <code className="mono text-[12px]">/traces</code>{" "}
                to see the run. Open{" "}
                <Link href="/evals" className="link">
                  /evals
                </Link>{" "}
                to see the chunk contribution table populate.
              </p>
            </Subsection>

            <Subsection id="byo-runnable-example" title="Runnable example">
              <p>
                A complete working file ships in the repo at{" "}
                <code className="mono text-[12px]">examples/byo_rag.py</code>.
                Fake retriever + fake LLM so you can see it work without
                external API keys. Run it once, watch the trace appear:
              </p>
              <CodeBlock>{`cd /path/to/llm-wiki
python examples/byo_rag.py
# → check /traces in the dashboard`}</CodeBlock>
              <p>
                Then replace the two TODOs (retriever, LLM call) with your
                real implementations. The wrapper structure stays
                identical.
              </p>
            </Subsection>

            <Subsection id="byo-what-stays" title="What you keep">
              <ul className="list-disc pl-5 space-y-1.5">
                <li>Your vector database (FAISS / Pinecone / Chroma / pgvector)</li>
                <li>Your retrieval logic (top-k, MMR, hybrid search)</li>
                <li>Your model provider (OpenAI / Anthropic / Bedrock)</li>
                <li>Your prompt templates</li>
                <li>Your existing trace store (Langfuse / Datadog / etc.) — we don't replace it, we sit alongside</li>
              </ul>
            </Subsection>

            <Subsection id="byo-when-to-add-the-wiki-layer" title="When to add the wiki layer">
              <p>
                Run the BYO-RAG instrumentation for two weeks. If your
                pass rate is flat at &lt;60% on cross-document
                synthesis questions, retrieval alone isn't enough — that's
                where adding curated knowledge pages typically lifts
                quality 30–60 points. The chunk-contribution view tells
                you exactly which questions to target with curation.
              </p>
              <p>
                If pass rate is high and stable, you don't need the wiki
                layer. Just keep the dashboard.
              </p>
            </Subsection>
          </Section>

          {/* SHORTCUTS */}
          <Section id="shortcuts" title="Keyboard shortcuts">
            <KbdRow keys="⌘K">Ask wiki-trace anything (workspace-aware)</KbdRow>
            <KbdRow keys="esc">Close any modal or panel</KbdRow>
            <KbdRow keys="↵">Send the current Playground message</KbdRow>
            <KbdRow keys="⇧↵">Add a new line in the Playground input</KbdRow>
          </Section>

          {/* FAQ */}
          <Section id="faq" title="FAQ">
            <Faq
              q="What models does wiki-trace use?"
              a="Whatever you point it at. Defaults to OpenRouter for both the agent and the trace summary, with a fallback chain across free-tier models. To pin a specific model, set WIKITRACE_MODEL in .env. Custom OpenAI-compatible endpoints work too."
            />
            <Faq
              q="Where does my data live?"
              a="Locally, in your repo. wiki/ holds curated pages, raw/uploads/ holds your source PDFs, .wikitrace/ holds the JSONL trace log. Nothing leaves your machine except model API calls."
            />
            <Faq
              q="Can I edit a knowledge page after it's been generated?"
              a="Yes. They're plain Markdown files with YAML frontmatter. Edit them in your editor, then re-scan from the CLI (python -m wikitrace scan) or just save — the dashboard reads from disk on every request."
            />
            <Faq
              q="What's the difference between this and a vector database?"
              a="A vector database stores chunks. We store curated pages — synthesized knowledge a human (or LLM) wrote intentionally. The agent grounds on those pages, not raw chunks. The wiki layer composes across documents in ways retrieval alone can't."
            />
            <Faq
              q="Is my evaluation suite portable?"
              a="Yes. eval/golden/questions.jsonl is a plain JSONL file. Copy it between workspaces, version it in git, edit it in any text editor."
            />
            <Faq
              q="Can the AI see my internal pages?"
              a={`No. Pages tagged audience: internal in their frontmatter are excluded from the agent's context, the AI search context, the Knowledge view, and every metric. They stay on disk for engineering reference but never reach a customer-facing answer.`}
            />
          </Section>

          {/* PRIVACY */}
          <Section id="privacy" title="Privacy & security">
            <p>
              wiki-trace is local-first. Your PDFs, knowledge pages, and trace
              logs live on your machine. The only data that leaves is what
              you send to your model provider — and that goes through your
              own API key, configured in{" "}
              <code className="mono text-[12px]">.env</code>.
            </p>
            <p>
              We log: trace IDs, span names, durations, page selections,
              citation references. We do not log: prompt contents at rest
              (unless you opt in), model API responses verbatim, or any user
              PII the system never sees.
            </p>
            <p>
              <Link href="/security" className="link">
                Read the full security note
              </Link>
            </p>
          </Section>

          <div
            className="rounded-2xl p-6 mt-6"
            style={{
              background: "oklch(0.95 0.04 65 / 0.5)",
              border: "1px solid oklch(0.86 0.10 55)",
            }}
          >
            <div
              className="font-display text-ink-900 mb-2"
              style={{ fontSize: 18, fontWeight: 600, letterSpacing: "-0.018em" }}
            >
              Still stuck?
            </div>
            <p className="text-[13.5px] text-ink-700 leading-relaxed mb-3">
              Drop the question in ⌘K — wiki-trace can answer most questions
              about itself, grounded in this page and your workspace state.
            </p>
            <Link
              href="/playground"
              className="text-[13px] font-semibold text-accent-dark hover:underline underline-offset-4"
            >
              Or open the Playground and start there ›
            </Link>
          </div>
        </article>
      </div>
    </>
  );
}

/* ─── Building blocks ─────────────────────────────────────────────────── */

function TocLink({
  href,
  label,
  indent,
}: {
  href: string;
  label: string;
  indent?: boolean;
}) {
  return (
    <a
      href={href}
      className="block text-ink-600 hover:text-ink-900 transition-colors"
      style={{ paddingLeft: indent ? 12 : 0 }}
    >
      {label}
    </a>
  );
}

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-10">
      <h2
        className="font-display text-ink-900 mb-4"
        style={{
          fontSize: 26,
          fontWeight: 600,
          letterSpacing: "-0.022em",
          fontVariationSettings: '"wdth" 100, "opsz" 28',
        }}
      >
        {title}
      </h2>
      <div className="text-[14.5px] text-ink-700 leading-[1.65] space-y-4">
        {children}
      </div>
    </section>
  );
}

function Subsection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div id={id} className="scroll-mt-10 pt-4">
      <h3
        className="font-display text-ink-900 mb-2"
        style={{
          fontSize: 17,
          fontWeight: 600,
          letterSpacing: "-0.018em",
        }}
      >
        {title}
      </h3>
      <div className="text-[14px] text-ink-700 leading-[1.65]">{children}</div>
    </div>
  );
}

function Steps({ children }: { children: React.ReactNode }) {
  return <div className="space-y-3">{children}</div>;
}

function Step({
  n,
  title,
  body,
  cta,
}: {
  n: string;
  title: string;
  body: string;
  cta?: { label: string; href: string };
}) {
  return (
    <div
      className="rounded-xl p-5 flex items-start gap-4"
      style={{
        background: "oklch(0.99 0.012 75 / 0.7)",
        border: "1px solid oklch(0.91 0.012 60 / 0.85)",
      }}
    >
      <div
        className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center font-display text-[13px] font-semibold"
        style={{
          background: "oklch(0.95 0.04 65)",
          color: "oklch(0.50 0.21 38)",
          border: "1px solid oklch(0.86 0.10 55)",
        }}
      >
        {n}
      </div>
      <div className="flex-1">
        <div
          className="font-display text-ink-900 mb-1"
          style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-0.015em" }}
        >
          {title}
        </div>
        <p className="text-[13.5px] text-ink-700 leading-relaxed">{body}</p>
        {cta && (
          <Link
            href={cta.href}
            className="text-[12.5px] font-semibold text-accent-dark hover:underline underline-offset-4 inline-block mt-2"
          >
            {cta.label} ›
          </Link>
        )}
      </div>
    </div>
  );
}

function Glossary({ children }: { children: React.ReactNode }) {
  return <dl className="space-y-3">{children}</dl>;
}

function Term({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[160px_1fr] gap-4">
      <dt className="font-display text-ink-900 text-[14px] font-semibold tracking-[-0.012em]">
        {name}
      </dt>
      <dd className="text-[13.5px] text-ink-700 leading-[1.6]">{children}</dd>
    </div>
  );
}

function HowTo({ q, a }: { q: string; a: string }) {
  return (
    <details className="group rounded-xl" style={{
      background: "oklch(0.99 0.012 75 / 0.6)",
      border: "1px solid oklch(0.91 0.012 60 / 0.7)",
    }}>
      <summary className="cursor-pointer px-4 py-3 list-none flex items-center justify-between gap-3 text-[14px] text-ink-900 font-medium">
        <span>{q}</span>
        <span className="text-ink-400 transition-transform group-open:rotate-90">›</span>
      </summary>
      <div
        className="px-4 pb-3 text-[13.5px] text-ink-700 leading-[1.65]"
        style={{ borderTop: "1px solid oklch(0.91 0.012 60 / 0.7)" }}
      >
        <div className="pt-3">{a}</div>
      </div>
    </details>
  );
}

function Faq({ q, a }: { q: string; a: string }) {
  return (
    <details className="group">
      <summary className="cursor-pointer list-none flex items-center justify-between gap-3 py-3 text-[14px] text-ink-900 font-semibold">
        <span>{q}</span>
        <span className="text-ink-400 transition-transform group-open:rotate-90">›</span>
      </summary>
      <p
        className="text-[13.5px] text-ink-700 leading-[1.65] pb-3"
        style={{ borderBottom: "1px solid oklch(0.91 0.012 60 / 0.5)" }}
      >
        {a}
      </p>
    </details>
  );
}

function CodeBlock({ children }: { children: React.ReactNode }) {
  return (
    <pre
      className="my-2 p-3 rounded-lg text-[12.5px] mono leading-relaxed overflow-x-auto"
      style={{
        background: "oklch(0.96 0.018 75 / 0.7)",
        border: "1px solid oklch(0.91 0.012 60 / 0.7)",
        color: "oklch(0.30 0.014 50)",
      }}
    >
      {children}
    </pre>
  );
}

function KbdRow({ keys, children }: { keys: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4 py-2" style={{ borderBottom: "1px solid oklch(0.91 0.012 60 / 0.5)" }}>
      <kbd
        className="mono text-[12px] px-2 py-1 rounded-md font-medium"
        style={{
          background: "oklch(0.96 0.018 75 / 0.8)",
          border: "1px solid oklch(0.86 0.014 60)",
          color: "oklch(0.32 0.014 50)",
          minWidth: 60,
          textAlign: "center",
        }}
      >
        {keys}
      </kbd>
      <span className="text-[13.5px] text-ink-700">{children}</span>
    </div>
  );
}
