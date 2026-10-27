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
- GitHub Pages reads and summarizes workbooks in the browser and stores capacity settings in browser storage; it cannot run SQLite.

## Implemented

- Booking workbook import and normalization.
- Totals for booking rows, product quantity, and print impressions.
- SQLite persistence and import history.
- Configurable minutes per impression, setup minutes per PO, machine count, shifts, minutes per shift, efficiency, and planning horizon.
- Required-machine calculation with capacity gap.
- Planning dashboard and responsive layout.
- Overview with three real-data groups: delivered files, processed files, and untouched originals.
- GitHub Pages deployment workflow.

## Current limitations

- Minute and machine results remain unset until the user enters company standards.
- No workflow action yet marks an original as processed or delivered; those lists remain empty until real events are implemented.
- The GPT Sites URL must be republished or synchronized separately after repository changes.

## Coordination protocol

1. Run `git pull --ff-only origin master` before changing files.
2. Keep the current visual language unless the user explicitly requests a redesign.
3. Run `npm run build` and relevant browser tests.
4. Commit one coherent change and push to `master`.
5. Update this file only when product rules, implemented scope, limitations, or deployment behavior change.
6. Report the pushed commit SHA so the other chat can continue from the exact revision.
