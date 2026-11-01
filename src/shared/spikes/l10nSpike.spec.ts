// Data of the localization spike L0 (docs/SPIKES.md "Spike L0"): every script has a glyph sample and a wrapped sample,
// the nine Latin locales each have a column, ids and fonts are unique, and every string is valid UTF-8.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	L10N_SPIKE_FONTS,
	L10N_SPIKE_LATIN_LOCALES,
	L10N_SPIKE_PROBE_SOURCE,
	L10N_SPIKE_SAMPLES,
	L10N_SPIKE_SCRIPTS,
	L10N_SPIKE_WRAP_SAMPLES,
	NBSP,
} from ".";

/** Code points of a valid UTF-8 string, or undefined when it is not valid UTF-8. */
function codepoints(s: string): number | undefined {
	const [n] = utf8.len(s);
	return typeIs(n, "number") ? n : undefined;
}

function unique(list: ReadonlyArray<string>): boolean {
	return new Set(list).size() === list.size();
}

describe("L0 spike data", () => {
	it("has a glyph sample and a wrapped sample for every script", () => {
		for (const scriptId of L10N_SPIKE_SCRIPTS) {
			expect(L10N_SPIKE_SAMPLES.some((s) => s.script === scriptId)).toBe(true);
			expect(L10N_SPIKE_WRAP_SAMPLES.some((s) => s.script === scriptId)).toBe(true);
		}
	});

	it("has a column for each of the nine Latin locales", () => {
		expect(L10N_SPIKE_LATIN_LOCALES.size()).toBe(9);
		for (const id of L10N_SPIKE_LATIN_LOCALES) {
			const sample = L10N_SPIKE_SAMPLES.find((s) => s.id === id);
			expect(sample?.script).toBe("latin");
		}
	});

	it("keeps ids and fonts unique, with Arcade, Code and BuilderSans among the fonts", () => {
		expect(unique(L10N_SPIKE_SAMPLES.map((s) => s.id))).toBe(true);
		expect(unique(L10N_SPIKE_WRAP_SAMPLES.map((s) => s.id))).toBe(true);
		expect(unique(L10N_SPIKE_FONTS)).toBe(true);
		for (const font of ["Arcade", "Code", "BuilderSans"]) expect(L10N_SPIKE_FONTS.includes(font)).toBe(true);
	});

	it("has only non-empty, valid UTF-8 strings", () => {
		const all = [
			L10N_SPIKE_PROBE_SOURCE,
			...L10N_SPIKE_SAMPLES.map((s) => s.glyphs),
			...L10N_SPIKE_WRAP_SAMPLES.map((s) => s.text),
		];
		for (const s of all) {
			const n = codepoints(s);
			expect(n).toBeDefined();
			expect(n ?? 0).toBeGreaterThan(0);
		}
	});

	it("puts the pseudo brackets and a no-break space in the pseudo sample, and non-ASCII text in the others", () => {
		expect(codepoints(NBSP)).toBe(1);
		expect(NBSP).toBe(utf8.char(0xa0));
		const pseudo = L10N_SPIKE_SAMPLES.find((s) => s.script === "pseudo")?.glyphs ?? "";
		expect(pseudo.find(utf8.char(0x27e6), 1, true)[0]).toBeDefined();
		expect(pseudo.find(utf8.char(0x27e7), 1, true)[0]).toBeDefined();
		expect(pseudo.find(NBSP, 1, true)[0]).toBeDefined();
		// Every sample but Indonesian (plain ASCII by design) has more bytes than code points.
		for (const s of L10N_SPIKE_SAMPLES) {
			if (s.id === "id") continue;
			expect(s.glyphs.size()).toBeGreaterThan(codepoints(s.glyphs) ?? 0);
		}
	});
});
