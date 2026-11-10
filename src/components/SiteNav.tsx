"use client";

import { useEffect, useState } from "react";

/**
 * Landing section navigation.
 *
 * Desktop: an inline row of in-page links.
 * ≤900px: a left drawer behind a burger, dismissible by backdrop, Esc, the
 * Close button, and by navigating — a drawer left open over new content is
 * the most common way this pattern feels broken.
 */

export interface NavSection {
  id: string;
  label: string;
}

export function SiteNav({
  sections,
  cta,
}: {
  sections: NavSection[];
  cta?: { href: string; label: string };
}) {
  const [open, setOpen] = useState(false);

  // Esc closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  // Don't let the page scroll behind an open drawer.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        className={`burger-btn${open ? " is-open" : ""}`}
        aria-expanded={open}
        aria-controls="site-drawer"
        aria-label={open ? "Close menu" : "Open menu"}
        onClick={() => setOpen((v) => !v)}
      >
        <span />
        <span />
        <span />
      </button>

      <button
        type="button"
        className={`drawer-backdrop${open ? " is-open" : ""}`}
        aria-label="Close menu"
        tabIndex={open ? 0 : -1}
        onClick={() => setOpen(false)}
      />

      <nav
        id="site-drawer"
        className={`site-nav${open ? " is-open" : ""}`}
        aria-label="Sections"
      >
        <div className="drawer-head">
          <span className="rail-title">Sections</span>
          <button
            type="button"
            className="drawer-close"
            onClick={() => setOpen(false)}
            aria-label="Close menu"
          >
            Close
          </button>
        </div>

        {sections.map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            className="site-nav-link"
            onClick={() => setOpen(false)}
          >
            {s.label}
          </a>
        ))}

        {cta && (
          <a
            href={cta.href}
            className="btn btn-primary drawer-cta"
            onClick={() => setOpen(false)}
          >
            {cta.label}
          </a>
        )}
      </nav>
    </>
  );
}
