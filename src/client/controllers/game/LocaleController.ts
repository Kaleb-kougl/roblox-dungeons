import { Controller, OnInit, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { LocalizationService, Players, RunService } from "@rbxts/services";
import { clientStore, sameL10nState, selectDisplay } from "client/store";
import { rememberSelection } from "client/ui/theme";
import { DEV_MODE } from "shared/config";
import { pickLocale, resolveLocaleState } from "shared/l10n";
import { languageOverride } from "shared/settings";
import { ThemeController } from "./ThemeController";

/**
 * The locale the client shows (docs/LOCALIZATION.md design 8, L6, LD3). Resolves it in onInit (before anything mounts)
 * and again whenever an input changes:
 *
 *   ids        the player's Roblox locale ids, `Players.LocalPlayer.LocaleId` first, then
 *              `LocalizationService.RobloxLocaleId` (spike L0 says which one is the in-experience language; both are
 *              passed until then), re-read when either changes;
 *   override   Options > Display > Language (DisplaySettings.language; the settings slice: the server's stored
 *              overrides arrive after join, a pick applies at once);
 *   developer  Studio, or the player attribute DEV_MODE.allowedAttribute (DevModeService): may pick hidden locales,
 *              the pseudo-locale en-XA included (and auto-picks hidden ones from the Roblox language).
 *
 * shared/l10n resolveLocaleState -> the theme pack's setLocale (strings and the number locale) -> the `l10n` slice,
 * in that order, so every reader of the slice already gets the new strings. React roots remount under LocaleRoot;
 * controllers that build text outside React follow client/ui/theme onLocaleChanged. The gamepad selection is
 * remembered before the switch and put back after the remount. A switch mid-run is fine: the sim never reads text.
 */
@Controller({ loadOrder: 0 })
export class LocaleController implements OnInit, OnStart {
	private readonly janitor = new Janitor();

	constructor(private readonly theme: ThemeController) {}

	onInit(): void {
		this.resolve();
	}

	onStart(): void {
		const player = Players.LocalPlayer;
		const resolve = () => this.resolve();
		this.janitor.Add(player.GetPropertyChangedSignal("LocaleId").Connect(resolve));
		this.janitor.Add(LocalizationService.GetPropertyChangedSignal("RobloxLocaleId").Connect(resolve));
		this.janitor.Add(player.GetAttributeChangedSignal(DEV_MODE.allowedAttribute).Connect(resolve));
		this.janitor.Add(clientStore.subscribe((state) => selectDisplay(state).language, resolve));
		this.resolve();
	}

	/** Studio, or a player the server allows developer mode: hidden locales may be picked. */
	private developer(): boolean {
		return RunService.IsStudio() || Players.LocalPlayer.GetAttribute(DEV_MODE.allowedAttribute) === true;
	}

	private resolve(): void {
		const player = Players.LocalPlayer;
		const allowHidden = this.developer();
		const language = selectDisplay(clientStore.getState()).language;
		const ids = [player.LocaleId, LocalizationService.RobloxLocaleId];
		const resolved = resolveLocaleState(ids, languageOverride(language, allowHidden), { allowHidden });
		const autoCode = resolved.auto ? resolved.code : pickLocale(ids, undefined).code;
		const state = { ...resolved, autoCode, allowHidden };
		const pack = this.theme.getPack();
		const current = clientStore.getState().l10n;
		if (pack.locale === resolved.code && sameL10nState(current, state)) return;
		if (current.code !== resolved.code) rememberSelection();
		pack.setLocale(resolved.code);
		clientStore.setLocaleState(state);
	}
}
