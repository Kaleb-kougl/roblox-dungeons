import { Controller, OnInit } from "@flamework/core";
import { THEME_PACK_ID } from "shared/config";
import { loadThemePack, setActiveThemePack, type ThemePack } from "shared/theme";
import { STAGE_AUDIT, stageAuditIdsOf } from "shared/view";

/** A ThemePack method as its instance field sees it (called with the pack first: `pack:sprites(id)`). */
type PackMethod = (pack: ThemePack, ...args: Array<unknown>) => unknown;

/**
 * Loads the theme pack once (in onInit, before any controller's onStart) and makes it the active pack. Every visual
 * the client builds goes through it: placeholder shapes and colour roles today, uploaded art later (manifest only).
 * LocaleController switches its strings (ThemePack.setLocale, docs/LOCALIZATION.md L6).
 *
 * The stage asset audit (docs/STAGE_ASSETS.md SA11, `KV_StageAssetAudit`): `setAuditRecorder(cb)` makes every lookup
 * shared/view STAGE_AUDIT lists report the logical id it resolved to `cb`, by shadowing those methods on the ONE pack
 * instance (every controller and the UI's getActiveThemePack hold that same instance, so references taken earlier are
 * covered too); `setAuditRecorder(undefined)` removes the shadows, so the class methods (and their cost) are exactly as
 * before. shared/theme's ThemePack is untouched. The pack's internal calls go through the shadows too (`bullet(id)`
 * also reports `sprites(id)`: the same id). Lookups a renderer cached on an earlier floor are not seen again.
 */
@Controller({ loadOrder: 0 })
export class ThemeController implements OnInit {
	private pack: ThemePack | undefined;
	private recorder: ((id: string) => void) | undefined;
	private shadowed = false;

	onInit(): void {
		this.getPack(); // LocaleController (same loadOrder) may have loaded it already: keep that pack and its locale
	}

	getPack(): ThemePack {
		if (this.pack === undefined) {
			const pack = loadThemePack(THEME_PACK_ID);
			setActiveThemePack(pack);
			this.pack = pack;
		}
		return this.pack;
	}

	/** Records every watched lookup's logical id to `recorder` (undefined: stop recording). See the class comment. */
	setAuditRecorder(recorder: ((id: string) => void) | undefined): void {
		this.recorder = recorder;
		if (recorder !== undefined && !this.shadowed) this.shadow();
		else if (recorder === undefined && this.shadowed) this.unshadow();
	}

	private shadow(): void {
		const fields = this.getPack() as unknown as Record<string, PackMethod | undefined>;
		for (const [method, key] of STAGE_AUDIT.methods) {
			const original = fields[method];
			if (original === undefined) continue;
			fields[method] = (pack, ...args) => {
				const result = original(pack, ...args);
				const id = stageAuditIdsOf(key, args[0], result);
				if (id !== undefined) this.recorder?.(id);
				return result;
			};
		}
		this.shadowed = true;
	}

	private unshadow(): void {
		const fields = this.getPack() as unknown as Record<string, PackMethod | undefined>;
		for (const [method] of STAGE_AUDIT.methods) fields[method] = undefined;
		this.shadowed = false;
	}
}
