import { ACCENT } from "@/components/about/aboutStory";
import type { ReactNode } from "react";

export function AboutPageShell({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <main
      data-about-page
      className={`min-h-0 flex-1 overflow-x-hidden overflow-y-auto bg-background text-foreground ${className}`}
    >
      {children}
    </main>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="text-[0.75rem] font-medium tracking-[0.2em] uppercase" style={{ color: ACCENT }}>
      {children}
    </p>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  lede,
  align = "left",
}: {
  eyebrow: string;
  title: ReactNode;
  lede?: string;
  align?: "left" | "center";
}) {
  const centered = align === "center";
  return (
    <div className={centered ? "mx-auto max-w-3xl text-center" : "max-w-4xl"}>
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 className="font-display mt-5 text-4xl leading-[1.06] font-normal tracking-tight text-balance sm:text-5xl lg:text-[3.5rem]">
        {title}
      </h2>
      {lede ? (
        <p className={`mt-6 text-lg leading-relaxed text-muted-foreground ${centered ? "mx-auto max-w-xl" : "max-w-xl"}`}>
          {lede}
        </p>
      ) : null}
    </div>
  );
}

export function Section({
  id,
  children,
  className = "",
  rule = true,
}: {
  id: string;
  children: ReactNode;
  className?: string;
  rule?: boolean;
}) {
  return (
    <section
      id={id}
      className={`${rule ? "border-t border-border/25" : ""} py-28 sm:py-32 lg:py-40 ${className}`}
    >
      <div className="landing-section">{children}</div>
    </section>
  );
}
