"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { CANVAS_ORIGIN } from "@/lib/config";

const LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/timeline", label: "Timeline" },
  { href: "/schedule", label: "Schedule" },
  { href: "/modules", label: "Modules" },
  { href: "/grades", label: "Grades" },
  { href: "/settings", label: "Settings" },
];

export const THEME_KEY = "planner.theme";

/**
 * The document already carries the right theme before React runs (see the
 * blocking script in layout.tsx), so this only has to read what is there and
 * flip it — never to apply an initial value, which would cause a flash.
 */
function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark" | null>(null);

  useEffect(() => {
    setTheme((document.documentElement.dataset.theme as "light" | "dark") ?? "light");
  }, []);

  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    setTheme(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      /* private mode — the choice just will not survive a reload */
    }
  }

  return (
    <button
      className="btn theme-toggle"
      onClick={toggle}
      // Rendered empty until mounted so the server and client markup agree.
      aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      title={theme === "dark" ? "Light mode" : "Dark mode"}
      suppressHydrationWarning
    >
      {theme === null ? "" : theme === "dark" ? "☾" : "☀"}
    </button>
  );
}

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
          <ThemeToggle />
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
