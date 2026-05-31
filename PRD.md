# wiki-trace — Product Requirements Document

*Last updated: 2026-05-31. Audience: Claude (for context), YC partners, seed investors, founding hires.*

## TL;DR

Every team shipping an LLM feature is operating in the dark. They can't tell
if quality is improving, what content is doing the work, or what's about to
break. wiki-trace is an observability and editorial layer for AI knowledge
products: drop a PDF, get a grounded knowledge page, ask questions, see
every step traced. We sell to product managers and engineers who own AI
features in production. We're going from $0 to $1M ARR in 14 months on a
wedge nobody else is sitting on.

---

## 1. Problem

LLM features ship blind.

The pattern repeats: a team builds a chatbot, agent, or copilot grounded on
their docs. It demos beautifully. It hits production. Then a customer asks
the wrong question and gets a confidently wrong answer. The Slack channel
fills. Engineers stare at OpenAI traces. PMs stare at Slack escalations.
Nobody can tell, with numbers, whether the next release is better or worse
than the last one.

The fix everyone reaches for is RAG (retrieve-augmented generation): chunk
the docs, embed, retrieve top-k, generate. RAG is necessary but
insufficient. It re-derives every answer from scratch. It can't synthesize
across documents. It has no editorial layer. And worst of all, you can't
tell *what* the AI knows — just what it retrieved this turn.

**Three concrete failure modes we hear in customer interviews:**

1. **The CSAT regression nobody can explain.** A model swap landed last
   Tuesday. Three customers complained Thursday. Was it the new model? A
   stale doc? A bad chunk? The eng team can't reproduce. The PM has nothing
   to bring to the QBR.

2. **The "is this even working?" question.** The wiki team has been writing
   internal knowledge pages for six months. They cost real headcount. The
   exec asks: *what's the lift over baseline?* No one has a number.

3. **The release-blocker quality bar that doesn't exist.** Engineering
   wants to ship a prompt change. Product can't sign off because there's no
   eval suite. By the time they build one, the change is two weeks stale.

The state of the art today is one of three things, none sufficient:
- **OpenAI/Anthropic dashboards** — show token spend, not quality.
- **Langfuse / Phoenix / Helicone** — show traces and prompts; built for
  engineers debugging at 2am, not PMs presenting at standups. They don't
  model knowledge content as a first-class object.
- **Custom internal eval scripts** — every team writes their own; nobody
  trusts the numbers; nothing carries between releases.

## 2. Why now

Three forces converging in 2026:

1. **The first wave of LLM products has shipped — and started regressing.**
   Customer escalations are now the dominant cost center for AI teams.
   Companies that shipped in 2023–24 have 18+ months of unexplained quality
   drift. They want a quality system, not another model.

2. **The LLM-wiki pattern has gone mainstream.** Karpathy's gist (2024)
   formalized the "compile knowledge once, ground every query" pattern.
   Implementations like nashsu/llm_wiki and others are at thousands of
   GitHub stars. The pattern is proven; the dashboard for it doesn't exist.

3. **PMs are now line-managing AI features.** "AI PM" is a real role at
   every B2B SaaS over 50 employees. They need a tool aimed at their job —
   accountability, defensible metrics, content stewardship — not a
   developer trace viewer.

The window is open: enough teams are deep enough to need the dashboard, and
no incumbent has shipped a PM-shaped product. Whoever owns this category in
the next 18 months owns it for a decade.

## 3. Solution

wiki-trace is two things in one product:

### Editorial layer
Drop a PDF, deck, or spec. Our pipeline parses it (via Pulse), drafts a
structured knowledge page (via the LLM), saves it with provenance, and
re-indexes the knowledge base. Every wiki page has frontmatter sources, a
single canonical owner, and full lineage to its raw documents. Sub-90
seconds end-to-end.

### Observability layer
Every action — page scanned, citation extracted, agent answered, page
contributed to a correct answer — is captured as a typed event in an
append-only log. The dashboard renders these as plain-English action
streams, headline metrics (pass rate, lift, coverage), and risks. PMs see a
single number. Engineers see the full timeline. Same source of truth.

**The thing that makes this defensible**: we don't build the wiki *and* a
generic trace viewer. We build them as one product because the editorial
data model is what gives observability its meaning. A trace event for "page
X contributed to a correct answer on question Y" is impossible without
knowing what page X is, what question Y is, and what "correct" means. We
own all three.

## 4. Target customer

### Primary persona: AI Product Manager
- B2B SaaS, 200–10,000 employees
- Owns at least one user-facing AI feature in production
- Reports to VP Product or CPO
- KPIs include: AI-feature CSAT, escalation rate, week-over-week answer
  quality
- Tools today: Slack, Notion, Excel, custom internal dashboards
- Budget: discretionary up to ~$2k/month; head-of-product approval up to
  $10k; CFO above that

### Secondary persona: Founding/Senior AI Engineer
- Builds and maintains the agent
- Reports to CTO or VP Engineering
- KPIs: model latency, cost, evaluation suite health
- Tools today: Langfuse / Phoenix / Helicone (trace viewers), custom eval
  scripts, the LLM provider's own dashboard
- Buys: not the buyer, but the gatekeeper. Will block any tool that
  doesn't surface raw spans on demand.

We sell to the PM. The engineer is the technical reviewer. Both have to
say yes.

### ICP — first 50 customers
- B2B SaaS, $5–100M ARR
- Has shipped at least one AI feature in production
- Has at least 1 PM and 2 engineers on the AI line
- Already paying for a model API ($1k+/mo OpenRouter, OpenAI, or Anthropic)
- Verticals to lead with: legal-tech, fin-services analytics, healthcare
  knowledge-base SaaS, sales/CS automation. These verticals share three
  things: high-stakes answers, strict provenance requirements, and curated
  document corpora that already exist.

We disqualify (for now): consumer apps, pure-creative tools, agents that
don't ground on customer-curated content.

## 5. Product surface

### What's shipped (as of 2026-05-31)
- **Playground** — single page, two tabs. Upload (drag-drop PDF, live SSE
  parse → draft → save → reindex). Ask (live agent, action stream, citations
  rendered as clickable pills, traces persisted).
- **Knowledge** — every curated page with health, sources, eval coverage.
  Click any page for citation snippets and lineage.
- **Evaluations** — wiki-vs-RAG bar charts, per-run question matrix,
  release-over-release pass-rate trend.
- **Risks** — six citation-health rules (broken cross-reference, missing
  source, orphan source, stale page, unscoped page, missing reference).
  Plain-English explanations, risk-graded blocking vs watch.
- **Activity** — every run as a navigable card. Click for action timeline
  + AI-generated narration of what the system did.
- **Overview** — top-of-funnel metrics (runs, actions, pages, risks),
  recent activity, quick links.
- **AI Search (⌘K)** — ask natural-language questions about workspace
  state ("which page is doing the most work?", "is the AI better this
  release?") with grounded citations.

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│ Marketing surface  (/, /manifesto, /security, /pricing)          │
│ — top nav, no sidebar, fundraise-grade copy                      │
├─────────────────────────────────────────────────────────────────┤
│ Product surface  (/playground, /pages, /evals, /detections,      │
│                   /traces, /today)                               │
│ — glass sidebar, action streams, server components               │
├─────────────────────────────────────────────────────────────────┤
│ Backend                                                          │
│   /api/upload      — SSE PDF→Pulse→draft→save→reindex pipeline   │
│   /api/playground  — SSE wiki-grounded agent with action events  │
│   /api/search      — workspace-aware ⌘K assistant                │
│   /api/trace-summary — AI-narrated trace explanation             │
├─────────────────────────────────────────────────────────────────┤
│ Storage                                                          │
│   wiki/*.md         — curated knowledge pages (frontmatter,      │
│                       audience tag, sources, [[wikilinks]])      │
│   raw/uploads/      — original PDFs + parsed Markdown            │
│   .wikitrace/       — append-only JSONL event log                │
│     spans.jsonl       (per-event spans, ~1KB each)               │
│     traces.jsonl      (per-run summaries)                        │
│     summaries/        (cached AI-narrated trace explanations)    │
├─────────────────────────────────────────────────────────────────┤
│ External APIs                                                    │
│   Pulse  — multipart PDF→Markdown, ~$0.001/page                  │
│   OpenRouter — unified API to 50+ models (Claude, GPT, Llama)    │
└─────────────────────────────────────────────────────────────────┘
```

Single-tenant local-first by default. Postgres + multi-tenant on the
managed-cloud roadmap (see §10).

## 6. The wedge

We are deliberately not Langfuse. We are deliberately not a wiki app. We
are the dashboard for the wiki-grounded AI feature.

| Dimension | Langfuse / Phoenix / Helicone | nashsu/llm_wiki | wiki-trace |
|---|---|---|---|
| Built for | Engineers debugging | Solo writers building a personal KB | PMs + engineers shipping a customer feature |
| First-class object | Span / trace | Wiki page | Wiki page **and** trace, modeled together |
| Editorial layer | None | Full desktop app | Single Playground tab |
| Quality metrics | Token cost, latency | None (research tool) | Pass rate, lift, page contribution, risks |
| PM-readable | No | No | Yes |
| Eng-readable | Yes | No | Yes (engineering view collapsed by default) |
| Hosting | SaaS | Local desktop | Local-first today, managed-cloud Q3 2026 |

Three things competitors structurally can't ship:
1. **Page contribution metric** — "this page produced 14/15 fully-correct
   answers this run." Requires both the wiki schema and the eval trace,
   which only we own.
2. **Citation health detections** — broken `[[wikilink]]`, stale page,
   orphan source. Requires understanding the wiki's content model. Not
   inferable from spans alone.
3. **Action streams the PM can read** — "Selected 4 knowledge pages →
   called Sonnet 4.6 → extracted 2 citations." Requires translating raw
   spans into editorially-meaningful events.

## 7. Business model

**Pricing today (live on `/pricing`):**

| Plan | Price | Audience |
|---|---|---|
| Solo | Free | Single builder, BYO model key, local-first |
| Team | $199/mo | The team shipping one AI feature, multi-user, eval suites, Slack alerts on regressions |
| Enterprise | Custom (target $30–100k ARR) | Multi-feature orgs, single-tenant deploy, SAML, BYOK, SOC 2 |

We charge for the workflow, not for tokens. Customers' model bills go to
their model provider directly. We don't markup inference. This matters
because: (a) it removes purchasing friction (CFOs already trust the model
provider), (b) it preserves model neutrality (we can't be locked-in), and
(c) it focuses our P&L on the real product (the dashboard) instead of
arbitrage.

**Unit economics target (post-$1M ARR):**
- Team plan: $199 ARPU, ~80% gross margin (small Pulse credits + minor
  hosting)
- Enterprise: $50k ACV target, ~70% gross margin (single-tenant infra)
- LTV/CAC target: 4× by month 18

## 8. Road to $1M ARR

Time-zero is **2026-05-31** (today). $1M ARR target: **2027-08-31** (15
months). Mix: ~$700k from 50 Team customers, ~$300k from 6 Enterprise.

### Phase 1 — YC + first 10 design partners (months 0–3)
- **Goal**: 10 design partners using the Team plan free during YC. 5 paying
  case studies by demo day.
- **Tactics**: ship at YC hackathon → 50 sign-ups within a week from the
  YC network → triage to 10 high-fit ICPs → onboarded white-glove.
- **What we learn**: which of legal/fin/healthcare/sales has the sharpest
  pain. Whether PMs convert without an engineer in the room.
- **What we build**: SAML-stub, Slack alerts on quality regressions,
  release-tagging on traces.
- **Hard milestone**: 5 paying customers at $199 = $11,940 ARR. Trivially
  small but proves willingness to pay.

### Phase 2 — Demo Day → seed close (months 3–6)
- **Goal**: Close $6M seed. 25 paying customers.
- **Tactics**: Demo Day presentation centered on the page-contribution
  metric (the one thing nobody else has). Two case studies showing
  measurable AI-feature quality lift. Lean into the YC investor network
  for the seed.
- **What we build**: Hosted multi-tenant. Postgres-backed traces. Audit
  log export. SSO.
- **Hard milestone**: 25 customers × $199 = $59,700 ARR + first
  Enterprise pilot at $50k = $109,700 ARR.

### Phase 3 — Outbound + content (months 6–10)
- **Goal**: 80 Team, 4 Enterprise.
- **Tactics**: PM-led GTM. 1 SDR, 1 founding AE. Inbound from content
  ("the page-contribution metric we shipped to track AI-feature quality")
  + warm referrals from design partners. Outbound to Series-B-and-up B2B
  SaaS in our four target verticals. Sponsor 2 conferences (Ramp Engineering
  Summit, Lenny's PM conference).
- **What we build**: HIPAA compliance, multi-workspace, custom eval-suite
  templates per vertical (legal-tech, fin-services), API for programmatic
  trace ingestion.
- **Hard milestone**: 80 × $199 + 4 × $50k = $215,920 ARR.

### Phase 4 — $1M ARR (months 10–15)
- **Goal**: $1M ARR exit velocity.
- **Mix**: 50 Team ($119,400) + 6 Enterprise ($300k) = $419,400 ARR
  recurring + ~$580k from upsells, expansion, mid-market deals.
- **Note**: This is the path that requires landing 1–2 lighthouse
  Enterprise customers (Fortune 500 legal-tech vendor or large fin-services
  ops platform). Without those, the path is doubling Team count to ~150.
- **Risks to call out**: enterprise sales cycles are 4–6 months; if we
  haven't started the conversations by month 8 we won't close by month 15.

### What kills the plan
- **A model provider ships native eval/observability that's good enough.**
  OpenAI evals shipped in 2024 but is still primitive. If they ship
  page-contribution-shaped metrics natively, our wedge narrows. Mitigation:
  ship the editorial layer fast — that's the moat the model providers
  won't build.
- **An incumbent (Langfuse, Datadog) acquires a wiki tool and pivots
  into our category.** Likeliest threat. Mitigation: ship product-led
  growth so adoption beats them to it.
- **Customers don't convert from free to Team.** Means our pricing or
  packaging is wrong. We'd respond by raising the free-tier limits and
  introducing a per-seat $29/mo "AI PM" tier.

## 9. Why this is venture-scalable

The TAM math:
- ~50,000 B2B SaaS companies above $5M ARR globally (Gartner / private)
- ~80% will have at least one production AI feature by 2027 (Gartner CIO survey)
- = ~40,000 ICPs
- At $30k blended ACV (mix of Team + Enterprise) = $1.2B addressable

That's a quiet but real category — not consumer-AI hype, but the
unsexy plumbing that every AI feature in production needs. Categories with
this shape (Datadog for application observability, Segment for customer
data, Vercel for frontend deployment) routinely produce $5–20B outcomes.
We're not promising one of those; we're promising the structural
positioning that makes one possible.

## 10. Roadmap (12 months)

### Q3 2026 (months 0–3)
- ✅ Live demo with PDF upload → grounded answer
- ✅ PM-readable action streams
- ✅ Page-contribution metric
- 🟡 Slack regression alerts (week 4)
- 🟡 Release tagging on traces (week 5)
- 🟡 First 10 design partners onboarded (month 3)

### Q4 2026 (months 3–6)
- Hosted multi-tenant
- Postgres-backed event log
- SAML SSO
- Audit log export
- 25 paying customers

### Q1 2027 (months 6–9)
- HIPAA roadmap delivery
- Custom eval-suite templates per vertical
- Public API for trace ingestion
- Customer-managed encryption keys (BYOK)
- 60 paying customers

### Q2 2027 (months 9–12)
- SOC 2 Type 2
- Single-tenant deployment offering
- ML-assisted page synthesis (cluster-of-PDFs → multi-page)
- 100+ paying customers, $1M ARR exit velocity

## 11. The team needed

**Today (founders)**: 2 full-stack ICs covering frontend, backend,
distributed systems, AI, design. We've shipped end-to-end in
~10 days from scratch.

**Hires by month 6 (post-seed)**:
- **Founding AE / sales lead** — has sold dev-tools or PM-tools to
  $5–50M-ARR companies. Closes the first 25 paying customers
  hands-on.
- **Founding designer** — has shipped a B2B SaaS product (Linear,
  Vercel, Posthog tier). Owns the visual system and product polish.
- **Senior eng — distributed systems** — builds the hosted multi-tenant
  platform. Postgres, event sourcing, SSO/SAML, multi-region.
- **Founding solutions engineer** — onboarding white-glove for the first
  50 customers. Becomes the playbook author for the eventual CS team.

By month 12: 8 people total, weighted toward engineering, with one strong
GTM lead.

## 12. The unfair advantage

Three things, ordered by durability:

1. **The data model.** wiki-trace's events are typed against an editorial
   schema that took us 6 months to converge on. Span aggregators and wiki
   apps each have half. We have both, and we're shipping the third
   (the dashboard glue) faster than they can re-architect.

2. **The PM positioning.** Every other tool in this space is built for
   engineers. We're built for the role accountable for the AI feature in
   front of the customer. That positioning is contested by zero
   competitors today. By the time someone notices, we've owned the
   conversation.

3. **The pace.** We shipped end-to-end (PDF upload, AI playground, action
   streams, evaluations, risks, marketing site, manifesto, pricing) in
   under 14 days of build time. We will continue to outpace competitors
   anchored to incremental engineering-feature roadmaps because we're
   answering one question — *"is the AI getting better?"* — and they're
   building twenty.

---

## Appendix A — What this is NOT

For clarity in conversations:

- **Not a wiki app.** We don't ship a writing surface. We expect customers
  to have one (Obsidian, the LLM-wiki repo, internal tools, manual MD
  files in git).
- **Not an LLM evaluation framework.** We integrate one (the eval suite
  in `eval/`), but we don't compete with EleutherAI eval-harness, OpenAI
  evals, or Patronus. We use them.
- **Not a model gateway.** We use OpenRouter. Customers can swap to any
  OpenAI-compatible endpoint.
- **Not a tracing framework.** OpenTelemetry's there if they want raw
  spans. We translate.
- **Not a vector database.** Embeddings live in the customer's own
  pipeline. We attach metrics to the unit *above* embeddings — the curated
  page.

## Appendix B — Open questions for YC partners

1. Is the PM persona fundable as the primary buyer, or do we need to lead
   with the engineer?
2. Should the seed go toward enterprise sales (faster path to $1M but
   higher CAC) or pure PLG inbound (slower but better unit economics)?
3. Do we deserve to charge $30–50k Enterprise ACVs at this maturity, or
   should we anchor at $10–15k for the first 5 deals to build references?
4. Bay Area or NYC? (Pattern matching: legal-tech and fin-services skew
   NYC; horizontal SaaS skews Bay.)

## Appendix C — Demo script (for first VC meeting)

90 seconds. No filler.

1. *(Open `/`)*: "Every team shipping an LLM feature is operating in the
   dark. They can't tell if it's getting better, what content is doing the
   work, or what's about to break. We fix that."
2. *(Open `/playground?tab=upload`)*: "I'm dropping a real banking deck
   from a customer. Watch this." Drop file. Action stream fires.
3. *(While parsing, narrate)*: "Pulse parses 49 pages. Our LLM drafts a
   structured knowledge page. We save it with provenance, re-index. 60
   seconds end-to-end."
4. *(Click Ask tab)*: "Now I ask a question that requires synthesizing
   across the deck." Type. Submit. Stream fires.
5. *(Citation pill appears)*: "The agent grounded on the page we just
   created. Every step is traceable." Click trace.
6. *(Open `/today`)*: "And here's the metrics view your PM lives in. One
   number: pass rate vs RAG baseline. The lift is what justifies their
   editorial team."
7. *(Close)*: "We charge $199/mo for teams, $30–100k for enterprise. Path
   to $1M ARR in 15 months. Asking $6M to get there."
