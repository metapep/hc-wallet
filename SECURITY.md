# Security Policy

## Reporting a Vulnerability

Please email `security@hashcash.network` with details of any suspected vulnerability. Do not file a public issue.

Include in the report:
- A clear description of the issue and its impact
- Steps to reproduce
- Affected versions / commits / platforms (iOS / Android)
- Any proof-of-concept or exploit code, ideally as an attachment rather than inline

We will acknowledge the report within a reasonable window and coordinate on disclosure timing.

## Scope

In scope:
- The `hc-wallet` mobile apps (iOS, Android, macOS Catalyst) and supporting native modules in this repository
- The build pipeline as it produces release artifacts

Out of scope:
- The HashCash protocol or node implementations (report those to the protocol maintainers)
- Third-party services (Electrum servers, Bugsnag, Firebase) — though we welcome reports of misconfiguration on our side
