// @vitest-environment node
import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { base64UrlDecode, base64UrlEncode } from "../src/base64url";
import { encodeSolution, parseChallenge } from "../src/challenge";
import { EquihashSolver } from "../src/solver/equihash";
import { runProof } from "../src/solver/proof";
import { defined } from "./support/defined";
import { type IssueOptions, issueChallenge, type Verdict, verifySolution } from "./support/server";

/**
 * Solutions shared with the PHP library (tests/Fixtures/vectors.json there): `pnpm vectors` writes them, the normal
 * run checks them against the reference server
 */

interface Vector {
	name: string;
	secret: string;
	scope: string;
	now: number;
	solution: string;
	expected: Verdict;
}

const FILE = new URL("./vectors.json", import.meta.url);
const SECRET = "kncaptcha-vectors-secret-0123456789abcdef";
const NOW = 1_790_000_000;

function solve(
	options: IssueOptions & {
		salt: Uint8Array;
	},
): string {
	const challenge = parseChallenge(
		issueChallenge(SECRET, {
			now: NOW,
			ttl: 300,
			...options,
		}),
	);
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
	return encodeSolution(challenge, proofs);
}

/**
 * Rewrites one number of the proofs part of a solution
 */
function patchProofs(solution: string, patch: (numbers: DataView) => void): string {
	const [payload, mac, proofs] = solution.split(".") as [
		string,
		string,
		string,
	];
	const bytes = defined(base64UrlDecode(proofs));
	patch(new DataView(bytes.buffer));
	return `${payload}.${mac}.${base64UrlEncode(bytes)}`;
}

function generate(): Vector[] {
	const salt = (byte: number): Uint8Array => new Uint8Array(16).fill(byte);
	const vector = (
		name: string,
		solution: string,
		expected: Verdict,
		scope = "",
		now = NOW + 10,
	): Vector => ({
		name,
		secret: SECRET,
		scope,
		now,
		solution,
		expected,
	});

	const standard = solve({
		salt: salt(1),
	});
	const scoped = solve({
		salt: salt(2),
		scope: "login:203.0.113.7",
		bits: 6,
		proofs: 1,
	});
	const small = solve({
		salt: salt(3),
		n: 48,
		k: 3,
		bits: 2,
		proofs: 3,
	});
	const unaligned = solve({
		salt: salt(4),
		n: 54,
		k: 5,
		bits: 1,
		proofs: 2,
	});
	const heavy = solve({
		salt: salt(5),
		n: 80,
		k: 4,
		bits: 0,
		proofs: 8,
	});
	const [payload, mac, proofs] = standard.split(".") as [
		string,
		string,
		string,
	];
	const proofBytes = (1 + 32) * 4;

	return [
		vector("Equihash(96,5), 2 proofs of 5 bits", standard, "valid"),
		vector("Scoped challenge", scoped, "valid", "login:203.0.113.7"),
		vector("Equihash(48,3), 3 proofs", small, "valid"),
		vector("Equihash(54,5), unaligned hashes", unaligned, "valid"),
		vector("Equihash(80,4), 8 proofs without difficulty", heavy, "valid"),
		vector("Last second before the expiry", standard, "valid", "", NOW + 299),
		vector("Expired", standard, "expired", "", NOW + 300),
		vector("Scope missing", scoped, "bad_signature"),
		vector("Other scope", scoped, "bad_signature", "login:203.0.113.8"),
		vector(
			"Challenge of another secret",
			`${issueChallenge("another-secret-another-secret-another", {
				now: NOW,
				salt: salt(9),
			})}.${proofs}`,
			"bad_signature",
		),
		vector(
			"Payload changed",
			`${base64UrlEncode(defined(base64UrlDecode(payload)).map((b, i) => (i === 3 ? b + 1 : b)))}.${mac}.${proofs}`,
			"bad_signature",
		),
		vector(
			"Index changed",
			patchProofs(standard, (v) => v.setUint32(4 * 5, v.getUint32(4 * 5, true) ^ 1, true)),
			"invalid_proof",
		),
		vector(
			"Nonce changed",
			patchProofs(standard, (v) => v.setUint32(0, v.getUint32(0, true) + 1, true)),
			"invalid_proof",
		),
		vector(
			"Leaves swapped",
			patchProofs(standard, (v) => {
				const a = v.getUint32(4, true);
				v.setUint32(4, v.getUint32(8, true), true);
				v.setUint32(8, a, true);
			}),
			"invalid_proof",
		),
		vector(
			"Proofs swapped",
			`${payload}.${mac}.${base64UrlEncode(
				(() => {
					const bytes = defined(base64UrlDecode(proofs));
					return new Uint8Array([
						...bytes.subarray(proofBytes),
						...bytes.subarray(0, proofBytes),
					]);
				})(),
			)}`,
			"invalid_proof",
		),
		vector(
			"Index out of range",
			patchProofs(standard, (v) => v.setUint32(4, 131072, true)),
			"invalid_proof",
		),
		vector(
			"Repeated leaves",
			patchProofs(standard, (v) => {
				for (let i = 1; i <= 32; i++) {
					v.setUint32(i * 4, i >> 1, true);
				}
			}),
			"invalid_proof",
		),
		vector(
			"One proof missing",
			`${payload}.${mac}.${base64UrlEncode(defined(base64UrlDecode(proofs)).subarray(0, proofBytes))}`,
			"malformed",
		),
		vector("No proof part", `${payload}.${mac}`, "malformed"),
		vector("Extra part", `${standard}.AAAA`, "malformed"),
		vector("Padded base64", `${standard}=`, "malformed"),
		vector(
			"Standard base64 alphabet",
			standard.replace(/-/g, "+").replace(/_/g, "/"),
			standard.includes("-") || standard.includes("_") ? "malformed" : "valid",
		),
		vector("Empty", "", "malformed"),
	];
}

describe("cross-language vectors", () => {
	if (process.env.UPDATE_VECTORS === "1") {
		it("writes tests/vectors.json", () => {
			writeFileSync(FILE, `${JSON.stringify(generate(), null, "\t")}\n`);
		}, 120_000);
		return;
	}

	const vectors = JSON.parse(readFileSync(FILE, "utf8")) as Vector[];
	it.each(
		vectors.map(
			(v) =>
				[
					v.name,
					v,
				] as const,
		),
	)("%s", (_, vector) => {
		expect(
			verifySolution(vector.secret, vector.solution, {
				scope: vector.scope,
				now: vector.now,
			}),
		).toBe(vector.expected);
	});
});
