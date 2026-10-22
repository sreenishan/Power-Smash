/** @jsxImportSource react */
// The icons used after the form has been sent or has failed (thank-you screen, WhatsApp buttons). Loaded with those screens, not
// with the page. Same drawing rules as icons.tsx.
import type { SVGProps } from 'react';
import { iconBase } from './icons';

export function CheckIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...iconBase} {...props}>
      <path d="M21.801 10A10 10 0 1 1 17 3.335" />
      <path d="m9 11 3 3L22 4" />
    </svg>
  );
}

export function ChatIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...iconBase} {...props}>
      <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
    </svg>
  );
}
