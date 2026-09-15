# dcmjs Release Branch Plan

This document defines the branch naming schema and release process for moving dcmjs
from the 0.5x line to the 1.0 rewrite. It is the handoff reference for setting up
branches on `dcmjs-org/dcmjs` and for the eventual npm publication changes. Nothing
in this document has been implemented yet — it is the agreed plan.

## Current state (verified 2026-08-07)

- `dcmjs-org/dcmjs` `master` HEAD is `81e7e11`, tagged `v0.52.0`, published to npm as
  `latest` (0.52.0). Note the version in `package.json` on master reads 0.49.2 —
  semantic-release publishes without committing version bumps, so this is expected.
- The 1.0 rewrite lives on the `development` branch of the `awatson1978/dcmjs` fork:
  92 commits ahead of master, 0 behind, version `1.0.0-beta.0`. Commits follow the
  conventional-commit format and include breaking-change markers (`feat!`, `fix!`),
  so semantic-release will compute `1.0.0` from the last tag automatically.
- Publishing is automated by `.github/workflows/publish-package.yml` via
  semantic-release, currently triggered only by pushes to `master`, with no
  `.releaserc` file (all defaults). The workflow uses the `publish` GitHub
  environment.
- Stale npm dist-tags exist: `vNext` → 0.6.0-cst4-beta2 and `dev` → 0.9.0-build-95.

## Branch naming schema

| Branch | Cut from | Role | Publishes |
| --- | --- | --- | --- |
| `development` | `master` HEAD (`81e7e11` / v0.52.0) | Integration branch and **repo default**; all PRs target this | nothing |
| `release/1.0` | `development`, after the 1.0 PR merges | 1.0 prerelease stream | `1.0.0-beta.N` to npm dist-tag `beta`; GitHub Releases flagged Pre-release |
| `release/0.5x` | `master` HEAD | Historical / maintenance line for 0.5x | `0.52.x` patches to npm dist-tag `release-0.x`, only if backports are needed |
| `master` | exists | Stable pointer; at 1.0 GA, `release/1.0` merges here | npm `latest` |

Ongoing flow: feature PRs go from the fork to `development`. Each new beta is a merge
of `development` into `release/1.0`. At GA, `release/1.0` merges into `master`.
Critical 0.5x backports go to `release/0.5x`.

## Note for the dcmjs-org/dcmjs owner

> Branches to create on `dcmjs-org/dcmjs`:
>
> 1. **`development`** — from current `master` HEAD (`81e7e11` / v0.52.0). Please set
>    it as the repo **default branch**. The 1.0 rewrite will arrive as a PR from the
>    `awatson1978` fork — please merge it with a **merge commit, not squash**
>    (semantic-release needs the individual conventional commits to compute the
>    version and generate release notes).
> 2. **`release/1.0`** — from `development` HEAD *after* that PR merges. Once the
>    release config lands, pushes here auto-publish `1.0.0-beta.N` to npm under the
>    `beta` dist-tag and create GitHub prereleases.
> 3. **`release/0.5x`** — from `master` HEAD, *after* a small `ci:` config PR lands
>    on master. This is the historical 0.5x line for critical backports.
>
> Additional setup:
>
> - Branch protection on `master`, `development`, `release/1.0`, and `release/0.5x`:
>   require PRs and the Tests status check, no force-push. semantic-release only
>   pushes tags and releases, never branch commits, so protection won't conflict.
> - The publish workflow uses the `publish` GitHub environment — if that environment
>   restricts deployment branches, add `release/1.0` and `release/0.5x` to the
>   allowed list.
> - On the Releases page, pin **v0.52.0** now, and **v1.0.0-beta.1** once it
>   publishes (GitHub allows up to 3 pinned releases).
> - npm cleanup (requires npm owner rights on `dcmjs`):
>   `npm dist-tag rm dcmjs vNext` and `npm dist-tag rm dcmjs dev` — both point at
>   ancient builds and mislead users browsing the registry.

## A note on "beta" terminology

"Beta" is convention, not mechanism, in this plan:

- **npm** dist-tags are arbitrary labels — `beta` in `npm install dcmjs@beta` is
  customary, not special. The only dist-tag with built-in meaning is `latest`, which
  a bare `npm install dcmjs` resolves to. Prerelease versions like `1.0.0-beta.1`
  are ordinary semver; any prerelease identifier sorts below the final `1.0.0`.
- **GitHub** marks a release as "Pre-release" via a checkbox on the Release object;
  the name of the tag or branch is irrelevant.
- **semantic-release** is the one tool with a naming default: a branch literally
  named `beta` publishes prereleases with zero configuration. Our descriptive names
  (`release/1.0`, `release/0.5x`) work equally well with a few lines of explicit
  configuration (see appendix).

## Sequencing

1. **Fork** (`awatson1978/dcmjs`, `development` branch): add `.releaserc.json` and
   the workflow trigger changes (appendix below) as a single `ci:` commit. The `ci:`
   type triggers no release.
2. **dcmjs-org**: create `development` from `master` HEAD; set it as the default
   branch.
3. **Fork PRs to dcmjs-org**:
   - The big PR: `awatson1978:development` → `dcmjs-org:development` (the ~93
     commits). Merge commit, not squash.
   - A small PR to `dcmjs-org:master` cherry-picking the `ci:` config commit. This
     must merge **before** `release/0.5x` is cut so the branch inherits the config.
     The triggered publish run on master will conclude "no release" — safe.
4. **dcmjs-org**: cut `release/0.5x` from master (publish run reports "no release" —
   expected); cut `release/1.0` from `development` (publish run computes and
   publishes **1.0.0-beta.1**, tags it, and creates a GitHub prerelease with notes
   covering the rewrite); pin releases; clean up the stale npm dist-tags.
5. **Ongoing betas**: merge `development` into `release/1.0`; each releasable push
   publishes the next `beta.N`.
6. **1.0 GA**: PR `release/1.0` → `master` (merge commit). semantic-release sees the
   beta tags and publishes `1.0.0` to `latest`. Then, on the 0.5x side:
   - Land a `fix:` commit on `release/0.5x` adding a one-time maintenance-mode
     `console.warn` to the main entry point (following the existing one-time-warning
     pattern in `src/DicomMessage.js`). This publishes `0.52.1`, which users on
     `^0.52.0` ranges pick up automatically.
   - Run the registry-level deprecation:
     `npm deprecate dcmjs@"<1.0.0" "dcmjs 0.x is in maintenance mode; upgrade to 1.x (npm install dcmjs@latest). Critical fixes only on release/0.5x."`
     (reversible with `npm deprecate dcmjs@"<1.0.0" ""`).
   - Add a maintenance-mode banner to the README on `master`'s history /
     `release/0.5x`.
   - Swap the pinned beta release for `v1.0.0`.

Deprecation timing rationale: registry warnings and runtime warnings wait until 1.0
GA so that 0.x users are never warned before a stable upgrade path exists. Until
then, the README on the 0.5x side simply notes that the 1.0 beta is available as
`dcmjs@beta`.

No manual version tags are needed at any point — semantic-release creates
`v1.0.0-beta.N`, `v0.52.x`, and `v1.0.0` itself. `v0.52.0` already exists.

## Appendix: release configuration (to be implemented later, not yet applied)

New file `.releaserc.json` at the repo root:

```json
{
    "branches": [
        { "name": "release/0.5x", "range": "0.x" },
        "master",
        { "name": "release/1.0", "prerelease": "beta", "channel": "beta" }
    ]
}
```

- `release/0.5x` needs an explicit `range` because the name doesn't match
  semantic-release's maintenance-branch pattern. Its dist-tag comes out as
  `release-0.x` (npm rejects dist-tags that parse as semver ranges, so the npm
  plugin prefixes them).
- `release/1.0` needs `prerelease: "beta"` because the branch name itself is not a
  valid prerelease identifier.
- No additional plugins are required — the four semantic-release defaults
  (commit-analyzer, release-notes-generator, npm, github) are bundled.

`.github/workflows/publish-package.yml` trigger change:

```yaml
on:
    push:
        branches:
            - master
            - release/1.0
            - release/0.5x
```

Out of scope for now: the workspace packages `@dcmjs/parser` and `@dcmjs/fhir` are
`private: true`, so root-only publishing suffices. If they become publishable, the
pipeline needs multi-package support (e.g. multi-semantic-release) — deferred.
