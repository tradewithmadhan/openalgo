# AGENTS.md

## CRITICAL RULES — OBEY WITHOUT EXCEPTION

1. **NEVER push to git without explicit user confirmation.** Before running `git push`, ALWAYS ask the user "Push now?" or similar. No exceptions. No assumptions. Even if the build passes, even if the user said the fix works — you MUST ask before pushing.
2. **NEVER commit without first running `npx tsc -b` AND `npx vite build`.** A passing tsc alone is not enough. **Both commands must pass with ZERO errors.** Docker builds use `npm run build` which runs `tsc -b && vite build` — any tsc error (including unused variables, implicit `any`, etc.) will fail the Docker build.
3. **NEVER remove or modify dependencies in `package.json` without user confirmation.**

These rules override everything else. If you are unsure whether something counts as "explicit user confirmation to push", it does NOT count. Ask.

## Build Notes

- `frontend/dist/` is built by CI/CD pipeline. Do not commit, modify, or comment on files in this folder.
- Use `cd frontend && npm install && npm run build` to build locally if needed.
- Use `cd frontend && npm ci` to verify lockfile consistency with CI.

## Build Verification Before Push

- **Always run `npx tsc -b` (TypeScript check) AND `npx vite build` locally before committing.** A passing `tsc` alone is not enough — the full `vite build` must also succeed. Docker builds use `npm run build` which runs both.
- **`npx tsc -b` must exit with ZERO errors.** If it shows any errors (unused variables, implicit any, missing types, etc.), fix them before committing. Docker will fail on any tsc error.
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

## Upstream Sync Workflow

When merging upstream changes, follow this exact sequence:
1. `git fetch upstream` — fetch latest upstream commits
2. `git merge upstream/main` — merge into local main
3. Resolve conflicts if any (check with `git status`)
4. Run local build verification:
   - `npx tsc -b` — TypeScript check (must pass with ZERO errors)
   - `npx vite build` — Vite production build (must pass)
   - If both pass, the code is ready
5. Commit the merge
6. Ask user "Push now?" before pushing
7. `git push origin main`

## Docker Build Verification

Before any push, verify the Docker-equivalent build passes:
- `npx tsc -b` — TypeScript check. Must exit with ZERO errors.
- `npx vite build` — Vite production build. Must succeed.
- These two commands together replicate what Docker's `npm run build` does (`tsc -b && vite build`).
- If either fails, fix the errors before committing or pushing.
