# AGENTS.md

## Build Notes

- `frontend/dist/` is built by CI/CD pipeline. Do not commit, modify, or comment on files in this folder.
- Use `cd frontend && npm install && npm run build` to build locally if needed.
- Use `cd frontend && npm ci` to verify lockfile consistency with CI.

## Dependency Management

- **Never remove or modify dependencies in `package.json` without user confirmation.** The madhan pages import many third-party libraries (`react-router-dom`, `lightweight-charts-drawing`, `lightweight-charts-indicators`, `chart.js`, `react-chartjs-2`, `oakscriptjs`, `date-fns`, `chartjs-adapter-date-fns`, `@types/chart.js`) that may not be explicitly listed in `package.json` but are required for builds.
- If the Docker build fails with "Cannot find module" errors, check git history for the original dependency list before adding/removing packages.
- Always run `npm ci` (not `npm install`) to verify CI-compatible dependency resolution.
- If adding a new dependency, ensure its version is compatible with existing peer dependency constraints.
