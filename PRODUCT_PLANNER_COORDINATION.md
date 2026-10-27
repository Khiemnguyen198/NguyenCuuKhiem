# Product Planner Coordination

This file is the shared handoff point for every chat or agent working on Product Planner.

## Canonical source

- Repository: `Khiemnguyen198/NguyenCuuKhiem`
- Branch: `master`
- Public preview: `https://khiemnguyen198.github.io/NguyenCuuKhiem/`
- GPT Sites preview: `https://khiem-production-planner.devonreyes.chatgpt.site/`

Always pull `master` before editing. Do not treat the GPT Sites deployment as the source of truth unless its changes have also been committed to this repository.

## Product rules

- Input: booking workbooks with consolidated sheet `TH`, or lead-time sheets for 1, 2, 3, and 5 days.
- Work calendar: Monday through Saturday; Sunday is excluded.
- Original workbooks must never be overwritten.
- Core calculations must be deterministic; AI must not invent minute or machine values.
- SQLite stores normalized booking rows, import history, file history, and capacity settings when the Node development server is used.
- GPT Sites preview reads and summarizes workbooks in the browser and stores capacity settings in browser storage; it cannot run SQLite.

## Implemented

- Booking workbook import and normalization.
- Totals for booking rows, product quantity, and print impressions.
- SQLite persistence and import history.
- Configurable minutes per impression, setup minutes per PO, machine count, shifts, minutes per shift, efficiency, and planning horizon.
- Required-machine calculation with capacity gap.
- Planning dashboard and responsive layout.
- Overview with three real-data groups: delivered files, processed files, and untouched originals.
- User-confirmed processed and delivered events with timestamps; originals are retained and duplicate actions are ignored.
- Static builds persist file metadata and status history in browser storage; Node development persists events in SQLite.
- Two-level planning flow: the Kế hoạch section lists imported plan files first, then opens the selected import's scheduling dashboard.
- Lightweight local AI checker for missing or invalid values, date order, duplicate rows, unsupported lead times, and quantity outliers; SQLite stores one report per import.
- Production-standard catalog with AI-assisted Excel column mapping, manual entry, default-plan selection, and confirmation-gated editing; SQLite persists locked standards.
- Manual standard entry provides the user-confirmed catalog of 19 factory machines/processes as quick-select suggestions while still allowing new names.
- Production builds use browser storage for capacity settings and browser-only workbook import on static hosting, including GPT Sites at the root URL.

## Current limitations

- Minute and machine results remain unset until the user enters company standards.
- Marking a file as processed/delivered records a user-confirmed status only; it does not edit, generate, or send a workbook.
- Browser history is local to the current browser and does not store workbook bytes or sync across devices.
- The GPT Sites URL must be republished or synchronized separately after repository changes.

## Coordination protocol

1. Run `git pull --ff-only origin master` before changing files.
2. Keep the current visual language unless the user explicitly requests a redesign.
3. Run `npm run build` and relevant browser tests.
4. Commit one coherent change and push to `master`.
5. Update this file only when product rules, implemented scope, limitations, or deployment behavior change.
6. Report the pushed commit SHA so the other chat can continue from the exact revision.
