import { Controller, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { Players, RunService, UserInputService, Workspace } from "@rbxts/services";
import { BulletPattern, clientStore, selectBulletSpike } from "client/store";
import { BULLET_SPIKE } from "shared/config";
import { watchSpikeFlag } from "./spikeFlags";

const COUNT_KEYS: ReadonlyArray<Enum.KeyCode> = [
	Enum.KeyCode.One,
	Enum.KeyCode.Two,
	Enum.KeyCode.Three,
	Enum.KeyCode.Four,
];
const PATTERN_KEY = Enum.KeyCode.P;
const TAU = 2 * math.pi;
const MS_PER_SEC = 1000;

/**
 * Spike A (docs/SPIKES.md): can Roblox draw the web build's 1,000 enemy bullets at 60 fps?
 *
 * A pool of small neon spheres (Anchored; no collision, queries, touch or shadows) moved every
 * frame with exactly one `workspace:BulkMoveTo(parts, cframes, FireCFrameChanged)`. Positions
 * are analytic rings or a spiral around a fixed emitter, standing in for the sim's bullets.
 * Reports fps and the per-frame cost of the update (position math + CFrame construction, and
 * the BulkMoveTo call itself) to the spike HUD; the update is also a MicroProfiler label.
 *
 * Off unless `KV_SpikeBullets` (or SPIKE_DEFAULTS.bullets) is true; everything it creates is
 * owned by one Janitor and removed when the flag goes false.
 */
@Controller({})
export class BulletSpikeController implements OnStart {
	private session?: Janitor;

	onStart(): void {
		watchSpikeFlag("bullets", (enabled) => (enabled ? this.start() : this.stop()));
	}

	private stop(): void {
		this.session?.Destroy();
		this.session = undefined;
	}

	private start(): void {
		if (this.session) {
			return;
		}
		const janitor = new Janitor();
		this.session = janitor;

		clientStore.setBulletsActive(true);
		janitor.Add(() => clientStore.setBulletsActive(false), true);

		const folder = new Instance("Folder");
		folder.Name = BULLET_SPIKE.folderName;
		folder.Parent = Workspace;
		janitor.Add(folder);

		// Pool: parts are created on first use and parked (Parent = nil) when the count drops.
		const pool = new Array<BasePart>();
		janitor.Add(() => pool.forEach((part) => part.Destroy()), true);
		const makePart = (index: number): BasePart => {
			const ring = math.floor(index / BULLET_SPIKE.perRing);
			const [r, g, b] = BULLET_SPIKE.colors[ring % BULLET_SPIKE.colors.size()];
			const part = new Instance("Part");
			part.Name = "Bullet";
			part.Shape = Enum.PartType.Ball;
			part.Size = Vector3.one.mul(BULLET_SPIKE.diameterStuds);
			part.Material = Enum.Material.Neon;
			part.Color = Color3.fromRGB(r, g, b);
			part.Anchored = true;
			part.CanCollide = false;
			part.CanQuery = false;
			part.CanTouch = false;
			part.CastShadow = false;
			part.Locked = true;
			return part;
		};

		let parts = new Array<BasePart>();
		let cframes = new Array<CFrame>();
		const resize = (count: number) => {
			while (pool.size() < count) {
				pool.push(makePart(pool.size()));
			}
			parts = table.create(count);
			pool.forEach((part, i) => {
				part.Parent = i < count ? folder : undefined;
				if (i < count) {
					parts.push(part);
				}
			});
			cframes = table.create(count, CFrame.identity);
		};

		// Emitter: where the local character stood when the spike started (else the origin).
		const root = Players.LocalPlayer.Character?.FindFirstChild("HumanoidRootPart") as BasePart | undefined;
		const center = root ? root.Position : Vector3.zero;
		const cx = center.X;
		const cz = center.Z;
		const y = (root ? center.Y - root.Size.Y : 0) + BULLET_SPIKE.heightStuds;

		// Unit circle for one ring, rotated per ring with the angle-addition identity.
		const perRing = BULLET_SPIKE.perRing;
		const ringCos = new Array<number>();
		const ringSin = new Array<number>();
		for (let k = 0; k < perRing; k++) {
			ringCos.push(math.cos((k * TAU) / perRing));
			ringSin.push(math.sin((k * TAU) / perRing));
		}

		let settings = selectBulletSpike(clientStore.getState());
		resize(BULLET_SPIKE.counts[settings.countIndex]);
		janitor.Add(
			clientStore.subscribe(selectBulletSpike, (latest) => {
				if (latest.countIndex !== settings.countIndex) {
					resize(BULLET_SPIKE.counts[latest.countIndex]);
				}
				settings = latest;
			}),
			true,
		);

		janitor.Add(
			UserInputService.InputBegan.Connect((input, processed) => {
				if (processed) {
					return;
				}
				const countIndex = COUNT_KEYS.indexOf(input.KeyCode);
				if (countIndex >= 0) {
					clientStore.setBulletCountIndex(countIndex);
				} else if (input.KeyCode === PATTERN_KEY) {
					clientStore.toggleBulletPattern();
				}
			}),
		);

		const startedAt = os.clock();
		let windowStart = startedAt;
		let frames = 0;
		let computeSec = 0;
		let moveSec = 0;
		let worstSec = 0;

		janitor.Add(
			RunService.RenderStepped.Connect(() => {
				const count = parts.size();
				const pattern: BulletPattern = settings.pattern;
				const elapsed = os.clock() - startedAt;
				const rings = math.ceil(count / perRing);
				const spacing = BULLET_SPIKE.maxRadiusStuds / math.max(rings, 1);
				const travel = elapsed * BULLET_SPIKE.speedStuds;

				debug.profilebegin(BULLET_SPIKE.profileLabel);
				const t0 = os.clock();
				for (let ring = 0; ring < rings; ring++) {
					const radius = (travel + ring * spacing) % BULLET_SPIKE.maxRadiusStuds;
					const offset =
						pattern === "spiral"
							? ring * BULLET_SPIKE.spiralStepRad + elapsed * BULLET_SPIKE.spiralSpinRadPerSec
							: (ring % 2) * (math.pi / perRing);
					const co = math.cos(offset);
					const so = math.sin(offset);
					const base = ring * perRing;
					const last = math.min(perRing, count - base);
					for (let k = 0; k < last; k++) {
						const c = ringCos[k] * co - ringSin[k] * so;
						const s = ringSin[k] * co + ringCos[k] * so;
						cframes[base + k] = new CFrame(cx + c * radius, y, cz + s * radius);
					}
				}
				const t1 = os.clock();
				Workspace.BulkMoveTo(parts, cframes, Enum.BulkMoveMode.FireCFrameChanged);
				const t2 = os.clock();
				debug.profileend();

				frames += 1;
				computeSec += t1 - t0;
				moveSec += t2 - t1;
				worstSec = math.max(worstSec, t2 - t0);
				const windowSec = t2 - windowStart;
				if (windowSec >= BULLET_SPIKE.statsIntervalSec) {
					clientStore.reportBulletStats({
						fps: frames / windowSec,
						computeMs: (computeSec / frames) * MS_PER_SEC,
						moveMs: (moveSec / frames) * MS_PER_SEC,
						worstMs: worstSec * MS_PER_SEC,
						live: count,
					});
					windowStart = t2;
					frames = 0;
					computeSec = 0;
					moveSec = 0;
					worstSec = 0;
				}
			}),
		);
	}
}
