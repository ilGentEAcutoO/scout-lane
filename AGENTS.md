# Agent notes

## Never publish

Keep these **off git and off GitHub** — including history. If they appear in a commit, strip them with `git filter-repo` and force-push **before** the repo is public.

- `instruction/` — employer assignment PDFs, JD, cowork log, OAuth client JSON
- `videos/`, `demo/` — local walkthrough renders and HyperFrames work
- `.dev.vars`, `.env`, `*.pem`, `client_secret*.json`
- local screenshots such as `ai-settings-mobile.png`

They stay on disk for local work. `.gitignore` already excludes them. Do not `git add -f`.
