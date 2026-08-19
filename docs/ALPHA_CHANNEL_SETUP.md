# Alpha Release Channel Setup Guide

This document describes the current alpha-channel release flow and the temporary migration bridge from Cloudflare R2 to GitHub pre-releases.

## Overview

The alpha channel now uses **published GitHub pre-releases**:
- Tag push builds all desktop artifacts and publishes a visible GitHub pre-release.
- Users who opt into `releaseChannel=alpha` receive updates from GitHub Releases by reading `alpha*.yml`.
- Stable users still read `latest*.yml` from the latest non-prerelease release.

During the migration, the workflow can also upload the same assets to the legacy R2 bucket so older alpha installs that still point at R2 can pull one transition build and move onto GitHub.

## In-App Channel Behavior

Users opt into alpha in the app via the hidden release-channel control:
1. Open Global Settings.
2. Go to Advanced Settings.
3. Command-click (macOS) or Ctrl-click (Windows/Linux) the "Advanced Settings" title.
4. Select `Alpha (Internal Testing)`.
5. Save and restart.

At startup, the app should log:
- Alpha: `Configuring alpha channel updates from GitHub prereleases`
- Stable: `Configuring stable channel updates from GitHub releases`

## GitHub Release Flow

### Alpha pre-release

Push a tag such as `v0.58.22`.

Result:
- A GitHub release is created automatically for that tag
- The release is published immediately
- The release is marked as a **pre-release**
- Assets include both `latest*.yml` and `alpha*.yml`

Alpha users discover that release through GitHub’s public releases feed plus the `alpha*.yml` assets.

### Stable promotion

After validating the alpha build, re-run `.github/workflows/electron-build.yml` for the same tag with:
- `release=true`
- `create_github_release=true`

Result:
- The existing GitHub release for that tag is updated
- The pre-release flag is cleared
- Stable users now see it as the latest release

## Transition Bridge for Existing Alpha Installs (removed)

Alpha builds older than the GitHub cutover pointed at a Cloudflare R2 feed at `https://pub-4357a3345db7463580090984c0e4e2ba.r2.dev/`. The workflow published one transition build to that feed so those installs could update onto a version whose updater already pointed at GitHub.

That bridge has served its purpose and is gone. The `LEGACY_ALPHA_TRANSITION_R2_UPLOAD` switch and the R2 upload step were removed from `electron-build.yml`, and `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and `CLOUDFLARE_ACCOUNT_ID` were revoked at Cloudflare and deleted from repository secrets rather than migrated into a release environment.

An alpha install old enough that it never took the transition build has to be reinstalled from GitHub Releases by hand.

## Verification Checklist

### Verify alpha release assets

For a newly tagged release, check:
1. A GitHub release exists for the tag.
2. It is marked as a pre-release.
3. Assets include:
   - `alpha-mac.yml`
   - `alpha.yml`
   - `alpha-linux.yml`
   - `latest-mac.yml`
   - `latest.yml`
   - `latest-linux.yml`

### Verify alpha client behavior

1. Switch the app to `Alpha (Internal Testing)`.
2. Restart the app.
3. Confirm the log line says GitHub prereleases are configured.
4. Run Help → Check for Updates.
5. Confirm the app finds the tagged pre-release.

### Verify stable promotion

1. Re-run the workflow for the same tag with `create_github_release=true`.
2. Confirm the GitHub release is no longer marked as a pre-release.
3. On a stable-channel install, run Help → Check for Updates.
4. Confirm the app finds the promoted stable release.

## Troubleshooting

### Alpha install says no update is available

Check:
- The GitHub release is published, not just created locally in CI
- The release is marked as a pre-release
- `alpha*.yml` assets are attached to the release
- The app log says `Configuring alpha channel updates from GitHub prereleases`

### Stable install sees the alpha build

Check:
- The release is still marked as a pre-release and has not yet been promoted
- The stable install log says `Configuring stable channel updates from GitHub releases`

### Legacy alpha install never migrates

An install that never took the R2 transition build cannot migrate on its own now that the bridge is removed. Reinstall it from the latest prerelease on GitHub Releases.
