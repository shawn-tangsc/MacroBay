---
name: skill-creator
description: Create, edit, test, and improve reusable agent Skills. Use when the user wants to make a new Skill, refine an existing Skill, optimize trigger descriptions, add references or scripts, or package repeated Agent behavior into a clean reusable capability.
---

# Skill Creator

Use this Skill to design reusable Agent Skills with clear trigger metadata, concise instructions, and optional supporting resources.

## Skill Shape

```text
skill-name/
├── SKILL.md
├── references/
├── scripts/
└── assets/
```

`SKILL.md` is required. Supporting folders are optional and should exist only when they reduce prompt length or make behavior more reliable.

## Creation Workflow

1. Capture intent:
   - What capability should the Skill add?
   - When should it trigger?
   - What inputs does it need?
   - What output should it produce?
   - What tools or files does it rely on?

2. Draft metadata:
   - `name`: stable folder/display identifier.
   - `description`: specific trigger text. Include the task, context, and phrases that should activate the Skill.

3. Draft instructions:
   - Keep the core workflow short.
   - Use imperative steps.
   - Move long examples, schemas, or domain references into `references/`.
   - Put deterministic scripts in `scripts/`.

4. Review for safety:
   - No hidden destructive operations.
   - No unrelated data access.
   - No surprise network or filesystem behavior.

5. Test with realistic prompts:
   - One direct prompt.
   - One vague prompt that should still trigger.
   - One near-miss prompt that should not trigger.

6. Iterate:
   - Tighten the description if the Skill under-triggers.
   - Narrow the description if the Skill over-triggers.
   - Extract repeated procedural details into scripts or references.

## Writing Guidelines

Good Skill descriptions are specific and action-oriented:

```yaml
description: Review TypeScript pull requests for correctness, regression risk, missing tests, and maintainability. Use when the user asks for PR review, code review, or risk analysis on TypeScript changes.
```

Avoid vague descriptions:

```yaml
description: Helps with code.
```

## Review Checklist

- The Skill can be understood from its `name` and `description`.
- The body explains when and how to use supporting files.
- Long reference material is not loaded unless needed.
- Scripts are named clearly and can be run independently.
- The Skill is product-agnostic unless it intentionally belongs under a product module.

