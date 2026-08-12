"""Turn a raw GIS folder plus algorithm CSVs into web-ready GeoJSON.

This is objective 1 of the project: integrate the algorithm-generated CSV
outputs with the spatial road networks in a format a browser can consume,
without losing the spatial geometry.

The join between the two halves is by road identifier: every result CSV row
carries ``road_id``, which is the ``id`` attribute of the corresponding record
in the road shapefile, and ``seq``, which is that record's position in the
file. Both are checked, and any row that fails to line up is reported rather
than silently dropped.
"""

from __future__ import annotations

import ast
import csv
import math
import os
from typing import Any

from . import algorithms
from .projection import Transform, haversine_metres, transform_from_wkt
from .shapefile import POINT, POLYLINE, Layer, ShapefileError

# Attribute columns that mean the same thing under different names across the
# three cities' datasets, in order of preference.
_NAME_FIELDS = ("name", "street", "road_name", "st_name")
_CATEGORY_FIELDS = ("type", "catergory", "category", "width_feet", "highway", "fclass")
_LENGTH_FIELDS = ("length_cal", "length_m", "re_length", "lenghth", "length", "shape_leng")
_SOURCE_FIELDS = ("source", "from", "src", "start")
_TARGET_FIELDS = ("target", "to", "tgt", "end")


class DatasetError(Exception):
    """Raised when a folder does not look like a usable road network."""


# --------------------------------------------------------------------------
# Discovery
# --------------------------------------------------------------------------

def discover(data_root: str, results_root: str | None = None) -> list[dict]:
    """List every ``<city>/<network>`` dataset found beneath ``data_root``."""
    datasets: list[dict] = []
    if not os.path.isdir(data_root):
        return datasets

    for city in sorted(os.listdir(data_root)):
        city_path = os.path.join(data_root, city)
        if not os.path.isdir(city_path) or city.startswith("."):
            continue
        for network in sorted(os.listdir(city_path)):
            net_path = os.path.join(city_path, network)
            if not os.path.isdir(net_path) or network.startswith("."):
                continue
            if not _has_shapefile(net_path):
                continue
            res_path = (os.path.join(results_root, city, network)
                        if results_root else None)
            datasets.append(describe(net_path, res_path, city=city, network=network))
    return datasets


def _has_shapefile(path: str) -> bool:
    return any(f.lower().endswith(".shp") for f in os.listdir(path))


def describe(net_path: str, results_path: str | None,
             city: str | None = None, network: str | None = None) -> dict:
    """Summarise a dataset folder without parsing its geometry."""
    city = city or os.path.basename(os.path.dirname(net_path))
    network = network or os.path.basename(net_path)
    algos = list_algorithms(results_path)
    return {
        "id": f"{city}/{network}",
        "city": city,
        "network": network,
        "path": net_path,
        "results_path": results_path,
        "has_results": bool(algos),
        "algorithms": algos,
    }


def list_algorithms(results_path: str | None) -> list[dict]:
    """Describe every result CSV available for a dataset, in display order."""
    if not results_path or not os.path.isdir(results_path):
        return []
    stems = sorted(
        (os.path.splitext(f)[0] for f in os.listdir(results_path)
         if f.lower().endswith(".csv")),
        key=algorithms.sort_key,
    )
    return [algorithms.parse(stem) for stem in stems]


# --------------------------------------------------------------------------
# Geometry
# --------------------------------------------------------------------------

def _pick_layers(net_path: str) -> tuple[Layer, Layer | None]:
    """Find the road (polyline) and intersection (point) layers in a folder.

    Selection is by geometry type rather than filename, so uploaded folders do
    not have to follow the ``*RN``/``*nodes`` naming used by the bundled data.
    """
    stems = sorted({os.path.splitext(f)[0] for f in os.listdir(net_path)
                    if f.lower().endswith(".shp")})
    if not stems:
        raise DatasetError(f"no .shp file found in {net_path}")

    roads: Layer | None = None
    nodes: Layer | None = None
    problems: list[str] = []

    for stem in stems:
        try:
            layer = Layer(os.path.join(net_path, stem))
        except (ShapefileError, OSError) as exc:
            problems.append(f"{stem}: {exc}")
            continue
        kinds = {s.shape_type for s in layer.shapes if s.shape_type}
        if kinds & {POLYLINE, 5, 13, 15, 23, 25}:
            if roads is None or len(layer) > len(roads):
                roads = layer
        elif kinds & {POINT, 11, 21}:
            if nodes is None or len(layer) > len(nodes):
                nodes = layer

    if roads is None:
        detail = "; ".join(problems) if problems else "only point layers present"
        raise DatasetError(f"no line geometry found in {net_path} ({detail})")
    return roads, nodes


def _first_value(row: dict[str, Any], layer: Layer, candidates: tuple[str, ...]) -> Any:
    for candidate in candidates:
        field = layer.field(candidate)
        if field is not None and row.get(field) not in (None, ""):
            return row[field]
    return None


def _geometry_length_m(coords: list[tuple[float, float]]) -> float:
    return sum(haversine_metres(coords[i], coords[i + 1])
               for i in range(len(coords) - 1))


def _bearing_deg(a: tuple[float, float], b: tuple[float, float]) -> float:
    """Initial compass bearing from ``a`` to ``b`` in degrees clockwise of north."""
    lat1, lat2 = math.radians(a[1]), math.radians(b[1])
    dlon = math.radians(b[0] - a[0])
    y = math.sin(dlon) * math.cos(lat2)
    x = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(dlon)
    return (math.degrees(math.atan2(y, x)) + 360.0) % 360.0


_DIAGONAL_MARGIN_DEG = 3.0


def _orientation(bearing: float | None) -> tuple[str | None, bool]:
    """Classify a road as North-South or East-West.

    The paper approximates every road to its closest cardinal direction and
    assigns odd numbers to N-S roads and even numbers to E-W roads, so the UI
    needs the same classification to explain a number to a participant.

    Roads sitting within a few degrees of the 45/135 degree diagonal are
    flagged: which side of the boundary they land on is effectively arbitrary,
    so the interface should not tell a participant the algorithm broke the
    odd/even rule on one of them.
    """
    if bearing is None:
        return None, False
    axis = bearing % 180.0
    orientation = "NS" if axis < 45.0 or axis >= 135.0 else "EW"
    near_diagonal = min(abs(axis - 45.0), abs(axis - 135.0)) <= _DIAGONAL_MARGIN_DEG
    return orientation, near_diagonal


def load_network(net_path: str) -> dict:
    """Read a network folder into WGS84 GeoJSON plus descriptive metadata."""
    roads_layer, nodes_layer = _pick_layers(net_path)
    to_lonlat, crs_name = transform_from_wkt(roads_layer.wkt)

    id_field = roads_layer.field("id", "road_id", "edge_id", "fid")

    features: list[dict] = []
    bbox = [180.0, 90.0, -180.0, -90.0]
    total_length = 0.0
    orientation_counts = {"NS": 0, "EW": 0}
    names: set[str] = set()
    named_count = 0

    for seq, (shape, row) in enumerate(roads_layer):
        if not shape.parts:
            continue
        # Every record in these datasets is a single-part polyline; if a
        # multi-part one ever turns up, keep the longest part as the road's
        # representative geometry so the join by road_id stays 1:1.
        part = max(shape.parts, key=len)
        coords = [to_lonlat(x, y) for x, y in part]
        for lon, lat in coords:
            bbox[0] = min(bbox[0], lon)
            bbox[1] = min(bbox[1], lat)
            bbox[2] = max(bbox[2], lon)
            bbox[3] = max(bbox[3], lat)

        road_id = row.get(id_field) if id_field else None
        if road_id is None:
            road_id = seq + 1

        length_m = _geometry_length_m(coords)
        total_length += length_m

        bearing = _first_value(row, roads_layer, ("b_angle",))
        if bearing is None and len(coords) >= 2:
            bearing = _bearing_deg(coords[0], coords[-1])
        bearing = float(bearing) % 360.0 if bearing is not None else None
        orient, near_diagonal = _orientation(bearing)
        if orient:
            orientation_counts[orient] += 1

        name = _first_value(row, roads_layer, _NAME_FIELDS)
        if name:
            names.add(str(name))
            named_count += 1

        props: dict[str, Any] = {
            "road_id": road_id,
            "seq": seq,
            "name": name,
            "category": _first_value(row, roads_layer, _CATEGORY_FIELDS),
            "source": _first_value(row, roads_layer, _SOURCE_FIELDS),
            "target": _first_value(row, roads_layer, _TARGET_FIELDS),
            "length_m": round(length_m, 2),
            "bearing_deg": round(bearing, 2) if bearing is not None else None,
            "orientation": orient,
            "near_diagonal": near_diagonal,
            "attrs": {k: v for k, v in row.items() if v is not None},
        }

        features.append({
            "type": "Feature",
            "id": road_id,
            "geometry": {
                "type": "LineString",
                "coordinates": [[round(lon, 7), round(lat, 7)] for lon, lat in coords],
            },
            "properties": props,
        })

    nodes_geojson = _load_nodes(nodes_layer, to_lonlat) if nodes_layer else None

    return {
        "roads": {"type": "FeatureCollection", "features": features},
        "nodes": nodes_geojson,
        "bbox": bbox if features else None,
        "crs": {"source": crs_name, "output": "WGS 84 (EPSG:4326)"},
        "stats": {
            "road_count": len(features),
            "node_count": len(nodes_geojson["features"]) if nodes_geojson else 0,
            "total_length_km": round(total_length / 1000.0, 2),
            "orientation": orientation_counts,
            "named_roads": named_count,
            "distinct_names": len(names),
            # Street names in this data are sparse or, for Brooklyn, a single
            # value copied across every record. Tell the UI whether they are
            # worth drawing at all - which is itself the paper's premise that
            # most road segments carry no usable name.
            "names_useful": len(names) > 1 and named_count > 1,
            "layers": {
                "roads": roads_layer.name,
                "nodes": nodes_layer.name if nodes_layer else None,
            },
        },
    }


def _load_nodes(layer: Layer, to_lonlat: Transform) -> dict:
    id_field = layer.field("id", "node_id", "fid")
    features = []
    for seq, (shape, row) in enumerate(layer):
        if not shape.parts:
            continue
        lon, lat = to_lonlat(*shape.point)
        node_id = row.get(id_field) if id_field else None
        features.append({
            "type": "Feature",
            "id": node_id if node_id is not None else seq + 1,
            "geometry": {"type": "Point", "coordinates": [round(lon, 7), round(lat, 7)]},
            "properties": {"node_id": node_id if node_id is not None else seq + 1},
        })
    return {"type": "FeatureCollection", "features": features}


# --------------------------------------------------------------------------
# Numbering
# --------------------------------------------------------------------------

def _parse_edge_list(raw: str | None) -> list[int]:
    """Parse the CSV ``edges`` column, which holds a Python-style list literal."""
    if not raw:
        return []
    try:
        value = ast.literal_eval(raw)
    except (ValueError, SyntaxError):
        return []
    if isinstance(value, (list, tuple)):
        return [int(v) for v in value if isinstance(v, (int, float))]
    if isinstance(value, (int, float)):
        return [int(value)]
    return []


def load_numbering(results_path: str, algorithm: str,
                   known_road_ids: set | None = None) -> dict:
    """Load one algorithm's road numbers and index them by road id."""
    csv_path = os.path.join(results_path, f"{algorithm}.csv")
    if not os.path.exists(csv_path):
        raise DatasetError(f"no result file for algorithm '{algorithm}'")

    numbering: dict[str, dict] = {}
    by_seq: dict[int, dict] = {}
    numbers: list[int] = []
    partitions: set[int] = set()
    buckets: dict[int, list] = {}

    with open(csv_path, newline="", encoding="utf-8-sig") as fh:
        for row in csv.DictReader(fh):
            try:
                road_id = int(float(row["road_id"]))
                road_no = int(float(row["road_no"]))
            except (KeyError, TypeError, ValueError):
                continue
            seq = _as_int(row.get("seq"))
            partition = _as_int(row.get("partition"))

            # A handful of partitioned MIDDFS runs leave one road at 0, i.e.
            # never assigned. Flag it so the UI can say "not assigned" rather
            # than presenting "0" to a participant as a real road number.
            entry = {"road_no": road_no, "seq": seq}
            if road_no <= 0:
                entry["unassigned"] = True
            if partition is not None:
                entry["partition"] = partition
                partitions.add(partition)
            edges = _parse_edge_list(row.get("edges"))
            if len(set(edges)) > 1 or len(edges) > 1:
                entry["edges"] = edges

            numbering[str(road_id)] = entry
            if seq is not None:
                by_seq[seq] = entry
            numbers.append(road_no)
            # Roads sharing a number within a partition form one bucket, i.e.
            # one physical road split across several segments.
            buckets.setdefault((partition, road_no) if partition is not None else road_no,
                               []).append(road_id)

    matched = unmatched = 0
    if known_road_ids is not None:
        known = {str(r) for r in known_road_ids}
        matched = len(known & set(numbering))
        unmatched = len(known - set(numbering))
        # Fall back to positional join for any road the id join missed.
        if unmatched and by_seq:
            numbering = dict(numbering)

    multi = {k: v for k, v in buckets.items() if len(v) > 1}
    info = algorithms.parse(algorithm)
    info.update({
        "numbering": numbering,
        "stats": {
            "numbered": len(numbering),
            "matched": matched,
            "unmatched": unmatched,
            "min_number": min((n for n in numbers if n > 0), default=None),
            "max_number": max(numbers) if numbers else None,
            "distinct_numbers": len(set(numbers)),
            "unassigned": sum(1 for n in numbers if n <= 0),
            "odd_count": sum(1 for n in numbers if n % 2),
            "even_count": sum(1 for n in numbers if n > 0 and n % 2 == 0),
            "partition_count": len(partitions),
            "shared_number_groups": len(multi),
        },
    })
    return info


def _as_int(value: Any) -> int | None:
    if value in (None, ""):
        return None
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None
