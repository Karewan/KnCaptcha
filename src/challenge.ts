import { base64UrlDecode, base64UrlEncode } from "./base64url";
import { KnCaptchaError } from "./errors";
import { equihashLayout } from "./solver/equihash";

/** Format of the challenge: first byte of the payload */
export const PROTOCOL_VERSION = 2;
export const PAYLOAD_BYTES = 32;
export const MAC_BYTES = 32;
export const MAX_BITS = 24;
export const MAX_PROOFS = 8;

/**
 * A challenge issued by the server: `base64url(payload).base64url(mac)`, see PROTOCOL.md
 */
export interface Challenge {
	/** Canonical form of the challenge, the start of the solution */
	readonly token: string;
	readonly payload: Uint8Array;
	readonly mac: Uint8Array;
	/** Equihash parameters */
	readonly n: number;
	readonly k: number;
	/** Leading zero bits required on the hash of each solution */
	readonly bits: number;
	/** Number of solutions to find */
	readonly proofs: number;
	/** Unix time (s), server clock */
	readonly issuedAt: number;
	readonly expiresAt: number;
}

/**
 * @param token
 * @returns the parsed challenge
 * @throws KnCaptchaError (challenge) when the token is malformed or uses parameters this version does not support
 */
export function parseChallenge(token: string): Challenge {
	const parts = token.trim().split(".");
	const payload = parts.length === 2 ? base64UrlDecode(parts[0]) : null;
	const mac = parts.length === 2 ? base64UrlDecode(parts[1]) : null;
	if (
		payload === null ||
		mac === null ||
		payload.length !== PAYLOAD_BYTES ||
		mac.length !== MAC_BYTES
	) {
		throw new KnCaptchaError("challenge", "Malformed challenge");
	}
	if (payload[0] !== PROTOCOL_VERSION) {
		throw new KnCaptchaError("challenge", `Unsupported challenge version ${payload[0]}`);
	}

	const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
	const n = payload[1];
	const k = payload[2];
	const bits = payload[3];
	const proofs = payload[4];
	const issuedAt = view.getUint32(8);
	const expiresAt = view.getUint32(12);
	try {
		equihashLayout(n, k);
	} catch (e) {
		throw new KnCaptchaError("challenge", `Unsupported challenge parameters n=${n} k=${k}`, {
			cause: e,
		});
	}
	if (bits > MAX_BITS || proofs < 1 || proofs > MAX_PROOFS || expiresAt <= issuedAt) {
		throw new KnCaptchaError("challenge", "Invalid challenge parameters");
	}

	return {
		token: `${base64UrlEncode(payload)}.${base64UrlEncode(mac)}`,
		payload,
		mac,
		n,
		k,
		bits,
		proofs,
		issuedAt,
		expiresAt,
	};
}

/**
 * @param challenge
 * @param proofs one [nonce, ...indices] per proof, in proof order
 * @returns the solution to send to the server: `<challenge>.base64url(proofs)`
 */
export function encodeSolution(challenge: Challenge, proofs: readonly Uint32Array[]): string {
	const size = 1 + 2 ** challenge.k;
	const bytes = new Uint8Array(proofs.length * size * 4);
	const view = new DataView(bytes.buffer);
	proofs.forEach((proof, p) => {
		if (proof.length !== size) {
			throw new RangeError(`Proof ${p} has ${proof.length} numbers instead of ${size}`);
		}
		for (const [i, value] of proof.entries()) {
			view.setUint32((p * size + i) * 4, value, true);
		}
	});
	return `${challenge.token}.${base64UrlEncode(bytes)}`;
}
