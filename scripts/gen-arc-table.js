// Generates src/shared/sim/combat/arcTable.ts from fixtures/arc-table.json (V8's sin / cos of every gen.arc angle).
// Usage: node gen-arc-table.js <port repo root>
"use strict";
const fs = require("fs");
const path = require("path");
const root = process.argv[2];
const table = JSON.parse(fs.readFileSync(path.join(root, "fixtures/arc-table.json"), "utf8"));
const fromHex = (h) => Buffer.from(h, "hex").readDoubleBE(0);
const lit = (v) => (Object.is(v, -0) ? "-0" : String(v));
const lines = [];
for (const s of table.shapes) {
	const sin = s.sinHex.map(fromHex).map(lit).join(", ");
	const cos = s.cosHex.map(fromHex).map(lit).join(", ");
	lines.push(`\t// ${s.sources.join("; ")}`);
	lines.push(`\t{\n\t\tcount: ${s.count},\n\t\tspread: ${lit(fromHex(s.spreadHex))},\n\t\tfull: ${s.full},\n\t\tsin: [${sin}],\n\t\tcos: [${cos}],\n\t},`);
}
const out = `/**
 * GENERATED from fixtures/arc-table.json (format ${table.format}) — do not edit by hand; regenerate and re-run
 * \`arcTable.spec.ts\`, which checks every value here bit for bit against the fixture's hex.
 *
 * V8's Math.sin / Math.cos (Node 25.2.1, V8 14.1) of every angle r3f-projectiles' gen.arc produces for every burst
 * shape the sim fires (heading 0). Luau's math.sin / math.cos call the platform libm, which can differ from V8 in the
 * last bit (6 of these values are not even correctly rounded in V8), so the sim never calls them: gen.arc looks the
 * shape up here (./projectilePatterns.ts arcTrig) and errors on a miss.
 *
 * Generator (Node, run from anywhere; writes this file's array body):
 *   const t = JSON.parse(fs.readFileSync("fixtures/arc-table.json", "utf8"));
 *   const v = (h) => Buffer.from(h, "hex").readDoubleBE(0);   // big-endian float64 bits -> number
 *   const lit = (x) => (Object.is(x, -0) ? "-0" : String(x)); // shortest round-trip literal
 *   for (const s of t.shapes) emit({ count: s.count, spread: v(s.spreadHex), full: s.full,
 *                                   sin: s.sinHex.map(v).map(lit), cos: s.cosHex.map(v).map(lit) });
 */

/** One burst shape: gen.arc(count, spread, ...) at heading 0. sin[i] / cos[i] belong to bullet i. */
export interface ArcShape {
	readonly count: number;
	/** Cone width as passed to gen.arc (full rings: any spread >= TAU - 1e-9 gives the same angles). */
	readonly spread: number;
	/** spread >= TAU - 1e-9: an evenly spaced ring. */
	readonly full: boolean;
	readonly sin: ReadonlyArray<number>;
	readonly cos: ReadonlyArray<number>;
}

export const ARC_SHAPES: ReadonlyArray<ArcShape> = [
${lines.join("\n")}
];
`;
fs.writeFileSync(path.join(root, "src/shared/sim/combat/arcTable.ts"), out);
console.log("wrote", table.shapes.length, "shapes");
