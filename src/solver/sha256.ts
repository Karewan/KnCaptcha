/**
 * SHA-256 (FIPS 180-4) on 32-bit words. The solver hashes 65 536 blocks per run: `compress()` works on caller-owned
 * buffers and allocates nothing. WebCrypto is not used, its promise per call costs more than the hash itself.
 */

const K = Uint32Array.of(
	0x428a2f98,
	0x71374491,
	0xb5c0fbcf,
	0xe9b5dba5,
	0x3956c25b,
	0x59f111f1,
	0x923f82a4,
	0xab1c5ed5,
	0xd807aa98,
	0x12835b01,
	0x243185be,
	0x550c7dc3,
	0x72be5d74,
	0x80deb1fe,
	0x9bdc06a7,
	0xc19bf174,
	0xe49b69c1,
	0xefbe4786,
	0x0fc19dc6,
	0x240ca1cc,
	0x2de92c6f,
	0x4a7484aa,
	0x5cb0a9dc,
	0x76f988da,
	0x983e5152,
	0xa831c66d,
	0xb00327c8,
	0xbf597fc7,
	0xc6e00bf3,
	0xd5a79147,
	0x06ca6351,
	0x14292967,
	0x27b70a85,
	0x2e1b2138,
	0x4d2c6dfc,
	0x53380d13,
	0x650a7354,
	0x766a0abb,
	0x81c2c92e,
	0x92722c85,
	0xa2bfe8a1,
	0xa81a664b,
	0xc24b8b70,
	0xc76c51a3,
	0xd192e819,
	0xd6990624,
	0xf40e3585,
	0x106aa070,
	0x19a4c116,
	0x1e376c08,
	0x2748774c,
	0x34b0bcb5,
	0x391c0cb3,
	0x4ed8aa4a,
	0x5b9cca4f,
	0x682e6ff3,
	0x748f82ee,
	0x78a5636f,
	0x84c87814,
	0x8cc70208,
	0x90befffa,
	0xa4506ceb,
	0xbef9a3f7,
	0xc67178f2,
);

export const SHA256_IV = Uint32Array.of(
	0x6a09e667,
	0xbb67ae85,
	0x3c6ef372,
	0xa54ff53a,
	0x510e527f,
	0x9b05688c,
	0x1f83d9ab,
	0x5be0cd19,
);

/**
 * Compresses one 64-byte block into `state`
 * @param state 8 words, updated in place
 * @param w 64 words: the block as 16 big-endian words in w[0..15], w[16..63] is overwritten (message schedule)
 */
export function compress(state: Uint32Array, w: Uint32Array): void {
	for (let i = 16; i < 64; i++) {
		const w15 = w[i - 15];
		const w2 = w[i - 2];
		const s0 = ((w15 >>> 7) | (w15 << 25)) ^ ((w15 >>> 18) | (w15 << 14)) ^ (w15 >>> 3);
		const s1 = ((w2 >>> 17) | (w2 << 15)) ^ ((w2 >>> 19) | (w2 << 13)) ^ (w2 >>> 10);
		w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
	}

	let a = state[0];
	let b = state[1];
	let c = state[2];
	let d = state[3];
	let e = state[4];
	let f = state[5];
	let g = state[6];
	let h = state[7];
	for (let i = 0; i < 64; i++) {
		const s1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
		const t1 = (h + s1 + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
		const s0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
		const t2 = (s0 + ((a & b) ^ (a & c) ^ (b & c))) | 0;
		h = g;
		g = f;
		f = e;
		e = (d + t1) | 0;
		d = c;
		c = b;
		b = a;
		a = (t1 + t2) | 0;
	}

	state[0] = state[0] + a;
	state[1] = state[1] + b;
	state[2] = state[2] + c;
	state[3] = state[3] + d;
	state[4] = state[4] + e;
	state[5] = state[5] + f;
	state[6] = state[6] + g;
	state[7] = state[7] + h;
}

/**
 * SHA-256 of a whole message
 * @param data
 * @returns the 32-byte digest
 */
export function sha256(data: Uint8Array): Uint8Array {
	const blocks = (data.length + 9 + 63) >>> 6;
	const padded = new Uint8Array(blocks * 64);
	padded.set(data);
	padded[data.length] = 0x80;
	const view = new DataView(padded.buffer);
	const bitLength = data.length * 8;
	view.setUint32(padded.length - 8, Math.floor(bitLength / 0x100000000));
	view.setUint32(padded.length - 4, bitLength >>> 0);

	const state = SHA256_IV.slice();
	const w = new Uint32Array(64);
	for (let block = 0; block < blocks; block++) {
		for (let i = 0; i < 16; i++) {
			w[i] = view.getUint32(block * 64 + i * 4);
		}
		compress(state, w);
	}

	const out = new Uint8Array(32);
	const outView = new DataView(out.buffer);
	for (let i = 0; i < 8; i++) {
		outView.setUint32(i * 4, state[i]);
	}
	return out;
}
