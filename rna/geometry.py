"""Planar geometry helpers for the evaluation metrics.

The GeoJSON produced by :mod:`rna.dataset` is in WGS84 degrees, which cannot be
used directly for distance work. Everything here first projects a network into a
local metric frame (metres, origin at the network centroid) and then works in
plain planar coordinates. Over a few kilometres the error of that approximation
is far below the buffer widths the metrics use.
"""

from __future__ import annotations

import math
from typing import Iterable, Sequence

Point = tuple[float, float]
Polyline = list[Point]


# --------------------------------------------------------------------------
# Local metric projection
# --------------------------------------------------------------------------

def degree_lengths(lat_deg: float) -> tuple[float, float]:
    """Metres per degree of longitude and latitude at a given latitude.

    Standard series expansions for the WGS84 ellipsoid; accurate to well under
    a metre per degree, which is far more than these metrics need.
    """
    phi = math.radians(lat_deg)
    metres_per_deg_lat = (111132.92
                          - 559.82 * math.cos(2 * phi)
                          + 1.175 * math.cos(4 * phi)
                          - 0.0023 * math.cos(6 * phi))
    metres_per_deg_lon = (111412.84 * math.cos(phi)
                          - 93.5 * math.cos(3 * phi)
                          + 0.118 * math.cos(5 * phi))
    return metres_per_deg_lon, metres_per_deg_lat


class LocalFrame:
    """Converts WGS84 lon/lat to metres relative to a network's centroid."""

    def __init__(self, lon0: float, lat0: float):
        self.lon0 = lon0
        self.lat0 = lat0
        self.kx, self.ky = degree_lengths(lat0)

    @classmethod
    def from_points(cls, points: Iterable[Point]) -> "LocalFrame":
        pts = list(points)
        if not pts:
            return cls(0.0, 0.0)
        return cls(sum(p[0] for p in pts) / len(pts),
                   sum(p[1] for p in pts) / len(pts))

    def to_metres(self, lon: float, lat: float) -> Point:
        return ((lon - self.lon0) * self.kx, (lat - self.lat0) * self.ky)


# --------------------------------------------------------------------------
# Polyline measures
# --------------------------------------------------------------------------

def polyline_length(coords: Sequence[Point]) -> float:
    return sum(math.dist(coords[i], coords[i + 1]) for i in range(len(coords) - 1))


def polyline_midpoint(coords: Sequence[Point]) -> Point:
    """The point halfway along a polyline by arc length."""
    if len(coords) == 1:
        return coords[0]
    spans = [math.dist(coords[i], coords[i + 1]) for i in range(len(coords) - 1)]
    target = sum(spans) / 2.0
    for i, span in enumerate(spans):
        if target <= span or i == len(spans) - 1:
            t = target / span if span else 0.0
            return (coords[i][0] + (coords[i + 1][0] - coords[i][0]) * t,
                    coords[i][1] + (coords[i + 1][1] - coords[i][1]) * t)
        target -= span
    return coords[0]


def bounds(coords: Sequence[Point]) -> tuple[float, float, float, float]:
    xs = [p[0] for p in coords]
    ys = [p[1] for p in coords]
    return min(xs), min(ys), max(xs), max(ys)


# --------------------------------------------------------------------------
# Point / segment / polyline distances
# --------------------------------------------------------------------------

def point_segment_distance(p: Point, a: Point, b: Point) -> float:
    """Shortest distance from point ``p`` to the line segment ``ab``."""
    abx, aby = b[0] - a[0], b[1] - a[1]
    denom = abx * abx + aby * aby
    if denom == 0.0:
        return math.dist(p, a)
    t = ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / denom
    t = max(0.0, min(1.0, t))
    return math.dist(p, (a[0] + t * abx, a[1] + t * aby))


def _orientation(a: Point, b: Point, c: Point) -> float:
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])


def _segments_intersect(a: Point, b: Point, c: Point, d: Point) -> bool:
    d1, d2 = _orientation(c, d, a), _orientation(c, d, b)
    d3, d4 = _orientation(a, b, c), _orientation(a, b, d)
    if ((d1 > 0) != (d2 > 0)) and ((d3 > 0) != (d4 > 0)):
        return True
    # Collinear touching cases are rare here and treated as non-crossing; the
    # endpoint distances below still return 0 for them.
    return False


def segment_segment_distance(a: Point, b: Point, c: Point, d: Point) -> float:
    if _segments_intersect(a, b, c, d):
        return 0.0
    return min(point_segment_distance(a, c, d),
               point_segment_distance(b, c, d),
               point_segment_distance(c, a, b),
               point_segment_distance(d, a, b))


def polyline_distance(p: Sequence[Point], q: Sequence[Point],
                      cutoff: float | None = None) -> float:
    """Minimum distance between two polylines.

    ``cutoff`` allows an early exit once the answer is known to be below the
    caller's threshold, which matters because this runs O(n^2) times.
    """
    best = math.inf
    for i in range(len(p) - 1):
        for j in range(len(q) - 1):
            dist = segment_segment_distance(p[i], p[i + 1], q[j], q[j + 1])
            if dist < best:
                best = dist
                if cutoff is not None and best <= cutoff:
                    return best
    return best


# --------------------------------------------------------------------------
# Uniform grid index
# --------------------------------------------------------------------------

class GridIndex:
    """Bucket bounding boxes into a uniform grid for radius queries."""

    def __init__(self, cell: float):
        self.cell = max(1e-6, cell)
        self.cells: dict[tuple[int, int], list[int]] = {}
        self.boxes: dict[int, tuple[float, float, float, float]] = {}

    def add(self, key: int, box: tuple[float, float, float, float]) -> None:
        self.boxes[key] = box
        for ci, cj in self._cells_for(box):
            self.cells.setdefault((ci, cj), []).append(key)

    def _cells_for(self, box, pad: float = 0.0):
        minx, miny, maxx, maxy = box
        i0, i1 = int(math.floor((minx - pad) / self.cell)), int(math.floor((maxx + pad) / self.cell))
        j0, j1 = int(math.floor((miny - pad) / self.cell)), int(math.floor((maxy + pad) / self.cell))
        for i in range(i0, i1 + 1):
            for j in range(j0, j1 + 1):
                yield i, j

    def candidates(self, box: tuple[float, float, float, float], pad: float) -> set[int]:
        found: set[int] = set()
        for cell in self._cells_for(box, pad):
            found.update(self.cells.get(cell, ()))
        return found


def neighbours_within(geoms: dict[int, Polyline], radius: float,
                      mode: str = "geometry") -> dict[int, list[int]]:
    """Spatial neighbour lists: every segment within ``radius`` metres.

    ``mode`` selects the distance definition:

    ``geometry``
        Minimum distance between the two polylines. This matches the wording of
        the IGARSS'25 paper ("road segments that fall within the buffer") and is
        the default.
    ``midpoint``
        Distance between polyline midpoints. Cheaper, and the definition used
        in the worked examples of EVALUATION.md.

    The relation is symmetric by construction, which the spatial statistics
    below rely on.
    """
    keys = list(geoms)
    if mode == "midpoint":
        mids = {k: polyline_midpoint(geoms[k]) for k in keys}
        index = GridIndex(radius)
        for k in keys:
            x, y = mids[k]
            index.add(k, (x, y, x, y))
        out: dict[int, list[int]] = {k: [] for k in keys}
        for k in keys:
            x, y = mids[k]
            for other in index.candidates((x, y, x, y), radius):
                if other <= k:
                    continue
                if math.dist(mids[k], mids[other]) <= radius:
                    out[k].append(other)
                    out[other].append(k)
        return out

    boxes = {k: bounds(geoms[k]) for k in keys}
    index = GridIndex(max(radius, 50.0))
    for k in keys:
        index.add(k, boxes[k])

    out = {k: [] for k in keys}
    for k in keys:
        for other in index.candidates(boxes[k], radius):
            if other <= k:
                continue
            # Cheap bounding-box rejection before the exact test.
            bk, bo = boxes[k], boxes[other]
            if (bk[0] - bo[2] > radius or bo[0] - bk[2] > radius
                    or bk[1] - bo[3] > radius or bo[1] - bk[3] > radius):
                continue
            if polyline_distance(geoms[k], geoms[other], cutoff=radius) <= radius:
                out[k].append(other)
                out[other].append(k)
    return out


# --------------------------------------------------------------------------
# Hilbert curve
# --------------------------------------------------------------------------

def hilbert_index(x: int, y: int, order: int) -> int:
    """Index of cell ``(x, y)`` along a Hilbert curve of side ``2**order``.

    The standard iterative xy->d conversion (Wikipedia, "Hilbert curve").
    """
    rx = ry = 0
    d = 0
    s = 1 << (order - 1)
    while s > 0:
        rx = 1 if (x & s) > 0 else 0
        ry = 1 if (y & s) > 0 else 0
        d += s * s * ((3 * rx) ^ ry)
        # Rotate the quadrant so the curve stays continuous.
        if ry == 0:
            if rx == 1:
                x = s - 1 - x
                y = s - 1 - y
            x, y = y, x
        s >>= 1
    return d


def hilbert_order(points: dict[int, Point], order: int = 16) -> list[int]:
    """Sort keys by the Hilbert index of their point, best-known 2D->1D locality."""
    if not points:
        return []
    xs = [p[0] for p in points.values()]
    ys = [p[1] for p in points.values()]
    minx, maxx = min(xs), max(xs)
    miny, maxy = min(ys), max(ys)
    span = max(maxx - minx, maxy - miny) or 1.0
    side = (1 << order) - 1

    def cell(p: Point) -> tuple[int, int]:
        return (int((p[0] - minx) / span * side),
                int((p[1] - miny) / span * side))

    return sorted(points, key=lambda k: hilbert_index(*cell(points[k]), order))
