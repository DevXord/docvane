# Releasing docvane

A release is built in GitHub Actions from a tag `vX.Y.Z` with npm trusted publishing (OIDC), without an npm token in the repository secrets, and gets provenance. The workflow does not publish directly: it stages the version (`npm stage publish`), and the version becomes public only when a maintainer approves it with two-factor authentication.

This covers the `docvane` package. `@docvane/mcp` is released separately once its server is complete.

## How the workflow works

`.github/workflows/release.yml` runs when a tag `vX.Y.Z` is pushed. Its actions are pinned to full commit SHAs, and only its second job may ask for an OIDC token.

1. **`build`** (only `contents: read`, at most 30 minutes) on Node.js 24 with npm 11.19.1:
   - checks that the tag matches the version in `packages/docvane/package.json` and that the tagged commit is on `main`;
   - runs `npm ci --ignore-scripts`, `npm test`, `npm run typecheck` and `npm run check:pkg`;
   - checks that the package depends only on `xlvane` and `fflate`;
   - packs `docvane-X.Y.Z.tgz` and uploads it as an artifact. The name and the SHA-512 `integrity` of the file are outputs of the job.
2. **`stage`** (only `id-token: write`, at most 10 minutes, no checkout):
   - downloads the file and compares its SHA-512 with the output of `build`;
   - runs `npm stage publish ./docvane-X.Y.Z.tgz --provenance`.

   It runs no code of the repository or of its dependencies, and npm runs no lifecycle script for a packed file.

## One-time setup (by the owner)

Trusted publishing can be configured only for a package that exists, and a new trusted publisher configuration expires when no publication goes through it within two days. Do steps 2 to 4 one after another, and release the first version within two days of step 3.

1. **An npm account with 2FA, and npm 11.15.0 or later locally** (`npm --version`; Node.js 24 LTS comes with npm 11.19.1).
2. **Create the package without publishing code.** In a clean clone:

   ```bash
   npm login
   npm ci
   npm run build
   cd packages/docvane
   npm version 0.0.1-bootstrap.0 --no-git-tag-version
   npm stage publish --tag bootstrap
   cd ../..
   git checkout -- packages/docvane/package.json package-lock.json
   ```

   Staging a new package creates it with a public placeholder version, and the staged version stays private while it waits for approval. **Do not reject this staged version before the first release**: rejecting the only stage also withdraws the placeholder, the package disappears and npm blocks its name for 24 hours. Reject it after the first release.
3. **A trusted publisher that may only stage:**

   ```bash
   npm trust github docvane --file release.yml --repo DevXord/docvane --allow-stage-publish
   ```

   Or on npmjs.com: the package → **Settings** → **Trusted Publisher** → GitHub Actions; user `DevXord`, repository `docvane`, workflow file `release.yml`, no environment, only `npm stage publish` allowed. npm does not check the configuration when it is saved, so a typo shows only at the first release.
4. **Disallow tokens:** the package → **Settings** → **Publishing access** → "Require two-factor authentication and disallow tokens". Trusted publishing keeps working, because it uses no token.
5. **Recommended:** a GitHub rule that lets only the owner create tags `v*`, so that nobody else can start the release workflow.

## Every release

1. **Version.** On a branch, raise the version in `packages/docvane/package.json` (`npm version X.Y.Z --no-git-tag-version -w packages/docvane`), raise the version of `docvane` that `@docvane/mcp` depends on, write the changes for users, and merge the pull request into `main`. Tag only after it is merged: the workflow builds the tagged commit.
2. **Tag a commit of `main`:**

   ```bash
   git switch main
   git pull --ff-only
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```

3. **Wait for the workflow** (Actions → Release). Both jobs must pass.
4. **Approve the staged version with 2FA**, on npmjs.com (the package → staged versions) or with `npm stage approve`.
5. **Check the release:**

   ```bash
   npm view docvane@X.Y.Z dependencies
   npm view docvane@X.Y.Z dist.integrity
   ```

   `dependencies` must list only `fflate` and `xlvane`, and the npm page of the version shows its provenance (the repository, the workflow and the commit). In a project that installs it, `npm audit signatures` checks the signature and the provenance.
6. **After the first release**, reject the bootstrap stage of step 2 of the setup.

## If something goes wrong

- **The tag does not match the version:** delete the tag (`git push origin :refs/tags/vX.Y.Z`, `git tag -d vX.Y.Z`), fix the version on `main`, tag again.
- **A check fails in `build`:** nothing was staged. Fix the problem on `main` and tag a new patch version.
- **The staged version is wrong:** reject it instead of approving it; nothing becomes public.
