import { Controller, OnStart } from "@flamework/core";
import { RunService, Workspace } from "@rbxts/services";
import {
	BOW,
	BOW_V_CHARGE,
	BOW_V_HEAVY_TICK,
	NO_WEAPON,
	SWORD,
	SWORD_DATA,
	SWORD_FINISHER,
	SWORD_STEP_WINDUP,
	SWORD_V_BUSY,
	SWORD_V_LAST,
	SWORD_V_STEP,
	bowAssistAim,
	bowCharge,
	bowChargeTicks,
	playerAt,
	swordGuard,
	swordGuardHalfAngleCos,
	swordGuardTicks,
	weaponIndex,
	weaponsAt,
	type SimState,
	type WeaponSlotState,
	type WeaponsState,
} from "shared/sim";
import type { ColorRole } from "shared/theme";
import { MARKING_VIEW, RENDER_ORDER, WEAPON_VIEW, arc, heading, lerp, ray, sector } from "shared/view";
import { tickDeflectedBullets } from "shared/view/pellets";
import { SimController } from "../game/SimController";
import { ThemeController } from "../game/ThemeController";
import { DashLayer } from "./DashLayer";

const RENDER_STEP = "KV_Weapons";
const TAU = 2 * math.pi;
const WINDUP_TRANSPARENCY = 0.5;
/** Scratch: the full charge's aim-assisted direction (bowAssistAim). */
const assistDir = { x: 0, z: 1 };

function slotWith(w: Readonly<WeaponsState>, index: number): WeaponSlotState | undefined {
	if (index === NO_WEAPON) return undefined;
	for (const set of w.sets) if (set.weapon === index) return set;
	return undefined;
}

function indexOrNone(id: string): number {
	const [ok, index] = pcall(() => weaponIndex(id));
	return ok ? (index as number) : NO_WEAPON;
}

/**
 * Weapon visuals (web WeaponView), drawn as dashed floor markings (DashLayer) from sim state only:
 *   swing     the last melee swing (combat.weapons.swing*, recorded by sweepArc): its fan, a blade sweeping across it
 *             (combo swings alternate direction), the finisher in the accent colour for longer
 *   wind-up   the sword finisher's arc in front of the player, growing as the lunge winds up
 *   guard     the sword guard's wide fan while it is up (flashing on its first ticks and when it deletes bullets; a power
 *             pellet's erases, docs/PELLETS.md PL4, are not the guard's: tickDeflectedBullets)
 *   charge    the bow's charge: a ring filling around the player plus an aim line, accent colour when full; a heavy
 *             arrow's release flashes an expanding ring
 * Colours are theme roles: playerBullet (swings, charge), uiAccent (finisher, wind-up, full charge), uiMana (guard),
 * damageNumber (blade, flashes).
 */
@Controller({})
export class WeaponViewController implements OnStart {
	constructor(private readonly sim: SimController, private readonly theme: ThemeController) {}

	onStart(): void {
		const pack = this.theme.getPack();
		const folder = new Instance("Folder");
		folder.Name = `${MARKING_VIEW.folderName}_Weapons`;
		folder.Parent = Workspace;
		const layer = (name: string, role: ColorRole, transparency = 0) =>
			new DashLayer(folder, name, {
				...MARKING_VIEW.weaponDash,
				color: pack.color(role),
				material: Enum.Material.Neon,
				transparency,
			});
		const swing = layer("Swing", "playerBullet");
		const finisher = layer("Finisher", "uiAccent");
		const blade = layer("Blade", "damageNumber");
		const windup = layer("Windup", "uiAccent", WINDUP_TRANSPARENCY);
		const guard = layer("Guard", "uiMana");
		const flash = layer("Flash", "damageNumber");
		const charge = layer("Charge", "playerBullet");
		const full = layer("ChargeFull", "uiAccent");
		const layers = [swing, finisher, blade, windup, guard, flash, charge, full];
		const idx = { bow: NO_WEAPON, sword: NO_WEAPON, resolved: false };

		RunService.BindToRenderStep(
			RENDER_STEP,
			Enum.RenderPriority.Camera.Value + RENDER_ORDER.viewsAfterCamera,
			() => {
				const s = this.sim.getState();
				for (const l of layers) l.begin();
				if (s !== undefined) {
					if (!idx.resolved) {
						idx.bow = indexOrNone(BOW.id);
						idx.sword = indexOrNone(SWORD.id);
						idx.resolved = true;
					}
					this.draw(s, this.sim.getAlpha(), idx, {
						swing,
						finisher,
						blade,
						windup,
						guard,
						flash,
						charge,
						full,
					});
				}
				for (const l of layers) l.finish();
			},
		);
	}

	private draw(
		s: Readonly<SimState>,
		alpha: number,
		idx: { bow: number; sword: number },
		L: Record<"swing" | "finisher" | "blade" | "windup" | "guard" | "flash" | "charge" | "full", DashLayer>,
	): void {
		// Co-op (M4): this client's own player's weapons, or the watched teammate's while spectating (docs/SPECTATE.md).
		const me = this.sim.getViewPlayerIndex();
		const w = weaponsAt(s, me);
		const p = playerAt(s, me);
		const px = lerp(p.prevX, p.x, alpha);
		const pz = lerp(p.prevZ, p.z, alpha);
		const active = w.sets[w.activeSet];
		const alive = p.dead === 0;

		// Last swing: fan + blade (web SwingFan).
		const swordSlot = slotWith(w, idx.sword);
		const last = swordSlot !== undefined ? swordSlot.v[SWORD_V_LAST] : 0;
		const isFinisher = last === SWORD_FINISHER;
		const showTicks = isFinisher ? WEAPON_VIEW.finisherShowTicks : WEAPON_VIEW.swingShowTicks;
		const age = s.tick - 1 - w.swingTick + alpha; // the swing happened on tick swingTick; state.tick is one past it
		if (w.swingTick >= 0 && age >= 0 && age < showTicks) {
			sector(
				isFinisher ? L.finisher : L.swing,
				w.swingX,
				w.swingZ,
				w.swingDirX,
				w.swingDirZ,
				w.swingRadius,
				w.swingHalfCos,
				WEAPON_VIEW.fanFill,
			);
			if (age < WEAPON_VIEW.bladeSweepTicks + 1) {
				const half = math.acos(math.clamp(w.swingHalfCos, -1, 1));
				const t = math.min(1, age / WEAPON_VIEW.bladeSweepTicks);
				const from = last === 2 || isFinisher ? -half : half;
				ray(
					L.blade,
					w.swingX,
					w.swingZ,
					heading(w.swingDirX, w.swingDirZ) + from - 2 * from * t,
					0,
					w.swingRadius,
				);
			}
		}

		// Sword in hand: finisher wind-up and guard.
		const swordInHand = alive && active !== undefined && active.weapon === idx.sword && active.weapon !== NO_WEAPON;
		if (swordInHand && active.v[SWORD_V_STEP] === SWORD_STEP_WINDUP) {
			const t = 1 - math.max(0, active.v[SWORD_V_BUSY] - alpha) / SWORD_DATA.finisherWindupTicks;
			const scale = WEAPON_VIEW.windupScaleMin + (1 - WEAPON_VIEW.windupScaleMin) * t;
			sector(
				L.windup,
				px,
				pz,
				p.faceX,
				p.faceZ,
				SWORD_DATA.finisherReach * scale,
				SWORD_DATA.finisherHalfAngleCos,
				[],
			);
		}
		// The guard's length and arc are the player's (docs/LEGENDARIES.md LG6): Bastion's lasts swordGuardTicks (27) and
		// is the full ring (swordGuardHalfAngleCos -1: sector draws the whole circle, no edge rays).
		const g = swordInHand ? swordGuard(active, swordGuardTicks(s, me)) : 0;
		if (g > 0) {
			const flash = g > WEAPON_VIEW.guardFlashFrom || tickDeflectedBullets(s) > 0;
			sector(
				flash ? L.flash : L.guard,
				px,
				pz,
				p.faceX,
				p.faceZ,
				SWORD_DATA.guardReach,
				swordGuardHalfAngleCos(s, me),
				WEAPON_VIEW.fanFill,
			);
		}

		// Bow: charge ring + aim line, release ring. Fully charged, the aim line shows where the heavy arrow will fly
		// (the sim's aim assist, bowAssistAim, on the next tick's rules); the ring keeps the facing.
		const bowInHand = alive && active !== undefined && active.weapon === idx.bow && active.weapon !== NO_WEAPON;
		const charge = bowInHand && active.v[BOW_V_CHARGE] > 0 ? bowCharge(active, bowChargeTicks(s, me)) : 0;
		if (charge > 0) {
			const sink = charge >= 1 ? L.full : L.charge;
			const h = heading(p.faceX, p.faceZ);
			arc(sink, px, pz, WEAPON_VIEW.chargeRingRadius, h, h + TAU * charge);
			let aim = h;
			if (charge >= 1) {
				const blocked = this.sim.getContext()?.config.isBulletBlocked;
				if (bowAssistAim(s.combat.actors, s.tick, blocked, p.x, p.z, p.faceX, p.faceZ, assistDir)) {
					aim = heading(assistDir.x, assistDir.z);
				}
			}
			ray(sink, px, pz, aim, 0, WEAPON_VIEW.aimLineMin + WEAPON_VIEW.aimLineGrow * charge);
		}
		const bowSlot = slotWith(w, idx.bow);
		const heavyTick = bowSlot !== undefined ? bowSlot.v[BOW_V_HEAVY_TICK] : 0;
		const releaseAge = s.tick - heavyTick + alpha;
		if (heavyTick > 0 && releaseAge >= 0 && releaseAge < WEAPON_VIEW.releaseShowTicks) {
			const t = releaseAge / WEAPON_VIEW.releaseShowTicks;
			arc(L.flash, px, pz, WEAPON_VIEW.releaseRadiusMin + WEAPON_VIEW.releaseRadiusGrow * t, 0, TAU);
		}
	}
}
