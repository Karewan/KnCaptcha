import type { ProofTarget } from "./proof";

/** Main thread → worker: one Equihash run */
export interface TaskMessage {
	readonly id: number;
	readonly target: ProofTarget;
	readonly proof: number;
	readonly nonce: number;
}

/** Worker → main thread */
export interface ResultMessage {
	readonly id: number;
	readonly proof: number;
	/** [nonce, ...indices], null when the run found no solution that meets the difficulty */
	readonly result: Uint32Array | null;
	readonly error?: string;
}
