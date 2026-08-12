"""Minimal, dependency-free readers for the ESRI Shapefile family.

Only the pieces the road-numbering datasets actually use are implemented:
Point (1) and PolyLine (3) geometry, plus their Z/M variants, the dBASE III
attribute table and the WKT projection sidecar.

Reference: ESRI Shapefile Technical Description (July 1998).
"""

from __future__ import annotations

import os
import struct
from typing import Any, Iterator

# Shape type codes from the specification.
NULL = 0
POINT = 1
POLYLINE = 3
POLYGON = 5
POINT_Z = 11
POLYLINE_Z = 13
POLYGON_Z = 15
POINT_M = 21
POLYLINE_M = 23
POLYGON_M = 25

_POINT_TYPES = {POINT, POINT_Z, POINT_M}
_PATH_TYPES = {POLYLINE, POLYGON, POLYLINE_Z, POLYGON_Z, POLYLINE_M, POLYGON_M}


class ShapefileError(Exception):
    """Raised when a file is not a shapefile we can read."""


class Shape:
    """One geometry record.

    ``parts`` is a list of coordinate rings/lines, each a list of ``(x, y)``
    tuples in the file's own coordinate system. A point shape is normalised to
    a single part holding a single coordinate so callers can treat both
    uniformly.
    """

    __slots__ = ("shape_type", "parts", "bbox")

    def __init__(self, shape_type: int, parts: list[list[tuple[float, float]]],
                 bbox: tuple[float, float, float, float] | None = None):
        self.shape_type = shape_type
        self.parts = parts
        self.bbox = bbox

    @property
    def is_point(self) -> bool:
        return self.shape_type in _POINT_TYPES

    @property
    def point(self) -> tuple[float, float]:
        return self.parts[0][0]

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        n = sum(len(p) for p in self.parts)
        return f"<Shape type={self.shape_type} parts={len(self.parts)} points={n}>"


def read_shp(path: str) -> tuple[list[Shape], tuple[float, float, float, float]]:
    """Read a ``.shp`` file, returning its shapes and the header bounding box."""
    with open(path, "rb") as fh:
        buf = fh.read()

    if len(buf) < 100:
        raise ShapefileError(f"{path}: file is too short to contain a header")
    magic = struct.unpack(">i", buf[0:4])[0]
    if magic != 9994:
        raise ShapefileError(f"{path}: bad file code {magic} (expected 9994)")

    bbox = struct.unpack("<4d", buf[36:68])

    shapes: list[Shape] = []
    offset = 100
    total = len(buf)
    while offset + 8 <= total:
        _record_number, content_len = struct.unpack(">ii", buf[offset:offset + 8])
        start = offset + 8
        end = start + content_len * 2  # content length is counted in 16-bit words
        if end > total:
            break
        shapes.append(_parse_record(buf[start:end]))
        offset = end

    return shapes, bbox


def _parse_record(rec: bytes) -> Shape:
    if len(rec) < 4:
        return Shape(NULL, [])
    shape_type = struct.unpack("<i", rec[0:4])[0]

    if shape_type == NULL:
        return Shape(NULL, [])

    if shape_type in _POINT_TYPES:
        x, y = struct.unpack("<2d", rec[4:20])
        return Shape(shape_type, [[(x, y)]], (x, y, x, y))

    if shape_type in _PATH_TYPES:
        box = struct.unpack("<4d", rec[4:36])
        num_parts, num_points = struct.unpack("<2i", rec[36:44])
        part_start = 44
        part_index = struct.unpack(f"<{num_parts}i",
                                   rec[part_start:part_start + 4 * num_parts])
        pts_start = part_start + 4 * num_parts
        flat = struct.unpack(f"<{2 * num_points}d",
                             rec[pts_start:pts_start + 16 * num_points])
        coords = [(flat[i * 2], flat[i * 2 + 1]) for i in range(num_points)]

        parts: list[list[tuple[float, float]]] = []
        for i, begin in enumerate(part_index):
            stop = part_index[i + 1] if i + 1 < num_parts else num_points
            segment = coords[begin:stop]
            if len(segment) >= 2:
                parts.append(segment)
        return Shape(shape_type, parts, box)

    raise ShapefileError(f"unsupported shape type {shape_type}")


# --------------------------------------------------------------------------
# dBASE III attribute table
# --------------------------------------------------------------------------

# dBASE writes an all-asterisk field when a numeric value overflows its column
# width; QGIS also uses it for NULL. Treat both as "no value".
_NULL_MARKERS = {"", "*"}


def read_dbf(path: str, encoding: str = "utf-8") -> tuple[list[str], list[dict[str, Any]]]:
    """Read a ``.dbf`` table, returning ``(field_names, records)``.

    Numeric and date-ish columns are converted to ``int``/``float`` where
    possible; unreadable or overflowed values become ``None``.
    """
    with open(path, "rb") as fh:
        buf = fh.read()

    if len(buf) < 32:
        raise ShapefileError(f"{path}: truncated dbf header")

    num_records, header_len, record_len = struct.unpack("<IHH", buf[4:12])

    fields: list[tuple[str, str, int, int]] = []
    offset = 32
    while offset < len(buf) and buf[offset] != 0x0D:
        raw = buf[offset:offset + 32]
        if len(raw) < 32:
            break
        name = raw[0:11].split(b"\x00")[0].decode("latin-1").strip()
        ftype = chr(raw[11])
        flen = raw[16]
        fdec = raw[17]
        fields.append((name, ftype, flen, fdec))
        offset += 32

    names = [f[0] for f in fields]
    records: list[dict[str, Any]] = []
    base = header_len
    for i in range(num_records):
        start = base + i * record_len
        raw = buf[start:start + record_len]
        if len(raw) < record_len:
            break
        if raw[0:1] == b"*":  # record flagged as deleted
            continue
        row: dict[str, Any] = {}
        pos = 1
        for name, ftype, flen, fdec in fields:
            chunk = raw[pos:pos + flen]
            pos += flen
            row[name] = _coerce(chunk, ftype, fdec, encoding)
        records.append(row)

    return names, records


def _coerce(chunk: bytes, ftype: str, fdec: int, encoding: str) -> Any:
    try:
        text = chunk.decode(encoding, errors="replace").strip()
    except Exception:
        text = chunk.decode("latin-1", errors="replace").strip()

    if ftype in ("C", "D", "M"):
        return text or None

    if ftype == "L":
        if text.upper() in ("T", "Y"):
            return True
        if text.upper() in ("F", "N"):
            return False
        return None

    # Numeric ("N") and float ("F"). Overflowed columns are written as "*****".
    stripped = text.strip("*").strip()
    if not stripped or set(text) <= {"*"} or text in _NULL_MARKERS:
        return None
    try:
        if fdec > 0 or "." in stripped or "e" in stripped.lower():
            return float(stripped)
        return int(stripped)
    except ValueError:
        try:
            return float(stripped)
        except ValueError:
            return None


def read_prj(path: str) -> str | None:
    """Read the WKT string from a ``.prj`` sidecar, if it exists."""
    if not os.path.exists(path):
        return None
    with open(path, "r", encoding="utf-8", errors="replace") as fh:
        return fh.read().strip()


# --------------------------------------------------------------------------
# Convenience wrapper
# --------------------------------------------------------------------------

class Layer:
    """A shapefile layer: geometry joined to its attribute rows."""

    def __init__(self, base_path: str, encoding: str = "utf-8"):
        """``base_path`` is the path with or without the ``.shp`` extension."""
        if base_path.lower().endswith(".shp"):
            base_path = base_path[:-4]
        self.base_path = base_path
        self.name = os.path.basename(base_path)

        self.shapes, self.bbox = read_shp(base_path + ".shp")

        dbf_path = base_path + ".dbf"
        if os.path.exists(dbf_path):
            self.fields, self.records = read_dbf(dbf_path, encoding=encoding)
        else:
            self.fields, self.records = [], [{} for _ in self.shapes]

        # A well-formed shapefile has one attribute row per geometry; if the
        # counts disagree, pad so downstream zips do not silently truncate.
        while len(self.records) < len(self.shapes):
            self.records.append({})

        self.wkt = read_prj(base_path + ".prj")

    def __len__(self) -> int:
        return len(self.shapes)

    def __iter__(self) -> Iterator[tuple[Shape, dict[str, Any]]]:
        return zip(self.shapes, self.records)

    def field(self, *candidates: str) -> str | None:
        """Return the first field whose name matches one of ``candidates``.

        Matching is case-insensitive, which keeps callers from caring whether a
        column arrived as ``id``, ``ID`` or ``Id``.
        """
        lowered = {f.lower(): f for f in self.fields}
        for candidate in candidates:
            hit = lowered.get(candidate.lower())
            if hit:
                return hit
        return None
