/** @jsxImportSource react */
// "Step 2 of 3: Services" with a segmented bar. The text carries the meaning (a screen reader reads it and nothing else); the bar is
// decoration for sighted users and is hidden from assistive technology.
export interface StepIndicatorProps {
  /** Zero-based index of the current step. */
  current: number;
  /** Step titles in order. */
  titles: readonly string[];
}

export function StepIndicator({ current, titles }: StepIndicatorProps) {
  return (
    <div className="flex flex-col gap-3">
      <p className="flex flex-wrap items-baseline gap-x-2 text-body font-semibold text-fg">
        <span className="ps-num whitespace-nowrap rounded-sm border-l-4 border-ps-volt bg-ps-ink px-2.5 py-0.5 font-[family-name:var(--ps-font-display)] text-[1.0625rem] font-bold uppercase tracking-wider text-ps-white">
          Step {current + 1} of {titles.length}
        </span>
        <span className="text-fg-muted"><span className="sr-only">: </span>{titles[current]}</span>
      </p>
      <div className="flex gap-1.5" aria-hidden="true">
        {titles.map((title, i) => (
          <div
            key={title}
            className={`h-2 flex-1 -skew-x-12 rounded-sm ps-transition ${i < current ? 'bg-ps-court' : i === current ? 'bg-ps-court shadow-[0_0_0_2px_var(--ps-court-tint)]' : 'bg-ps-border'}`}
          />
        ))}
      </div>
    </div>
  );
}
