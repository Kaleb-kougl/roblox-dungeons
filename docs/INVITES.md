# Roblox invites and parties: plan

Status (2026-10-27): **I1-I3 built (pure cores, headless specs), with the §6 config and §7 analytics; I0's spike is
built (`KV_InviteSpike`, docs/SPIKES.md "Spike I0") and waits for its published-place run; I4-I9 open; decisions
ID1-ID7 confirmed.** Companion to the lobby plan (project doc `claude/menu-lobby-plan.md`,
as built in docs/SERVER.md "Lobbies" and docs/CLIENT.md). This plan takes over L8's `PromptGameInvite` bullet; the rest
of L8 (Friends tab, teleport follow) stays there.

Presentation, server and network only: **no sim, dungeon, lockstep, hash, replay or fixture change.**

## Goal

Today a lobby invite (`lobbyInvite`, `Lobbies.invite`) only reaches a player who is **already in this server**
(`LobbyService.invite` refuses anyone else with `NOT_IN_SERVER`). This plan connects lobbies to Roblox's own social
features so a group can form from outside the game:

1. **Friend invites.** From a lobby, **Invite friends** opens Roblox's invite prompt (`SocialService:PromptGameInvite`).
   The friend gets a Roblox notification; accepting it lands them in the inviter's server, and they arrive **in the
   lobby** (Closed included: it is an invite). The same button on the main menu invites a friend to the game without a
   lobby.
2. **Roblox Party.** Players who come in together as a Roblox Party (`Player.PartyId`) are grouped into one lobby
   automatically, so "join with party" ends in the same lobby, not just the same server.

Out of scope (decided 2026-10-27): share links (`PromptLinkSharingAsync`, random server, needs Phase 2), invite rewards
/ referral tracking, cross-server invites, Open Cloud experience notifications.

## What the Roblox API gives us (researched 2026-10-27; I0 confirms each row in a published place)

| Fact | Source | Consequence |
|---|---|---|
| `SocialService:PromptGameInvite(player, ExperienceInviteOptions?)` opens the invite prompt. Options: `PromptMessage`, `InviteUser` (one friend), `InviteMessageId` (a Notification String asset id), `LaunchData` (string, **max 200 chars**) | Invite prompts docs | The server builds the options (lobby id in `LaunchData`), so the client can't name a lobby it isn't in |
| `SocialService:CanSendGameInviteAsync(player, recipientId?)` yields and can fail; eligibility varies by platform and player | SocialService ref, invite docs | Check once per menu session (pcall); grey the button out with a reason when false |
| `SocialService.GameInvitePromptClosed(player, recipientIds)` fires when the prompt closes | SocialService ref | The list of friends actually invited: recorded as **platform invites** (below). I0: which side it fires on |
| Accepting an invite **bypasses matchmaking and joins the inviter's server**; a full server shows a join queue | DevForum "Updates to Invites" (2023-12) | The invitee normally lands where the lobby is, so no teleport is needed. I0: what happens if the inviter has left |
| `Player:GetJoinData().LaunchData` carries the string; it "can take a few seconds to appear"; users can edit it | Invite docs, deep-link docs | LaunchData is a **hint**, never proof: Closed entry needs a server-side invite record |
| Invites **cannot target subplaces** | DevForum bug thread (2026-08) | Fine today (one place, `publish.project.json`); a future multi-place split must invite from the root place |
| Notification text: a **Notification String** made in Creator Dashboard (Engagement > Notifications), must contain `{experienceName}`, may use `{displayName}`; tied to one experience | Invite docs | Owner task (I8); ids per universe in config; without one Roblox's default text is used |
| `Player.PartyId` (empty = no party), `SocialService:GetPlayersByPartyId(id)`, `SocialService:GetPartyAsync(id)` (members across servers, ordered by when they accepted; `UserId`, `PlaceId`, `JobId`, ...). The API can't create, invite to or open a party | Party API announcement (DevForum) | Read-only grouping signal, server side. I0: readable at `PlayerAdded`? (the ref lists it Hidden / Roblox Security) |
| None of this works in Studio playtests (party, invites, launch data) | Party API thread, invite docs | Pure cores are specced headlessly; Studio uses fake attributes; the real thing is tested in a published test place |

## Player experience

### Sending

- **In a lobby** (any member, same rule as `lobbyInvite`): the invite panel in `LobbyRoom` gets a top row
  **Invite friends (Roblox)**. It opens Roblox's prompt; the friends picked there show in the lobby's activity feed
  ("`<Name>` invited 3 friends") and in the invite list as "Invited (Roblox)" if they are not in the server yet.
- **Main menu, not in a lobby**: **Invite friends** (next to Lobbies). No lobby is attached.
- **Unavailable** (`CanSendGameInviteAsync` false or failed): the button is disabled with "Invites aren't available
  on this account or device".
- Nothing changes for in-server invites: the existing list and toasts stay as they are.

### Arriving

- **From a lobby invite**: the friend joins the inviter's server and goes **straight into the lobby** (no toast to
  answer: tapping the notification was the answer). A first-time player **skips the automatic first-run tutorial** (it
  stays on the main menu's Tutorial button), matching the lobby plan's teleport-follow rule: never block a group.
- **The lobby can't take them** (full, deleted, in a run): they land on the main menu with a toast ("That lobby is
  full" / "has closed"). If the lobby is in a run, the invite is still live and joinable when the run ends, like any
  invite (existing edge case).
- **From a menu invite** (no lobby): the inviter gets a quiet notice "`<Name>` joined from your invite" with an
  **Invite** button if the inviter is now in a lobby.
- **Arrived from Roblox's own menu invite** (no LaunchData, no record): nothing special; they land on the menu.

### Roblox Party

- **Arrival**: a party member who joins a server where a party mate is in a forming lobby with room is put into that
  lobby (an automatic invite from that mate, so Closed works). If two or more party mates are here and none is in a
  lobby, a lobby is made for them: host = the party mate who accepted the party earliest (`GetPartyAsync` order;
  fallback: first in the server), visibility `INVITE.partyLobbyVisibility` (Closed), everyone else joins it.
- **A party mate is in a run**: the arrival gets the lobby (as host if there is none) and the busy mate gets an
  ordinary invite (badge mid-run, answered on return).
- **Mid-session** (a `PartyId` change while playing): no automatic moves; the player gets a toast "Your Roblox party
  is in `<lobby>`: [Join]".
- **Full lobby**: whoever doesn't fit lands on the menu with "Your party's lobby is full".
- Anyone can always **Leave** a party lobby; party grouping happens on arrival only, so they aren't pulled back in.

## Architecture

### 1. Launch data codec (`shared/invite/launchData.ts`, pure, headless)

```ts
export type InviteLaunch =
	| { readonly kind: "lobby"; readonly lobbyId: string; readonly fromUserId: number }
	| { readonly kind: "game"; readonly fromUserId: number };
export function encodeInviteLaunch(l: InviteLaunch): string; // asserts <= INVITE.launchDataMaxChars
export function decodeInviteLaunch(s: string): InviteLaunch | undefined; // never throws
```

- A tiny text format (`kv1|l|<lobbyId>|<userId>`, `kv1|g|<userId>`), not JSON, so the shared module needs no
  `HttpService` and runs headlessly. A GUID lobby id keeps it under 60 chars (limit 200).
- `decode` returns `undefined` for anything unexpected (wrong version, bad id shape via `Lobbies`' own checks, extra
  fields, over-long); users can edit LaunchData.

### 2. Platform invites in the lobby model (`shared/lobby/lobbies.ts`)

A platform invite is an ordinary `LobbyInvite` with `source: "platform"` that may name a player **not in this server**:

- `Lobbies.platformInvites(fromUserId, toUserIds, ctx)`: same sender rules as `invite` (member, not `inRun`, kick
  cooldown, not already invited, invitee not in a lobby), but its own cap `LOBBY.maxPlatformInvitesPerMember` (20,
  counted apart from `maxInvitesPerMember`) and TTL `LOBBY.platformInviteTimeoutSeconds` (900: notifications are read
  late). Returns the invites it made and a refusal per id it skipped.
- Recipients aren't checked for friendship or presence: any member may invite anyone, and a non-friend id just never
  receives a notification. That is why a client-reported recipient list is safe to accept.
- On arrival nothing converts: the player already has a live invite, so `invitesFor` / `join` work as today. The
  existing drops (lobby deleted, kick, joined elsewhere) apply unchanged; `playerRemoving` of a player who never
  arrived drops nothing.
- `LobbyInvite` gains `source: "server" | "platform"`; `LobbyView.invited` entries carry it ("Invited (Roblox)").

### 3. Arrival resolver (`shared/invite/arrival.ts`, pure, headless)

```ts
export type ArrivalAction =
	| { kind: "joinInvite"; inviteId: string }        // a live invite (platform or party)
	| { kind: "joinOpen"; lobbyId: string }           // LaunchData names a lobby canAccess lets them into
	| { kind: "makePartyLobby"; hostId: number; joiners: number[]; invitees: number[] }
	| { kind: "notify"; toUserId: number; notice: "inviteArrived" | "followed" }
	| { kind: "toast"; key: string }                  // full / gone / in run
	| { kind: "none" };
export function resolveArrival(input: ArrivalInput): ReadonlyArray<ArrivalAction>;
```

Priority, first match wins: (1) a live invite to a forming lobby with room (the LaunchData lobby first, else the
oldest); (2) the LaunchData lobby if `canAccess` (Open / host's friend); (3) LaunchData lobby is Closed and no invite:
`followed` notice to the sender (the existing notice kind; any member can then invite); (4) party: a mate's forming
lobby, else `makePartyLobby`; (5) LaunchData `game`: `inviteArrived` to the sender; (6) a toast for a lobby that is
full / gone / in a run; (7) none. Busy arrivals (tutorial already running) get only toasts and notices.

### 4. Server: `InviteService` (new, `src/server/services/InviteService.ts`)

Keeps `LobbyService` a thin wrapper of `Lobbies`; InviteService calls new public LobbyService methods
(`platformInvites`, `applyArrival`) and never touches `Lobbies` directly.

- **Prompt**: client -> server `invitePrompt({ withLobby: boolean })` (rate `INVITE_PROMPT_RATE`, 5 per 60 s). The
  server checks membership, builds `ExperienceInviteOptions` (`InviteMessageId` from `INVITE.notificationStringIds`
  for this `game.GameId`, `LaunchData` from the codec) and calls `PromptGameInvite`. If I0 shows it must run on the
  client, the server returns the encoded LaunchData and the client prompts.
- **Recipients**: `GameInvitePromptClosed` (server side, or relayed by the client as
  `inviteRecipients(userIds)`, at most `LOBBY.maxPlatformInvitesPerMember` integers) -> `platformInvites`, one feed
  line, analytics.
- **Eligibility**: client -> server `inviteEligibility()` -> one pcall'd `CanSendGameInviteAsync` per player per
  `INVITE.eligibilityCacheSeconds` (300) -> `inviteEligible(boolean)`.
- **Arrival**: on `PlayerAdded`, resolve at once from live platform invites + party mates (both already known, so the
  common case has no wait). Then poll `GetJoinData().LaunchData` every `INVITE.launchDataPollSeconds` (1) up to
  `INVITE.launchDataWaitSeconds` (10) only if nothing matched yet; a late answer is applied if the player is still on
  the menu, or becomes a toast if they started something.
- **Join intent**: server -> client `joinIntent({ kind: "lobby" | "party" | "none" })`, sent as soon as the first
  resolve is done. The client's first-join choice (tutorial vs menu) waits for both the onboarding status and this,
  capped at `INVITE.intentWaitSeconds` (2) so a slow server never stalls a normal join.
- **Party index**: `PartyId` per player (PlayerAdded + `GetPropertyChangedSignal`), `GetPartyAsync` once per party
  for the accept order (pcall; on failure, server join order). Studio: `KV_FakePartyId` (Player attribute, read only
  when `RunService:IsStudio()`).
- **Studio**: `KV_FakeLaunchData` (Player attribute with an encoded string, Studio only) stands in for
  `GetJoinData()`; `KV_FakeInviteEligible` forces the eligibility answer.

### 5. Client

| Piece | Change |
|---|---|
| `LobbyRoom` invite panel | **Invite friends (Roblox)** row; "Invited (Roblox)" entries; disabled state with reason |
| `MainMenu` | **Invite friends** button (no lobby) |
| `LobbyController` / `actions.ts` | `invitePrompt`, eligibility request on menu open, `joinIntent` into the store |
| `store/lobby.ts` | `inviteEligible?: boolean`, `joinIntent?` |
| First-join flow (MenuController / TutorialController) | Wait for `joinIntent`; `lobby` / `party` skips the automatic tutorial |
| `Toasts.tsx` | New notice kinds `inviteArrived`, `partyLobby`; arrival toasts (full / gone / in run) |
| Theme strings | `lobby.invitePlatform`, `lobby.invitePlatformUnavailable`, `lobby.invitedPlatform`, `lobby.feed.invitedFriends`, `lobby.notice.inviteArrived`, `lobby.notice.partyLobby`, `lobby.err.inviteGone`, `lobby.err.partyFull`, `menu.inviteFriends` (every pack) |

### 6. Config (`shared/lobby/config.ts` + a new `INVITE` block)

`maxPlatformInvitesPerMember` 20, `platformInviteTimeoutSeconds` 900, `INVITE.launchDataMaxChars` 200,
`launchDataPollSeconds` 1, `launchDataWaitSeconds` 10, `intentWaitSeconds` 2, `eligibilityCacheSeconds` 300,
`partyLobbyVisibility` "closed", `notificationStringIds: ReadonlyMap<gameId, string>` (UUIDs; add
`// check-asset-ids: allow (notification string uuid)` if the checker flags the digits), `INVITE_PROMPT_RATE`.

### 7. Telemetry

`LobbyInviteSent` gains field01 `server` | `platform` (value = recipients). New `InviteArrival` (field01:
`joinedInvite` / `joinedOpen` / `followedClosed` / `full` / `gone` / `inRun` / `noData`, field02: `lobby` | `game`)
and `PartyGrouped` (value = size, field01: `joined` / `created` / `offered`). The ratio of `InviteArrival` to platform
`LobbyInviteSent` recipients is the invite conversion rate.

## Tasks

- [ ] **I0. Verify the API in a published test place.** A spike behind `KV_InviteSpike` (docs/SPIKES.md): server-side
  `PromptGameInvite` with options; which side `GameInvitePromptClosed` fires on and what `recipientIds` holds (also
  for Roblox's own menu invite); landing server when the inviter is still there / has left; LaunchData delay;
  `PartyId` readable on the server at `PlayerAdded` and with what delay; "join with party" lands everyone in one
  server; `CanSendGameInviteAsync` with and without a recipient; @rbxts/types coverage (add local declarations for
  anything missing). → Verify: every row of the API table is confirmed or this plan is edited.
- [x] **I1. Launch data codec.** → Verify: specs: round trip both kinds, the longest lobby id stays under 200 chars,
  garbage / wrong version / extra fields / over-long decode to `undefined`, never throws.
- [x] **I2. Platform invites in `Lobbies`.** `source`, `platformInvites`, own cap and TTL. → Verify: specs: absent
  recipients accepted; dedupe with a live server invite; kick cooldown; separate caps; expiry at 900 s; drops on lobby
  delete / kick / join elsewhere; an arriving player joins a Closed lobby through it; existing lobby specs unchanged.
- [x] **I3. Arrival resolver.** → Verify: a spec per priority row, busy arrivals, a forged LaunchData lobby id (Open:
  joins as the browser would; Closed without invite: `followed` only), party: mate's lobby / create / mate in a run /
  full.
- [ ] **I4. InviteService.** Remotes, prompt, recipients, eligibility cache, arrival with LaunchData polling,
  `joinIntent`, party index, Studio fake attributes, rate limits. → Verify: Studio "Clients and Servers" with
  `KV_FakeLaunchData` / `KV_FakePartyId`: each I3 case driven end to end.
- [ ] **I5. Client.** Buttons, eligibility state, toasts, first-join wait and tutorial skip, strings in every pack.
  → Verify: `npm run verify`; Studio: an invited fake arrival on a fresh profile goes to the lobby, not the tutorial;
  a normal fresh join still gets the tutorial within `intentWaitSeconds`.
- [ ] **I6. Party grouping.** Wire the party cases of I3 into InviteService (arrival auto, mid-session toast).
  → Verify: Studio with 3 clients sharing a fake PartyId: staggered arrivals end in one Closed lobby hosted by the
  first; a fourth with a different id is untouched.
- [ ] **I7. Telemetry.** → Verify: no `ANALYTICS_FAILED` through send -> arrive -> join, and party grouping.
- [ ] **I8. Notification string (owner).** Create it in Creator Dashboard for the live and test experiences (e.g.
  "{displayName} wants you in their descent in {experienceName}!"), paste the ids into `INVITE.notificationStringIds`.
- [ ] **I9. Published playtest.** Two friend accounts (three for party): invite from a lobby (Open and Closed), from
  the menu, to an offline friend who opens it 5 min later, to a full lobby, after the lobby closed; a Roblox Party of
  3 joining. Record join time and failures; update docs/SERVER.md "Lobbies", docs/CLIENT.md and the CLAUDE.md
  decision log.

As built (I1-I3, §6, §7):

- **I1** `shared/invite/launchData.ts`: `decodeInviteLaunch(text: unknown, opts?)`; a UserId has exactly one
  spelling (plain decimal, no sign / leading zero, at most 15 digits), so decode-encode is the identity. Option
  `allowNegativeUserIds` (Studio test players are negative; InviteService passes it only under `RunService:IsStudio()`
  for `KV_FakeLaunchData`); live LaunchData with a negative id is undefined. Encode errors (`error(msg, 0)`) on a
  malformed launch or one over `INVITE.launchDataMaxChars`.
- **I2** `LobbyInvite.source` (`LobbyInviteSource`, shared/lobby config.ts). `platformInvites(from, toUserIds:
  unknown, ctx)`: whole-call refusals `badRequest` (not a plain array of integers, or longer than the platform cap),
  `notMember`, `inRun`, `full`; per-id refusals `{ userId, code, reason }` with the existing codes (`badRequest` for
  self, `busy`, `alreadyInLobby`, `kickCooldown`, `alreadyInvited`, `inviteCap`). No new `LobbyRefusal` code. `invite`'s
  cap counts server invites only. `partyInvite(from, to, ctx)`: source "party", platform TTL, no cap, and (unlike the
  others) the invitee may be busy. Views: `LobbyView.invitedSources` (same index as `invited`) and
  `LobbyInviteView.source`.
- **I3** `shared/invite/arrival.ts` `resolveArrival(input)`. Differences from the §3 sketch: a `partyJoin { lobbyId,
  fromUserId }` action (the service makes the party invite from that mate, then joins with it) instead of a
  pre-existing invite; toasts carry `toUserId` (partyFull goes to the extras, who may not be the arrival); `joinInvite`
  carries its `lobbyId`. `followed` goes only to a sender who is a member of the LaunchData lobby (a forged sender id
  notifies nobody), and only while that lobby could take the arrival (a full / in-run Closed lobby is the toast). A
  party mate in a lobby that cannot take the arrival (full / starting / in a run) means a toast, never a second
  lobby. A busy (or already placed) arrival's joins become `lobby.err.busy` / `lobby.err.alreadyInLobby` toasts, and
  a starting countdown reads as `lobby.err.inRun`; a kick cooldown is `lobby.err.kickCooldown`. `arrivalJoinIntent`
  derives the `joinIntent`. Toast ids are `ARRIVAL_TOAST`; `lobby.err.inviteGone` and `lobby.err.partyFull` are new
  strings for I5 (every pack, and `menuStringKeys`).
- **§7** `analyticsForInviteSent(source, recipients)`, `analyticsForInviteArrival(outcome, kind)`,
  `analyticsForPartyGrouped(size, how)` in shared/lobby analytics.ts (names in `LOBBY_ANALYTICS_EVENT`).

Critical path: I0 -> I1 -> I2 -> I3 -> I4 -> I5 -> I9. I6 needs I4; I8 can happen any time before I9.

## Edge cases

- **Inviter left the server** before the friend arrives: the invite belongs to the lobby and stays valid; if Roblox
  routes the friend elsewhere (I0), the lobby isn't here: "That lobby has closed" toast, menu.
- **Lobby deleted** while invites are out: dropped with it; late arrivals get the "gone" toast.
- **Friend already in this server** when invited from the Roblox prompt: the platform invite is a normal live invite
  and shows as a toast at once (dedupe with a server invite).
- **Kicked player** re-invited through the Roblox prompt: refused by the kick cooldown like any invite.
- **Invite spam**: per-member platform cap, the prompt rate limit, and Roblox's own prompt UI.
- **Party bigger than the lobby** (`LOBBY.maxSize` = 8): the extras land on the menu with `lobby.err.partyFull`.
- **Party mate in the tutorial**: busy, so not grouped; gets an ordinary invite they see afterwards.
- **LaunchData arrives after the player started a solo run**: a toast; nothing moves them.
- **Server full**: Roblox's join queue; nothing for us to do (keep `LOBBY.maxSize` well under the server size).
- **Under-13 / console / restricted accounts**: `CanSendGameInviteAsync` false -> disabled button with reason.

## Decisions (confirmed by the owner 2026-10-27)

- **ID1.** Arriving from a lobby invite **auto-joins** the lobby (tapping the notification is the acceptance).
- **ID2.** Platform invites **open Closed lobbies** (they are invites, same as in-server ones).
- **ID3.** Platform invites last **15 min, cap 20 per member**, apart from the in-server 60 s / 4.
- **ID4.** Party grouping is **automatic on arrival**; mid-session it is only an offer (toast).
- **ID5.** Party lobbies start **Closed**; the host can change it.
- **ID6.** Invited and party arrivals **skip the automatic first-run tutorial** (kept on the menu button).
- **ID7.** The main menu gets **Invite friends** without a lobby (this was L8's `PromptGameInvite` item).

## Sources

- Roblox Creator Docs: [Player invite prompts](https://create.roblox.com/docs/production/promotion/invite-prompts),
  [SocialService](https://create.roblox.com/docs/reference/engine/classes/SocialService),
  [ExperienceInviteOptions](https://create.roblox.com/docs/reference/engine/classes/ExperienceInviteOptions),
  [Player](https://create.roblox.com/docs/reference/engine/classes/Player),
  [Deep links](https://create.roblox.com/docs/production/promotion/deeplinks)
- DevForum: [Updates to Invites](https://devforum.roblox.com/t/updates-to-invites-joining-friends-just-got-easier/2729692),
  [Party API is here](https://devforum.roblox.com/t/party-api-is-here-enable-connected-player-experiences-and-drive-deeper-engagement/3676068),
  [No invites to subplaces](https://devforum.roblox.com/t/players-do-not-receive-invite-notifications-when-invited-via-socialservicepromptgameinvite/4655206)
