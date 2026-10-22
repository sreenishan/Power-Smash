/**
 * Title parser module (Milestone M2b). `parseTitle` lives in ./parse; this file is the public
 * surface that the tests, the admin Title check and the sync import (D-017).
 */
export * from './types';
export * from './confidence';
export * from './normalize';
export * from './slug';
export { PARSER_VERSION, parseTitle } from './parse';
