# Team Coaching redesign

Not pushed or deployed. Implementation is isolated on codex/team-coaching-ready, based on 25279f5.

The Team Coaching page has a compact title and score row, two recommendation columns on wide screens, stacked recommendations on narrower screens, and full-width expandable rep rows. All recommendations, evidence, clip links, action indexes, existing permission checks and loading/error states remain in their original renderers. The original wordmark and background preference controls are unchanged. Artwork preferences remain browser-local, not account-synced.

Validation: 2,433 tests passed with local HTTP and Electron execution enabled; 47 focused checks passed. The actual stylesheet rendered without horizontal overflow at 1400, 900 and 390px with artwork enabled and disabled; recommendation cards retained an opaque background. Inline JavaScript parses. Render checks used synthetic content, not signed-in production sessions. No model prompts, data queries, migrations, or backend behavior changed.

The customize-view guard now uses the existing string-aware function extractor instead of an end marker tied to exact punctuation. New tests preserve recommendation completeness/indexes and loading, empty, unavailable and hidden-panel behavior.

Review before release: compare this implementation using representative signed-in data, then merge this branch after checking the current main state and the analysis drain. No deployment was performed by this block.
