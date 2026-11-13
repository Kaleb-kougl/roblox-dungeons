// Secret rooms in the cue mapper (docs/SECRET_ROOMS.md SR6): the knock, the crumble at the open and the jingle at the
// reveal from the frame's SecretCueSource edges, full volume near the listener and the teammate's volume (a rank lower)
// for a far teammate's; nothing without an edge; each falls back while silent (the breakable hit / break, the treasure
// jingle); and the cue tracker's edges reaching the mapper over the secret arena (a finisher opening the crack: the
// crumble on the open's frame, the jingle reveal.jingleSec later, a knock per swing before).
import { describe, expect, it } from "@rbxts/jest-globals";
import { gridToWorld } from "shared/dungeon";
import {
	ALL_EVENT_FIELDS,
	AXIS_MAX,
	Button,
	EMPTY_INPUT,
	SECRETS_CONFIG,
	SIM_HZ,
	createSimState,
	eventDefault,
	step,
	type SimEvents,
	type SimState,
} from "shared/sim";
import { ARENA, arenaConfig, arenaSecret } from "shared/sim/testing";
import { NO_BOOST_EVENTS } from "shared/view/boosts";
import { FxEventBuffer, NO_BUILD_FX_EVENTS, NO_COMBO_EVENTS, NO_VARIANT_CUES } from "shared/view/fx";
import { NO_GOLDEN_EVENTS, NO_GOLDEN_RUMOUR_CUES } from "shared/view/golden";
import { NO_DAILY_RANK_CUES, NO_NEW_BEST_CUES } from "shared/view/hud";
import { NO_PACT_EVENTS } from "shared/view/pacts";
import { NO_PELLET_EVENTS } from "shared/view/pellets";
import {
	NO_SECRET_CUES,
	SECRET_VIEW,
	SecretCueTracker,
	SecretFrameEvents,
	type SecretCueSource,
} from "shared/view/secrets";
import { NO_TREASURE_CUES } from "shared/view/treasure";
import { AUDIO_VIEW, AudioCueList, AudioCueMapper, NO_SYNC_CUES, SFX, SFX_FALLBACK, type Playable } from ".";

function noEvents(): SimEvents {
	const e = {} as SimEvents;
	for (const f of ALL_EVENT_FIELDS) e[f] = eventDefault(f);
	return e;
}

const NO_FX = new FxEventBuffer(4);

function frame(m: AudioCueMapper, now: number, s: SimState, secrets: SecretCueSource): Array<[string, number, number]> {
	const out = m.frame(
		now,
		noEvents(),
		NO_FX,
		s,
		0,
		new AudioCueList(),
		NO_BOOST_EVENTS,
		NO_COMBO_EVENTS,
		undefined,
		NO_VARIANT_CUES,
		NO_NEW_BEST_CUES,
		NO_BUILD_FX_EVENTS,
		NO_DAILY_RANK_CUES,
		NO_PELLET_EVENTS,
		NO_SYNC_CUES,
		NO_TREASURE_CUES,
		NO_PACT_EVENTS,
		NO_GOLDEN_EVENTS,
		NO_GOLDEN_RUMOUR_CUES,
		secrets,
	);
	const list: Array<[string, number, number]> = [];
	for (let i = 0; i < out.size(); i++) list.push([out.id(i), out.volume(i), out.speed(i)]);
	return list;
}

const edges = (over: Partial<SecretCueSource>): SecretCueSource => ({ ...NO_SECRET_CUES, ...over });
const T = AUDIO_VIEW.teammateVolume;

describe("audio: secret rooms (docs/SECRET_ROOMS.md SR6)", () => {
	it("near: full volume; far: the teammate's volume; nothing without an edge", () => {
		const s = createSimState(1, 0, 0);
		expect(frame(new AudioCueMapper(), 0, s, edges({ knock: true, knockNear: true }))).toEqual([
			[SFX.secretKnock, 1, 0],
		]);
		expect(frame(new AudioCueMapper(), 0, s, edges({ knock: true }))).toEqual([[SFX.secretKnock, T, 0]]);
		expect(frame(new AudioCueMapper(), 0, s, edges({ open: true, openNear: true }))).toEqual([
			[SFX.secretOpen, 1, 0],
		]);
		expect(frame(new AudioCueMapper(), 0, s, edges({ jingle: true }))).toEqual([[SFX.jingleSecret, T, 0]]);
		expect(frame(new AudioCueMapper(), 0, s, NO_SECRET_CUES)).toEqual([]);
		expect(new AudioCueMapper().frame(0, noEvents(), NO_FX, s, 0, new AudioCueList()).size()).toBe(0);
	});

	it("silent: the knock plays the breakable hit, the crumble the break, the jingle the treasure jingle", () => {
		const s = createSimState(1, 0, 0);
		const ids = [SFX.secretKnock, SFX.secretOpen, SFX.jingleSecret];
		expect(ids.map((id) => SFX_FALLBACK[id])).toEqual([SFX.breakableHit, SFX.breakableBreak, SFX.jingleTreasure]);
		const silent: Playable = (id) => !(ids as ReadonlyArray<string>).includes(id);
		expect(frame(new AudioCueMapper(silent), 0, s, edges({ knock: true, knockNear: true }))).toEqual([
			[SFX.breakableHit, 1, 0],
		]);
		expect(frame(new AudioCueMapper(silent), 0, s, edges({ open: true, openNear: true }))).toEqual([
			[SFX.breakableBreak, 1, 0],
		]);
		expect(frame(new AudioCueMapper(silent), 0, s, edges({ jingle: true, jingleNear: true }))).toEqual([
			[SFX.jingleTreasure, 1, 0],
		]);
	});

	it("the tracker's edges over the arena: a knock per swing, the crumble at the open, the jingle at the reveal", () => {
		const config = arenaConfig(5, { extraConfig: { secrets: SECRETS_CONFIG } });
		const s = createSimState(5, ARENA.spawnX, ARENA.spawnZ, config);
		s.player.hurtTicks = 1e6;
		s.player.x = gridToWorld(ARENA.crackX) + 0.5;
		s.player.z = gridToWorld(ARENA.wallZ) + 2;
		const plan = arenaSecret(0);
		const tracker = new SecretCueTracker();
		const m = new AudioCueMapper();
		const ev = new SecretFrameEvents();
		const heard: Array<[number, string, number]> = [];
		const fire = { ...EMPTY_INPUT, aimZ: -AXIS_MAX, buttons: Button.FIRE };
		const idle = { ...EMPTY_INPUT, aimZ: -AXIS_MAX };
		let openTick = -1;
		for (let n = 0; n < 4 * SIM_HZ; n++) {
			ev.reset();
			step(s, openTick < 0 ? fire : idle, config);
			ev.collect(s);
			if (ev.opened.size() > 0) openTick = s.tick;
			const c = tracker.update(s, plan, ev, s.tick / SIM_HZ, 0);
			for (const [id, vol] of frame(m, s.tick / SIM_HZ, s, c)) heard.push([s.tick, id, vol]);
		}
		const secret = heard.filter(
			([, id]) => id === SFX.secretKnock || id === SFX.secretOpen || id === SFX.jingleSecret,
		);
		const jingleTick = openTick + math.round(SECRET_VIEW.reveal.jingleSec * SIM_HZ);
		expect(secret.map(([tick, id, vol]) => [id, vol, id === SFX.secretOpen ? tick === openTick : true])).toEqual([
			[SFX.secretKnock, 1, true],
			[SFX.secretKnock, 1, true],
			[SFX.secretOpen, 1, true],
			[SFX.jingleSecret, 1, true],
		]);
		expect(math.abs(secret[3][0] - jingleTick) <= 1).toBe(true);
	});
});
