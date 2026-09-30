// @vitest-environment node
import { describe, expect, it } from "vitest";
import { base64UrlDecode, base64UrlEncode } from "../src/base64url";

describe("base64url", () => {
	it("matches the Node encoder for every length", () => {
		for (let length = 0; length < 70; length++) {
			const bytes = new Uint8Array(length).map((_, i) => (i * 37 + length) & 255);
			const expected = Buffer.from(bytes).toString("base64url");
			expect(base64UrlEncode(bytes)).toBe(expected);
			expect(base64UrlDecode(expected)).toEqual(bytes);
		}
	});

	it.each([
		[
			"padding",
			"AAE=",
		],
		[
			"standard alphabet",
			"a+b/",
		],
		[
			"impossible length",
			"AAAAA",
		],
		[
			"non-canonical trailing bits",
			"AB",
		],
		[
			"space",
			"AA AA",
		],
		[
			"non-ASCII",
			"AAé",
		],
	])("refuses %s", (_, text) => {
		expect(base64UrlDecode(text)).toBeNull();
	});
});
