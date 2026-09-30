import { describe, expect, it } from "vitest";
import { EquihashSolver, verifyEquihash } from "../src/solver/equihash";
import { sha256 } from "../src/solver/sha256";

// Measures the solver: pnpm bench (BENCH=1), skipped by the normal test run
describe.runIf(process.env.BENCH === "1")("bench", () => {
	for (const [n, k, runs] of [
		[
			96,
			5,
			60,
		],
		[
			80,
			4,
			60,
		],
		[
			108,
			5,
			20,
		],
		[
			120,
			5,
			6,
		],
	] as const) {
		it(`Equihash(${n}, ${k})`, () => {
			const t0 = performance.now();
			const solver = new EquihashSolver(n, k);
			const alloc = performance.now() - t0;
			let solutions = 0;
			let invalid = 0;
			const start = performance.now();
			for (let run = 0; run < runs; run++) {
				const seed = sha256(
					new Uint8Array([
						run,
						n,
						k,
					]),
				);
				solver.solve(seed, (indices) => {
					solutions++;
					if (!verifyEquihash(seed, n, k, indices)) {
						invalid++;
					}
					return false;
				});
			}
			const ms = (performance.now() - start) / runs;
			console.log(
				`Equihash(${n},${k}): ${ms.toFixed(1)} ms/run, ${(solutions / runs).toFixed(2)} solutions/run, alloc ${alloc.toFixed(1)} ms`,
			);
			expect(invalid).toBe(0);
		}, 120_000);
	}
});
