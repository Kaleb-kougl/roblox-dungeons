// shared/crypto: SHA-256 against FIPS 180-2's vectors ("abc", the empty string, the 448-bit and 896-bit messages) and
// padding boundaries (expected digests from Node's crypto), HMAC-SHA256 against RFC 4231 test cases 1-7, and the byte
// helpers.
import { describe, expect, it } from "@rbxts/jest-globals";
import { bytesOfHex, hexOf, hmacSha256, pushUint32BE, sha256, stringBytes, uint32BE } from "shared/crypto";

const sha = (s: string) => hexOf(sha256(stringBytes(s)));
function filled(byte: number, n: number): number[] {
	const out: number[] = [];
	for (let i = 0; i < n; i++) out.push(byte);
	return out;
}

describe("sha256", () => {
	it("FIPS 180-2 vectors", () => {
		expect(sha("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
		expect(sha("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
		expect(sha("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")).toBe(
			"248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
		);
		expect(
			sha(
				"abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu",
			),
		).toBe("cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1");
	});

	it("pads correctly around the block boundaries (n bytes of 'a')", () => {
		const cases: Array<[number, string]> = [
			[55, "9f4390f8d30c2dd92ec9f095b65e2b9ae9b0a925a5258e241c9f1e910f734318"],
			[56, "b35439a4ac6f0948b6d6f9e3c6af0f5f590ce20f1bde7090ef7970686ec6738a"],
			[63, "7d3e74a05d7db15bce4ad9ec0658ea98e3f06eeecf16b4c6fff2da457ddc2f34"],
			[64, "ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb"],
			[65, "635361c48bb9eab14198e76ea8ab7f1a41685d6ad62aa9146d301d4f17eb0ae0"],
			[119, "31eba51c313a5c08226adf18d4a359cfdfd8d2e816b13f4af952f7ea6584dcfb"],
			[120, "2f3d335432c70b580af0e8e1b3674a7c020d683aa5f73aaaedfdc55af904c21c"],
			[200, "c2a908d98f5df987ade41b5fce213067efbcc21ef2240212a41e54b5e7c28ae5"],
		];
		for (const [n, digest] of cases) expect([n, hexOf(sha256(filled(0x61, n)))]).toEqual([n, digest]);
	});

	it("does not modify its input", () => {
		const msg = stringBytes("abc");
		sha256(msg);
		expect(msg).toEqual([0x61, 0x62, 0x63]);
	});
});

describe("hmacSha256 (RFC 4231)", () => {
	const hmac = (key: number[], data: number[]) => hexOf(hmacSha256(key, data));

	it("test case 1: 20-byte key, 'Hi There'", () => {
		expect(hmac(filled(0x0b, 20), stringBytes("Hi There"))).toBe(
			"b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7",
		);
	});

	it("test case 2: a key shorter than the output ('Jefe')", () => {
		expect(hmac(stringBytes("Jefe"), stringBytes("what do ya want for nothing?"))).toBe(
			"5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843",
		);
	});

	it("test case 3: 20 x 0xaa key, 50 x 0xdd data", () => {
		expect(hmac(filled(0xaa, 20), filled(0xdd, 50))).toBe(
			"773ea91e36800e46854db8ebd09181a72959098b3ef8c122d9635514ced565fe",
		);
	});

	it("test case 4: key 0x01..0x19, 50 x 0xcd data", () => {
		const key: number[] = [];
		for (let i = 1; i <= 25; i++) key.push(i);
		expect(hmac(key, filled(0xcd, 50))).toBe("82558a389a443c0ea4cc819899f2083a85f0faa3e578f8077a2e3ff46729665b");
	});

	it("test case 5: truncated to 128 bits", () => {
		const mac = hmacSha256(filled(0x0c, 20), stringBytes("Test With Truncation"));
		const first: number[] = [];
		for (let i = 0; i < 16; i++) first.push(mac[i]);
		expect(hexOf(first)).toBe("a3b6167473100ee06e0c796c2955552b");
	});

	it("test cases 6 and 7: a key longer than the block is hashed first", () => {
		const key = filled(0xaa, 131);
		expect(hmac(key, stringBytes("Test Using Larger Than Block-Size Key - Hash Key First"))).toBe(
			"60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54",
		);
		expect(
			hmac(
				key,
				stringBytes(
					"This is a test using a larger than block-size key and a larger than block-size data. The key needs to be hashed before being used by the HMAC algorithm.",
				),
			),
		).toBe("9b09ffa71b942fcb27635fbcd5b0e944bfdc63644f0713938a7f51535c3a35e2");
	});
});

describe("bytes", () => {
	it("hex both ways, uint32 big-endian both ways", () => {
		expect(bytesOfHex("00ff7Fa0")).toEqual([0, 255, 127, 160]);
		expect(hexOf([0, 255, 127, 160])).toBe("00ff7fa0");
		expect(() => bytesOfHex("abc")).toThrow();
		expect(() => bytesOfHex("zz")).toThrow();
		expect(uint32BE([0xde, 0xad, 0xbe, 0xef, 1], 0)).toBe(0xdeadbeef);
		expect(uint32BE([9, 0xde, 0xad, 0xbe, 0xef], 1)).toBe(0xdeadbeef);
		const out: number[] = [];
		pushUint32BE(out, 0x01020304);
		expect(out).toEqual([1, 2, 3, 4]);
		expect(stringBytes("A\0z")).toEqual([0x41, 0, 0x7a]);
	});
});
