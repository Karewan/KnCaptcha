// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
	canonicalize,
	EquihashSolver,
	equihashLayout,
	verifyEquihash,
} from "../src/solver/equihash";
import { sha256 } from "../src/solver/sha256";

const seedOf = (value: number): Uint8Array =>
	sha256(
		new Uint8Array([
			value,
			value >>> 8,
			42,
		]),
	);

/**
 * @returns the first solution found over a few seeds
 */
function firstSolution(
	n: number,
	k: number,
): {
	seed: Uint8Array;
	indices: Uint32Array;
} {
	const solver = new EquihashSolver(n, k);
	for (let s = 0; s < 50; s++) {
		const seed = seedOf(s);
		let indices: Uint32Array | null = null;
		solver.solve(seed, (found) => {
			indices = found.slice();
			return true;
		});
		if (indices !== null) {
			return {
				seed,
				indices,
			};
		}
	}
	throw new Error(`No solution for Equihash(${n}, ${k})`);
}

describe("equihashLayout", () => {
	it("derives the geometry of Equihash(96, 5)", () => {
		expect(equihashLayout(96, 5)).toEqual({
			n: 96,
			k: 5,
			c: 16,
			leaves: 131072,
			words: 3,
			leafBytes: 12,
			perHash: 2,
		});
	});

	it.each([
		[
			96,
			1,
		],
		[
			96,
			8,
		],
		[
			97,
			5,
		],
		[
			42,
			5,
		],
		[
			126,
			5,
		],
		[
			96.5,
			5,
		],
	])("refuses n=%d k=%d", (n, k) => {
		expect(() => equihashLayout(n, k)).toThrow(RangeError);
	});
});

describe("EquihashSolver", () => {
	// Word-aligned hashes (fast path), unaligned ones, keys straddling two words, several leaves per hash
	it.each([
		[
			96,
			5,
		],
		[
			80,
			4,
		],
		[
			60,
			4,
		],
		[
			48,
			3,
		],
		[
			54,
			5,
		],
		[
			72,
			5,
		],
	])("finds valid solutions for Equihash(%d, %d)", (n, k) => {
		const solver = new EquihashSolver(n, k);
		let solutions = 0;
		for (let s = 0; s < 8; s++) {
			const seed = seedOf(s);
			solver.solve(seed, (indices) => {
				solutions++;
				expect(indices.length).toBe(2 ** k);
				expect(verifyEquihash(seed, n, k, indices)).toBe(true);
				return false;
			});
		}
		// About two per run
		expect(solutions).toBeGreaterThan(4);
	});

	it("stops when the callback asks for it", () => {
		const solver = new EquihashSolver(48, 3);
		let calls = 0;
		for (let s = 0; s < 10 && calls === 0; s++) {
			expect(solver.solve(seedOf(s), () => ++calls > 0)).toBe(calls);
		}
		expect(calls).toBe(1);
	});

	it("gives the same solutions for the same seed", () => {
		const solver = new EquihashSolver(60, 4);
		const run = (): string[] => {
			const found: string[] = [];
			solver.solve(seedOf(3), (indices) => {
				found.push(indices.join(","));
				return false;
			});
			return found;
		};
		expect(run()).toEqual(run());
	});
});

describe("verifyEquihash", () => {
	const { seed, indices } = firstSolution(96, 5);

	it("accepts a solution", () => {
		expect(verifyEquihash(seed, 96, 5, indices)).toBe(true);
	});

	it("refuses it for another seed", () => {
		expect(verifyEquihash(seedOf(999), 96, 5, indices)).toBe(false);
	});

	it("refuses a changed index", () => {
		for (const position of [
			0,
			7,
			31,
		]) {
			const changed = indices.slice();
			changed[position] = (changed[position] + 1) % 131072;
			expect(verifyEquihash(seed, 96, 5, changed)).toBe(false);
		}
	});

	it("refuses the same leaves in another order", () => {
		const swapped = indices.slice();
		[swapped[0], swapped[1]] = [
			swapped[1],
			swapped[0],
		];
		expect(verifyEquihash(seed, 96, 5, swapped)).toBe(false);
		expect(verifyEquihash(seed, 96, 5, indices.slice().reverse())).toBe(false);
	});

	it("refuses repeated, out of range or missing indices", () => {
		expect(verifyEquihash(seed, 96, 5, new Uint32Array(32))).toBe(false);
		const outOfRange = indices.slice();
		outOfRange[31] = 131072;
		expect(verifyEquihash(seed, 96, 5, outOfRange)).toBe(false);
		expect(verifyEquihash(seed, 96, 5, indices.subarray(0, 16))).toBe(false);
		expect(
			verifyEquihash(seed, 96, 5, [
				...indices.subarray(0, 31),
				1.5,
			]),
		).toBe(false);
	});

	it("refuses a pair that collides but repeats its leaves", () => {
		// XOR of a leaf with itself is zero on every bit: only the distinct check stops it
		const pairs = new Uint32Array(32).map((_, i) => Math.floor(i / 2));
		expect(verifyEquihash(seed, 96, 5, pairs)).toBe(false);
	});
});

describe("canonicalize", () => {
	it("orders each half by its first leaf, recursively", () => {
		const indices = Uint32Array.of(9, 3, 7, 1, 8, 2, 6, 0);
		canonicalize(indices);
		expect([
			...indices,
		]).toEqual([
			0,
			6,
			2,
			8,
			1,
			7,
			3,
			9,
		]);
	});
});
