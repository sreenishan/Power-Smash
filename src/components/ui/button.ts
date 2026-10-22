// Class recipes for link-buttons (same shape as src/components/forms/styles.ts so form and page buttons match).
// The look lives in src/styles/components.css (.ps-btn*), tokens only (docs/BRAND.md, docs/DESIGN_DIRECTION.md).
// Every button is at least 44 px tall; focus ring comes from the global :focus-visible rule.
// `volt` is for DARK surfaces only (ink text on a volt fill, 14.55:1). `primary` and `secondary` are for light surfaces.
// `quiet` follows the surface (slate edge on light, mist edge on dark) because it uses the semantic roles.

export type ButtonVariant = 'primary' | 'volt' | 'secondary' | 'quiet';
export type ButtonSize = 'md' | 'lg' | 'sm';

const variants: Record<ButtonVariant, string> = {
  primary: 'ps-btn-primary',
  volt: 'ps-btn-volt',
  secondary: 'ps-btn-secondary',
  quiet: 'ps-btn-quiet',
};

const sizes: Record<ButtonSize, string> = {
  sm: 'ps-btn-sm',
  md: '',
  lg: 'ps-btn-lg',
};

export function buttonClass(variant: ButtonVariant = 'primary', size: ButtonSize = 'md'): string {
  return `ps-btn ${variants[variant]} ${sizes[size]}`.trim();
}
