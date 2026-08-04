## Description

<!-- What does this PR do? Why? Reference issues/ADRs where relevant. -->

Closes #<!-- issue number -->

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Performance improvement
- [ ] Refactor
- [ ] Documentation
- [ ] CI / Infra

## Testing

- [ ] `npm run lint` passes
- [ ] `npm run typecheck` passes
- [ ] `npm run build` passes
- [ ] `npm run test:unit` passes
- [ ] `npm run test:e2e` passes (or targeted spec e.g. `npm run test:e2e:gmail-review`)
- [ ] `npm run test:e2e:typecheck` passes (if `e2e/` touched)
- [ ] `npm run test:e2e:contract` passes (if API shape changed)
- [ ] Visual baselines updated deliberately (`npm run test:e2e:visual`) if UI changed — and `:check` passes
- [ ] New behavior has tests (unit for helpers, E2E for user flows)

## Secret hygiene

- [ ] No `.env`, `.env.local`, `server/*.env`, service-account JSONs, tokens, or DB dumps are committed
- [ ] No real credentials or PII in code, docs, screenshots, or this description

## Documentation

- [ ] Behavior changes are reflected in `docs/` (folder `INDEX.md` updated if new docs added)
- [ ] `docs/` changes follow [docs/meta/DOCUMENTATION_STYLE_GUIDE.md](../docs/meta/DOCUMENTATION_STYLE_GUIDE.md) (English for public docs, metadata headers, relative links)

## Checklist before merge

- [ ] CI is green (quality → E2E stability gate → visual regression → performance budget)
- [ ] Commit messages follow Conventional Commits (`feat:`, `fix:`, `docs:`, …)
