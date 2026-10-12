# Dainik Samachar

Dainik Samachar is a research desk for **news, markets, and Indian instruments**. A reader configures a briefing and receives a ranked, source-backed set of stories; asks follow-up questions in a research chat that remembers what it already read; turns that chat into a story they own; and, on Pro, commissions long-form reports on NSE equities, ETFs, and mutual funds. The same research can leave the browser as a scheduled email digest, or as a **hosted agent**: a versioned HTTPS contract that invokes the identical pipelines without a session cookie.

Every synthesized output is written from scraped article text, YouTube transcripts, exchange market data, or previously stored research — never from search snippets or conversation history alone.

It is a Next.js 16 application with PostgreSQL + pgvector, Prisma 7, Clerk authentication, Inngest durable workflows, SerpAPI, Firecrawl, Upstox market data, Resend email, Razorpay billing, and OpenAI-backed agents.

This document is the primary technical and product documentation for the repository. It describes the system **as implemented**; partially wired parts are labeled as such. `/about` is the same architecture told as a product page. Interactive reference for the hosted agents lives at `/docs/api`.

---

## Table of Contents

- [Overview](#overview)
- [The Problem](#the-problem)
- [Product Mental Model](#product-mental-model)
- [Core Features](#core-features)
- [Hosted Agents](#hosted-agents)
- [System Architecture](#system-architecture)
- [How Dainik Samachar Works](#how-dainik-samachar-works)
- [News Pipeline](#news-pipeline)
- [News Rerun Pipeline](#news-rerun-pipeline)
- [Billing and Pro Subscription](#billing-and-pro-subscription)
- [Chat Pipeline](#chat-pipeline)
- [Story Deep Dive Pipeline](#story-deep-dive-pipeline)
- [Chat → Story Pipeline](#chat--story-pipeline)
- [Story Architecture](#story-architecture)
- [User-Created Stories](#user-created-stories)
- [Research Architecture](#research-architecture)
- [Canonical Data vs Retrieval Indexes](#canonical-data-vs-retrieval-indexes)
- [Evidence Model](#evidence-model)
- [Vector Search](#vector-search)
- [Conversation Memory](#conversation-memory)
- [AI Agent Architecture](#ai-agent-architecture)
- [External Research Services](#external-research-services)
- [Background Processing](#background-processing)
- [Database Architecture](#database-architecture)
- [Frontend and Backend Interaction](#frontend-and-backend-interaction)
- [Loading and Progress States](#loading-and-progress-states)
- [Notifications](#notifications)
- [Deduplication](#deduplication)
- [Caching](#caching)
- [Location and Search Autocomplete](#location-and-search-autocomplete)
- [Authentication and Authorization](#authentication-and-authorization)
- [Reliability and Failure Handling](#reliability-and-failure-handling)
- [Research Efficiency](#research-efficiency)
- [AI vs Application Logic](#ai-vs-application-logic)
- [Complete Data Lifecycle](#complete-data-lifecycle)
- [Pipeline Comparison](#pipeline-comparison)
- [Feature → Pipeline Map](#feature--pipeline-map)
- [Engineering Decisions](#engineering-decisions)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [Development](#development)
- [API Architecture](#api-architecture)
- [Deployment](#deployment)
- [Security](#security)
- [Limitations](#limitations)
- [Future Work](#future-work)
- [Contributing](#contributing)

---

## Overview

Dainik Samachar has several user-facing research modes that share one storage layer. The browser uses Clerk sessions. External programs use hosted agents (the `/api/v1` contract) with the same pipelines underneath.

| Mode | What the user does | What the system produces |
|------|--------------------|--------------------------|
| **Briefing** | Configures a news request (date, `local`/`world`/`both` scope, location, categories, story count, language, source domains, custom query) | Up to `storyCount` ranked `NewsStory` rows, each with `NewsSource` evidence rows |
| **Research chat** | Asks a question in a chat session, or opens a **deep dive** on a public story | An assistant Markdown reply grounded in scraped `ResearchSource` rows; the session accumulates reusable research |
| **Chat → story** | Asks the chat to write a story | A private draft `NewsStory` owned by the user, generated asynchronously from the research the chat already gathered |
| **Instrument research** | Picks an NSE equity, ETF, or mutual fund and a question (`/stockResearch`, `/etfResearch`, `/MfResearch`) | A Markdown `StockResearch` report with quote, fundamentals or holdings, news, and a cited answer |
| **Newsletter** | Schedules a digest (`/newsletters`) on a daily, weekday, weekly, or monthly cadence | An email, via Resend, of a shared `NewsEdition` built by the news pipeline |
| **Hosted agents** | Calls `/api/v1` with a Pro API key | The same briefings, reports, stories, instrument search, and newsletters, plus jobs and signed webhooks |

What distinguishes the implementation:

- **Evidence before synthesis.** Every synthesizer and the chat model receive scraped/cleaned text, not search snippets.
- **Persistent research.** Chat research is stored per session as `ResearchSource` rows and indexed in pgvector so later turns can reuse it instead of searching again.
- **Decision agents, not one prompt.** A guardrail classifier, a query enhancer, and a *determiner* decide whether to search, what to search, whether to scrape user-provided URLs, whether to pull YouTube evidence, and whether the user wants a story.
- **Durable background work.** Research takes minutes; every pipeline is an Inngest function with step checkpoints, idempotency keys, timeouts, and failure notifications.
- **Scoped domain.** Guardrails restrict chat research to financial, economic, company, market, trade, and commodity topics.
- **Pro access (optional).** Razorpay one-time checkout grants time-boxed Pro (`User.plan` + `Subscription.currentPeriodEnd`) with a **5-day grace** after period end. Instrument research pages and hosted-agent keys require an active Pro plan.
- **Incremental briefing refresh.** A fulfilled briefing can be **rerun** to discover new sources since the last completion, update existing stories, or add net-new stories without creating a second `NewsRequest`.
- **Scheduled distribution.** Newsletters reuse one briefing per parameter fingerprint and period, then email that edition instead of regenerating the same research for every subscriber.
- **Hosted invocation.** The public API is the same research, addressed by a bearer key, scopes, quotas, and asynchronous jobs rather than by a browser session.

---

## The Problem

The implementation addresses these concrete problems:

1. **Search returns fragments, not stories.** A single Google News query yields snippets and duplicate coverage. Building a briefing means planning multiple queries across engines, selecting which pages are worth reading, scraping them, removing page noise, and clustering the result into distinct stories. The news pipeline does exactly this.
2. **Research context evaporates.** Ordinary chat forgets which articles it already read. Dainik Samachar persists every scraped page as a `ResearchSource` on the session and embeds a description of it, so a follow-up question can retrieve prior evidence before spending another external call.
3. **Redundant, expensive external calls.** SerpAPI, Firecrawl, and OpenAI calls cost money and time. The determiner only searches when the existing record is insufficient; the story pipeline reuses evidence already collected by the chat; autocomplete is cached in Postgres.
4. **Turning research into a durable artifact.** A chat answer is transient. Users need a story they own, can edit, and can publish for others to read and deep-dive. The chat → story pipeline provides this.
5. **Long-running work does not fit in an HTTP request.** Briefings run for minutes with many external calls. Inngest runs them as durable jobs while the UI polls status.
6. **Noisy, off-topic, or unsafe requests.** The chat is a finance/economics research tool; guardrails block off-topic and policy-violating prompts before any external cost is incurred.

---

## Product Mental Model

```text
USER
  │
  ├── Configure a briefing            (/news)
  ├── Read and vote on stories        (/newsStory, /newsStory/[id])
  ├── Bookmark community stories      (/newsStory/bookmarks)
  ├── Ask a research question         (/chat, /chat/[id])
  ├── Deep-dive a public story        (story page → chat)
  ├── Ask the chat to write a story   (draft → edit → publish)
  ├── Upgrade to Pro                  (/pricing → Razorpay Checkout)
  ├── Instrument research             (/stockResearch, /etfResearch, /MfResearch)
  ├── Schedule a digest               (/newsletters)
  └── Invoke a hosted agent           (/settings/developers → /api/v1, docs at /docs/api)
           │
           ▼
   RESEARCH ENGINE (Inngest functions)
           │
           ├── Guardrails · query enhancement · determiner   (chat paths)
           ├── Search planning                               (news path)
           ├── SerpAPI: Google News, Google (news tab), Google, Finance, AI Mode, YouTube
           ├── AI Overview follow-up searches
           ├── Article selection
           ├── Firecrawl scraping
           ├── Content cleaning
           ├── YouTube transcript analysis
           ├── Deduplication
           └── Synthesis (news synthesizer / chat model)
           │
           ▼
   KNOWLEDGE LAYER (PostgreSQL + pgvector)
           │
           ├── NewsRequest, NewsStory, NewsSource       — briefing and story record
           ├── ChatSession, ChatMessage                 — conversation record
           ├── ResearchSource + ChatResourceEmbedding   — reusable chat research and its index
           ├── ChatMessageEmbedding                     — message memory index (indexed, not yet consumed)
           ├── NewsStoryVote, users.saved_stories       — engagement
           ├── Notification                             — job completion/failure
           └── SearchAutocompleteCache                  — provider response cache
```

- The **research engine** does the expensive, slow, non-deterministic work. It runs only in Inngest functions.
- The **knowledge layer** is canonical data plus two retrieval indexes. Outputs (stories, answers) are stored separately from the evidence they were written from.
- The **frontend** never waits on research synchronously; it creates records, enqueues events, and polls.

---

## Core Features

### News briefing generation

**Purpose** — Produce a multi-story digest of market/economic news for a date, place, and set of topics.

**User flow** — On `/news` the user picks a date, scope (`local`, `world`, `both`), a location (with autocomplete and optional browser geolocation), categories, story count (1–12, default 5), language, optional source domains, and an optional custom query. Submitting navigates to `/news/[newsId]`, which polls until the request is `success` or `failed`.

**System flow** — `POST /api/news` validates the body, creates a `NewsRequest` (`status: pending`), and sends `news/pipeline.requested`. The [News Pipeline](#news-pipeline) plans queries, searches, selects, scrapes, cleans, analyzes YouTube, synthesizes, and persists stories.

**Output** — `NewsStory` rows (with `NewsSource` children) linked to the request; a completion notification; progress lines in `NewsRequest.loadingLogs`.

### Community story feed, trending, and votes

**Purpose** — Let readers browse publicly visible stories and signal quality.

**User flow** — `/newsStory` lists public stories (paginated). The landing page shows **trending** stories. Signed-in users upvote/downvote from story cards and pages.

**System flow** — `GET /api/news/stories` and `GET /api/news/trending` read stories matching `publicNewsStoryWhere` (system stories whose request succeeded, or user stories that are `published`). Trending = public stories from the last 7 days ordered by upvotes, then recency, limit 4. Votes toggle/flip via `NewsStoryVote` with denormalized `upvotes`/`downvotes` counters.

**Output** — Story cards with vote counts, the viewer's vote, and saved flag.

### Bookmarks and "My stories"

**Purpose** — Separate *stories the user saved* from *stories the user created*.

- **Bookmarks** (`/newsStory/bookmarks`, `POST/DELETE /api/news/stories/[storyId]/save`, `GET /api/news/stories/bookmarks`) store story IDs in `users.saved_stories`.
- **My stories** (`/newsStory/saved`, `GET /api/news/stories/saved`) lists `NewsStory` rows where `isUserCreated = true` and `ownerId` is the viewer, including drafts.

### Research chat

**Purpose** — Answer a specific finance/economics question with fresh or reused evidence.

**User flow** — `/chat` creates a session (`POST /api/chat`) with the first message; `/chat/[chatSessionId]` sends follow-ups (`POST /api/chat/[chatSessionId]`). Sessions can be renamed, bookmarked, and deleted; new general chats are auto-titled from the first message. A stories launcher in the composer shows stories created from this session.

**System flow** — Each user message enqueues `chat/message.research.requested`, handled by the [Chat Pipeline](#chat-pipeline).

**Output** — An `agent` `ChatMessage` in Markdown; new `ResearchSource` rows on the session; a completion notification.

### Story deep dive

**Purpose** — Research a specific published story in depth, starting from its stored sources.

**User flow** — From a story page the user clicks Deep Dive (optionally with a research request). A new story-anchored chat session opens.

**System flow** — `POST /api/newsStoryChat` creates a `ChatSession` with `isFromNewsStory = true`, `newsStoryId`, and the story's `NewsSource` IDs, then sends `chat/pipeline.requested`. The first turn runs the [Story Deep Dive Pipeline](#story-deep-dive-pipeline); later turns run the regular Chat Pipeline.

**Output** — A long-form assistant reply; `ResearchSource` rows seeded from the story's context.

### Chat → story (user-created stories)

**Purpose** — Turn a research conversation into a persistent, editable, publishable story.

**User flow** — In a *general* chat, the user asks for a story (e.g. "write a news story about…"). The chat replies that it is writing the story; the chat and story page show a generating state until the story is ready. The owner can edit fields, upload a cover photo, publish, or move back to draft.

**System flow** — The determiner sets `shouldCreateStory`; the chat pipeline creates a draft `NewsStory` shell and emits `chat/story.research.requested` with all research it already gathered. See [Chat → Story Pipeline](#chat--story-pipeline).

**Output** — A draft `NewsStory` (`isUserCreated = true`, `publishStatus = draft`) with `NewsSource` rows; owner-only APIs to `PATCH`, upload a cover photo, publish, and unpublish.

### Story cover photo (user-created stories)

**Purpose** — Let the owner replace the synthesizer-chosen (or missing) `imageUrl` with a photo they upload.

**User flow** — On a story the owner can edit, the owner edit sheet accepts a JPEG/PNG/WebP/GIF/AVIF file up to 5 MB. The page shows a local preview, then replaces it with the stored URL.

**System flow** — `POST /api/news/stories/[storyId]/photo` authenticates, validates MIME type and size, then `uploadOwnedUserStoryPhoto` uploads via `photoUploadClient` (Cloudinary first, S3 if Cloudinary is not configured) and writes `imageUrl` on the owned user story. Public ID is `story-<storyId>`; folder is `NEWS_STORY_PHOTO_FOLDER` or `newsly/stories`.

**Output** — Updated `imageUrl` plus the full story page payload. Owners can still set `imageUrl` as a URL through `PATCH`.

### Location autocomplete and reverse geocoding

**Purpose** — Make the location field fast and cheap to fill.

**System flow** — Typed input is normalized (trim, lowercase, collapse spaces; ignore fewer than 2 characters), served from a 5-minute client cache when possible, otherwise debounced **5 seconds**, then looked up server-side (process memory → Postgres exact/prefix → SerpAPI Google Maps Autocomplete). Browser geolocation can be reverse-resolved to a metro label via `POST /api/location/reverse`. See [Location and Search Autocomplete](#location-and-search-autocomplete).

### Notifications

**Purpose** — Tell the user when background research finished or failed.

**System flow** — Pipelines write idempotent `Notification` rows (news completed/failed, chat research completed/failed, deep dive completed/failed, chat story completed/failed). The header bell polls `GET /api/notifications` every 10 seconds. See [Notifications](#notifications).

### Authentication

Clerk handles sign-in/sign-up. Each authenticated request upserts a local `User` row keyed by `clerkId`. See [Authentication and Authorization](#authentication-and-authorization).

### News briefing rerun (incremental refresh)

**Purpose** — After a briefing succeeds, refresh it with **new** web/YouTube evidence since the last completion without re-running the full initial pipeline from scratch.

**User flow** — From `/news/[newsId]` the user starts a rerun when the request is `success` and not already rerunning. The wait panel switches to rerun copy; polling continues while `isRerunning` is true.

**System flow** — `POST /api/news/[newsId]/rerun` sets `NewsRequest.isRerunning = true`, resets rerun-specific `loadingLogs`, and emits `news/pipeline.rerun.requested`. The [News Rerun Pipeline](#news-rerun-pipeline) dedupes known URLs/videos, researches only new hits, runs `StoryMatcherAgent` / `StoryUpdateDecisionAgent`, and may update stories or add new ones. On completion or “no new evidence”, `isRerunning` clears and an idempotent notification is written. Request `status` stays `success`; failures do not flip the briefing to `failed`.

**Config fidelity** — Rerun rebuilds `NewsGenerationConfig` from the stored row: briefing **`date`** (not “today”), `location`, optional **`latitude` / `longitude`** columns (preferred over JSON in `searchQuery`), categories, custom query, story count, language, and source domains.

### Pro subscription and pricing

**Purpose** — Sell **Dainik Samachar Pro** as a one-time Razorpay Order (Standard Checkout), not recurring Razorpay Subscriptions API yet.

**User flow** — `/pricing` shows the catalog (`GET /api/billing/catalog`). Signed-in users click **Upgrade to Pro** → `POST /api/payments/razorpay/create-order` → Razorpay modal → `POST /api/payments/razorpay/verify` on success. The UI uses `useIsProSubscriber` (reads `/api/me`, applies grace logic client-side via `userPlanAccess.ts`).

**System flow** — Server creates a `Payment` row, Razorpay order (receipt ≤ 40 chars), verifies signature, fetches payment from Razorpay, sets `User.plan = PRO`, upserts `Subscription` with `currentPeriodEnd = now + accessDays` (30 for `PRO_MONTHLY`). `reconcileExpiredProSubscription()` runs on authenticated requests: after period end + **5 grace days**, downgrades to `FREE` and marks subscription `EXPIRED`. Optional `POST /api/payments/razorpay/webhook` for provider events.

**Gating** — `requireProSubscriber()` on `/stockResearch`, `/MfResearch`, `/etfResearch`. Nav/sidebar links marked `proOnly` use `ProGatedNavLink` / `ProGatedSidebarLink`. **Client code must import `@/services/billing/userPlanAccess` only** (no Prisma); server reconciliation lives in `userPlan.ts`.

See [Billing and Pro Subscription](#billing-and-pro-subscription).

### Instrument research (equities, ETFs, mutual funds)

**Purpose** — Answer a specific question about one Indian instrument with exchange data and scraped pages, then write a structured report.

**User flow** — Pro subscribers open `/stockResearch` (NSE equities), `/etfResearch` (NSE and BSE ETFs), or `/MfResearch` (mutual funds). They search an instrument, optionally pick a sample question, and submit. History pages list prior runs. A report page polls until the row is `COMPLETED` or `FAILED`.

**System flow** — `POST /api/stockResearch` creates a `StockResearch` row (`assetType` `STOCK`, `ETF`, or `MUTUAL_FUND`) and emits `stock/research.requested`. The Inngest function enhances the prompt, lets a tool determiner choose Upstox and search calls, persists raw payloads as `StockResearchResource` rows, selects and scrapes links, then synthesizes `reportMarkdown`. Mutual-fund runs follow the fund tool plan in `Agents/stockResearch/assetProfiles.ts` rather than the equity option-chain path.

**Output** — A Markdown report whose sections follow the asset profile: for a stock, summary, price snapshot, fundamentals, ownership, recent news, and bull/bear risks; for an ETF, costs, tracking, liquidity, and holdings; for a fund, category, returns, portfolio, and costs.

**Coverage** — NSE-listed equities (not BSE-only or foreign listings). ETFs on NSE and BSE, including Indian ETFs that track global indices. Listed mutual-fund units the instrument index can resolve. Instrument rows come from the Upstox beginning-of-day file (`pnpm instruments:sync`).

### Newsletters

**Purpose** — Deliver a recurring briefing to the account email without the reader opening the app.

**User flow** — `/newsletters` lists digests. `/newsletters/new` sets name, scope, location, categories, story count, language, source domains, custom query, and a schedule: daily, weekdays, weekly (day of week), or monthly (day of month), plus a local send time and timezone. The owner can pause, resume, send a test, or delete. `/unsubscribe` honors a signed link.

**System flow** — A scheduler claims due rows and enqueues a run. Runs that share a parameter fingerprint and period share one `NewsEdition`, which is a `NewsRequest` built by the news pipeline. `NewsletterDelivery` records pending, sent, and failed attempts and stores the Resend message id. The per-user cap is enforced in `newsletterService` (`NewsletterLimitError`).

**Output** — An email whose stories are the edition’s `NewsStory` rows. Deliveries are visible on the newsletter page.

### Usage

**Purpose** — Show what a Pro account has spent on external providers and on hosted-agent pipelines.

**User flow** — Settings → Developers (`/settings/developers`) shows API keys and a usage card for the current IST month: SerpAPI and Firecrawl credits, attributed by feature (briefings, chat, instrument research, and so on). `GET /api/v1/me` reports today’s pipeline jobs against the daily quota. `/admin/usage` is the operator view.

**System flow** — Provider responses are scored by `lib/usage/creditRules.ts` (Serp search and archive calls; Firecrawl `metadata.creditsUsed` when present). A reconcile job keeps the ledger aligned. Hosted-agent quotas are separate: they count accepted briefing and research jobs per UTC day, not provider credits.

### Upstox market data (optional, server-only)

Read-only **Analytics Token** integration used by instrument research (no user OAuth, no trading):

- `clients/upstoxClient.ts` — HTTP client (`Authorization: Bearer UPSTOX_ANALYTICS_TOKEN`)
- `services/upstox/*` — quotes, historical candles (V3), fundamentals, FII/DII, OI, max pain, PCR, option chain
- `Instrument` rows — beginning-of-day universe for suggest and hosted-agent instrument search

Set `UPSTOX_ANALYTICS_TOKEN` in `.env.local`. Verify with `pnpm upstox:test`. Tests: `pnpm test:upstox`.

### UI suggestion helpers

`GET /api/chat/quickactions/[chatSessionId]` and `GET /api/chat/trythesequestion/[chatSessionId]` run small agents (`QuickActionAgent`, `TryTheseQuestionAgent`) that propose follow-up actions/questions for the chat UI. They read session context and do not browse the web.

### Not yet wired

- **`Script` model** exists in Prisma (podcast/script artifact with `researchSourceIds`) but has no API route, service, or UI.
- **`ChatMessageEmbedding`** rows are produced by a background indexer, but no live pipeline queries them yet.
- **`relevanceAgent`** and **`chatstorySimilarityQueryagent`** exist under `Agents/chat` but are not imported by any pipeline.

---

## Hosted Agents

A hosted agent is a remotely addressable research faculty. The caller does not import an agent, open a model session, or hold a browser cookie. It presents a cryptographic bearer attestation (`Authorization: Bearer ds_live_…`), names an operation on `/api/v1`, and receives either a synchronous reading of canonical state or an asynchronous job whose terminality is observed by polling or by a signed webhook. Under that contract the same Inngest functions, evidence rows, and synthesizers run as they do for a signed-in reader. The complication is in the invocation envelope — authentication, scope, idempotency, quota, deduplication, and completion — not in a second research stack.

Interactive reference, generated from the OpenAPI document the server actually enforces, is at `/docs/api`. Machine-readable contract: `GET /api/v1/openapi.json`. Keys are minted at `/settings/developers` and are usable only while the owning account is on an active Pro plan. A lapsed plan answers `403 plan_required`; the key row is retained.

### Invocation envelope

| Concern | Mechanism |
|---------|-----------|
| Identity | Bearer key. Only a SHA-256 digest is stored. A lost secret cannot be reconstructed; it is revoked and replaced. Expiry may be 30 days, 90 days, 365 days, or none. |
| Authorization lattice | Scopes chosen at creation: `news:read`, `news:write`, `research:read`, `research:write`, `instruments:read`, `newsletters:read`, `newsletters:write`. A missing scope answers `403 forbidden` with `details.requiredScope`. `GET /me` accepts any live key. |
| Throughput | Per-key rolling minute (`API_PRO_REQUESTS_PER_MINUTE`, default 60) and a per-account UTC-day ceiling on accepted pipeline jobs (`API_PRO_PIPELINE_JOBS_PER_DAY`, default 50). Active keys per account default to 10. |
| Idempotent dispatch | `Idempotency-Key` on pipeline posts. Reuse with a different body or path answers `idempotency_key_reused`. A key whose first request is still in flight answers `conflict`. |
| Synchronous reads | Stories, briefings, reports, jobs, instrument search, newsletters, and `/me` return JSON in one round trip and do not consume the daily pipeline quota. |
| Asynchronous actuation | `POST /news/briefings` and `POST /research/reports` enqueue work and answer **202** with a job. Completion is minutes, not milliseconds. |
| Terminal notification | Optional `webhookUrl` on those posts. Delivery is an Inngest function (`api-v1-job-webhook`) with a signature derived from the account webhook secret (`/api/developers/webhook-secret`). |
| Coalescence | A briefing whose date, scope, and location already exist for the account returns the existing briefing (**200**) instead of opening a second pipeline. That hit does not consume quota. |
| Provenance | Lists and reads return only the caller’s briefings, reports, newsletters, and jobs. Public stories are readable with `news:read` and are not owned by the caller. Instrument search is global reference data. |

Request bodies must be JSON, at most 64 KB. Errors use a stable `code` (`invalid_request`, `unauthorized`, `plan_required`, `forbidden`, `not_found`, `conflict`, `rate_limited`, `quota_exceeded`, `limit_reached`, and others). `Retry-After` accompanies rate and quota failures. `X-Request-Id` may be supplied for support; the server echoes one on internal errors.

### Agent catalogue

Each row is one hosted agent: a narrow contract over a pipeline that already exists in the application.

| Hosted agent | Contract | What it deliberates over | Disposition |
|--------------|----------|--------------------------|-------------|
| **Account oracle** | `GET /me` | Plan, key metadata, limits, pipeline jobs consumed today | Synchronous |
| **Corpus reader** | `GET /stories`, `GET /stories/{id}` | Public stories, newest `publishedAt` first. Scope `news:read` | Synchronous |
| **Briefing archivist** | `GET /news/briefings`, `GET /news/briefings/{id}` | The caller’s briefings; `stories` populated after success. Scope `news:read` | Synchronous |
| **Briefing compositor** | `POST /news/briefings` | Scope, location, categories, story count, language, domains, custom query. Scope `news:write`. Emits the news pipeline | Asynchronous job |
| **Instrument lexicographer** | `GET /instruments/search?q=` | Stocks, ETFs, and mutual funds in the local instrument index. Returns `instrumentKey` for the report agent. Scope `instruments:read` | Synchronous |
| **Report archivist** | `GET /research/reports`, `GET /research/reports/{id}` | The caller’s equity, ETF, and fund reports; `reportMarkdown` when complete. Scope `research:read` | Synchronous |
| **Report compositor** | `POST /research/reports` | An `instrumentKey` plus a question. Scope `research:write`. Emits `stock/research.requested` | Asynchronous job |
| **Job observer** | `GET /jobs/{id}` | Live status and, on success, `resource.url`. Briefing jobs need `news:read`; research jobs need `research:read` | Synchronous |
| **Digest steward** | `GET`/`POST /newsletters`, `GET`/`PATCH`/`DELETE /newsletters/{id}`, `POST …/pause`, `POST …/resume` | Scheduled digests delivered to the account email. Read and write scopes are separate. Creation counts against the per-user newsletter cap | Synchronous |

### A briefing, end to end

```bash
export DS_API_KEY="ds_live_..."

curl -X POST "$APP_URL/api/v1/news/briefings" \
  -H "Authorization: Bearer $DS_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"scope":"world","storyCount":5,"categories":["markets"]}'
# 202 { "id": "<job id>", "status": "pending", ... }

curl "$APP_URL/api/v1/jobs/<job id>" -H "Authorization: Bearer $DS_API_KEY"
# status succeeded → resource.url is the briefing
```

Poll the job every several seconds until `status` is `succeeded` or `failed`, then `GET` `resource.url` with the same bearer token and read `stories`. A `webhookUrl` on the original post replaces the poll: the platform posts a signed body when the job reaches a terminal state.

### What a hosted agent is not

It is not a general chat completion endpoint, not a tool the caller hosts, and not a separate model deployment. Guardrails, search planning, scraping, and synthesis stay on this server. The caller supplies parameters and receives artifacts — stories, Markdown reports, newsletter rows, job records — whose evidence was gathered by the pipelines documented below.

---

## System Architecture

```mermaid
flowchart TD
  U[Reader - browser] --> FE[Next.js App Router pages and client components]
  FE --> API[Route handlers app/api/*]
  API --> AUTH[Clerk middleware and requireAuthenticatedUser]
  API --> SVC[services/* and repositories/*]
  SVC --> PG[(PostgreSQL + pgvector via Prisma)]
  SVC -->|inngest.send| ING[Inngest]

  ING --> NP[newsPipelineFunction]
  ING --> NRR[newsRerunPipelineFunction]
  ING --> DD[chatPipelineFunction - deep dive first turn]
  ING --> MC[messageChatPipelineFunction]
  ING --> CS[chatStoryPipelineFunction]
  ING --> PST[chatPotentialStoryTopicsFunction]
  ING --> RSI[researchSourceDescriptionFunction]
  ING --> CME[chatMessageEmbeddingFunction]

  NP --> AG[Agents - OpenAI]
  DD --> AG
  MC --> AG
  CS --> AG
  RSI --> AG
  CME --> AG

  NP --> SERP[SerpAPI]
  DD --> SERP
  MC --> SERP
  CS --> SERP
  NP --> FC[Firecrawl]
  DD --> FC
  MC --> FC
  CS --> FC
  NP --> YT[YouTube search and transcripts via SerpAPI]
  MC --> YT

  NP --> PG
  DD --> PG
  MC --> PG
  CS --> PG
  RSI --> PG
  CME --> PG

  FE -->|polling| API
```

### Frontend

Next.js 16 App Router under `app/`. Server components render pages; client components handle forms, polling, chat UI, and motion. Public marketing pages (`/about`, `/blog`, `/privacy`, `/terms`, `/contact`) are static. There is no streaming from pipelines to the browser; the UI polls REST endpoints.

### API / application layer

Route handlers in `app/api/**/route.ts` validate input with Zod, authenticate with `requireAuthenticatedUser()`, call a service in `services/`, and return JSON. Services orchestrate repositories (`repositories/*`, thin Prisma wrappers) and enqueue Inngest events. No route performs research inline.

### Research layer

Search helpers (`SERP/index.ts`, `services/chat/chatSerpResearch.ts`, `services/chat/chatSerpWithAiOverview.ts`, `services/news/normalizeArticles.ts`), scraping (`services/firecrawl/scrapeUrls.ts`), YouTube (`services/news/youtubeResearch.ts`, `services/chat/chatYoutubeEvidence.ts`), deduplication (`services/chat/dedupeResearchArticles.ts`), and prompt/context assembly (`services/chat/researchContextForChatModel.ts`).

### AI / agent layer

`Agents/news/*`, `Agents/chat/*`, and `Agents/stockResearch/*` wrap `clients/AIClient.ts`. Each agent has a Zod output schema and a resolvable model (`lib/openAiModel.ts`: call override → agent env var → `OPENAI_MODEL` → `gpt-4o-mini`). See [AI Agent Architecture](#ai-agent-architecture).

### Background processing

Inngest functions registered in `inngest/index.ts` and served at `app/api/inngest/route.ts`: news, rerun, four newsletter jobs, two chat paths, chat-story, stock research, two embedding indexers, potential story topics, provider-usage reconcile, hosted-agent webhook delivery, and hosted-agent maintenance. See [Background Processing](#background-processing).

### Persistence

PostgreSQL via Prisma 7 with the `pg` driver adapter (`db/client.ts`). Schema in `db/schema/schema.prisma`; migrations in `db/schema/migrations`. See [Database Architecture](#database-architecture).

### Vector retrieval

pgvector `vector(1536)` columns on `chat_resource_embeddings` and `chat_message_embeddings`, queried with raw SQL cosine distance. See [Vector Search](#vector-search).

### External services

SerpAPI, Firecrawl, OpenAI, Upstox, Resend, Razorpay, Clerk, Inngest. See [External Research Services](#external-research-services).

---

## How Dainik Samachar Works

News, chat, and chat-story still share services but do different jobs. Newsletters reuse the news path. Instrument research is its own pipeline. Hosted agents dispatch into whichever of those pipelines the contract names:

| Path | Trigger | Scope | Output |
|------|---------|-------|--------|
| **News pipeline** | A configured `NewsRequest` | Broad: multi-engine, multi-tier, many candidates | Many stories |
| **Chat pipeline** | One user message | Narrow: only what the determiner asks for; reuses session research | One answer (or a story handoff) |
| **Chat story pipeline** | Handoff from the chat pipeline | Narrowest: fill gaps in evidence already collected | One story |

A fourth handler, the **deep-dive pipeline**, is the chat pipeline's specialized first turn for story-anchored sessions.

Why separate: a briefing needs breadth and clustering; a question needs speed and context; a story needs one coherent, primary-sourced document. Budgets, agents, and persistence targets differ accordingly. See [Pipeline Comparison](#pipeline-comparison).

---

## News Pipeline

**Event:** `news/pipeline.requested` · **Function:** `newsPipelineFunction` (`inngest/newsPipeline.ts`) · **Timeout:** 45 minutes.

```mermaid
flowchart TD
  REQ[POST /api/news creates NewsRequest pending] --> EV[news/pipeline.requested]
  EV --> LOAD[load-news-request]
  LOAD --> PLAN[plan-search-queries - buildNewsSearchExecutionPlans]
  PLAN --> SAVEQ[save-search-queries -> NewsRequest.searchQuery]
  SAVEQ --> SERP[fetch-and-normalize-serp]
  SERP --> GN[Google News]
  SERP --> GS[Google search - news tab]
  SERP --> YTS[YouTube search]
  GS --> AIO{ai_overview present?}
  AIO -->|yes| GAI[GAIOverviewSearchGeneratorAgent -> extra Google news-tab searches]
  AIO -->|no| NORM
  GAI --> NORM[normalize, date-window filter, drop trading tips, weight follow-up URLs 1.4x]
  GN --> NORM
  NORM --> SEL[select-articles - ResearchArticleSelectorAgent]
  SEL --> SCR[scrape-selected-articles - Firecrawl]
  SCR --> CLEAN[NewsContentCleanerAgent per page]
  YTS --> YSEL[select-youtube-videos - YoutubeVideoAgent]
  YSEL --> YTR[fetch-youtube-transcripts]
  YTR --> YAN[analyze-youtube-transcripts - YoutubeTranscriptAgent]
  YAN --> YSYN[synthesize-youtube-transcript-facts]
  CLEAN --> SYN[synthesize-stories - NewsSynthesizerAgent]
  YSYN --> SYN
  SYN --> PERSIST[persist-stories-and-sources - NewsStory + NewsSource]
  PERSIST --> OK[mark-request-success]
  OK --> NOTIF[create-completion-notification]
  NOTIF --> RELOAD[load-stories]
```

### Trigger

`POST /api/news` (`services/news/apiService.ts`) validates the body with `newsGenerationRequestSchema`, normalizes it (categories ≤ 10, sources ≤ 10 as bare hostnames, language → Serp `hl`), creates a `NewsRequest` with `status: pending`, and sends the event with `{ userId, newsRequestId, date, scope, location, categories, customQuery, storyCount, language, sources, serpHl }`. Retrying a failed request (`POST /api/news/[newsId]`) resets status and re-sends the event.

### Search planning

**What it does** — `buildNewsSearchExecutionPlans(config)` produces one or two tiers (`local` and/or `world`). Each tier combines category keywords (`NEWS_CATEGORY_KEYWORDS`, e.g. `markets → stock market, equities, finance`), the custom query, and optional `site:` filters into Google News, Google search (news tab), and YouTube parameters. Local tiers add Serp `location`, `gl`, `hl`.

**Why it exists** — One query per category would multiply API calls and fragment results. A planned, combined query per engine per tier keeps costs bounded and results coherent.

**Produces** — `executionPlans` persisted on `NewsRequest.searchQuery`.

Budgets scale with `storyCount` (`services/news/newsSearchPlanning.ts`):

| Function | Formula |
|----------|---------|
| `serpResultsPerEngine(n)` | `min(30, max(15, n × 3))` |
| `articleCandidateBudget(n)` | `min(40, max(15, n × 5))` |
| `maxArticlesToScrape(n)` | `min(20, max(n + 2, n × 2))` |

### Search collection

Per tier, three Serp calls run in parallel:

- **Google News** (`engine: google_news`) — primary news discovery.
- **Google search, news tab** (`engine: google`, `tbm: nws`) — web news coverage; also the source of the `ai_overview` block.
- **YouTube search** (`engine: youtube`) — candidate videos (≤ 10 rows kept).

**AI Overview follow-up** — If the merged Google payload contains `ai_overview`, `runGaiOverviewSearchGeneratorAgent` reads it and proposes additional Google news-tab queries. Their hits are tagged as follow-up results and boosted (`selectionWeight` × 1.4, `AI_OVERVIEW_FOLLOW_UP_SELECTION_WEIGHT`) so the selector sees them as slightly more valuable. Purpose: recover angles the first query missed.

**Normalization and filters** (`services/news/normalizeArticles.ts`):

- Merge payloads across tiers and engines into `normalizedArticleLink` rows.
- **Date window** — keep articles whose published time matches the request date (previous-day-evening UTC tolerance).
- **Trading recommendations** — drop "buy/sell tip" style pages (`isTradingRecommendationArticle`).

**Produces** — `{ articles, youtubeSerpPayload }`.

### Candidate selection

**What it does** — `select-articles` prefers configured source domains, caps candidates with `articleCandidateBudget`, calls `ResearchArticleSelectorAgent` with a prompt built from the request (`buildArticleSelectionPrompt`), then caps scrapes with `maxArticlesToScrape`.

**Why it exists** — Scraping every hit would cost Firecrawl calls and add latency without improving story quality. Selection happens before scraping.

**Produces** — An ordered list of `{ url, domain, title, sourceType }` to scrape.

### Article extraction

**What it does** — `scrapeUrlsWithFirecrawl(urls)` calls Firecrawl per URL (`Promise.all`), returning Markdown or `null` on failure.

**Produces** — Raw Markdown per selected URL.

### Content cleaning

**What it does** — `NewsContentCleanerAgent` receives raw Markdown plus request date/location and returns `{ cleanedContent, isValidArticle }`. It strips navigation, ads, related-article modules, and boilerplate. It does not summarize or rewrite facts.

**Why it exists** — Firecrawl output contains page chrome that wastes synthesizer tokens and can mislead clustering. Invalid pages (paywalls, index pages) are dropped here.

**Produces** — Cleaned article bodies; invalid/empty/trading-tip pages removed.

### YouTube processing

Runs in parallel with the article branch after search:

1. `select-youtube-videos` — `YoutubeVideoAgent` picks relevant videos from the Serp rows.
2. `fetch-youtube-transcripts` — SerpAPI `youtube_video_transcript` per selected video.
3. `analyze-youtube-transcripts` — `YoutubeTranscriptAgent` extracts structured findings.
4. `synthesize-youtube-transcript-facts` — `YoutubeTranscriptSyntesizeAgent` merges findings into facts + overview.

YouTube rows enter the synthesizer as **supporting** evidence (`isPrimaryStorySource: false`). A story that would rest only on YouTube is rejected at persist time.

### Synthesis

**What it does** — `NewsSynthesizerAgent` receives cleaned articles and YouTube facts and returns up to `storyCount` stories, each with `title`, `slug`, `description`, `summary`, `content` (Markdown), `category`, `location` (inferred from content, not defaulted from the request), `importanceScore`, `publishedAt`, and linked `sources`.

**Model** — `NEWS_SYNTHESIZER_MODEL` or `gpt-5.4-mini`.

### Persistence

For each synthesized story with a primary article source: create `NewsStory` (`newsRequestId` set, `isUserCreated = false`, `publishStatus = published` by default), create one `NewsSource` per linked source (URL, domain, title, scraped content, `sourceType`, transcript when a YouTube source), resolve `imageUrl` from source metadata, then patch `newsSourceIds` on the story.

### Completion and notification

`mark-request-success` sets `status = success`, `completedAt`, clears `error`. `create-completion-notification` writes an idempotent `Notification` (`NEWS_PIPELINE_COMPLETED`, link `/news/[id]`). The UI stops polling when status leaves `pending`.

### Failure handling

- Any thrown error inside the run → `mark-request-failed` sets `status = failed`, stores the message, sets `completedAt`, then **rethrows** so Inngest retries the function.
- `onFailure` (after retries are exhausted) writes a `NEWS_PIPELINE_FAILED` notification deduped by request ID.
- Partial failures are tolerated: a failed Firecrawl URL becomes `null` and is skipped; YouTube steps can yield nothing; AI Overview follow-up is optional.
- The user can retry from `/news/[newsId]` (`POST /api/news/[newsId]`).

### Geo and search planning persistence

During `save-search-queries`, the pipeline persists planned Serp parameters on `NewsRequest.searchQuery` and patches **`latitude`**, **`longitude`**, and `locationGeo` JSON when the client supplied coordinates. Downstream planning and **rerun** prefer the columns over JSON so local Serp `ll` / `location` stay stable across refreshes.

---

## News Rerun Pipeline

**Event:** `news/pipeline.rerun.requested` · **Function:** `newsRerunPipelineFunction` (`inngest/reRunPipeline.ts`) · **Timeout:** 45 minutes · **Concurrency:** one run per `newsId`.

**Trigger** — `POST /api/news/[newsId]/rerun` after a successful briefing (`status = success`, `isRerunning = false`). Sets `isRerunning = true`, replaces progress logs with rerun copy, enqueues `{ newsId }`.

**Purpose** — Incremental discovery: find articles and YouTube videos **not** already attached to the briefing, then decide whether to attach sources only, rewrite an existing story, or synthesize a **net-new** story.

```mermaid
flowchart TD
  RER[POST /api/news/id/rerun] --> FLAG[isRerunning true]
  FLAG --> EV[news/pipeline.rerun.requested]
  EV --> LOAD[load-news-request + load-previous-context]
  LOAD --> PLAN[plan-search-queries - same planner as initial run]
  PLAN --> SERP[fetch-and-normalize-serp - rerun boundary + drop known URLs]
  SERP --> RES[research-new-evidence - selector scrape clean YouTube branch]
  RES --> ZERO{new evidence?}
  ZERO -->|no| DONE0[complete-no-new-evidence clear isRerunning notify]
  ZERO -->|yes| MATCH[story-match - StoryMatcherAgent]
  MATCH --> OUT[apply-rerun-outcomes - StoryUpdateDecision + NewsSynthesizer per story]
  OUT --> DONE[clear isRerunning completion notification]
```

**Dedupe boundary** — `load-previous-context` builds canonical URL keys and known YouTube video IDs from existing `NewsSource` rows, plus a **time boundary** from request/story metadata (`services/news/newsRerunBoundary.ts`). Serp hits on or before the boundary or already known are skipped.

**Agents (rerun-specific)** — `StoryMatcherAgent` maps new evidence to existing `NewsStory` ids or `newStoryCandidates`; `StoryUpdateDecisionAgent` chooses full rewrite vs attach-only per match; `NewsSynthesizerAgent` runs with `targetStoryCount: 1` and `fixedStoryId` for updates or creates one story per new candidate.

**Shared with initial news pipeline** — Search planning, Serp fetch/normalize (with rerun mode), article selector, Firecrawl, content cleaner, YouTube select/transcript/analyze/synthesize helpers.

**Failure semantics** — Unlike the initial pipeline, a rerun error does **not** set `NewsRequest.status = failed`; `onFailure` clears `isRerunning` and writes a failure notification. The original briefing remains readable.

**UI** — `useNewsRequestPolling` / `newsRequestPollingLogic` keep polling while `status === pending` **or** `isRerunning`. `deriveProgressSteps` and `NewsGenerationWaitPanel` support `mode: "rerun"`.

---

## Chat Pipeline

**Event:** `chat/message.research.requested` · **Function:** `messageChatPipelineFunction` (`inngest/chatPipeline.ts`) · **Idempotency:** `event.data.chatMessageId` · **Timeout:** 30 minutes.

This is not the news pipeline inside a chat UI. It answers **one user message** with the least external work that the determiner judges sufficient, and it accumulates reusable research on the session.

```mermaid
flowchart TD
  MSG[POST /api/chat/:id saves user ChatMessage] --> EV[chat/message.research.requested]
  EV --> IDEM{assistant reply already exists?}
  IDEM -->|yes| SKIP[return existing reply id]
  IDEM -->|no| CTX[fetch-chat-context + count-research-embeddings]
  CTX --> RENAME[auto-rename-user-chat - first message, general chat only]
  RENAME --> DET[run-determiner]
  DET --> GR{guardrails allow?}
  GR -->|no| BLOCK[save-guardrail-message and stop]
  GR -->|yes| QE[query enhancer - skipped when isFromNewsStory]
  QE --> D[SmallDeterminerAgent output]
  D --> VEC{useExistingResearch and embeddings exist?}
  D --> SRP{useTools = yes?}
  D --> YTQ{evidence.useYoutube?}
  VEC -->|yes| VB[vector-research-branch - pgvector top 8, sim >= 0.72]
  SRP -->|yes| SB[serp-research-branch - fetchAndNormalizeChatSerpResearch + AI Overview follow-up]
  YTQ -->|yes| YB[youtube-research-branch - top 3 videos + transcripts]
  SB --> ART[run-article-synthesizer - top 40 percent, max 6]
  ART --> DEDUP[dedupe-research-candidates + merge determiner firecrawlUrls]
  DEDUP --> FC[firecrawl-and-save-research - clean, insert ResearchSource, concurrency 4]
  YB --> FC
  FC --> MERGE[research context = vector rows + new rows]
  VB --> MERGE
  MERGE --> STORY{determiner.shouldCreateStory?}
  STORY -->|yes| HAND[create-chat-story-and-trigger -> chat/story.research.requested]
  STORY -->|no| CM[generate-assistant-reply - ChatModel]
  CM --> SAVE[save-assistant-message]
  SAVE --> NOTIF[create-completion-notification]
```

### Trigger

`POST /api/chat/[chatSessionId]` → `sendChatMessage` creates the user `ChatMessage` and sends `{ chatSessionId, chatMessageId }`. `POST /api/chat` (new general session) does the same for the first message.

### Idempotency

Inngest `idempotency: "event.data.chatMessageId"` prevents duplicate runs for the same message. Inside the run, `check-existing-assistant-reply` returns early if an agent reply already exists after this user message.

### Chat context

`fetch-chat-context` loads the session, the triggering message (must be a `user` role), and the last `CHAT_PIPELINE_RECENT_MESSAGE_LIMIT` messages; derives `recentMessages` (for agents) and `chatHistoryForModel` (≤ 10 for the chat model); and flags whether this is the first user message. In parallel, `count-research-embeddings` counts pgvector rows for the session — the determiner is told how much prior research exists.

### Guardrails

`runStockResearchGuardrails` runs **inside** the determiner first. Fast local rules (length limits, policy-violation patterns, clearly-off-topic patterns, clearly-in-scope patterns) resolve most prompts; ambiguous prompts go to a small LLM classifier. Categories include `stocks_equities`, `company_research`, `market_news`, `macro_economics`, `trade_economics`, `currencies_commodities`, `product_meta`, `off_topic`, `policy_violation`. A block throws `GuardrailBlockedError`; the pipeline saves a refusal message and stops — no Serp, Firecrawl, or synthesis cost is incurred.

Guardrails are a **scope and safety classifier**, not a fact-checker or an answerability check.

### Query enhancement

`runQueryEnhancerAgent` fixes grammar/spelling and resolves conversational references ("what about their Q2?") using up to 10 recent messages. It does not add facts not present in the prompt. It is **skipped** when the session is a story deep dive (`isNewsStory = true`), because the deep-dive prompt is already a long research brief. The enhanced prompt becomes `researchPrompt` for every downstream step.

### Determiner

`SmallDeterminerAgent` (temperature 0, structured output) receives the enhanced prompt, `researchSourceCount`, `fromOriginalChat`, and recent messages, and returns:

| Field | Meaning | Downstream effect |
|-------|---------|-------------------|
| `useTools` (`"yes"`/`"no"`) | Live search is needed | Enables the Serp branch |
| `calls[]` | Validated Serp tool calls (`searchGoogle`, `searchGoogleFinance`, `searchGoogleNews`, `searchGoogleNewsTab`, `searchGoogleAiMode`) with sanitized params | Executed by `fetchAndNormalizeChatSerpResearch` |
| `useExistingResearch` + `existingResearchQuery` | Prior session research is likely relevant; a semantic query against `ResearchSource.description` | Enables the vector branch |
| `firecrawlUrls[]` (≤ 5) | User supplied direct links | Scraped directly, merged with selected articles |
| `evidence.useYoutube` | Video evidence would help | Enables the YouTube branch |
| `evidence.useAiOverviewFollowUp` | Expand a `searchGoogle` call with `trigger_ai_overview` and follow-up queries | Adds up to 3 follow-up searches |
| `shouldCreateStory` + `storyCreationReason` | The user asked for a story | Hands off to the story pipeline instead of answering; **forced `false` unless `fromOriginalChat`** |

Decision points, therefore: *reuse existing research?* · *search live?* · *which engines and params?* · *scrape given URLs?* · *use YouTube?* · *expand with AI Overview?* · *create a story?*

### Existing research retrieval

If `useExistingResearch` is set and the session has embeddings: embed `existingResearchQuery` with `text-embedding-3-small`, query `chat_resource_embeddings` for this session with cosine similarity ≥ **0.72**, take the top **8**, load those `ResearchSource` rows in similarity order, and map them for the chat model. See [Vector Search](#vector-search).

### Live search

If `useTools = "yes"`: run each determiner call through the matching Serp engine (`CHAT_SERP_NUM` results), with location fallback handling. If `useAiOverviewFollowUp` and the call is `searchGoogle`, request `trigger_ai_overview`; when an overview is present, `GAIOverviewSearchGeneratorAgent` proposes up to `CHAT_AI_OVERVIEW_MAX_FOLLOW_UP = 3` extra searches whose hits are tagged `google_search_ai_overview_follow_up`. Hits are normalized and merged (`mergeNormalizedSerpHits`).

If `useTools = "no"`, no SerpAPI call is made for this turn.

### YouTube evidence

If `evidence.useYoutube`: `fetchChatYoutubeEvidence` runs one YouTube Serp search for the research prompt, takes the top `CHAT_YOUTUBE_MAX_VIDEOS = 3` by position (no LLM selection — this is the fast path), fetches transcripts (truncated to 12,000 chars), and yields rows with `sourceType: "youtube"`.

### Article selection

`ArticleSynthesizerAgent` (a chat-tuned wrapper over `ResearchArticleSelectorAgent`) picks the top 40 % of Serp hits, max 6, using a system prompt that favors direct evidence for the resolved question over generic prominence.

### Deduplication

`dedupe-research-candidates` loads the session's existing `ResearchSource` rows, builds canonical URL keys (`canonicalResearchUrl`, `researchUrlKeysFromSources`), removes already-scraped candidates, and merges determiner `firecrawlUrls` (also deduped). `firecrawl-and-save-research` re-reads keys immediately before inserting to avoid races between parallel turns.

### Research source creation

For each surviving URL: Firecrawl → `NewsContentCleanerAgent` (date = today UTC) → `createResearchSource({ chatSessionId, url, domain, title, content ≤ 50,000 chars, sourceType })`, with insert concurrency 4. YouTube rows are saved the same way with transcript text. `createResearchSource` fire-and-forgets `research/source.index.requested` so the row gets a description and an embedding.

### Final research context

`mergeResearchSourcesForChatModel(existingResearchRows, newResearchRows)` combines vector-retrieved rows and freshly saved rows into one ordered context.

### Chat model

`runChatModelAgent` receives the research prompt, ≤ 10 history messages, Serp hits, and the research context (capped at 48,000 chars) and writes one Markdown reply. Conversation history informs intent and continuity; evidence comes from the research rows.

### Assistant message and notification

`save-assistant-message` stores an `agent` `ChatMessage` (which also enqueues `chat/message.index.requested`). After a normal (non–story-handoff) reply, the pipeline may enqueue **`chat/potential-story-topics.requested`** so `chatPotentialStoryTopicsFunction` appends deduped topic labels to `ChatSession.potentialStories` for the composer UI. `create-completion-notification` writes `CHAT_RESEARCH_COMPLETED` deduped by message. On unrecoverable error, `save-error-message` stores an agent message beginning `Research pipeline failed:` — the UI derives a `failed` status from that prefix — and `onFailure` writes `RESEARCH_FAILED`.

---

## Story Deep Dive Pipeline

**Event:** `chat/pipeline.requested` · **Function:** `chatPipelineFunction` (`inngest/newsNewchatPipeline.ts`) · **Timeout:** 30 minutes.

Used only for the **first** turn of a story-anchored session (`isFromNewsStory = true`). Follow-ups in the same session use the regular Chat Pipeline.

```mermaid
flowchart TD
  DD[POST /api/newsStoryChat] --> SESS[ChatSession isFromNewsStory + newsStoryId + newsSourceId list]
  SESS --> EV[chat/pipeline.requested]
  EV --> LOAD[load-chat-session + load-user-message]
  LOAD --> BRIEF[build-research-prompt - NewsNewChatAgent from story + NewsSource text]
  BRIEF --> DET[run-determiner - guardrails, isNewsStory=true so no query enhancer]
  DET --> GR{allowed?}
  GR -->|no| BLOCK[save-guardrail-message]
  GR -->|yes| SERP[fetch-and-normalize-serp]
  SERP --> SEL[select-articles - ArticleSynthesizerAgent]
  SEL --> PRE[preload-existing-research-sources]
  PRE --> SCR[scrape-and-persist-sources - Firecrawl -> ResearchSource]
  SCR --> CM[generate-assistant-reply - ChatModel]
  CM --> SAVE[save-assistant-message]
  SAVE --> NOTIF[create-completion-notification - DEEP_DIVE_COMPLETED]
```

How it differs from a fresh question:

- **Story context is the prompt.** `NewsNewChatAgent` expands the story's title, summary, content, and every linked `NewsSource` (including scraped text) plus the user's request (or `DEFAULT_NEWS_RESEARCH_REQUEST`) into a long research brief.
- **No query enhancer** (`isNewsStory = true`).
- **No pgvector reuse** on this first turn — the session has no research yet.
- **`shouldCreateStory` is forced off** (`fromOriginalChat = false`).
- Access is enforced at start: `startNewsStoryChat` returns `null` (404) for user-created stories that are not `published`.

---

## Chat → Story Pipeline

**Event:** `chat/story.research.requested` · **Function:** `chatStoryPipelineFunction` (`inngest/chatstoryPipeline.ts`) · **Idempotency:** `event.data.storyId` · **Timeout:** 45 minutes.

```mermaid
flowchart TD
  MSG[User message in a general chat] --> CP[Chat Pipeline through firecrawl-and-save-research]
  CP --> DEC{determiner.shouldCreateStory?}
  DEC -->|no| ANSWER[ChatModel reply]
  DEC -->|yes| SHELL[createUserChatNewsStoryShell - draft NewsStory, slug pending-*, title Story in progress]
  SHELL --> SEND[send chat/story.research.requested with prepared context]
  SEND --> ACK[agent ChatMessage: I am researching and writing your news story]
  SEND --> SP[chatStoryPipelineFunction]
  SP --> VAL[validate-story - owner and session match; skip if already complete]
  VAL --> GAP[story-research-gap - ChatStoryResearchGapAgent]
  GAP --> XS{needsAdditionalSerp?}
  XS -->|yes| SERP2[optional-additional-serp]
  XS -->|no| FCQ
  SERP2 --> FCQ{gap firecrawlUrls?}
  FCQ -->|yes| FC2[optional-firecrawl + clean]
  FCQ -->|no| SYN
  FC2 --> SYN[synthesize-story - NewsSynthesizerAgent targetStoryCount 1, fixedStoryId]
  SYN --> PERSIST[persist-story-and-sources - NewsSource rows + applyChatStorySynthesis]
  PERSIST --> NOTIF[CHAT_STORY_COMPLETED notification]
  ACK --> POLL[Chat UI and story page poll until isGenerating is false]
```

### Story creation decision

The determiner returns `shouldCreateStory` only when the prompt asks for a story/article **and** the session is a general chat (`fromOriginalChat = true`). Deep-dive sessions never create stories. Guardrail rules explicitly allow "create a news story" phrasing as `market_news`.

### Story shell

Before any story research, the chat pipeline inserts a **draft** `NewsStory`:

```text
isUserCreated = true
publishStatus = draft
ownerId       = session user
chatSessionId = this session
title         = "Story in progress"
slug          = "pending-<timestamp>"
```

Creating the shell first gives the frontend a stable `storyId` to poll and lets the pipeline be idempotent on that ID. `isUserStoryGenerating()` recognizes the placeholder slug/title.

### Prepared context

The event carries everything the chat pipeline already computed, so nothing is recomputed:

```text
storyId, chatSessionId, userId, chatMessageId
enhancedPrompt                 — determiner's researchPrompt
recentMessages, chatHistory    — intent only; not evidence
determiner                     — useTools, useExistingResearch, existingResearchQuery,
                                 firecrawlUrls, evidence flags, shouldCreateStory, reason
existingResearch               — vector-retrieved + newly saved ResearchSource rows (mapped)
serpHits                       — normalized Serp results from this turn
youtubeEvidence                — transcripts fetched this turn
selectedArticles               — article-selector output
```

### Story-specific research (gap analysis)

`ChatStoryResearchGapAgent` receives the prompt and **counts** of existing research, Serp hits, YouTube rows, and selected articles, and returns `needsAdditionalSerp`, `serpCalls`, `needsAdditionalYoutube`, `firecrawlUrls`, `useAiOverviewFollowUp`. It does not re-run guardrails, query enhancement, or story-intent detection.

### Research reuse and additional research

`mergePreparedResearchArticles` converts prepared context into synthesizer articles. Extra Serp runs only if the gap agent asks; extra Firecrawl runs only for gap URLs, each cleaned by `NewsContentCleanerAgent` and merged by canonical URL. If no articles remain, the step throws.

### Story synthesis

`NewsSynthesizerAgent` with `targetStoryCount: 1` and `fixedStoryId: storyId`, prompted to produce exactly one evidence-backed story and to use conversation context only for intent. The result must have a primary article source.

### Story persistence

`persist-story-and-sources` creates `NewsSource` rows and calls `applyChatStorySynthesis` to overwrite the shell's title, slug, description, summary, content, category, location, `imageUrl`, `importanceScore`, `newsSourceIds`, and `publishedAt`. `publishStatus` stays **`draft`**.

### Frontend polling

- `GET /api/newsStoryChat/[chatSessionId]` returns `storyCreation: { storyId, isGenerating, generationFailed, publishStatus }` derived from the latest chat-origin story for the session; `ChatLayout` polls while `isGenerating`.
- `GET /api/news/stories/[storyId]` returns `isGenerating` / `generationFailed`; `useNewsStoryPolling` polls every 5 s while generating.
- `GET /api/chat/[chatSessionId]/stories` and `/stories/count` power the composer's stories launcher.

### Failure

`onFailure` → `markChatNewsStoryFailed` sets `generationError`, title "Story generation failed", and placeholder copy (only while still a draft with no prior error), then writes a `RESEARCH_FAILED` notification. `validate-story` treats a failed story as non-retriable.

---

## Story Architecture

A `NewsStory` is a synthesized, Markdown-bodied story with its evidence attached.

| Field | Meaning |
|-------|---------|
| `title`, `description`, `slug`, `summary`, `content` | Synthesized copy; `content` is Markdown |
| `category`, `location`, `publishedAt`, `importanceScore` | Synthesizer metadata; `location` inferred from content |
| `imageUrl` | Resolved from source metadata |
| `newsSourceIds[]`, `sources` | Evidence rows (`NewsSource`) |
| `upvotes`, `downvotes`, `votes` | Denormalized counters + per-user `NewsStoryVote` |
| `newsRequestId` | Set for briefing stories |
| `isUserCreated`, `ownerId`, `chatSessionId`, `publishStatus`, `generationError` | User-created story fields |

### Lifecycle

There is no status enum on stories. State is derived:

```text
System story (isUserCreated = false)
  created by news pipeline → publishStatus = published
  publicly visible when its NewsRequest.status = success

User-created story (isUserCreated = true)
  shell:      publishStatus = draft, slug pending-*, title "Story in progress"   → isGenerating
  failed:     generationError set                                                → generationFailed
  ready:      real title/slug/content, publishStatus = draft                     → owner-only
  published:  publishStatus = published                                          → public
  (owner can unpublish back to draft)
```

Visibility rules live in `services/news/newsStoryAccess.ts` (`publicNewsStoryWhere`, `canViewerAccessNewsStoryPage`).

---

## User-Created Stories

| Aspect | Behavior |
|--------|----------|
| **Origin** | Only via the chat → story pipeline from a general chat |
| **Ownership** | `ownerId` = the chat session's user; `chatSessionId` records origin |
| **Draft** | Visible only to the owner (feed, trending, and anonymous story pages exclude it); not deep-divable |
| **Editing** | `PATCH /api/news/stories/[storyId]` — owner only; fields: `title`, `description`, `summary`, `content`, `category`, `location`, `imageUrl`; blocked while generating or failed (`canEdit`) |
| **Cover photo** | `POST /api/news/stories/[storyId]/photo` — owner only; multipart field `photo` or `file`; JPEG/PNG/WebP/GIF/AVIF ≤ 5 MB; Cloudinary primary, S3 fallback |
| **Publish / unpublish** | `POST` / `DELETE /api/news/stories/[storyId]/publish` — owner only |
| **Published** | Appears in the public feed and trending, can be voted, bookmarked, and deep-dived by anyone; still editable only by the owner |
| **Listing** | `/newsStory/saved` ("My stories") via `GET /api/news/stories/saved` |
| **In chat** | Draft owners see "Back to chat" instead of Deep Dive; the composer shows the session's stories |

System stories and user stories share the table and all read paths; only creation, ownership, and visibility differ.

---

## Research Architecture

A `ResearchSource` is one piece of scraped evidence attached to a chat session.

| Field | Meaning |
|-------|---------|
| `chatSessionId` | Owning session (evidence is session-scoped) |
| `url`, `domain`, `title` | Source identity; canonical URL used for dedupe |
| `content` | Cleaned article text or YouTube transcript (≤ 50,000 chars) |
| `sourceType` | e.g. Serp engine name, `google_search_ai_overview_follow_up`, `youtube`, direct URL |
| `description` | LLM-written short description (filled asynchronously) |
| `resourceEmbedding` | One `ChatResourceEmbedding` row (vector of `description`) |

Why persist research separately from stories and messages:

- A **story** is an output; the same evidence may support an answer today and a story tomorrow.
- A **message** is what was said; the evidence behind it must be retrievable without re-reading the transcript.
- Session scoping keeps retrieval relevant and bounds the vector search.

`NewsSource` plays the same role for stories: evidence attached to a `NewsStory` (briefing or chat-origin). The two tables are separate because their parents and lifecycles differ.

---

## Canonical Data vs Retrieval Indexes

| Kind | Models | Role |
|------|--------|------|
| **Canonical conversation** | `ChatSession`, `ChatMessage` | What was asked and answered |
| **Canonical story output** | `NewsStory` | Synthesized briefing or user draft |
| **Canonical evidence** | `NewsSource`, `ResearchSource` | Scraped/cleaned text the models were allowed to use |
| **Canonical request** | `NewsRequest` | Briefing configuration, status, `loadingLogs` |
| **Retrieval index** | `ChatResourceEmbedding` | pgvector over `ResearchSource.description`; consumed by chat |
| **Retrieval index (unused)** | `ChatMessageEmbedding` | pgvector over message summaries; written, not read |
| **Derived counters** | `NewsStory.upvotes` / `downvotes` | Denormalized from `NewsStoryVote` |
| **Cache** | `SearchAutocompleteCache` | Provider responses, not research |

Embeddings are not a second copy of the article. They index a short description so the determiner can retrieve existing `ResearchSource` rows. The article text stays on `ResearchSource.content`.

---

## Evidence Model

```mermaid
flowchart LR
  WEB[Web page / video] --> SERP[Serp hit]
  SERP --> SEL[Selected for scraping]
  SEL --> FC[Firecrawl markdown / transcript]
  FC --> CLEAN[Cleaned text]
  CLEAN --> RS[ResearchSource - chat]
  CLEAN --> NS[NewsSource - story]
  RS --> EMB[ChatResourceEmbedding]
  RS --> CTX[Research context]
  EMB -->|later turns| CTX
  CTX --> CM[ChatModel]
  CTX --> SYN[NewsSynthesizer]
  CM --> ANS[ChatMessage - agent]
  SYN --> STORY[NewsStory + NewsSource]
```

Layers:

- **Source** — the external page or video.
- **Research** — its cleaned text stored on a session (`ResearchSource`) or story (`NewsSource`).
- **Context** — the subset assembled for one model call (retrieved + fresh rows, capped).
- **Synthesis** — the model's writing.
- **Output** — a `ChatMessage` or `NewsStory`.

There is **no claim-level table**. Stories cite sources as rows, not per-sentence claims. Conversation history is passed to models as context for intent; it is not stored or treated as evidence.

---

## Vector Search

```mermaid
flowchart TD
  RS[ResearchSource inserted] --> EV[research/source.index.requested]
  EV --> DESC[ResearchSourceDescriptionAgent -> description]
  DESC --> EMB[embedText text-embedding-3-small 1536 dims]
  EMB --> STORE[chat_resource_embeddings upsert by chat_resource_id]
  Q[determiner.existingResearchQuery] --> QEMB[embed query]
  QEMB --> SQL[SELECT ... WHERE chat_session_id = ? AND 1 - cosine_distance >= 0.72 ORDER BY distance LIMIT 8]
  STORE --> SQL
  SQL --> IDS[research source ids by similarity]
  IDS --> LOAD[listResearchSourcesByIdsForChatSession]
  LOAD --> CTX[research context for ChatModel]
```

| Item | Implementation |
|------|----------------|
| **What is embedded** | `ResearchSource.description` — an LLM summary of the scraped content, not the raw page |
| **Model** | OpenAI `text-embedding-3-small` via `AIClient.embedText` (override `OPENAI_EMBEDDING_MODEL`) |
| **Dimensions** | 1536, enforced at write time |
| **Storage** | `chat_resource_embeddings(id, chat_session_id, chat_resource_id UNIQUE, embedding vector(1536))`; upsert on `chat_resource_id` |
| **Similarity** | Cosine: `1 - (embedding <=> query)` via pgvector |
| **Threshold** | `VECTOR_MIN_SIMILARITY = 0.72` (chat pipeline) |
| **Limit** | `VECTOR_RESEARCH_LIMIT = 8` |
| **Scope** | Always filtered by `chat_session_id`; no cross-session or cross-user retrieval |
| **When queried** | Chat pipeline only, when `useExistingResearch` is true and the session has ≥ 1 embedding |
| **When indexed** | Asynchronously after every `ResearchSource` insert; does not block the answering pipeline |

Why this shape: embedding a short description gives a cleaner semantic signal than raw Markdown, keeps token cost low, and keeps the index one row per source. The count of embeddings is passed to the determiner so it can decide whether reuse is even possible.

---

## Conversation Memory

Two distinct mechanisms:

| | Conversation history | Research memory |
|--|----------------------|-----------------|
| **Data** | `ChatMessage` rows (canonical) | `ResearchSource` rows + `ChatResourceEmbedding` |
| **How used** | Last N messages passed to guardrails (≤ 20), query enhancer (≤ 10), determiner, chat model (≤ 10) | Semantic retrieval by the determiner's query |
| **Role** | Intent, coreference, continuity | Evidence |

A third index exists but is **not consumed yet**: `chatMessageEmbeddingFunction` (`chat/message.index.requested`) summarizes each saved message with `ChatMessageSummarizerVectorAgent` and upserts `chat_message_embeddings`. `searchSimilarChatMessageIds` exists in `repositories/chatMessageEmbedding.ts`, but no pipeline calls it. Treat message-level semantic memory as **indexed, in progress**.

---

## AI Agent Architecture

All agents call `clients/AIClient.ts`, which wraps the OpenAI SDK (structured outputs via Zod schemas, embeddings) with an optional Vercel AI SDK gateway path. Models resolve per agent (`lib/openAiModel.ts`).

| Agent | Type | Purpose | Input | Output | Used by |
|-------|------|---------|-------|--------|---------|
| **Stock research guardrails** (`guardrails.ts`) | Decision | Allow/block by scope and policy | prompt, ≤ 20 history msgs | `{ allowed, category, reason, userMessage }` | Determiner (all chat paths) |
| **Query enhancer** | Transformation | Fix wording, resolve references | prompt, ≤ 10 msgs | enhanced query | Determiner (not on deep dives) |
| **Small determiner** | Decision | Plan research for one message | prompt, research count, flags, msgs | `useTools`, `calls`, `useExistingResearch`, `existingResearchQuery`, `firecrawlUrls`, `evidence`, `shouldCreateStory` | Chat, deep dive |
| **Search planner** (`searchPlanner.ts`) | Transformation | Build Serp query strings from request config | news config | query strings | News planning |
| **GAI Overview search generator** | Transformation | Turn an AI Overview into follow-up queries | overview text | query list | News, chat Serp |
| **Research article selector** | Selection | Rank Serp links for scraping | prompt, links, topPercent | selected links | News, chat (via wrapper) |
| **Article synthesizer (chat)** | Selection | Chat-tuned wrapper over the selector (40 %, max 6) | prompt, hits | selected links | Chat, deep dive |
| **News content cleaner** | Transformation | Strip page noise; validate article | markdown, date, location | `{ cleanedContent, isValidArticle }` | News, chat, story |
| **YouTube video agent** | Selection | Pick relevant videos | Serp video rows, prompt | selection | News |
| **YouTube transcript agent** | Transformation | Analyze a transcript | transcript | structured analysis | News |
| **YouTube transcript synthesize agent** | Synthesis | Merge analyses into facts | analyses | facts + overview | News |
| **News synthesizer** | Synthesis | Cluster evidence into stories | articles, YouTube facts, target count | stories with sources | News, rerun, chat story |
| **Story matcher** | Decision | Map new rerun evidence to existing stories or new topics | stories, new articles | story ids / candidates | News rerun |
| **Story update decision** | Decision | Rewrite vs attach-only per matched story | story + new evidence | update plan | News rerun |
| **News new-chat agent** | Transformation | Build deep-dive research brief | story, sources, request | research prompt | Deep dive |
| **Chat model** | Synthesis | Final Markdown answer | prompt, history, research context | Markdown | Chat, deep dive |
| **Chat story research gap agent** | Decision | Decide extra research for one story | prompt + evidence counts | gap plan | Chat story |
| **Research source description agent** | Transformation | Describe a source for embedding | content | description | Index pipeline |
| **Chat message summarizer (vector)** | Transformation | Summarize a message for embedding | message | summary | Message index pipeline |
| **Chat session title agent** | Transformation | Title a new chat | first message | title | Chat (auto-rename) |
| **Quick action / Try-these-questions** | Transformation | UI suggestions | session context | suggestions | UI API routes |
| **Relevance agent**, **Chat story similarity query agent** | — | Present in `Agents/chat`, **not wired** | — | — | — |

```mermaid
flowchart LR
  subgraph Decision
    G[Guardrails] --> D[Determiner]
    GAP[Story gap agent]
  end
  subgraph Transformation
    QE[Query enhancer] --> D
    GAI[AI Overview generator]
    CL[Content cleaner]
    NNC[Deep-dive brief]
    RSD[Source description]
  end
  subgraph Selection
    SEL[Article selector]
    YV[YouTube video agent]
  end
  subgraph Synthesis
    NS[News synthesizer]
    CM[Chat model]
  end
  D --> SEL
  D --> GAI
  SEL --> CL
  CL --> NS
  CL --> CM
  GAP --> NS
  NNC --> D
  RSD --> VEC[(pgvector)]
  VEC --> CM
```

---

## External Research Services

### SerpAPI

Wrapper: `clients/serpCleint.ts`; engines: `SERP/index.ts`.

| Engine key | SerpAPI engine | Used by |
|------------|----------------|---------|
| `searchGoogle` | `google` (optionally `trigger_ai_overview`) | Chat determiner calls, news AI Overview follow-ups |
| `searchGoogleNewsTab` | `google` with `tbm: nws` | News pipeline, chat |
| `searchGoogleNews` | `google_news` | News pipeline, chat |
| `searchGoogleFinance` | `google_finance` | Chat determiner |
| `searchGoogleAiMode` | `google_ai_mode` | Chat determiner |
| `searchYoutube` | `youtube` | News, chat YouTube branch |
| `searchYoutubeVideoTranscript` | `youtube_video_transcript` | Transcript fetch |
| `searchGoogleMapsAutocomplete` | `google_maps_autocomplete` | Location autocomplete |
| `searchGoogleMaps` | `google_maps` | Reverse geocoding |
| (internal) | `google_ai_overview` | Reading AI Overview payloads |

Results are normalized to a common hit shape (`normalizeArticles.ts`, `normalizeSerpResults.ts`), merged across engines, deduplicated by canonical URL, and (news) filtered by date and trading-tip heuristics. SerpAPI is called only when a plan (news) or the determiner/gap agent (chat/story) asks for it.

### Firecrawl

Client: `clients/FireCrawlClient.ts`; helper: `services/firecrawl/scrapeUrls.ts`. Input: selected URLs. Output: Markdown (`onlyMainContent: true`) or `null` per URL. Always followed by `NewsContentCleanerAgent` in the news, chat, and story pipelines. Persisted as `NewsSource.scrapedContent` or `ResearchSource.content`.

### YouTube (via SerpAPI)

Discovery through `youtube` search; transcripts through `youtube_video_transcript`. News path: agent-selected videos → transcript analysis → synthesized facts (supporting evidence). Chat path: top 3 by position → raw transcript rows.

### AI Overview

Google's AI Overview block is read from `searchGoogle` payloads. It is **not** used as evidence. It is used by `GAIOverviewSearchGeneratorAgent` to generate follow-up news-tab searches whose results are then selected and scraped like any other hit (with a small selection-weight boost).

### OpenAI

All agents and embeddings. Configured by `OPENAI_API_KEY`, `OPENAI_MODEL`, optional base URL / project, and per-agent model overrides.

### Upstox

Read-only analytics token. Quotes, candles, fundamentals, and derivatives statistics for instrument research. The beginning-of-day instrument file is synced into `Instrument` and is what suggest and the instrument lexicographer search.

### Resend

Transactional email for newsletter editions. `EMAIL_FROM` is the From header. Unsubscribe links are signed with `UNSUBSCRIBE_SECRET`.

### Razorpay

One-time Orders for Pro. See [Billing and Pro Subscription](#billing-and-pro-subscription).

### Clerk and Inngest

Identity and durable execution respectively; see the dedicated sections.

---

## Background Processing

```mermaid
flowchart LR
  A[Route handler / repository] -->|inngest.send| E[Event]
  E --> I[Inngest - dev server or cloud]
  I --> F[Inngest function with step.run checkpoints]
  F --> X[SerpAPI / Firecrawl / OpenAI]
  F --> DB[(PostgreSQL)]
  F --> N[Notification row]
  DB --> P[Frontend polling]
```

| Event | Producer | Function (`id`) | Idempotency | Timeout |
|-------|----------|-----------------|-------------|---------|
| `news/pipeline.requested` | `POST /api/news`, retry route | `news-pipeline` | — (request status guards) | 45 m |
| `news/pipeline.rerun.requested` | `POST /api/news/[newsId]/rerun` | `news-rerun-pipeline` | concurrency key `newsId` | 45 m |
| `chat/pipeline.requested` | `POST /api/newsStoryChat`, `startNewChat` with story | `chat-pipeline` | — | 30 m |
| `chat/message.research.requested` | `POST /api/chat`, `POST /api/chat/[id]` | `message-chat-research-pipeline` | `event.data.chatMessageId` | 30 m |
| `chat/story.research.requested` | message chat pipeline | `chat-story-pipeline` | `event.data.storyId` | 45 m |
| `research/source.index.requested` | `createResearchSource` (fire-and-forget) | `research-source-description-index` | — | 15 m |
| `chat/message.index.requested` | `createChatMessage` (fire-and-forget) | `chat-message-embedding-index` | — | 15 m |
| `chat/potential-story-topics.requested` | message chat pipeline after reply | `chat-potential-story-topics` | `event.data.chatMessageId` | 10 m |
| `stock/research.requested` | `POST /api/stockResearch`, hosted-agent `POST /research/reports` | `stock-research-pipeline` | `event.data.stockResearchId` | 30 m |
| `newsletter/run` | scheduler (every 5 minutes) and test send | `newsletter-run` | event id per newsletter and slot | — |
| `newsletter/edition.build` | newsletter run | `newsletter-edition-build` | concurrency on fingerprint + period | — |
| cron `*/5 * * * *` | Inngest | `newsletter-scheduler` | — | — |
| cron `30 3 * * *` | Inngest | `newsletter-edition-cleanup` | — | — |
| `api/job.webhook.requested` | hosted-agent job create | `api-v1-job-webhook` | `event.data.jobId` | polls up to 30 m |
| cron `15 3 * * *` | Inngest | `api-v1-maintenance` | drops old rate-limit windows and expired idempotency keys | — |
| cron `TZ=Asia/Kolkata 0 6 * * *` | Inngest | `provider-usage-reconcile` | compares recorded SerpAPI and Firecrawl credits with provider usage APIs | — |

Why Inngest: research runs for minutes and calls flaky external APIs. `step.run` memoizes completed steps so a retry resumes rather than restarts; `onFailure` hooks write user-visible failure state; parallel `Promise.all` of steps runs independent branches concurrently. Locally, `pnpm inngest:dev` runs the dev server against `/api/inngest`. In production the SDK runs in dev mode (`INNGEST_DEV=1`) against a self-hosted dev server.

---

## Database Architecture

PostgreSQL 16 with the `vector` extension, accessed through Prisma 7 (`prisma-client` generator, output `db/generated/`) and the `pg` adapter. Vector columns are `Unsupported("vector(1536)")` in Prisma and are read/written with `$queryRaw` / `$executeRaw`.

```mermaid
erDiagram
  User ||--o{ NewsRequest : creates
  User ||--o{ ChatSession : owns
  User ||--o{ NewsStory : owns_user_created
  User ||--o{ NewsStoryVote : casts
  User ||--o{ Notification : receives
  User ||--o{ Script : owns
  NewsRequest ||--o{ NewsStory : produces
  NewsStory ||--o{ NewsSource : cites
  NewsStory ||--o{ NewsStoryVote : receives
  NewsStory ||--o{ ChatSession : deep_dive_anchor
  ChatSession ||--o{ NewsStory : chat_origin
  ChatSession ||--o{ ChatMessage : contains
  ChatSession ||--o{ ResearchSource : accumulates
  ChatSession ||--o{ Script : has
  ChatSession ||--o{ ChatResourceEmbedding : indexes
  ChatSession ||--o{ ChatMessageEmbedding : indexes
  ResearchSource ||--o| ChatResourceEmbedding : embedded_as
  ChatMessage ||--o| ChatMessageEmbedding : embedded_as
```

### User
Clerk-synced identity (`clerkId`, email, profile). Holds `saved_stories UUID[]` (bookmarks) and **`plan`** (`FREE` | `PRO`, default `FREE`). Optional **`Subscription`** row (one per user) stores provider metadata and **`currentPeriodEnd`** for Pro expiry. Created/updated by `upsertUserFromClerk` on every authenticated request; Pro expiry reconciled in `getAuthenticatedUser()`.

### Subscription / Payment / PaymentWebhookEvent
Defined in `db/schema/billing.prisma`. **Subscription** tracks Pro period boundaries and status (`ACTIVE`, `EXPIRED`, etc.). **Payment** records Razorpay order/payment ids and amounts in paise. **PaymentWebhookEvent** dedupes provider webhook deliveries. Razorpay Orders checkout is one-time; recurring Razorpay Subscriptions API is not implemented.

### NewsRequest
A briefing job: `date`, `scope`, `location`, optional **`latitude` / `longitude`**, `categories[]`, `customQuery`, `storyCount`, `language`, `sources[]`, planned `searchQuery` JSON, `status` (`pending` → `success` | `failed`), **`isRerunning`**, `error`, `completedAt`, `loadingLogs[]`. Created by the API; updated by the news and rerun pipelines; read by polling.

### NewsStory
See [Story Architecture](#story-architecture). Unique `(newsRequestId, slug)`; indexes on `(isUserCreated, publishStatus)`, `(ownerId, publishStatus)`, `(upvotes, publishedAt)`.

### NewsSource
Evidence for a story: `url`, `domain`, `title`, `scrapedContent`, `publishedAt`, `sourceType`, `transcript`, `imageUrl`. Created by the news and chat-story pipelines.

### NewsStoryVote
One row per `(newsStoryId, userId)` with `vote UP|DOWN`; counters on the story are kept in sync by `storyVoteService`.

### ChatSession
A conversation: `userId`, optional `newsStoryId` + `newsSourceId[]` (deep-dive anchor), `isFromNewsStory`, `title`, `topic`, `isBookmarked`.

### ChatMessage
`role` (`user` | `agent`), `content`, optional `scriptId`. Canonical conversation record.

### ResearchSource
See [Research Architecture](#research-architecture).

### ChatResourceEmbedding / ChatMessageEmbedding
Retrieval indexes (`vector(1536)`), keyed one-to-one to their source row, scoped by `chatSessionId`.

### Notification
`type`, `title`, `message`, `link`, `read`, `dedupeKey`; unique `(userId, dedupeKey)` makes pipeline notifications idempotent.

### SearchAutocompleteCache
`(provider, query)` unique → `response` JSON, `expiresAt`. Provider encodes source, language, and a coarse geo cell.

### Newsletter / NewsletterDelivery / NewsEdition
A digest the user scheduled (`frequency`, local send time, timezone, scope, categories, story count). A delivery is one attempt. An edition is the shared `NewsRequest` for a parameter fingerprint and period, so identical digests do not each run the news pipeline.

### Instrument
One Upstox beginning-of-day row per `instrumentKey` (segment, exchange, trading symbol, name, optional ISIN and derivative fields). Suggest endpoints and the hosted-agent instrument search read this table.

### StockResearch / StockResearchResource
A Pro report job: `assetType` (`STOCK`, `ETF`, `MUTUAL_FUND`), instrument identity, original `userPrompt`, enhanced `query`, `status`, `reportMarkdown`, `loadingLogs`. Resources are the raw Upstox, search, and scraped pages the synthesizer read.

### ApiKey and related hosted-agent tables
Defined alongside the public API: hashed keys and scopes, jobs, idempotency keys, rate-limit windows, and the per-account webhook secret. The plaintext key is shown once at creation.

### Script
Schema only (`title`, `content`, `durationSeconds`, `style`, `status`, `researchSourceIds[]`). No runtime code uses it yet.

### Canonical vs derived vs index

| Kind | Tables |
|------|--------|
| Canonical | `User`, `NewsRequest`, `ChatSession`, `ChatMessage`, `ResearchSource`, `NewsSource`, `NewsStoryVote`, `Notification`, `Newsletter`, `Instrument`, `StockResearch`, `StockResearchResource` |
| Derived output | `NewsStory` (synthesized), `NewsStory.upvotes/downvotes` (counters), `users.saved_stories`, `NewsEdition`, `StockResearch.reportMarkdown` |
| Index | `ChatResourceEmbedding`, `ChatMessageEmbedding`, `SearchAutocompleteCache` |

---

## Frontend and Backend Interaction

The UI never blocks on research. Pattern: create record → enqueue → poll a status-bearing read endpoint.

```mermaid
sequenceDiagram
  participant B as Browser
  participant API as Next.js route
  participant DB as PostgreSQL
  participant I as Inngest
  participant P as Pipeline steps

  B->>API: POST /api/news (config)
  API->>DB: insert NewsRequest(status=pending)
  API->>I: send news/pipeline.requested
  API-->>B: { newsRequest }
  loop every 3s while pending
    B->>API: GET /api/news/:id
    API->>DB: read request + stories
    API-->>B: { newsRequest(status, loadingLogs), stories }
  end
  I->>P: run steps (search, scrape, clean, synthesize)
  P->>DB: append loadingLogs; insert NewsStory/NewsSource
  P->>DB: status=success; Notification
  B->>API: GET /api/news/:id -> status=success -> stop polling
```

| Flow | Create | Poll | Interval | Stop when |
|------|--------|------|----------|-----------|
| Briefing | `POST /api/news` | `GET /api/news/[newsId]` | 3 s (`useNewsRequestPolling`) | `status !== pending` and `isRerunning === false` |
| Briefing rerun | `POST /api/news/[newsId]/rerun` | same | same | `isRerunning === false` |
| Chat turn | `POST /api/chat[/id]` | `GET /api/newsStoryChat/[chatSessionId]` | `ChatLayout` `POLL_MS` | derived `status` is `ready`/`failed` and no story is generating |
| Deep dive | `POST /api/newsStoryChat` | same as chat | same | same |
| Chat story | (inside chat) | story page `GET /api/news/stories/[storyId]` and chat state | 5 s (`useNewsStoryPolling`) | `isGenerating` false |
| Notifications | — | `GET /api/notifications` | 10 s (`useNotifications`) | — |

Chat status is **derived from messages**: `initializing` while the last user message has no agent reply; `failed` if the latest reply starts with `Research pipeline failed:`; otherwise `ready`.

---

## Loading and Progress States

- **User-facing progress** — The news pipeline appends short lines to `NewsRequest.loadingLogs` at stage boundaries ("Pipeline started.", "Search queries planned.", "Finding relevant stories.", "Checking sources.", "Organizing the news.", "Preparing your briefing."). `/news/[newsId]` renders these while polling.
- **Story generation** — `isGenerating` / `generationFailed` are computed from placeholder slug/title and `generationError`; story pages render a status panel instead of the body while generating.
- **Chat** — `initializing` shows a thinking state; the story-creation acknowledgement message appears immediately while the story pipeline runs.
- **Technical logging** — Pipelines log step timings (`durationMs`) with `createPipelineLogger` / pino (`clients/logger.ts`, `next-logger`). These are server logs, not shown to users.

---

## Notifications

| Type | Producer | Link |
|------|----------|------|
| `NEWS_PIPELINE_COMPLETED` / `NEWS_PIPELINE_FAILED` | News pipeline | `/news/[newsRequestId]` |
| `NEWS_PIPELINE_RERUN_COMPLETED` / rerun failure variant | News rerun pipeline | `/news/[newsRequestId]` |
| `CHAT_RESEARCH_COMPLETED` / `RESEARCH_FAILED` | Chat pipeline | `/chat/[chatSessionId]` |
| `DEEP_DIVE_COMPLETED` / failed variant | Deep-dive pipeline | `/chat/[chatSessionId]` |
| `CHAT_STORY_COMPLETED` / `RESEARCH_FAILED` | Chat story pipeline | `/newsStory/[storyId]` |

`tryCreatePipelineNotification` never fails the pipeline; duplicates are prevented by `dedupeKey = "<type>:<entityId>"` and the unique constraint. API: `GET /api/notifications`, `PATCH`/`POST /api/notifications/[id]/read`, `POST /api/notifications/read-all`, `GET/PUT/PATCH/DELETE /api/notifications/[id]`. UI: `NotificationBell` in the header.

---

## Deduplication

| Where | Mechanism |
|-------|-----------|
| Serp merging | `mergeNormalizedSerpHits` / `mergeSerpPayloads` collapse the same URL across engines and tiers |
| Chat candidates | `dedupeSelectedArticlesForSession` removes URLs whose canonical key already exists as a `ResearchSource` on the session; determiner `firecrawlUrls` are merged with the same key set |
| Chat inserts | Keys are re-read right before insert (`freshKeys`) to avoid racing parallel turns; YouTube rows are checked the same way |
| Story pipeline | Gap-scraped articles are merged into prepared articles by canonical URL (existing rows get `scrapedContent` and `isPrimaryStorySource`) |
| Vector index | Upsert on `chat_resource_id` — one embedding per source |
| Notifications | `(userId, dedupeKey)` unique |
| Autocomplete | In-flight request map collapses concurrent identical lookups |

Canonicalization (`canonicalResearchUrl`) strips tracking params and normalizes host/path so `?fbclid=` variants do not create duplicate research.

---

## Caching

The only application cache is for location autocomplete (three layers):

| Layer | Key | TTL | Storage |
|-------|-----|-----|---------|
| Client (browser) | `<geoKey>:<normalizedQuery>` | 5 min, ≤ 100 entries | `lib/location/autocompleteClientCache.ts` |
| Server memory (L1) | `serpapi:en:<geoKey>:<normalizedQuery>` | 5 min | process `Map` |
| Postgres (L2) | `SearchAutocompleteCache(provider, query)` | 14 days (`expiresAt`) | shared across users and instances |

`geoKey` is a ~11 km grid cell (`lat.toFixed(1)_lng.toFixed(1)`) or `default`. Stale Postgres rows are used as a fallback if the provider call fails. `purgeExpiredAutocompleteCache(retentionDays)` exists for maintenance but is not scheduled.

Vector embeddings and `loadingLogs` are persistence, not caches. There is no HTTP response caching; polling endpoints use `cache: "no-store"`.

---

## Location and Search Autocomplete

```text
keystroke
  → normalize (trim, lowercase, collapse spaces); ignore < 2 chars
  → client cache: exact key or reuse a cached longer/shorter prefix result filtered client-side
  → debounce 5 s (`AUTOCOMPLETE_DEBOUNCE_MS = 5000`)
  → GET /api/location/autocomplete?q=&latitude=&longitude=&cp=
      → server memory cache
      → Postgres exact hit (fresh) → return
      → Postgres prefix hit (longest cached prefix whose filtered results ≥ 5) → return
      → in-flight dedupe
      → SerpAPI google_maps_autocomplete (ll from coords or India default)
      → upsert Postgres (14-day TTL) → return
      → on provider error: stale exact row if any
```

Reverse geocoding: `useLocationHook` requests browser geolocation, then `POST /api/location/reverse` resolves coordinates to a metro-level label via SerpAPI Maps (`resolveUserLocationFromCoordinates`). Both routes are unauthenticated but validate input with Zod and never accept provider keys from the client.

Why: autocomplete fires on every keystroke; prefix reuse and a shared persistent cache mean most sessions hit SerpAPI a handful of times instead of dozens.

---

## Authentication and Authorization

- **Clerk** middleware (`proxy.ts`) runs on all app and API routes. Sign-in/up pages are Clerk components.
- `getAuthenticatedUser()` / `requireAuthenticatedUser()` (`lib/auth.ts`) resolve Clerk, **upsert** the local `User`, run **`reconcileExpiredProSubscription()`**, and return the user with **`subscription`** selected for `/api/me`.
- **Effective Pro** — `isProSubscriberPlan(plan, currentPeriodEnd)` in `services/billing/userPlanAccess.ts`: plan must be `PRO` and now must be before `currentPeriodEnd + 5 days` (`PRO_SUBSCRIPTION_GRACE_DAYS`). Missing `currentPeriodEnd` with `PRO` is treated as active (legacy rows).
- **`requireProSubscriber()`** — Server Components / routes for Pro-only pages; redirects or throws when not Pro.
- **Client gating** — `hooks/useIsProSubscriber.ts` fetches `/api/me` and applies the same helpers from **`userPlanAccess`** (never import `userPlan.ts` in `"use client"` code — it pulls Prisma/pg).
- **Ownership checks are server-side** in repositories/services: `getNewsRequestByIdForUser`, `getChatSessionByIdForUser`, `getNewsStoryByIdForUser`, `patchOwnedUserStory`, `publishOwnedUserStory`, `getChatNewsStoryForPipeline` all filter by user ID.
- **Story visibility** (`newsStoryAccess.ts`): public = system story with successful request, or user story `published`; draft user stories are visible only to `ownerId`. Deep dive on a non-published user story returns 404.
- **Public routes**: `GET /api/news/trending`, `GET /api/news/stories` (viewer optional), `GET /api/news/stories/[storyId]` (viewer optional, access-checked), location autocomplete/reverse, `/api/inngest` (Inngest signature model).
- `canEdit` in API responses is a convenience for the UI; the `PATCH`/publish routes enforce ownership independently.

---

## Reliability and Failure Handling

| Concern | Mechanism |
|---------|-----------|
| Long work | Inngest functions with 15–45 min `timeouts.finish` |
| Retries | Inngest retries thrown errors; `step.run` memoization resumes from the failed step |
| Non-retriable | `NonRetriableError` for missing sessions/messages/stories and already-failed stories |
| Duplicate events | Idempotency keys (`chatMessageId`, `storyId`); early-exit checks (existing assistant reply, story already complete) |
| Partial external failure | Null Firecrawl results skipped; empty Serp/YouTube branches tolerated; invalid cleaned pages dropped |
| Guardrail block | Refusal message saved; no external calls |
| News failure | `NewsRequest.status = failed` + `error`; retry endpoint; failure notification |
| Chat failure | Agent message `Research pipeline failed: …`; UI status `failed`; failure notification |
| Story failure | `generationError` + placeholder copy; `generationFailed` in API; failure notification; no automatic retry |
| Notifications | Never throw into the pipeline; deduped |
| Timeouts on model/Serp calls | `AbortSignal.timeout(...)` per step (30 s – 300 s) |
| Config errors | `clients/env.ts` validates required env at startup (`instrumentation.ts`) and warns on optional ones |

---

## Research Efficiency

| Mechanism | Problem | Solution | Effect |
|-----------|---------|----------|--------|
| Determiner gating | Every message would trigger search | `useTools`, `useYoutube`, `useAiOverviewFollowUp` decided per message | SerpAPI/YouTube calls only when needed |
| Guardrails first | Off-topic prompts waste research budget | Block before any external call | Zero cost for rejected prompts |
| Vector reuse | Re-scraping what the session already read | `useExistingResearch` → pgvector top 8 ≥ 0.72 | Fewer Serp + Firecrawl calls on follow-ups |
| Selection before scraping | Scraping all hits is slow and expensive | Selector picks top 40 % / ≤ 6 (chat) or budgeted set (news) | Bounded Firecrawl usage |
| Session URL dedupe | Same URL scraped twice | Canonical key check before insert | No duplicate research rows |
| Prepared context handoff | Story pipeline would redo the chat's research | Full evidence passed in the event; gap agent adds only what's missing | One search pass shared by answer and story |
| Planned queries with combined categories | One Serp call per category | Keywords merged into one query per engine per tier | Bounded calls independent of category count |
| Budgets from `storyCount` | Fixed large budgets | Clamped formulas | Cost scales with requested output |
| Autocomplete caching | Provider call per keystroke | 3-layer cache + prefix reuse + in-flight dedupe | Most lookups never reach SerpAPI |
| Bounded concurrency | Pool exhaustion | 4 concurrent `ResearchSource` inserts | Stable DB under parallel turns |
| Async indexing | Embedding blocks the answer | Fire-and-forget index events | Answer latency independent of indexing |

---

## AI vs Application Logic

Dainik Samachar is not "prompt → LLM → answer". The layers are explicit:

**Deterministic application logic** — request validation (Zod), Clerk auth and ownership filters, event emission, step orchestration and idempotency, status derivation (`initializing`/`ready`/`failed`, `isGenerating`), canonical URL dedupe, date-window and trading-tip filters, budget formulas, vote counter math, cache lookups, notification dedupe.

**Retrieval** — SerpAPI engines, Firecrawl, YouTube transcripts, pgvector similarity, Postgres reads, autocomplete caches.

**AI reasoning** — guardrail classification (after rules), query enhancement, the determiner's research plan, AI Overview follow-up query generation, article and video selection, content cleaning validity, transcript analysis, story clustering and writing, chat answers, source descriptions, chat titles, UI suggestions.

Each AI call has a Zod-validated output schema; application code decides what to do with the result.

---

## Complete Data Lifecycle

```mermaid
flowchart TD
  U[User action] --> R{Kind}
  R -->|briefing| NR[NewsRequest pending]
  R -->|question| CM1[ChatMessage user]
  R -->|deep dive| CS1[ChatSession anchored to NewsStory]
  NR --> PLAN[Search planning]
  CM1 --> GRD[Guardrails]
  CS1 --> BRIEF[Deep-dive brief from story + NewsSource]
  GRD --> ENH[Query enhancement]
  ENH --> DET[Determiner]
  BRIEF --> DET
  DET --> REUSE{existing research?}
  REUSE -->|yes| VEC[pgvector retrieval of ResearchSource]
  DET --> LIVE{live search?}
  PLAN --> SERP[SerpAPI: Google News / news tab / Google / Finance / AI Mode / YouTube]
  LIVE -->|yes| SERP
  SERP --> AIO[AI Overview follow-up searches]
  AIO --> SEL[Article selection]
  SERP --> SEL
  SEL --> FC[Firecrawl]
  DET -->|firecrawlUrls| FC
  FC --> CLEAN[Content cleaning]
  SERP --> YT[YouTube transcripts]
  CLEAN --> NS[NewsSource - story evidence]
  CLEAN --> RS[ResearchSource - session evidence]
  YT --> NS
  YT --> RS
  RS --> IDX[Description + embedding -> chat_resource_embeddings]
  IDX --> VEC
  VEC --> CTX[Research context]
  RS --> CTX
  NS --> SYN[NewsSynthesizer]
  CTX --> CHAT[ChatModel]
  CTX -->|shouldCreateStory| SHELL[Draft NewsStory shell]
  SHELL --> GAP[Gap agent -> optional extra Serp / Firecrawl]
  GAP --> SYN
  SYN --> STORY[NewsStory + NewsSource]
  CHAT --> CM2[ChatMessage agent]
  STORY --> DB[(PostgreSQL)]
  CM2 --> DB
  DB --> NOTE[Notification]
  DB --> POLL[Frontend polling]
  STORY -->|publish| PUB[Public feed / trending / deep dive by others]
```

In prose: a user action creates a canonical record and an event. For chat paths, guardrails decide whether research may proceed, the enhancer clarifies the question, and the determiner decides *whether* and *how* to research. Evidence is gathered from the session's own prior research (pgvector) and/or from SerpAPI, expanded by AI Overview follow-ups, narrowed by a selector, fetched by Firecrawl, and cleaned. Every cleaned page becomes a stored source row: `ResearchSource` for the session (then described and embedded so it can be found again) or `NewsSource` for a story. The synthesizer or chat model writes only from those rows. Outputs are stored separately from evidence, a notification is written, and the UI — which has been polling since the action — renders the result. A story the user publishes becomes public evidence-backed content that another user can deep-dive, which starts the cycle again with that story's sources as the seed.

---

## Pipeline Comparison

| Capability | News Pipeline | News Rerun | Chat Pipeline | Deep Dive (first turn) | Chat Story Pipeline |
|------------|---------------|------------|---------------|------------------------|---------------------|
| Primary purpose | Multi-story briefing | Incremental refresh | Answer one message | Answer one story-anchored brief | Write one story |
| Event | `news/pipeline.requested` | `news/pipeline.rerun.requested` | `chat/message.research.requested` | `chat/pipeline.requested` | `chat/story.research.requested` |
| Producer | `POST /api/news` | `POST /api/news/[id]/rerun` | `POST /api/chat[/id]` | `POST /api/newsStoryChat` | Chat pipeline |
| Guardrails | No (config, not free text) | No | Yes | Yes | No (already passed) |
| Query enhancer | No | No | Yes | No | No |
| Determiner / matcher | Planner | StoryMatcher + update decision | Determiner | Determiner (story off) | Gap agent |
| Search scope | Multi-engine, multi-tier | Same plans; known-URL filter | Determiner calls | Determiner calls | Gap-only extras |
| Existing research (pgvector) | No | N/A | Yes (top 8, ≥ 0.72) | No | Passed from chat |
| YouTube | Agent-selected, analyzed | New videos only | Top 3 transcripts | No | Passed in / gap |
| AI Overview follow-up | Yes (weight 1.4) | Yes | If determiner asks | If determiner asks | If gap asks |
| Article selection | Budgeted selector | Selector on new hits only | 40 % / ≤ 6 | 40 % / ≤ 6 | Prepared + gap |
| Firecrawl | Selected articles | New URLs only | Selected + URLs | Selected | Gap URLs |
| Content cleaning | Yes | Yes | Yes | Yes | Yes (gap) |
| Synthesis | NewsSynthesizer (≤ `storyCount`) | Per-story update or +1 new | ChatModel | ChatModel | NewsSynthesizer (1) |
| Output | `NewsStory[]` + sources | Updated/new stories | `ChatMessage` | `ChatMessage` | Draft story + sources |
| Evidence | `NewsSource` | `NewsSource` | `ResearchSource` | `ResearchSource` | `NewsSource` |
| Request status on error | `failed` | unchanged (`success`) | message failed | — | story failed |
| Idempotency | Request status | `isRerunning` + concurrency | `chatMessageId` | — | `storyId` |
| Timeout | 45 m | 45 m | 30 m | 30 m | 45 m |

---

## Feature → Pipeline Map

| Feature | Pipeline / service | Primary output |
|---------|--------------------|----------------|
| News briefing | News pipeline | `NewsStory[]`, `NewsSource[]`, `loadingLogs` |
| Briefing rerun | News rerun pipeline | Updated/new stories, sources; `isRerunning` |
| Pro checkout | Razorpay create-order + verify | `Payment`, `Subscription`, `User.plan` |
| Pro gating | `requireProSubscriber`, `userPlanAccess` | Access to Pro routes / nav |
| Public feed / trending | `apiService`, `trendingNewsStoriesService` | Story lists |
| Votes | `storyVoteService` | `NewsStoryVote`, counters |
| Bookmarks | `savedStoryService` | `users.saved_stories` |
| Research chat | Chat pipeline | `ChatMessage`, `ResearchSource` |
| Deep dive | Deep-dive pipeline → Chat pipeline | `ChatMessage`, `ResearchSource` |
| Chat → story | Chat pipeline → Chat story pipeline | Draft `NewsStory` |
| Edit / publish story | `userStoryService` | Updated `NewsStory` |
| Cover photo | `uploadOwnedUserStoryPhoto` → Cloudinary or S3 | `NewsStory.imageUrl` |
| Research memory | `researchSourceDescriptionFunction` + pgvector | `ChatResourceEmbedding` |
| Message memory (indexed only) | `chatMessageEmbeddingFunction` | `ChatMessageEmbedding` |
| Chat titles | `chatSessionTitleAgent` via chat pipeline | `ChatSession.title` |
| UI suggestions | `QuickActionAgent`, `TryTheseQuestionAgent` | JSON suggestions |
| Instrument research | Stock research pipeline (`stock/research.requested`) | `StockResearch.reportMarkdown`, `StockResearchResource` |
| Instrument suggest | Instrument repositories + Upstox BOD index | Search hits for equities, ETFs, funds |
| Newsletters | Scheduler, edition build, run, cleanup | `Newsletter`, `NewsEdition`, `NewsletterDelivery`, Resend email |
| Hosted agents | `/api/v1` handlers + the pipelines above | JSON resources and `ApiJob` rows; optional signed webhook |
| API keys | `services/developers/apiKeyService` | Hashed keys, scopes, expiry, revocation |
| Provider usage | `lib/usage/creditRules.ts`, reconcile job | Credit ledger for SerpAPI and Firecrawl |
| Location autocomplete | `autocompleteServerCache` → `autocompleteDbCache` → SerpAPI | Suggestions, `SearchAutocompleteCache` |
| Reverse geocoding | `resolveUserLocation` | Location label |
| Notifications | `pipelineNotifications` | `Notification` |
| Script generation | — (schema only) | — |

---

## Engineering Decisions

Rationale below is inferred from the implementation unless a code comment states it.

### Durable background pipelines
**Problem** — Research exceeds HTTP timeouts and depends on flaky APIs. **Implementation** — Inngest functions with `step.run`, timeouts, idempotency, `onFailure`. **Trade-off** — Requires a dev server locally and polling in the UI; no streaming.

### Separate news, chat, and story pipelines
**Problem** — Breadth (briefing) and precision (question) need different budgets and outputs. **Implementation** — Three functions sharing services. **Trade-off** — Some duplicated step shapes; the deep-dive first turn is a fourth handler.

### Decision agents before research
**Problem** — Blind search on every message is costly and off-topic prompts waste budget. **Implementation** — Guardrails → enhancer → determiner with structured output. **Trade-off** — Extra model calls per message; determiner quality bounds research quality.

### Evidence stored separately from outputs
**Problem** — Answers and stories must be auditable and reusable. **Implementation** — `ResearchSource`/`NewsSource` rows; synthesizers read rows, not snippets. **Trade-off** — Storage grows with every scrape.

### Session-scoped vector memory on descriptions
**Problem** — Follow-ups re-research known material. **Implementation** — Async description + embedding; cosine ≥ 0.72, top 8, per session. **Trade-off** — No cross-session reuse; description quality gates recall.

### Prepared-context handoff for stories
**Problem** — A story pipeline that starts from scratch doubles Serp/Firecrawl cost. **Implementation** — Event payload carries all research; a gap agent adds only what's missing. **Trade-off** — Large event payloads.

### Draft-first user stories
**Problem** — Users need a stable ID immediately and control over visibility. **Implementation** — Shell row → async fill → owner publishes. **Trade-off** — Placeholder rows are visible to the owner while generating.

### Content cleaning as its own agent
**Problem** — Raw Markdown wastes tokens and misleads clustering. **Implementation** — Cleaner returns validity plus body. **Trade-off** — One more model call per page.

### Database-backed autocomplete cache
**Problem** — Autocomplete hammers the provider. **Implementation** — Client + memory + Postgres layers with prefix reuse and 14-day TTL. **Trade-off** — Slightly stale suggestions.

### Primary-article requirement
**Problem** — Video-only stories are hard to verify. **Implementation** — `storyHasPrimaryArticleSource` enforced at persist and in the story pipeline. **Trade-off** — Some video-centric topics yield no story.

### SSR-first pages
Pages render on the server; client components are limited to forms, polling, chat, and motion. Static marketing pages have no data dependencies.

---

## Project Structure

```text
.
├── app/                     # Next.js App Router: pages + app/api/* route handlers
│   ├── api/                 # session routes plus app/api/v1 hosted agents, developers, newsletters
│   ├── news/, newsStory/, chat/, newsletters/, pricing/, stockResearch/, MfResearch/, etfResearch/
│   ├── docs/api/, settings/developers/, about/, feature-request/, admin/usage/
│   └── sign-in/, sign-up/   # Clerk
├── Agents/                  # LLM agents (news/, chat/, stockResearch/) with Zod output schemas
├── clients/                 # AIClient, Serp, Firecrawl, Inngest, Upstox, env validation, logging, photo upload
├── components/              # UI: news/, chat/, landing/, about/, marketing/, notifications/, ui/
├── db/
│   ├── schema/schema.prisma # Prisma schema (loaded from db/schema)
│   ├── schema/migrations/   # Prisma migrations
│   ├── client.ts            # Prisma + pg adapter singleton
│   └── generated/           # Generated Prisma client (not hand-edited)
├── docker/postgres/init.sql # CREATE EXTENSION vector
├── docker-compose.yml       # pgvector/pgvector:pg16 on port 5434
├── hooks/                   # Polling, notifications, location, autocomplete hooks
├── inngest/                 # Pipeline functions + index.ts registry
├── lib/                     # auth, model resolution, location client cache, utils
├── repositories/            # Thin Prisma access (one file per model, plus pgvector raw SQL)
├── services/                # Business logic: news/, chat/, stockResearch/, newsletter/, billing/, developers/, upstox/, location/, notifications/, firecrawl/
├── lib/api/v1/              # Hosted-agent contract: auth, scopes, quotas, jobs, webhooks, OpenAPI
├── SERP/                    # SerpAPI engine catalog and helpers
├── scripts/                 # Ops SQL (production migration-history repair)
├── instrumentation.ts       # Loads env validation at server start
├── proxy.ts                 # Clerk middleware
├── prisma.config.ts         # Prisma 7 config (schema path, migrations, datasource)
└── .github/workflows/deploy.yml
```

---

## Getting Started

### Requirements

- Node.js 20+ (types target Node 20)
- pnpm 10.20.0 (`packageManager` in `package.json`)
- Docker (for PostgreSQL with pgvector) or a PostgreSQL 16+ instance with the `vector` extension
- Accounts/keys: Clerk, OpenAI, SerpAPI, Firecrawl

### Clone

```bash
git clone https://github.com/learner-enthusiast/puja-planner-.git
cd puja-planner-
```

(The remote name predates the product; the app directory is `my-app` in this workspace.)

### Install

```bash
pnpm install
```

`postinstall` runs `prisma generate`.

### Environment

```bash
cp .env.example .env
```

Fill in the required variables (see [Environment Variables](#environment-variables)). `clients/env.ts` throws at startup if a required one is missing.

### Database

```bash
docker compose up -d          # Postgres 16 + pgvector on localhost:5434
pnpm db:migrate               # apply migrations (dev)
pnpm db:generate              # regenerate the Prisma client
```

Production uses `pnpm db:migrate:deploy`.

### Run

```bash
pnpm dev            # prisma generate && next dev  → http://localhost:3000
pnpm inngest:dev    # Inngest dev server pointed at http://localhost:3000/api/inngest
```

Both processes are required for research features.

---

## Environment Variables

Values are never committed. Required variables cause a startup error when missing; optional ones log a warning with the default used.

| Variable | Required | Purpose |
|----------|----------|---------|
| `DATABASE_URL` (or `DB_URL`) | Yes | PostgreSQL connection (`postgres://` or `postgresql://`) |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Yes | Clerk browser SDK |
| `CLERK_SECRET_KEY` | Yes | Clerk server SDK |
| `OPENAI_API_KEY` | Yes | Agents and embeddings |
| `SERPAPI_API_KEY` | Yes | All search, YouTube, Maps |
| `FIRECRAWL_API_KEY` | Yes | Scraping |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL`, `NEXT_PUBLIC_CLERK_SIGN_UP_URL` | No | Default `/` — there are no auth pages; `ClerkModalBridge` opens the Clerk modal there |
| `NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL`, `NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL` | No | Default `/home` |
| `OPENAI_MODEL` | No | Default model (`gpt-4o-mini`) |
| `OPENAI_EMBEDDING_MODEL` | No | Default `text-embedding-3-small` |
| `OPENAI_BASE_URL`, `OPENAI_PROJECT_ID`, `OPENAI_STRUCTURED_RETRY_MODEL` | No | OpenAI client options |
| `DETERMINER_MODEL`, `GUARDRAIL_MODEL`, `CHAT_MODEL`, `QUERY_ENHANCER_MODEL`, `NEWS_NEW_CHAT_MODEL`, `NEWS_SYNTHESIZER_MODEL` (default `gpt-5.4-mini`), `RESEARCH_ARTICLE_SELECTOR_MODEL`, `NEWS_CONTENT_CLEANER_MODEL`, `GAI_OVERVIEW_SEARCH_MODEL`, `YOUTUBE_VIDEO_AGENT_MODEL`, `YOUTUBE_TRANSCRIPT_AGENT_MODEL`, `YOUTUBE_TRANSCRIPT_SYNTHESIZE_MODEL`, `RESEARCH_SOURCE_DESCRIPTION_MODEL`, `CHAT_MESSAGE_SUMMARIZER_VECTOR_MODEL`, `CHAT_SESSION_TITLE_MODEL`, `CHAT_STORY_RESEARCH_GAP_MODEL`, `CHAT_STORY_SIMILARITY_QUERY_MODEL`, `RELEVANCE_AGENT_MODEL`, `QUICK_ACTION_AGENT_MODEL`, `TRY_THESE_QUESTIONS_MODEL` | No | Per-agent model overrides |
| `AI_GATEWAY_API_KEY`, `AI_MODEL` | No | Optional Vercel AI SDK gateway path in `AIClient` |
| `SERPAPI_TIMEOUT_MS` | No | Serp client timeout |
| `INNGEST_DEV` | No | `1` = dev mode (used locally and in this project's production) |
| `INNGEST_APP_ID` | No | Default `my-app` |
| `INNGEST_EVENT_KEY` | No | Needed only for Inngest Cloud |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, `CLOUDINARY_FOLDER` | No | Cover-photo upload (Cloudinary). Startup warns if neither Cloudinary nor S3 is set. |
| `NEWS_STORY_PHOTO_FOLDER` | No | Cloudinary/S3 folder for story photos (default `newsly/stories`) |
| `AWS_REGION`/`AWS_S3_REGION`, `AWS_S3_BUCKET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_S3_KEY_PREFIX`, `AWS_S3_PUBLIC_URL_BASE` | No | S3 fallback when Cloudinary is not fully configured |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | No* | Required for payments; startup allows missing keys but checkout returns 503 |
| `NEXT_PUBLIC_RAZORPAY_KEY_ID` | No | If set, must match `RAZORPAY_KEY_ID` |
| `RAZORPAY_WEBHOOK_SECRET` | No | Defaults to `RAZORPAY_KEY_SECRET` |
| `BILLING_PRO_MONTHLY_PAISE` | No | Default `19900` (₹199) |
| `UPSTOX_ANALYTICS_TOKEN` | No | Server-only read-only market data for instrument research |
| `RESEND_API_KEY`, `EMAIL_FROM` | No | Newsletter delivery. Startup allows a missing key; sends fail until it is set |
| `APP_URL` | No | Absolute links in email and hosted-agent examples (default `http://localhost:3000`) |
| `UNSUBSCRIBE_SECRET` | No | Signs newsletter unsubscribe links |
| `SYSTEM_USER_CLERK_ID` | No | Clerk id of the system user that owns generated briefings (`pnpm system-user:seed`) |
| `API_PRO_REQUESTS_PER_MINUTE` | No | Hosted-agent rate limit per key (default 60) |
| `API_PRO_PIPELINE_JOBS_PER_DAY` | No | Accepted briefing and research jobs per account per UTC day (default 50) |
| `API_PRO_MAX_ACTIVE_KEYS` | No | Live keys per Pro account (default 10) |

\* Razorpay is optional for local dev unless you exercise `/pricing` checkout.

---

## Development

| Task | Command |
|------|---------|
| Dev server | `pnpm dev` |
| Inngest dev server | `pnpm inngest:dev` |
| Build / start | `pnpm build` · `pnpm start` |
| Lint | `pnpm lint` |
| Typecheck | `pnpm typecheck` |
| Prisma | `pnpm db:generate` · `pnpm db:migrate` · `pnpm db:migrate:deploy` · `pnpm db:push` · `pnpm db:studio` · `pnpm db:migrate:reset` |
| Tests (Node test runner via tsx) | `pnpm test:guardrails` · `pnpm test:query-enhancer` · `pnpm test:small-determiner` · `pnpm test:youtube-transcript` · `pnpm test:youtube-video` · `pnpm test:youtube-research` · `pnpm test:story-votes` · `pnpm test:news-generation` · `pnpm test:newsletter` · `pnpm test:billing` · `pnpm test:api` · `pnpm test:usage` · `pnpm test:upstox` |
| Instruments / metros | `pnpm instruments:sync` · `pnpm news:metros:seed` · `pnpm system-user:seed` |
| Hosted-agent contract | `pnpm api:check` |

Adding a pipeline step: add `step.run("name", …)` in the relevant `inngest/*.ts`; keep side effects inside steps. Adding a function: export it from `inngest/index.ts` and add it to `inngestFunctions`. Schema change: edit `db/schema/schema.prisma` → `pnpm db:migrate` → update repositories.

---

## API Architecture

Routes under `app/api` (except `app/api/v1` and a few public reads) authenticate with Clerk via `requireAuthenticatedUser()`. Long work is asynchronous: the route returns immediately and the client polls.

**Hosted agents** — `app/api/v1/*` — use API keys, scopes, rate limits, and quotas instead of a browser session. See [Hosted Agents](#hosted-agents). Session routes below are the in-app equivalents.

| Method | Route | Auth | Purpose | Async |
|--------|-------|------|---------|-------|
| `POST` | `/api/news` | Yes | Create `NewsRequest`, emit `news/pipeline.requested` | Yes |
| `GET` | `/api/news` | Yes | Recent requests for the user | — |
| `GET` / `POST` | `/api/news/[newsId]` | Yes | Poll request + stories / retry failed request | Poll / Yes |
| `POST` | `/api/news/[newsId]/rerun` | Yes | Start incremental rerun → `news/pipeline.rerun.requested` | Yes |
| `GET` | `/api/billing/catalog` | No | Public product catalog (amounts, access days) | — |
| `POST` | `/api/payments/razorpay/create-order` | Yes | Create Razorpay order + `Payment` row | — |
| `POST` | `/api/payments/razorpay/verify` | Yes | Verify signature, grant Pro | — |
| `POST` | `/api/payments/razorpay/webhook` | Razorpay | Provider webhook (signature verified) | — |
| `GET` | `/api/news/stories` | Optional | Paginated public stories (with viewer vote/saved flags) | — |
| `GET` | `/api/news/trending` | No | Trending public stories (7 days, top 4) | — |
| `GET` / `PATCH` | `/api/news/stories/[storyId]` | Optional / Owner | Story page payload (access-checked) / edit user story | — |
| `POST` | `/api/news/stories/[storyId]/photo` | Owner | Upload cover photo (Cloudinary, else S3) | — |
| `POST` / `DELETE` | `/api/news/stories/[storyId]/publish` | Owner | Publish / unpublish | — |
| `GET` / `POST` / `DELETE` | `/api/news/stories/[storyId]/vote` | Yes | Read / cast-toggle / remove vote | — |
| `GET` / `POST` / `DELETE` | `/api/news/stories/[storyId]/save` | Yes | Saved flag / bookmark / unbookmark | — |
| `GET` | `/api/news/stories/saved` | Yes | My user-created stories | — |
| `GET` | `/api/news/stories/bookmarks` | Yes | Bookmarked stories | — |
| `POST` | `/api/newsStoryChat` | Yes | Start deep dive → `chat/pipeline.requested` | Yes |
| `GET` | `/api/newsStoryChat` | Yes | List chat sessions | — |
| `GET` | `/api/newsStoryChat/[chatSessionId]` | Yes | Chat state (messages, derived status, `storyCreation`) | Poll |
| `GET` / `POST` | `/api/chat` | Yes | List sessions / new general chat + first message → `chat/message.research.requested` | Yes |
| `POST` | `/api/chat/[chatSessionId]` | Yes | Send message → `chat/message.research.requested` | Yes |
| `PATCH` / `DELETE` | `/api/chat/[chatSessionId]` | Yes | Rename / bookmark / delete session | — |
| `GET` | `/api/chat/[chatSessionId]/stories`, `/stories/count` | Yes | Stories created from this session | — |
| `GET` | `/api/chat/quickactions/[chatSessionId]`, `/api/chat/trythesequestion/[chatSessionId]` | Yes | UI suggestions | — |
| `GET` | `/api/notifications` · `POST /read-all` · `GET/PUT/PATCH/DELETE /[id]` · `PATCH`/`POST /[id]/read` | Yes | Notifications | Poll |
| `GET` / `POST` | `/api/stockResearch`, `/api/stockResearch/[id]` | Pro | Create or poll an equity, ETF, or fund report | Yes / Poll |
| `GET` | `/api/instruments/suggest`, `/mutual-funds/suggest`, `/etfs/suggest` | Yes | Instrument autocomplete for the research forms | — |
| `GET` / `POST` | `/api/newsletters` | Yes | List or create a digest | — |
| `GET` / `PATCH` / `DELETE` | `/api/newsletters/[id]` | Yes | Read, update, or delete a digest | — |
| `POST` | `/api/newsletters/[id]/pause` | Yes | Set `isActive` (pause or resume) | — |
| `POST` | `/api/newsletters/[id]/test` | Yes | Send a test edition | Yes |
| `POST` | `/api/newsletters/unsubscribe` | Signed link | Stop a digest | — |
| `GET` / `POST` | `/api/developers/keys`, `DELETE /[keyId]` | Pro | Mint or revoke hosted-agent keys | — |
| `*` | `/api/developers/webhook-secret` | Pro | Read or rotate the webhook signing secret | — |
| `*` | `/api/v1/*` | API key | Hosted agents (stories, briefings, research, jobs, instruments, newsletters, `/me`) | Reads sync; briefings and reports async |
| `GET` | `/api/location/autocomplete` | No | Cached Maps autocomplete | — |
| `POST` | `/api/location/reverse` | No | Coordinates → location label | — |
| `GET` / `PUT` / `PATCH` / `DELETE` | `/api/me` | Yes | Current user profile | — |
| `*` | `/api/inngest` | Inngest | Function serving endpoint | — |

---

## Billing and Pro Subscription

Dainik Samachar Pro is implemented as **Razorpay Orders + Standard Checkout** (one-time payment per period), not the Razorpay Subscriptions API. Product catalog is code-defined in `services/billing/pricing.ts` (`PRO_MONTHLY`: default **₹199** / `19900` paise, **30** access days, overridable via `BILLING_PRO_MONTHLY_PAISE`).

### Checkout flow

```mermaid
sequenceDiagram
  participant B as Browser
  participant API as Next.js API
  participant RZ as Razorpay
  participant DB as PostgreSQL

  B->>API: POST /api/payments/razorpay/create-order
  API->>DB: Payment CREATED → PENDING, providerOrderId
  API->>RZ: orders.create (server key + secret)
  API-->>B: orderId, amount, keyId (must match server RAZORPAY_KEY_ID)
  B->>RZ: Checkout.js modal
  RZ-->>B: payment_id, order_id, signature
  B->>API: POST /api/payments/razorpay/verify
  API->>API: HMAC verify (razorpaySignature.ts)
  API->>RZ: payments.fetch (confirm captured)
  API->>DB: User.plan=PRO, Subscription.currentPeriodEnd, Payment SUCCESS
  B->>API: GET /api/me → effective plan PRO
```

### Key modules

| Module | Role |
|--------|------|
| `services/billing/pricing.ts` | Product ids, paise, public catalog for `/api/billing/catalog` |
| `services/billing/razorpayConfig.ts` | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`; optional `NEXT_PUBLIC_RAZORPAY_KEY_ID` **must equal** `RAZORPAY_KEY_ID` if set |
| `services/billing/createRazorpayOrder.ts` | Order + `Payment` row; receipt max **40** chars (`newsly_<uuidNoDashes>`) |
| `services/billing/confirmRazorpayPayment.ts` | Idempotent verify path shared by client verify + webhook |
| `services/billing/userPlanAccess.ts` | **Browser-safe** plan helpers (`planFromMeResponse`, grace logic) |
| `services/billing/userPlan.ts` | **Server-only** `reconcileExpiredProSubscription()` |
| `components/billing/UpgradeToProButton.tsx` | Loads Checkout.js, create-order → verify → `router.refresh()` |

### Expiry and grace

When `Subscription.currentPeriodEnd` is more than **five days** in the past, `reconcileExpiredProSubscription` sets `User.plan = FREE` and `Subscription.status = EXPIRED`. Until then, `isProSubscriberPlan` still returns true. Reconciliation runs on each `getAuthenticatedUser()` call (including `/api/me`).

### Configuration pitfalls

- **401 on Razorpay `standard_checkout/preferences`** — Checkout `key_id` does not match the keys used to create the order; align env vars and restart the dev server.
- **500 on create-order** — Often invalid Razorpay credentials or receipt validation; server logs include Razorpay `description` via `razorpayErrors.ts`.
- Payments routes return **503** when Razorpay env is unset (`isRazorpayConfigured()`).

### Tests

`pnpm test:billing` runs `services/billing/razorpaySignature.test.ts` and `userPlan.test.ts` (grace / effective Pro logic).

---

## Deployment

`.github/workflows/deploy.yml` deploys on push to `main` (or manual dispatch):

1. Installs `cloudflared` and opens an SSH session to the server through Cloudflare Access (service token).
2. On the server: `git pull --ff-only origin main` → `pnpm install --frozen-lockfile` → `pnpm exec prisma generate` → `pnpm run db:migrate:deploy` → `pnpm run build` → `sudo systemctl restart newsly`.

So: a single host runs Next.js as a systemd service (`newsly`), reads `.env` from the repo root, and runs Prisma migrations at deploy time. Inngest runs in dev mode (`INNGEST_DEV=1`) in this deployment. `scripts/repair-prod-migration-history.sql` documents a one-time repair of `_prisma_migrations` after migrations were squashed. Database hosting and domain configuration are outside the repository.

---

## Security

- Secrets are read server-side only (`clients/env.ts`); no provider key is ever sent to the browser. `.env` is git-ignored; `.env.example` has empty values.
- Clerk protects all app/API routes via middleware; handlers re-check identity and upsert the local user.
- Ownership is enforced in repositories/services (user-scoped `where` clauses), not only in the UI.
- All request bodies and query strings are validated with Zod; Prisma parameterizes queries, including raw pgvector SQL (tagged templates).
- Database constraints back invariants: unique votes per user/story, unique notification dedupe keys, unique embedding per source, unique `(provider, query)` cache rows, cascading deletes from users/sessions/stories.
- AI error messages are redacted of API-key-like tokens before surfacing.
- Cover-photo uploads are owner-only, MIME- and size-checked (≤ 5 MB), and stored through server-side Cloudinary/S3 credentials.
- Hosted agents (`/api/v1`) add bearer-key auth, per-key rate limits, daily pipeline quotas, idempotency keys, and signed job webhooks. Session routes under `/api` do not share that limiter.
- Not implemented on session routes: a general rate limit, CSRF beyond framework defaults, content-security headers beyond Next defaults.

---

## Limitations

- **Domain scope** — Chat research is restricted to finance/economics/business by guardrails; other topics are refused.
- **External dependencies** — Quality and availability depend on SerpAPI, Firecrawl, and OpenAI quotas and uptime; there is no provider fallback for search or scraping.
- **Latency** — Briefings take minutes; chat turns take seconds to minutes depending on research. The UI polls; there is no streaming.
- **Strict date filtering** — Briefing articles must match the request day (with a previous-evening tolerance), which can drop relevant slightly-older coverage.
- **Primary-article rule** — Topics covered only on video produce no story.
- **Deep-dive first turn** — No pgvector reuse (by design, the session is new).
- **Message memory** — `chat_message_embeddings` are written but not read by any pipeline.
- **No claim-level evidence** — Sources are attached to stories/sessions, not to individual sentences.
- **Story retries** — A failed chat-origin story is not retried automatically; the user creates a new one.
- **Unwired code** — `Script` model, `relevanceAgent`, `chatstorySimilarityQueryagent`.
- **Single-host deployment** with Inngest dev mode; no horizontal scaling story in the repo.
- **Pro billing** — One-time Orders only; no auto-renewal or Razorpay Subscription plans; manual repurchase after period + grace. Hosted-agent keys stop working when Pro lapses.
- **Instrument coverage** — Equities are NSE-listed names in the Upstox instrument file. BSE-only stocks and foreign listings are out of scope. Research needs `UPSTOX_ANALYTICS_TOKEN`.
- **Newsletters** — Delivery depends on Resend and on the news pipeline finishing an edition. One digest is shared across subscribers with the same parameters; it is not a per-recipient rewrite.

---

## Future Work

**Currently implemented** — everything above not marked as unwired or in progress.

**Potential improvements consistent with the existing architecture** (not committed):

- Consume `ChatMessageEmbedding` for conversational memory retrieval alongside research memory.
- Wire the `Script` model to a generation pipeline that reuses `ResearchSource` rows.
- Claim-level evidence mapping and contradiction detection on top of `NewsSource`/`ResearchSource`.
- Source-quality scoring to inform the article selector.
- Scheduled `purgeExpiredAutocompleteCache`.
- Cross-session (per-user) research reuse with appropriate scoping.
- Retry path for failed chat-origin stories.
- Integrate or remove `relevanceAgent` and `chatstorySimilarityQueryagent`.
- Recurring Razorpay subscriptions so Pro, and therefore hosted-agent keys, renew without a manual repurchase.

---

## Contributing

```bash
git clone https://github.com/learner-enthusiast/puja-planner-.git
cd puja-planner-
git checkout -b feat/your-change
pnpm install
cp .env.example .env            # fill required keys
docker compose up -d && pnpm db:migrate
pnpm dev                        # terminal 1
pnpm inngest:dev                # terminal 2
# ...make changes...
pnpm typecheck && pnpm lint
pnpm test:guardrails            # and other relevant test:* scripts
git commit -m "feat: describe the change"
git push -u origin feat/your-change
# open a pull request against main
```

Keep architecture definitions in one place (e.g. `inngest/index.ts` for functions, `db/schema/schema.prisma` for models), keep pipeline side effects inside `step.run`, and update this README when a pipeline, agent, model, event, route, or environment variable changes.
