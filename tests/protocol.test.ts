// @vitest-environment node
import { describe, expect, it } from "vitest";
import { base64UrlDecode, base64UrlEncode } from "../src/base64url";
import { type Challenge, encodeSolution, parseChallenge } from "../src/challenge";
import { KnCaptchaError } from "../src/errors";
import { EquihashSolver } from "../src/solver/equihash";
import { meetsDifficulty, proofSeed, runProof, verifyProof } from "../src/solver/proof";
import { defined } from "./support/defined";
import { issueChallenge, verifySolution } from "./support/server";

const SECRET = "test-secret-test-secret-test-secret";
const NOW = 1_790_000_000;

/**
 * Solves every proof of a challenge on the current thread
 */
function solve(challenge: Challenge): Uint32Array[] {
	const solver = new EquihashSolver(challenge.n, challenge.k);
	const proofs: Uint32Array[] = [];
	for (let proof = 0; proof < challenge.proofs; proof++) {
		for (let nonce = 0; ; nonce++) {
			const found = runProof(solver, challenge, proof, nonce);
			if (found !== null) {
				proofs.push(found);
				break;
			}
		}
	}
	return proofs;
}

describe("parseChallenge", () => {
	it("reads the parameters of the payload", () => {
		const challenge = parseChallenge(
			issueChallenge(SECRET, {
				n: 96,
				k: 5,
				bits: 7,
				proofs: 3,
				ttl: 120,
				now: NOW,
			}),
		);
		expect(challenge).toMatchObject({
			n: 96,
			k: 5,
			bits: 7,
			proofs: 3,
			issuedAt: NOW,
			expiresAt: NOW + 120,
		});
		expect(challenge.payload.length).toBe(32);
		expect(challenge.mac.length).toBe(32);
	});

	it("trims the token", () => {
		const token = issueChallenge(SECRET);
		expect(parseChallenge(`\n ${token} \n`).token).toBe(token);
	});

	const payloadWith = (patch: (payload: Uint8Array) => void): string => {
		const [payload, mac] = issueChallenge(SECRET).split(".") as [
			string,
			string,
		];
		const bytes = defined(base64UrlDecode(payload));
		patch(bytes);
		return `${base64UrlEncode(bytes)}.${mac}`;
	};

	it.each([
		[
			"an empty string",
			"",
		],
		[
			"one part",
			"abc",
		],
		[
			"three parts",
			"a.b.c",
		],
		[
			"a short payload",
			`${base64UrlEncode(new Uint8Array(31))}.${base64UrlEncode(new Uint8Array(32))}`,
		],
		[
			"a short MAC",
			`${base64UrlEncode(new Uint8Array(32))}.${base64UrlEncode(new Uint8Array(16))}`,
		],
		[
			"another version",
			payloadWith((p) => (p[0] = 3)),
		],
		[
			"unsupported Equihash parameters",
			payloadWith((p) => (p[2] = 9)),
		],
		[
			"too many difficulty bits",
			payloadWith((p) => (p[3] = 25)),
		],
		[
			"no proof",
			payloadWith((p) => (p[4] = 0)),
		],
		[
			"too many proofs",
			payloadWith((p) => (p[4] = 9)),
		],
		[
			"an expiry before the issue",
			payloadWith((p) => new DataView(p.buffer).setUint32(12, 0)),
		],
	])("refuses %s", (_, token) => {
		expect(() => parseChallenge(token)).toThrow(KnCaptchaError);
		try {
			parseChallenge(token);
		} catch (e) {
			expect((e as KnCaptchaError).code).toBe("challenge");
		}
	});
});

describe("proofs", () => {
	it("derives a different seed per proof and per nonce", () => {
		const challenge = parseChallenge(issueChallenge(SECRET));
		const pairs: [
			number,
			number,
		][] = [
			[
				0,
				0,
			],
			[
				0,
				1,
			],
			[
				1,
				0,
			],
			[
				1,
				1,
			],
		];
		const seeds = new Set(
			pairs.map(([proof, nonce]) =>
				Buffer.from(proofSeed(challenge, proof, nonce)).toString("hex"),
			),
		);
		expect(seeds.size).toBe(4);
	});

	it("checks the leading zero bits of the difficulty hash", () => {
		const seed = new Uint8Array(32);
		const indices = new Uint32Array(32);
		expect(meetsDifficulty(seed, indices, 0)).toBe(true);
		// Count the leading zero bits of this hash, then ask for exactly as many, and one more
		let zeros = 0;
		while (meetsDifficulty(seed, indices, zeros + 1)) {
			zeros++;
		}
		expect(meetsDifficulty(seed, indices, zeros)).toBe(true);
		expect(meetsDifficulty(seed, indices, zeros + 1)).toBe(false);
	});

	it("solves a challenge that the server accepts once", () => {
		const token = issueChallenge(SECRET, {
			bits: 4,
			proofs: 2,
			now: NOW,
			scope: "login",
		});
		const challenge = parseChallenge(token);
		const proofs = solve(challenge);
		for (const [p, proof] of proofs.entries()) {
			expect(verifyProof(challenge, p, proof)).toBe(true);
		}

		const solution = encodeSolution(challenge, proofs);
		expect(solution.startsWith(`${token}.`)).toBe(true);
		const used = new Set<string>();
		expect(
			verifySolution(SECRET, solution, {
				scope: "login",
				now: NOW + 10,
				used,
			}),
		).toBe("valid");
		expect(
			verifySolution(SECRET, solution, {
				scope: "login",
				now: NOW + 10,
				used,
			}),
		).toBe("replayed");
	});

	it("is refused by the server when anything changes", () => {
		const challenge = parseChallenge(
			issueChallenge(SECRET, {
				bits: 3,
				proofs: 2,
				now: NOW,
				ttl: 60,
			}),
		);
		const proofs = solve(challenge);
		const solution = encodeSolution(challenge, proofs);
		const check = (value: string, scope = "", now = NOW + 1): string =>
			verifySolution(SECRET, value, {
				scope,
				now,
			});

		expect(check(solution)).toBe("valid");
		expect(check(solution, "other-form")).toBe("bad_signature");
		expect(
			verifySolution("another-secret-another-secret-12345", solution, {
				now: NOW + 1,
			}),
		).toBe("bad_signature");
		expect(check(solution, "", NOW + 60)).toBe("expired");
		// Proofs swapped: each one belongs to its position
		expect(
			check(
				encodeSolution(challenge, [
					proofs[1],
					proofs[0],
				]),
			),
		).toBe("invalid_proof");
		// Another nonce
		const renonced = proofs[0].slice();
		renonced[0] = renonced[0] + 1;
		expect(
			check(
				encodeSolution(challenge, [
					renonced,
					proofs[1],
				]),
			),
		).toBe("invalid_proof");
		// One proof missing
		const [payload, mac] = solution.split(".");
		const bytes = defined(base64UrlDecode(solution.split(".")[2]));
		expect(
			check(`${payload}.${mac}.${base64UrlEncode(bytes.subarray(0, bytes.length / 2))}`),
		).toBe("malformed");
		expect(check(`${payload}.${mac}`)).toBe("malformed");
	});

	it("refuses to encode a proof of the wrong size", () => {
		const challenge = parseChallenge(issueChallenge(SECRET));
		expect(() =>
			encodeSolution(challenge, [
				new Uint32Array(10),
			]),
		).toThrow(RangeError);
	});
});
