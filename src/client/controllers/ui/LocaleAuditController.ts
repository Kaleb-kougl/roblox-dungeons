import { Controller, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { Players, RunService, Workspace } from "@rbxts/services";
import { currentLocale, onLocaleChanged, themePack } from "client/ui/theme";
import { FitAuditLog, LOCALE_AUDIT, fitAuditLine, isTextMisfit, localeReportLines } from "shared/l10n";

type TextObject = TextLabel | TextButton | TextBox;

function isTextObject(obj: Instance): obj is TextObject {
	return obj.IsA("TextLabel") || obj.IsA("TextButton") || obj.IsA("TextBox");
}

/**
 * The fit audit (docs/LOCALIZATION.md L9), a debug tool off by default: with the Workspace attribute
 * LOCALE_AUDIT.attribute (`KV_LocaleAudit`) on, every LOCALE_AUDIT.intervalSec it walks PlayerGui (enabled ScreenGuis,
 * visible GuiObjects only: a hidden subtree is skipped) and logs each TextLabel / TextButton / TextBox whose text does
 * not fit (TextFits false), unless it is TextScaled or truncated on purpose (shared/l10n isTextMisfit): its path, the
 * locale and the text, once per instance path and text (FitAuditLog). On turning on and on every locale switch it
 * also prints the theme pack's localeReport (stale / mismatched / unknown keys). Everything it made is cleaned up when
 * the attribute goes off (Janitor). Walk the screens under en-XA, de, ru, ja, th, ar at 1280 x 720 and phone size.
 */
@Controller({})
export class LocaleAuditController implements OnStart {
	private readonly janitor = new Janitor();
	private readonly audit = new Janitor();
	private readonly log = new FitAuditLog();
	private on = false;

	onStart(): void {
		const read = () => this.setOn(Workspace.GetAttribute(LOCALE_AUDIT.attribute) === true);
		this.janitor.Add(Workspace.GetAttributeChangedSignal(LOCALE_AUDIT.attribute).Connect(read));
		this.janitor.Add(this.audit, "Cleanup");
		read();
	}

	private setOn(on: boolean): void {
		if (on === this.on) return;
		this.on = on;
		this.audit.Cleanup();
		this.log.clear();
		if (!on) return;
		print(`${LOCALE_AUDIT.tag} on (${LOCALE_AUDIT.attribute})`);
		this.report();
		this.audit.Add(onLocaleChanged(() => this.report()));
		let wait = 0;
		this.audit.Add(
			RunService.Heartbeat.Connect((dt) => {
				wait -= dt;
				if (wait > 0) return;
				wait = LOCALE_AUDIT.intervalSec;
				this.walk();
			}),
		);
		this.audit.Add(() => print(`${LOCALE_AUDIT.tag} off`));
	}

	/** The pack's locale report for the locale shown. */
	private report(): void {
		const pack = themePack();
		if (pack === undefined) return;
		for (const line of localeReportLines(currentLocale().code, pack.localeReport())) print(line);
	}

	private walk(): void {
		const playerGui = Players.LocalPlayer.FindFirstChildOfClass("PlayerGui");
		if (playerGui === undefined) return;
		const locale = currentLocale().code;
		for (const child of playerGui.GetChildren()) {
			if (child.IsA("LayerCollector") && child.Enabled) this.visit(child, locale);
		}
	}

	/** Visits `node`'s children; a hidden GuiObject's subtree is skipped (nothing in it shows). */
	private visit(node: Instance, locale: string): void {
		for (const child of node.GetChildren()) {
			if (child.IsA("GuiObject")) {
				if (!child.Visible) continue;
				if (isTextObject(child)) this.check(child, locale);
				this.visit(child, locale);
			} else if (child.IsA("Folder") || child.IsA("LayerCollector")) {
				if (child.IsA("LayerCollector") && !child.Enabled) continue;
				this.visit(child, locale);
			}
		}
	}

	private check(obj: TextObject, locale: string): void {
		const text = obj.ContentText;
		const misfit = isTextMisfit({
			visible: true,
			fits: obj.TextFits,
			scaled: obj.TextScaled,
			truncated: obj.TextTruncate !== Enum.TextTruncate.None,
			text,
		});
		if (!misfit) return;
		const path = obj.GetFullName();
		if (this.log.report(locale, path, text)) print(fitAuditLine(path, locale, text));
	}
}
