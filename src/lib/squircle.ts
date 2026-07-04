import type { CSSProperties } from "react";

// Squircle (superellipse) corner styling for inline styles. `corner-shape` is the 2025 CSS
// property (Chromium 139+; elsewhere it's a graceful no-op and corners stay circular). It isn't
// in @types/react yet, so the fragments are built once here behind a cast and spread into
// inline `style` objects:
//
//   <div style={{ borderRadius: csR(11, 26), ...superellipse3 }} />
//
// Split: `squircle` (k=2) for small/interactive surfaces, `superellipse3` (k=3, flatter sides)
// for large surfaces. Never put a bare `borderRadius` on a panel — a plain quarter-circle corner
// next to squircled surfaces reads as a bug.
export const squircle      = { cornerShape: "squircle" } as CSSProperties;
export const superellipse3 = { cornerShape: "superellipse(3)" } as CSSProperties;

// A corner radius that degrades gracefully where `corner-shape` is unsupported. A superellipse
// needs a larger radius to read as the same visual size, so the enhanced value only applies when
// the `--cs` flag is 1 (flipped by the @supports block in globals.css); everywhere else the
// fallback renders as the exact circular radius the design was tuned around. Aim for
// enhanced ≈ 2–2.4 × fallback.
export const csR = (fallback: number, enhanced: number): string =>
  `calc(${fallback}px + ${enhanced - fallback}px * var(--cs, 0))`;
