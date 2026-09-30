// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parseChallenge } from "../src/challenge";
import { defaultWorkerCount, WorkerSolver } from "../src/solver/pool";
import { verifyProof } from "../src/solver/proof";
import { issueChallenge } from "./support/server";

// Node has no web workers: WorkerSolver falls back on the main thread, as in a browser whose CSP blocks them
describe("WorkerSolver without web workers", () => {
	it("solves every proof and reports a growing progress", async () => {
		const challenge = parseChallenge(
			issueChallenge("secret", {
				bits: 3,
				proofs: 3,
			}),
		);
		const progress: number[] = [];
		const proofs = await new WorkerSolver(4).solve(
			challenge,
			(value) => progress.push(value),
			new AbortController().signal,
		);

		expect(proofs).toHaveLength(3);
		for (const [p, proof] of proofs.entries()) {
			expect(verifyProof(challenge, p, proof)).toBe(true);
		}
		expect(progress.at(-1)).toBe(1);
		expect(
			progress.every(
				(value, i) => value > 0 && value <= 1 && (i === 0 || value > progress[i - 1]),
			),
		).toBe(true);
	});

	it("stops when aborted", async () => {
		const challenge = parseChallenge(
			issueChallenge("secret", {
				bits: 20,
				proofs: 1,
			}),
		);
		const controller = new AbortController();
		const solving = new WorkerSolver(1).solve(challenge, () => undefined, controller.signal);
		setTimeout(() => controller.abort(), 50);
		await expect(solving).rejects.toMatchObject({
			name: "AbortError",
		});
	});

	it("refuses to start when already aborted", async () => {
		const challenge = parseChallenge(issueChallenge("secret"));
		await expect(
			new WorkerSolver(1).solve(challenge, () => undefined, AbortSignal.abort()),
		).rejects.toMatchObject({
			name: "AbortError",
		});
	});
});

describe("defaultWorkerCount", () => {
	it("uses the logical cores, between 1 and 8", () => {
		const count = defaultWorkerCount();
		expect(count).toBeGreaterThanOrEqual(1);
		expect(count).toBeLessThanOrEqual(8);
	});
});
