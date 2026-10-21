# Privacy

Token Trace follows a local-first design.

## Data processed locally

- Codex rate-limit windows and reset timestamps
- Recent task identifiers, titles, timestamps and token totals
- Local UI preferences, such as the selected theme

## Data not collected by Token Trace

- Passwords
- API keys
- Access or refresh tokens
- The contents of Codex `auth.json`
- Source files or task conversation contents

Token Trace does not operate its own server and does not transmit usage or task data to the project maintainer. It starts the locally installed Codex App Server and processes its responses on the same computer.

The application checks whether a local Codex authentication file exists only to locate the correct Codex user environment. It does not open, parse, log, copy or upload that file.

## Local session fallback

When per-task usage estimates are unavailable, Token Trace may inspect local Codex session event records to obtain the recorded aggregate token count for a task. It does not send session content to the frontend or any remote service.

## Uninstalling

The portable build does not create a Windows service or uninstall entry. Close Token Trace and delete its extracted directory.
