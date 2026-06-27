/**
 * Minimal type declaration shim for snarkjs.
 * snarkjs ships no TypeScript types; this file gives the TS compiler enough
 * to resolve the dynamic `import("snarkjs")` in app/_spp-gate/page.tsx.
 */
declare module "snarkjs" {
  export const groth16: {
    prove(
      provingKey: unknown,
      witness: unknown,
      logger?: unknown
    ): Promise<{ proof: unknown; publicSignals: string[] }>;
    verify(
      verificationKey: unknown,
      publicSignals: string[],
      proof: unknown,
      logger?: unknown
    ): Promise<boolean>;
    fullProve(
      input: Record<string, unknown>,
      wasmFile: string | Uint8Array,
      zkeyFile: string | Uint8Array,
      logger?: unknown
    ): Promise<{ proof: unknown; publicSignals: string[] }>;
  };

  export const zKey: {
    exportVerificationKey(zkeyFileName: string | Uint8Array): Promise<unknown>;
  };

  export const wtns: {
    calculate(
      input: Record<string, unknown>,
      wasmFile: string | Uint8Array
    ): Promise<Uint8Array>;
  };
}
