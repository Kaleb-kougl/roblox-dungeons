#!/usr/bin/env node
/*
 * The boon icons: original 16 x 16 pixel art drawn by code, one icon per boon (BOONS order, shared/sim progression
 * progressionData.ts), so they need no third-party pack. Full colour in the dark red UI's palette (the ToffeeCraft
 * Horror UI sheet's bone, blood red, steel, glass, wood and candle gold, sampled from art/build/ui-icons.png) plus three
 * accents the build effects already use (spark blue, burst peach, shard lilac), lit from the top left.
 *
 *   node scripts/art/gen-boon-icons.js [outDir] [--contact <file.png>]   (default art/vendor/kaleb-vale/boon-icons)
 *
 * Writes boon_<name>.png (name = the boon id without "boon.", e.g. boon_sharpened.png). Each icon is a 14 x 14 map of
 * palette characters (ICONS) centred on the 16 x 16 canvas; every transparent pixel 4-next to an OUTLINED colour becomes
 * the outline, so the 1 px border is outline only and never clipped. Glow colours (sparkles, streaks, the spark's
 * halo) take no outline and make none. Rarity is not in the icon (the card and cell frames carry it). `--contact`
 * also writes a review sheet (every icon at 1x and 6x on the UI's panel colour, with its name). Same inputs,
 * byte-identical PNGs (no timestamps, fixed encoder options).
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { PNG } = require("pngjs");

/** Canvas side, px. */
const SIZE = 16;
/** The drawn map's side, px: one px of outline room on every side. */
const MAP = SIZE - 2;
/** The outline colour (the sheet's near black, warmed a touch). */
const OUTLINE = [16, 9, 10];

/**
 * Palette: character -> [r, g, b] and whether it is outlined. `.` is transparent, `o` the outline drawn by hand
 * (interior lines: eye sockets, cracks, seams).
 */
const PALETTE = {
	o: { rgb: OUTLINE, outlined: true },
	// bone (the candle wax and skulls)
	1: { rgb: [120, 104, 80], outlined: true },
	2: { rgb: [168, 150, 118], outlined: true },
	3: { rgb: [215, 204, 180], outlined: true },
	4: { rgb: [246, 241, 230], outlined: true },
	// blood red (the hearts and flasks)
	r: { rgb: [74, 0, 0], outlined: true },
	R: { rgb: [128, 6, 12], outlined: true },
	m: { rgb: [198, 11, 33], outlined: true },
	p: { rgb: [242, 97, 100], outlined: true },
	// steel
	s: { rgb: [78, 80, 90], outlined: true },
	S: { rgb: [128, 130, 140], outlined: true },
	t: { rgb: [182, 186, 194], outlined: true },
	T: { rgb: [232, 236, 242], outlined: true },
	// candle gold / ember
	e: { rgb: [138, 58, 18], outlined: true },
	E: { rgb: [214, 112, 34], outlined: true },
	g: { rgb: [241, 189, 68], outlined: true },
	G: { rgb: [255, 236, 150], outlined: true },
	// wood / leather
	w: { rgb: [66, 46, 32], outlined: true },
	W: { rgb: [112, 80, 52], outlined: true },
	// glass (the flasks' pale blue)
	q: { rgb: [124, 150, 170], outlined: true },
	Q: { rgb: [200, 222, 236], outlined: true },
	// spark blue (build.spark #88d4fc)
	b: { rgb: [34, 80, 150], outlined: true },
	B: { rgb: [70, 150, 230], outlined: true },
	c: { rgb: [136, 212, 252], outlined: true },
	C: { rgb: [226, 246, 255], outlined: true },
	// shard lilac (build.shard #f4e8f8)
	v: { rgb: [96, 62, 134], outlined: true },
	V: { rgb: [168, 128, 206], outlined: true },
	x: { rgb: [244, 232, 248], outlined: true },
	// burst peach (build.burst #f8c8a0)
	h: { rgb: [248, 200, 160], outlined: true },
	H: { rgb: [214, 130, 100], outlined: true },
	// stone (warm grey)
	k: { rgb: [70, 62, 60], outlined: true },
	K: { rgb: [112, 102, 96], outlined: true },
	l: { rgb: [158, 148, 138], outlined: true },
	L: { rgb: [204, 196, 186], outlined: true },
	// glows: no outline
	"*": { rgb: [255, 255, 240], outlined: false },
	"+": { rgb: [255, 236, 150], outlined: false },
	"~": { rgb: [241, 189, 68], outlined: false },
	"-": { rgb: [182, 186, 194], outlined: false },
	"=": { rgb: [242, 97, 100], outlined: false },
	"^": { rgb: [136, 212, 252], outlined: false },
	":": { rgb: [168, 128, 206], outlined: false },
};

/** The icons in BOONS order: [boon id, 14 rows of 14 palette characters]. */
const ICONS = [
	// Sharpened (+25% damage): a blade with a whetstone glint
	["boon.sharpened", [
		"..~..........T",
		"..+.........Tt",
		"~+*+~......TtS",
		"..+.......TtS.",
		"..~......TtS..",
		"........TtS...",
		"....g..TtS....",
		"....EgTtS.....",
		".....Eg.......",
		".....WEg......",
		"....Ww.Eg.....",
		"...Ww...E.....",
		".gg...........",
		".EE...........",
	]],
	// Swift Strikes (attacks recover faster): a dagger thrust with speed streaks
	["boon.swiftStrikes", [
		"..............",
		"..............",
		"..............",
		"-------.......",
		"..............",
		"-----g........",
		".....gTTTTTT..",
		".gWWWgtttttttT",
		".EwwwESSSSSS..",
		"-----E........",
		"..............",
		"-------.......",
		"..............",
		"..............",
	]],
	// Piercing Arrows (pierce one more enemy): an arrow through a blood orb
	["boon.piercingArrows", [
		"...........TTT",
		"..........t.TT",
		"...........WtS",
		"..........W.S.",
		".....mmR.W....",
		"....mpmRW.....",
		"...mpmmWRr....",
		"...mmmWRRr....",
		"...mRWRRrr....",
		"....WRrrr.....",
		"...W.Rrr......",
		"p.W...........",
		"pW............",
		".pp...........",
	]],
	// Ember Wake (rolling fires a ring of bolts): eight ember bolts flying off a roll's ring
	["boon.emberWake", [
		"......G.......",
		"..g...g...g...",
		"...E..E..E....",
		"..............",
		".....eEEe.....",
		"....eE..Ee....",
		"GgE.E....E.EgG",
		"....E....E....",
		"....eE..Ee....",
		".....eEEe.....",
		"..............",
		"...E..E..E....",
		"..g...g...g...",
		"......G.......",
	]],
	// Hearty (+1 heart): a heart and a plus
	["boon.hearty", [
		"..........4...",
		"..........4...",
		"........44444.",
		"..........4...",
		"..........4...",
		".mmm..mmm.....",
		"mppmmmmmmR....",
		"mpmmmmmmmR....",
		"mmmmmmmmRR....",
		".mmmmmmRR.....",
		"..mmmmRR......",
		"...mmRR.......",
		"....RR........",
		"..............",
	]],
	// Slippery (longer roll invulnerability): a ghost a bullet passes through
	["boon.slippery", [
		"..............",
		"....4444......",
		"...444443.....",
		"..44444443....",
		"..4oo44oo3....",
		"..4oo44oo3....",
		"..44444433.ppm",
		"==4======3=pmR",
		"..44443333.mRR",
		"..44433333....",
		"..4433333q....",
		"..433333qq....",
		"..43.33.3q....",
		"..............",
	]],
	// Deep Flask (+1 flask charge): a tall flask and a plus
	["boon.deepFlask", [
		".....WW...4...",
		".....ww...4...",
		".....QQ.44444.",
		".....Qq...4...",
		".....Qq...4...",
		"....QQqq......",
		"...QQqqqq.....",
		"..QQmmmmqq....",
		"..Qpmmmmmq....",
		".QQpmmmmmRq...",
		".Qpmmmm+mRq...",
		".QmmmmmmRRq...",
		"..qRRRRRRq....",
		"...qqqqqq.....",
	]],
	// Warding (an armor pip each room): a steel shield with a blood gem
	["boon.warding", [
		"..............",
		"..SSSSSSSSSS..",
		"..STTTTttttS..",
		"..STTttttttS..",
		"..STtttmttsS..",
		"..STttmpmtsS..",
		"..STtmpmRtsS..",
		"..STttmRtssS..",
		"..STtttmtssS..",
		"...STttttsS...",
		"...STttssSS...",
		"....STtssS....",
		".....SssS.....",
		"......SS......",
	]],
	// Lingering (a longer combo window): an hourglass of blood sand
	["boon.lingering", [
		"..............",
		"..WWWWWWWWWW..",
		"..wwwwwwwwww..",
		"...QmmmmmmQ...",
		"...QQmmmmqq...",
		"....QQmmqq....",
		".....QQmq.....",
		".....QQmq.....",
		"....QQQmqq....",
		"...QQQQmqqq...",
		"...QQmmmmqq...",
		"..WWWWWWWWWW..",
		"..wwwwwwwwww..",
		"..............",
	]],
	// Daredevil (grazes count from farther): a horned skull
	["boon.daredevil", [
		".R..........R.",
		".mR........Rm.",
		"..mR......Rm..",
		"..mm.4444.mm..",
		"...m443333m...",
		"...4433332....",
		"..443333332...",
		"..4oo33oo32...",
		"..4om33mo32...",
		"..4333o3332...",
		"...3333332....",
		"....3o3o2.....",
		"....33332.....",
		"..............",
	]],
	// Bounty (more kill points): two stacks of gold coins and a glint
	["boon.bounty", [
		"...........~..",
		"..gggg.....+..",
		".gGGGGg...~*~.",
		".EggggE....+..",
		".gGGGGg....~..",
		".EggggE.......",
		".gGGGGg..gggg.",
		".EggggE.gGGGGg",
		".gGGGGg.EggggE",
		".EggggE.gGGGGg",
		".gGGGGg.EggggE",
		".EggggE.gGGGGg",
		"..EEEE...EEEE.",
		"..............",
	]],
	// Composure (hits cut the combo half as much): a balanced cairn
	["boon.composure", [
		"..............",
		"......LL......",
		".....LllK.....",
		".....lKKK.....",
		"..............",
		"....LLLLll....",
		"...LlllllllK..",
		"....KKKKKKK...",
		"..............",
		"..LLLLllllll..",
		".LllllllllllK.",
		".lllllllllKKK.",
		"..KKKKKKKKKK..",
		"..............",
	]],
	// Chain Spark (kills arc a spark): a lightning bolt
	["boon.chainSpark", [
		"..........^...",
		".......cCC^^..",
		"......cCCb....",
		".....cCCb.....",
		"....cCCb......",
		"...cCCCCCCc...",
		"....BBBcCCb...",
		".......cCb....",
		"......cCb.....",
		".....cCb......",
		"....cBb.......",
		"...cBb........",
		"^^cb..........",
		"..^...........",
	]],
	// Volatile (kills burst into bolts): a starburst
	["boon.volatile", [
		"......m.......",
		"..m...p...m...",
		"...p..h..p....",
		"....hHhhHh....",
		"....HhhhhH....",
		".mphhh**hhhpm.",
		"....hh**hhH...",
		"....HhhhhH....",
		"....hHhhHh....",
		"...p..h..p....",
		"..m...p...m...",
		"......m.......",
		"..............",
		"..............",
	]],
	// Soul Shards (kills release seeking shards): two crystal shards
	["boon.soulShards", [
		"...........x..",
		"..........xV..",
		".........xVv..",
		"........xVv...",
		".......xVv....",
		"......xVv.....",
		".....:Vv......",
		"...:.:v...x...",
		"..:.:....xV...",
		".:.:....xVv...",
		"..:....xVv....",
		".:....:Vv.....",
		"....:.:v......",
		"...:.:........",
	]],
	// Overkill (a kill's leftover damage jumps on): a cracked skull and the streak leaving it
	["boon.overkill", [
		"...........gG.",
		"..........gGG.",
		"........~+gg..",
		".......~+.....",
		"..4444~+......",
		".44333o3......",
		"4433o3332.....",
		"4oo333oo2.....",
		"4oo333oo2.....",
		"4333o3332.....",
		".3333332......",
		"..3o3o32......",
		"..333332......",
		"..............",
	]],
	// Bastion (a full-ring guard and a brace): a stone tower
	["boon.bastion", [
		"..L.LL.LL.L...",
		"..LKLlKllKl...",
		"..LllllllKl...",
		"..LlKKKKKlK...",
		"...LllllKK....",
		"...LKlllKK....",
		"...LllKlKK....",
		"...LlKllKK....",
		"...LllwwKK....",
		"...LlwwwwK....",
		"...LKwwwwK....",
		"..LLlwwwwKK...",
		".LLlllllllKK..",
		"..............",
	]],
];

/** The icon's output file name: boon_<id without "boon.">.png. */
function fileOf(id) {
	return `boon_${id.replace(/^boon\./, "")}.png`;
}

/** The map of `id` (a programming error when absent or malformed). */
function mapOf(id) {
	const entry = ICONS.find((e) => e[0] === id);
	if (entry === undefined) throw new Error(`gen-boon-icons: no icon "${id}"`);
	const rows = entry[1];
	if (rows.length !== MAP || rows.some((r) => r.length !== MAP)) {
		throw new Error(`gen-boon-icons: ${id} is not ${MAP} x ${MAP}`);
	}
	for (const row of rows) {
		for (const ch of row) {
			if (ch !== "." && PALETTE[ch] === undefined) throw new Error(`gen-boon-icons: ${id}: unknown colour "${ch}"`);
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

/** A 3 x 5 pixel font for the contact sheet's labels (upper case, digits unused). */
const FONT = {
	A: "010101111101101", B: "110101110101110", C: "011100100100011", D: "110101101101110", E: "111100110100111",
	F: "111100110100100", G: "011100101101011", H: "101101111101101", I: "111010010010111", J: "001001001101010",
	K: "101101110101101", L: "100100100100111", M: "101111111101101", N: "110101101101101", O: "010101101101010",
	P: "110101110100100", Q: "010101101110011", R: "110101110101101", S: "011100010001110", T: "111010010010010",
	U: "101101101101111", V: "101101101101010", W: "101101111111101", X: "101101010101101", Y: "101101010010010",
	Z: "111001010100111", " ": "000000000000000",
};

/** A review sheet: per icon, 1x and SCALE x on the UI panel colour, named. */
function renderContact(scale = 6, perRow = 6) {
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
		const label = id.replace(/^boon\./, "").toUpperCase().slice(0, 16);
		[...label].forEach((ch, k) => {
			const glyph = FONT[ch] ?? FONT[" "];
			for (let gy = 0; gy < 5; gy++) for (let gx = 0; gx < 3; gx++) {
				if (glyph[gy * 3 + gx] === "1") set(ox + k * 4 + gx, oy + SIZE * scale + 8 + gy, [215, 204, 180]);
			}
		});
	});
	return PNG.sync.write(png, { colorType: 6 });
}

const BOON_IDS = ICONS.map((e) => e[0]);

if (require.main === module) {
	const args = process.argv.slice(2);
	let contact;
	const ci = args.indexOf("--contact");
	if (ci >= 0) {
		contact = args[ci + 1];
		args.splice(ci, 2);
	}
	const outDir = args[0] ?? path.join(__dirname, "..", "..", "art", "vendor", "kaleb-vale", "boon-icons");
	fs.mkdirSync(outDir, { recursive: true });
	for (const id of BOON_IDS) fs.writeFileSync(path.join(outDir, fileOf(id)), renderIcon(id));
	if (contact !== undefined) fs.writeFileSync(contact, renderContact());
	console.log(`gen-boon-icons: ${BOON_IDS.length} icons -> ${outDir}`);
}

module.exports = { SIZE, MAP, OUTLINE, PALETTE, ICONS, BOON_IDS, fileOf, drawIcon, rgbaOf, renderIcon, renderContact };
