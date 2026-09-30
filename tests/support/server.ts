import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { base64UrlDecode, base64UrlEncode } from "../../src/base64url";
import { type Challenge, MAC_BYTES, PAYLOAD_BYTES, parseChallenge } from "../../src/challenge";
import { verifyProof } from "../../src/solver/proof";

/**
 * Reference server side in TypeScript, same rules as the PHP library: issues the challenges of the tests and of the
 * demo, checks their solutions
 */

export interface IssueOptions {
	n?: number;
	k?: number;
	bits?: number;
	proofs?: number;
	/** Lifetime in seconds */
	ttl?: number;
	scope?: string;
	/** Unix time (s) */
	now?: number;
	salt?: Uint8Array;
}

export type Verdict =
	| "valid"
	| "malformed"
	| "bad_signature"
	| "expired"
	| "invalid_proof"
	| "replayed";

const DOMAIN = Buffer.from("kncaptcha/v2");

function mac(secret: string, payload: Uint8Array, scope: string): Buffer {
	return createHmac("sha256", secret).update(DOMAIN).update(payload).update(scope).digest();
}

export function issueChallenge(secret: string, options: IssueOptions = {}): string {
	const {
		n = 96,
		k = 5,
		bits = 5,
		proofs = 2,
		ttl = 300,
		scope = "",
		now = Math.floor(Date.now() / 1000),
	} = options;
	const payload = new Uint8Array(PAYLOAD_BYTES);
	const view = new DataView(payload.buffer);
	payload.set([
		2,
		n,
		k,
		bits,
		proofs,
	]);
	view.setUint32(8, now);
	view.setUint32(12, now + ttl);
	payload.set(options.salt ?? randomBytes(16), 16);
	return `${base64UrlEncode(payload)}.${base64UrlEncode(mac(secret, payload, scope))}`;
}

export function verifySolution(
	secret: string,
	solution: string,
	options: {
		scope?: string;
		now?: number;
		used?: Set<string>;
	} = {},
): Verdict {
	const { scope = "", now = Math.floor(Date.now() / 1000), used } = options;
	const parts = solution.split(".");
	if (parts.length !== 3) {
		return "malformed";
	}
	const payload = base64UrlDecode(parts[0]);
	const signature = base64UrlDecode(parts[1]);
	const proofs = base64UrlDecode(parts[2]);
	if (
		payload === null ||
		signature === null ||
		proofs === null ||
		payload.length !== PAYLOAD_BYTES ||
		signature.length !== MAC_BYTES
	) {
		return "malformed";
	}
	if (!timingSafeEqual(mac(secret, payload, scope), signature)) {
		return "bad_signature";
	}

	let challenge: Challenge;
	try {
		challenge = parseChallenge(`${parts[0]}.${parts[1]}`);
	} catch {
		return "malformed";
	}
	if (now >= challenge.expiresAt) {
		return "expired";
	}
	const size = (1 + 2 ** challenge.k) * 4;
	if (proofs.length !== challenge.proofs * size) {
		return "malformed";
	}
	for (let p = 0; p < challenge.proofs; p++) {
		const words = new Uint32Array(size / 4);
		const view = new DataView(proofs.buffer, proofs.byteOffset + p * size, size);
		for (let i = 0; i < words.length; i++) {
			words[i] = view.getUint32(i * 4, true);
		}
		if (!verifyProof(challenge, p, words)) {
			return "invalid_proof";
		}
	}

	const id = Buffer.from(challenge.payload.subarray(16)).toString("hex");
	if (used !== undefined) {
		if (used.has(id)) {
			return "replayed";
		}
		used.add(id);
	}
	return "valid";
}
