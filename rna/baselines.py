"""Reference numberings to evaluate the algorithms against.

The IGARSS'25 evaluation compared the search algorithms only with each other,
so a score of "1.0355" had neither a floor nor a ceiling to be read against.
These baselines supply both:

    random       the floor - any metric that cannot separate this from a real
                 algorithm is not measuring anything
    coordinate   the naive scheme (sort west-to-east, then south-to-north);
                 often surprisingly strong on a grid city
    hilbert      the ceiling for pure spatial locality; a space-filling curve
                 with provable clustering bounds (Moon et al. 2001)
    rcm          Reverse Cuthill-McKee (1969), the standard bandwidth heuristic
    spectral     ordering by the Fiedler vector, optimal for a relaxed
                 minimum-linear-arrangement objective

``hilbert_parity`` additionally applies the paper's own N-S/E-W odd/even
convention, which makes it directly comparable with the RNA outputs rather than
just a locality reference.
"""

from __future__ import annotations

import random
from typing import Sequence

from .geometry import Point, hilbert_order
from .graph import LineGraph, cuthill_mckee, fiedler_order
from .metrics import Numbering, ordering_to_numbering

BASELINES = {
    "random": {
        "label": "Random permutation",
        "role": "floor",
        "summary": "Numbers assigned at random. Any metric that fails to "
                   "separate a real algorithm from this is uninformative.",
    },
    "coordinate": {
        "label": "Coordinate sort (x then y)",
        "role": "naive",
        "summary": "Sort west to east, breaking ties south to north. Trivial to "
                   "implement and a surprisingly strong baseline on grid cities.",
    },
    "hilbert": {
        "label": "Hilbert curve order",
        "role": "ceiling",
        "summary": "Order along a Hilbert space-filling curve - the best known "
                   "general-purpose 2D to 1D locality-preserving map.",
    },
    "hilbert_parity": {
        "label": "Hilbert order + odd/even rule",
        "role": "ceiling",
        "summary": "Hilbert order with the paper's own convention applied: odd "
                   "numbers to North-South roads, even to East-West.",
    },
    "rcm": {
        "label": "Reverse Cuthill-McKee",
        "role": "classical",
        "summary": "The standard sparse-matrix bandwidth-reduction ordering "
                   "since 1969, applied to the line graph.",
    },
    "spectral": {
        "label": "Spectral (Fiedler) order",
        "role": "classical",
        "summary": "Sort by the Fiedler vector of the graph Laplacian; the "
                   "solution to a relaxed minimum-linear-arrangement problem.",
    },
}


def apply_parity_convention(order: Sequence[int],
                            orientation: dict[int, str | None]) -> Numbering:
    """Number an ordering with odd for North-South and even for East-West.

    Follows the paper's convention so a baseline can be compared like for like
    with the RNA outputs. Segments with unknown orientation fall back to
    alternating parity, which keeps the numbering a bijection.
    """
    numbering: Numbering = {}
    odd = 1
    even = 2
    for seg in order:
        axis = orientation.get(seg)
        if axis == "NS":
            numbering[seg] = odd
            odd += 2
        elif axis == "EW":
            numbering[seg] = even
            even += 2
        else:
            if odd <= even:
                numbering[seg] = odd
                odd += 2
            else:
                numbering[seg] = even
                even += 2
    return numbering


def build(key: str, *, segments: Sequence[int], positions: dict[int, Point],
          graph: LineGraph, orientation: dict[int, str | None],
          seed: int = 0) -> Numbering:
    """Construct one reference numbering over ``segments``."""
    if key == "random":
        shuffled = list(segments)
        random.Random(seed).shuffle(shuffled)
        return ordering_to_numbering(shuffled)

    if key == "coordinate":
        order = sorted(segments, key=lambda s: (positions[s][0], positions[s][1], s))
        return ordering_to_numbering(order)

    if key == "hilbert":
        return ordering_to_numbering(hilbert_order({s: positions[s] for s in segments}))

    if key == "hilbert_parity":
        order = hilbert_order({s: positions[s] for s in segments})
        return apply_parity_convention(order, orientation)

    if key == "rcm":
        order = [s for s in cuthill_mckee(graph, reverse=True) if s in set(segments)]
        missing = [s for s in segments if s not in set(order)]
        return ordering_to_numbering(order + missing)

    if key == "spectral":
        order = [s for s in fiedler_order(graph) if s in set(segments)]
        missing = [s for s in segments if s not in set(order)]
        return ordering_to_numbering(order + missing)

    raise KeyError(f"unknown baseline '{key}'")
