#!/usr/bin/env python3
"""Bake the study data into JavaScript the participant's browser can load.

The study has to run with no server of its own, so everything it needs - road
geometry, junction adjacency, and the numbering every algorithm produced - is
packed into plain JS modules ahead of time.

    python3 evaluate/build_bundle.py

What comes out:

    evaluate/js/bundle.js               the index: 17 algorithms, 6 networks
    evaluate/js/cities/<City>-<Net>.js  one file per network, loaded on demand

Splitting per network matters: all six together are several megabytes, and a
participant only ever works on the one they chose. The index is a few
kilobytes, so the chooser appears instantly and only the chosen network is
fetched.

Everything here comes from `data/` and `results/` through exactly the same
`rna` code the main server uses, so what a participant sees is what
`python server.py` shows. Nothing is invented, sampled or re-ordered.

Re-run this whenever `data/` or `results/` changes.
"""

from __future__ import annotations

import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
os.chdir(ROOT)

from rna import algorithms as algo_info, dataset as ds
from rna.geometry import LocalFrame, polyline_midpoint
from rna.graph import LineGraph

OUT_DIR = os.path.join(ROOT, "evaluate", "js")
CITY_DIR = os.path.join(OUT_DIR, "cities")

# Geometry is rounded before it is written. Five decimal places of longitude is
# about a metre - far finer than a road drawn two pixels wide - and it roughly
# halves the file size.
COORD_DP = 5


def city_file(city: str, network: str) -> str:
    return f"{city}-{network}.js"


# --------------------------------------------------------------------------
# One network
# --------------------------------------------------------------------------

def build_city(city: str, network: str, algorithms: list[str]) -> tuple[dict, dict]:
    """Return (full network data, short index entry) for one dataset folder."""
    net = ds.load_network(f"data/{city}/{network}")
    features = net["roads"]["features"]

    frame = LocalFrame.from_points([f["geometry"]["coordinates"][0] for f in features])

    roads = []
    endpoints = {}
    for f in features:
        props = f["properties"]
        rid = props["road_id"]
        metres = [frame.to_metres(lon, lat) for lon, lat in f["geometry"]["coordinates"]]
        mx, my = polyline_midpoint(metres)
        roads.append({
            "i": rid,
            "o": props.get("orientation"),
            # Screen geometry, in WGS84 - the renderer reprojects it itself.
            "g": [[round(lon, COORD_DP), round(lat, COORD_DP)]
                  for lon, lat in f["geometry"]["coordinates"]],
            # Local metres, used to measure how far apart two roads are.
            "x": round(mx, 1),
            "y": round(my, 1),
            "len": round(props.get("length_m") or 0.0, 1),
        })
        endpoints[rid] = (props.get("source"), props.get("target"))

    graph = LineGraph(endpoints)
    adjacency = {str(k): sorted(v) for k, v in graph.adj.items() if v}

    ids = [r["i"] for r in roads]
    id_set = set(ids)
    numbering = {}
    summary = {}

    for key in algorithms:
        result = ds.load_numbering(f"results/{city}/{network}", key, id_set)
        rows = result["numbering"]

        # Numbers are stored as one array in road order rather than as an
        # object keyed by road id: same information, a third of the bytes.
        # 0 means "this algorithm never assigned this road a number".
        numbers = []
        partitions = []
        for rid in ids:
            row = rows.get(str(rid))
            if row is None or row.get("unassigned"):
                numbers.append(0)
                partitions.append(row.get("partition") if row else None)
            else:
                numbers.append(int(row["road_no"]))
                partitions.append(row.get("partition"))

        partitioned = any(p is not None for p in partitions)
        entry = {"n": numbers}
        if partitioned:
            entry["p"] = [-1 if p is None else int(p) for p in partitions]
        numbering[key] = entry

        # Roads sharing a number inside one partition are one physical road
        # split into several segments - the paper's Step 2, bucketing. Counted
        # here so the study can report it without recomputing on every screen.
        groups: dict[tuple, int] = {}
        for number, part in zip(numbers, partitions):
            if number <= 0:
                continue
            groups[(part, number)] = groups.get((part, number), 0) + 1
        assigned = [n for n in numbers if n > 0]
        summary[key] = {
            "partitions": len({p for p in partitions if p is not None}) if partitioned else 1,
            "buckets": sum(1 for c in groups.values() if c > 1),
            "bucketedRoads": sum(c for c in groups.values() if c > 1),
            "min": min(assigned, default=0),
            "max": max(assigned, default=0),
            "unassigned": sum(1 for n in numbers if n <= 0),
        }

    data = {
        "id": f"{city}/{network}",
        "city": city,
        "network": network,
        "roads": roads,
        "adj": adjacency,
        "numbering": numbering,
        "summary": summary,
        "bbox": net["bbox"],
    }
    index = {
        "id": data["id"],
        "city": city,
        "network": network,
        "file": city_file(city, network),
        "roadCount": len(roads),
        "lengthKm": net["stats"]["total_length_km"],
        "crs": net["stats"].get("layers", {}).get("roads"),
    }
    return data, index


# --------------------------------------------------------------------------
# Everything
# --------------------------------------------------------------------------

def write_module(path: str, name: str, payload: dict) -> int:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("/* Generated by evaluate/build_bundle.py - do not edit by hand. */\n")
        fh.write(f"export const {name} =\n")
        fh.write(json.dumps(payload, separators=(",", ":")))
        fh.write(";\n")
    return os.path.getsize(path)


def main() -> int:
    datasets = ds.discover(os.path.join(ROOT, "data"), os.path.join(ROOT, "results"))
    datasets = [d for d in datasets if d["has_results"]]
    if not datasets:
        print("no datasets with results found under data/ + results/")
        return 1

    # Only algorithms every network has, so a participant's four schemes exist
    # whichever map they choose. In this repository that is all 17 of them.
    per_dataset = [{a["id"] for a in d["algorithms"]} for d in datasets]
    keys = sorted(set.intersection(*per_dataset), key=algo_info.sort_key)
    dropped = sorted(set.union(*per_dataset) - set(keys))
    if dropped:
        print(f"  skipping {len(dropped)} algorithm(s) missing from some network: "
              + ", ".join(dropped))

    algorithms = []
    for key in keys:
        info = algo_info.parse(key)
        algorithms.append({
            "key": key,
            # Real names never reach the participant - the study labels the
            # schemes A, B, C, D - but the analysis needs them.
            "name": info["label"],
            "family": info["family_label"],
            "partitioned": info["partitioned"],
            "bucketed": info["bucketed"],
            "baseline": info["is_baseline"],
        })

    index = {"version": 2, "algorithms": algorithms, "cities": []}
    total = 0

    for d in datasets:
        data, entry = build_city(d["city"], d["network"], keys)
        size = write_module(os.path.join(CITY_DIR, entry["file"]), "CITY", data)
        total += size
        index["cities"].append(entry)
        parts = max(s["partitions"] for s in data["summary"].values())
        buckets = max(s["buckets"] for s in data["summary"].values())
        print(f"  {d['id']:22s} {len(data['roads']):5d} roads  "
              f"{len(keys):2d} numberings  up to {parts} partitions, "
              f"{buckets} bucketed numbers  {size / 1024:6.0f} KB")

    size = write_module(os.path.join(OUT_DIR, "bundle.js"), "BUNDLE", index)
    print(f"\n  wrote {os.path.join(OUT_DIR, 'bundle.js')}  ({size / 1024:.0f} KB index)")
    print(f"  wrote {len(index['cities'])} network files to {CITY_DIR}"
          f"  ({total / 1024:.0f} KB total, one loaded per participant)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
