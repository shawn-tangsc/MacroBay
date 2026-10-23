# Security policy

## Supported versions

The `0.1.x` line is the current public release. Older builds may not receive fixes.

## Reporting a vulnerability

Please **do not open a public issue** for a vulnerability that could expose credentials, local
data, or code execution.

Use GitHub's private vulnerability reporting or Security Advisory flow for this repository. If that
is unavailable, contact the maintainers through the repository profile and ask for a private
channel.

Include:

- affected version or commit;
- operating system;
- a minimal reproduction;
- impact;
- any suggested fix.

Do not include real API keys, tokens, personal data, or full local database dumps.

## Scope

Relevant areas include:

- provider credential handling and the local secret store;
- Electron main/preload/renderer privilege boundaries;
- IPC validation and privilege escalation;
- agent tool approval and command execution;
- proxy handling and outbound request construction;
- local data storage and export paths.

## What to expect

Maintainers will acknowledge a report, investigate, and coordinate a fix and disclosure. There is
no bug bounty program.

## Safe harbor

Good-faith research that avoids privacy violations, data destruction, and service disruption is
welcome. Do not test against other users' data or provider accounts.

## Data and third-party services

This project is a local client. It does not operate a hosted data service. See the
[data disclaimer](./docs/reference/data-disclaimer.md).
