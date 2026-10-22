# WMC Tract Endpoint Decoding Viewer

Interactive visualization of white matter tract endpoint decoding — how the cortical endpoints of each tract map onto meta-analytic cognitive topics (NeuroQuery LDA topics, decoded with [gradec](https://github.com/JulioAPeraza/gradec)) — built for the [brainlife.io](https://brainlife.io) platform.

Everything is drawn live in the browser from CSV / GIFTI data: no pre-rendered figures are needed.

**Live:** [kimberlylray.github.io/ui-wmc-endpoint-decoding](https://kimberlylray.github.io/ui-wmc-endpoint-decoding/) — a landing page (`index.html`) with the project description, preprint link and citation, linking to the actual tool (`explorer.html`).

White matter tracts were defined from the [Yeo-network-aligned atlas](https://academic.oup.com/cercor/article/32/20/4524/6528900) (*Cerebral Cortex*, 2022) using its [brainlife.io app](https://brainlife.io/app/5cc73ef44ed9df00317f6288).

## What it shows

**Cluster View**
- Dendrogram of tract similarity, computed live (click a branch → cluster, a name → tract)
- Member tracts listed next to the cluster label (click → Tract View)
- 3D cortical endpoint map of the whole cluster (LPI + RAS combined, max across member tracts)
- Top cognitive topics, radar chart and word cloud from the cluster's own decoding

**Tract View**
- 3D cortical endpoint maps for the RAS and LPI endpoints (drag to rotate, scroll to zoom)
- Decoding of the joint (LPI + RAS) map next to the RAS-only and LPI-only decodings: top topics, radar chart and word cloud for each
- Searchable list of all tracts, colored by cluster

**Full Matrix** — tract × topic heatmap with hover tooltips; click a row to open that tract.

**Topic details** — click any topic bar to see the topic's full 40-term list with LDA weights and term type (Functional / Anatomical / Clinical / Non-specific). The *Functional terms only* switch (on by default, matching the gradec figures) also drives the radar labels and word clouds.

Charts use the cluster's color throughout (a tract takes its cluster's color).

## How clustering works

`cluster.js` reproduces the clustering in `Kims-Revisions/decode-tracts.ipynb`:

1. keep tracts with no missing topic scores (`matrix.dropna(axis=0)`)
2. distance = 1 − Pearson r between tracts across topics
3. complete-linkage hierarchical clustering
4. cut the tree at distance `cut` (default 1.0; set per threshold in `explorer.html`)

Cluster numbers follow scipy's `fcluster` exactly, so cluster *N* matches row *N* of `cluster-matrix.csv`. Tracts with missing scores are shown as "Not clustered".

## Data layout

```
testdata/
└── thr-15/                    ← one folder per threshold
    ├── matrix.csv             ← tracts × topics, joint (LPI + RAS) decoding (Pearson r)
    ├── matrix_RAS.csv         ← RAS endpoint decoded on its own (same layout)
    ├── matrix_LPI.csv         ← LPI endpoint decoded on its own (same layout)
    ├── cluster-matrix.csv     ← clusters × topics, each cluster's combined map decoded
    └── func/
        ├── {lh|rh}.{tract}.{LPI|RAS}.func.gii   ← per-tract endpoint maps (fsaverage)
        └── manifest.json      ← which hemisphere/orientation files exist per tract
assets/
├── surf/mesh/                 ← fsaverage midthickness mesh, cortex mask, thickness
└── decoding/topic-terms.json  ← full term list per topic (see scripts/)
```

**matrix.csv** — first column `tract`, then one column per topic named `{id}_{term1}_{term2}_{term3}`; values are Pearson r, `NaN` for missing. `{id}` is the 1-based row of the topic in the LDA features file.

**topic-terms.json** — regenerate with

```bash
python3 scripts/export_topic_terms.py ../Kims-Revisions/data/decoding
```

which reads gradec's `source-neuroquery_desc-lda_{features,frequencies,classification}.csv`.

## Adding a threshold

1. Add a folder under `testdata/` with the files above.
2. Add an entry to `config.thresholds` in `explorer.html`:

   ```js
   '0.25 (6 clusters)': { folder: 'thr-25', surfBase: 'testdata/thr-25/func', cut: 1.0 }
   ```

   Options: `folder` (required), `surfBase` (omit to hide the 3D maps), `cut` (dendrogram cut, default 1.0), `noClusters: true` (hide the Cluster View).

## Running locally

```bash
npm install
npm start          # serves the folder, e.g. http://localhost:3000
```

Any static file server works (e.g. `python3 -m http.server 3000`); opening the HTML files directly from disk will not, because the browser blocks loading the data files. Once served, open `index.html` for the landing page or go straight to `explorer.html` for the tool.

## Hosting

The site is static, so it can be served from GitHub Pages (Settings → Pages → deploy from `main`, folder `/`) — `index.html` becomes the landing page visitors land on. For brainlife.io, point `dataBase` in `explorer.html` at the brainlife output location.

## Code

| File | Role |
|---|---|
| `index.html` | landing page: description, preprint link/citation, and live previews (reusing `cluster.js`/`surf3d.js` against real data) of each view |
| `explorer.html` | the tool itself: page shell + configuration (thresholds, data paths) |
| `viewer.js` | main Vue component (views, data loading, interaction) |
| `cluster.js` | hierarchical clustering + dendrogram |
| `charts.js` | radar chart + word cloud |
| `surf3d.js` | GIFTI parsing + three.js cortical surface rendering |
| `scripts/export_topic_terms.py` | builds `assets/decoding/topic-terms.json` |

Dependencies are loaded from a CDN, with no build step: [Vue 2](https://v2.vuejs.org/), [PapaParse](https://www.papaparse.com/), [pako](https://github.com/nodeca/pako), [three.js](https://threejs.org/).

## Credits

Developed by Kim Ray, University of Texas at Austin (Pestilli Lab).
Supported by the [brainlife.io](https://brainlife.io) platform.

This tool accompanies:

> Human white matter tracts aligned with canonical functional brain networks
> Kimberly L. Ray, Sohmee Kim, Karen Herrera, Suna Guo, Daniela Reyes, Julio A. Peraza, Anna Bostoganashvili, Gabriele Amorosino, Angela R. Laird, Franco Pestilli
> doi: [10.64898/2026.05.20.726546](https://doi.org/10.64898/2026.05.20.726546)
