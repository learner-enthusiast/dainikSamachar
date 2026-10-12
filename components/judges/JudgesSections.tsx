import { Eyebrow, Section, SectionHeading } from "@/components/about/AboutPageShell";
import { ACCENT } from "@/components/about/aboutStory";
import { COMMITS } from "@/lib/judges/commits.generated";
import {
  AGENT,
  CFO,
  CRITERIA,
  DEMO,
  ENTIRE,
  EVIDENCE,
  EVIDENCE_NOTE,
  GITHUB_REPO,
  HERO,
  JUDGES,
  NEATLOGS,
  PENDING,
  VERIFY,
  entireCommitUrl,
  githubCommitUrl,
  githubFileUrl,
  type Link,
  type Shot,
} from "@/lib/judges/content";
import Image from "next/image";
import type { CSSProperties } from "react";

const external = { target: "_blank", rel: "noreferrer" } as const;
const accentVar = { "--judge-accent": ACCENT } as CSSProperties;
const pillClass =
  "group inline-flex items-center gap-1.5 rounded-full border border-border/50 px-4 py-2 text-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-(--judge-accent) hover:bg-(--judge-accent) hover:text-white hover:shadow-md focus-visible:border-(--judge-accent) focus-visible:outline-none active:translate-y-0";
const linkClass = "underline decoration-border underline-offset-4 transition-colors hover:decoration-current";
const checkpointed = COMMITS.filter((c) => c.checkpoint);
const commitBySha = new Map(COMMITS.map((c) => [c.sha, c]));
const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });

function EvidenceLink({ link }: { link: Link }) {
  if (!link.href) {
    return <span className="text-muted-foreground/70 italic">{link.label}: not linked yet</span>;
  }
  const isLocal = link.href.startsWith("#");
  return (
    <a href={link.href} className={linkClass} {...(isLocal ? {} : external)}>
      {link.label}
    </a>
  );
}

function Screenshot({ shot, priority = false }: { shot: Shot; priority?: boolean }) {
  return (
    <figure>
      <a href={shot.src} {...external} className="block overflow-hidden rounded-lg border border-border/40">
        <Image
          src={shot.src}
          alt={shot.alt}
          width={1600}
          height={900}
          priority={priority}
          sizes="(min-width: 1024px) 50vw, 100vw"
          className="h-auto w-full"
        />
      </a>
      <figcaption className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
        {shot.caption}
        {shot.label ? (
          <span className="rounded-full border border-border/50 px-2 py-0.5 text-[0.65rem] tracking-wider uppercase">
            {shot.label}
          </span>
        ) : null}
      </figcaption>
    </figure>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="border-t border-border/30 pt-4">
      <p className="font-display text-4xl" style={{ color: ACCENT }}>
        {value}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">{label}</p>
    </div>
  );
}

export function JudgesHero() {
  return (
    <section className="pt-24 pb-20 sm:pt-32">
      <div className="landing-section">
        <Eyebrow>{HERO.eyebrow}</Eyebrow>
        <h1 className="font-display mt-6 max-w-4xl text-5xl leading-[1.04] font-normal tracking-tight text-balance sm:text-6xl lg:text-7xl">
          {HERO.title}
        </h1>
        <p className="mt-8 max-w-2xl text-lg leading-relaxed text-muted-foreground">{HERO.lede}</p>

        <nav aria-label="Jump to" className="mt-10 flex flex-wrap gap-2">
          {HERO.jumps.map((j) => (
            <a
              key={j.href}
              href={j.href}
              style={accentVar}
              className={pillClass}
            >
              {j.label}
              <span aria-hidden className="transition-transform duration-200 group-hover:translate-y-0.5">
                ↓
              </span>
            </a>
          ))}
        </nav>

        <div className="mt-20 grid gap-12 lg:grid-cols-2">
          <div>
            <p className="text-[0.7rem] tracking-[0.2em] text-muted-foreground uppercase">Judges</p>
            <ul className="mt-4 divide-y divide-border/25">
              {JUDGES.map((j) => (
                <li key={j.name} className="flex flex-wrap items-baseline justify-between gap-x-4 py-3">
                  <a href={j.href} {...external} className={linkClass}>
                    {j.name}
                  </a>
                  <span className="text-sm text-muted-foreground">{j.role}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-[0.7rem] tracking-[0.2em] text-muted-foreground uppercase">Criteria</p>
            <ol className="mt-4 divide-y divide-border/25">
              {CRITERIA.map((c) => (
                <li key={c.name} className="flex items-baseline gap-4 py-3">
                  <span className="w-12 font-mono text-sm" style={{ color: ACCENT }}>
                    {c.weight}%
                  </span>
                  <a href={c.where} className={linkClass}>
                    {c.name}
                  </a>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </section>
  );
}

export function EvidenceRowsSection() {
  return (
    <Section id="evidence">
      <SectionHeading
        eyebrow="Official evidence"
        title={`All ${EVIDENCE.length} evidence rows, with proof you can open.`}
        lede={EVIDENCE_NOTE}
      />
      <ol className="mt-16 divide-y divide-border/25 border-y border-border/25">
        {EVIDENCE.map((row, i) => (
          <li key={row.claim} className="grid gap-4 py-8 lg:grid-cols-[3rem_1fr_1.4fr] lg:gap-10">
            <span className="font-mono text-sm text-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <h3 className="font-display text-2xl">{row.claim}</h3>
                <span className="rounded-full border border-border/50 px-2.5 py-0.5 text-[0.65rem] tracking-wider uppercase">
                  {row.tag}
                </span>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">Asked for: {row.ask}</p>
            </div>
            <div>
              <p className="leading-relaxed">{row.proof}</p>
              <p className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm">
                {row.links.map((link) => (
                  <EvidenceLink key={link.label} link={link} />
                ))}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </Section>
  );
}

export function AgentSection() {
  return (
    <Section id="agent">
      <SectionHeading eyebrow="The agent · 30%" title={AGENT.title} lede={AGENT.lede} />
      <dl className="mt-14 grid gap-x-10 sm:grid-cols-2 lg:grid-cols-3">
        {AGENT.pipelines.map((p) => (
          <div key={p.name} className="border-t border-border/30 py-5">
            <dt className="font-display text-xl">{p.name}</dt>
            <dd className="mt-1 text-sm leading-relaxed text-muted-foreground">{p.detail}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-16 grid gap-10 md:grid-cols-2 lg:grid-cols-3">
        {AGENT.shots.map((shot) => (
          <Screenshot key={shot.src} shot={shot} />
        ))}
      </div>
    </Section>
  );
}

function CommitChip({ sha }: { sha: string }) {
  const commit = commitBySha.get(sha);
  return (
    <li className="border-t border-border/25 py-3">
      <a href={entireCommitUrl(sha)} {...external} className="group flex gap-3">
        <span className="font-mono text-sm" style={{ color: ACCENT }}>
          {sha.slice(0, 7)}
        </span>
        <span className="group-hover:underline">{commit?.subject ?? "Commit"}</span>
      </a>
    </li>
  );
}

export function NeatlogsSection() {
  return (
    <Section id="neatlogs">
      <div className="grid gap-16 lg:grid-cols-[0.9fr_1.1fr] lg:gap-20">
        <div>
          <SectionHeading eyebrow="neatlogs · 25%" title={NEATLOGS.title} lede={NEATLOGS.lede} />
          <div className="mt-12 grid grid-cols-3 gap-6">
            {NEATLOGS.stats.map((s) => (
              <Stat key={s.label} {...s} />
            ))}
          </div>
          <ul className="mt-10 space-y-3 leading-relaxed">
            {NEATLOGS.points.map((p) => (
              <li key={p} className="flex gap-3">
                <span aria-hidden style={{ color: ACCENT }}>
                  —
                </span>
                {p}
              </li>
            ))}
          </ul>
        </div>
        <div className="lg:pt-10">
          <Screenshot shot={NEATLOGS.shot} />
          <p className="mt-10 text-[0.7rem] tracking-[0.2em] text-muted-foreground uppercase">
            neatlogs commits, on Entire
          </p>
          <ul className="mt-3">
            {NEATLOGS.commits.map((sha) => (
              <CommitChip key={sha} sha={sha} />
            ))}
          </ul>
          <p className="mt-8 text-[0.7rem] tracking-[0.2em] text-muted-foreground uppercase">Code</p>
          <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-2 font-mono text-sm">
            {NEATLOGS.files.map((f) => (
              <li key={f}>
                <a href={githubFileUrl(f)} {...external} className={linkClass}>
                  {f}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Section>
  );
}

export function EntireSection() {
  return (
    <Section id="entire">
      <SectionHeading eyebrow="Entire · 25%" title={ENTIRE.title} lede={ENTIRE.lede} />
      <div className="mt-12 grid max-w-3xl grid-cols-3 gap-6">
        <Stat value={`${checkpointed.length}/${COMMITS.length}`} label="commits with checkpoints" />
        <Stat value={shortDate(COMMITS[0].date)} label="first commit" />
        <Stat value={shortDate(COMMITS[COMMITS.length - 1].date)} label="latest listed commit" />
      </div>
      <div className="mt-16 grid gap-10 md:grid-cols-2">
        {ENTIRE.shots.map((shot) => (
          <Screenshot key={shot.src} shot={shot} />
        ))}
      </div>

      <div className="mt-16 overflow-x-auto">
        <table className="w-full min-w-[40rem] text-left text-sm">
          <thead className="text-[0.65rem] tracking-[0.2em] text-muted-foreground uppercase">
            <tr className="border-b border-border/30">
              <th className="py-3 pr-4 font-normal">Commit</th>
              <th className="py-3 pr-4 font-normal">Date</th>
              <th className="py-3 pr-4 font-normal">Message</th>
              <th className="py-3 pr-4 font-normal">Checkpoint</th>
              <th className="py-3 font-normal">GitHub</th>
            </tr>
          </thead>
          <tbody>
            {[...COMMITS].reverse().map((c) => (
              <tr key={c.sha} className="border-b border-border/20 align-top">
                <td className="py-3 pr-4 font-mono">
                  {c.checkpoint ? (
                    <a href={entireCommitUrl(c.sha)} {...external} className={linkClass} style={{ color: ACCENT }}>
                      {c.sha.slice(0, 7)}
                    </a>
                  ) : (
                    <span className="text-muted-foreground">{c.sha.slice(0, 7)}</span>
                  )}
                </td>
                <td className="py-3 pr-4 whitespace-nowrap text-muted-foreground">{shortDate(c.date)}</td>
                <td className="py-3 pr-4">
                  {c.subject}
                  {c.neatlogs ? (
                    <span className="ml-2 rounded-full border border-border/50 px-2 py-0.5 text-[0.6rem] tracking-wider uppercase">
                      neatlogs
                    </span>
                  ) : null}
                </td>
                <td className="py-3 pr-4 font-mono text-xs text-muted-foreground">{c.checkpoint ?? "—"}</td>
                <td className="py-3">
                  <a href={githubCommitUrl(c.sha)} {...external} className={linkClass}>
                    view
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

export function CfoSection() {
  const max = Math.max(...CFO.unitCosts.map((u) => u.usd));
  return (
    <Section id="cfo">
      <div className="grid gap-16 lg:grid-cols-2 lg:gap-20">
        <div>
          <SectionHeading eyebrow="cfo.ai · 25%" title={CFO.title} lede={CFO.lede} />
          {PENDING.cfoShare ? (
            <a href={PENDING.cfoShare} {...external} style={accentVar} className={`mt-8 ${pillClass}`}>
              Open the model on cfo.ai
              <span
                aria-hidden
                className="transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
              >
                ↗
              </span>
            </a>
          ) : null}
        </div>
        <div className="lg:pt-10">
          <p className="text-[0.7rem] tracking-[0.2em] text-muted-foreground uppercase">
            Cost per clean run, USD · estimated
          </p>
          <ul className="mt-4 space-y-3">
            {CFO.unitCosts.map((u) => (
              <li key={u.pipeline} className="grid grid-cols-[9rem_1fr_3.5rem] items-center gap-3 text-sm sm:grid-cols-[11rem_1fr_3.5rem]">
                <span>{u.pipeline}</span>
                <span className="h-2 rounded-full bg-border/30">
                  <span
                    className="block h-full rounded-full"
                    style={{ width: `${(u.usd / max) * 100}%`, backgroundColor: ACCENT }}
                  />
                </span>
                <span className="text-right font-mono">${u.usd.toFixed(2)}</span>
              </li>
            ))}
          </ul>
          <dl className="mt-10 grid grid-cols-2 gap-x-6 sm:grid-cols-3">
            {CFO.assumptions.map((a) => (
              <div key={a.label} className="border-t border-border/30 py-3">
                <dt className="text-xs text-muted-foreground">{a.label}</dt>
                <dd className="mt-1 font-display text-xl">{a.value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-6 text-sm text-muted-foreground">{CFO.note}</p>
        </div>
      </div>
      <div className="mt-16 grid gap-10 md:grid-cols-3">
        {CFO.shots.map((shot) => (
          <Screenshot key={shot.src} shot={shot} />
        ))}
      </div>
    </Section>
  );
}

export function DemoSection() {
  return (
    <Section id="demo">
      <SectionHeading eyebrow="Demo · 20%" title={DEMO.title} lede={DEMO.lede} />
      <div className="mt-12 aspect-video w-full max-w-5xl overflow-hidden rounded-lg border border-border/40 bg-muted/40">
        {PENDING.demoVideoId ? (
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${PENDING.demoVideoId}`}
            title="Dainik Samachar demo"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            className="h-full w-full"
          />
        ) : null}
      </div>
    </Section>
  );
}

export function VerifySection() {
  return (
    <Section id="verify">
      <SectionHeading eyebrow="Verify" title={VERIFY.title} />
      <pre className="mt-12 overflow-x-auto rounded-lg border border-border/40 bg-muted/40 p-6 font-mono text-sm leading-7">
        {VERIFY.commands.map((c) => `$ ${c}`).join("\n")}
      </pre>
      <p className="mt-6 text-sm text-muted-foreground">
        Source:{" "}
        <a href={GITHUB_REPO} {...external} className={linkClass}>
          {GITHUB_REPO.replace("https://", "")}
        </a>
      </p>
    </Section>
  );
}
