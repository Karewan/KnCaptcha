import type { Challenge } from "../../src/challenge";
import type { Solver } from "../../src/solver/pool";

/**
 * Solver that answers at once with well-sized dummy proofs, or waits for release() when `manual`
 */
export class FakeSolver implements Solver {
	calls = 0;
	lastSignal: AbortSignal | null = null;
	failWith: Error | null = null;
	private pending: (() => void) | null = null;

	constructor(private readonly manual = false) {}

	solve(
		challenge: Challenge,
		onProgress: (progress: number) => void,
		signal: AbortSignal,
	): Promise<Uint32Array[]> {
		this.calls++;
		this.lastSignal = signal;
		const proofs = Array.from(
			{
				length: challenge.proofs,
			},
			() => new Uint32Array(1 + 2 ** challenge.k),
		);
		return new Promise((resolve, reject) => {
			signal.addEventListener(
				"abort",
				() => reject(new DOMException("Aborted", "AbortError")),
				{
					once: true,
				},
			);
			const finish = (): void => {
				if (this.failWith !== null) {
					reject(this.failWith);
					return;
				}
				onProgress(0.5);
				onProgress(1);
				resolve(proofs);
			};
			if (this.manual) {
				this.pending = finish;
			} else {
				queueMicrotask(finish);
			}
		});
	}

	release(): void {
		this.pending?.();
		this.pending = null;
	}
}
