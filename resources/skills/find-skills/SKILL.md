---
name: find-skills
description: Helps discover installable agent Skills when the user asks for a capability, asks whether a Skill exists, wants to extend an Agent, or needs help searching marketplace sources such as skills.sh, claude-plugins.dev, or Clawhub.
---

# Find Skills

Use this Skill when a user wants to extend an Agent with reusable capabilities.

## Workflow

1. Clarify the task the user wants to automate or improve.
2. Search the available Skill marketplace sources using the platform Skill search.
3. Present matching Skills with name, source, summary, and source URL when available.
4. Before installing a third-party Skill, explain that Skills can contain instructions and files that affect Agent behavior.
5. Install only after the user confirms the source is acceptable.

## Search Hints

Prefer specific keywords:

- `react testing` instead of `testing`
- `docs generation` instead of `docs`
- `security review` instead of `review`
- `meeting notes` instead of `notes`

If no relevant Skill exists, offer to help create a new Skill or solve the task directly.

## Security Review

Before installing marketplace Skills:

- Check the source registry and source URL.
- Read `SKILL.md` and bundled scripts when possible.
- Warn the user when a Skill includes scripts or tool instructions.
- Avoid installing Skills with unclear purpose or unrelated file operations.
