"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A figure that counts up once, when it first reaches the viewport.
 *
 * Deliberately short and eased-out: a number that spins for two seconds is
 * a gimmick. Honours prefers-reduced-motion by rendering the final value.
 */
export function Counter({
  value,
  decimals = 0,
  prefix = "",
  suffix = "",
  durationMs = 850,
}: {
  value: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  durationMs?: number;
}) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [shown, setShown] = useState(value);
  const started = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // `shown` already starts at `value`, so with reduced motion there is
    // nothing to set: leave the final figure on screen and never animate.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    const run = () => {
      if (started.current) return;
      started.current = true;
      const from = 0;
      const start = performance.now();

      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / durationMs);
        // easeOutCubic
        const eased = 1 - Math.pow(1 - t, 3);
        setShown(from + (value - from) * eased);
        if (t < 1) requestAnimationFrame(tick);
        else setShown(value);
      };
      requestAnimationFrame(tick);
    };

    if (el.getBoundingClientRect().top < window.innerHeight) {
      setShown(0);
      run();
      return;
    }

    setShown(0);
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          run();
          observer.disconnect();
        }
      },
      { threshold: 0.3 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [value, durationMs]);

  return (
    <span ref={ref}>
      {prefix}
      {shown.toFixed(decimals)}
      {suffix}
    </span>
  );
}
