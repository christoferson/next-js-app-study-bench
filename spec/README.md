# spec/ — Engineering Reference

Detailed engineering rules for StudyBench, split by subject so that each file is
read only when the current task touches it.

`CLAUDE.md` is the always-loaded entry point. It holds the rules that apply to all
work and routes here for depth. See `CLAUDE.md` section 6 for the read-before-you-
work map.

| File | Subject |
| --- | --- |
| [WORKFLOW.md](WORKFLOW.md) | Per-milestone process and the required completion report |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Layering, modules, repositories, facades, Next.js, persistence, performance |
| [CODING-STANDARDS.md](CODING-STANDARDS.md) | TypeScript standards and boundary validation |
| [TESTING.md](TESTING.md) | Test levels, determinism, and external-service policy |
| [UI-GUIDELINES.md](UI-GUIDELINES.md) | Product feel, mobile study, accessibility, styling |
| [SECURITY.md](SECURITY.md) | Secrets, credentials, access gate, URL retrieval, logging |
| [DOMAIN-RULES.md](DOMAIN-RULES.md) | Question, revision, and study-session invariants |
| [AI-GUIDELINES.md](AI-GUIDELINES.md) | Bedrock gateway, provenance, personas, Polly, Transcribe |

## Authority

These files sit below `SPEC.md` and `PROGRESS.md` in the precedence order defined
in `CLAUDE.md` section 3. They hold detail, not exceptions.

`SPEC.md` remains the single source of truth for product requirements, milestone
scope, and acceptance criteria. Milestone requirements are not restated here.
