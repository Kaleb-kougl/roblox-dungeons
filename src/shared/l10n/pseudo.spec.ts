import { describe, expect, it } from "@rbxts/jest-globals";
import { PSEUDO, PSEUDO_LETTERS, charCount, pseudoLocalize } from "shared/l10n";
import { placeholders } from "shared/theme";

function strip(text: string): string {
	// The body between ⟦ and the padding.
	const open = PSEUDO.open.size();
	const body = text.sub(open + 1, text.size() - PSEUDO.close.size());
	const [out] = body.gsub(`${PSEUDO.pad}+$`, "");
	return out;
}

describe("pseudoLocalize", () => {
	it("accents every ASCII letter and keeps the rest", () => {
		expect(strip(pseudoLocalize("Run over!"))).toBe("Ŕúñ óṽéŕ!");
		expect(strip(pseudoLocalize("Floor 3 · 2"))).toBe("Ƒĺóóŕ 3 · 2");
	});
	it("keeps placeholders byte for byte, and broken braces are text", () => {
		const out = pseudoLocalize("Lv {level} — {score_2} pts {not a var}");
		expect(placeholders(out)).toEqual(["level", "score_2"]);
		expect(strip(out)).toBe("Ĺṽ {level} — {score_2} þţš {ñóţ á ṽáŕ}");
	});
	it("pads about 40 % (rounded up) and wraps in ⟦ ⟧", () => {
		const out = pseudoLocalize("Hello");
		expect(out.sub(1, PSEUDO.open.size())).toBe(PSEUDO.open);
		expect(out.sub(out.size() - PSEUDO.close.size() + 1)).toBe(PSEUDO.close);
		expect(out).toBe(`${PSEUDO.open}Ĥéĺĺó${PSEUDO.pad.rep(2)}${PSEUDO.close}`);
		expect(charCount(pseudoLocalize("abcdefghij"))).toBe(10 + 4 + 2);
		expect(pseudoLocalize("")).toBe(`${PSEUDO.open}${PSEUDO.close}`);
	});
	it("passes multi-byte text through and keeps all caps upper case", () => {
		expect(strip(pseudoLocalize("Déjà vu"))).toBe("Ðéĵà ṽú");
		expect(strip(pseudoLocalize("NEW BEST"))).toBe("ÑÉŴ ƁÉŠŢ");
	});
	it("maps all 52 ASCII letters to one character each", () => {
		let n = 0;
		for (const [from, to] of PSEUDO_LETTERS) {
			expect(from.size()).toBe(1);
			expect(charCount(to)).toBe(1);
			n++;
		}
		expect(n).toBe(52);
	});
});
