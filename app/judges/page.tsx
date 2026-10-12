import { AboutPageShell } from "@/components/about/AboutPageShell";
import {
  AgentSection,
  CfoSection,
  DemoSection,
  EntireSection,
  EvidenceRowsSection,
  JudgesHero,
  NeatlogsSection,
  VerifySection,
} from "@/components/judges/JudgesSections";
import type { Metadata } from "next";

const title = "For neatHack judges — Dainik Samachar";
const description =
  "Every Dainik Samachar claim for neatHack 2026, linked to a commit on Entire, a neatlogs trace screenshot, or the cfo.ai model.";

export const metadata: Metadata = {
  title,
  description,
  openGraph: { title, description, type: "website" },
};

/** Public on purpose: no auth check, so judges can open it signed out. */
export default function JudgesPage() {
  return (
    // The page scrolls inside <main>, so smooth anchor jumps go on it, not on <html>.
    <AboutPageShell className="motion-safe:scroll-smooth">
      <JudgesHero />
      <EvidenceRowsSection />
      <AgentSection />
      <NeatlogsSection />
      <EntireSection />
      <CfoSection />
      <DemoSection />
      <VerifySection />
    </AboutPageShell>
  );
}
