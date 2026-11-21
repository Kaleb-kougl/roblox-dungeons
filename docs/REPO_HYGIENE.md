# Repo hygiene

Make the repository safe and presentable to publish: session outputs, backups and marketing renders out of the
tree and out of history, one branch line, one identity per author. Tooling and repository state only: nothing in
`src/`, `scripts/` or `fixtures/` changes and `out/` must be byte-identical before and after (`npm run out:digest`).

**Status: RH0-RH8 built on branch `repo-hygiene` (2026-11-21). RH9-RH12, the history rewrite, are the owner's
and block publishing.**

## Findings (main @ `8f94bb31`)

| Item | State before |
|---|---|
| `.git` | 2.2 GB, of which 1.19 GiB is stale `tmp_obj_*` / `tmp_pack_*` files (422 of them) left by shells that could not delete. No remote, no tags, 4 stashes |
| `Claude outputs/` | 4.3 GB on disk; 39 files tracked (77 paths ever added) |
| `_backup/` | 145 MB; 24 files tracked (72 paths ever added) |
| `marketing/` | 26 MB; 8 PNGs tracked |
| Largest blobs in history | `Claude outputs/kv-main.bundle` 303 MB and 145 MB, `_backup/fxaudio/fxaudio.tar` 101 MB |
| Branches | 125 besides `main`: 119 merged, 6 not |
| `worktrees/`, `.wtm/`, `.wtr/` | 7.7 GB, 24 directories, every one's gitdir pointing at a path that no longer exists |
| Author identities | 6 name / email pairs for two authors |

Two findings block publishing until RH9:

1. **Personal documents in history**: four resume PDFs under `Claude outputs/`.
2. **Licensed third-party assets in history**: `_backup/fxaudio/vendor-main.tar` (350 PNGs) and `vendor-lock.tar`
   (267) hold `art/vendor/lords-of-pain-demo/...`; `fxaudio.tar` holds 147 WAV / 41 OGG / 75 PNG of the FX and
   audio packs; `audio-ogg.tar` the 54 built OGGs. The packs' licences forbid redistributing the raw files
   (`art/README.md`). The git bundles in both folders may carry the same content.

## Decisions

- **RHD1. Keep the history, rewrite it.** The folders are removed from every commit with `git filter-repo`;
  nothing is squashed.
- **RHD2. Archive, don't delete.** Everything removed from the tree moved to `_archive/` (ignored), with a full
  mirror of the pre-hygiene repository. The owner moves `_archive/` out of the repo folder.
- **RHD3. Rewrite last, once, before the first push.** Every commit id changes, so it follows the branch and
  worktree cleanup and precedes any remote. No force-push is ever needed.
- **RHD4. Worktrees live outside the repo** (`../kaleb-vale-worktrees/<branch>`).
- **RHD5. Shared ignore rules live in `.gitignore`**, not `.git/info/exclude` (per clone).
- **RHD6. One identity per author through `.mailmap`**; names are not rewritten in history.
- **RHD7. The rewrite runs in a Mac terminal, by the owner**: it cannot be undone and needs `git-filter-repo`.
- **RHD8. `marketing/` is not source** (owner): out of the tree and, in RH9, out of history.

## As built (RH0-RH8)

- **RH0.** The two modified HUD files committed (`251845c9`; typecheck and eslint clean, not run in Studio).
  Mirror: `_archive/kaleb-vale-roblox.pre-hygiene.git`, 131 refs, the same as the source. No `out:digest` was
  recorded: nothing under `src/` changes after that commit, and RH11 compares against the mirror's build.
- **RH1-RH3.** `Claude outputs/`, `_backup/` and `marketing/` untracked, ignored and moved to `_archive/`. The
  four Kenney mocks docs/KENNEY_DECOR.md cites moved to `docs/img/kenney/`; docs/BOOKSHELVES.md,
  docs/KENNEY_DECOR.md and docs/NEW_ENEMIES_3.md no longer point into the removed folders. Tracked files 2,083
  to 2,016.
- **RH4.** The four stashes saved as `_archive/stashes/stash-<n>.patch`, then dropped (owner).
- **RH5.** The six unmerged branches:

  | Branch | Finding | Outcome |
  |---|---|---|
  | `invite-eligibility-client` | its commit is patch-equivalent to one in `main` | deleted |
  | `builds-v2-pre-rebase` | 8 of 10 patch-equivalent, the other 2 in `main` under the same subject | deleted |
  | `cosmetics-pre-rebase` | 12 of 15 patch-equivalent, the other 3 in `main` under the same subject | deleted |
  | `goldling-rumours-pre-rebase` | 4 of 11 patch-equivalent, the other 7 in `main` under the same subject | deleted |
  | `archer-hearts` | `heartsMaxDelta` is in `main` (landed by another route, then superseded by docs/SILVER.md's hearts) | deleted |
  | `fix/pellet-over-decor` | **not in `main`**: `PELLETS_VIEW.artLiftStuds` is still 0.03, the decor flats' own height, the z-fight the commit (`3b0c56df`) fixes by 0.04 | **kept** for the owner to merge or drop |

- **RH6.** The 119 merged branches deleted with `git branch -d`. Left: `main`, `repo-hygiene`,
  `fix/pellet-over-decor`. Every deleted ref is in the mirror.
- **RH7.** All 24 worktree directories moved to `_archive/worktrees` and `_archive/worktrees-misc`; the one
  registered worktree pruned; `.kvtest/` moved to `_archive/kvtest`. Compared with the branch of the same name:
  13 match its tip exactly; `room-clear` differs in 29 files with 6 untracked (possible unfinished work);
  `item-tooltips`, `kenney-forge`, `kenney-forge-view`, `legendaries`, `legendaries-tune`, `new-enemies` and
  `projectile-art` differ in 87 to 1,092 files, which reads as a checkout of another commit, not checked
  further; `dummy-art-old`, `legendaries-merge` and `mobile-stale-d6eb9d4` have no branch to compare with.
- **RH8.** `.mailmap`: `git shortlog -sne --all` shows two authors.

## Tasks

- [x] **RH0. Safety net.**
- [x] **RH1. Triage and archive.**
- [x] **RH2. Untrack and ignore.**
- [x] **RH3. Docs follow.**
- [x] **RH4. Stashes.**
- [x] **RH5. Unmerged branches.**
- [x] **RH6. Merged branches.**
- [x] **RH7. Worktrees.**
- [x] **RH8. Identity.**
- [ ] **RH9. History rewrite** (owner, Mac terminal, RHD7). Merge `repo-hygiene` into `main` and move `_archive/`
  out of the repo folder first. Then on a fresh clone: `brew install git-filter-repo`;
  `git filter-repo --path "Claude outputs" --path _backup --path marketing --invert-paths`. Check:
  `git log --all --oneline -- "Claude outputs" _backup marketing` prints nothing; no blob over 5 MB remains;
  no `*.pdf`, `*.tar`, `*.tgz`, `*.bundle`, `*.wav` or `art/vendor/` path remains anywhere in history.
- [ ] **RH10. Commit ids in docs.** Every id changes in RH9: rewrite this repo's short ids in `docs/`,
  `CLAUDE.md` and `PLAN.md` from filter-repo's `commit-map` (this file's included). `PROVENANCE.md` cites the
  source project's commit and is not affected.
- [ ] **RH11. Verify.** In the rewritten clone: `npm ci`, `npm run verify`, `npm run out:digest` and `cmp`
  against the same digest taken in a build of the mirror's `repo-hygiene`. Record the `.git` size here.
- [ ] **RH12. Swap and close.** The rewritten clone becomes the working repo, the old folder joins the archive;
  the `docs/DECISIONS.md` entry. Set `git config user.name "Kaleb Kougl"` in the new clone.

## Done when

- A fresh clone has no `Claude outputs/`, `_backup/`, `marketing/`, resume or vendor asset anywhere in history.
- `git branch` shows `main` plus only branches with a recorded reason.
- `git status` is clean with no local exclude rules.
- `npm run verify` passes and the `out/` digest matches.
