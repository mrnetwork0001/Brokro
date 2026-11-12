"use client";

import { useEffect, useState } from "react";

/**
 * The desk rail.
 *
 * Wayfinding, never the only route to anything: every section it lists is
 * also reachable by scrolling the working surface, so a first-time visitor
 * who ignores the rail still sees mandate → refusals → verification →
 * settlement in one pass. Collapse state persists across visits.
 */

export interface RailSection {
  id: string;
  label: string;
  icon: string;
  /** Optional badge, e.g. a receipt or refusal count. */
  count?: number | null;
}

const STORAGE_KEY = "brokro.rail.collapsed";

export function DeskRail({
  sections,
  footer,
  open = false,
  onClose,
}: {
  sections: RailSection[];
  footer?: React.ReactNode;
  /** Drawer state on mobile; ignored at desktop widths. */
  open?: boolean;
  onClose?: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [active, setActive] = useState<string>(sections[0]?.id ?? "");

  // Restore the operator's last choice.
  //
  // This has to happen after mount, not during render: localStorage does not
  // exist on the server, so reading it during render would make the server
  // and the client disagree about whether the rail is collapsed and produce a
  // hydration mismatch. One extra render on mount is the cost of that.
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCollapsed(window.localStorage.getItem(STORAGE_KEY) === "1");
    } catch {
      /* storage unavailable — default to expanded */
    }
  }, []);

  // Esc closes the mobile drawer; the page must not scroll behind it.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose?.();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  const toggle = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        /* non-fatal */
      }
      return next;
    });
  };

  // Highlight whichever section is currently in view.
  useEffect(() => {
    const nodes = sections
      .map((s) => document.getElementById(s.id))
      .filter((n): n is HTMLElement => Boolean(n));
    if (nodes.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible?.target.id) setActive(visible.target.id);
      },
      { rootMargin: "-96px 0px -55% 0px", threshold: 0 },
    );

    nodes.forEach((n) => observer.observe(n));
    return () => observer.disconnect();
  }, [sections]);

  const go = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    setActive(id);
    onClose?.();
  };

  return (
    <aside
      id="desk-drawer"
      className={`app-rail${collapsed ? " is-collapsed" : ""}${open ? " is-open" : ""}`}
    >
      <div className="drawer-head">
        <span className="rail-title">Clearing desk</span>
        <button
          type="button"
          className="drawer-close"
          onClick={() => onClose?.()}
          aria-label="Close menu"
        >
          Close
        </button>
      </div>

      <div className="rail-head">
        <span className="rail-title">Clearing desk</span>
        <button
          type="button"
          className="rail-toggle"
          onClick={toggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? "›" : "‹"}
        </button>
      </div>

      {sections.map((s) => (
        <button
          key={s.id}
          type="button"
          className={`rail-item${active === s.id ? " is-active" : ""}`}
          onClick={() => go(s.id)}
          title={collapsed ? s.label : undefined}
          aria-current={active === s.id ? "true" : undefined}
        >
          <span className="rail-ico" aria-hidden="true">
            {s.icon}
          </span>
          <span className="rail-label">{s.label}</span>
          {s.count !== null && s.count !== undefined && s.count > 0 && (
            <span className="rail-count">{s.count}</span>
          )}
        </button>
      ))}

      {footer && (
        <div className="rail-foot" onClick={() => onClose?.()}>
          {footer}
        </div>
      )}
    </aside>
  );
}
