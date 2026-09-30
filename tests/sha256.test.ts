// @vitest-environment node
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sha256 } from "../src/solver/sha256";

describe("sha256", () => {
	it("gives the FIPS 180-4 test vectors", () => {
		const hex = (text: string): string =>
			Buffer.from(sha256(new TextEncoder().encode(text))).toString("hex");
		expect(hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
		expect(hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
		expect(hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")).toBe(
			"248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
		);
	});

	it("matches node:crypto around the block boundaries", () => {
		for (let length = 0; length < 200; length++) {
			const data = new Uint8Array(length).map((_, i) => (i * 131 + 7) & 255);
			expect(Buffer.from(sha256(data)).toString("hex")).toBe(
				createHash("sha256").update(data).digest("hex"),
			);
		}
	});
});
