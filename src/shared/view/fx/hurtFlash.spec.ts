// The hurt flash (docs/FEEL.md J2): each kind's peak and fade, the lethal hold, the spectate scale, NaN / negative
// ages, the forfeit gate, the flash state's restart spacing, and the photosensitivity ceiling (<= 1.33 Hz, under 3 Hz).
import { describe, expect, it } from "@rbxts/jest-globals";
import { HURT_INVULN_SECONDS, HURT_INVULN_TICKS, SIM_HZ } from "shared/sim";
import {
	FEEL_HURT,
	HURT_FLASH_MAX_HZ,
	HurtFlash,
	edgeTransparency,
	hurtEdgeDepthPx,
	hurtFlashLook,
	hurtKindLanded,
	quantizeEdgeTransparency,
	hurtKindRank,
	lowHealthLook,
} from ".";

/** The photosensitivity guideline: no more than three flashes in any one second. */
const PHOTOSENSITIVE_HZ = 3;
const EPS = 1e-9;

describe("hurtFlashLook", () => {
	it("starts at each kind's peak opacity: harmless / armor half strength, heart stronger, lethal strongest", () => {
		expect(hurtFlashLook(0, "harmless", false)).toBeCloseTo(1 - FEEL_HURT.peak.harmless, 9);
		expect(hurtFlashLook(0, "armor", false)).toBeCloseTo(1 - FEEL_HURT.peak.armor, 9);
		expect(hurtFlashLook(0, "heart", false)).toBeCloseTo(1 - FEEL_HURT.peak.heart, 9);
		expect(hurtFlashLook(0, "lethal", false)).toBeCloseTo(1 - FEEL_HURT.peak.lethal, 9);
		expect(FEEL_HURT.peak.armor).toBe(FEEL_HURT.peak.harmless);
		expect(FEEL_HURT.peak.heart).toBeGreaterThan(FEEL_HURT.peak.armor);
		expect(FEEL_HURT.peak.lethal).toBeGreaterThan(FEEL_HURT.peak.heart);
		expect(hurtFlashLook(0, "none", false)).toBe(1);
	});

	it("fades linearly to clear over fadeSec", () => {
		const half = FEEL_HURT.fadeSec / 2;
		expect(hurtFlashLook(half, "heart", false)).toBeCloseTo(1 - FEEL_HURT.peak.heart / 2, 9);
		expect(hurtFlashLook(FEEL_HURT.fadeSec, "heart", false)).toBe(1);
		expect(hurtFlashLook(FEEL_HURT.fadeSec + 1, "armor", false)).toBe(1);
		let last = 0;
		for (let t = 0; t <= FEEL_HURT.fadeSec; t += 0.01) {
			const v = hurtFlashLook(t, "heart", false);
			expect(v + EPS).toBeGreaterThanOrEqual(last);
			last = v;
		}
	});

	it("lethal holds its peak for lethalHoldSec, then fades over lethalFadeSec", () => {
		const peak = 1 - FEEL_HURT.peak.lethal;
		expect(hurtFlashLook(FEEL_HURT.lethalHoldSec - 0.01, "lethal", false)).toBeCloseTo(peak, 9);
		const mid = FEEL_HURT.lethalHoldSec + FEEL_HURT.lethalFadeSec / 2;
		expect(hurtFlashLook(mid, "lethal", false)).toBeCloseTo(1 - FEEL_HURT.peak.lethal / 2, 9);
		expect(hurtFlashLook(FEEL_HURT.lethalHoldSec + FEEL_HURT.lethalFadeSec, "lethal", false)).toBe(1);
	});

	it("spectating scales the opacity by spectateScale (JD7)", () => {
		const s = FEEL_HURT.spectateScale;
		expect(s).toBe(0.5);
		expect(hurtFlashLook(0, "heart", true)).toBeCloseTo(1 - FEEL_HURT.peak.heart * s, 9);
		expect(hurtFlashLook(0, "lethal", true)).toBeCloseTo(1 - FEEL_HURT.peak.lethal * s, 9);
		expect(hurtFlashLook(FEEL_HURT.fadeSec, "heart", true)).toBe(1);
	});

	it("NaN, negative and infinite ages are clear", () => {
		expect(hurtFlashLook(0 / 0, "lethal", false)).toBe(1);
		expect(hurtFlashLook(-0.01, "heart", false)).toBe(1);
		expect(hurtFlashLook(math.huge, "lethal", false)).toBe(1);
	});

	it("edgeTransparency: the larger opacity of the flash and the pulse, never their sum", () => {
		expect(edgeTransparency(0.4, 0.8)).toBe(0.4);
		expect(edgeTransparency(0.9, 0.85)).toBe(0.85);
		expect(edgeTransparency(1, 1)).toBe(1);
		expect(edgeTransparency(1.2, 1)).toBe(1);
		// the lethal hold under a pulse at its peak stays the lethal hold
		expect(edgeTransparency(hurtFlashLook(0.5, "lethal", false), lowHealthLook(0.5, 1))).toBeCloseTo(
			1 - FEEL_HURT.peak.lethal,
			9,
		);
	});
});

describe("edge geometry and writes", () => {
	it("each edge is edgeFraction of the short side deep (portrait and landscape alike), at least 1 px", () => {
		expect(hurtEdgeDepthPx(1920, 1080)).toBe(math.floor(1080 * FEEL_HURT.edgeFraction));
		expect(hurtEdgeDepthPx(1080, 1920)).toBe(math.floor(1080 * FEEL_HURT.edgeFraction));
		expect(hurtEdgeDepthPx(2560, 1080)).toBe(hurtEdgeDepthPx(1920, 1080)); // 21:9
		expect(hurtEdgeDepthPx(0, 0)).toBe(1);
		expect(hurtEdgeDepthPx(2, 2)).toBe(1);
	});

	it("transparency writes are quantized; clear stays clear", () => {
		expect(quantizeEdgeTransparency(1)).toBe(1);
		expect(quantizeEdgeTransparency(1.5)).toBe(1);
		expect(quantizeEdgeTransparency(0 / 0)).toBe(1);
		const q = FEEL_HURT.writeQuantum;
		expect(quantizeEdgeTransparency(0.55 + q / 4)).toBeCloseTo(math.round(0.55 / q) * q, 9);
		expect(quantizeEdgeTransparency(-0.2)).toBe(0);
		// the weakest flash never rounds away
		expect(quantizeEdgeTransparency(1 - FEEL_HURT.peak.armor * FEEL_HURT.spectateScale)).toBeLessThan(1);
	});
});

describe("hurtKindLanded / hurtKindRank", () => {
	it("a death with no landed hit in the frame (the solo forfeit) is not a lethal hit", () => {
		expect(hurtKindLanded("lethal", 0)).toBe("none");
		expect(hurtKindLanded("lethal", 1)).toBe("lethal");
		expect(hurtKindLanded("lethal", undefined)).toBe("lethal");
		expect(hurtKindLanded("heart", 0)).toBe("heart");
	});

	it("ranks none < harmless < armor < heart < lethal", () => {
		expect(hurtKindRank("none")).toBeLessThan(hurtKindRank("harmless"));
		expect(hurtKindRank("harmless")).toBeLessThan(hurtKindRank("armor"));
		expect(hurtKindRank("armor")).toBeLessThan(hurtKindRank("heart"));
		expect(hurtKindRank("heart")).toBeLessThan(hurtKindRank("lethal"));
	});
});

describe("HurtFlash", () => {
	it("starts on a hurt edge, shows, and clears itself when the fade ends", () => {
		const f = new HurtFlash();
		expect(f.transparency(0, false)).toBe(1);
		expect(f.start("none", 0)).toBe(false);
		expect(f.start("armor", 10)).toBe(true);
		expect(f.transparency(10, false)).toBeCloseTo(1 - FEEL_HURT.peak.armor, 9);
		expect(f.transparency(10 + FEEL_HURT.fadeSec, false)).toBe(1);
		expect(f.kind).toBe("none");
	});

	it("an edge within minIntervalSec does not restart the flash; it only raises the kind (lethal always shows)", () => {
		const f = new HurtFlash();
		f.start("armor", 0);
		expect(f.start("armor", 0.1)).toBe(false);
		expect(f.startSec).toBe(0);
		expect(f.start("lethal", 0.2)).toBe(false);
		expect(f.kind).toBe("lethal");
		expect(f.start("heart", 0.3)).toBe(false);
		expect(f.kind).toBe("lethal");
		expect(f.starts).toBe(1);
		expect(f.start("heart", FEEL_HURT.minIntervalSec + 0.01)).toBe(true);
		expect(f.starts).toBe(2);
		f.clear();
		expect(f.transparency(FEEL_HURT.minIntervalSec + 0.02, false)).toBe(1);
	});

	it("photosensitivity: at most SIM_HZ / HURT_INVULN_TICKS = 1.33 flashes per second, under the 3 Hz guideline", () => {
		// The sim side: a hurt edge needs hurtTicks to rise, and damagePlayer ignores hits while hurtTicks > 0, so two
		// edges of one player are at least HURT_INVULN_TICKS apart.
		expect(HURT_INVULN_TICKS).toBe(45);
		expect(HURT_FLASH_MAX_HZ).toBeCloseTo(4 / 3, 9);
		expect(HURT_FLASH_MAX_HZ).toBeLessThan(PHOTOSENSITIVE_HZ);
		expect(SIM_HZ / HURT_INVULN_TICKS).toBe(HURT_FLASH_MAX_HZ);
		// The view side: even a hurt edge on EVERY frame (a loop catching up after a hitch) starts at most one flash
		// per minIntervalSec = HURT_INVULN_SECONDS of real time.
		expect(FEEL_HURT.minIntervalSec).toBe(HURT_INVULN_SECONDS);
		const f = new HurtFlash();
		const seconds = 10;
		const fps = 60;
		for (let frame = 0; frame < seconds * fps; frame++) f.start(frame % 2 === 0 ? "heart" : "armor", frame / fps);
		expect(f.starts).toBeLessThanOrEqual(math.ceil(seconds * HURT_FLASH_MAX_HZ));
		expect(f.starts / seconds).toBeLessThan(PHOTOSENSITIVE_HZ);
	});
});
