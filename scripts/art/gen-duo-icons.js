#!/usr/bin/env node
/*
 * The duo icons: original 16 x 16 pixel art drawn by code, one icon per duo (DUOS order, shared/sim builds
 * buildsData.ts), so they need no third-party pack. The same kit as the boon icons (scripts/art/gen-boon-icons.js:
 * 14 x 14 palette-character maps centred on the canvas, auto-outlined, glows unoutlined, lit from the top left) and
 * exactly its palette, so a duo sits beside its boons as one set. Each icon draws what the duo DOES, in its two boons'
 * colours (Fire Arrows: a flaming arrow; Powder Keg: a keg with a lit fuse), not the two boon icons side by side.
 * A new duo's icon is appended to ICONS (DUOS order) and to art/atlases.json `duoIcons.order` (the sheet only appends,
 * so an uploaded sheet keeps its rects).
 *
 *   node scripts/art/gen-duo-icons.js [outDir] [--contact <file.png>]   (default art/vendor/kaleb-vale/duo-icons)
 *
 * Writes duo_<name>.png (name = the duo id without "duo.", e.g. duo_fireArrows.png). `--contact` also writes a review
 * sheet (every icon at 1x and 6x on the UI's panel colour, named). Same inputs, byte-identical PNGs (no timestamps,
 * fixed encoder options).
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { PNG } = require("pngjs");
const BOON = require("./gen-boon-icons.js");

const { SIZE, MAP, OUTLINE, FONT, PALETTE } = BOON;

/** The icons in DUOS order: [duo id, 14 rows of 14 palette characters]. */
const ICONS = [
	// Fire Arrows (Ember Wake + Piercing Arrows: arrows leave embers): an arrow in flames, embers falling from it
	["duo.fireArrows", [
		"..............",
		"..............",
		"..............",
		"........gG....",
		"......gGGgE...",
		"...~+gGGGgET..",
		"pp~+gGGGGgEtT.",
		".pWWEgGGgEWttT",
		"pp.~+EgggEeSS.",
		"......EEEe.S..",
		"..............",
		"....~.....+...",
		".......~......",
		"..............",
	]],
	// Blazing Trail (Ember Wake + Slippery: rolls leave embers): the ghost rolling away from its trail of flames
	["duo.blazingTrail", [
		".........444..",
		"........44443.",
		"........4o4o3.",
		"........44443.",
		"--......44433.",
		"........44333.",
		"---.....43333.",
		"........4.3.3.",
		"......G.......",
		"....G.gG......",
		".G.gGgEgG.....",
		"gGEEgGEEgE....",
		"EgEeEgEeEgE...",
		"eeeeeeeeeee...",
	]],
	// Storm Blade (Chain Spark + Swift Strikes: finishers spark): a blade, a lightning bolt and the sparks on its edge
	["duo.stormBlade", [
		"...cC........T",
		"..cCb.......Tt",
		".cCCCc.....TtS",
		"...cCb....TtS^",
		"..cCb....TtS..",
		"..Cb....TtS.^.",
		"^...g..TtS....",
		"....EgTtS..^..",
		".....Eg.......",
		".....WEg......",
		"....Ww.Eg.....",
		"...Ww...E.....",
		".gg...........",
		".EE...........",
	]],
	// Conductor (Chain Spark + Piercing Arrows: an arrow through an enemy sparks): an arrow through a spark, forking
	["duo.conductor", [
		".....^........",
		"......^.......",
		".....^^.......",
		"......^.......",
		"......c.......",
		".....cCc...T..",
		"pp..cCCCb..tT.",
		".pWWC**CBWWttT",
		"pp..cCCCb..SS.",
		".....cBb...S..",
		"......b.......",
		".......^......",
		"......^^......",
		".......^......",
	]],
	// Shrapnel (Volatile + Sharpened: burst bolts hit harder and pierce): a burst flinging steel shards
	["duo.shrapnel", [
		"Tt..........tT",
		"tS....m.....St",
		"..S...p....S..",
		"......h.......",
		"....hHhhHh....",
		"....HhhhhH....",
		".mphhh**hhhpm.",
		"....hh**hhH...",
		"....HhhhhH....",
		"....hHhhHh....",
		"..S...h....S..",
		"tS....p.....St",
		"Tt....m.....tT",
		"..............",
	]],
	// Chain Reaction (Volatile + Chain Spark: spark kills burst, burst kills spark): a bolt striking a burst
	["duo.chainReaction", [
		"..........cCC.",
		".........cCCb.",
		"........cCCb..",
		".......cCCCCCc",
		".........BcCCb",
		"....m...cCCb..",
		"....p..cCb....",
		"..hHhHhcb.....",
		"..Hh*hH.......",
		"mph***hpm.....",
		"..Hh*hH.......",
		"..hHhHh.......",
		"....p.........",
		"....m.........",
	]],
	// Close Call (Soul Shards + Daredevil: grazes release a shard): a bullet grazing past, a shard leaving the spark
	["duo.closeCall", [
		"..............",
		"..mmR.........",
		".mppmR==-==-..",
		".mpmmR........",
		".mmmRR==-=-...",
		"..RRr.........",
		"......+.......",
		".....+*+....x.",
		"......+....xV.",
		"..........xVv.",
		".........xVv..",
		"........xVv...",
		".......:Vv....",
		"......:.v.....",
	]],
	// Gold Rush (Bounty + Lingering: kills at a high combo score more): an hourglass of gold, coins stacked beside it
	["duo.goldRush", [
		"............~.",
		"WWWWWWWWWW.+*+",
		"wwwwwwwwww..~.",
		".QggggggQ.....",
		".QQGgggqq.....",
		"..QQGgqq......",
		"...QQgq.......",
		"...QQgq...gggg",
		"..QQQgqq..EggE",
		".QQQQgqqq.gGGg",
		".QQgggGqq.EggE",
		"WWWWWWWWWWgGGg",
		"wwwwwwwwwwEggE",
		"..........EEEE",
	]],
	// Unshaken (Composure + Warding: hits on armor never cut the combo): a steel shield bearing a balanced cairn
	["duo.unshaken", [
		"..............",
		".......LL.....",
		"......LllK....",
		"......lKKK....",
		"..............",
		".....LLLLll...",
		"....LlllllllK.",
		"SSSSSSoKKKKK..",
		"STTttS........",
		"STmptSollllll.",
		"STRmsSollllllK",
		".STsS.ollllKKK",
		"..SS..oKKKKKK.",
		"..............",
	]],
	// Supernova (Overkill + Volatile: big overkills burst a ring bigger): a burst inside a ring of gold
	["duo.supernova", [
		"..............",
		"....gGGGGg....",
		"..gGe....eEg..",
		".gE...pp...Eg.",
		".Ge..hHHh..eE.",
		"gG..hh**hh..Ee",
		"gG.pH****Hp.Ee",
		"gG.pH****Hp.Ee",
		"gG..hh**hh..Ee",
		".Ge..hHHh..eE.",
		".gE...pp...Eg.",
		"..gEe....eEe..",
		"....eEEEEe....",
		"..............",
	]],
	// Skewer (Overkill + Piercing Arrows: the streak strikes every enemy in its line): a gold streak through three
	["duo.skewer", [
		".............G",
		"..........mm+.",
		".........mpGR.",
		".........mGRR.",
		".........+RR..",
		"......mm+.....",
		".....mpGR.....",
		".....mGRR.....",
		".....+RR......",
		"..mm+.........",
		".mpGR.........",
		".mGRR.........",
		".+RR..........",
		"~.............",
	]],
	// Citadel (Bastion + Warding: guards that stop 8 bullets restore a pip): a keep with a warding shield on its gate
	["duo.citadel", [
		"L.L.......L.L.",
		"LLlK......LLlK",
		"LllK......LllK",
		"LlkK.L.L..LlkK",
		"LllKLlLlLKLllK",
		"LllKSSSSSSLllK",
		"LlKKSTTttSLlKK",
		"LllKSTmptSLllK",
		"LlKKSTRmsSLlKK",
		"LllKSTttsSLllK",
		"LlKKlSTsSKLlKK",
		"LllKllSSlKLllK",
		"LKKKKKKKKKKKKK",
		"..............",
	]],
	// Stone Heart (Bastion + Hearty: a brace at full armor heals): a heart of stone, cracked through to the red
	["duo.stoneHeart", [
		"..............",
		"..............",
		"..LLLl..LLlK..",
		".LLlllKmLlllK.",
		".LllllmllllKK.",
		".LlllllmlllKK.",
		"..llllmlllKK..",
		"...llllplKK...",
		"....llmKKk....",
		".....lKRk.....",
		"......Kk......",
		"..............",
		"..............",
		"..............",
	]],
	// Thunder Guard (Riposte + Chain Spark: every blocked bullet sparks to an enemy): the raised guard, a bolt leaving it
	["duo.thunderGuard", [
		"..T...........",
		"..TS......cC..",
		"..TS.....cCb..",
		"..tS.+..cCb...",
		"..tS+*+cCCCCc.",
		"..tS.+...cCCb.",
		"..tS....cCb...",
		"..tS...cCb....",
		"..tS...cb.....",
		"egGGge........",
		"..wW..........",
		"..wW..........",
		".EggE.........",
		"..............",
	]],
	// Stillwater (Composure + Riposte: a block right after a hit gives the combo back): a drop on still water
	["duo.stillwater", [
		"......Q.......",
		"......Qq......",
		".....QQqq.....",
		".....Q*qq.....",
		".....QQqq.....",
		"......qq......",
		"..............",
		"..............",
		"...^^^^^^^^...",
		".^^........^^.",
		"^.....uU.....^",
		".^^........^^.",
		"...^^^^^^^^...",
		"..............",
	]],
	// Rebuke (Bastion + Riposte: a brace fires the counter-wave as a full ring): a tower inside the green ring
	["duo.rebuke", [
		"....NNuuNN....",
		"..Nu......uN..",
		".N..........N.",
		".u..L.LL.L..u.",
		"N...LllllK...u",
		"N....LllKK...u",
		"N....LlkKK...u",
		"N....LllKK...u",
		"N....LwwKK...u",
		".u..LlwwwKK.u.",
		".N.LLlllllKKN.",
		"..Nu......uN..",
		"....NNuuNN....",
		"..............",
	]],
	// Dragon Bolt (Ballista + Ember Wake: charged arrows leave a line of embers): a siege bolt over its line of fire
	["duo.dragonBolt", [
		"..............",
		"..........T...",
		"A.A.......tT..",
		"AWWWWWWWWWttTT",
		"AwwwwwwwwwSSsS",
		"A.A.......Ss..",
		"..........s...",
		"...........G..",
		"........G.gGg.",
		".....G.gGgEgGE",
		"..G.gGgEgGEEgE",
		".gGEEgGEEggEEe",
		"eEgEeEgEeEggEe",
		".eeeeeeeeeeee.",
	]],
	// Powder Keg (Wrecker + Volatile: broken pieces fire the on-kill boons): a keg, its fuse lit
	["duo.powderKeg", [
		"...........+..",
		"..........+*+.",
		".........w.+..",
		"........w.....",
		".......w......",
		"..WAAAAAAAW...",
		".SSSSSSSSSSS..",
		".AAWAAAWAAWw..",
		".AAWAAAWAAWw..",
		".SSSSSSSSSSS..",
		".AAWAAAWAAWw..",
		".AAWAAAWAAWw..",
		".SSSSSSSSSSS..",
		"..wwwwwwwww...",
	]],
	// Full Heart (Hearty + Sharpened: at full hearts finishers fire a beam): a full heart sending out a beam
	["duo.fullHeart", [
		"..............",
		"..............",
		"..............",
		"..............",
		".mm..mm.......",
		"mppmmmmR.~++++",
		"mpmmmmmRgGG***",
		"mmmmmmRRgGG***",
		".mmmmRR..~++++",
		"..mmRR........",
		"...RR.........",
		"..............",
		"..............",
		"..............",
	]],
	// Happy Hour (Deep Flask + Bounty: a flask doubles kill points for a while): a flask of liquid gold and coins
	["duo.happyHour", [
		"....WW.....~..",
		"....ww....~*~.",
		"....QQ.....~..",
		"....Qq........",
		"....Qq........",
		"...QQqq.......",
		"..QQqqqq..gggg",
		".QQggggqq.gGGg",
		".QGgggggq.EggE",
		"QQGgggggEqgGGg",
		"QGgggg*gEqEggE",
		"QggggggEEqgGGg",
		".qEEEEEEq.EggE",
		"..qqqqqq..EEEE",
	]],
];

/** The icon's output file name: duo_<id without "duo.">.png. */
function fileOf(id) {
	return `duo_${id.replace(/^duo\./, "")}.png`;
}

/** The map of `id` (a programming error when absent or malformed). */
function mapOf(id) {
	const entry = ICONS.find((e) => e[0] === id);
	if (entry === undefined) throw new Error(`gen-duo-icons: no icon "${id}"`);
	const rows = entry[1];
	if (rows.length !== MAP || rows.some((r) => r.length !== MAP)) {
		const bad = rows.map((r, i) => [i, r.length]).filter(([, n]) => n !== MAP);
		throw new Error(`gen-duo-icons: ${id} is not ${MAP} x ${MAP} (${rows.length} rows; bad ${JSON.stringify(bad)})`);
	}
	for (const row of rows) {
		for (const ch of row) {
			if (ch !== "." && PALETTE[ch] === undefined) throw new Error(`gen-duo-icons: ${id}: unknown colour "${ch}"`);
		}
	}
	return rows;
}

/** The icon as palette characters on the full canvas, outline filled in: SIZE rows of SIZE characters. */
function drawIcon(id) {
	const rows = mapOf(id);
	const grid = Array.from({ length: SIZE }, () => new Array(SIZE).fill("."));
	for (let y = 0; y < MAP; y++) for (let x = 0; x < MAP; x++) grid[y + 1][x + 1] = rows[y][x];
	const outlined = (x, y) => {
		if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return false;
		const ch = grid[y][x];
		return ch !== "." && ch !== "#" && PALETTE[ch].outlined;
	};
	for (let y = 0; y < SIZE; y++) {
		for (let x = 0; x < SIZE; x++) {
			if (grid[y][x] !== ".") continue;
			if (outlined(x - 1, y) || outlined(x + 1, y) || outlined(x, y - 1) || outlined(x, y + 1)) grid[y][x] = "#";
		}
	}
	return grid.map((r) => r.map((ch) => (ch === "#" ? "o" : ch)).join(""));
}

/** RGBA bytes of an icon (SIZE x SIZE). */
function rgbaOf(id) {
	const rows = drawIcon(id);
	const data = Buffer.alloc(SIZE * SIZE * 4);
	for (let y = 0; y < SIZE; y++) {
		for (let x = 0; x < SIZE; x++) {
			const ch = rows[y][x];
			if (ch === ".") continue;
			const i = (y * SIZE + x) * 4;
			const [r, g, b] = PALETTE[ch].rgb;
			data[i] = r;
			data[i + 1] = g;
			data[i + 2] = b;
			data[i + 3] = 255;
		}
	}
	return data;
}

/** The icon's PNG bytes. */
function renderIcon(id) {
	const png = new PNG({ width: SIZE, height: SIZE });
	rgbaOf(id).copy(png.data);
	return PNG.sync.write(png, { colorType: 6 });
}

/** A review sheet: per icon, 1x and SCALE x on the UI panel colour, named. */
function renderContact(scale = 6, perRow = 5) {
	const cellW = SIZE * scale + SIZE + 24;
	const cellH = SIZE * scale + 22;
	const cols = Math.min(perRow, ICONS.length);
	const rowsN = Math.ceil(ICONS.length / cols);
	const W = cols * cellW + 8;
	const H = rowsN * cellH + 8;
	const png = new PNG({ width: W, height: H });
	const bg = [28, 22, 24];
	for (let i = 0; i < W * H; i++) {
		png.data[i * 4] = bg[0];
		png.data[i * 4 + 1] = bg[1];
		png.data[i * 4 + 2] = bg[2];
		png.data[i * 4 + 3] = 255;
	}
	const set = (x, y, [r, g, b]) => {
		if (x < 0 || y < 0 || x >= W || y >= H) return;
		const i = (y * W + x) * 4;
		png.data[i] = r;
		png.data[i + 1] = g;
		png.data[i + 2] = b;
	};
	ICONS.forEach(([id], n) => {
		const ox = 8 + (n % cols) * cellW;
		const oy = 8 + Math.floor(n / cols) * cellH;
		const px = rgbaOf(id);
		for (let y = 0; y < SIZE; y++) {
			for (let x = 0; x < SIZE; x++) {
				const i = (y * SIZE + x) * 4;
				if (px[i + 3] === 0) continue;
				const c = [px[i], px[i + 1], px[i + 2]];
				set(ox + x, oy + y, c);
				for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) set(ox + SIZE + 8 + x * scale + dx, oy + y * scale + dy, c);
			}
		}
		const label = id.replace(/^duo\./, "").toUpperCase().slice(0, 16);
		[...label].forEach((ch, k) => {
			const glyph = FONT[ch] ?? FONT[" "];
			for (let gy = 0; gy < 5; gy++) for (let gx = 0; gx < 3; gx++) {
				if (glyph[gy * 3 + gx] === "1") set(ox + k * 4 + gx, oy + SIZE * scale + 8 + gy, [215, 204, 180]);
			}
		});
	});
	return PNG.sync.write(png, { colorType: 6 });
}

const DUO_IDS = ICONS.map((e) => e[0]);

if (require.main === module) {
	const args = process.argv.slice(2);
	let contact;
	const ci = args.indexOf("--contact");
	if (ci >= 0) {
		contact = args[ci + 1];
		args.splice(ci, 2);
	}
	const outDir = args[0] ?? path.join(__dirname, "..", "..", "art", "vendor", "kaleb-vale", "duo-icons");
	fs.mkdirSync(outDir, { recursive: true });
	for (const id of DUO_IDS) fs.writeFileSync(path.join(outDir, fileOf(id)), renderIcon(id));
	if (contact !== undefined) fs.writeFileSync(contact, renderContact());
	console.log(`gen-duo-icons: ${DUO_IDS.length} icons -> ${outDir}`);
}

module.exports = { SIZE, MAP, OUTLINE, PALETTE, ICONS, DUO_IDS, fileOf, drawIcon, rgbaOf, renderIcon, renderContact };
