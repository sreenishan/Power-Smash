/** @jsxImportSource react */
// Tiny inline SVG icons (paths from Lucide, ISC licence, see docs/licenses). Decorative: always aria-hidden.
// @lucide/astro cannot be used inside React islands, and a full icon library would bloat the island.
// Only the icon the form needs when it hydrates is here; the check mark and the chat bubble (thank-you screen and WhatsApp
// buttons, loaded later) are in icons-more.tsx so they are not part of the first load (review C-1). The sending spinner is plain CSS.
import type { SVGProps } from 'react';

export const iconBase: SVGProps<SVGSVGElement> = {
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: 'false',
};

export function AlertIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...iconBase} {...props}>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" x2="12" y1="8" y2="12" />
      <line x1="12" x2="12.01" y1="16" y2="16" />
    </svg>
  );
}
