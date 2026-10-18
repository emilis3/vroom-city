# AGENTS.md

The process document for coding agents working in this repo (`emilis3/vroom-city`, Vroom City). It is the only process doc; the README stays slim. `CLAUDE.md` points here.

> Dev process only. What the app does, its stack and design live in the GitHub issues (MVP: #1), never here.

## 1. TL;DR
- GitHub Issues are the source of truth. The issue body is the spec.
- Prep settles the open questions and the "Ideas to make it better" with Emilis, then the issue body is rewritten as one clean spec and the implementation plan is posted in the project thread. One explicit "approved" covers both; build straight away after it.
- Work lands on the tip of `staging`. Never push to `main`. Never force-push. Only Emilis merges `staging` into `main`.
- Commit and push every completed change, with `Refs #N` / `Closes #N`.
- Post no comments on the issue (no plan, no "On staging"). After landing, add `in staging` to the issue and open or refresh the single `staging` -> `main` PR with `Closes #N`, then report once in the project thread.
- Don't invent requirements; ask in the thread. Never commit secrets, `.env*`, or `.vercel/`.

Roles: **Claude** (in the issue's project thread) files and preps issues, builds them on `staging`, manages labels and opens or refreshes the single production PR. Other coding agents follow the same rules. **Emilis** decides, approves spec and plan, checks staging by hand, and is the only one who merges to `main`.

## 2. Source of truth
- The issue **body is the spec**. Comments are background; where a comment conflicts with or goes beyond the body, **the body wins**.
- Flag body-vs-label mismatches in your plan. If the issue and code disagree, implement the issue or ask.
- Reference images live in `docs/reference/` and are linked from the issue; the body wins over them.

## 3. Before you write code
1. Prep (in the thread): re-read the live issue (body, labels, comments) and the code. Ask the open questions, plus 1–3 short, concrete "Ideas to make it better" with their trade-offs. Only the ideas Emilis approves go into the spec.
2. Rewrite the issue body as one clean spec, then post the plan in the thread: files and approach, tests, anything unclear, with the approved ideas already in it and the issue link. Ask for approval once.
3. Wait for an explicit "approved"; answers and thumbs-up are not approval. Re-read the live issue after any gap (new session, follow-up).
4. Build straight away from the body as written.

## 4. Branches and delivery
- `main` = production, `staging` = landing branch. Push directly to `staging`; no feature branches unless the issue says so.
- Never push to `main`, merge the production PR, promote deployments, or force-push.
- One open `staging` -> `main` PR at a time. After landing, open it if none exists, or update its title/body to list every issue now on `staging` ahead of `main`. Emilis merges it with a merge commit.
- After a production merge, the `post-prod-sync` Action moves `staging` to `main`, closes the issues the PR names with `Closes`/`Fixes`/`Resolves #N`, and removes `in staging` from them. Use `Closes`, not `Refs`, for shipped issues.

## 5. Labels
After landing, add `in staging` to the issue; the `post-prod-sync` Action removes it after the production merge.
| Label | Meaning |
| --- | --- |
| `dev` | Implementable work |
| `bug` | Something is broken |
| `deferred` | Parked; not permission to implement |
| `blocked` | Blocked on another issue or step |
| `waiting` | Waiting on access or a decision |
| `in staging` | On `staging`, awaiting production merge |
| `security` | Security/credentials |
| `platform` | Infra/hosting/database |

## 6. Environments
- Hosting: Vercel (team emilisgin-1705), static site with no build step. `main` -> production (TBD, set once the Vercel project exists), `staging` -> staging (TBD, set once the Vercel project exists). If staging is behind login, don't claim to have checked it.
- Env vars: document names only, never values; scope staging and production separately.

## 7. Before reporting it on staging
Run lint, typecheck, unit tests (also under a non-Europe/Vilnius `TZ`), build and e2e; confirm no secrets were committed. Then report once, in the project thread: the PR link, the checks run with results, what you couldn't check, and what Emilis must check by hand.

## 8. Testing
- Pin Node 24 everywhere. CI runs all checks on push/PR to `staging` and `main`.
- All pure logic gets unit tests; worked examples in the issue become tests. Tests never hit live services.
- Time zone: Emilis is in `Europe/Vilnius`. Date/time behaviour must be stated in the issue and tested, including DST days.
- Don't add anything the issue doesn't ask for.

## 9. Secrets and server data
- No secrets in the repo. If one is committed, stop and tell Emilis in the thread.
- Deploys never reset or overwrite server data. Shape changes bump a schema version and migrate in place. Staging and production data stay apart.
