# Releasing

Versions follow [Semantic Versioning](https://semver.org): `MAJOR.MINOR.PATCH`. Before 1.0, a new feature bumps the minor version and a fix the patch version.

1. **Check `main` is ready**: CI is green and the docs describe what's there.
2. **Bump the version** in the project's version file(s): `npm version x.y.z --no-git-tag-version` updates `package.json` and `package-lock.json`.
3. **Commit** only that change, as `chore(release): x.y.z`.
4. **Tag and push**:

   ```bash
   git tag vx.y.z
   git push origin main vx.y.z
   ```

5. The [Release workflow](.github/workflows/release.yml) creates a **draft** release with the commits since the previous version, grouped by type. Preview the notes at any time with `bash scripts/release-notes.sh vx.y.z`.
6. On the [Releases page](https://github.com/azammarchi/blipdeck/releases), open the draft and replace its first line with a short opening paragraph: what the release is about, in plain words, and how to upgrade if anything needs doing. Then **Publish**: if the project has an online demo, publishing the release also publishes the demo, from the release's tag ([Pages workflow](.github/workflows/pages.yml)), so the demo always matches the latest version.
