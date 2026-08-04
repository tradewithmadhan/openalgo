# AGENTS.md

## CRITICAL RULES — OBEY WITHOUT EXCEPTION

1. **NEVER push to git without explicit user confirmation.** Before running `git push`, ALWAYS ask the user "Push now?" or similar. No exceptions. No assumptions. Even if the build passes, even if the user said the fix works — you MUST ask before pushing.
2. **NEVER commit without first running `npx tsc -b` AND `npx vite build`.** A passing tsc alone is not enough.
3. **NEVER remove or modify dependencies in `package.json` without user confirmation.**

These rules override everything else. If you are unsure whether something counts as "explicit user confirmation to push", it does NOT count. Ask.

## Build Notes

- `frontend/dist/` is built by CI/CD pipeline. Do not commit, modify, or comment on files in this folder.
- Use `cd frontend && npm install && npm run build` to build locally if needed.
- Use `cd frontend && npm ci` to verify lockfile consistency with CI.

## Build Verification Before Push

- **Always run `npx tsc -b` (TypeScript check) AND `npx vite build` locally before committing.** A passing `tsc` alone is not enough — the full `vite build` must also succeed. Docker builds use `npm run build` which runs both.
- **Never commit or push without first verifying the build passes locally.** If the user confirms a fix works at runtime, still run the full build before committing.

## Commit & Push Discipline

- **Never push to git without explicit user confirmation.** Always ask the user to confirm before running `git push`.
- Commits may be created after user confirms changes are working, but `git push` requires separate explicit approval.
- If the user says "push" or "ok push", that counts as confirmation.

## Dependency Management

- **Never remove or modify dependencies in `package.json` without user confirmation.** The madhan pages import many third-party libraries (`react-router-dom`, `lightweight-charts-drawing`, `lightweight-charts-indicators`, `chart.js`, `react-chartjs-2`, `oakscriptjs`, `date-fns`, `chartjs-adapter-date-fns`, `@types/chart.js`) that may not be explicitly listed in `package.json` but are required for builds.
- If the Docker build fails with "Cannot find module" errors, check git history for the original dependency list before adding/removing packages.
- Always run `npm ci` (not `npm install`) to verify CI-compatible dependency resolution.
- If adding a new dependency, ensure its version is compatible with existing peer dependency constraints.
