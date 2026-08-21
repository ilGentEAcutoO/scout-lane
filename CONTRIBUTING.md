# Contributing

Scout Lane is public so people can read and study it. The public license is
[PolyForm Noncommercial 1.0.0](LICENSE). Any business use requires a
[paid license](LICENSE-COMMERCIAL.md).

## Before you send a change

1. Do not commit secrets, `.dev.vars`, anything under `instruction/` (assignment PDFs, JD, cowork log, OAuth client JSON), or `client_secret*.json`. If they land in git history, purge with `git filter-repo` before pushing.
2. Match existing TypeScript / Hono / D1 patterns. No extra UI kit.
3. API bodies use the shared Zod schemas in `packages/core`.
4. `npm run check` and `npm run test` should pass for the packages you touch.

## License of your contribution

You certify that you have the right to submit the contribution.

You license your contribution under PolyForm Noncommercial 1.0.0, and you
grant the Scout Lane copyright holder (ilGentEAcutoO) a perpetual, worldwide,
irrevocable, royalty-free license to use, modify, and relicense that
contribution as part of a paid commercial grant of Scout Lane.

If you cannot offer that grant, do not open a pull request — email
suanwin.paows@gmail.com instead.
