# Code Review

Date: 2026-11-17

Task: update-notice - Release (Should): Update available notice

Scope: task commits 94b93322 (main-side checker, handler, release link opening) and a692c990 (renderer service, notice, shell wiring, docs); `git diff 71edb348..HEAD` limited to the task's code. Other commits in that range only touch `tasks/` (heartbeats, assumptions). The task commits are the rebased versions of 9077f6f7 and 122e57dd; `git diff 122e57dd a692c990 -- apps packages docs` is empty, so the code is the same.

Requirements:
- tasks/update-notice.md acceptance criteria and recorded assumptions
- SPEC.md section 3 Release ("Update available" notice, no silent auto-update), section 4 (`app.*` checkForUpdate), section 5 (only GitHub releases API, can be switched off), section 6 (window.open blocked)
- docs/ARCHITECTURE.md (desktop main / security guards, update notice entry)
- docs/QUALITY.md, AGENTS.md

Git range:
- Branch: main
- HEAD: a692c9903b7e7fb83705e9a9ef1019278d1e8543
- Base/start: 71edb3483a5901c8059bb754ca7696bbdd2d4391
- Commits reviewed: 2 (code); 6 other commits in range touch only tasks/

Summary: 0 P0, 0 P1, 0 P2, 2 P3

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

- [ ] **CR-1 | `denyWindowOpen` is no longer used in production, but its doc, test and ARCHITECTURE still present it as the window-open guard**
    - File: `apps/desktop/src/main/security.ts:72`
    - Category: Quality
    - Problem: `apps/desktop/src/main/index.ts:75` now installs an inline lambda calling `openReleaseLink` (`apps/desktop/src/update/handlers.ts:17`) instead of `denyWindowOpen`. `denyWindowOpen` ("no new windows, ever") is now used only by `security.spec.ts:72` and `:131-136` ("denies window.open regardless of the requested URL"). `docs/ARCHITECTURE.md:101` still says the `window.open` guard is a pure function in `src/main/security.ts`.
    - Why it matters: a reader or a future security review sees a passing "always deny" test and thinks that is the guard in use. The real policy (open Thicket release pages externally, deny the window) lives in another module.
    - Suggested fix: remove `denyWindowOpen` and its tests, or move the release-link policy into `security.ts` so there is still one window-open guard. Then update the ARCHITECTURE line 101 wording.

- [ ] **CR-2 | The release-link allowlist also accepts asset download URLs, not only release pages**
    - File: `apps/desktop/src/update/checker.ts:83`
    - Category: Security
    - Problem: `isReleaseUrl` accepts any https URL under `https://github.com/OldPeasant/thicket/releases/`. That includes `.../releases/download/<tag>/<asset>`. The window-open handler serves every web contents, so any `window.open` of such a URL from the renderer makes the user's browser download a release binary. The notice only needs tag pages (`html_url` is always `.../releases/tag/<tag>`).
    - Why it matters: the risk is low, because these are official assets and the user still has to run the file. Still, the allowlist is wider than the feature needs, and SPEC section 6 treats `window.open` as blocked.
    - Suggested fix: limit the prefix to `https://github.com/OldPeasant/thicket/releases/tag/`, and add a `releases/download/...` case to the rejected URLs in `checker.spec.ts` ("release links").

## Notes (verified, no finding)

- Acceptance criterion 1: `apps/desktop/src/update/checker.spec.ts` tests recorded GitHub responses in `fixtures/` for these cases:
  - newer release;
  - same version;
  - running version newer than every release;
  - pre-releases ignored, whether flagged or marked only by the tag;
  - drafts ignored;
  - network error, HTTP 403 (rate limit), malformed body, body read failure and timeout all handled silently.
- Acceptance criterion 2: "Setting off: no request" is tested in three places:
  - in `UpdateChecker`;
  - through the `app.checkForUpdate` handler (`fetch` not called);
  - in the renderer (`update-notice.spec.ts`: no request at start or after 3 days).
- I could not run the test suites in this session (command execution was denied), so I have not confirmed that these tests pass. The parent must record its own run with `tasks.py verify`. Neither criterion is verified yet.
- Version comparison follows semver precedence: numeric core, a release ranks above its pre-releases, numeric identifiers rank below alphanumeric ones, and a longer identifier list ranks higher. Unparseable current versions never report an update. The parser rejects unsafe integers.
- Setting off: main reads `checkForUpdates` before every check, and the renderer reads it again before every scheduled check. An answer that arrives after the user switches the setting off is discarded (tested). Unpackaged builds are gated by `app.isPackaged` / `THICKET_UPDATE_CHECK=1` (recorded assumption).
- Timers: the 15 s abort timer is cleared in `finally`. The 24 h interval is created only on an off-to-on change, cleared when the setting goes off, and cleared through `DestroyRef`. The settings broadcast subscription is also unsubscribed through `DestroyRef`.
- External link safety: only https URLs with no userinfo under the Thicket releases prefix are opened, and only after WHATWG URL normalisation. The test list rejects `..`-style tricks, look-alike hosts, `http:`, `javascript:` and other repos. The window is always denied. Angular binds the link `href` and sanitises it, and the URL comes from the same allowlist.
- No secrets, no credentials and no extra data are sent: an unauthenticated GET with fixed headers. This matches SPEC section 5.

## Review conclusion

No material issues found.
