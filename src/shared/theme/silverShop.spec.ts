// Roblox port (docs/SILVER_SHOP.md SH4): the Silver shop's strings are REQUIRED_STRING_KEYS' last ones, every bundled
// pack has them, and the placeholder English reads as the plan's mock-up.
import { describe, expect, it } from "@rbxts/jest-globals";
import { REQUIRED_STRING_KEYS } from "./contract";
import { ThemePack } from "./pack";
import { THEME_PACKS } from "./packs";
import { PLACEHOLDER_MANIFEST } from "./packs/placeholder";
import { ROBUX_ICON_ID, SILVER_SHOP_KEYS, SILVER_SHOP_STRING_KEYS, silverShopStringKeys } from "./silverShop";
import { sortedKeys } from "./util";

const quiet = () => {};

function tail(list: ReadonlyArray<string>, n: number): string[] {
	const out = new Array<string>();
	for (let i = list.size() - n; i < list.size(); i++) out.push(list[i]);
	return out;
}

describe("silver shop: strings", () => {
	it("are REQUIRED_STRING_KEYS' last ones, distinct, sorted, in every bundled pack", () => {
		expect(SILVER_SHOP_STRING_KEYS.size()).toBe(12);
		expect([...silverShopStringKeys()]).toEqual([...SILVER_SHOP_STRING_KEYS]);
		expect(tail(REQUIRED_STRING_KEYS, SILVER_SHOP_STRING_KEYS.size())).toEqual([...SILVER_SHOP_STRING_KEYS]);
		expect(new Set(REQUIRED_STRING_KEYS).size()).toBe(REQUIRED_STRING_KEYS.size());
		for (const p of sortedKeys(THEME_PACKS))
			for (const key of SILVER_SHOP_STRING_KEYS)
				expect([p, key, typeIs(THEME_PACKS[p].strings[key], "string")]).toEqual([p, key, true]);
	});

	it("the placeholder English", () => {
		const pack = new ThemePack(PLACEHOLDER_MANIFEST, { warn: quiet });
		expect(pack.str(SILVER_SHOP_KEYS.title)).toBe("Get Silver");
		expect(pack.str(SILVER_SHOP_KEYS.open)).toBe("+");
		expect(pack.str(SILVER_SHOP_KEYS.pack, { silver: 450 })).toBe("450 Silver");
		expect(pack.str(SILVER_SHOP_KEYS.price, { robux: 55 })).toBe("55 Robux");
		expect(pack.str(SILVER_SHOP_KEYS.priceIcon, { robux: 55 })).toBe("55");
		expect(pack.str(SILVER_SHOP_KEYS.adding)).toBe("Adding Silver...");
		expect(pack.str(SILVER_SHOP_KEYS.added, { silver: 450 })).toBe("+450 Silver");
		expect(pack.str(SILVER_SHOP_KEYS.onItsWay)).toBe("Your Silver is on its way");
		expect(pack.str(SILVER_SHOP_KEYS.unavailable)).toBe("Unavailable");
		expect(pack.str(SILVER_SHOP_KEYS.footnote)).toBe(
			"Silver bought with Robux works like Silver you find. Purchases can't be undone.",
		);
	});

	it("the Robux icon is optional: no bundled pack has it, so prices read `{robux} Robux`", () => {
		for (const p of sortedKeys(THEME_PACKS)) {
			const pack = new ThemePack(THEME_PACKS[p], { warn: quiet });
			expect([p, pack.image(ROBUX_ICON_ID) !== undefined]).toEqual([p, false]);
		}
	});
});
