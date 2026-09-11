"""Orchestrates the evaluation framework described in EVALUATION.md.

Builds the expensive per-network structures once (metric coordinates, spatial
neighbour lists, the line graph, the Hilbert reference), then scores any number
of algorithm outputs and reference baselines against them.

The metric catalogue is data, not code, so the interface can render the results
table generically and show each metric's direction and provenance rather than
presenting bare numbers.
"""

from __future__ import annotations

import threading
from typing import Any

from . import baselines, metrics
from .dataset import load_network, load_numbering
from .geometry import LocalFrame, hilbert_order, neighbours_within, polyline_midpoint
from .graph import LineGraph

DEFAULT_RADIUS = 250.0
DEFAULT_PERMUTATIONS = 199


# --------------------------------------------------------------------------
# Metric catalogue - drives the results table in the interface
# --------------------------------------------------------------------------

METRIC_CATALOGUE: list[dict[str, Any]] = [
    # -- corrected spatial statistics -------------------------------------
    {"key": "morans_i", "label": "Moran's I", "group": "Spatial autocorrelation",
     "better": "high", "format": "signed3",
     "summary": "Do nearby roads carry similar numbers? Scale-invariant, unlike "
                "the paper's Metric 1.",
     "source": "Moran (1950). Null expectation ≈ 0; higher is more clustered."},
    {"key": "morans_i_z", "label": "Moran's I (z)", "group": "Spatial autocorrelation",
     "better": "high", "format": "signed1",
     "summary": "Standard score of Moran's I against a permutation null that "
                "reuses the exact same multiset of numbers.",
     "source": "Permutation test; |z| > 2 is conventionally significant."},
    {"key": "morans_i_p", "label": "Moran's I (p)", "group": "Spatial autocorrelation",
     "better": "low", "format": "p",
     "summary": "Pseudo p-value from the permutation null.",
     "source": "(1 + #{null ≥ observed}) / (permutations + 1)."},
    {"key": "gearys_c", "label": "Geary's C", "group": "Spatial autocorrelation",
     "better": "low", "format": "num3",
     "summary": "Contiguity ratio; more sensitive to local differences than "
                "Moran's I. C < 1 means positive autocorrelation.",
     "source": "Geary (1954). The paper's Metric 1 is this statistic's numerator "
               "without its variance normalisation."},
    {"key": "morans_i_ns", "label": "Moran's I (N–S only)", "group": "Spatial autocorrelation",
     "better": "high", "format": "signed3",
     "summary": "Computed within North–South roads alone.",
     "source": "The odd/even rule interleaves two number systems; pooling them "
               "can reverse the ranking (EVALUATION.md §3.4)."},
    {"key": "morans_i_ew", "label": "Moran's I (E–W only)", "group": "Spatial autocorrelation",
     "better": "high", "format": "signed3",
     "summary": "Computed within East–West roads alone.",
     "source": "Stratified counterpart of the N–S value."},
    {"key": "mantel_r", "label": "Mantel r", "group": "Spatial autocorrelation",
     "better": "high", "format": "signed3",
     "summary": "Correlation between the geographic and numeric distance "
                "matrices. Needs no buffer radius at all.",
     "source": "Mantel (1967), with a permutation test."},

    # -- graph labelling ---------------------------------------------------
    {"key": "bandwidth", "label": "Bandwidth (norm.)", "group": "Graph labelling",
     "better": "low", "format": "num3",
     "summary": "Worst number gap between two roads meeting at a junction, as a "
                "fraction of the whole address space.",
     "source": "Cuthill & McKee (1969). Divided by the label span, because raw "
               "bandwidth would automatically favour schemes using fewer "
               "distinct numbers - the Metric 1 confound in another guise."},
    {"key": "bandwidth_vs_rcm", "label": "Bandwidth ÷ RCM", "group": "Graph labelling",
     "better": "low", "format": "num2",
     "summary": "Competitive ratio against Reverse Cuthill-McKee, on normalised "
                "bandwidth. Below 1.0 means beating the standard heuristic.",
     "source": "External benchmark, not a self-defined scale."},
    {"key": "profile", "label": "Profile (norm.)", "group": "Graph labelling",
     "better": "low", "format": "num3",
     "summary": "Mean distance from each road to its lowest-numbered neighbour, "
                "as a fraction of the address space; finer-grained than bandwidth.",
     "source": "Gibbs, Poole & Stockmeyer (1976)."},
    {"key": "distinct_labels", "label": "Distinct numbers", "group": "Graph labelling",
     "better": "none", "format": "int",
     "summary": "How many different road numbers the scheme actually uses.",
     "source": "Shown so the normalisation above can be checked at a glance."},

    # -- locality reference ------------------------------------------------
    {"key": "hilbert_stretch", "label": "Hilbert stretch", "group": "Locality",
     "better": "low", "format": "num2",
     "summary": "Neighbour number-gap relative to a Hilbert space-filling "
                "curve. 1.0 means matching the curve; below 1.0 beats it.",
     "source": "Moon et al. (2001) give the curve provable clustering bounds."},
    {"key": "predictability", "label": "Inference error", "group": "Locality",
     "better": "low", "format": "num3",
     "summary": "Median error when predicting a road's number from its six "
                "nearest neighbours, normalised by the number range.",
     "source": "Machine analogue of the human blank-filling task; the prime "
               "candidate for validation against human error."},

    # -- addresses ---------------------------------------------------------
    {"key": "contiguity", "label": "Bucket contiguity", "group": "Address quality",
     "better": "high", "format": "pct",
     "summary": "Fraction of road numbers whose segments form one connected "
                "street rather than scattered fragments.",
     "source": "A number naming three disconnected pieces of the city is not an "
               "address. Never measured in the original paper."},
    {"key": "multiplicity", "label": "Segments per number", "group": "Address quality",
     "better": "none", "format": "num2",
     "summary": "Mean segments sharing one address. Higher is not inherently "
                "worse - it is what bucketing is for - but it costs uniqueness.",
     "source": "Read together with contiguity and ambiguous arrivals."},
    {"key": "max_dispersion", "label": "Worst dispersion", "group": "Address quality",
     "better": "low", "format": "metres",
     "summary": "Greatest straight-line distance between two roads that share "
                "the same number.",
     "source": "Large values mean one address spans distant parts of the city."},
    {"key": "ari_vs_streets", "label": "ARI vs real streets", "group": "Address quality",
     "better": "high", "format": "num3",
     "summary": "Agreement between the algorithm's buckets and the real street "
                "names in the source data. External ground truth.",
     "source": "Adjusted Rand Index (Hubert & Arabie 1985); chance-corrected."},

    # -- task-based --------------------------------------------------------
    {"key": "greedy_success", "label": "Greedy routing success", "group": "Task performance",
     "better": "high", "format": "pct",
     "summary": "Share of journeys completed by always stepping to the "
                "neighbour whose number is closest to the destination's.",
     "source": "Greedy-embedding test from the geometric routing literature "
               "(Papadimitriou & Ratajczak 2005)."},
    {"key": "greedy_stretch", "label": "Routing stretch", "group": "Task performance",
     "better": "low", "format": "num2",
     "summary": "Hops taken by number-following, divided by the shortest path. "
                "1.0 means numbers route perfectly.",
     "source": "Computed over successful journeys only."},
    {"key": "ambiguous_arrivals", "label": "Ambiguous arrivals", "group": "Task performance",
     "better": "low", "format": "pct",
     "summary": "Share of successful journeys that ended on a different road "
                "that happens to carry the same number.",
     "source": "The concrete cost of non-unique addresses."},
    {"key": "tour_ratio", "label": "Delivery tour ratio", "group": "Task performance",
     "better": "low", "format": "num3",
     "summary": "Length of a round visiting addresses in numeric order, over a "
                "2-opt optimised tour of the same stops.",
     "source": "Bartholdi & Platzman (1982) report ≈ 1.25 for a space-filling "
               "curve ordering, so that is the bar."},

    # -- the paper's own metrics ------------------------------------------
    {"key": "paper_m1", "label": "Paper Metric 1", "group": "Original paper (for comparison)",
     "better": "low", "format": "num2",
     "summary": "Mean absolute number difference within the buffer, exactly as "
                "published.",
     "source": "⚠ Not scale-invariant. Correlates ρ ≈ 0.95–0.97 with the number "
               "range, and is near-uncorrelated with Moran's I."},
    {"key": "number_range", "label": "Number range", "group": "Original paper (for comparison)",
     "better": "none", "format": "int",
     "summary": "Highest minus lowest road number assigned.",
     "source": "Shown because it, not spatial quality, is what drives Metric 1."},
    {"key": "paper_m3", "label": "Paper Metric 3", "group": "Original paper (for comparison)",
     "better": "low", "format": "num2",
     "summary": "Mean of sqrt(hop distance × number gap) over road pairs.",
     "source": "Shares Metric 1's scale dependence."},
]


# --------------------------------------------------------------------------
# Per-network context
# --------------------------------------------------------------------------

class NetworkContext:
    """Everything the metrics need, computed once per (network, radius)."""

    def __init__(self, net_path: str, radius: float = DEFAULT_RADIUS,
                 neighbour_mode: str = "geometry"):
        self.radius = radius
        self.neighbour_mode = neighbour_mode

        network = load_network(net_path)
        features = network["roads"]["features"]
        if not features:
            raise ValueError("network has no road geometry")

        self.frame = LocalFrame.from_points(
            [f["geometry"]["coordinates"][0] for f in features])

        self.geometry: dict[int, list] = {}
        self.positions: dict[int, tuple[float, float]] = {}
        self.orientation: dict[int, str | None] = {}
        self.street_name: dict[int, str] = {}
        endpoints: dict[int, tuple] = {}

        for feature in features:
            props = feature["properties"]
            seg = props["road_id"]
            coords = [self.frame.to_metres(lon, lat)
                      for lon, lat in feature["geometry"]["coordinates"]]
            self.geometry[seg] = coords
            self.positions[seg] = polyline_midpoint(coords)
            self.orientation[seg] = props.get("orientation")
            endpoints[seg] = (props.get("source"), props.get("target"))
            if props.get("name"):
                self.street_name[seg] = str(props["name"])

        self.segments = list(self.geometry)
        self.graph = LineGraph(endpoints)
        self.weights = neighbours_within(self.geometry, radius, neighbour_mode)
        self.stats = network["stats"]
        self.crs = network["crs"]

        # Street names are only usable ground truth when they actually vary;
        # see the caveat in EVALUATION.md section 4.5.
        self.ground_truth_available = self.stats.get("names_useful", False)

        self._hilbert: metrics.Numbering | None = None
        self._rcm_bandwidth: int | None = None

    def hilbert_numbering(self) -> metrics.Numbering:
        if self._hilbert is None:
            self._hilbert = metrics.ordering_to_numbering(hilbert_order(self.positions))
        return self._hilbert

    def rcm_bandwidth(self) -> float | None:
        """Reverse Cuthill-McKee's normalised bandwidth, the comparison point."""
        if self._rcm_bandwidth is None:
            numbering = baselines.build(
                "rcm", segments=self.segments, positions=self.positions,
                graph=self.graph, orientation=self.orientation)
            result = metrics.bandwidth_profile(numbering, self.graph)
            self._rcm_bandwidth = (result.get("normalised_bandwidth")
                                   if result.get("available") else None)
        return self._rcm_bandwidth

    def summary(self) -> dict:
        degrees = [len(v) for v in self.weights.values()]
        return {
            "segments": len(self.segments),
            "line_graph_edges": self.graph.edge_count,
            "components": len(self.graph.components()),
            "mean_spatial_neighbours": (sum(degrees) / len(degrees)) if degrees else 0,
            "isolated_segments": sum(1 for d in degrees if d == 0),
            "radius_m": self.radius,
            "neighbour_mode": self.neighbour_mode,
            "ground_truth_available": self.ground_truth_available,
            "named_segments": len(self.street_name),
            "distinct_street_names": len(set(self.street_name.values())),
            "crs": self.crs,
        }


# --------------------------------------------------------------------------
# Scoring one numbering
# --------------------------------------------------------------------------

def score(context: NetworkContext, numbering: metrics.Numbering,
          partitions: dict[int, int] | None = None,
          permutations: int = DEFAULT_PERMUTATIONS,
          seed: int = 0) -> dict:
    """Run every applicable metric against one numbering."""
    numbering = {k: v for k, v in numbering.items() if k in context.geometry}
    values = list(numbering.values())
    if len(values) < 3:
        return {"available": False, "reason": "fewer than three numbered roads"}

    auto = metrics.autocorrelation_block(
        numbering, context.weights, permutations=permutations, seed=seed)
    stratified = metrics.stratified_morans_i(
        numbering, context.weights, context.orientation)
    mantel = metrics.mantel(numbering, context.positions,
                            permutations=max(99, permutations // 2), seed=seed)
    band = metrics.bandwidth_profile(numbering, context.graph)
    stretch = metrics.locality_stretch(numbering, context.hilbert_numbering(),
                                       context.weights)
    predict = metrics.predictability(numbering, context.positions)
    address = metrics.address_quality(numbering, context.graph,
                                      context.positions, partitions)
    routing = metrics.greedy_routing(numbering, context.graph, seed=seed)
    tour = metrics.delivery_tour(numbering, context.positions, seed=seed)
    paper23 = metrics.paper_metrics_2_3(numbering, context.graph, seed=seed)

    ground_truth = None
    if context.ground_truth_available:
        buckets = {seg: (partitions.get(seg) if partitions else None, num)
                   for seg, num in numbering.items()}
        ground_truth = metrics.clustering_agreement(buckets, context.street_name)

    rcm_bw = context.rcm_bandwidth()
    bandwidth = band.get("normalised_bandwidth") if band.get("available") else None

    values_out: dict[str, Any] = {
        "morans_i": auto.get("morans_i"),
        "morans_i_z": (auto.get("morans_i_test") or {}).get("z"),
        "morans_i_p": (auto.get("morans_i_test") or {}).get("p"),
        "gearys_c": auto.get("gearys_c"),
        "morans_i_ns": stratified.get("NS"),
        "morans_i_ew": stratified.get("EW"),
        "mantel_r": mantel.get("r") if mantel.get("available") else None,
        "bandwidth": bandwidth,
        "bandwidth_vs_rcm": (bandwidth / rcm_bw) if (bandwidth and rcm_bw) else None,
        "profile": (band.get("normalised_profile") if band.get("available") else None),
        "distinct_labels": band.get("distinct_labels") if band.get("available") else None,
        "hilbert_stretch": stretch.get("stretch") if stretch.get("available") else None,
        "predictability": (predict.get("median_normalised_error")
                           if predict.get("available") else None),
        "contiguity": address.get("contiguity") if address.get("available") else None,
        "multiplicity": address.get("multiplicity") if address.get("available") else None,
        "max_dispersion": (address.get("max_dispersion_m")
                           if address.get("available") else None),
        "ari_vs_streets": (ground_truth or {}).get("ari"),
        "greedy_success": routing.get("success_rate") if routing.get("available") else None,
        "greedy_stretch": routing.get("mean_stretch") if routing.get("available") else None,
        "ambiguous_arrivals": (routing.get("ambiguous_arrival_rate")
                               if routing.get("available") else None),
        "tour_ratio": tour.get("mean_ratio") if tour.get("available") else None,
        "paper_m1": metrics.paper_metric_1(numbering, context.weights),
        "number_range": max(values) - min(values),
        "paper_m3": (paper23.get("metric3_mean_score")
                     if paper23.get("available") else None),
    }

    return {
        "available": True,
        "values": values_out,
        "detail": {
            "autocorrelation": auto,
            "mantel": mantel,
            "bandwidth": band,
            "locality": stretch,
            "predictability": predict,
            "address": address,
            "routing": routing,
            "tour": tour,
            "paper_metrics_2_3": paper23,
            "ground_truth": ground_truth,
        },
    }


# --------------------------------------------------------------------------
# Evaluator with caching
# --------------------------------------------------------------------------

class Evaluator:
    """Caches network contexts and per-row results across requests."""

    def __init__(self) -> None:
        self._contexts: dict[tuple, NetworkContext] = {}
        self._rows: dict[tuple, dict] = {}
        self._lock = threading.Lock()

    def context(self, net_path: str, radius: float,
                neighbour_mode: str) -> NetworkContext:
        key = (net_path, radius, neighbour_mode)
        with self._lock:
            hit = self._contexts.get(key)
        if hit is not None:
            return hit
        built = NetworkContext(net_path, radius, neighbour_mode)
        with self._lock:
            self._contexts[key] = built
        return built

    def evaluate_row(self, dataset: dict, row_id: str, *, radius: float,
                     neighbour_mode: str, permutations: int) -> dict:
        """Score one algorithm output or one reference baseline."""
        cache_key = (dataset["path"], row_id, radius, neighbour_mode, permutations)
        with self._lock:
            hit = self._rows.get(cache_key)
        if hit is not None:
            return hit

        context = self.context(dataset["path"], radius, neighbour_mode)

        if row_id.startswith("baseline:"):
            key = row_id.split(":", 1)[1]
            meta = baselines.BASELINES.get(key)
            if meta is None:
                raise KeyError(f"unknown baseline '{key}'")
            numbering = baselines.build(
                key, segments=context.segments, positions=context.positions,
                graph=context.graph, orientation=context.orientation)
            partitions = None
            label = meta["label"]
            kind = "baseline"
            info = {"role": meta["role"], "summary": meta["summary"]}
        else:
            if not dataset.get("results_path"):
                raise KeyError("dataset has no result files")
            result = load_numbering(dataset["results_path"], row_id,
                                    set(context.segments))
            numbering = {int(k): v["road_no"]
                         for k, v in result["numbering"].items()
                         if not v.get("unassigned")}
            partitions = {int(k): v["partition"]
                          for k, v in result["numbering"].items()
                          if v.get("partition") is not None} or None
            label = result["label"]
            kind = "algorithm"
            info = {"summary": result["summary"],
                    "is_baseline": result["is_baseline"],
                    "unassigned": result["stats"].get("unassigned", 0)}

        scored = score(context, numbering, partitions, permutations=permutations)
        row = {"id": row_id, "label": label, "kind": kind, "info": info, **scored}

        with self._lock:
            self._rows[cache_key] = row
        return row

    def invalidate(self) -> None:
        with self._lock:
            self._contexts.clear()
            self._rows.clear()


def range_confound(rows: list[dict]) -> dict:
    """Spearman correlations that expose why Metric 1 must not be used alone.

    Across the evaluated rows, correlate the paper's Metric 1 with the number
    range and with Moran's I. On the bundled data the former runs at about
    +0.95 to +0.97 and the latter near zero, which is the central empirical
    claim of EVALUATION.md section 2.1.
    """
    usable = [r for r in rows
              if r.get("available")
              and r["values"].get("paper_m1") is not None
              and r["values"].get("number_range") is not None
              and r["values"].get("morans_i") is not None]
    if len(usable) < 4:
        return {"available": False, "reason": "need at least four evaluated rows"}

    m1 = [r["values"]["paper_m1"] for r in usable]
    rng = [r["values"]["number_range"] for r in usable]
    moran = [r["values"]["morans_i"] for r in usable]
    return {
        "available": True,
        "rows": len(usable),
        "metric1_vs_range": metrics.spearman(m1, rng),
        "metric1_vs_morans_i": metrics.spearman(m1, moran),
    }
