# Changelog

## v0.1.0-beta.6

- Reworked violet and sky themes so the glass panels, cards, charts, accents and rabbit mark change together.
- Increased acrylic transparency, blur and floating-window depth.
- Added Today / This Week switching to the task list.
- Replaced the reused weekday chart with real range-aware task statistics.
- Seven-day statistics use daily buckets; 30-day statistics use five-day ranges; monthly statistics use calendar-week ranges through today.
- Replaced the prototype category chart with explicit local-session, account-estimate and unavailable-data coverage.
- Clarified that historical statistics are derived from locally available task records, not official billing data.

### Known limitations

- Windows-only beta.
- Historical statistics cannot recover deleted or unavailable Codex task records.
- No persistent SQLite history or automatic updater yet.
- The build is unsigned and may trigger Windows SmartScreen.

## v0.1.0-beta.5

- Added real Codex 5-hour and weekly remaining limits.
- Added reset countdowns based on real Unix timestamps.
- Added a flat list of recent daily tasks instead of folder grouping.
- Added per-task token totals with explicit local-record/account-estimate labels.
- Added up to ten scrollable task rows without overlapping the footer.
- Added five-minute refresh and wake/focus catch-up behavior.
- Added teal, violet and sky themes.
- Added single-instance behavior and hidden subprocess windows.

### Known limitations

- Windows-only beta.
- The statistics page still contains prototype data.
- The portable build is unsigned and has no automatic updater.
