# Buddhist History in Lanka — Interactive Timeline

An interactive timeline of Buddhism in Sri Lanka built with [TimelineJS3](https://timeline.knightlab.com/) by NUKnightLab, self-hosted and deployed via Netlify.

---

## Project Structure

```
Buddhist-History-in-Lanka/
├── public/                          ← Netlify publish directory
│   ├── index.html                   ← Static HTML (never generated — edit directly)
│   ├── css/
│   │   └── style.css                ← Custom styles
│   ├── js/
│   │   └── app.js                   ← Timeline initialisation
│   └── data/
│       └── timeline.json            ← Generated from CSV (only file the script touches)
├── scripts/
│   └── csv_to_timeline_json.py      ← Converts CSV → timeline.json (data only)
├── BuddhismLanka.csv                ← Source data spreadsheet
├── colors.yaml                      ← Custom color variables for slide backgrounds
├── netlify.toml                     ← Netlify build & header config
└── README.md
```

---

## Editing the Timeline

The timeline data lives in the CSV file at the project root:

```
BuddhismLanka.csv
```

It follows the **TimelineJS3 spreadsheet format** (same columns used by the Google Sheets integration). After editing the CSV, regenerate the JSON:

```powershell
python scripts/csv_to_timeline_json.py
```

Then commit and push — Netlify will automatically redeploy.

### CSV Column Reference

| Column | Purpose |
|---|---|
| `Year` / `Month` / `Day` / `Time` | Start date |
| `End Year` / `End Month` / `End Day` / `End Time` | End date (spans) |
| `Display Date` | Optional custom date label shown on the slide |
| `Headline` | Slide title |
| `Text` | Body text (HTML allowed) |
| `Media` | URL of an image, video, or embed |
| `Media Credit` | Attribution for the media |
| `Media Caption` | Caption displayed under the media |
| `Media Thumbnail` | Small thumbnail for the navigation bar |
| `Type` | Set to `title` for the opening title slide |
| `Group` | Groups events onto parallel rows |
| `Background` | Color variable (from `colors.yaml`), hex colour (`#rrggbb`), CSS color, or image URL |

### Background Colors & Variables

You can define reusable color variables in [`colors.yaml`](colors.yaml):

```yaml
monk: "#ef8215"
layman: "#358484"
era: "#000000"
title: "#700e01"
```

In `BuddhismLanka.csv`, you can reference any variable name directly in the `Background` column (e.g. `monk`). When `scripts/csv_to_timeline_json.py` runs, it will substitute the variable with its hex value.

Any standard color (e.g. `#700e01`, `rgb(...)`, `hsl(...)`, or CSS color names) or image URLs placed in the `Background` column will also be processed as normal.

---

## Netlify Deployment

1. Push this repository to GitHub (or GitLab / Bitbucket).
2. In Netlify → **Add new site → Import an existing project**.
3. Select the repository.
4. Netlify reads `netlify.toml` automatically, so **no manual settings are needed**.
   - **Publish directory:** `public`
   - **Build command:** *(none — the JSON is pre-generated and committed)*
5. Click **Deploy site**.

> **Optional build command:** If you want Netlify to regenerate the JSON from the CSV on every deploy, set the build command to:
> ```
> python scripts/csv_to_timeline_json.py
> ```

---

## Local Preview

The page fetches `data/timeline.json` over HTTP, so you need a local server (not `file://`). Run these two commands separately in PowerShell:

```powershell
cd "c:\Users\learn\Videos\PROJECTS\Buddhist-History-in-Lanka\public"
python -m http.server 8000
```

Then open **http://localhost:8000** in your browser.

---

## Customisation

- **Timeline options** are set in the `<script>` block at the bottom of `public/index.html`.
  Full option reference: <https://timeline.knightlab.com/#options>
- **Colours / fonts** are in the `<style>` block of `public/index.html`.
- To use a **fully offline / self-hosted** copy of TimelineJS3 (no CDN dependency):
  1. Download the latest release ZIP from <https://github.com/NUKnightLab/TimelineJS3/releases>.
  2. Copy the `compiled/` folder into `public/timeline3/`.
  3. Update the two CDN `<link>` and `<script>` tags in `index.html` to point to
     `timeline3/css/timeline.min.css` and `timeline3/js/timeline.js` respectively.
  4. Add `script_path: 'timeline3/js/'` to the `options` object in `index.html`.

