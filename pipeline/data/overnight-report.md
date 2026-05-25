# Overnight run — report

Run completed: Sun May 24 20:35:49 EDT 2026

## Counts

- Raw JDs:        458
- Structured:     458
- Views:          458
- Companies:      79

## Validation

- JSONs with flagged validation issues: 7 (these still saved; check `extraction_notes.validation_issues` per file)

## Cost

Total spend across all retries is in `overnight.log` — search for "Cost (actual):" lines and sum them.

## Next steps when you wake up

1. Open `pipeline/jds-views/INDEX.md` — browse a few views by company.
2. If 458 - 458 > 0, some JDs failed to extract. Look at the tail of `pipeline/data/overnight.log` for errors.
3. Otherwise, you're set. Move to step 05 (enrich-company-meta).

