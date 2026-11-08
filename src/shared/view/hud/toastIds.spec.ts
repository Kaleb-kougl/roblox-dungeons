// docs/BUILDS_V2.md BV11d: every toast id base is its own (ToastPanel keys its rows by id), Happy Hour's included (its
// first base, -(2^22), was the vault toasts').
import { describe, expect, it } from "@rbxts/jest-globals";
import { BRACE_VIEW, BUILDS_V2_FX } from "shared/view/fx";
import { SIGHTING_VIEW } from "shared/view/sighting";
import { TREASURE_VIEW } from "shared/view/treasure";
import { DAILY_RANK } from "./dailyRankConfig";

describe("toast id bases", () => {
	it("are negative and pairwise apart", () => {
		const bases = [
			SIGHTING_VIEW.toastIdBase,
			DAILY_RANK.toastIdBase,
			TREASURE_VIEW.toast.idBase,
			BRACE_VIEW.toast.idBase,
			BUILDS_V2_FX.happyHour.toast.idBase,
		];
		for (let i = 0; i < bases.size(); i++) {
			expect(bases[i] < 0).toBe(true);
			for (let k = i + 1; k < bases.size(); k++) expect(bases[i]).never.toBe(bases[k]);
		}
	});
});
