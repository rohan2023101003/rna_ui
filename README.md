# Road Numbering Evaluation Interface

A web interface for the road-numbering work in *Automated Road Numbering for
Geospatial Maps Using Search Algorithms* (IGARSS 2025). It renders a road
network from raw GIS files, joins the algorithm-generated numbering CSVs onto
that geometry, and draws the result as an interactive map — the groundwork for
the human-in-the-loop evaluation planned for the follow-up paper.

No third-party packages. Python standard library on the server, plain ES
modules in the browser.

```bash
git clone git@github.com:rohan2023101003/rna_ui.git
cd rna_ui
python3 server.py            # then open http://127.0.0.1:8000
python3 server.py --port 9000 --data ./data --results ./results
```

`data/`, `results/` and `web/` are located relative to `server.py`, so the
server can be launched from any working directory.

> **Running the human study?** See **[evaluate/README.md](evaluate/README.md)** —
> a self-contained 30-minute study that participants run in their browser with
> no install and no server, on any of the six networks with any 2-6 of the
> seventeen numbering schemes, plus the script that turns their result files
> into the final numbers.
>
> **Planning the human study?** See
> **[HCI_EVALUATION_METHODS.md](HCI_EVALUATION_METHODS.md)** — which human
> evaluation methods go in the paper, which are rejected and why, each explained
> from scratch with formulas and worked examples.
>
> **New to the automatic evaluation?** Start with
> **[EVALUATION_GUIDE.md](EVALUATION_GUIDE.md)** — a plain-language guide to
> what each measurement means, how to run it, and how to read the numbers.
> Assumes no background.
>
> [EVALUATION.md](EVALUATION.md) is the longer research plan behind it,
> including the human studies not yet run.

## What it does

**Tab 1 — View input map.** The cleaned road network exactly as supplied, with
no numbering applied: black roads, optional intersection nodes, a network
summary (segment count, total length, N–S / E–W split, source CRS).

**Tab 2 — View output map.** The same geometry with one algorithm's road
numbers joined on and drawn as labels. The algorithm is named in full ("MUCS +
Min-cut partitioning + Bucketing", not `mucs_BGP`) and its pipeline is broken
into the paper's three steps. Roads can be coloured by min-cut partition,
by N–S/E–W direction, by road number, or by which segments were bucketed into
one physical road.

**Tab 3 — Evaluate.** Scores every numbering against standard spatial
statistics (Moran's *I*, Geary's *C* with permutation nulls, Mantel *r*),
graph-labelling measures (bandwidth and profile against Reverse Cuthill-McKee),
locality references (Hilbert curve), address quality (bucket contiguity,
dispersion, ARI against real street names) and task simulations (greedy
routing, delivery-tour ratio). Six reference baselines are included so the
numbers have a floor and a ceiling to be read against, and any of them can be
drawn on the map. See [EVALUATION.md](EVALUATION.md) for every formula.

The first two tabs share one map with wheel zoom, drag pan, shift+drag
box-zoom, double-click zoom, keyboard control (`+` `-` arrows `F` `Esc`), hover
tooltips, click-to-inspect, a live scale bar and cursor coordinates.

## Uploading your own network

Drop a folder onto the upload box, or click to browse. It needs the shapefile
set (`.shp`, `.shx`, `.dbf`, `.prj`); any `.csv` files included in the same
folder are treated as algorithm outputs and appear in the algorithm picker.
Uploads land in `uploads/` and are listed alongside the bundled datasets.

The road and node layers are identified by geometry type, not by filename, so
your folder does not have to follow the `*RN` / `*nodes` naming used by the
bundled data.

## How the two halves are joined

Each result CSV row carries `road_id`, which is the `id` attribute of the
matching record in the road shapefile, and `seq`, that record's position in the
file. Both are verified on load; anything that fails to line up is reported in
the UI as "N roads unmatched" rather than being silently dropped.

Across the six bundled networks and all 17 algorithm outputs each — 102
combinations — every road matches.

Geometry is reprojected from each dataset's own CRS to WGS84 so the output is
conformant GeoJSON:

| City | Source CRS |
|---|---|
| Brooklyn | NAD83 / UTM zone 18N |
| Hyderabad | WGS84 / UTM zone 44N |
| Melbourne | GDA2020 / MGA zone 55 |

The projection parameters are read from each layer's `.prj`, so a new dataset
in any Transverse Mercator (UTM/MGA) zone works without code changes.

## Layout

```
server.py              stdlib HTTP server: dataset API, upload, event log
rna/
  shapefile.py         .shp / .shx / .dbf / .prj readers
  projection.py        inverse Transverse Mercator -> WGS84
  algorithms.py        decodes `middfs_BucsGP_d5` into a readable description
  dataset.py           discovery, GeoJSON conversion, CSV join
  geometry.py          local metric frame, polyline distance, grid index, Hilbert
  graph.py             line graph, BFS, Cuthill-McKee, Fiedler vector
  metrics.py           every evaluation metric
  baselines.py         random / coordinate / Hilbert / RCM / spectral orderings
  evaluate.py          orchestration, metric catalogue, caching
evaluate/              the human study - see evaluate/README.md
  index.html           the whole study, one page, no server needed
  js/design.js         which schemes, what order, which roads
  js/scheme.js         network loading; partitions, buckets, colours
  js/tasks.js          the three participant tasks
  js/study.js          screen flow and session state
  build_bundle.py      bakes all 6 networks x 17 algorithms into js/
  tests/check_design.mjs  checks the design without a browser
  tests/check_review.mjs  checks the review screen against a real DOM
  tests/check_metrics.py  checks every measure against a hand-computed answer
  aggregate.py         40 result files -> final results + tidy CSV
analysis/
  test_metrics.py      86 self-tests for the metrics
  verify_metrics.py    the EVALUATION.md worked example
  confound.py          the Metric 1 range-confound sweep
web/
  index.html
  css/app.css
  js/mapview.js        SVG renderer: projection, zoom/pan, labels, hit-testing
  js/app.js            controller: tabs, panels, inspector, upload, task
  js/evaluate.js       evaluation table, confound diagnostic, CSV export
  js/logger.js         batched interaction logging
  js/api.js
uploads/               uploaded datasets (created on first upload)
logs/events.jsonl      interaction log (created on first event)
```

## API

| Endpoint | Purpose |
|---|---|
| `GET /api/datasets` | bundled + uploaded datasets, with their algorithm lists |
| `GET /api/datasets/<city>/<network>` | roads + nodes as WGS84 GeoJSON |
| `GET /api/datasets/<city>/<network>/numbering/<algorithm>` | one algorithm's numbers |
| `GET /api/datasets/<city>/<network>/evaluation` | metric catalogue + network structure |
| `GET /api/datasets/<city>/<network>/evaluation/<row>` | score one algorithm or baseline |
| `POST /api/upload` | add a dataset (JSON, base64 file contents) |
| `POST /api/events` / `GET /api/events` | append / read interaction events |

## Objectives status

1. **Integrate CSV outputs with GIS networks in a web format, preserving
   geometry** — done. `rna/` converts shapefiles + CSVs to WGS84 GeoJSON with
   the numbering joined on, verified across all 102 dataset/algorithm pairs.
2. **Responsive web interface with core GIS interaction** — done. Zoom, pan,
   box-zoom, hover, select, search, label density control, SVG export;
   the layout collapses down to tablet and phone widths.
3. **Design HCI tasks and metrics** — a working sketch is in place (see below);
   the task design itself is the next piece of work.
4. **Backend to log interaction metrics and feedback** — the logging path is
   built and running: every dataset load, algorithm switch, pan, zoom, road
   click, search and answer is timestamped and appended to
   `logs/events.jsonl`. Continuous gestures are coalesced, so one pan is one
   record with a duration rather than hundreds of frames.

## The human-evaluation task (preview)

The sidebar has a working sketch of the planned study: blank out *N* road
numbers, let a participant click a blanked road and type the number they
expect, then score the guess against the algorithm's number (absolute
difference, whether it fell within 5, and whether the odd/even parity matched).
It is a demonstration that the renderer supports the interaction, not a
finished protocol.

The renderer exposes what a finished task will need:

```js
map.setLabel(roadId, text)        // rewrite a number on a road
map.setHiddenLabels([ids])        // blank numbers out
map.setRoadStyle(roadId, {color, width, className})
map.colorBy(road => colour)       // recolour the whole network
map.setHighlighted([ids])
map.zoomToRoad(roadId)
map.on('road:click' | 'road:select' | 'view:change' | 'pointer:move', fn)
```

## Notes on the data

- **Street names are largely absent**, which is the paper's premise made
  visible. Melbourne has no name column at all; Hyderabad names only 141 of
  1351 segments in the larger network; Brooklyn has the same single value
  copied across every record. The interface detects this and disables name
  labels rather than repeating one name 193 times.
- **Roads near the 45° diagonal** could reasonably be called either N–S or
  E–W. Rather than reporting these as violations of the odd/even rule, the
  inspector marks them "diagonal road — rule not applicable". Every parity
  mismatch found in the modified algorithms was one of these, within 0.3° of
  the boundary — the rule otherwise holds exactly.
- **Two roads can share a number, for two different reasons.** Min-cut
  partitioning (Step 1) restarts the numbering inside each partition, so a
  number appears once per partition — 1309 of Hyderabad Network-2's 1351 roads
  share a number under `mucs_GP`, and **none** of those pairs are inside one
  partition. Bucketing (Step 2) gives every segment of one physical road the
  same number — 939 roads under `mucs_B`, and **all** of those are inside one
  partition, with every one of the 264 groups connected in the road graph. The
  output map can colour by either, and the human study draws partitions in
  different colours and bucketed roads slightly thicker.
- **`road_no = 0`** means a road was never assigned a number. The algorithm fix
  cleared most of these; two remain, both on road 192 of Melbourne/Network-1
  (`middfs_GP_d5` and `middfs_BGP_d5`, where the `edges` list is also empty).
  Such roads are shown as "not assigned" rather than as road number 0, and are
  excluded from the evaluation task.
- The unmodified **BFS and DFS** baselines break the odd/even rule widely
  (e.g. 171 of 873 segments in Brooklyn Network-2), consistent with the
  paper's finding that node-based traversal does not cover road numbering
  properly. They are grouped under "Reference baselines" in the picker.
