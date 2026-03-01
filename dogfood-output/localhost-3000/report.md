# Dogfood Report: PredictCornell

| Field | Value |
|-------|-------|
| **Date** | March 1, 2026 |
| **App URL** | http://localhost:3100 |
| **Session** | localhost-3000 |
| **Scope** | Core route smoke pass + build/deploy readiness |

## Summary

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High | 1 |
| Medium | 1 |
| Low | 0 |
| **Total** | **2** |

## Issues

### ISSUE-001: Production build failed when Google Fonts could not be fetched

| Field | Value |
|-------|-------|
| **Severity** | high |
| **Category** | functional |
| **URL** | Build pipeline (`npm run build`) |
| **Repro Video** | N/A |

**Description**

The app imported fonts via `next/font/google`, which requires outbound access to `fonts.googleapis.com` during build. In restricted/offline environments this failed the entire production build and blocked deployment.

**Repro Steps**

1. Run `npm run build`.
2. Observe build error: `Failed to fetch Instrument Serif / Space Mono / Syne from Google Fonts`.

**Fix Applied**

Replaced `next/font/google` imports with local CSS-variable font stacks in `app/layout.js`, removing network dependency during build.

---

### ISSUE-002: Next.js root was inferred incorrectly in multi-lockfile workspace

| Field | Value |
|-------|-------|
| **Severity** | medium |
| **Category** | functional |
| **URL** | Dev/build startup logs |
| **Repro Video** | N/A |

**Description**

Next.js emitted repeated startup warnings that it inferred `/Users/ishaanch` as root because multiple lockfiles were present, which can cause incorrect tracing behavior and noisy/fragile builds.

**Repro Steps**

1. Run `npm run dev` or `npm run build`.
2. Observe warning about inferred workspace root and extra lockfiles.

**Fix Applied**

Set explicit roots in `next.config.mjs`:
- `outputFileTracingRoot`
- `turbopack.root`

Both now point to the repo root via `fileURLToPath(import.meta.url)`.

---

## Verification After Fixes

- `npm run lint` passes.
- `npm test -- --runInBand` passes (16 suites, 283 tests).
- `npm run build` passes successfully and emits the full route manifest.
- Route smoke checks on localhost return `200` for core pages (`/`, `/login`, `/feed`, `/markets`, `/leaderboard`, `/profile`, `/marketplace`, etc.).

## Notes

The preferred `agent-browser` tool in the dogfood skill was unavailable in this environment (`command not found`), so this pass used command-line smoke testing and build/runtime verification instead of screenshot/video capture.
