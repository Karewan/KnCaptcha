import type { Challenge } from "../challenge";
import { KnCaptchaError } from "../errors";
import { EquihashSolver } from "./equihash";
import type { ResultMessage, TaskMessage } from "./messages";
import { type ProofTarget, runProof, SOLUTIONS_PER_RUN } from "./proof";
import InlineWorker from "./worker?worker&inline";

/**
 * Finds the proofs of a challenge
 */
export interface Solver {
	/**
	 * @param challenge
	 * @param onProgress estimated progress, from 0 to 1
	 * @param signal aborts the search: the promise then rejects with an AbortError
	 * @returns one [nonce, ...indices] per proof
	 */
	solve(
		challenge: Challenge,
		onProgress: (progress: number) => void,
		signal: AbortSignal,
	): Promise<Uint32Array[]>;
}

/**
 * Hands out the (proof, nonce) pairs to try and tracks what was found
 */
class Schedule {
	readonly target: ProofTarget;
	private readonly results: (Uint32Array | null)[];
	private readonly tries: number[];
	/** Chance that one run gives a solution that meets the difficulty */
	private readonly success: number;
	private solved = 0;
	private runsSinceSolved = 0;
	private progress = 0;

	constructor(
		challenge: Challenge,
		private readonly onProgress: (progress: number) => void,
	) {
		this.target = {
			payload: challenge.payload,
			mac: challenge.mac,
			n: challenge.n,
			k: challenge.k,
			bits: challenge.bits,
		};
		this.results = new Array<Uint32Array | null>(challenge.proofs).fill(null);
		this.tries = new Array<number>(challenge.proofs).fill(0);
		this.success = -Math.expm1(-SOLUTIONS_PER_RUN / 2 ** challenge.bits);
	}

	get done(): boolean {
		return this.solved === this.results.length;
	}

	get proofs(): Uint32Array[] {
		return this.results.filter((result): result is Uint32Array => result !== null);
	}

	/**
	 * @returns the next run: the unsolved proof tried the least, null when every proof is solved
	 */
	next(): {
		proof: number;
		nonce: number;
	} | null {
		let proof = -1;
		this.results.forEach((result, p) => {
			if (result === null && (proof < 0 || this.tries[p] < this.tries[proof])) {
				proof = p;
			}
		});
		if (proof < 0) {
			return null;
		}
		const nonce = this.tries[proof];
		if (nonce > 0xffffffff) {
			throw new KnCaptchaError("solver", "No solution found in 2^32 runs");
		}
		this.tries[proof] = nonce + 1;
		return {
			proof,
			nonce,
		};
	}

	/**
	 * Records the outcome of a run
	 * @param proof
	 * @param result
	 */
	record(proof: number, result: Uint32Array | null): void {
		this.runsSinceSolved++;
		if (result !== null && this.results[proof] === null) {
			this.results[proof] = result;
			this.solved++;
			this.runsSinceSolved = 0;
		}

		// Each proof counts for its share, the one being searched for the chance it would already have been found
		const partial = this.done ? 0 : 1 - (1 - this.success) ** this.runsSinceSolved;
		const progress = Math.min(1, (this.solved + partial) / this.results.length);
		if (progress > this.progress) {
			this.progress = progress;
			this.onProgress(progress);
		}
	}
}

function abortError(): DOMException {
	return new DOMException("The proof of work was aborted", "AbortError");
}

/**
 * Runs on the main thread, one Equihash run at a time with a pause between them: the fallback when web workers
 * cannot start (CSP, sandboxed iframe...)
 * @param schedule
 * @param signal
 * @returns
 */
async function solveOnMainThread(schedule: Schedule, signal: AbortSignal): Promise<Uint32Array[]> {
	const solver = new EquihashSolver(schedule.target.n, schedule.target.k);
	for (let task = schedule.next(); task !== null; task = schedule.next()) {
		if (signal.aborted) {
			throw abortError();
		}
		schedule.record(task.proof, runProof(solver, schedule.target, task.proof, task.nonce));
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
	if (signal.aborted) {
		throw abortError();
	}
	return schedule.proofs;
}

/**
 * Proof of work on a pool of web workers, started for each challenge and stopped as soon as it is solved (each worker
 * holds about 10 MB)
 */
export class WorkerSolver implements Solver {
	constructor(
		private readonly workers: number,
		private readonly workerUrl: string | URL | null = null,
	) {}

	solve(
		challenge: Challenge,
		onProgress: (progress: number) => void,
		signal: AbortSignal,
	): Promise<Uint32Array[]> {
		if (signal.aborted) {
			return Promise.reject(abortError());
		}
		const schedule = new Schedule(challenge, onProgress);
		const workers = this.spawn();
		if (workers.length === 0) {
			return solveOnMainThread(schedule, signal);
		}

		return new Promise((resolve, reject) => {
			let lastId = 0;
			let settled = false;
			let answered = false;

			const settle = (then: () => void): void => {
				if (settled) {
					return;
				}
				settled = true;
				for (const worker of workers) {
					worker.terminate();
				}
				signal.removeEventListener("abort", onAbort);
				then();
			};
			const onAbort = (): void => settle(() => reject(abortError()));
			const dispatch = (worker: Worker): void => {
				const task = schedule.next();
				if (task !== null) {
					worker.postMessage({
						id: ++lastId,
						target: schedule.target,
						...task,
					} satisfies TaskMessage);
				}
			};

			signal.addEventListener("abort", onAbort, {
				once: true,
			});
			for (const worker of workers) {
				worker.onmessage = ({ data }: MessageEvent<ResultMessage>) => {
					if (settled) {
						return;
					}
					if (data.error !== undefined) {
						settle(() =>
							reject(
								new KnCaptchaError("solver", data.error ?? "Unknown worker error"),
							),
						);
						return;
					}
					answered = true;
					try {
						schedule.record(data.proof, data.result);
						if (schedule.done) {
							settle(() => resolve(schedule.proofs));
						} else {
							dispatch(worker);
						}
					} catch (e) {
						settle(() => reject(e));
					}
				};
				worker.onerror = (event) => {
					event.preventDefault();
					// A worker that never answered could not start (blocked by the CSP...): the main thread takes over
					settle(() => {
						if (answered) {
							reject(new KnCaptchaError("solver", event.message || "Worker error"));
						} else {
							solveOnMainThread(schedule, signal).then(resolve, reject);
						}
					});
				};
				// Two runs queued per worker: it never waits for the next one
				dispatch(worker);
				dispatch(worker);
			}
		});
	}

	private spawn(): Worker[] {
		if (typeof Worker === "undefined") {
			return [];
		}
		const workers: Worker[] = [];
		try {
			for (let i = 0; i < this.workers; i++) {
				workers.push(
					this.workerUrl === null
						? new InlineWorker({
								name: "kncaptcha",
							})
						: new Worker(this.workerUrl, {
								name: "kncaptcha",
							}),
				);
			}
		} catch {
			// Worker construction refused (CSP, file:// page...): the main thread does the work
			for (const worker of workers) {
				worker.terminate();
			}
			return [];
		}
		return workers;
	}
}

/**
 * @returns the default number of workers: the logical cores, at most 8
 */
export function defaultWorkerCount(): number {
	const cores = typeof navigator !== "undefined" ? navigator.hardwareConcurrency : 0;
	return Math.max(1, Math.min(8, cores || 4));
}
