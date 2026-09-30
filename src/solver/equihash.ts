import { compress, SHA256_IV } from "./sha256";

/**
 * Equihash (Biryukov & Khovratovich, "Equihash: asymmetric proof-of-work based on the generalized birthday problem",
 * NDSS 2016): find 2^k distinct leaves whose n-bit hashes XOR to zero, the XOR of every aligned group of 2^l leaves
 * being zero on its first l·c bits (c = n / (k + 1)), and the first leaf of each left half lower than the first leaf
 * of its right half (one canonical order per solution).
 *
 * Wagner's algorithm finds about two solutions per run and needs all 2^(c+1) leaf hashes in memory at once: the work
 * is bound by memory accesses, where GPUs and ASICs gain far less than on a plain hash. Checking a solution costs
 * 2^k hashes.
 *
 * Leaf i is the slice (i mod perHash) of SHA-256(seed || LE32(i div perHash)), perHash being the number of whole
 * ceil(n/8)-byte slices in a digest; only its first n bits count.
 */

/** Limits shared with the PHP verifier: the solver memory grows with 2^c, the verification cost with 2^k */
export const MIN_K = 2;
export const MAX_K = 7;
export const MIN_C = 8;
export const MAX_C = 20;

export interface EquihashLayout {
	readonly n: number;
	readonly k: number;
	/** Bits cancelled per round */
	readonly c: number;
	/** 2^(c+1) leaves */
	readonly leaves: number;
	/** 32-bit words per hash */
	readonly words: number;
	readonly leafBytes: number;
	readonly perHash: number;
}

/**
 * @param n
 * @param k
 * @returns the layout of Equihash(n, k)
 * @throws RangeError when the parameters are outside the supported range
 */
export function equihashLayout(n: number, k: number): EquihashLayout {
	if (
		!Number.isInteger(n) ||
		!Number.isInteger(k) ||
		k < MIN_K ||
		k > MAX_K ||
		n % (k + 1) !== 0
	) {
		throw new RangeError(`Unsupported Equihash parameters n=${n} k=${k}`);
	}
	const c = n / (k + 1);
	if (c < MIN_C || c > MAX_C) {
		throw new RangeError(`Unsupported Equihash parameters n=${n} k=${k}`);
	}
	const leafBytes = Math.ceil(n / 8);
	return {
		n,
		k,
		c,
		leaves: 2 ** (c + 1),
		words: Math.ceil(n / 32),
		leafBytes,
		perHash: Math.floor(32 / leafBytes),
	};
}

/**
 * Hashes of the leaves for one seed
 */
class LeafHasher {
	private readonly w = new Uint32Array(64);
	readonly state = new Uint32Array(8);

	constructor(private readonly layout: EquihashLayout) {
		// SHA-256 padding of a 36-byte message: only w[8], the group number, changes from one hash to the next
		this.w[9] = 0x80000000;
		this.w[15] = 36 * 8;
	}

	setSeed(seed: Uint8Array): void {
		for (let i = 0; i < 8; i++) {
			this.w[i] =
				(seed[i * 4] << 24) |
				(seed[i * 4 + 1] << 16) |
				(seed[i * 4 + 2] << 8) |
				seed[i * 4 + 3];
		}
	}

	/**
	 * Hashes the group of leaves `group` into `state`
	 * @param group
	 */
	hash(group: number): void {
		// LE32(group) read as a big-endian word
		this.w[8] =
			((group & 0xff) << 24) |
			((group & 0xff00) << 8) |
			((group >>> 8) & 0xff00) |
			(group >>> 24);
		this.state.set(SHA256_IV);
		compress(this.state, this.w);
	}

	/**
	 * Copies the leaf `slot` of the last hash as big-endian words, the bits after n set to zero
	 * @param slot
	 * @param out
	 * @param offset
	 */
	leaf(slot: number, out: Uint32Array, offset: number): void {
		const { n, words, leafBytes } = this.layout;
		const state = this.state;
		if (n % 32 === 0) {
			const base = slot * words;
			for (let w = 0; w < words; w++) {
				out[offset + w] = state[base + w];
			}
			return;
		}

		const start = slot * leafBytes;
		for (let w = 0; w < words; w++) {
			let value = 0;
			for (let t = 0; t < 4; t++) {
				const p = w * 4 + t;
				const i = start + p;
				const byte = p < leafBytes ? (state[i >>> 2] >>> (24 - 8 * (i & 3))) & 0xff : 0;
				value = (value << 8) | byte;
			}
			out[offset + w] = value;
		}
		const used = n - 32 * (words - 1);
		out[offset + words - 1] = out[offset + words - 1] & (0xffffffff << (32 - used));
	}
}

/**
 * Puts each group of 2^l aligned leaves in canonical order: the first leaf of the left half is the lowest
 * @param indices 2^k leaves, sorted in place
 */
export function canonicalize(indices: Uint32Array): void {
	const total = indices.length;
	for (let size = 1; size < total; size <<= 1) {
		for (let i = 0; i < total; i += size << 1) {
			if (indices[i] > indices[i + size]) {
				for (let j = 0; j < size; j++) {
					const tmp = indices[i + j];
					indices[i + j] = indices[i + size + j];
					indices[i + size + j] = tmp;
				}
			}
		}
	}
}

/**
 * Wagner's algorithm with back-pointers: each round sorts the list on its next c bits (counting sort), pairs up the
 * entries of each bucket and keeps a pointer to the two parents instead of the growing list of leaves. The buffers
 * are allocated once and reused by every run.
 */
export class EquihashSolver {
	readonly layout: EquihashLayout;
	/** Entries kept per round: a round yields about as many entries as it reads, the margin absorbs the variance */
	private readonly capacity: number;
	private readonly buckets: number;
	private readonly hasher: LeafHasher;
	private cur: Uint32Array;
	private next: Uint32Array;
	private readonly keys: Uint32Array;
	private readonly order: Uint32Array;
	/** Bucket b ends at bucketEnds[b] once the entries are placed */
	private readonly bucketEnds: Uint32Array;
	/** Parents of the entries of round r in pointers[r - 1] */
	private readonly pointers: Uint32Array[];
	private readonly solution: Uint32Array;
	private readonly sorted: Uint32Array;

	constructor(n: number, k: number) {
		this.layout = equihashLayout(n, k);
		const { c, leaves, words } = this.layout;
		this.capacity = leaves + (leaves >>> 2);
		this.buckets = 2 ** c;
		this.hasher = new LeafHasher(this.layout);
		this.cur = new Uint32Array(this.capacity * words);
		this.next = new Uint32Array(this.capacity * words);
		this.keys = new Uint32Array(this.capacity);
		this.order = new Uint32Array(this.capacity);
		this.bucketEnds = new Uint32Array(this.buckets);
		this.pointers = Array.from(
			{
				length: k - 1,
			},
			() => new Uint32Array(this.capacity * 2),
		);
		this.solution = new Uint32Array(2 ** k);
		this.sorted = new Uint32Array(2 ** k);
	}

	/**
	 * Runs the algorithm once on `seed`
	 * @param seed 32 bytes
	 * @param onSolution receives each solution in canonical order (a buffer reused by the next one), returns true to stop
	 * @returns the number of solutions passed to onSolution
	 */
	solve(seed: Uint8Array, onSolution: (indices: Uint32Array) => boolean): number {
		const { k, c } = this.layout;
		this.generate(seed);
		let length = this.layout.leaves;
		for (let round = 1; round < k; round++) {
			this.sortOnBits(length, (round - 1) * c);
			length = this.collide(this.pointers[round - 1]);
		}
		this.sortOnBits(length, (k - 1) * c);
		return this.finish(onSolution);
	}

	private generate(seed: Uint8Array): void {
		const { leaves, perHash, words } = this.layout;
		const hasher = this.hasher;
		const cur = this.cur;
		hasher.setSeed(seed);
		for (let group = 0, leaf = 0; leaf < leaves; group++) {
			hasher.hash(group);
			for (let slot = 0; slot < perHash && leaf < leaves; slot++, leaf++) {
				hasher.leaf(slot, cur, leaf * words);
			}
		}
	}

	/**
	 * Counting sort of the `length` first entries on the c bits at bit `offset`: `order` lists the entries bucket by
	 * bucket, `bucketEnds` gives where each bucket ends
	 * @param length
	 * @param offset
	 */
	private sortOnBits(length: number, offset: number): void {
		const { c, words } = this.layout;
		const cur = this.cur;
		const keys = this.keys;
		const ends = this.bucketEnds;
		const mask = 2 ** c - 1;
		const word = offset >>> 5;
		const bit = offset & 31;

		ends.fill(0);
		if (bit + c <= 32) {
			const shift = 32 - bit - c;
			for (let e = 0, p = word; e < length; e++, p += words) {
				const key = (cur[p] >>> shift) & mask;
				keys[e] = key;
				ends[key] = ends[key] + 1;
			}
		} else {
			// The key straddles two words
			const low = bit + c - 32;
			const highMask = 2 ** (32 - bit) - 1;
			for (let e = 0, p = word; e < length; e++, p += words) {
				const key = ((cur[p] & highMask) << low) | (cur[p + 1] >>> (32 - low));
				keys[e] = key;
				ends[key] = ends[key] + 1;
			}
		}

		// Bucket starts, then each placement moves the start forward: it ends up at the end of the bucket
		let sum = 0;
		for (let b = 0; b < this.buckets; b++) {
			const size = ends[b];
			ends[b] = sum;
			sum += size;
		}
		const order = this.order;
		for (let e = 0; e < length; e++) {
			const key = keys[e];
			const at = ends[key];
			order[at] = e;
			ends[key] = at + 1;
		}
	}

	/**
	 * Pairs up the entries of each bucket into the next list
	 * @param pointers receives the parents of each new entry
	 * @returns the length of the new list
	 */
	private collide(pointers: Uint32Array): number {
		const { words } = this.layout;
		const cur = this.cur;
		const next = this.next;
		const order = this.order;
		const ends = this.bucketEnds;
		const capacity = this.capacity;
		let out = 0;
		let start = 0;

		buckets: for (let b = 0; b < this.buckets; b++) {
			const end = ends[b];
			for (let x = start; x < end - 1; x++) {
				const a = order[x];
				const pa = a * words;
				for (let y = x + 1; y < end; y++) {
					if (out === capacity) {
						break buckets;
					}
					const e = order[y];
					const pe = e * words;
					const po = out * words;
					let any = 0;
					for (let w = 0; w < words; w++) {
						const value = cur[pa + w] ^ cur[pe + w];
						next[po + w] = value;
						any |= value;
					}
					// A zero XOR comes from the same leaves on both sides: it could only lead to repeated indices
					if (any === 0) {
						continue;
					}
					pointers[out * 2] = a;
					pointers[out * 2 + 1] = e;
					out++;
				}
			}
			start = end;
		}

		this.next = cur;
		this.cur = next;
		return out;
	}

	/**
	 * Last round: two entries of a bucket that also agree on the last c bits make a solution
	 * @param onSolution
	 * @returns the number of solutions found
	 */
	private finish(onSolution: (indices: Uint32Array) => boolean): number {
		const { k, c, words } = this.layout;
		const cur = this.cur;
		const order = this.order;
		const ends = this.bucketEnds;
		const offset = k * c;
		const word = offset >>> 5;
		const bit = offset & 31;
		const mask = 2 ** c - 1;
		const straddles = bit + c > 32;
		const low = bit + c - 32;
		const highMask = 2 ** (32 - bit) - 1;
		const lastBits = (p: number): number =>
			straddles
				? ((cur[p] & highMask) << low) | (cur[p + 1] >>> (32 - low))
				: (cur[p] >>> (32 - bit - c)) & mask;

		let found = 0;
		let start = 0;
		for (let b = 0; b < this.buckets; b++) {
			const end = ends[b];
			for (let x = start; x < end - 1; x++) {
				const a = order[x];
				const bitsA = lastBits(a * words + word);
				for (let y = x + 1; y < end; y++) {
					const e = order[y];
					if (lastBits(e * words + word) !== bitsA || !this.buildSolution(a, e)) {
						continue;
					}
					found++;
					if (onSolution(this.solution)) {
						return found;
					}
				}
			}
			start = end;
		}
		return found;
	}

	/**
	 * Expands two entries of the last list into their leaves, in canonical order
	 * @param a
	 * @param b
	 * @returns false when a leaf appears twice
	 */
	private buildSolution(a: number, b: number): boolean {
		const { k } = this.layout;
		this.expand(k - 1, a, 0);
		this.expand(k - 1, b, 2 ** (k - 1));

		const sorted = this.sorted;
		sorted.set(this.solution);
		sorted.sort();
		for (let i = 1; i < sorted.length; i++) {
			if (sorted[i] === sorted[i - 1]) {
				return false;
			}
		}
		canonicalize(this.solution);
		return true;
	}

	private expand(round: number, entry: number, position: number): void {
		if (round === 0) {
			this.solution[position] = entry;
			return;
		}
		const pointers = this.pointers[round - 1];
		this.expand(round - 1, pointers[entry * 2], position);
		this.expand(round - 1, pointers[entry * 2 + 1], position + 2 ** (round - 1));
	}
}

/**
 * Checks a solution: what the server does, in 2^k hashes
 * @param seed 32 bytes
 * @param n
 * @param k
 * @param indices
 * @returns
 */
export function verifyEquihash(
	seed: Uint8Array,
	n: number,
	k: number,
	indices: ArrayLike<number>,
): boolean {
	const layout = equihashLayout(n, k);
	const { c, words, leaves, perHash } = layout;
	const total = 2 ** k;
	if (indices.length !== total) {
		return false;
	}

	const hasher = new LeafHasher(layout);
	hasher.setSeed(seed);
	const hashes = new Uint32Array(total * words);
	const first = new Array<number>(total);
	for (let p = 0; p < total; p++) {
		const index = indices[p];
		if (!Number.isInteger(index) || index < 0 || index >= leaves) {
			return false;
		}
		hasher.hash(Math.floor(index / perHash));
		hasher.leaf(index % perHash, hashes, p * words);
		first[p] = index;
	}
	if (new Set(first).size !== total) {
		return false;
	}

	// Level by level, in place: entry m of the level is the XOR of entries 2m and 2m+1 of the level below
	let count = total;
	for (let level = 1; level <= k; level++) {
		const zeroBits = level === k ? n : level * c;
		count >>>= 1;
		for (let m = 0; m < count; m++) {
			if (first[2 * m] >= first[2 * m + 1]) {
				return false;
			}
			for (let w = 0; w < words; w++) {
				hashes[m * words + w] = hashes[2 * m * words + w] ^ hashes[(2 * m + 1) * words + w];
			}
			if (!zeroPrefix(hashes, m * words, zeroBits)) {
				return false;
			}
			first[m] = first[2 * m];
		}
	}
	return true;
}

/**
 * @param words
 * @param offset
 * @param bits
 * @returns whether the first `bits` bits of the big-endian words at `offset` are zero
 */
function zeroPrefix(words: Uint32Array, offset: number, bits: number): boolean {
	const full = bits >>> 5;
	for (let w = 0; w < full; w++) {
		if (words[offset + w] !== 0) {
			return false;
		}
	}
	const rest = bits & 31;
	return rest === 0 || words[offset + full] >>> (32 - rest) === 0;
}
