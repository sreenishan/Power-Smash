// Barrel for the four form definitions. The page islands import the single file they need (defs/coverage.ts and so on),
// so a page never ships the other three forms; tests and tools can import everything from here.
export * from './defs/common';
export * from './defs/coverage';
export * from './defs/sponsorship';
export * from './defs/general';
export * from './defs/tournament';
export * from './defs/video';
export * from './defs/alerts';
export * from './defs/request';
