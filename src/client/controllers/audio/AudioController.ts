import { Controller, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { SoundService, TweenService } from "@rbxts/services";
import { createSelector } from "@rbxts/reflex";
import { clientStore, selectRunInfo, selectSnapshot } from "client/store";
import { SOUND_GROUPS, type SoundGroupName, type ThemePack } from "shared/theme";
import { AUDIO_VIEW, AudioCueMapper, musicFor } from "shared/view/audio";
import { SimController } from "../game/SimController";
import { ThemeController } from "../game/ThemeController";
import { FxTrackerController } from "../fx/FxTrackerController";

/** The music track the run calls for now (a string, so subscribers fire only when it changes). */
const selectMusic = createSelector([selectSnapshot, selectRunInfo] as const, (snapshot, run) =>
	musicFor({ outcome: snapshot.outcome, bossVisible: snapshot.bossVisible, biome: run.biome }),
);

/** Pooled voices of one sound ID (created on first play; an ID that resolves silent never creates any). */
interface Voices {
	readonly sounds: Sound[];
	next: number;
}

/**
 * Audio (task 8 part B): every sound reaches the game by logical ID through ThemePack.sound(id) ->
 * { assetId | undefined, volume, group }. Today every sfx.* / music.* ID in the placeholder pack is `silent`, so
 * nothing is created or played; pasting an rbxassetid into the manifest (`{ kind: "sound", assetId, volume }`) makes
 * that ID play here with no code change.
 *
 *   SoundGroups  SoundService."sfx" and SoundService."music" (found or created; theme contract SOUND_GROUPS), volume
 *                AUDIO_VIEW.groupVolume[group] x AUDIO_VIEW.masterVolume. Each Sound's own Volume is the manifest's.
 *   sfx          the pure mapper (shared/view/audio AudioCueMapper) turns each frame's summed sim events, the hit
 *                tracker's events and the enemy-bullet spawn counter into IDs (once per frame, per-ID cooldowns);
 *                each ID plays on a small pool of Sounds (AUDIO_VIEW.voicesPerSfx, round-robin).
 *   music        musicFor(outcome, boss engaged, biome): the floor's music.biome.<n>, music.boss during the fight,
 *                silence after a death; switching cross-fades over AUDIO_VIEW.musicFadeSec. Looped.
 *   ui           playUi(id): sfx.ui.click / sfx.ui.confirm from the HUD's menus.
 *
 * Presentation only: reads the run, never writes it.
 */
@Controller({})
export class AudioController implements OnStart {
	private readonly janitor = new Janitor();
	private readonly mapper = new AudioCueMapper();
	private readonly voices = new Map<string, Voices>();
	private readonly groups = new Map<SoundGroupName, SoundGroup>();
	private readonly cues = new Array<string>();
	private folder: Folder | undefined;
	private pack: ThemePack | undefined;
	private musicId: string | undefined;
	private music: Sound | undefined;

	constructor(
		private readonly sim: SimController,
		private readonly theme: ThemeController,
		private readonly fx: FxTrackerController,
	) {}

	onStart(): void {
		this.pack = this.theme.getPack();
		for (const name of SOUND_GROUPS) this.groups.set(name, this.soundGroup(name));
		const folder = new Instance("Folder");
		folder.Name = AUDIO_VIEW.folderName;
		folder.Parent = SoundService;
		this.folder = this.janitor.Add(folder);

		this.fx.onFrame((events) => {
			const ctx = this.sim.getContext();
			if (ctx === undefined) return;
			this.cues.clear();
			const enemySpawned = ctx.run.state.combat.enemySpawned;
			this.mapper.frame(os.clock(), ctx.run.frameEvents, events, enemySpawned, this.cues);
			for (const id of this.cues) this.play(id);
		});

		// Music follows the HUD snapshot (outcome, boss engaged) and the run's floor (biome).
		this.janitor.Add(clientStore.subscribe(selectMusic, (id) => this.setMusic(id)));
		this.setMusic(selectMusic(clientStore.getState()));
	}

	/** A menu sound (sfx.ui.*). */
	playUi(id: string): void {
		this.play(id);
	}

	/** Plays one sound effect by logical ID (silent / missing IDs do nothing). */
	play(id: string): void {
		const v = this.voicesFor(id);
		if (v === undefined) return;
		const sound = v.sounds[v.next];
		v.next = (v.next + 1) % v.sounds.size();
		sound.TimePosition = 0;
		sound.Play();
	}

	private soundGroup(name: SoundGroupName): SoundGroup {
		const existing = SoundService.FindFirstChild(name);
		const group = existing !== undefined && existing.IsA("SoundGroup") ? existing : new Instance("SoundGroup");
		group.Name = name;
		group.Volume = AUDIO_VIEW.groupVolume[name] * AUDIO_VIEW.masterVolume;
		group.Parent = SoundService;
		return group;
	}

	/** A Sound for `id` (theme volume, its SoundGroup), or undefined while the ID is silent. */
	private makeSound(id: string, looped: boolean): Sound | undefined {
		const ref = this.pack?.sound(id);
		if (ref === undefined || ref.assetId === undefined) return undefined;
		const sound = new Instance("Sound");
		sound.Name = id;
		sound.SoundId = ref.assetId;
		sound.Volume = ref.volume;
		sound.Looped = looped;
		sound.SoundGroup = this.groups.get(ref.group);
		sound.Parent = this.folder;
		return sound;
	}

	private voicesFor(id: string): Voices | undefined {
		const cached = this.voices.get(id);
		if (cached !== undefined) return cached.sounds.size() > 0 ? cached : undefined;
		const sounds: Sound[] = [];
		for (let i = 0; i < AUDIO_VIEW.voicesPerSfx; i++) {
			const s = this.makeSound(id, false);
			if (s === undefined) break;
			sounds.push(s);
		}
		const v: Voices = { sounds, next: 0 };
		this.voices.set(id, v);
		return sounds.size() > 0 ? v : undefined;
	}

	private setMusic(id: string | undefined): void {
		if (id === this.musicId) return;
		this.musicId = id;
		const old = this.music;
		this.music = undefined;
		const fade = new TweenInfo(AUDIO_VIEW.musicFadeSec);
		if (old !== undefined) {
			const t = TweenService.Create(old, fade, { Volume: 0 });
			t.Completed.Connect(() => old.Destroy());
			t.Play();
		}
		if (id === undefined) return;
		const sound = this.makeSound(id, true);
		if (sound === undefined) return;
		const target = sound.Volume;
		sound.Volume = 0;
		sound.Play();
		TweenService.Create(sound, fade, { Volume: target }).Play();
		this.music = sound;
	}
}
