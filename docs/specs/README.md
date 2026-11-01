---
type: infrastructure
---
# Specs — per-subsystem specifications

These documents describe how each subsystem behaves: its flow, boundaries,
error states, and testing strategy. They evolve with the code and reference
the ADRs that shaped them.

Specs use a `type:` frontmatter tag: `infrastructure` (cross-cutting,
on every branch) or `feature` (application behavior, under `docs/specs/<domain>/`).

**New feature specs start from [`_template-feature.md`](_template-feature.md)**
(every section required); **new infrastructure specs start from
[`_template-infrastructure.md`](_template-infrastructure.md)** (fixed opening
and closing — Purpose, then Verify + Key ADRs — with a free-form middle that
fits the content). A spec is born in the working session that builds
the behavior: drafted from its issue, reviewed and corrected, landed in the
same PR as the code. From then on it is evergreen — the PR that changes the
behavior updates the spec. Linkage is one-way: issues cite specs; specs never
store issue state. See [CONTRIBUTING](../../CONTRIBUTING.md) for the full arc.

| Doc | Type | What it covers | Key ADRs |
|---|---|---|---|
| [monorepo](monorepo.md) | infrastructure | Apps vs packages layout, dependency rules, `@project` scope placeholder | 0001, 0009 |
| [seams](seams.md) | infrastructure | The unifying seam pattern: local stand-in by default, real cloud via env var | 0005, 0008, 0012 |
| [storage](storage.md) | infrastructure | Local-vs-real Azure pattern across blob and queue | 0006, 0008, 0005 |
| [web](web.md) | infrastructure | Health endpoint, async-honesty UI standard, server entry ritual + error shape (404-not-403) | 0012, 0009 |
| [auth](auth.md) | infrastructure | Identity derivation from the Google Auth.js session | 0012 |
| [deploy](deploy.md) | infrastructure | Container build + Azure topology, config via env only, kill-switches | 0008 |
| [observability](observability.md) | infrastructure | Structured logs, request IDs, what gets measured | — |
| [environment](environment.md) | infrastructure | `.env` shape. Secret values stay out of git | 0008, 0005 |

Infrastructure specs stay at the top of `docs/specs/` because accepted ADRs cite those paths.

### Capture (`capture/`)

| Doc | Type | What it covers |
|---|---|---|
| [upload](capture/upload.md) | feature | Store a label image and its Capture row |
| [process](capture/process.md) | feature | Turn label text into matched ingredient lines |
| [read](capture/read.md) | feature | List and inspect the signed-in user's captures |
| [favorites](capture/favorites.md) | feature | Favorite a capture the same user owns |

### Phases (`phases/`)

| Doc | Type | What it covers |
|---|---|---|
| [development-phases](phases/development-phases.md) | feature | POC, cloud, and stretch sequencing |
| [cloud-phase](phases/cloud-phase.md) | feature | Cloud build and the add-ons that sit on it |
| [data-model](phases/data-model.md) | feature | Phased field lists. No migration SQL |

### Identity (`identity/`)

The Google session contract for this track. Slice files and the working plan sit beside it.

| Doc | What it covers |
|---|---|
| [google-authjs-sessions](identity/google-authjs-sessions.md) | Route traces, data model, and screens for Google database sessions |
| [features/google-authjs-sessions](features/google-authjs-sessions.md) | Slices and acceptance text |
| [plans/google-authjs-sessions](plans/google-authjs-sessions.md) | Working plan for the identity track |

Feature specs live under `docs/specs/<domain>/`, grouped by the domain they describe.
