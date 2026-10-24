// Column classes for a list of cards, chosen by how many cards there are, so a row is never left with an orphan card and a
// button label never wraps inside a cramped column (docs/DESIGN_DIRECTION.md section 6, "Lists of cards").
//   1 card   -> one column (pair it with PackageCard `wide`)
//   2 cards  -> two columns from 768 px
//   3 cards  -> three columns from 1024 px only (a two-column step would leave one card alone)
//   4 cards  -> two columns from 768 px, four from 1280 px (at 1024 px four columns are about 226 px wide: too narrow for the buttons)
//   more     -> two from 768 px, three from 1024 px
// Class names are written out in full so Tailwind sees them.
export function cardGridClass(count: number): string {
  if (count <= 1) return 'grid gap-6';
  if (count === 2) return 'grid gap-6 md:grid-cols-2';
  if (count === 3) return 'grid gap-6 lg:grid-cols-3';
  if (count === 4) return 'grid gap-6 md:grid-cols-2 xl:grid-cols-4';
  return 'grid gap-6 md:grid-cols-2 lg:grid-cols-3';
}
