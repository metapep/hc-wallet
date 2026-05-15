## Commits

All commits should have one of the following prefixes: REL, FIX, ADD, REF, TST, OPS, DOC. For example `"ADD: new feature"`.
Adding a new feature is ADD, fixing a bug is FIX, infrastructure changes are OPS, REL is for releases, REF is for refactoring, DOC is for documentation, TST is for tests.

Commits should be atomic: one commit per feature, one commit per bugfix.

## Releases

When you tag a new release, use the following example:
`git tag -m "REL vX.Y.Z: <commit hash>" vX.Y.Z -s`
You may get the commit hash from `git log`. Don't forget to push tags: `git push origin --tags`.

Alternative: `git tag -a vX.Y.Z <commit hash> -m "vX.Y.Z" -s`

When tagging a new release, increment the version in `package.json` and the corresponding native fields. There is a helper script: `./scripts/edit-version-number.sh`.
In the commit that bumps the version, use a commit message like `"REL vX.Y.Z: Summary message"`.

See [RELEASE.md](RELEASE.md) for the full release process.

## Guidelines

Do not add new dependencies. Bonus points if you remove a dependency.

All new files must be TypeScript. Bonus points if you convert existing JS files to TypeScript.

New components must go in `components/`. Bonus points if you refactor old components in `BlueComponents.tsx` to separate files.

Don't forget to add tests. Bonus points for E2E tests.

Avoid introducing new occurrences of `BlueWallet` / `Bitcoin` / `BTC` in identifiers, file paths, or user-visible strings. Inherited references are being phased out, not propagated.

## PRs

When submitting a PR, include a screenshot (from an emulator or device) showing the proposed change. A short video is even better. Describe **why** the change is being made and **how** it works under the hood.
