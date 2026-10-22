// Interaction gate: run something exactly once, on the first of focus / pointer / key events (D-010: nothing third-party and
// no spam check on the page-load path). Tiny and dependency-free, so it can sit in the part of the form that loads first.

/** Returns a handler that calls `onFirst` the first time it is invoked and never again. */
export function createInteractionGate(onFirst: () => void): { trigger: () => void; hasFired: () => boolean } {
  let fired = false;
  return {
    trigger: () => {
      if (fired) return;
      fired = true;
      onFirst();
    },
    hasFired: () => fired,
  };
}
