# Code Review

Date: 2026-11-16

Task: contract - M0: Typed IPC contract (envelope, errors, all method groups)

Scope: `git diff 721a273..692c9ac` (task commit "Add typed IPC contract: envelope, error codes, all method groups"): `packages/contract/**`, `eslint.config.mjs`, `docs/ARCHITECTURE.md`, `package-lock.json`. Committed changes only.

Requirements:
- `tasks/contract.md` acceptance criteria and recorded assumptions
- `SPEC.md` section 4 (API contract), section 3 M1 "Safety", M2/M3 feature list, sections 5 and 6
- `docs/ARCHITECTURE.md` (API contract section)
- `AGENTS.md`

Git range:
- Branch: main
- HEAD: 692c9ac0df74dae2a7a9fd1c9683414797e59f87
- Base/start: 721a27361eadde378e1225eb2d7fd03043ae1c7e
- Commits reviewed: 1

Summary: 0 P0, 0 P1, 2 P2, 3 P3

## Commands run

- `npx eslint packages/contract --max-warnings 0` -> no problems (no `any`; `no-explicit-any` pinned to `error` for the package)
- `npx prettier --check` on every committed changed file -> all formatted
- `npm run typecheck` -> passed (no errors)
- `npx vitest run src/index.spec.ts` (in `packages/contract`) -> 1 file, 298 tests passed
- `npm run check` in the working tree -> failed at `prettier --check` because of `packages/contract/src/probe.tmp.spec.ts`. That file is untracked, appeared while this review ran (probably another helper's scratch file), and is not part of the reviewed commit. Delete it before running `.taskcheck`.
- Behaviour checks with `node -e` against the installed zod 4.6.7: `strictObject(...).extend(...)` still rejects unknown keys. The `profile.connectionString` regex accepts `mongodb://alice:<password>@host`. `ejsonDocument` accepts `{not json` (this matches the recorded assumption that only the outer shape is checked).

## Acceptance criteria

1. Every method has a schema, valid samples parse, invalid samples fail with a readable message: met. The tests iterate over `METHOD_NAMES`, require one sample per method, and check that the message starts with `Invalid params for <method>:` and names the field path.
2. Documents are EJSON strings everywhere: met. The schema walker in `index.spec.ts` flags object, record and unknown fields, and a field from `DOC_FIELDS` that is not EJSON text. A self-test shows the walker catches a plain-object document field.
3. Writes carry `profileId` and an optional boolean `confirmed`: met. The `EXPECTED_WRITES` list is compared with `WRITE_METHODS`, and for each write the tests check that `profileId` is required and that `confirmed` is optional and boolean only.
4. `npm run check` passes and the package has no `any`: met for the committed code (see "Commands run" above for the stray untracked file).

## P0 Critical

None.

## P1 High

None.

## P2 Medium

- [ ] **CR-1 | `profile.connectionString` says "without password" but the schema accepts a password**
    - File: `packages/contract/src/profiles.ts:76`
    - Category: Security
    - Problem: The field's doc comment says "Connection string without password", but the schema is only `z.string().regex(/^mongodb(\+srv)?:\/\//)`. `mongodb://alice:<password>@host` passes (checked with `node -e`). The same `profile` schema is used for the `profiles.save` params, for the `profiles.list/get/save/duplicate` results and for the `importResult` of `profiles.importUris` / `profiles.importCompass`. So neither direction of the contract enforces the rule.
    - Why it matters: SPEC section 5 requires `connections.json` to hold "profiles without secrets", and section 6 says "Secrets never leave the backend/main processes". A user who pastes a URI with a password (demo step 2 in SPEC section 2), or a Compass import, could get the password stored in plain text in `connections.json` and sent back to the renderer by `profiles.list`. `parseResult` is meant to be the safety net for results, but here it would let the password through.
    - Suggested fix: Add a refinement on `connectionString` that rejects a password in the userinfo part (for example `/^mongodb(\+srv)?:\/\/[^/@]*:[^/@]*@/`) with a readable message ("move the password to the keychain"). Add a test for `profiles.save` params and for `profiles.list` / `profiles.importUris` results. The main-process handlers then strip the password into `setSecret` before saving.

- [ ] **CR-2 | Profile file paths (TLS CA, client certificate, SSH key) come from the renderer, and no main-process file picker exists**
    - File: `packages/contract/src/profiles.ts:54-55,65`
    - Category: Integration / Security
    - Problem: `tls.caFile`, `tls.certificateKeyFile` and `ssh.privateKeyFile` are free strings that the renderer sends in `profiles.save` and `conn.test` (the `conn.test` draft goes straight to the backend). The contract has no method for choosing these files with a native dialog in `main`. The `io` group was designed the other way on purpose (`io.ts:9-12`: "The renderer never sends file paths"; the matching assumption is recorded in the task). The renderer is sandboxed and its preload exposes only `request`, `cancel` and `on` (SPEC sections 4 and 6). A sandboxed renderer cannot read a real path from an `<input type=file>`, so the only way to fill these fields is typing a path by hand.
    - Why it matters: SPEC demo step 10 and M2 ("SSH tunnel ... private key", "X.509 client certificates (cert + key file, or PEM bundle)") need users to pick key and certificate files. The connectivity tasks will have to invent a method outside this contract task, or ship a type-the-path UX. They will also have to choose without guidance whether the backend may read any renderer-supplied path. The contract's own "renderer never sends file paths" rule is applied inconsistently.
    - Suggested fix: Add a main-routed method such as `profiles.chooseFile({ purpose: 'tlsCaFile' | 'tlsCertificateKeyFile' | 'sshPrivateKeyFile' })` that returns the chosen path, or `null` when the dialog is cancelled. Alternatively, record an `assume` entry that profile file paths are an explicit exception to the rule, so later tasks don't have to guess.

## P3 Low

- [ ] **CR-3 | The `Cancel` message has no routing information, but methods (including streaming ones) are split between `main` and `backend`**
    - File: `packages/contract/src/envelope.ts:55-63`, `packages/contract/src/io.ts:259-328`
    - Category: Integration
    - Problem: `cancel` carries only a request id or a `streamId`. `route()` can only route by method name, and `io.export` / `io.import` are routed to `main` but return a `streamId`. The contract does not say which process owns a stream, whether stream ids are unique across both processes, or where `thicket.cancel()` should be sent for a main-routed request or stream.
    - Why it matters: The preload/transport task has to guess. A wrong guess means cancelling an import or export silently does nothing (unknown targets are "ignored" by design).
    - Suggested fix: Document in `envelope.ts` (and in ARCHITECTURE "Contract layout") that the backend owns every stream, including the ones started by `main` for `io.*`, and that cancel is delivered to whichever process serves the target. Or add the owning route to the cancel message.

- [ ] **CR-4 | `docs.find` accepts contradictory paging parameters**
    - File: `packages/contract/src/docs.ts:53-66`
    - Category: Correctness
    - Problem: `after`, `before` and `skip` can all be sent together. Their combined meaning is not defined. `conn.test` already uses a `.refine` to enforce "exactly one of", so there is a precedent.
    - Why it matters: Paging (SPEC M1) chooses range paging or skip/limit. Ambiguous params push the decision into each backend handler, and buggy renderer input passes validation.
    - Suggested fix: Add a refine that allows at most one of `after` / `before`, and does not allow either of them together with `skip`. Add an invalid sample to the tests.

- [ ] **CR-5 | The rule for when `confirmed: true` is required is documented inconsistently**
    - File: `packages/contract/src/define.ts:7-10`, `packages/contract/src/common.ts:87-90`, `docs/ARCHITECTURE.md` (the "Writes carry `profileId` and optional `confirmed`" bullet)
    - Category: Quality
    - Problem: These places say `confirmed: true` is required only on production profiles. The recorded assumption and `errors.ts` (`CONFIRMATION_REQUIRED`: "or a bulk write") say the backend requires it for `updateMany` / `deleteMany` on every profile. SPEC M1 Safety says bulk operations "always ... need confirmation".
    - Why it matters: Whoever implements the backend write guard will read `define.ts` / ARCHITECTURE.md and may enforce only the production rule. Bulk writes on non-production profiles would then not fail closed.
    - Suggested fix: Mention the bulk rule in `define.ts`, in `writeFields` in `common.ts`, and in ARCHITECTURE.md. Optionally add a `confirm: 'production' | 'always'` attribute to `MethodDef` so the rule is in the data, not only in prose.

## Review conclusion

Material issues found; fix before completing the task. All acceptance criteria are met by the committed code. CR-1 is a security gap in the contract: SPEC sections 5 and 6 forbid secrets in `connections.json`, and the schema does not enforce that. CR-2 and the P3 findings are design and documentation gaps that later tasks would otherwise have to guess about. The parent worker decides which of them to fix in this task and which to record as assumptions.
