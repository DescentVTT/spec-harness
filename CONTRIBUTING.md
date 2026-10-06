# Contributing

## Getting started

```bash
npm install
npm run lint      # tsc --noEmit, strict
npm run build     # emits dist/; a few integration tests run bin/spec-harness.js
npm test          # vitest: the unit suite and the integration suite
```

Node 22 or later. There are no runtime dependencies. The working agreements
and the module layout are in [`CLAUDE.md`](CLAUDE.md); the decisions and what
they cost are in [`docs/adr/`](docs/adr/README.md). Mutation testing runs in
GitHub Actions, not on a workstation: the core sweep is a CI job on every
change, and the full sweep runs weekly and on request (Actions, Mutation,
Run workflow), in eight parallel shards merged into one score.

`src/vendor/spec-core/` is spec-core's, copied by its `scripts/vendor.mjs` and
verified by hash. It is never edited here.

## Sibling minimums

The oldest release of each sibling this one runs is `MINIMUM_VERSIONS` in
`src/versions.ts`, and the same minimums are `peerDependencies` in
`package.json`. A test fails when the two disagree, so a change to one is a
change to both. Raising a minimum asks every repository with the older
sibling to upgrade it; say so in the changelog, and why
([ADR-0011](docs/adr/0011-releases-are-staged-by-ci.md)).

`devDependencies` and the lockfile hold spec-brief and spec-guard at their
newest releases, so `npm test` runs what a user installs today. CI's
`test (minimum siblings)` job runs the suite again at the minimums. To do the
same here:

```bash
npm install --no-save $(node scripts/minimum-siblings.ts)
node scripts/minimum-siblings.ts --installed   # exits 1 unless those are installed
npm test
npm ci                                         # the newest again
```

When the suite fails at the minimums and passes at the newest, the harness
relies on something the minimum lacks: change the harness, or raise the
minimum.

## Releasing

Versions are staged by CI from a tag and released by a maintainer with a
second factor, never published from a workstation
([ADR-0011](docs/adr/0011-releases-are-staged-by-ci.md)).

1. On a branch, set the version and give it notes:
   `npm version <x.y.z> --no-git-tag-version`, set the same version in
   `.claude-plugin/plugin.json` and on the plugin in
   `.claude-plugin/marketplace.json`, then move the changelog's
   `## Unreleased` entries under `## <x.y.z>`. The test suite fails until the
   changelog has a section for the version and both manifests carry it.
2. Merge to main.
3. Tag the merge commit and push the tag:

   ```bash
   git tag -a v<x.y.z> -m "spec-harness <x.y.z>"
   git push origin v<x.y.z>
   ```

The release workflow runs CI again, packs, stages the version on npm with
provenance and makes the GitHub release. Then a maintainer releases it with a
second factor: `npm stage list @descent-vtt/spec-harness`,
`npm stage view <id>`, `npm stage approve <id>`. A prerelease (`0.2.0-rc.1`)
is staged under the `next` dist-tag. To try the workflow without publishing,
run it by hand from main (Actions, Release, Run workflow): it does everything
but the upload and the GitHub release.

### Once, before the first release

npm attaches a trusted publisher only to a package that exists, so the name is
claimed by hand with a placeholder that has no code in it, and every version
with code comes from the workflow.

1. **Publish the placeholder.** In an empty directory outside the repository,
   so that nothing of the work tree can be packed, write this `package.json`
   and publish it with your second factor:

   ```json
   {
     "name": "@descent-vtt/spec-harness",
     "version": "0.0.0",
     "description": "A placeholder that claims the name for spec-harness. It contains no code; install 0.1.0 or later.",
     "license": "MIT",
     "repository": {
       "type": "git",
       "url": "git+https://github.com/DescentVTT/spec-harness.git"
     }
   }
   ```

   ```bash
   npm pack --dry-run                    # one file: package.json
   npm publish --access public
   npm view @descent-vtt/spec-harness    # 0.0.0, the latest
   ```

2. **Attach the trusted publisher.** On npmjs.com, in the package's settings,
   add a trusted publisher: GitHub Actions, repository
   `DescentVTT/spec-harness`, workflow `release.yml`, environment `npm`.
3. **Close every other way in.** In the same settings, set publishing access
   to require two-factor authentication and disallow tokens. The workflow and
   a person with a second factor are then the only ways to publish.
4. **Release 0.1.0** as above: tag the commit on main that carries it, wait
   for the run to stage it, and approve it. The `npm` environment is created
   in the repository by that first run; a required reviewer, if a release
   should wait for one, goes on it.
5. **Deprecate the placeholder** once a version with code is installable:

   ```bash
   npm deprecate @descent-vtt/spec-harness@0.0.0 "A placeholder without code; install 0.1.0 or later."
   ```

## Commits

A subject that says what changed, in the imperative, and a body that says
why. Changes reach main through pull requests.
