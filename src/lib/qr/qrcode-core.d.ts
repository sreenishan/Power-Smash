// The pure-JavaScript core of the `qrcode` package (no canvas, no file system, no Node-only code): it makes the module matrix and
// nothing else. @types/qrcode types only the package root, so the one function we use is declared here.
declare module 'qrcode/lib/core/qrcode.js' {
  export interface QrCoreBitMatrix {
    readonly size: number;
    readonly data: Uint8Array;
    get(row: number, col: number): number;
  }
  export interface QrCoreSymbol {
    readonly modules: QrCoreBitMatrix;
    readonly version: number;
    readonly errorCorrectionLevel: { readonly bit: number };
    readonly maskPattern: number;
  }
  export function create(data: string, options?: { errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H' }): QrCoreSymbol;
}
