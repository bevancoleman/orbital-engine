# Security Policy

## Supported Versions

This project is pre-1.0 (currently `0.x`). Only the latest published version is supported — there's no maintained backport branch yet.

## Reporting a Vulnerability

Please **do not** open a public issue for a security vulnerability.

Instead, use [GitHub's private vulnerability reporting](https://github.com/bevancoleman/orbital-engine/security/advisories/new) for this repository (Security tab → Report a vulnerability). This opens a private advisory visible only to the maintainer until a fix is ready.

If that's not available to you, contact the maintainer via the details on the [GitHub profile](https://github.com/bevancoleman).

Please include:
- A description of the issue and its potential impact
- Steps to reproduce (a minimal example is ideal)
- The affected version(s)

You can expect an initial response within a few days. This is a small, single-maintainer project — there's no formal SLA, but reports are taken seriously and a fix (or an explanation of why something isn't in scope) will follow.

## Scope

`orbital-engine` is a client-side rendering library — it doesn't handle authentication, user data, or network requests on its own (asset loading via `modelUrl`/`textureUrl` is caller-supplied). Realistic concerns here are things like: a malicious/malformed glTF/texture file causing a crash or excessive resource use, or a supply-chain issue in a dependency. Report anything that looks like either.
