"use client";

import { useEffect } from "react";

/**
 * Page-wide scroll reveal.
 *
 * Mounted once; observes every `[data-reveal]` element rather than wrapping
 * each one in a component, so markup stays readable and there is a single
 * observer for the page.
 *
 * Elements are revealed once and then unobserved — content that re-animates
 * every time it scrolls back into view reads as a toy.
 */
export function ScrollReveal() {
  useEffect(() => {
    const nodes = Array.from(
      document.querySelectorAll<HTMLElement>("[data-reveal]"),
    );
    if (nodes.length === 0) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      nodes.forEach((n) => n.classList.add("is-revealed"));
      return;
    }

    // Anything already on screen at load reveals immediately — a hero that
    // fades in after the page has painted looks broken, not designed.
    const immediate: HTMLElement[] = [];
    const deferred: HTMLElement[] = [];
    nodes.forEach((n) => {
      const top = n.getBoundingClientRect().top;
      (top < window.innerHeight * 0.9 ? immediate : deferred).push(n);
    });
    immediate.forEach((n) => n.classList.add("is-revealed"));

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-revealed");
          observer.unobserve(entry.target);
        });
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.08 },
    );

    deferred.forEach((n) => observer.observe(n));
    return () => observer.disconnect();
  }, []);

  return null;
}
