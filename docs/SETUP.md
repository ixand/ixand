# Setup

GitHub shows `README.md` of the repository `ixand/ixand` at the top of the profile page.

## One-time: a token for repository traffic

The traffic API (views and clones) answers only to the repository owner, and the workflow's built-in
token belongs to this repository alone. So the workflow needs a personal token:

1. GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate new token.
2. Repository access: **All repositories** (or select the public ones to show).
3. Repository permissions: **Administration: Read-only**. Nothing else.
4. Copy the token, then in this repository: Settings → Secrets and variables → Actions → New repository
   secret, name `TRAFFIC_TOKEN`.
5. Actions → **update profile** → Run workflow.

Without the secret the workflow still runs and leaves the traffic block as it is.

## How it works

- `scripts/update-profile.mjs` reads the profile, the public non-fork repositories, their traffic, and rewrites the marked
  blocks that `README.md` contains.
- GitHub keeps traffic for 14 days only, so each run merges the days it sees into `data/traffic.json`.
  The "since tracking" columns are sums over that file.
- The profile views badge is an image served by komarev.com, which counts how often it is loaded.
  GitHub itself publishes no view count for profile pages.

## Run locally

```bash
GH_TOKEN=$(gh auth token) node scripts/update-profile.mjs
```
