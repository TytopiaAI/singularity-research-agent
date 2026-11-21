# Unified research fields — 2026-10-21

## Implemented

- Research discovery opens the field workspace. Existing search history and field data are retained. Creating a field can associate it with a parent and opens the two-year survey configuration (20 papers by default).
- The shared workspace contains the living survey, all analysed papers, starred knowledge collection, relationship graph, monthly progress, and personal notes.
- Two-year arXiv retrieval uses four six-month windows. The candidate budget samples across publication dates; it is not an exhaustive literature census. Subsequent searches append and deduplicate papers.
- Synthesis requires eight cited sections: past development, three current research lines, evaluation, and three future hypotheses. Weak evidence must be identified explicitly. Personal notes remain independent.
- Starring uses the existing source-bound PDF download/import flow before persisting the star. Import failures leave the star unset. Removing a star does not delete the library paper.
- Field-specific monthly subscriptions persist locally. The app scheduler checks due fields, avoids concurrent research jobs, stores dated reports and source links, and retries failures after a day. A closed app catches up when opened; it does not run while the app is fully exited. No email or external messages are sent.
- Similarity candidates are explicitly based on shared mechanism tags, capped for readability, and visually distinguished from chronological and manually recorded relations. They do not imply verified inheritance.
- Voice particles use a pearl/violet/cyan cloud, tilted orbital ribbons and surface filaments, with audio response and reduced-motion support.

## Validation

- TypeScript check; targeted Vitest coverage for research requests, persistence, hierarchy, stars, monthly reports, calendar boundaries, due-job deduplication, and UI interactions.
- Development build only; no installer or installation changes.
- Electron field UI verification uses the production SQLite store and React components with deterministic model/network/import fixtures. Checked real mouse interaction, card/collection views, monthly setting, graph editing, notes, citations, continued accumulation, database reopening, and 100/125/150% layout scaling.
- Evidence: `.local-data/field-knowledge-verification/1792557634518/report.json`.
- Production voice canvas rendered in five phases using simulated audio, plus a dark-background screenshot: `.local-data/voice-orb-verification/1792557567589/report.json`.
- Live paid model and public-source availability were not exercised. Actual completeness and quality depend on returned source evidence; warnings and synthesis coverage are visible.

The supplied anomaly-detection Markdown was used as a structural reference, not silently imported as verified paper records.
