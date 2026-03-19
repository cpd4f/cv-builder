# CV Builder

A static CV publishing pipeline that:

- Pulls CV records/items from Airtable into normalized JSON.
- Renders CVs for web (`/cv?cv=<slug>`), print (`/cv-print.html`), and external embed (`cv-embed.js`).
- Builds PDF files into `dist/<slug>.pdf` using Vivliostyle.
- Optionally generates AI feedback for a single triggering CV and writes it back to Airtable.

---

## Repository Structure

- `scripts/build-cv-json.js` — Airtable ➜ `data/cv/*.json` exporter.
- `scripts/build-cv-pdf.js` — JSON ➜ paginated HTML ➜ `dist/*.pdf` builder.
- `scripts/run-cv-ai-feedback.js` — Airtable CV ➜ OpenAI feedback ➜ Airtable update (`Overall AI Feedback`).
- `cv-render.js` — browser renderer shared by viewer/print/embed flows.
- `cv.html` — viewer page for a single CV with a PDF link.
- `cv-feedback.html` — CV + AI feedback review page (overall and item-level feedback side-by-side).
- `cv-print.html` + `cv-print.css` — print-focused paginated view.
- `cv-embed.js` + `cv-embed.html` — non-iframe embeddable widget + usage/instructions page.
- `.github/workflows/cv-ai-feedback.yml` — issue/manual-trigger workflow for AI feedback runs.

---

## High-Level Flow

1. **Data ingest**: Airtable records are fetched and normalized into `data/cv/<slug>.json`.
2. **Render paths**:
   - Web viewer (`cv.html`) renders CV content client-side.
   - Print page (`cv-print.html`) renders paginated layout client-side.
   - Embed script (`cv-embed.js`) renders inside Shadow DOM on external sites.
3. **PDF build**: `scripts/build-cv-pdf.js` transforms JSON into print HTML and runs Vivliostyle to generate `dist/<slug>.pdf`.
4. **AI feedback (optional)**: workflow/script fetches the triggering CV, sends structured prompt to OpenAI, writes output to Airtable `Overall AI Feedback`.

---

## Prerequisites

- Node.js 20+ (ESM project).
- npm.
- Airtable PAT + base/table identifiers for Airtable scripts.
- Optional: `OPENAI_API_KEY` for AI feedback flow.

Install dependencies:

```bash
npm install
```

---

## npm Commands

```bash
npm run build:json    # Build CV JSON files from Airtable
npm run pdf:build     # Build PDFs from data/cv/*.json
npm run pdf:preview   # Open Vivliostyle preview for cv-print.html
npm run ai:feedback   # Run AI feedback script for the triggering CV
```

---

## Airtable JSON Build (`build:json`)

### What it does

- Reads CV header-level data from the `CVs` table.
- Reads itemized content from the `CV Items` table.
- Normalizes rich-text field variants.
- Writes canonical JSON to `data/cv/<slug>.json`.

### Trigger targeting logic

The script can resolve a specific CV record ID from:

- Issue title pattern like `CV_UPDATE recXXXXXXXXXXXXXX`.
- Issue body line like `recordid recXXXXXXXXXXXXXX`.

If configured, it can also build all published CVs.

### Environment variables

Required for Airtable access:

- `AIRTABLE_PAT`
- `AIRTABLE_BASE_ID`

Optional/config:

- `CVS_TABLE_NAME` (default: `CVs`)
- `CV_ITEMS_TABLE_NAME` (default: `CV Items`)
- `CVS_TABLE_ID`
- `CV_ITEMS_TABLE_ID`
- `ISSUE_TITLE`
- `ISSUE_BODY`
- `BUILD_ALL_CVS=true|false`

### CV Footer behavior

`build-cv-json` reads footer content from the CV table using `CV_Footer` (also supports fallback matching), and emits it in JSON as section `footer` for downstream renderers.

---

## Web Viewer (`cv.html`)

- Route format: `/cv?cv=<slug>`.
- Loads `data/cv/<slug>.json`.
- Renders CV content using `CvRender.renderStandardCv`.
- Provides a single action to open `dist/<slug>.pdf` in a new tab.

---

## Print View (`cv-print.html` + `cv-print.css`)

- Route format: `/cv-print.html?cv=<slug>`.
- Uses paginated rendering (`CvRender.renderPaginatedCv`).
- CSS defines print-friendly multi-block layout and footer area.
- Intended for previewing/validating print layout behavior and as a design reference for PDF generation.

---

## PDF Build (`pdf:build`)

### What it does

- Reads each `data/cv/*.json` file.
- Generates an HTML document with the same layout model as print rendering.
- Calls `npx vivliostyle build` to output `dist/<slug>.pdf`.

### Output

- PDFs are written to `dist/` (e.g., `dist/coleman-davis.pdf`).
- A recap report is also written to `dist/<slug>.pdf-recap.md` so you can quickly review how the builder paginated and sectioned each CV.

### Important notes

- This environment may fail during Playwright Chromium download if external mirrors return 403.
- Script-level parse/runtime checks can still be verified with `node --check scripts/build-cv-pdf.js`.
- Set `CV_PDF_RECAP_ONLY=1` to generate only the recap file without invoking Vivliostyle (useful in restricted CI or local environments).

---

## Embeddable CV (`cv-embed.js`)

A **non-iframe** embed that renders directly in the host page and isolates styles using **Shadow DOM**.

### Basic snippet

```html
<div id="cv-embed-target"></div>
<script
  src="https://cpd4f.github.io/cv-builder/cv-embed.js"
  data-cv="coleman-davis"
  data-target="cv-embed-target"
></script>
```

### Supported `data-*` attributes

- `data-cv` (required): slug to load (`data/cv/<slug>.json`).
- `data-target` (optional): target container ID.
- `data-base-url` (optional): override base URL for self-hosting.

### Embed docs page

- `cv-embed.html` provides:
  - Copy-to-clipboard snippet.
  - Usage/options guidance.
  - Live preview.

---

## AI Feedback Automation

### Script (`scripts/run-cv-ai-feedback.js`)

- Targets one triggering CV record (resolved from issue/body inputs).
- Converts CV JSON/content into structured prompt text.
- Calls OpenAI using `OPENAI_API_KEY`.
- Writes response to Airtable field: `Overall AI Feedback`.
- Then writes targeted CV-table feedback to `AI Feedback Intro`, `AI Feedback Core Competencies`, and `AI Feedback Footer` when those source blocks exist.
- Finally (last step) generates **item-level** feedback for eligible CV Items and writes it to each item's `AI Feedback` field in the `CV Items` table (excluding `Education` and `Second Page Rail`).

### Model

- Configured for `gpt-5.4` per project requirement for overall, CV-table field, and item-level feedback generation.

### Required environment

- `AIRTABLE_PAT`
- `AIRTABLE_BASE_ID`
- `OPENAI_API_KEY`
- Issue context (`ISSUE_TITLE`/`ISSUE_BODY`) when running issue-driven targeting.

---

## GitHub Actions: `cv-ai-feedback.yml`

Workflow triggers:

- `workflow_dispatch`
- `issues` events: opened / edited / reopened

Behavior:

1. Validates guard conditions for issue-triggered runs (title prefix + expected author).
2. Installs dependencies.
3. Runs `npm run ai:feedback`.
4. Posts success/failure comment back to the triggering issue.

---

## Local Development Checklist

1. `npm install`
2. Configure `.env` (or export shell vars) for Airtable/OpenAI secrets.
3. `npm run build:json`
4. `npm run pdf:build`
5. Serve repository root with any static server and test:
   - `/cv?cv=coleman-davis`
   - `/cv-print.html?cv=coleman-davis`
   - `/cv-feedback.html?cv=coleman-davis`
   - `/cv-embed.html`

---

## Troubleshooting

### `npm run pdf:build` fails with Playwright download 403

This is typically an environment/network limitation when Vivliostyle tries to fetch Chromium. Re-run in an environment with Playwright download access or preinstalled browser binaries.

### Missing footer content

Confirm the source Airtable field is `CV_Footer` on the `CVs` table and rerun `npm run build:json`. Footer content is optional and only renders when present.

### Triggered workflow ran but nothing updated

- Check issue title/body includes valid record ID (`rec...`).
- Confirm secrets are available to workflow (`AIRTABLE_PAT`, `AIRTABLE_BASE_ID`, `OPENAI_API_KEY`).
- Review workflow logs and issue comments for guard/failure reasons.

---

## Deployment Notes

This repo is designed for static hosting (e.g., GitHub Pages). Ensure the following are published:

- `data/cv/*.json`
- `dist/*.pdf`
- `cv.html`, `cv-print.html`, `cv-embed.html`, `cv-embed.js`, `cv-render.js`, `cv-print.css`
