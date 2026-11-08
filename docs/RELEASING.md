# Releasing tplvane

A release is built in GitHub Actions from a tag `vX.Y.Z` with npm trusted publishing (OIDC), without an npm token in the repository secrets, and gets provenance. The workflow does not publish directly: it stages the version (`npm stage publish`), and the version becomes public only when a maintainer approves it with two-factor authentication.

One tag releases both packages, `tplvane` and `@tplvane/mcp`, in the same version; `@tplvane/mcp` depends on that version of `tplvane`.

## How the workflow works

`.github/workflows/release.yml` runs when a tag `vX.Y.Z` is pushed. Its actions are pinned to full commit SHAs, and only its second job may ask for an OIDC token.

1. **`build`** (only `contents: read`, at most 30 minutes) on Node.js 24 with npm 11.21.1 (the version in `packageManager`):
   - checks that the tag matches the versions of both packages, that `@tplvane/mcp` depends on `^X.Y.Z` of `tplvane`, and that the tagged commit is on `main`;
   - checks that CI passed on the tagged commit, waiting up to 20 minutes while it runs (with `actions: read`), and stops the release when it failed;
   - runs `npm ci --ignore-scripts`, `npm test`, `npm run typecheck` and `npm run check:pkg`;
   - checks that the package depends only on `xlvane` and `fflate`;
   - packs `tplvane-X.Y.Z.tgz` and `tplvane-mcp-X.Y.Z.tgz` and uploads them as artifacts. Their names and SHA-512 `integrity` are outputs of the job.
2. **`stage`** (only `id-token: write`, at most 10 minutes, no checkout):
   - installs npm from `npm-X.Y.Z.tgz` of the registry after comparing its SHA-512 with the one written in the workflow (`NPM_INTEGRITY`, for the version of `packageManager`);
   - downloads the files and compares their SHA-512 with the outputs of `build`;
   - runs `npm stage publish --provenance` for `tplvane`, then for `@tplvane/mcp`.

   It runs no code of the repository or of its dependencies, and npm runs no lifecycle script for a packed file.

## One-time setup (by the owner)

Do the steps below for each package: `tplvane`, and `@tplvane/mcp` (which needs the npm organisation `tplvane` for its scope; create it first on npmjs.com, with 2FA required for its members). For `@tplvane/mcp`, run the commands of step 2 in `packages/mcp` (and restore `packages/mcp/package.json` at its end) and use `@tplvane/mcp` as the package name in steps 3 and 4.

Trusted publishing can be configured only for a package that exists, and a new trusted publisher configuration expires when no publication goes through it within two days. Do steps 2 to 4 one after another, and release the first version within two days of step 3; the environment of step 5 must exist before that release.

1. **An npm account with 2FA, and npm 11.16.0 or later locally**, as `devEngines` in `package.json` requires (`npm install -g npm@11.21.1`, the version of `packageManager`).
2. **Create the package with a private staged version.** The whole built package is uploaded, but as a staged version it stays private until approved, and it is never approved. In a clean clone:

   ```bash
   npm login
   npm ci
   npm run build
   cd packages/tplvane
   npm version 0.0.1-bootstrap.0 --no-git-tag-version --no-workspaces-update
   npm stage publish --tag bootstrap --provenance=false
   cd ../..
   git checkout -- packages/tplvane/package.json package-lock.json
   ```

   `--no-workspaces-update` keeps npm from resolving `@tplvane/mcp`'s dependency on the new version of tplvane in the registry, where it does not exist yet. `--provenance=false` is needed because provenance (set in `publishConfig`) can only be generated in CI. Staging a new package creates it with a public placeholder version, and the staged version stays private while it waits for approval. **Do not reject this staged version before the first release**: rejecting the only stage also withdraws the placeholder, the package disappears and npm blocks its name for 24 hours. Reject it after the first release.
3. **A trusted publisher that may only stage:**

   ```bash
   npm trust github tplvane --file release.yml --repo DevXord/tplvane --env release --allow-stage-publish
   ```

   Or on npmjs.com: the package → **Settings** → **Trusted Publisher** → GitHub Actions; user `DevXord`, repository `tplvane`, workflow file `release.yml`, environment `release`, only `npm stage publish` allowed. npm does not check the configuration when it is saved, so a typo shows only at the first release.
4. **Disallow tokens:** the package → **Settings** → **Publishing access** → "Require two-factor authentication and disallow tokens". Trusted publishing keeps working, because it uses no token.
5. **The `release` environment on GitHub:** the repository → **Settings** → **Environments** → **New environment** `release`. Under **Deployment branches and tags** allow only tags `v*`, and under **Required reviewers** add yourself. The stage job runs in this environment, and the trusted publisher accepts tokens only from it: a branch whose workflow tries to stage cannot, and every release waits for your approval on GitHub before it is staged.
6. **Recommended:** a GitHub rule that lets only the owner create tags `v*`, so that nobody else can start the release workflow.

## Every release

1. **Version.** On a branch, raise the versions of both packages (`npm version X.Y.Z --no-git-tag-version --no-workspaces-update -w packages/tplvane -w packages/mcp`), set `VERSION` in `packages/tplvane/src/version.ts` and `packages/mcp/src/version.ts` to `X.Y.Z`, set the dependency of `@tplvane/mcp` on `tplvane` to `^X.Y.Z`, run `npm install` to update `package-lock.json`, update the CLI screen snapshots (`npx vitest run tests/cli -u`), turn the "Unreleased" sections of `packages/tplvane/CHANGELOG.md` and `packages/mcp/CHANGELOG.md` into `X.Y.Z` with the date, and merge the pull request into `main`. Tag only after it is merged: the workflow builds the tagged commit.
2. **Tag a commit of `main` whose CI passed.** If a job failed for a reason outside the code (a download that timed out), re-run it before tagging; the release waits for a green run.

   ```bash
   git switch main
   git pull --ff-only
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```

3. **Wait for the workflow** (Actions → Release), and approve the `release` environment when GitHub asks. Both jobs must pass.
4. **Approve the staged versions with 2FA**, `tplvane` first, on npmjs.com (the package → staged versions) or with `npm stage approve`.
5. **Check the release:**

   ```bash
   npm view tplvane@X.Y.Z dependencies
   npm view tplvane@X.Y.Z dist.integrity
   ```

   `dependencies` must list only `fflate` and `xlvane`, and the npm page of the version shows its provenance (the repository, the workflow and the commit). In a project that installs it, `npm audit signatures` checks the signature and the provenance.
6. **After the first release**, reject the bootstrap stage of step 2 of the setup.

## Changing the version of npm

`packageManager` in `package.json` names the npm the project uses. When it changes, change the version in the workflows too, and `NPM_INTEGRITY` in the stage job of `release.yml` to the `dist.integrity` of that version (`npm view npm@X.Y.Z dist.integrity`); a test checks that the stage job installs the version of `packageManager`.

## If something goes wrong

- **Only tplvane was staged** (the stage job failed on `@tplvane/mcp`): re-running the job fails on tplvane, which is already staged. Do not approve the tplvane stage alone. Fix the cause on `main`, raise both packages to the next patch version and tag it; leave the incomplete stage unapproved.

- **The tag does not match the version:** delete the tag (`git push origin :refs/tags/vX.Y.Z`, `git tag -d vX.Y.Z`), fix the version on `main`, tag again.
- **A check fails in `build`:** nothing was staged. Fix the problem on `main` and tag a new patch version.
- **The staged version is wrong:** reject it instead of approving it; nothing becomes public.
