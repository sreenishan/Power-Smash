// International data adapter layer (Module 8). Production entry point.
// No scraping; the production registry is empty until a LICENSED source exists (docs/m5/international-data.md).
// The fictional provider used by tests lives in tests/providers/ and is deliberately NOT exported from here.
export * from './types';
export * from './errors';
export * from './retry';
export * from './merge';
export * from './map';
export * from './registry';
export * from './sync';
