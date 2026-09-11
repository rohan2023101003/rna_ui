"""Graph structure for road networks, viewed as line graphs.

Road numbering labels *edges*, so every graph-theoretic measure here operates on
the line graph L(G): one node per road segment, with two segments adjacent when
they meet at an intersection. This is the representation in which bandwidth,
profile, Cuthill-McKee ordering and spectral ordering are defined.
"""

from __future__ import annotations

import math
import random
from collections import deque
from typing import Iterable, Sequence


class LineGraph:
    """Adjacency of road segments that share an intersection node."""

    def __init__(self, endpoints: dict[int, tuple[object, object]]):
        """``endpoints`` maps segment id -> (source node, target node)."""
        self.ids: list[int] = list(endpoints)
        self.index: dict[int, int] = {k: i for i, k in enumerate(self.ids)}

        by_node: dict[object, list[int]] = {}
        for seg, (source, target) in endpoints.items():
            for node in (source, target):
                if node is not None:
                    by_node.setdefault(node, []).append(seg)

        self.adj: dict[int, set[int]] = {k: set() for k in self.ids}
        for segments in by_node.values():
            for i, a in enumerate(segments):
                for b in segments[i + 1:]:
                    self.adj[a].add(b)
                    self.adj[b].add(a)

        self.degree = {k: len(v) for k, v in self.adj.items()}
        self.edge_count = sum(self.degree.values()) // 2

    def __len__(self) -> int:
        return len(self.ids)

    # -- traversal ---------------------------------------------------------

    def bfs_hops(self, start: int, limit: int | None = None) -> dict[int, int]:
        """Hop distance from ``start`` to every reachable segment."""
        seen = {start: 0}
        queue = deque([start])
        while queue:
            node = queue.popleft()
            d = seen[node]
            if limit is not None and d >= limit:
                continue
            for nxt in self.adj[node]:
                if nxt not in seen:
                    seen[nxt] = d + 1
                    queue.append(nxt)
        return seen

    def components(self, subset: Iterable[int] | None = None) -> list[list[int]]:
        """Connected components, optionally of the subgraph induced by ``subset``."""
        allowed = set(self.ids if subset is None else subset)
        seen: set[int] = set()
        out: list[list[int]] = []
        for start in allowed:
            if start in seen:
                continue
            group = []
            queue = deque([start])
            seen.add(start)
            while queue:
                node = queue.popleft()
                group.append(node)
                for nxt in self.adj[node]:
                    if nxt in allowed and nxt not in seen:
                        seen.add(nxt)
                        queue.append(nxt)
            out.append(group)
        return out

    def largest_component(self) -> list[int]:
        comps = self.components()
        return max(comps, key=len) if comps else []

    def pseudo_peripheral(self, start: int | None = None) -> int:
        """A node of near-maximal eccentricity, per the Gibbs-Poole-Stockmeyer idea.

        Used as the seed for Cuthill-McKee; a good seed materially improves the
        resulting bandwidth.
        """
        if not self.ids:
            raise ValueError("empty graph")
        node = start if start is not None else min(self.ids, key=lambda k: self.degree[k])
        for _ in range(10):
            dist = self.bfs_hops(node)
            far = max(dist.values())
            candidates = [k for k, d in dist.items() if d == far]
            nxt = min(candidates, key=lambda k: self.degree[k])
            if nxt == node:
                break
            node = nxt
        return node


# --------------------------------------------------------------------------
# Orderings used as reference baselines
# --------------------------------------------------------------------------

def cuthill_mckee(graph: LineGraph, reverse: bool = True) -> list[int]:
    """Cuthill-McKee ordering (1969); ``reverse=True`` gives Reverse CM.

    Standard bandwidth-reduction heuristic: breadth-first from a
    pseudo-peripheral seed, visiting each frontier in order of increasing
    degree. RCM usually yields a smaller profile than plain CM.
    """
    order: list[int] = []
    visited: set[int] = set()
    remaining = set(graph.ids)

    while remaining:
        # Each component gets its own seed.
        sub = {k for k in remaining}
        seed = graph.pseudo_peripheral(min(sub, key=lambda k: (graph.degree[k], k)))
        if seed not in remaining:
            seed = min(sub, key=lambda k: (graph.degree[k], k))
        queue = deque([seed])
        visited.add(seed)
        remaining.discard(seed)
        while queue:
            node = queue.popleft()
            order.append(node)
            nbrs = sorted((n for n in graph.adj[node] if n not in visited),
                          key=lambda k: (graph.degree[k], k))
            for nxt in nbrs:
                visited.add(nxt)
                remaining.discard(nxt)
                queue.append(nxt)

    return list(reversed(order)) if reverse else order


def fiedler_order(graph: LineGraph, iterations: int = 3000,
                  tol: float = 1e-9, seed: int = 0) -> list[int]:
    """Spectral ordering: sort segments by the Fiedler vector of the Laplacian.

    The Fiedler vector (eigenvector of the second-smallest eigenvalue of
    L = D - A) is the solution to a relaxed minimum-linear-arrangement problem,
    so sorting by it is a principled ordering baseline.

    Computed by power iteration on the shifted matrix M = cI - L, deflating the
    known constant eigenvector each step. Pure Python, no SciPy needed.
    """
    ids = graph.ids
    n = len(ids)
    if n == 0:
        return []
    if n == 1:
        return list(ids)

    # Shift so that the smallest Laplacian eigenvalue becomes the largest of M.
    shift = 2.0 * max(graph.degree.values(), default=1) + 1.0

    rng = random.Random(seed)
    vec = {k: rng.uniform(-1.0, 1.0) for k in ids}

    def deflate(v: dict[int, float]) -> None:
        """Remove the constant component - the first Laplacian eigenvector."""
        mean = sum(v.values()) / n
        for k in v:
            v[k] -= mean

    def normalise(v: dict[int, float]) -> float:
        norm = math.sqrt(sum(x * x for x in v.values()))
        if norm > 0:
            for k in v:
                v[k] /= norm
        return norm

    deflate(vec)
    normalise(vec)

    for _ in range(iterations):
        # M v = (shift - deg) * v + A v
        nxt = {}
        for k in ids:
            acc = (shift - graph.degree[k]) * vec[k]
            for nb in graph.adj[k]:
                acc += vec[nb]
            nxt[k] = acc
        deflate(nxt)
        if normalise(nxt) == 0:
            break
        delta = sum(abs(nxt[k] - vec[k]) for k in ids)
        vec = nxt
        if delta < tol * n:
            break

    return sorted(ids, key=lambda k: (vec[k], k))


# --------------------------------------------------------------------------
# All-pairs hop distances
# --------------------------------------------------------------------------

def hop_distance_matrix(graph: LineGraph, sources: Sequence[int] | None = None
                        ) -> dict[int, dict[int, int]]:
    """Hop distances from each source (default: every segment) to all others."""
    picks = list(graph.ids) if sources is None else list(sources)
    return {s: graph.bfs_hops(s) for s in picks}
