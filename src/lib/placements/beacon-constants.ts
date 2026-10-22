// Constants shared by the browser script and the beacon endpoint. No imports: the browser bundle stays small (the endpoint file
// pulls in zod and the security helpers, which the browser must not).

/** An impression needs the slot visible for this long (D-031: "at least 50% visible for 1 second"). */
export const MIN_VISIBLE_MS = 1000;
