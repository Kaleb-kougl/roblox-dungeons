import { Controller, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { LocalizationService, Players } from "@rbxts/services";
import { createKvScreenGui, MONO_FONT } from "client/ui";
import { L10N_SPIKE } from "shared/config";
import {
	L10N_SPIKE_FONTS,
	L10N_SPIKE_PROBE_SOURCE,
	L10N_SPIKE_SAMPLES,
	L10N_SPIKE_WRAP_SAMPLES,
	type L10nSpikeSample,
} from "shared/spikes";
import { watchSpikeFlag } from "./spikeFlags";

const LOG = "[L10nSpike]";
const GUI_NAME = "KV_L10nSpike";
/** The probe ScreenGui with AutoLocalize ON (the only GUI we ever make with it on; spike item e). */
const PROBE_GUI_NAME = "KV_L10nSpikeAuto";
const TEXT = Color3.fromRGB(240, 240, 240);
const CAPTION = Color3.fromRGB(170, 190, 220);
const MISSING = Color3.fromRGB(255, 110, 110);
const BACKDROP = Color3.fromRGB(14, 14, 22);
const CELL = Color3.fromRGB(38, 38, 54);
const HIDDEN = 1;
const PROBE_GUI_ANCHOR = new Vector2(1, 1);

function fontNamed(name: string): Enum.Font | undefined {
	return Enum.Font.GetEnumItems().find((f) => f.Name === name);
}

function yn(value: boolean): string {
	return value ? "yes" : "no";
}

/** A text label; `height` undefined grows with its text (AutomaticSize Y). */
function textLabel(
	parent: Instance,
	name: string,
	text: string,
	font: Enum.Font,
	size: number,
	width: number,
	height?: number,
): TextLabel {
	const label = new Instance("TextLabel");
	label.Name = name;
	label.BackgroundTransparency = HIDDEN;
	label.BorderSizePixel = 0;
	label.TextColor3 = TEXT;
	label.Font = font;
	label.TextSize = size;
	label.TextXAlignment = Enum.TextXAlignment.Left;
	label.TextYAlignment = Enum.TextYAlignment.Top;
	label.Size = UDim2.fromOffset(width, height ?? 0);
	if (height === undefined) label.AutomaticSize = Enum.AutomaticSize.Y;
	label.Text = text;
	label.Parent = parent;
	return label;
}

/** A transparent frame that stacks its children (vertical or horizontal) and grows to fit them. */
function stack(parent: Instance, name: string, order: number, horizontal: boolean): Frame {
	const frame = new Instance("Frame");
	frame.Name = name;
	frame.LayoutOrder = order;
	frame.BackgroundTransparency = HIDDEN;
	frame.BorderSizePixel = 0;
	frame.Size = UDim2.fromOffset(0, 0);
	frame.AutomaticSize = Enum.AutomaticSize.XY;
	const layout = new Instance("UIListLayout");
	layout.FillDirection = horizontal ? Enum.FillDirection.Horizontal : Enum.FillDirection.Vertical;
	layout.SortOrder = Enum.SortOrder.LayoutOrder;
	layout.Padding = new UDim(0, L10N_SPIKE.gap);
	layout.Parent = frame;
	frame.Parent = parent;
	return frame;
}

/** One glyph-sheet cell: the sample in `font` (clipped to the cell) and its TextFits / TextBounds line. */
interface GlyphCell {
	readonly sample: L10nSpikeSample;
	readonly label: TextLabel;
}

function metrics(label: TextLabel): string {
	return string.format(
		L10N_SPIKE.metricsFormat,
		yn(label.TextFits),
		math.round(label.TextBounds.X),
		math.round(label.TextBounds.Y),
	);
}

/** What the engine reports about locales and AutoLocalize (spike items c / d / e). */
function localeLines(): string[] {
	const player = Players.LocalPlayer;
	// Bare instances on purpose: the engine's AutoLocalize default is what L0 asks.
	const freshGui = new Instance("ScreenGui"); // check-autolocalize: allow (L0 spike reads the engine default)
	const freshLabel = new Instance("TextLabel");
	const guiDefault = freshGui.AutoLocalize;
	const labelDefault = freshLabel.AutoLocalize;
	const [hasDirection, direction] = pcall(() => freshLabel.TextDirection);
	freshGui.Destroy();
	freshLabel.Destroy();
	return [
		`LocalizationService.RobloxLocaleId = ${LocalizationService.RobloxLocaleId}`,
		`LocalizationService.SystemLocaleId = ${LocalizationService.SystemLocaleId}`,
		`Players.LocalPlayer.LocaleId = ${player.LocaleId}`,
		`AutoLocalize default: new ScreenGui = ${guiDefault}, new TextLabel = ${labelDefault}`,
		`TextLabel.TextDirection: ${hasDirection ? `yes (${tostring(direction)})` : `no (${tostring(direction)})`}`,
	];
}

/**
 * Spike L0 (docs/LOCALIZATION.md L0, docs/SPIKES.md "Spike L0"): what the engine does with the scripts we may ship.
 * A scrolling sheet: (a) glyph cells, one row per font candidate and one column per locale / script, each with its
 * TextFits and TextBounds; (b) wrapped-text boxes per script and the Arabic sample in each TextDirection; (c) the
 * locale ids and AutoLocalize defaults (also printed); (d) three AutoLocalize probe labels whose text is
 * L10N_SPIKE_PROBE_SOURCE, two of them in a second ScreenGui with AutoLocalize on (bottom right).
 *
 * Off unless `KV_L10nSpike` (or SPIKE_DEFAULTS.l10n) is true; turning it off destroys everything it made (one Janitor).
 */
@Controller({})
export class L10nSpikeController implements OnStart {
	private session?: Janitor;

	onStart(): void {
		watchSpikeFlag("l10n", (enabled) => (enabled ? this.start() : this.stop()));
	}

	private stop(): void {
		this.session?.Destroy();
		this.session = undefined;
	}

	private start(): void {
		if (this.session !== undefined) return;
		const janitor = new Janitor();
		this.session = janitor;
		const playerGui = Players.LocalPlayer.WaitForChild("PlayerGui");
		const S = L10N_SPIKE;

		const gui = janitor.Add(
			createKvScreenGui(GUI_NAME, {
				ResetOnSpawn: false,
				DisplayOrder: S.displayOrder,
				ZIndexBehavior: Enum.ZIndexBehavior.Sibling,
				ScreenInsets: Enum.ScreenInsets.CoreUISafeInsets,
			}),
		);
		const scroller = new Instance("ScrollingFrame");
		scroller.Name = "Sheet";
		scroller.Position = UDim2.fromOffset(S.margin, S.margin);
		scroller.Size = new UDim2(1, -2 * S.margin, 1, -2 * S.margin);
		scroller.BackgroundColor3 = BACKDROP;
		scroller.BackgroundTransparency = S.backdropTransparency;
		scroller.BorderSizePixel = 0;
		scroller.CanvasSize = UDim2.fromOffset(0, 0);
		scroller.AutomaticCanvasSize = Enum.AutomaticSize.XY;
		scroller.ScrollingDirection = Enum.ScrollingDirection.XY;
		const padding = new Instance("UIPadding");
		padding.PaddingLeft = new UDim(0, S.margin);
		padding.PaddingTop = new UDim(0, S.margin);
		padding.PaddingRight = new UDim(0, S.margin);
		padding.PaddingBottom = new UDim(0, S.margin);
		padding.Parent = scroller;
		const layout = new Instance("UIListLayout");
		layout.SortOrder = Enum.SortOrder.LayoutOrder;
		layout.Padding = new UDim(0, S.gap);
		layout.Parent = scroller;
		scroller.Parent = gui;

		let order = 0;
		const heading = (text: string) => {
			order += 1;
			const label = textLabel(scroller, `H${order}`, text, MONO_FONT, S.infoTextSize, 0);
			label.AutomaticSize = Enum.AutomaticSize.XY;
			label.TextColor3 = CAPTION;
			label.LayoutOrder = order;
			return label;
		};

		// (c) Locale ids and AutoLocalize defaults: on screen and printed, again whenever an id changes.
		heading(`${GUI_NAME} (docs/SPIKES.md "Spike L0"); workspace:SetAttribute("${GUI_NAME}", false) closes it`);
		const info = heading("");
		info.TextColor3 = TEXT;
		const refreshInfo = (why: string) => {
			const lines = localeLines();
			info.Text = lines.join("\n");
			print(`${LOG} ${why}:\n  ${lines.join("\n  ")}`);
		};
		refreshInfo("locale ids");
		janitor.Add(
			Players.LocalPlayer.GetPropertyChangedSignal("LocaleId").Connect(() => refreshInfo("LocaleId changed")),
		);
		janitor.Add(
			LocalizationService.GetPropertyChangedSignal("RobloxLocaleId").Connect(() =>
				refreshInfo("RobloxLocaleId changed"),
			),
		);

		// (a) Glyph sheet.
		heading(
			"(a) Glyph sheet: one row per font, one column per locale / script; under each cell TextFits and TextBounds",
		);
		order += 1;
		const header = stack(scroller, "Header", order, true);
		textLabel(header, "Font", "font", MONO_FONT, S.infoTextSize, S.fontColumnWidth).TextColor3 = CAPTION;
		L10N_SPIKE_SAMPLES.forEach((sample, i) => {
			const label = textLabel(
				header,
				sample.id,
				`${sample.id} (${sample.script})`,
				MONO_FONT,
				S.infoTextSize,
				S.cellWidth,
			);
			label.TextColor3 = CAPTION;
			label.LayoutOrder = i + 1;
		});
		const cells = new Map<string, GlyphCell[]>();
		for (const fontName of L10N_SPIKE_FONTS) {
			order += 1;
			const row = stack(scroller, `Row_${fontName}`, order, true);
			const font = fontNamed(fontName);
			const name = textLabel(
				row,
				"Font",
				font ? fontName : `${fontName} (missing)`,
				MONO_FONT,
				S.infoTextSize,
				S.fontColumnWidth,
			);
			if (!font) {
				name.TextColor3 = MISSING;
				warn(`${LOG} Enum.Font.${fontName} does not exist`);
				continue;
			}
			const rowCells: GlyphCell[] = [];
			L10N_SPIKE_SAMPLES.forEach((sample, i) => {
				const cell = new Instance("Frame");
				cell.Name = sample.id;
				cell.LayoutOrder = i + 1;
				cell.BackgroundColor3 = CELL;
				cell.BorderSizePixel = 0;
				cell.ClipsDescendants = true;
				cell.Size = UDim2.fromOffset(S.cellWidth, S.cellHeight + S.metricsHeight);
				const glyph = textLabel(
					cell,
					"Glyphs",
					sample.glyphs,
					font,
					S.glyphTextSize,
					S.cellWidth,
					S.cellHeight,
				);
				glyph.TextYAlignment = Enum.TextYAlignment.Center;
				const line = textLabel(cell, "Metrics", "", MONO_FONT, S.metricsTextSize, S.cellWidth, S.metricsHeight);
				line.Position = UDim2.fromOffset(0, S.cellHeight);
				line.TextColor3 = CAPTION;
				const update = () => {
					line.Text = metrics(glyph);
				};
				glyph.GetPropertyChangedSignal("TextBounds").Connect(update);
				glyph.GetPropertyChangedSignal("TextFits").Connect(update);
				update();
				cell.Parent = row;
				rowCells.push({ sample, label: glyph });
			});
			cells.set(fontName, rowCells);
		}

		// (b) Wrapped text per script, in each wrap font, then the Arabic sample in each TextDirection.
		heading("(b) Wrapped text (TextWrapped): CJK and Thai line breaks, the long German word, Arabic order");
		for (const fontName of S.wrapFonts) {
			const font = fontNamed(fontName) ?? MONO_FONT;
			order += 1;
			const row = stack(scroller, `Wrap_${fontName}`, order, true);
			textLabel(row, "Font", fontName, MONO_FONT, S.infoTextSize, S.fontColumnWidth).TextColor3 = CAPTION;
			L10N_SPIKE_WRAP_SAMPLES.forEach((sample, i) => {
				const box = stack(row, sample.id, i + 1, false);
				textLabel(box, "Id", sample.id, MONO_FONT, S.metricsTextSize, S.wrapWidth, S.metricsHeight).TextColor3 =
					CAPTION;
				const text = textLabel(box, "Text", sample.text, font, S.wrapTextSize, S.wrapWidth);
				text.TextWrapped = true;
				text.LayoutOrder = 1;
				text.BackgroundColor3 = CELL;
				text.BackgroundTransparency = 0;
			});
		}
		const arabic = L10N_SPIKE_WRAP_SAMPLES.find((s) => s.script === "arabic");
		if (arabic) {
			heading("Arabic in each TextDirection (set through pcall; right-aligned)");
			for (const fontName of S.wrapFonts) {
				const font = fontNamed(fontName) ?? MONO_FONT;
				order += 1;
				const row = stack(scroller, `Direction_${fontName}`, order, true);
				textLabel(row, "Font", fontName, MONO_FONT, S.infoTextSize, S.fontColumnWidth).TextColor3 = CAPTION;
				S.directions.forEach((directionName, i) => {
					const box = stack(row, directionName, i + 1, false);
					const caption = textLabel(
						box,
						"Id",
						directionName,
						MONO_FONT,
						S.metricsTextSize,
						S.directionWidth,
						S.metricsHeight,
					);
					caption.TextColor3 = CAPTION;
					const text = textLabel(box, "Text", arabic.text, font, S.wrapTextSize, S.directionWidth);
					text.TextWrapped = true;
					text.TextXAlignment = Enum.TextXAlignment.Right;
					text.LayoutOrder = 1;
					text.BackgroundColor3 = CELL;
					text.BackgroundTransparency = 0;
					const [ok, err] = pcall(() => {
						const item = Enum.TextDirection.GetEnumItems().find((e) => e.Name === directionName);
						if (item === undefined) error(`no Enum.TextDirection.${directionName}`, 0);
						text.TextDirection = item;
					});
					if (!ok) caption.Text = `${directionName}: not set (${tostring(err)})`;
				});
			}
		}

		// (d) AutoLocalize probe (spike item e): the same Source string in three labels.
		heading(
			`(d) AutoLocalize probe, text "${L10N_SPIKE_PROBE_SOURCE}" (bottom right: a ScreenGui with AutoLocalize on)`,
		);
		order += 1;
		const offRoot = stack(scroller, "ProbeOffRoot", order, false);
		textLabel(
			offRoot,
			"Caption",
			"3. root off, label on: English if a root's false covers its subtree",
			MONO_FONT,
			S.metricsTextSize,
			S.probeWidth,
			S.metricsHeight,
		).TextColor3 = CAPTION;
		const offRootLabel = textLabel(
			offRoot,
			"Probe",
			L10N_SPIKE_PROBE_SOURCE,
			MONO_FONT,
			S.probeTextSize,
			S.probeWidth,
			S.probeHeight,
		);
		offRootLabel.LayoutOrder = 1;
		offRootLabel.AutoLocalize = true;

		const probeGui = janitor.Add(
			createKvScreenGui(PROBE_GUI_NAME, {
				ResetOnSpawn: false,
				DisplayOrder: S.displayOrder + 1,
				ScreenInsets: Enum.ScreenInsets.CoreUISafeInsets,
			}),
		);
		probeGui.AutoLocalize = true; // the spike's one AutoLocalize-on root: item (e) compares it with ours
		const probes = stack(probeGui, "Probes", 0, false);
		probes.AnchorPoint = PROBE_GUI_ANCHOR;
		probes.Position = new UDim2(1, -S.margin, 1, -S.margin);
		probes.BackgroundColor3 = BACKDROP;
		probes.BackgroundTransparency = S.backdropTransparency;
		const probeSpecs: ReadonlyArray<[string, boolean]> = [
			["1. root on, label on: translated if the table has it", true],
			["2. root on, label off: English", false],
		];
		const probeLabels = [offRootLabel];
		probeSpecs.forEach(([caption, on], i) => {
			const c = textLabel(
				probes,
				`Caption${i}`,
				caption,
				MONO_FONT,
				S.metricsTextSize,
				S.probeWidth,
				S.metricsHeight,
			);
			c.TextColor3 = CAPTION;
			c.LayoutOrder = 2 * i;
			const probe = textLabel(
				probes,
				`Probe${i}`,
				L10N_SPIKE_PROBE_SOURCE,
				MONO_FONT,
				S.probeTextSize,
				S.probeWidth,
				S.probeHeight,
			);
			probe.LayoutOrder = 2 * i + 1;
			probe.AutoLocalize = on;
			probeLabels.push(probe);
		});

		gui.Parent = playerGui;
		probeGui.Parent = playerGui;

		// The sheet's metrics, printed once layout has settled (copy them into docs/SPIKES.md).
		task.delay(S.logDelaySec, () => {
			if (this.session !== janitor) return;
			for (const fontName of L10N_SPIKE_FONTS) {
				const row = cells.get(fontName);
				if (!row) continue;
				const parts = row.map((c) => `${c.sample.id} ${metrics(c.label)}`);
				print(`${LOG} ${fontName}: ${parts.join(" | ")}`);
			}
			print(`${LOG} probe texts (3, 1, 2): ${probeLabels.map((l) => `"${l.Text}"`).join(", ")}`);
		});
		print(`${LOG} on: ${GUI_NAME} + ${PROBE_GUI_NAME} (docs/SPIKES.md "Spike L0")`);
	}
}
