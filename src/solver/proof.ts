import type { Challenge } from "../challenge";
import { type EquihashSolver, verifyEquihash } from "./equihash";
import { sha256 } from "./sha256";

const DOMAIN = new TextEncoder().encode("kncaptcha/v2");

/**
 * Average number of Equihash solutions per run, measured on Equihash(96, 5) over 400 runs. Only used to show the
 * progress: the real number of runs follows a geometric law.
 */
export const SOLUTIONS_PER_RUN = 2;

/** What a run needs to know about the challenge (sent to the workers) */
export type ProofTarget = Pick<Challenge, "payload" | "mac" | "n" | "k" | "bits">;

/**
 * Seed of the Equihash run of one proof: SHA-256("kncaptcha/v2" || payload || mac || u8 proof || LE32 nonce). The MAC
 * depends on the server secret: no run can start before the challenge is issued.
 * @param challenge
 * @param proof
 * @param nonce
 * @returns 32 bytes
 */
export function proofSeed(
	challenge: Pick<Challenge, "payload" | "mac">,
	proof: number,
	nonce: number,
): Uint8Array {
	const message = new Uint8Array(
		DOMAIN.length + challenge.payload.length + challenge.mac.length + 5,
	);
	message.set(DOMAIN);
	message.set(challenge.payload, DOMAIN.length);
	message.set(challenge.mac, DOMAIN.length + challenge.payload.length);
	const at = message.length - 5;
	message[at] = proof;
	new DataView(message.buffer).setUint32(at + 1, nonce, true);
	return sha256(message);
}

/**
 * @param seed
 * @param indices
 * @param bits
 * @returns whether SHA-256(seed || LE32 indices) starts with `bits` zero bits
 */
export function meetsDifficulty(seed: Uint8Array, indices: Uint32Array, bits: number): boolean {
	if (bits === 0) {
		return true;
	}
	const message = new Uint8Array(seed.length + indices.length * 4);
	message.set(seed);
	const view = new DataView(message.buffer);
	for (const [i, index] of indices.entries()) {
		view.setUint32(seed.length + i * 4, index, true);
	}
	const hash = sha256(message);
	for (let i = 0; i < bits >>> 3; i++) {
		if (hash[i] !== 0) {
			return false;
		}
	}
	const rest = bits & 7;
	return rest === 0 || hash[bits >>> 3] >>> (8 - rest) === 0;
}

/**
 * One Equihash run for one proof and one nonce
 * @param solver an EquihashSolver built for the challenge parameters
 * @param challenge
 * @param proof
 * @param nonce
 * @returns [nonce, ...indices] of the first solution that meets the difficulty, null when this nonce has none
 */
export function runProof(
	solver: EquihashSolver,
	challenge: ProofTarget,
	proof: number,
	nonce: number,
): Uint32Array | null {
	const seed = proofSeed(challenge, proof, nonce);
	let found: Uint32Array | null = null;
	solver.solve(seed, (indices) => {
		if (!meetsDifficulty(seed, indices, challenge.bits)) {
			return false;
		}
		found = new Uint32Array(indices.length + 1);
		found[0] = nonce;
		found.set(indices, 1);
		return true;
	});
	return found;
}

/**
 * @param challenge
 * @param proof
 * @param solution [nonce, ...indices]
 * @returns whether the proof is valid, as the server would check it (the MAC and the expiry aside)
 */
export function verifyProof(challenge: ProofTarget, proof: number, solution: Uint32Array): boolean {
	const seed = proofSeed(challenge, proof, solution[0]);
	const indices = solution.subarray(1);
	return (
		verifyEquihash(seed, challenge.n, challenge.k, indices) &&
		meetsDifficulty(seed, indices, challenge.bits)
	);
}
