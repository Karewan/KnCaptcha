const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

const LOOKUP = new Int16Array(128).fill(-1);
for (let i = 0; i < ALPHABET.length; i++) {
	LOOKUP[ALPHABET.charCodeAt(i)] = i;
}

/**
 * Base64url without padding (RFC 4648 §5)
 * @param bytes
 * @returns
 */
export function base64UrlEncode(bytes: Uint8Array): string {
	let out = "";
	let i = 0;
	for (; i + 2 < bytes.length; i += 3) {
		const v = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
		out +=
			ALPHABET[v >>> 18] +
			ALPHABET[(v >>> 12) & 63] +
			ALPHABET[(v >>> 6) & 63] +
			ALPHABET[v & 63];
	}
	const rest = bytes.length - i;
	if (rest === 1) {
		const v = bytes[i];
		out += ALPHABET[v >>> 2] + ALPHABET[(v & 3) << 4];
	} else if (rest === 2) {
		const v = (bytes[i] << 8) | bytes[i + 1];
		out += ALPHABET[v >>> 10] + ALPHABET[(v >>> 4) & 63] + ALPHABET[(v & 15) << 2];
	}
	return out;
}

/**
 * Strict base64url decoding: no padding, no other character, and only the canonical encoding (unused trailing bits
 * set to zero), as the PHP verifier expects
 * @param text
 * @returns null when the text is not canonical base64url
 */
export function base64UrlDecode(text: string): Uint8Array | null {
	const length = text.length;
	if (length % 4 === 1) {
		return null;
	}

	const out = new Uint8Array(Math.floor((length * 3) / 4));
	let buffer = 0;
	let bits = 0;
	let o = 0;
	for (let i = 0; i < length; i++) {
		const code = text.charCodeAt(i);
		const value = code < 128 ? LOOKUP[code] : -1;
		if (value < 0) {
			return null;
		}
		buffer = ((buffer << 6) | value) & 0xffffff;
		bits += 6;
		if (bits >= 8) {
			bits -= 8;
			out[o++] = (buffer >>> bits) & 255;
		}
	}

	// The last character carries 2 or 4 unused bits: any of them set means another string decodes to the same bytes
	if ((buffer & ((1 << bits) - 1)) !== 0) {
		return null;
	}
	return out;
}
