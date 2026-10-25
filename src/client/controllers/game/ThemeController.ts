import { Controller, OnInit } from "@flamework/core";
import { THEME_PACK_ID } from "shared/config";
import { loadThemePack, setActiveThemePack, type ThemePack } from "shared/theme";

/**
 * Loads the theme pack once (in onInit, before any controller's onStart) and makes it the active pack. Every visual
 * the client builds goes through it: placeholder shapes and colour roles today, uploaded art later (manifest only).
 */
@Controller({ loadOrder: 0 })
export class ThemeController implements OnInit {
	private pack: ThemePack | undefined;

	onInit(): void {
		const pack = loadThemePack(THEME_PACK_ID);
		setActiveThemePack(pack);
		this.pack = pack;
	}

	getPack(): ThemePack {
		if (this.pack === undefined) {
			const pack = loadThemePack(THEME_PACK_ID);
			setActiveThemePack(pack);
			this.pack = pack;
		}
		return this.pack;
	}
}
