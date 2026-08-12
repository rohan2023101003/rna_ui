"""Decode the result-CSV filenames into descriptions a non-expert can read.

The algorithm variants are encoded in the file stem, e.g. ``middfs_BucsGP_d5``
means Modified IDDFS with bucketing + UCS cost ordering + min-cut partitioning,
run with a depth step of 5. Participants in the human study should never see a
string like that, so every variant is expanded into a label, a one-line plain
description, and the list of pipeline stages it used.

Stage names follow the Road Numbering Algorithm in the IGARSS'25 paper:
  Step 1  min-cut graph partitioning   (suffix ``GP``)
  Step 2  bucketing of same-road edges (suffix ``B``)
  Step 3  search / traversal           (the base family)
"""

from __future__ import annotations

import re

# Base search families.
FAMILIES: dict[str, dict[str, str]] = {
    "bfs": {
        "label": "BFS",
        "full": "Breadth First Search",
        "summary": "Standard breadth-first traversal, kept as a reference baseline. "
                   "Being node-based it does not reach every road segment.",
        "modified": False,
    },
    "dfs": {
        "label": "DFS",
        "full": "Depth First Search",
        "summary": "Standard depth-first traversal, kept as a reference baseline. "
                   "Being node-based it does not reach every road segment.",
        "modified": False,
    },
    "mbfs": {
        "label": "MBFS",
        "full": "Modified Breadth First Search",
        "summary": "Breadth-first traversal reworked for edge-to-edge expansion, so "
                   "every road segment is numbered.",
        "modified": True,
    },
    "mdfs": {
        "label": "MDFS",
        "full": "Modified Depth First Search",
        "summary": "Depth-first traversal reworked for edge-to-edge expansion, so "
                   "every road segment is numbered.",
        "modified": True,
    },
    "mucs": {
        "label": "MUCS",
        "full": "Modified Uniform Cost Search",
        "summary": "Cost-aware traversal that numbers cheaper (shorter-path) road "
                   "segments first. Best overall performer in the paper.",
        "modified": True,
    },
    "middfs": {
        "label": "MIDDFS",
        "full": "Modified Iterative Deepening Depth First Search",
        "summary": "Repeated depth-limited passes that grow the depth limit each "
                   "round, blending depth-first and breadth-first behaviour.",
        "modified": True,
    },
}

# Optional pipeline modifiers, longest token first so 'ucs' does not eat 'B'.
MODIFIERS: dict[str, dict[str, str]] = {
    "B": {
        "label": "Bucketing",
        "step": "Step 2",
        "summary": "Edges that continue the same physical road are grouped into one "
                   "bucket and share a single road number.",
    },
    "ucs": {
        "label": "UCS cost ordering",
        "step": "Step 3",
        "summary": "Children are expanded in cheapest-cost-first order rather than "
                   "in plain traversal order.",
    },
    "GP": {
        "label": "Min-cut partitioning",
        "step": "Step 1",
        "summary": "The network is first split into well-connected partitions with a "
                   "minimum s-t cut; each partition is numbered before moving on.",
    },
}

_STEM_RE = re.compile(r"^(?P<family>[a-z]+?)(?:_(?P<mods>[A-Za-z]+))?(?:_d(?P<depth>\d+))?$")


def parse(stem: str) -> dict:
    """Describe one algorithm variant from its result-file stem.

    Unrecognised stems still return a usable record so an uploaded CSV with a
    novel name shows up in the UI instead of being dropped.
    """
    stem = stem.strip()
    match = _STEM_RE.match(stem)
    family_key = match.group("family") if match else stem.lower()
    mod_text = (match.group("mods") if match else None) or ""
    depth = int(match.group("depth")) if match and match.group("depth") else None

    family = FAMILIES.get(family_key)
    if family is None:
        family = {
            "label": stem.upper(),
            "full": stem,
            "summary": "Custom algorithm output supplied with the uploaded dataset.",
            "modified": True,
        }

    mods = _split_modifiers(mod_text)

    label = " + ".join([family["label"]] + [MODIFIERS[m]["label"] for m in mods])
    if depth is not None:
        label += f"  (depth step k={depth})"

    stages = []
    if "GP" in mods:
        stages.append(dict(MODIFIERS["GP"], key="GP"))
    if "B" in mods:
        stages.append(dict(MODIFIERS["B"], key="B"))
    search_summary = family["summary"]
    if depth is not None:
        search_summary += f" Depth limit grows in steps of k={depth}."
    stages.append({
        "key": family_key,
        "label": family["full"],
        "step": "Step 3",
        "summary": search_summary,
    })
    if "ucs" in mods:
        stages.append(dict(MODIFIERS["ucs"], key="ucs"))

    return {
        "id": stem,
        "label": label,
        "family": family_key,
        "family_label": family["label"],
        "family_full": family["full"],
        "summary": family["summary"],
        "modifiers": mods,
        "depth": depth,
        "is_baseline": not family["modified"],
        "partitioned": "GP" in mods,
        "bucketed": "B" in mods,
        "stages": stages,
    }


def _split_modifiers(text: str) -> list[str]:
    """Split a run-together modifier string such as ``BucsGP`` into its tokens."""
    found: list[str] = []
    i = 0
    while i < len(text):
        for key in ("ucs", "GP", "B"):  # longest / most specific first
            if text.startswith(key, i):
                found.append(key)
                i += len(key)
                break
        else:
            i += 1  # skip anything we do not recognise
    # Report in pipeline order regardless of how the filename spelled it.
    return [k for k in ("GP", "B", "ucs") if k in found]


def sort_key(stem: str) -> tuple:
    """Ordering for the algorithm picker: baselines last, families grouped."""
    info = parse(stem)
    family_order = {"mucs": 0, "middfs": 1, "mdfs": 2, "mbfs": 3, "bfs": 8, "dfs": 9}
    return (
        1 if info["is_baseline"] else 0,
        family_order.get(info["family"], 5),
        len(info["modifiers"]),
        info["depth"] if info["depth"] is not None else -1,
        stem,
    )
