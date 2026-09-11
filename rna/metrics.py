"""Evaluation metrics for road-numbering schemes.

Implements the framework in EVALUATION.md. Each metric records, alongside its
value, whether higher or lower is better and where it comes from, so the
interface can present it honestly rather than as an unexplained number.

A recurring theme: several metrics are only meaningful on a *rank-normalised*
numbering. The IGARSS'25 Metric 1 is not scale-invariant - a scheme using the
integers 1-17 beats one using 1-201 on identical spatial structure - so any
measure built on raw numeric differences is confounded with how many distinct
numbers an algorithm happened to use. Where that applies, the numbering is
converted to dense ranks first, and the docstring says so.
"""

from __future__ import annotations

import math
import random
import statistics
from typing import Callable, Sequence

from .geometry import Point, polyline_midpoint
from .graph import LineGraph

Numbering = dict[int, int]
Weights = dict[int, list[int]]


# --------------------------------------------------------------------------
# Small statistical helpers
# --------------------------------------------------------------------------

def dense_rank(numbering: Numbering) -> dict[int, int]:
    """Map a numbering onto 1..k, preserving order and collapsing ties.

    This is what makes schemes with different number ranges comparable.
    """
    order = sorted(set(numbering.values()))
    rank = {value: i + 1 for i, value in enumerate(order)}
    return {k: rank[v] for k, v in numbering.items()}


def spearman(a: Sequence[float], b: Sequence[float]) -> float:
    """Spearman rank correlation, with midranks for ties."""
    if len(a) < 3:
        return float("nan")

    def ranks(values: Sequence[float]) -> list[float]:
        order = sorted(range(len(values)), key=lambda i: values[i])
        out = [0.0] * len(values)
        i = 0
        while i < len(order):
            j = i
            while j + 1 < len(order) and values[order[j + 1]] == values[order[i]]:
                j += 1
            mid = (i + j) / 2 + 1
            for k in range(i, j + 1):
                out[order[k]] = mid
            i = j + 1
        return out

    ra, rb = ranks(a), ranks(b)
    return _pearson(ra, rb)


def _pearson(a: Sequence[float], b: Sequence[float]) -> float:
    n = len(a)
    if n < 2:
        return float("nan")
    ma, mb = statistics.fmean(a), statistics.fmean(b)
    num = sum((a[i] - ma) * (b[i] - mb) for i in range(n))
    da = math.sqrt(sum((x - ma) ** 2 for x in a))
    db = math.sqrt(sum((x - mb) ** 2 for x in b))
    return num / (da * db) if da and db else float("nan")


def _permutation_summary(observed: float, samples: list[float],
                         lower_is_clustered: bool) -> dict:
    """z-score and pseudo p-value of an observed statistic against a null."""
    if not samples:
        return {"z": None, "p": None, "null_mean": None, "null_sd": None}
    mean = statistics.fmean(samples)
    sd = statistics.pstdev(samples)
    z = (observed - mean) / sd if sd > 0 else None
    if lower_is_clustered:
        extreme = sum(1 for s in samples if s <= observed)
    else:
        extreme = sum(1 for s in samples if s >= observed)
    return {
        "z": z,
        "p": (1 + extreme) / (len(samples) + 1),
        "null_mean": mean,
        "null_sd": sd,
    }


# --------------------------------------------------------------------------
# Spatial autocorrelation  (EVALUATION.md section 4.1)
# --------------------------------------------------------------------------

def _valid_units(numbering: Numbering, weights: Weights) -> list[int]:
    """Segments that carry a number and have at least one numbered neighbour."""
    return [u for u in weights
            if u in numbering and any(v in numbering for v in weights[u])]


def morans_i(numbering: Numbering, weights: Weights,
             row_standardised: bool = True) -> float | None:
    """Moran's I (Moran 1950): spatial autocorrelation of the number field.

    Higher means nearby roads carry similar numbers. Under the null of no
    spatial pattern, E[I] = -1/(n-1).

    With ``row_standardised`` each segment's neighbours are weighted 1/k, which
    is the usual default and keeps I close to [-1, 1]. Binary weights reproduce
    the worked example in EVALUATION.md section 3.3.
    """
    units = _valid_units(numbering, weights)
    n = len(units)
    if n < 3:
        return None
    values = {u: numbering[u] for u in units}
    mean = statistics.fmean(values.values())
    dev = {u: values[u] - mean for u in units}
    denom = sum(d * d for d in dev.values())
    if denom == 0:
        return None

    num = 0.0
    total_weight = 0.0
    for u in units:
        nbrs = [v for v in weights[u] if v in values]
        if not nbrs:
            continue
        if row_standardised:
            w = 1.0 / len(nbrs)
            num += dev[u] * sum(dev[v] for v in nbrs) * w
            total_weight += 1.0
        else:
            num += dev[u] * sum(dev[v] for v in nbrs)
            total_weight += len(nbrs)
    if total_weight == 0:
        return None
    return (n / total_weight) * (num / denom)


def gearys_c(numbering: Numbering, weights: Weights,
             row_standardised: bool = True) -> float | None:
    """Geary's C (Geary 1954): contiguity ratio, sensitive to local difference.

    C < 1 indicates positive spatial autocorrelation, C = 1 none, C > 1
    negative. **Lower is better** for a road numbering.

    Note for the paper: the IGARSS'25 Metric 1 is structurally the numerator of
    this statistic with |x_i - x_j| in place of (x_i - x_j)^2 and *without* the
    variance term in the denominator - which is exactly the part that makes C
    scale-invariant.
    """
    units = _valid_units(numbering, weights)
    n = len(units)
    if n < 3:
        return None
    values = {u: numbering[u] for u in units}
    mean = statistics.fmean(values.values())
    denom = sum((values[u] - mean) ** 2 for u in units)
    if denom == 0:
        return None

    num = 0.0
    total_weight = 0.0
    for u in units:
        nbrs = [v for v in weights[u] if v in values]
        if not nbrs:
            continue
        w = 1.0 / len(nbrs) if row_standardised else 1.0
        num += w * sum((values[u] - values[v]) ** 2 for v in nbrs)
        total_weight += w * len(nbrs)
    if total_weight == 0:
        return None
    return ((n - 1) * num) / (2 * total_weight * denom)


def _flatten_weights(units: list[int], weights: Weights
                     ) -> tuple[list[int], list[int]]:
    """Compact neighbour lists into (flat, offsets) index arrays.

    The permutation test evaluates the same neighbour structure hundreds of
    times, so it is worth paying once to strip out the dictionary lookups.
    """
    index = {u: i for i, u in enumerate(units)}
    flat: list[int] = []
    offsets = [0]
    for u in units:
        flat.extend(index[v] for v in weights[u] if v in index)
        offsets.append(len(flat))
    return flat, offsets


def _fused_statistics(values: list[float], flat: list[int], offsets: list[int],
                      row_standardised: bool) -> tuple[float | None, float | None]:
    """Moran's I and Geary's C in a single pass over the neighbour arrays."""
    n = len(values)
    mean = sum(values) / n
    dev = [v - mean for v in values]
    denom = 0.0
    for d in dev:
        denom += d * d
    if denom == 0.0:
        return None, None

    num_i = num_c = weight_i = weight_c = 0.0
    for i in range(n):
        start, end = offsets[i], offsets[i + 1]
        k = end - start
        if k == 0:
            continue
        vi = values[i]
        sum_dev = 0.0
        sum_sq = 0.0
        for p in range(start, end):
            j = flat[p]
            sum_dev += dev[j]
            diff = vi - values[j]
            sum_sq += diff * diff
        if row_standardised:
            num_i += dev[i] * sum_dev / k
            num_c += sum_sq / k
            weight_i += 1.0
            weight_c += 1.0
        else:
            num_i += dev[i] * sum_dev
            num_c += sum_sq
            weight_i += k
            weight_c += k

    if weight_i == 0.0 or weight_c == 0.0:
        return None, None
    morans = (n / weight_i) * (num_i / denom)
    geary = ((n - 1) * num_c) / (2 * weight_c * denom)
    return morans, geary


def autocorrelation_block(numbering: Numbering, weights: Weights,
                          permutations: int = 199, seed: int = 0,
                          row_standardised: bool = True) -> dict:
    """Moran's I and Geary's C, each with a permutation null.

    The null reassigns the *same multiset of numbers* across segments, so the
    number range, the tie structure and the bucket sizes are held exactly fixed.
    That makes the range confound of EVALUATION.md section 2.1 impossible by
    construction, which is precisely why the permutation test matters here.
    """
    units = _valid_units(numbering, weights)
    if len(units) < 3:
        return {"available": False, "reason": "too few connected segments"}

    flat, offsets = _flatten_weights(units, weights)
    values = [float(numbering[u]) for u in units]
    observed_i, observed_c = _fused_statistics(values, flat, offsets, row_standardised)
    if observed_i is None or observed_c is None:
        return {"available": False, "reason": "numbering has zero variance"}

    rng = random.Random(seed)
    null_i: list[float] = []
    null_c: list[float] = []
    shuffled = list(values)
    for _ in range(permutations):
        rng.shuffle(shuffled)
        i_val, c_val = _fused_statistics(shuffled, flat, offsets, row_standardised)
        if i_val is not None:
            null_i.append(i_val)
        if c_val is not None:
            null_c.append(c_val)

    return {
        "available": True,
        "n": len(units),
        "expected_i_null": -1.0 / (len(units) - 1),
        "morans_i": observed_i,
        "morans_i_test": _permutation_summary(observed_i, null_i, False),
        "gearys_c": observed_c,
        "gearys_c_test": _permutation_summary(observed_c, null_c, True),
        "permutations": permutations,
        "weights": "row-standardised" if row_standardised else "binary",
    }


def stratified_morans_i(numbering: Numbering, weights: Weights,
                        orientation: dict[int, str | None],
                        row_standardised: bool = True) -> dict:
    """Moran's I computed separately for N-S and E-W segments.

    The odd/even convention deliberately interleaves two independent number
    sequences, so a statistic that pools them sees an artificially rough
    surface. EVALUATION.md section 3.4 shows this can reverse the ranking, so
    both the pooled and stratified values are reported.
    """
    out: dict[str, float | None] = {}
    for axis in ("NS", "EW"):
        subset = {u for u, o in orientation.items() if o == axis}
        sub_weights = {u: [v for v in weights[u] if v in subset]
                       for u in weights if u in subset}
        sub_numbering = {u: numbering[u] for u in numbering if u in subset}
        out[axis] = morans_i(sub_numbering, sub_weights, row_standardised)
    return out


# --------------------------------------------------------------------------
# Mantel test  (EVALUATION.md section 4.2)
# --------------------------------------------------------------------------

def mantel(numbering: Numbering, positions: dict[int, Point],
           permutations: int = 199, max_units: int = 300, seed: int = 0) -> dict:
    """Correlation between the geographic and numeric distance matrices.

    Buffer-free and scale-invariant, with an exact permutation test
    (Mantel 1967). Segments are subsampled to ``max_units`` because the test is
    O(n^2) per permutation; the subsample is seeded and therefore reproducible.
    """
    shared = [u for u in positions if u in numbering]
    if len(shared) < 10:
        return {"available": False, "reason": "too few segments"}

    rng = random.Random(seed)
    units = sorted(shared)
    if len(units) > max_units:
        units = sorted(rng.sample(units, max_units))

    pairs = [(i, j) for i in range(len(units)) for j in range(i + 1, len(units))]
    geo = [math.dist(positions[units[i]], positions[units[j]]) for i, j in pairs]

    def numeric(vals: list[float]) -> list[float]:
        return [abs(vals[i] - vals[j]) for i, j in pairs]

    values = [float(numbering[u]) for u in units]
    observed = _pearson(geo, numeric(values))
    if observed != observed:  # NaN
        return {"available": False, "reason": "degenerate numbering"}

    null = []
    for _ in range(permutations):
        rng.shuffle(values)
        r = _pearson(geo, numeric(values))
        if r == r:
            null.append(r)

    return {
        "available": True,
        "r": observed,
        "units": len(units),
        "subsampled": len(shared) > max_units,
        **_permutation_summary(observed, null, False),
    }


# --------------------------------------------------------------------------
# Graph-labelling measures  (EVALUATION.md section 4.3)
# --------------------------------------------------------------------------

def bandwidth_profile(numbering: Numbering, graph: LineGraph) -> dict:
    """Bandwidth and profile of the labelling on the line graph.

    Both are classic sparse-matrix reordering measures (Cuthill & McKee 1969;
    Diaz, Petit & Serna 2002), computed here on the dense-ranked numbering.

    Raw bandwidth is **not** comparable across schemes that use different
    numbers of distinct labels: a bucketed scheme with 18 labels cannot have a
    bandwidth above 17, so it would appear to beat a 193-label ordering
    automatically. That is the same confound as the paper's Metric 1 wearing a
    different hat. The normalised forms divide by the label span, giving "what
    fraction of the whole address space does one step across a junction cost",
    which is scale-free and is what the interface reports.
    """
    ranked = dense_rank({k: v for k, v in numbering.items() if k in graph.adj})
    if len(ranked) < 2:
        return {"available": False, "reason": "too few segments"}

    labels = set(ranked.values())
    span = max(1, len(labels) - 1)

    bandwidth = 0
    profile = 0
    for u, label in ranked.items():
        nbr_labels = [ranked[v] for v in graph.adj[u] if v in ranked]
        if not nbr_labels:
            continue
        bandwidth = max(bandwidth, max(abs(label - x) for x in nbr_labels))
        profile += label - min(min(nbr_labels), label)

    return {
        "available": True,
        "bandwidth": bandwidth,
        "profile": profile,
        "normalised_bandwidth": bandwidth / span,
        "normalised_profile": profile / (len(ranked) * span),
        "distinct_labels": len(labels),
        "n": len(ranked),
    }


def ordering_to_numbering(order: Sequence[int]) -> Numbering:
    """Turn a sequence of segment ids into a 1..m numbering."""
    return {seg: i + 1 for i, seg in enumerate(order)}


# --------------------------------------------------------------------------
# Locality against a Hilbert reference  (EVALUATION.md section 4.4)
# --------------------------------------------------------------------------

def locality_stretch(numbering: Numbering, hilbert_numbering: Numbering,
                     weights: Weights) -> dict:
    """Mean rank-normalised numeric gap between neighbours, vs a Hilbert curve.

    A Hilbert ordering is the best-known general-purpose 2D->1D locality
    preserving map, with provable clustering bounds (Moon et al. 2001), so it
    serves as the ceiling the IGARSS'25 evaluation lacked. S ~ 1 means "as
    locality-preserving as a Hilbert curve"; S < 1 would be better than one.
    """
    def mean_gap(nums: Numbering) -> float | None:
        ranked = dense_rank(nums)
        span = max(ranked.values()) - min(ranked.values())
        if span <= 0:
            return None
        gaps = []
        for u in weights:
            if u not in ranked:
                continue
            nbrs = [v for v in weights[u] if v in ranked]
            if nbrs:
                gaps.append(statistics.fmean(abs(ranked[u] - ranked[v]) for v in nbrs) / span)
        return statistics.fmean(gaps) if gaps else None

    ours = mean_gap(numbering)
    reference = mean_gap(hilbert_numbering)
    if ours is None or reference is None or reference == 0:
        return {"available": False, "reason": "degenerate numbering"}
    return {
        "available": True,
        "normalised_gap": ours,
        "hilbert_gap": reference,
        "stretch": ours / reference,
    }


# --------------------------------------------------------------------------
# Predictability  (EVALUATION.md section 4.8)
# --------------------------------------------------------------------------

def predictability(numbering: Numbering, positions: dict[int, Point],
                   k: int = 6) -> dict:
    """Can a road's number be inferred from its neighbours' numbers?

    Leave-one-out inverse-distance-weighted prediction from the k nearest other
    segments, on the dense-ranked numbering, with the error normalised by the
    rank range. This is the machine analogue of the human blank-filling task,
    which is what makes it the natural candidate for validation against human
    error (EVALUATION.md section 7).

    Lower is better.
    """
    shared = [u for u in positions if u in numbering]
    if len(shared) < k + 2:
        return {"available": False, "reason": "too few segments"}

    ranked = dense_rank({u: numbering[u] for u in shared})
    span = max(ranked.values()) - min(ranked.values())
    if span <= 0:
        return {"available": False, "reason": "numbering has a single value"}

    errors = []
    for u in shared:
        pu = positions[u]
        nearest = sorted(((math.dist(pu, positions[v]), v) for v in shared if v != u))[:k]
        if not nearest:
            continue
        weight_sum = 0.0
        acc = 0.0
        for dist, v in nearest:
            w = 1.0 / max(dist, 1e-6)
            acc += w * ranked[v]
            weight_sum += w
        predicted = acc / weight_sum
        errors.append(abs(predicted - ranked[u]) / span)

    errors.sort()
    return {
        "available": True,
        "median_normalised_error": statistics.median(errors),
        "mean_normalised_error": statistics.fmean(errors),
        "k": k,
    }


# --------------------------------------------------------------------------
# Address quality  (EVALUATION.md section 4.6)
# --------------------------------------------------------------------------

def address_quality(numbering: Numbering, graph: LineGraph,
                    positions: dict[int, Point],
                    partitions: dict[int, int] | None = None) -> dict:
    """Multiplicity, contiguity and dispersion of the numbers used as addresses.

    Bucketing trades uniqueness for coherence and the original paper never
    measured the cost. A number shared by four segments forming one continuous
    street is good; the same number on four disconnected fragments means the
    address does not identify a place.
    """
    classes: dict[tuple, list[int]] = {}
    for seg, number in numbering.items():
        key = (partitions.get(seg) if partitions else None, number)
        classes.setdefault(key, []).append(seg)

    if not classes:
        return {"available": False, "reason": "no numbering"}

    connected = 0
    dispersions = []
    shared_classes = 0
    for members in classes.values():
        if len(members) > 1:
            shared_classes += 1
            comps = graph.components(members)
            if len(comps) == 1:
                connected += 1
            pts = [positions[m] for m in members if m in positions]
            if len(pts) > 1:
                dispersions.append(max(math.dist(a, b)
                                       for i, a in enumerate(pts) for b in pts[i + 1:]))
        else:
            connected += 1

    return {
        "available": True,
        "distinct_numbers": len({n for _, n in classes}),
        "address_classes": len(classes),
        "multiplicity": len(numbering) / len(classes),
        "shared_classes": shared_classes,
        "contiguity": connected / len(classes),
        "max_dispersion_m": max(dispersions) if dispersions else 0.0,
        "mean_dispersion_m": statistics.fmean(dispersions) if dispersions else 0.0,
    }


# --------------------------------------------------------------------------
# Agreement with real street identity  (EVALUATION.md section 4.5)
# --------------------------------------------------------------------------

def _comb2(n: int) -> float:
    return n * (n - 1) / 2.0


def clustering_agreement(predicted: dict[int, object],
                         truth: dict[int, object]) -> dict:
    """Adjusted Rand Index and Normalised Mutual Information between partitions.

    Used to compare an algorithm's buckets against the real street identities in
    the source data - the one piece of genuine external ground truth available.
    Chance-corrected (Hubert & Arabie 1985), so it cannot be called invented.
    """
    shared = [k for k in predicted if k in truth]
    n = len(shared)
    if n < 3:
        return {"available": False, "reason": "no overlapping segments"}

    table: dict[tuple, int] = {}
    a_counts: dict[object, int] = {}
    b_counts: dict[object, int] = {}
    for k in shared:
        a, b = predicted[k], truth[k]
        table[(a, b)] = table.get((a, b), 0) + 1
        a_counts[a] = a_counts.get(a, 0) + 1
        b_counts[b] = b_counts.get(b, 0) + 1

    sum_ij = sum(_comb2(v) for v in table.values())
    sum_a = sum(_comb2(v) for v in a_counts.values())
    sum_b = sum(_comb2(v) for v in b_counts.values())
    total = _comb2(n)
    expected = sum_a * sum_b / total if total else 0.0
    max_index = 0.5 * (sum_a + sum_b)
    ari = (sum_ij - expected) / (max_index - expected) if max_index != expected else 0.0

    # Normalised mutual information (arithmetic normalisation).
    mutual = 0.0
    for (a, b), count in table.items():
        p_ab = count / n
        mutual += p_ab * math.log(p_ab / ((a_counts[a] / n) * (b_counts[b] / n)))
    h_a = -sum((v / n) * math.log(v / n) for v in a_counts.values())
    h_b = -sum((v / n) * math.log(v / n) for v in b_counts.values())
    nmi = (2 * mutual / (h_a + h_b)) if (h_a + h_b) > 0 else 0.0

    return {
        "available": True,
        "ari": ari,
        "nmi": nmi,
        "segments": n,
        "predicted_classes": len(a_counts),
        "truth_classes": len(b_counts),
    }


# --------------------------------------------------------------------------
# The paper's original metrics, for direct comparison
# --------------------------------------------------------------------------

def paper_metric_1(numbering: Numbering, weights: Weights) -> float | None:
    """IGARSS'25 Metric 1: mean absolute number difference within a buffer.

    Reproduced exactly as published so the interface can show it beside the
    corrected statistics. **This value is not scale-invariant** and correlates
    almost perfectly with the size of the number range (Spearman rho ~ 0.95-0.97
    across the bundled data), which is why it must not be used on its own.
    """
    units = _valid_units(numbering, weights)
    if not units:
        return None
    per_unit = []
    for u in units:
        nbrs = [v for v in weights[u] if v in numbering]
        if nbrs:
            per_unit.append(statistics.fmean(abs(numbering[u] - numbering[v]) for v in nbrs))
    return statistics.fmean(per_unit) if per_unit else None


def paper_metrics_2_3(numbering: Numbering, graph: LineGraph,
                      max_sources: int = 400, seed: int = 0) -> dict:
    """IGARSS'25 Metrics 2 and 3, which combine hop distance with number gap.

    Metric 2 is an edge closeness-centrality, C(u) = 1 / sqrt(sum_v sHop(u,v) *
    d(u,v)); Metric 3 is score(u,v) = sqrt(sHop(u,v) * d(u,v)) averaged over
    pairs. Sources are subsampled on large networks because both need all-pairs
    hop distances.

    Note the published direction of Metric 2 is ambiguous: as defined, a
    *larger* C means a tighter numbering, yet the paper reports lower as better
    for all three metrics. Both readings are surfaced rather than guessed at.
    """
    ids = [u for u in graph.ids if u in numbering]
    if len(ids) < 3:
        return {"available": False, "reason": "too few segments"}

    rng = random.Random(seed)
    sources = ids if len(ids) <= max_sources else sorted(rng.sample(ids, max_sources))

    closeness = []
    scores = []
    for u in sources:
        hops = graph.bfs_hops(u)
        total = 0.0
        for v, h in hops.items():
            if v == u or v not in numbering or h == 0:
                continue
            gap = abs(numbering[u] - numbering[v])
            total += h * gap
            scores.append(math.sqrt(h * gap))
        if total > 0:
            closeness.append(1.0 / math.sqrt(total))

    return {
        "available": True,
        "metric2_mean_closeness": statistics.fmean(closeness) if closeness else None,
        "metric3_mean_score": statistics.fmean(scores) if scores else None,
        "sources": len(sources),
        "subsampled": len(ids) > max_sources,
    }


# --------------------------------------------------------------------------
# Task-based evaluation  (EVALUATION.md section 5)
# --------------------------------------------------------------------------

def greedy_routing(numbering: Numbering, graph: LineGraph,
                   samples: int = 400, seed: int = 0,
                   max_hops_factor: int = 4) -> dict:
    """Can you navigate by following the numbers?

    From the current segment, step to the neighbour whose number is closest to
    the target's; you are stuck when no neighbour improves on the current gap.
    This is the greedy-embedding question from the geometric routing literature
    (Papadimitriou & Ratajczak 2005).

    Because bucketing makes numbers non-unique, arriving at *a* segment carrying
    the target number is counted as a success but recorded separately as an
    ambiguous arrival - the concrete cost of address ambiguity.
    """
    pool = [u for u in graph.ids if u in numbering and graph.adj[u]]
    if len(pool) < 4:
        return {"available": False, "reason": "too few connected segments"}

    rng = random.Random(seed)
    by_number: dict[int, list[int]] = {}
    for seg in pool:
        by_number.setdefault(numbering[seg], []).append(seg)

    successes = 0
    ambiguous = 0
    attempts = 0
    stretches: list[float] = []
    visited_counts: list[int] = []

    limit = max_hops_factor * max(1, int(math.sqrt(len(pool)))) + 10

    for _ in range(samples):
        source = rng.choice(pool)
        target = rng.choice(pool)
        if source == target:
            continue
        shortest = graph.bfs_hops(source).get(target)
        if shortest is None or shortest == 0:
            continue  # different components
        attempts += 1

        goal = numbering[target]
        current = source
        seen = {source}
        hops = 0
        while hops < limit:
            if numbering[current] == goal:
                break
            options = [v for v in graph.adj[current] if v in numbering and v not in seen]
            if not options:
                break
            best = min(options, key=lambda v: (abs(numbering[v] - goal), v))
            if abs(numbering[best] - goal) >= abs(numbering[current] - goal) \
                    and numbering[current] != goal:
                # No strict improvement available: a local minimum.
                break
            current = best
            seen.add(current)
            hops += 1

        if numbering[current] == goal:
            successes += 1
            visited_counts.append(len(seen))
            stretches.append(hops / shortest if shortest else 1.0)
            if current != target:
                ambiguous += 1

    if attempts == 0:
        return {"available": False, "reason": "no connected source/target pairs"}

    return {
        "available": True,
        "attempts": attempts,
        "success_rate": successes / attempts,
        "ambiguous_arrival_rate": (ambiguous / successes) if successes else None,
        "mean_stretch": statistics.fmean(stretches) if stretches else None,
        "median_stretch": statistics.median(stretches) if stretches else None,
        "mean_segments_visited": statistics.fmean(visited_counts) if visited_counts else None,
        "unique_numbers": len(by_number) == len(pool),
    }


def _tour_length(order: Sequence[int], positions: dict[int, Point]) -> float:
    if len(order) < 2:
        return 0.0
    total = sum(math.dist(positions[order[i]], positions[order[i + 1]])
                for i in range(len(order) - 1))
    return total + math.dist(positions[order[-1]], positions[order[0]])


def _two_opt(order: list[int], positions: dict[int, Point],
             max_passes: int = 40) -> list[int]:
    """Standard 2-opt local search, used as the near-optimal tour reference."""
    best = list(order)
    n = len(best)
    if n < 4:
        return best
    improved = True
    passes = 0
    while improved and passes < max_passes:
        improved = False
        passes += 1
        for i in range(n - 1):
            a, b = best[i], best[(i + 1) % n]
            dab = math.dist(positions[a], positions[b])
            for j in range(i + 2, n):
                if i == 0 and j == n - 1:
                    continue
                c, d = best[j], best[(j + 1) % n]
                delta = (dab + math.dist(positions[c], positions[d])
                         - math.dist(positions[a], positions[c])
                         - math.dist(positions[b], positions[d]))
                if delta > 1e-9:
                    best[i + 1:j + 1] = reversed(best[i + 1:j + 1])
                    improved = True
                    a, b = best[i], best[(i + 1) % n]
                    dab = math.dist(positions[a], positions[b])
    return best


def delivery_tour(numbering: Numbering, positions: dict[int, Point],
                  stops: int = 25, trials: int = 20, seed: int = 0) -> dict:
    """Does sorting addresses by number produce a sensible delivery round?

    If a numbering is spatially coherent, visiting addresses in numeric order
    should approximate a good tour. The reference point is Bartholdi & Platzman
    (1982), whose space-filling-curve ordering yields tours roughly 25% above
    optimal - so a ratio near 1.25 matches a celebrated heuristic.

    Lower is better; 1.0 would mean numeric order is already optimal.
    """
    pool = [u for u in positions if u in numbering]
    if len(pool) < stops + 1:
        stops = max(4, len(pool) // 2)
    if len(pool) < 8:
        return {"available": False, "reason": "too few segments"}

    rng = random.Random(seed)
    ratios = []
    for _ in range(trials):
        sample = rng.sample(pool, min(stops, len(pool)))
        by_number = sorted(sample, key=lambda s: (numbering[s], s))
        numbered_length = _tour_length(by_number, positions)
        reference = _tour_length(_two_opt(list(by_number), positions), positions)
        if reference > 0:
            ratios.append(numbered_length / reference)

    if not ratios:
        return {"available": False, "reason": "degenerate positions"}
    return {
        "available": True,
        "mean_ratio": statistics.fmean(ratios),
        "median_ratio": statistics.median(ratios),
        "stops": stops,
        "trials": len(ratios),
    }
