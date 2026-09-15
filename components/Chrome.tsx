"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";

const CANVAS_ORIGIN = process.env.NEXT_PUBLIC_CANVAS_ORIGIN ?? "https://dlsu.instructure.com";

const LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/timeline", label: "Timeline" },
  { href: "/grades", label: "Grades" },
  { href: "/settings", label: "Settings" },
];

export function Masthead({
  title,
  children,
  onSynced,
}: {
  title: string;
  children?: React.ReactNode;
  onSynced?: () => void;
}) {
  const path = usePathname();
  return (
    <>
      <header className="masthead">
        <div className="rise">
          <h1>{title}</h1>
          {children}
        </div>
        <nav className="nav rise" style={{ ["--i" as string]: 1 }}>
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} data-active={path === l.href}>
              {l.label}
            </Link>
          ))}
          <a
            className="btn"
            href={CANVAS_ORIGIN}
            target="_blank"
            rel="noreferrer"
            title="Opens AnimoSpace; the extension syncs on load"
            onClick={() => onSynced && setTimeout(onSynced, 2000)}
          >
            Sync
          </a>
        </nav>
      </header>
      <hr className="rule" />
    </>
  );
}

export function PanelHead({ title, count }: { title: string; count?: React.ReactNode }) {
  return (
    <div className="panel-head">
      <h2>{title}</h2>
      {count != null && <span className="count">{count}</span>}
    </div>
  );
}
