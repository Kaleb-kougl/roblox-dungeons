import { Controller, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { ContentProvider, GuiService, RunService, SoundService, TweenService } from "@rbxts/services";
import { createSelector } from "@rbxts/reflex";
import {
	clientStore,
	selectAudio,
	selectGameActive,
	selectInputDevice,
	selectMenuScreen,
	selectRunInfo,
	selectSnapshot,
} from "client/store";
import { TUTORIAL_WORLD_KIND } from "shared/run";
import type { AudioSettings } from "shared/settings";
import { SOUND_GROUPS, type PitchRange, type SoundGroupName, type ThemePack } from "shared/theme";
import {
	ALL_SFX,
	AUDIO_VIEW,
	AudioCueList,
	AudioCueMapper,
	BIOME_MUSIC_COUNT,
	DUCKING_SFX,
	MUSIC,
	MusicDuck,
	PitchJitter,
	SFX,
	VariantPicker,
	ambienceFor,
	biomeAmbience,
	biomeMusic,
	musicFor,
	musicPlace,
	soundGroupVolume,
	type MusicView,
	type Playable,
} from "shared/view/audio";
import { SimController, type RunContext } from "../game/SimController";
import { ThemeController } from "../game/ThemeController";
import { FxTrackerController } from "../fx/FxTrackerController";

/** One clip of a sound's pool: its pooled Sounds (round-robin; a busy clip restarts its oldest voice). */
interface ClipVoices {
	readonly sounds: Sound[];
	next: number;
}

/** Pooled voices of one sound ID (created on first play; an ID that resolves silent never creates any). */
interface Voices {
	readonly clips: ClipVoices[];
	readonly volume: number;
	readonly pitch: Readonly<PitchRange> | undefined;
}

/** A looped bed (music or ambience): one Sound at a time, cross-faded on change. */
class LoopChannel {
	private id: string | undefined;
	private sound: Sound | undefined;

	constructor(
		private readonly make: (id: string) => Sound | undefined,
		private readonly fadeSec: number,
		private readonly scale: number,
	) {}

	set(id: string | undefined): void {
		if (id === this.id) return;
		this.id = id;
		const old = this.sound;
		this.sound = undefined;
		const fade = new TweenInfo(this.fadeSec);
		if (old !== undefined) {
			const t = TweenService.Create(old, fade, { Volume: 0 });
			t.Completed.Connect(() => old.Destroy());
			t.Play();
		}
		if (id === undefined) return;
		const sound = this.make(id);
		if (sound === undefined) return;
		const target = sound.Volume * this.scale;
		sound.Volume = 0;
		sound.Play();
		TweenService.Create(sound, fade, { Volume: target }).Play();
		this.sound = sound;
	}

	destroy(): void {
		this.sound?.Destroy();
		this.sound = undefined;
		this.id = undefined;
	}
}

/**
 * Audio (task 8 part B, docs/FX_AUDIO.md A3): every sound reaches the game by logical ID through ThemePack.sound(id) ->
 * { assetId | undefined, variants, volume, pitch, minInterval, group }. While an ID is `silent` (the placeholder pack,
 * and vale until its audio is uploaded) nothing is created or played for it; pasting IDs makes it play with no code
 * change.
 *
 *   SoundGroups  SoundService."sfx" and SoundService."music" (found or created; theme contract SOUND_GROUPS), volume
 *                AUDIO_VIEW.groupVolume[group] x AUDIO_VIEW.masterVolume x the player's master and group volume
 *                (Options > Audio, shared/view/audio soundGroupVolume; follows changes live); the music group also
 *                times the duck. Each Sound's own Volume is the manifest's, times the cue's volume scale.
 *   sfx          the pure mapper (shared/view/audio AudioCueMapper) turns each frame's summed sim events, the hit
 *                tracker's events and the sim state into cues (once per frame, per-ID cooldowns with the pack's
 *                minInterval, one jingle, at most AUDIO_VIEW.maxStartsPerFrame by priority, teammates' sounds
 *                quieter in co-op); each cue plays one clip of the ID's pool (round-robin, VariantPicker) at a
 *                jittered PlaybackSpeed (PitchJitter, the pack's pitch range) on a small pool of Sounds
 *                (AUDIO_VIEW.voicesPerSfx per ID). The mapper is given `playable` (the ID has an assetId): a silent
 *                ID with an SFX_FALLBACK cues that instead (no finisher clip: the swing), one without never becomes a
 *                cue (no cap slot, no cooldown).
 *   duck         a DUCKING_SFX sound (jingles, the Ember) dips the music group to AUDIO_VIEW.duck.level for the
 *                clip's length (MusicDuck, every Heartbeat).
 *   music        musicFor(menu screen, outcome, boss engaged, tutorial, biome): music.menu in the menus, music.lobby
 *                in the lobby room (music.menu while silent), the floor's music.biome.<n> (music.tutorial in the
 *                tutorial), music.boss during the fight, silence after a death (the mapper plays the run-over
 *                jingle, X7); switching cross-fades over AUDIO_VIEW.musicFadeSec. Looped.
 *   ambience     ambienceFor: the floor's amb.b<n> under the music during a run (sfx group, X5), times
 *                AUDIO_VIEW.ambientVolume, cross-faded over AUDIO_VIEW.ambientFadeSec, silent after a death.
 *   preload      ContentProvider:PreloadAsync on every run start (every sound effect, the floor's music and
 *                ambience) and floor change (that floor's music, ambience and the boss track); nothing when all
 *                of it is silent.
 *   ui           playUi(id): sfx.ui.click / confirm / back from the HUD's and menus' buttons (MenuController's B /
 *                Backspace back too), through the same fallback (no back clip: the click); a gamepad focus move
 *                (GuiService.SelectedObject) plays sfx.ui.move, rate-limited by the mapper (silent while it has no
 *                clip: no fallback).
 *
 * Presentation only: reads the run, never writes it.
 */
@Controller({})
export class AudioController implements OnStart {
	private readonly janitor = new Janitor();
	private pack: ThemePack | undefined;
	/** The ID has a clip in the pack (nothing does before onStart). */
	private readonly playable: Playable = (id) => this.pack !== undefined && this.pack.sound(id).assetId !== undefined;
	private readonly mapper = new AudioCueMapper(this.playable);
	private readonly picker = new VariantPicker();
	private readonly jitter = new PitchJitter();
	private readonly duck = new MusicDuck();
	private readonly voices = new Map<string, Voices>();
	private readonly groups = new Map<SoundGroupName, SoundGroup>();
	private readonly cues = new AudioCueList();
	private folder: Folder | undefined;
	private audio: AudioSettings | undefined;
	private duckLevel = 1;
	private music: LoopChannel | undefined;
	private ambience: LoopChannel | undefined;

	constructor(
		private readonly sim: SimController,
		private readonly theme: ThemeController,
		private readonly fx: FxTrackerController,
	) {}

	onStart(): void {
		const pack = this.theme.getPack();
		this.pack = pack;
		for (const name of SOUND_GROUPS) this.groups.set(name, this.soundGroup(name));
		// The player's volumes (Options > Audio) scale the SoundGroups, live.
		this.applyVolumes(selectAudio(clientStore.getState()));
		this.janitor.Add(clientStore.subscribe(selectAudio, (audio) => this.applyVolumes(audio)));
		const folder = new Instance("Folder");
		folder.Name = AUDIO_VIEW.folderName;
		folder.Parent = SoundService;
		this.folder = this.janitor.Add(folder);
		// The pack's per-sound minimum intervals override the mapper's defaults.
		for (const id of ALL_SFX) this.mapper.setMinInterval(id, pack.sound(id).minInterval);

		this.fx.onFrame((events) => {
			const ctx = this.sim.getContext();
			if (ctx === undefined) return;
			this.cues.clear();
			// The per-player split follows the view index: while spectating, the watched teammate's sounds are loud.
			const viewIndex = this.sim.getViewPlayerIndex();
			this.mapper.frame(
				os.clock(),
				ctx.run.frameEvents,
				events,
				ctx.run.state,
				viewIndex,
				this.cues,
				ctx.run.boostEvents,
			);
			for (let i = 0; i < this.cues.size(); i++) this.play(this.cues.id(i), this.cues.volume(i));
		});

		// Music and ambience follow the HUD snapshot (outcome, boss engaged), the run (biome, tutorial) and the menu.
		this.music = new LoopChannel((id) => this.makeSound(id, true), AUDIO_VIEW.musicFadeSec, 1);
		this.ambience = new LoopChannel(
			(id) => this.makeSound(id, true),
			AUDIO_VIEW.ambientFadeSec,
			AUDIO_VIEW.ambientVolume,
		);
		this.janitor.Add(() => {
			this.music?.destroy();
			this.ambience?.destroy();
		});
		const playable = this.playable;
		const selectView = createSelector(
			[selectSnapshot, selectRunInfo, selectGameActive, selectMenuScreen] as const,
			(snapshot, run, active, screen): MusicView => ({
				outcome: snapshot.outcome,
				bossVisible: snapshot.bossVisible,
				biome: run.biome,
				place: musicPlace(active, screen),
				tutorial: run.world === TUTORIAL_WORLD_KIND,
			}),
		);
		const selectMusic = createSelector([selectView] as const, (view) => musicFor(view, playable));
		const selectAmbience = createSelector([selectView] as const, (view) => ambienceFor(view));
		this.janitor.Add(clientStore.subscribe(selectMusic, (id) => this.music?.set(id)));
		this.janitor.Add(clientStore.subscribe(selectAmbience, (id) => this.ambience?.set(id)));
		this.music.set(selectMusic(clientStore.getState()));
		this.ambience.set(selectAmbience(clientStore.getState()));

		// The music duck (jingles, the Ember), applied to the music SoundGroup.
		this.janitor.Add(RunService.Heartbeat.Connect((dt) => this.applyDuck(dt)));

		// Preload: every run start (all sound effects + the floor's beds) and every floor change (its beds).
		this.sim.onRunStarted((ctx) => this.preload(ctx, true));
		this.sim.onFloorChanged((ctx) => this.preload(ctx, false));

		// Gamepad focus moves: a quiet, rate-limited tick.
		let selected = GuiService.SelectedObject;
		this.janitor.Add(
			GuiService.GetPropertyChangedSignal("SelectedObject").Connect(() => {
				const prev = selected;
				selected = GuiService.SelectedObject;
				if (prev === undefined || selected === undefined || prev === selected) return;
				if (selectInputDevice(clientStore.getState()) !== "gamepad") return;
				if (this.mapper.uiCue(os.clock(), SFX.uiMove)) this.play(SFX.uiMove, 1);
			}),
		);
	}

	/** A menu sound (sfx.ui.*). */
	playUi(id: string): void {
		this.play(id, 1);
	}

	/**
	 * Plays one sound effect by logical ID at `scale` x its volume: the next clip of its pool, a jittered speed.
	 * A silent / missing ID plays its SFX_FALLBACK (mapper.resolve), else nothing.
	 */
	play(id: string, scale: number): void {
		const playId = this.mapper.resolve(id);
		if (playId === undefined) return;
		const v = this.voicesFor(playId);
		if (v === undefined) return;
		const clip = v.clips[this.picker.pick(playId, v.clips.size())];
		const sound = clip.sounds[clip.next];
		clip.next = (clip.next + 1) % clip.sounds.size();
		sound.Volume = v.volume * scale;
		sound.PlaybackSpeed = this.jitter.speed(v.pitch);
		sound.TimePosition = 0;
		sound.Play();
		if ((DUCKING_SFX as ReadonlyArray<string>).includes(playId)) {
			const length = sound.TimeLength > 0 ? sound.TimeLength / sound.PlaybackSpeed : AUDIO_VIEW.duck.holdSec;
			this.duck.trigger(os.clock(), length);
		}
	}

	private soundGroup(name: SoundGroupName): SoundGroup {
		const existing = SoundService.FindFirstChild(name);
		const group = existing !== undefined && existing.IsA("SoundGroup") ? existing : new Instance("SoundGroup");
		group.Name = name;
		group.Volume = AUDIO_VIEW.groupVolume[name] * AUDIO_VIEW.masterVolume;
		group.Parent = SoundService;
		return group;
	}

	private applyVolumes(audio: AudioSettings): void {
		this.audio = audio;
		for (const [name, group] of this.groups) {
			group.Volume = soundGroupVolume(name, audio) * (name === "music" ? this.duckLevel : 1);
		}
	}

	private applyDuck(dt: number): void {
		const level = this.duck.level(os.clock(), dt);
		if (level === this.duckLevel) return;
		this.duckLevel = level;
		const group = this.groups.get("music");
		if (group !== undefined && this.audio !== undefined)
			group.Volume = soundGroupVolume("music", this.audio) * level;
	}

	/** A Sound for clip `clip` of `id` (theme volume, its SoundGroup), or undefined while the ID is silent. */
	private makeSound(id: string, looped: boolean, clip = 0): Sound | undefined {
		const ref = this.pack?.sound(id);
		if (ref === undefined || ref.assetId === undefined) return undefined;
		const assetId = clip === 0 ? ref.assetId : ref.variants[clip - 1];
		if (assetId === undefined) return undefined;
		const sound = new Instance("Sound");
		sound.Name = id;
		sound.SoundId = assetId;
		sound.Volume = ref.volume;
		sound.Looped = looped;
		sound.SoundGroup = this.groups.get(ref.group);
		sound.Parent = this.folder;
		return sound;
	}

	private voicesFor(id: string): Voices | undefined {
		const cached = this.voices.get(id);
		if (cached !== undefined) return cached.clips.size() > 0 ? cached : undefined;
		const ref = this.pack?.sound(id);
		const clips: ClipVoices[] = [];
		if (ref !== undefined && ref.assetId !== undefined) {
			const pool = 1 + ref.variants.size();
			const perClip = math.max(1, math.ceil(AUDIO_VIEW.voicesPerSfx / pool));
			for (let c = 0; c < pool; c++) {
				const sounds: Sound[] = [];
				for (let i = 0; i < perClip; i++) {
					const s = this.makeSound(id, false, c);
					if (s !== undefined) sounds.push(s);
				}
				if (sounds.size() > 0) clips.push({ sounds, next: 0 });
			}
		}
		const v: Voices = { clips, volume: ref?.volume ?? 0, pitch: ref?.pitch };
		this.voices.set(id, v);
		return clips.size() > 0 ? v : undefined;
	}

	/** Every clip of `id` (assetId + variants), appended to `out`; nothing while silent. */
	private clipsOf(id: string | undefined, out: string[]): void {
		if (id === undefined) return;
		const ref = this.pack?.sound(id);
		if (ref === undefined || ref.assetId === undefined) return;
		out.push(ref.assetId);
		for (const v of ref.variants) out.push(v);
	}

	/** Preloads the run's sound effects (on a run start) and the floor's music / ambience / boss track. */
	private preload(ctx: RunContext, runStart: boolean): void {
		const ids: string[] = [];
		if (runStart) for (const id of ALL_SFX) this.clipsOf(id, ids);
		const biome = clientStore.getState().game.run.biome;
		if (biome >= 1 && biome <= BIOME_MUSIC_COUNT) this.clipsOf(biomeMusic(biome), ids);
		this.clipsOf(biomeAmbience(biome), ids);
		this.clipsOf(MUSIC.boss, ids);
		if (ctx.world === TUTORIAL_WORLD_KIND) this.clipsOf(MUSIC.tutorial, ids);
		if (ids.size() === 0) return;
		task.spawn(() => ContentProvider.PreloadAsync(ids));
	}
}
