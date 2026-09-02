---
name: skills-catalogue
description: 'Locate and use the 75 shared agent skills in SnagItOrg/skills. Use when a task calls for an established method rather than improvisation — UX and usability review, visual design, copy and messaging, conversion, product strategy, code craftsmanship, or system architecture — or when the user names a domain ("UX", "code quality") or a book ("Don''t Make Me Think", "Clean Code") without naming a skill. Routing only: it tells you which skill to read and where it lives.'
license: MIT
---

# Shared skills catalogue

75 skills live in a separate repo, `SnagItOrg/skills` — not in this one. This
file exists so you can find them without knowing 75 names.

## Getting them

Check first: type `/ux-design`. If it resolves, the marketplace is installed.

```
/plugin marketplace add SnagItOrg/skills
/plugin install ux-design@snagit-skills
```

If the plugin cannot be installed, read the files directly:

```
git clone git@github.com:SnagItOrg/skills.git
plugins/<collection>/skills/<skill-name>/SKILL.md
```

## The ten domains

Each has an index skill named after it — `/ux-design`, `/code-craftsmanship` —
that lists its members and routes onward.

| Domain | Reach for it when |
|---|---|
| `ux-design` (11) | usability, visual hierarchy, typography, interaction, retention |
| `code-craftsmanship` (7) | naming, refactoring, legacy code, documentation, domain modelling |
| `systems-architecture` (6) | system design, scalability, resilience, performance |
| `product-strategy` (5) | customer discovery, positioning, pricing, negotiation |
| `product-innovation` (5) | discovery, prototyping, sprints, shipping cadence |
| `marketing-cro` (5) | messaging, conversion optimisation, virality, lead generation |
| `strategy-growth` (6) | market entry, growth, network effects, operating systems |
| `sales-influence` (4) | outbound, persuasion, offers, memorable messaging |
| `team-motivation` (2) | motivation, management, organisational performance |
| `metaskills` (14) | end-to-end: create / grow / improve an app, website or business |

## Books map to skills

Descriptions carry their source, so naming the book routes correctly.
The ones that come up most here:

| If someone says | Read |
|---|---|
| "Don't Make Me Think", Nielsen heuristics, "is this usable" | `ux-heuristics` |
| "Refactoring UI", spacing, colour, visual hierarchy | `refactoring-ui` |
| "Clean Code", naming, long functions, code smells | `clean-code` |
| "Design of Everyday Things", affordances, feedback | `design-everyday-things` |
| conversion audit, funnel, "why don't they convert" | `cro-methodology` |

## The Klup constraint — this overrides the skills

These skills give **method, not permission**. `frontend/CLAUDE.md` is the design
authority for this repo, and where generic advice conflicts with it, the repo
wins — say so rather than applying the skill blindly. In particular: green
`#13ec6d` only on Kup-rating stars and "Aktiv" badges, never hardcoded colour
values, DM Serif Display headlines with Inter body, and all user-facing copy
from `lib/i18n.ts` in both `da` and `en`.
