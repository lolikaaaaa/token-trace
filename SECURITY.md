# Security Policy

## Supported version

Token Trace is currently an early beta. Only the latest published release receives security fixes.

## Reporting a vulnerability

Please do not publish credentials, session files, logs containing personal paths, or other sensitive information in a public Issue.

Open a GitHub Issue containing only a non-sensitive description and request a private contact channel. Include the affected Token Trace version and Windows version, but redact usernames, task names, account identifiers and tokens.

## Trust boundaries

- Token Trace communicates with a locally installed Codex App Server.
- It does not require a separate Token Trace account.
- It does not bundle Codex credentials.
- Release binaries should be downloaded only from this repository's Releases page and verified against the published SHA-256 checksum.
