/**
 * Portions ported from @k9kbdev/r3f-projectiles 0.6.0 (`dist/chunk-OVREUSTD.js`: `gen.arc`, `mod.payload` /
 * `mod.color` / `mod.scale`, `compose`, `definePayload`).
 * Copyright (c) Kaleb Kougl. License: the package.json and README declare MIT, but the package's LICENSE file
 * contains GPLv3; unresolved, see THIRD_PARTY_NOTICES.md.
 *
 * The pattern side of the bullet library, as far as the sim uses it. Arithmetic matches the library exactly:
 *   gen.arc(count, spread, speed, heading, radius), TAU = PI * 2, full = spread >= TAU - 1e-9:
 *     angle_i = full ? heading + (i / count) * TAU : count == 1 ? heading : heading + (i / (count - 1) - 0.5) * spread
 *     offset   = (sin * radius, 0, cos * radius)
 *     velocity = (sin, 0, cos) * speed          (Vector3.multiplyScalar: x * speed, 0 * speed, z * speed)
 * EXCEPT that sin / cos never come from Luau's libm: they are V8's values for the burst SHAPE, looked up in the
 * generated ./arcTable.ts (fixtures/arc-table.json). The sim only fires shapes at heading 0 (patterns.ts turns them
 * with multiply-adds). A shape that is not in the table, or a non-zero heading, errors loudly ("arc table miss"):
 * add the shape to the web build's exporter, regenerate the fixture and ./arcTable.ts.
 *
 * Generators other than arc (ring, fibonacciSphere, galaxy, ...) and the acceleration / rotate / sequence modifiers
 * are not ported: nothing in the sim uses them, and all but `sequence` need trig.
 */

import { u32 } from "shared/jsmath";
import { ARC_SHAPES, type ArcShape } from "./arcTable";
import { acquireSpawnData, type BulletModifier, type BulletSpawnData } from "./bullets";

const TAU = math.pi * 2;
/** gen.arc's full-ring test: `spread >= TAU - 1e-9`. */
const FULL_RING_THRESHOLD = TAU - 1e-9;

// ---------------------------------------------------------------------------------------------
// The arc table, keyed by burst shape

/** Full rings by count (their angles do not depend on spread). */
const fullRings = new Map<number, ArcShape>();
/** Cones by count, then exact spread. */
const cones = new Map<number, Map<number, ArcShape>>();
/** count === 1 cones: one bullet at angle `heading` whatever the spread. */
let single: ArcShape | undefined;

for (const shape of ARC_SHAPES) {
	if (shape.full) {
		fullRings.set(shape.count, shape);
	} else if (shape.count === 1) {
		single = shape;
	} else {
		let bySpread = cones.get(shape.count);
		if (bySpread === undefined) {
			bySpread = new Map();
			cones.set(shape.count, bySpread);
		}
		bySpread.set(shape.spread, shape);
	}
}

/**
 * V8's sin / cos for every bullet of gen.arc(count, spread, ..., heading = 0): `shape.sin[i]`, `shape.cos[i]`.
 * Errors (`arc table miss ...`) for a shape the table does not hold.
 */
export function arcTrig(count: number, spread: number): ArcShape {
	let shape: ArcShape | undefined;
	if (spread >= FULL_RING_THRESHOLD) shape = fullRings.get(count);
	else if (count === 1) shape = single;
	else shape = cones.get(count)?.get(spread);
	if (shape === undefined) {
		error(
			`arc table miss: gen.arc(${count}, ${spread}) is not in fixtures/arc-table.json ` +
				"(src/shared/sim/combat/arcTable.ts); export the new burst shape from the web build",
			0,
		);
	}
	return shape;
}

// ---------------------------------------------------------------------------------------------
// Generators, modifiers, compose

export const gen = {
	/**
	 * Bullets in a flat arc around `heading` (0 = +Z, growing toward +X; direction = (sin, 0, cos)). At
	 * `spread >= 2 PI` an evenly spaced ring; below, the cone spans both edges and `count === 1` fires straight down
	 * the heading. Only heading 0 is supported (the table holds V8's sin / cos of heading-0 angles).
	 */
	arc(count: number, spread = math.pi / 4, speed = 2, heading = 0, radius = 0): BulletSpawnData[] {
		const spawns: BulletSpawnData[] = [];
		if (!(count > 0)) return spawns; // no bullet, no sin / cos call
		if (heading !== 0) {
			error(`arc table miss: gen.arc heading ${heading} (the table holds heading 0 only)`, 0);
		}
		const shape = arcTrig(count, spread);
		const sin = shape.sin;
		const cos = shape.cos;
		let i = 0;
		while (i < count) {
			const s = sin[i];
			const c = cos[i];
			if (s === undefined || c === undefined) {
				error(`arc table miss: gen.arc(${count}, ${spread}) has no bullet ${i}`, 0);
			}
			const p = acquireSpawnData();
			const o = p.offset;
			o.x = s * radius;
			o.y = 0;
			o.z = c * radius;
			const v = p.velocity;
			v.x = s * speed;
			v.y = 0 * speed;
			v.z = c * speed;
			spawns.push(p);
			i++;
		}
		return spawns;
	},
};

export const mod = {
	/** Same color on every bullet of the batch (24-bit hex). */
	color(col: number): BulletModifier {
		return (spawns) => {
			for (const s of spawns) s.color = col;
			return spawns;
		};
	},
	/** Same opaque integer payload on every bullet of the batch. */
	payload(value: number): BulletModifier {
		return (spawns) => {
			for (const s of spawns) s.payload = value;
			return spawns;
		};
	},
	/** Same drawn-size multiplier on every bullet of the batch. */
	scale(n: number): BulletModifier {
		return (spawns) => {
			for (const s of spawns) s.scale = n;
			return spawns;
		};
	},
};

/** Applies `modifiers` in order to a generator's result (in place) and returns it. */
export function compose(
	spawns: BulletSpawnData[],
	...modifiers: ReadonlyArray<BulletModifier | undefined>
): BulletSpawnData[] {
	for (const m of modifiers) if (m !== undefined) m(spawns);
	return spawns;
}

// ---------------------------------------------------------------------------------------------
// definePayload

/** Most bits a payload may use (it must stay a non-negative int32: bit 31 is the sign). */
const MAX_BITS = 31;
const MAX_PAYLOAD = 0x7fffffff;

/** A packed-integer payload layout (the library's `PayloadLayout`). */
export interface PayloadLayout<F extends string> {
	/** Bits used in total. */
	readonly bits: number;
	/** Field names, lowest bits first. */
	readonly fields: ReadonlyArray<F>;
	/** Largest value of a field (its mask). */
	max(field: F): number;
	/** Bit offset of a field (port addition: the library keeps shifts private). */
	shift(field: F): number;
	/** Packs fields (missing ones are 0), ORed in field order. */
	pack(values: Partial<Record<F, number>>): number;
	/** `(payload >>> shift) & mask`. */
	get(payload: number, field: F): number;
	/** `(payload & ~(mask << shift) | (value & mask) << shift) & 0x7fffffff`. */
	with(payload: number, field: F, value: number): number;
}

/**
 * Builds a payload layout from ORDERED `[name, width]` pairs (a Luau table has no key order, so the library's object
 * schema becomes a list; the order is the bit order, lowest first). Same validation and messages as the library; the
 * dev-mode value checks of `pack` / `with` (always on in the web build's tests and exporter) are kept.
 */
export function definePayload<F extends string>(schema: ReadonlyArray<readonly [F, number]>): PayloadLayout<F> {
	if (schema.size() === 0) error("[r3f-projectiles] definePayload: the schema has no fields.", 0);
	const names: F[] = [];
	const shifts = new Map<F, number>();
	const masks = new Map<F, number>();
	let bits = 0;
	for (const [name, width] of schema) {
		if (string.match(name, "^0$")[0] !== undefined || string.match(name, "^[1-9]%d*$")[0] !== undefined) {
			error(
				`[r3f-projectiles] definePayload: field name "${name}" is integer-like. JavaScript orders such keys ahead of all others, which would silently reorder the layout — use a non-numeric name.`,
				0,
			);
		}
		if (!(width % 1 === 0 && width > 0)) {
			error(
				`[r3f-projectiles] definePayload: field "${name}" has width ${width}; widths must be positive integers.`,
				0,
			);
		}
		names.push(name);
		shifts.set(name, bits);
		masks.set(name, bit32.lshift(1, width) - 1); // 2 ** width - 1 (width <= 31 is checked below)
		bits += width;
	}
	if (bits > MAX_BITS) {
		error(`[r3f-projectiles] definePayload: fields total ${bits} bits; a payload holds at most ${MAX_BITS}.`, 0);
	}
	const fieldList = names.join(", ");
	const checkField = (field: F): number => {
		const mask = masks.get(field);
		if (mask === undefined) {
			error(`[r3f-projectiles] payload field "${field}" is not in this layout (${fieldList}).`, 0);
		}
		return mask;
	};
	const checkValue = (field: F, value: number): void => {
		const max = checkField(field);
		if (!(value % 1 === 0 && value >= 0 && value <= max)) {
			error(`[r3f-projectiles] payload field "${field}" holds integers 0…${max}; got ${value}.`, 0);
		}
	};
	const layout: PayloadLayout<F> = {
		bits,
		fields: table.freeze([...names]),
		max(field) {
			return checkField(field);
		},
		shift(field) {
			checkField(field);
			return shifts.get(field)!;
		},
		pack(values) {
			// Every key present, known or not (the library's `for (const key in values)`); a Map is a plain table here.
			for (const [key, value] of values as unknown as ReadonlyMap<F, number>) checkValue(key, value);
			let out = 0;
			for (const name of names) {
				const v = values[name];
				if (v === undefined) continue;
				out = bit32.bor(out, bit32.lshift(bit32.band(u32(v), masks.get(name)!), shifts.get(name)!));
			}
			return out;
		},
		get(payload, field) {
			const mask = checkField(field);
			return bit32.band(bit32.rshift(u32(payload), shifts.get(field)!), mask);
		},
		with(payload, field, value) {
			checkValue(field, value);
			const shift = shifts.get(field)!;
			const mask = masks.get(field)!;
			const cleared = bit32.band(u32(payload), bit32.bnot(bit32.lshift(mask, shift)));
			return bit32.band(bit32.bor(cleared, bit32.lshift(bit32.band(u32(value), mask), shift)), MAX_PAYLOAD);
		},
	};
	return table.freeze(layout);
}
