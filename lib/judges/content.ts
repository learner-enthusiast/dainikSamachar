/**
 * Copy, links and evidence for the public neatHack judges page at `/judges`.
 * Change wording or add evidence here, not in the components. A `href: null`
 * renders as "not linked yet" — fill it in rather than deleting the row.
 */

export const GITHUB_REPO = "https://github.com/learner-enthusiast/dainikSamachar";
const ENTIRE_REPO = "https://entire.io/gh/learner-enthusiast/dainikSamachar";

export type JudgeCommit = {
  sha: string;
  /** ISO 8601 author date. */
  date: string;
  subject: string;
  /** `Entire-Checkpoint` trailer, or null when the commit predates Entire. */
  checkpoint: string | null;
  /** Subject or body mentions Neatlogs. */
  neatlogs: boolean;
};

/** The GitHub commit URL with `github.com` swapped for `entire.io/gh`. */
export function entireCommitUrl(sha: string): string {
  return `${ENTIRE_REPO}/commit/${sha}`;
}

export function githubCommitUrl(sha: string): string {
  return `${GITHUB_REPO}/commit/${sha}`;
}

export function githubFileUrl(path: string, line?: number): string {
  return `${GITHUB_REPO}/blob/main/${path}${line ? `#L${line}` : ""}`;
}

export type Link = { label: string; href: string | null };

export const HERO = {
  eyebrow: "neatHack 2026 · for judges",
  title: "Check every Dainik Samachar claim in a minute.",
  lede: "An agentic newsroom for Indian investors: it plans searches, scrapes sources, ranks headlines by impact and writes cited briefings and stock research. Every claim below links to a commit, a file, or a screenshot.",
  jumps: [
    { label: "Evidence rows", href: "#evidence" },
    { label: "neatlogs", href: "#neatlogs" },
    { label: "Entire commits", href: "#entire" },
    { label: "cfo.ai plan", href: "#cfo" },
    { label: "Verify locally", href: "#verify" },
  ],
} as const;

export const JUDGES = [
  { name: "Ajay Yadav", role: "Founder and CEO, neatlogs", href: "https://x.com/bettersayAJ" },
  { name: "Akshay Hangloo", role: "Head of product engineering, neatlogs", href: "https://x.com/akshay_hangloo" },
  { name: "Haimantika Mitra", role: "Senior DevRel, Entire", href: "https://x.com/HaimantikaM" },
  { name: "Abhi Singh", role: "Senior solutions engineer, Entire", href: "https://www.linkedin.com/in/abhi-singhs/" },
  { name: "Prateek Karnal", role: "Founder, Orchestrator.inc", href: "https://x.com/agent_wrapper" },
] as const;

export const CRITERIA = [
  { weight: 30, name: "The agent", where: "#agent" },
  { weight: 25, name: "neatlogs, Entire, cfo.ai", where: "#neatlogs" },
  { weight: 20, name: "Demo video", where: "#demo" },
  { weight: 15, name: "Building in public", where: "#evidence" },
  { weight: 10, name: "Usefulness", where: "#agent" },
] as const;

/**
 * Fill these in before submitting. Rows and sections that depend on them show
 * "not linked yet" until then.
 */
export const PENDING = {
  /** YouTube video id (the `v=` part of the watch URL); the slot stays empty until set. */
  demoVideoId: "aiGtUomSRCU" as string | null,
  /** Posts tagged #neatHack, oldest first. */
  publicPosts: [] as { label: string; href: string }[],
  /** Shareable cfo.ai model link (the workspace link needs a cfo.ai login). */
  cfoShare: "https://cfo.ai/s/Ida4SXIoVpU40HP7" as string | null,
  /** A before/after pair of neatlogs traces with the numbers compared. */
  improvement: null as string | null,
};

export type EvidenceRow = {
  claim: string;
  ask: string;
  tag: "In repo" | "Screenshots" | "Public";
  proof: string;
  links: Link[];
};

export const EVIDENCE: EvidenceRow[] = [
  {
    claim: "The agent improved",
    ask: "A run before your change and a run after it, with the numbers you compared",
    tag: "In repo",
    proof:
      "Tracing went from per-call-site wrappers (d542c4f) to one module that nests every agent, tool and LLM span under a single workflow trace (f9c5d3a).",
    links: [
      { label: "Before: d542c4f", href: entireCommitUrl("d542c4f38f8dff300d20b045985f23a256d0acd5") },
      { label: "After: f9c5d3a", href: entireCommitUrl("f9c5d3a142f333d9548022408b0b6967e88e9065") },
      { label: "Trace pair with numbers", href: PENDING.improvement },
    ],
  },
  {
    claim: "You used neatlogs",
    ask: "Links to neatlogs traces from your project, or screenshots of them",
    tag: "Screenshots",
    proof:
      "296 traces between Sep 29 and Oct 12 across six workflows, with neatlogs detections flagging a slow LLM response and failed stock research executions.",
    links: [
      { label: "Traces screenshot", href: "#neatlogs" },
      { label: "lib/observability/neatlogs.ts", href: githubFileUrl("lib/observability/neatlogs.ts") },
    ],
  },
  {
    claim: "You used Entire",
    ask: "Checkpoints or entire-graph output from your repository",
    tag: "Public",
    proof: "Every commit since the Neatlogs integration carries an Entire-Checkpoint trailer and opens on entire.io.",
    links: [
      { label: "All commits on Entire", href: "#entire" },
      { label: "Example: 99293e0", href: entireCommitUrl("99293e01b128bb70db3439d496d22f72e297abad") },
    ],
  },
  {
    claim: "You used cfo.ai",
    ask: "A business plan covering your agent's pricing, costs, revenue and runway",
    tag: "Public",
    proof:
      "A seven-page model built with Ari: assumptions, evidence, unit economics, operating forecast, sensitivity, pricing and risks.",
    links: [
      { label: "Screenshots", href: "#cfo" },
      { label: "cfo.ai model", href: PENDING.cfoShare },
    ],
  },
  {
    claim: "The agent recovers from failures",
    ask: "A run where an action failed, showing what the agent did next",
    tag: "In repo",
    proof:
      "Upstox calls retry twice with backoff; a failed Firecrawl scrape becomes null and the pipeline continues on the rest; a failed stock research run is marked FAILED with the error; a tracing failure runs the code untraced.",
    links: [
      { label: "Upstox retry", href: githubFileUrl("clients/upstoxClient.ts", 208) },
      { label: "Firecrawl null on failure", href: githubFileUrl("services/firecrawl/scrapeUrls.ts", 5) },
      { label: "onFailure", href: githubFileUrl("inngest/stockResearch/stockResearchPipeline.ts", 137) },
    ],
  },
  {
    claim: "You built in public",
    ask: "Links to what you shared during the hackathon, tagged #neatHack",
    tag: "Public",
    proof: "Posts tagged #neatHack during the build.",
    links: PENDING.publicPosts.length ? PENDING.publicPosts : [{ label: "#neatHack posts", href: null }],
  },
  {
    claim: "You wrote the code during the hackathon",
    ask: "A public repository with commits dated during the hackathon",
    tag: "Public",
    proof: "Public repository; every commit is dated Oct 10–12, 2026.",
    links: [
      { label: "GitHub repository", href: GITHUB_REPO },
      { label: "Commit list", href: "#entire" },
    ],
  },
];

export const EVIDENCE_NOTE = "neatlogs trace pages need a login, so the screenshots below stand in for them.";

export type Shot = { src: string; alt: string; caption: string; label?: string };

export const AGENT = {
  title: "One request, a full research desk behind it.",
  lede: "Decision agents plan the searches, pick articles and videos, scrape and clean them, then write stories that keep every source attached. Stock research adds live Upstox market data.",
  pipelines: [
    { name: "News briefing", detail: "Plan queries → SerpApi → select → Firecrawl → clean → YouTube → synthesize → rank" },
    { name: "Briefing rerun", detail: "Only new evidence since the last run; update, attach or add stories" },
    { name: "Chat", detail: "Guardrail → query enhancer → determiner decides search, scrape, YouTube, story" },
    { name: "Stock research", detail: "Prompt enhancer → tool determiner → Upstox + web → cited report" },
    { name: "Newsletters", detail: "Scheduled briefings emailed on the reader's timezone" },
    { name: "Public API", detail: "Pro REST API with async jobs and signed webhooks" },
  ],
  shots: [
    { src: "/judges/briefing-india.webp", alt: "Ranked India briefing with key takeaways and sources", caption: "Ranked India briefing" },
    { src: "/judges/story-2.webp", alt: "Story deep-dive panel with three linked sources", caption: "Every source linked" },
    { src: "/judges/research-1.webp", alt: "Reliance Industries research report with cited figures and a progress panel", caption: "Stock research, cited" },
    { src: "/judges/news-form.webp", alt: "Generate news form with scope, location and topics", caption: "Pick scope, place, topics" },
    { src: "/judges/newsletter-form.webp", alt: "Create newsletter form with a weekday 8 AM schedule", caption: "Briefings on a schedule" },
    { src: "/judges/api-docs.webp", alt: "OpenAPI 3.1 docs for the Dainik Samachar REST API", caption: "Open API docs" },
  ] satisfies Shot[],
};

export const NEATLOGS = {
  title: "neatlogs watched every run.",
  lede: "Each user action is one trace. The API route opens the root span; the W3C context rides the Inngest event so every step rejoins the same trace, with agent, tool and LLM spans nested inside.",
  stats: [
    { value: "296", label: "traces, Sep 29 – Oct 12" },
    { value: "6", label: "workflows traced end to end" },
    { value: "~4 KB", label: "input/output clip, secrets masked" },
  ],
  points: [
    "Workflows: stock research, chat, news, news rerun, newsletter, embeddings.",
    "Tool spans at the SerpApi, Upstox, Firecrawl, feed and Resend choke points, with Upstox retry counts.",
    "Per-step and per-run token totals and cost from a local price table.",
    "Masking redacts api_key params, bearer tokens, secret JSON fields and emails.",
    "Detections surfaced a slow LLM response and failed stock research executions (×9).",
  ],
  shot: { src: "/judges/neatlogs.webp", alt: "neatlogs Traces list: 296 traces with Slow LLM Response and Execution Failed detections", caption: "neatlogs traces, Sep 29 – Oct 12" } satisfies Shot,
  commits: [
    "712fad5ec21f28261ee9c59a4dbe60d8f5d63261",
    "d542c4f38f8dff300d20b045985f23a256d0acd5",
    "f9c5d3a142f333d9548022408b0b6967e88e9065",
  ],
  files: [
    "lib/observability/neatlogs.ts",
    "lib/observability/inngestMiddleware.ts",
    "lib/observability/mask.ts",
    "lib/observability/llmUsage.ts",
    "clients/neatlogsClient.ts",
  ],
};

export const ENTIRE = {
  title: "Entire recorded how every commit was made.",
  lede: "Each commit's Entire page links the prompt and Claude Code session that produced it. The links below are the GitHub commit URLs with github.com swapped for entire.io/gh.",
  shots: [
    { src: "/judges/entire-1.webp", alt: "Entire commit page for d542c4f with a Claude Code checkpoint", caption: "d542c4f · Trace stock research in Neatlogs" },
    { src: "/judges/entire-2.webp", alt: "Entire commit page for 99293e0 with a Claude Code checkpoint", caption: "99293e0 · Async jobs with signed webhooks" },
  ] satisfies Shot[],
};

export const CFO = {
  title: "cfo.ai priced every pipeline.",
  lede: "Ari built a seven-page financial model from the code stages: what one clean run of each pipeline costs, how demand grows, and what to charge.",
  note: "Figures are cfo.ai estimates from code stages at nominal provider prices, not invoices.",
  unitCosts: [
    { pipeline: "News briefing", usd: 0.2 },
    { pipeline: "API research job", usd: 0.14 },
    { pipeline: "Conversation session", usd: 0.11 },
    { pipeline: "Stock report", usd: 0.08 },
    { pipeline: "News research", usd: 0.04 },
  ],
  assumptions: [
    { label: "Subscription", value: "₹199 / month" },
    { label: "API price", value: "₹20 / job" },
    { label: "Paid conversion", value: "8%" },
    { label: "MAU growth", value: "3% / month" },
    { label: "Target margin", value: "70%" },
  ],
  shots: [
    { src: "/judges/cfo-1.webp", alt: "cfo.ai unit economics page with per-pipeline cost calculations", caption: "Unit economics", label: "estimated" },
    { src: "/judges/cfo-2.webp", alt: "cfo.ai operating forecast with monthly runs per pipeline", caption: "Operating forecast", label: "forecast" },
    { src: "/judges/cfo-3.webp", alt: "Ari's step log beside the cfo.ai assumptions page", caption: "Ari builds the model (36m 27s)", label: "assumed" },
  ] satisfies Shot[],
};

export const DEMO = {
  title: "The demo video.",
  lede: "A walkthrough of the agent and how neatlogs, Entire and cfo.ai were used.",
};

export const VERIFY = {
  title: "Verify it from your own terminal.",
  commands: [
    "git clone https://github.com/learner-enthusiast/dainikSamachar && cd dainikSamachar",
    "git log --format='%h %ad %(trailers:key=Entire-Checkpoint,valueonly) %s' --date=short",
    "pnpm install && pnpm test:api:unit && pnpm test:usage",
    "pnpm trace:stock-research && pnpm trace:print   # needs .env keys",
  ],
};
