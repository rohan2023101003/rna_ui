"""Self-tests for the evaluation metrics.

Checks each implementation against a value that is known independently: the
worked 3x3 lattice of EVALUATION.md section 3, textbook null expectations,
closed-form results on degenerate inputs, and invariants that must hold for any
correct implementation (scale invariance, symmetry, bounds).

    python3 analysis/test_metrics.py
"""

from __future__ import annotations

import math
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
os.chdir(ROOT)

from rna import baselines, metrics
from rna.geometry import (GridIndex, hilbert_index, hilbert_order,
                          neighbours_within, point_segment_distance,
                          polyline_midpoint, segment_segment_distance)
from rna.graph import LineGraph, cuthill_mckee, fiedler_order

PASS = FAIL = 0


def check(name: str, got, want, tol: float = 1e-9) -> None:
    global PASS, FAIL
    if isinstance(want, float) and isinstance(got, (int, float)) and got is not None:
        ok = abs(got - want) <= tol
    else:
        ok = got == want
    if ok:
        PASS += 1
        print(f"  ok   {name}")
    else:
        FAIL += 1
        print(f"  FAIL {name}: got {got!r}, want {want!r}")


def check_true(name: str, condition: bool, detail: str = "") -> None:
    global PASS, FAIL
    if condition:
        PASS += 1
        print(f"  ok   {name}")
    else:
        FAIL += 1
        print(f"  FAIL {name} {detail}")


# --------------------------------------------------------------------------
# The 3x3 lattice from EVALUATION.md section 3
# --------------------------------------------------------------------------

NODES = {1: (0, 0), 2: (100, 0), 3: (200, 0), 4: (0, 100), 5: (100, 100),
         6: (200, 100), 7: (0, 200), 8: (100, 200), 9: (200, 200)}
EDGES = {1: (1, 2, "EW"), 2: (2, 3, "EW"), 3: (4, 5, "EW"), 4: (5, 6, "EW"),
         5: (7, 8, "EW"), 6: (8, 9, "EW"), 7: (1, 4, "NS"), 8: (4, 7, "NS"),
         9: (2, 5, "NS"), 10: (5, 8, "NS"), 11: (3, 6, "NS"), 12: (6, 9, "NS")}

GEOM = {e: [NODES[a], NODES[b]] for e, (a, b, _) in EDGES.items()}
ORIENT = {e: o for e, (_, _, o) in EDGES.items()}
POS = {e: polyline_midpoint(g) for e, g in GEOM.items()}
GRAPH = LineGraph({e: (a, b) for e, (a, b, _) in EDGES.items()})

A = {1: 2, 2: 2, 3: 4, 4: 4, 5: 6, 6: 6, 7: 1, 8: 1, 9: 3, 10: 3, 11: 5, 12: 5}
A2 = {k: 2 * v for k, v in A.items()}
B = {1: 2, 2: 4, 3: 6, 4: 8, 5: 10, 6: 12, 7: 1, 8: 5, 9: 3, 10: 9, 11: 7, 12: 11}

# Midpoint mode with r=120 reproduces the neighbour sets used in the document.
W = neighbours_within(GEOM, 120.0, mode="midpoint")


print("Geometry primitives")
check("point-segment distance (perpendicular)",
      point_segment_distance((0, 5), (-10, 0), (10, 0)), 5.0)
check("point-segment distance (beyond endpoint)",
      point_segment_distance((20, 0), (-10, 0), (10, 0)), 10.0)
check("segment-segment distance (crossing)",
      segment_segment_distance((-1, 0), (1, 0), (0, -1), (0, 1)), 0.0)
check("segment-segment distance (parallel)",
      segment_segment_distance((0, 0), (10, 0), (0, 3), (10, 3)), 3.0)
check("polyline midpoint by arc length",
      polyline_midpoint([(0, 0), (10, 0), (10, 10)]), (10.0, 0.0))
check("hilbert index of origin", hilbert_index(0, 0, 4), 0)
check_true("hilbert indices are a bijection",
           len({hilbert_index(x, y, 3) for x in range(8) for y in range(8)}) == 64)
_curve = sorted(((x, y) for x in range(8) for y in range(8)),
                key=lambda t: hilbert_index(t[0], t[1], 3))
check_true("hilbert successive cells are adjacent",
           all(abs(p[0] - q[0]) + abs(p[1] - q[1]) == 1
               for p, q in zip(_curve, _curve[1:])))

print("\nNeighbour construction")
check("neighbour count for e1", len(W[1]), 4)
check("neighbour count for e3", len(W[3]), 7)
check("total ordered neighbour pairs", sum(len(v) for v in W.values()), 60)
check_true("neighbour relation is symmetric",
           all(u in W[v] for u in W for v in W[u]))
check_true("no self-neighbours", all(u not in W[u] for u in W))

print("\nLine graph")
check("line graph node count", len(GRAPH), 12)
check("e1 adjacency", sorted(GRAPH.adj[1]), [2, 7, 9])
check("e3 adjacency", sorted(GRAPH.adj[3]), [4, 7, 8, 9, 10])
check("graph is connected", len(GRAPH.components()), 1)
check("hop distance e1 to e6", GRAPH.bfs_hops(1)[6], 3)

print("\nSpatial autocorrelation vs EVALUATION.md section 3.3 (binary weights)")
check("Metric 1 of A", metrics.paper_metric_1(A, W), 1.5595238095238095, 1e-9)
check("Metric 1 of A-doubled", metrics.paper_metric_1(A2, W), 3.119047619047619, 1e-9)
check("Metric 1 of B", metrics.paper_metric_1(B, W), 2.8333333333333335, 1e-9)
check("Moran's I of A", metrics.morans_i(A, W, row_standardised=False), 0.17714285714285713, 1e-9)
check("Moran's I of B", metrics.morans_i(B, W, row_standardised=False), 0.45174825174825177, 1e-9)
check("Geary's C of A", metrics.gearys_c(A, W, row_standardised=False), 0.5866666666666667, 1e-9)
check("Geary's C of B", metrics.gearys_c(B, W, row_standardised=False), 0.4, 1e-9)

print("\nScale invariance (the central claim of EVALUATION.md section 2.1)")
check_true("Metric 1 IS scale-dependent (the defect)",
           abs(metrics.paper_metric_1(A2, W) - 2 * metrics.paper_metric_1(A, W)) < 1e-9)
check("Moran's I is scale-invariant",
      metrics.morans_i(A2, W, row_standardised=False),
      metrics.morans_i(A, W, row_standardised=False), 1e-12)
check("Geary's C is scale-invariant",
      metrics.gearys_c(A2, W, row_standardised=False),
      metrics.gearys_c(A, W, row_standardised=False), 1e-12)
shifted = {k: v + 1000 for k, v in A.items()}
check("Moran's I is translation-invariant",
      metrics.morans_i(shifted, W, row_standardised=False),
      metrics.morans_i(A, W, row_standardised=False), 1e-12)

print("\nFused permutation path agrees with the direct implementation")
for name, numbering in (("A", A), ("B", B)):
    for row_std in (True, False):
        units = metrics._valid_units(numbering, W)
        flat, offsets = metrics._flatten_weights(units, W)
        fused_i, fused_c = metrics._fused_statistics(
            [float(numbering[u]) for u in units], flat, offsets, row_std)
        check(f"fused Moran {name} (row_std={row_std})",
              fused_i, metrics.morans_i(numbering, W, row_std), 1e-12)
        check(f"fused Geary {name} (row_std={row_std})",
              fused_c, metrics.gearys_c(numbering, W, row_std), 1e-12)

print("\nStratified Moran's I vs EVALUATION.md section 3.4")
sa = metrics.stratified_morans_i(A, W, ORIENT, row_standardised=False)
sb = metrics.stratified_morans_i(B, W, ORIENT, row_standardised=False)
check("A, N-S stratum", sa["NS"], 0.42857142857142855, 1e-9)
check("A, E-W stratum", sa["EW"], 0.42857142857142855, 1e-9)
check("B, N-S stratum", sb["NS"], 0.30612244897959173, 1e-9)
check("B, E-W stratum", sb["EW"], 0.40408163265306124, 1e-9)

print("\nPermutation null")
block = metrics.autocorrelation_block(A, W, permutations=499, seed=1,
                                      row_standardised=False)
check_true("observed I matches the direct computation",
           abs(block["morans_i"] - metrics.morans_i(A, W, False)) < 1e-12)
check("null expectation of I", block["expected_i_null"], -1 / 11, 1e-12)
check_true("permutation null mean is near the theoretical expectation",
           abs(block["morans_i_test"]["null_mean"] - (-1 / 11)) < 0.05,
           f"got {block['morans_i_test']['null_mean']}")
check_true("p-value is a valid probability",
           0 < block["morans_i_test"]["p"] <= 1)

print("\nDense ranking")
check("dense rank collapses ties",
      metrics.dense_rank({1: 5, 2: 5, 3: 9, 4: 1}), {1: 2, 2: 2, 3: 3, 4: 1})
check("dense rank of a permutation is itself",
      metrics.dense_rank({1: 1, 2: 2, 3: 3}), {1: 1, 2: 2, 3: 3})

print("\nBandwidth and profile")
line = LineGraph({i: (i, i + 1) for i in range(1, 6)})  # a path of 5 segments
ideal = {i: i for i in range(1, 6)}
check("bandwidth of the natural ordering on a path",
      metrics.bandwidth_profile(ideal, line)["bandwidth"], 1)
worst = {1: 1, 2: 5, 3: 2, 4: 4, 5: 3}
check_true("a scrambled ordering has larger bandwidth",
           metrics.bandwidth_profile(worst, line)["bandwidth"] > 1)
check_true("bandwidth is invariant to a constant shift",
           metrics.bandwidth_profile({k: v + 100 for k, v in ideal.items()},
                                     line)["bandwidth"] == 1)
check("normalised bandwidth divides by the label span",
      metrics.bandwidth_profile(ideal, line)["normalised_bandwidth"], 0.25, 1e-12)
# A scheme with fewer distinct labels must not win by default: two labels on a
# path give raw bandwidth 1, but normalised bandwidth 1.0 - the worst possible.
coarse = {1: 1, 2: 1, 3: 1, 4: 2, 5: 2}
check("raw bandwidth flatters a coarse labelling",
      metrics.bandwidth_profile(coarse, line)["bandwidth"], 1)
check("normalised bandwidth exposes it",
      metrics.bandwidth_profile(coarse, line)["normalised_bandwidth"], 1.0, 1e-12)
check("distinct label count is reported",
      metrics.bandwidth_profile(coarse, line)["distinct_labels"], 2)

print("\nAddress quality")
contiguous = {1: 1, 2: 1, 3: 2, 4: 2, 5: 3, 6: 3, 7: 4, 8: 4, 9: 5, 10: 5, 11: 6, 12: 6}
aq = metrics.address_quality(contiguous, GRAPH, POS)
check("A groups 12 segments into 6 addresses", aq["address_classes"], 6)
check("mean segments per address", aq["multiplicity"], 2.0, 1e-12)
scattered = {1: 1, 2: 1, 3: 2, 4: 2, 5: 2, 6: 2, 7: 3, 8: 3, 9: 3, 10: 3, 11: 1, 12: 1}
check_true("scattered buckets score lower contiguity than contiguous ones",
           metrics.address_quality(scattered, GRAPH, POS)["contiguity"] <= aq["contiguity"])
unique = {k: k for k in EDGES}
check("all-unique numbering is perfectly contiguous",
      metrics.address_quality(unique, GRAPH, POS)["contiguity"], 1.0, 1e-12)

print("\nClustering agreement")
truth = {i: ("x" if i <= 6 else "y") for i in range(1, 13)}
check("ARI of an identical partition",
      metrics.clustering_agreement(dict(truth), truth)["ari"], 1.0, 1e-9)
check("NMI of an identical partition",
      metrics.clustering_agreement(dict(truth), truth)["nmi"], 1.0, 1e-9)
relabelled = {i: (0 if v == "x" else 1) for i, v in truth.items()}
check("ARI is invariant to relabelling",
      metrics.clustering_agreement(relabelled, truth)["ari"], 1.0, 1e-9)

print("\nSpearman correlation")
check("perfect positive", metrics.spearman([1, 2, 3, 4], [10, 20, 30, 40]), 1.0, 1e-12)
check("perfect negative", metrics.spearman([1, 2, 3, 4], [40, 30, 20, 10]), -1.0, 1e-12)
check("monotone but nonlinear is still 1",
      metrics.spearman([1, 2, 3, 4], [1, 4, 9, 16]), 1.0, 1e-12)

print("\nGreedy routing")
path_graph = LineGraph({i: (i, i + 1) for i in range(1, 11)})
route = metrics.greedy_routing({i: i for i in range(1, 11)}, path_graph,
                               samples=200, seed=3)
check("a monotone numbering on a path routes perfectly",
      route["success_rate"], 1.0, 1e-12)
check("and with no detour", route["mean_stretch"], 1.0, 1e-9)

print("\nBaselines")
for key in baselines.BASELINES:
    numbering = baselines.build(key, segments=list(EDGES), positions=POS,
                                graph=GRAPH, orientation=ORIENT)
    check_true(f"{key}: numbers every segment", len(numbering) == 12)
    check_true(f"{key}: assigns distinct numbers",
               len(set(numbering.values())) == 12)
parity = baselines.build("hilbert_parity", segments=list(EDGES), positions=POS,
                         graph=GRAPH, orientation=ORIENT)
check_true("hilbert_parity gives N-S roads odd numbers",
           all(parity[e] % 2 == 1 for e in EDGES if ORIENT[e] == "NS"))
check_true("hilbert_parity gives E-W roads even numbers",
           all(parity[e] % 2 == 0 for e in EDGES if ORIENT[e] == "EW"))

print("\nOrderings")
rcm = cuthill_mckee(GRAPH)
check_true("RCM visits every segment once", sorted(rcm) == sorted(EDGES))
bw_rcm = metrics.bandwidth_profile(metrics.ordering_to_numbering(rcm), GRAPH)["bandwidth"]
bw_rand = metrics.bandwidth_profile({1: 1, 2: 12, 3: 2, 4: 11, 5: 3, 6: 10,
                                     7: 4, 8: 9, 9: 5, 10: 8, 11: 6, 12: 7},
                                    GRAPH)["bandwidth"]
check_true(f"RCM bandwidth ({bw_rcm}) beats a scrambled ordering ({bw_rand})",
           bw_rcm <= bw_rand)
fied = fiedler_order(GRAPH)
check_true("Fiedler ordering covers every segment", sorted(fied) == sorted(EDGES))

print("\nDegenerate inputs are handled, not crashed on")
check("constant numbering yields no Moran's I", metrics.morans_i({k: 7 for k in EDGES}, W), None)
check_true("empty numbering is reported unavailable",
           metrics.autocorrelation_block({}, W)["available"] is False)
check_true("single-value numbering is reported unavailable",
           metrics.predictability({k: 3 for k in EDGES}, POS)["available"] is False)

print(f"\n{'=' * 58}\n  {PASS} passed, {FAIL} failed\n{'=' * 58}")
sys.exit(1 if FAIL else 0)
