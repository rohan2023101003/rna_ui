"""Reproject the datasets' projected coordinates to WGS84 longitude/latitude.

All three cities ship data in a Transverse Mercator projection (UTM/MGA zones)
but on different datums and zones, which we read straight out of each layer's
``.prj`` sidecar rather than hard-coding per city:

    Brooklyn   NAD83  / UTM zone 18N   (central meridian -75)
    Hyderabad  WGS84  / UTM zone 44N   (central meridian  81)
    Melbourne  GDA2020 / MGA zone 55   (central meridian 147, southern false northing)

GRS80 (NAD83/GDA2020) and WGS84 differ by well under a metre for these
purposes, so the ellipsoid from the ``.prj`` is used directly with no datum
shift. Output is GeoJSON-conformant CRS84 longitude/latitude.

Inverse Transverse Mercator follows Snyder, *Map Projections - A Working
Manual* (USGS Professional Paper 1395), equations 3-6 to 3-24.
"""

from __future__ import annotations

import math
import re
from typing import Callable

Point = tuple[float, float]
Transform = Callable[[float, float], Point]


class ProjectionError(Exception):
    """Raised when a ``.prj`` describes something we cannot invert."""


class TransverseMercator:
    """Inverse Transverse Mercator for one set of projection parameters."""

    def __init__(self, a: float, inv_flattening: float, lon0_deg: float,
                 lat0_deg: float, k0: float, false_easting: float,
                 false_northing: float):
        self.a = a
        self.f = 0.0 if inv_flattening in (0, None) else 1.0 / inv_flattening
        self.lon0 = math.radians(lon0_deg)
        self.lat0 = math.radians(lat0_deg)
        self.k0 = k0
        self.fe = false_easting
        self.fn = false_northing

        self.e2 = 2 * self.f - self.f * self.f
        self.ep2 = self.e2 / (1 - self.e2) if self.e2 < 1 else 0.0
        self.m0 = self._meridional_arc(self.lat0)

    def _meridional_arc(self, phi: float) -> float:
        """Distance along the meridian from the equator to latitude ``phi``."""
        e2 = self.e2
        return self.a * (
            (1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256) * phi
            - (3 * e2 / 8 + 3 * e2 ** 2 / 32 + 45 * e2 ** 3 / 1024) * math.sin(2 * phi)
            + (15 * e2 ** 2 / 256 + 45 * e2 ** 3 / 1024) * math.sin(4 * phi)
            - (35 * e2 ** 3 / 3072) * math.sin(6 * phi)
        )

    def inverse(self, x: float, y: float) -> Point:
        """Map projected ``(easting, northing)`` to ``(longitude, latitude)``."""
        e2, ep2, a = self.e2, self.ep2, self.a

        m = self.m0 + (y - self.fn) / self.k0
        mu = m / (a * (1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256))

        e1 = (1 - math.sqrt(1 - e2)) / (1 + math.sqrt(1 - e2))
        phi1 = (mu
                + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * math.sin(2 * mu)
                + (21 * e1 ** 2 / 16 - 55 * e1 ** 4 / 32) * math.sin(4 * mu)
                + (151 * e1 ** 3 / 96) * math.sin(6 * mu)
                + (1097 * e1 ** 4 / 512) * math.sin(8 * mu))

        sin_phi1 = math.sin(phi1)
        cos_phi1 = math.cos(phi1)
        tan_phi1 = math.tan(phi1)

        # At the poles the series degenerates; the datasets never go there.
        if abs(cos_phi1) < 1e-12:
            return (math.degrees(self.lon0), math.degrees(phi1))

        c1 = ep2 * cos_phi1 ** 2
        t1 = tan_phi1 ** 2
        n1 = a / math.sqrt(1 - e2 * sin_phi1 ** 2)
        r1 = a * (1 - e2) / (1 - e2 * sin_phi1 ** 2) ** 1.5
        d = (x - self.fe) / (n1 * self.k0)

        d2, d4, d6 = d * d, d ** 4, d ** 6
        phi = phi1 - (n1 * tan_phi1 / r1) * (
            d2 / 2
            - (5 + 3 * t1 + 10 * c1 - 4 * c1 ** 2 - 9 * ep2) * d4 / 24
            + (61 + 90 * t1 + 298 * c1 + 45 * t1 ** 2 - 252 * ep2 - 3 * c1 ** 2) * d6 / 720
        )

        d3, d5 = d ** 3, d ** 5
        lam = self.lon0 + (
            d
            - (1 + 2 * t1 + c1) * d3 / 6
            + (5 - 2 * c1 + 28 * t1 - 3 * c1 ** 2 + 8 * ep2 + 24 * t1 ** 2) * d5 / 120
        ) / cos_phi1

        return (math.degrees(lam), math.degrees(phi))


def _wkt_param(wkt: str, name: str) -> float | None:
    match = re.search(
        r'PARAMETER\s*\[\s*"' + re.escape(name) + r'"\s*,\s*(-?[\d.eE+]+)',
        wkt, re.IGNORECASE)
    return float(match.group(1)) if match else None


def _wkt_spheroid(wkt: str) -> tuple[float, float]:
    match = re.search(r'SPHEROID\s*\[\s*"[^"]*"\s*,\s*([\d.eE+]+)\s*,\s*([\d.eE+-]+)',
                      wkt, re.IGNORECASE)
    if not match:
        return 6378137.0, 298.257223563  # WGS84
    return float(match.group(1)), float(match.group(2))


def transform_from_wkt(wkt: str | None) -> tuple[Transform, str]:
    """Build a ``(x, y) -> (lon, lat)`` transform from a ``.prj`` WKT string.

    Returns the transform plus a short human-readable name for the source CRS.
    Unprojected (``GEOGCS``-only) input passes through unchanged.
    """
    if not wkt or not wkt.strip():
        # No sidecar: assume the coordinates are already longitude/latitude.
        return (lambda x, y: (x, y)), "unknown (assumed lon/lat)"

    name_match = re.match(r'\s*(PROJCS|GEOGCS)\s*\[\s*"([^"]*)"', wkt, re.IGNORECASE)
    kind = name_match.group(1).upper() if name_match else ""
    crs_name = name_match.group(2).replace("_", " ") if name_match else "unnamed CRS"

    if kind == "GEOGCS":
        return (lambda x, y: (x, y)), crs_name

    if not re.search(r'PROJECTION\s*\[\s*"Transverse_Mercator"', wkt, re.IGNORECASE):
        projection = re.search(r'PROJECTION\s*\[\s*"([^"]*)"', wkt, re.IGNORECASE)
        found = projection.group(1) if projection else "none"
        raise ProjectionError(
            f'unsupported projection "{found}" in {crs_name}; '
            "only Transverse_Mercator (UTM/MGA) is implemented")

    a, inv_f = _wkt_spheroid(wkt)
    proj = TransverseMercator(
        a=a,
        inv_flattening=inv_f,
        lon0_deg=_wkt_param(wkt, "Central_Meridian") or 0.0,
        lat0_deg=_wkt_param(wkt, "Latitude_Of_Origin") or 0.0,
        k0=_wkt_param(wkt, "Scale_Factor") or 1.0,
        false_easting=_wkt_param(wkt, "False_Easting") or 0.0,
        false_northing=_wkt_param(wkt, "False_Northing") or 0.0,
    )
    return proj.inverse, crs_name


def haversine_metres(a: Point, b: Point) -> float:
    """Great-circle distance between two ``(lon, lat)`` points, in metres."""
    r = 6371008.8
    lon1, lat1 = math.radians(a[0]), math.radians(a[1])
    lon2, lat2 = math.radians(b[0]), math.radians(b[1])
    dlon, dlat = lon2 - lon1, lat2 - lat1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * r * math.asin(min(1.0, math.sqrt(h)))
