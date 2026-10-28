#!/usr/bin/env python3
"""
Builds data/synods.json, the PC(USA) synod outlines drawn on the map,
by merging US county boundaries into synods.

    curl -fsSL https://cdn.jsdelivr.net/npm/us-atlas@3.0.1/counties-10m.json -o counties-10m.json
    python scripts/build_synods.py counties-10m.json

us-atlas is the Census Bureau's 1:10m cartographic boundary file as
TopoJSON. Synod boundaries change rarely, so the output is committed and
this only needs re-running if SYNODS below changes. build_data.py reads
the output to tag each church with its synod.

Most synods are whole states. Where one isn't, the counties that belong
elsewhere are listed in COUNTY_OVERRIDES.

VERIFY: this mapping was written from general knowledge, not from an
official PC(USA) source. Check it against pcusa.org's synod map before
relying on it, especially the overrides and these known simplifications:
  - Eastern Ohio counties in Upper Ohio Valley presbytery (Synod of the
    Trinity) are left in the Synod of the Covenant.
  - West Virginia's eastern panhandle (Shenandoah presbytery, Synod of the
    Mid-Atlantic) is left in the Synod of the Trinity.
"""

import json
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# id, display name, short label for map badges, state FIPS codes
SYNODS = [
    ("alaska-northwest", "Synod of Alaska-Northwest", "Alaska-NW", ["02", "53"]),
    ("covenant", "Synod of the Covenant", "Covenant", ["26", "39"]),
    ("lakes-prairies", "Synod of Lakes and Prairies", "Lakes & Prairies", ["19", "27", "31", "38", "46", "55"]),
    ("lincoln-trails", "Synod of Lincoln Trails", "Lincoln Trails", ["17", "18"]),
    ("living-waters", "Synod of Living Waters", "Living Waters", ["01", "21", "28", "47"]),
    ("mid-america", "Synod of Mid-America", "Mid-America", ["20", "29"]),
    ("mid-atlantic", "Synod of the Mid-Atlantic", "Mid-Atlantic", ["10", "11", "24", "37", "51"]),
    ("northeast", "Synod of the Northeast", "Northeast", ["09", "23", "25", "33", "34", "36", "44", "50"]),
    ("pacific", "Synod of the Pacific", "Pacific", ["06", "16", "32", "41"]),
    ("rocky-mountains", "Synod of the Rocky Mountains", "Rocky Mtns", ["08", "30", "49", "56"]),
    ("south-atlantic", "Synod of South Atlantic", "South Atlantic", ["12", "13", "45"]),
    ("southern-california-hawaii", "Synod of Southern California and Hawaii", "So. Cal & Hawaii", ["15"]),
    ("southwest", "Synod of the Southwest", "Southwest", ["04", "35"]),
    ("sun", "Synod of the Sun", "Sun", ["05", "22", "40", "48"]),
    ("trinity", "Synod of the Trinity", "Trinity", ["42", "54"]),
    ("boriquen", "Synod of Boriquén in Puerto Rico", "Boriquén", ["72"]),
]

# County FIPS -> synod id, for counties outside their state's default synod.
COUNTY_OVERRIDES = {
    # Southern California (VERIFY the Kern / San Luis Obispo edge)
    **{f"06{c}": "southern-california-hawaii" for c in [
        "025",  # Imperial
        "037",  # Los Angeles
        "059",  # Orange
        "065",  # Riverside
        "071",  # San Bernardino
        "073",  # San Diego
        "079",  # San Luis Obispo
        "083",  # Santa Barbara
        "111",  # Ventura
    ]},
    # North Idaho, in Inland Northwest presbytery (VERIFY)
    **{f"16{c}": "alaska-northwest" for c in [
        "009", "017", "021", "035", "049", "055", "057", "061", "069", "079",
    ]},
    # El Paso area, in Sierra Blanca presbytery (VERIFY)
    "48141": "southwest",  # El Paso
    "48229": "southwest",  # Hudspeth
}

SIMPLIFY_DEG = 0.012   # Douglas-Peucker tolerance, about 1 km
PRECISION = 3          # decimal places kept in output coordinates


def decode_arcs(topo):
    """Returns arcs as lists of absolute quantized (x, y) integer points."""
    arcs = []
    for arc in topo["arcs"]:
        x = y = 0
        pts = []
        for dx, dy in arc:
            x += dx
            y += dy
            pts.append((x, y))
        arcs.append(pts)
    return arcs


def polygons_of(geom):
    if geom["type"] == "Polygon":
        return [geom["arcs"]]
    if geom["type"] == "MultiPolygon":
        return geom["arcs"]
    return []


def merge_rings(geoms, arcs):
    """Outer boundary of a set of polygons, stitched end to end into closed
    rings (what topojson.merge does). Each arc's net direction decides:
    a shared border is walked once each way and cancels out. Counting net
    direction rather than "used once" survives the odd arc the source file
    uses three times."""
    net = defaultdict(int)
    for g in geoms:
        for poly in polygons_of(g):
            for ring in poly:
                for i in ring:
                    if i >= 0:
                        net[i] += 1
                    else:
                        net[~i] -= 1
    pieces = []
    for idx, n in net.items():
        pts = arcs[idx] if n > 0 else arcs[idx][::-1]
        pieces.extend([pts] * abs(n))

    by_start = defaultdict(list)
    for n, p in enumerate(pieces):
        by_start[p[0]].append(n)
    used = set()
    rings = []
    for n, p in enumerate(pieces):
        if n in used:
            continue
        used.add(n)
        ring = list(p)
        while ring[-1] != ring[0]:
            nxt = next((m for m in by_start[ring[-1]] if m not in used), None)
            if nxt is None:
                break
            used.add(nxt)
            ring.extend(pieces[nxt][1:])
        if len(ring) >= 4 and ring[-1] == ring[0]:
            rings.append(ring)
    return rings


def simplify(points, tol):
    if len(points) < 3:
        return points
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        a, b = stack.pop()
        ax, ay = points[a]
        bx, by = points[b]
        dx, dy = bx - ax, by - ay
        norm = (dx * dx + dy * dy) ** 0.5
        best, best_d = None, tol
        for i in range(a + 1, b):
            px, py = points[i]
            if norm:
                d = abs(dy * px - dx * py + bx * ay - by * ax) / norm
            else:
                d = ((px - ax) ** 2 + (py - ay) ** 2) ** 0.5
            if d > best_d:
                best, best_d = i, d
        if best is not None:
            keep[best] = True
            stack.append((a, best))
            stack.append((best, b))
    return [p for p, k in zip(points, keep) if k]


def ring_area(ring):
    return sum(x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in zip(ring, ring[1:])) / 2


def ring_centroid(ring):
    a = ring_area(ring)
    if not a:
        return ring[0]
    cx = sum((x1 + x2) * (x1 * y2 - x2 * y1) for (x1, y1), (x2, y2) in zip(ring, ring[1:])) / (6 * a)
    cy = sum((y1 + y2) * (x1 * y2 - x2 * y1) for (x1, y1), (x2, y2) in zip(ring, ring[1:])) / (6 * a)
    return cx, cy


def point_in_ring(x, y, ring):
    inside = False
    for (x1, y1), (x2, y2) in zip(ring, ring[1:]):
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            inside = not inside
    return inside


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    topo = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    sx, sy = topo["transform"]["scale"]
    tx, ty = topo["transform"]["translate"]
    arcs = decode_arcs(topo)

    state_to_synod = {st: sid for sid, _, _, states in SYNODS for st in states}
    groups = defaultdict(list)
    for g in topo["objects"]["counties"]["geometries"]:
        fips = g.get("id")
        if not fips:
            continue
        sid = COUNTY_OVERRIDES.get(fips) or state_to_synod.get(fips[:2])
        if sid:
            groups[sid].append(g)

    churches = json.loads((ROOT / "data" / "churches.json").read_text(encoding="utf-8"))
    fi = {n: i for i, n in enumerate(churches["fields"])}
    points = [(r[fi["lon"]], r[fi["lat"]]) for r in churches["rows"]]

    out = []
    for sid, name, short, _ in SYNODS:
        rings = []
        for ring in merge_rings(groups[sid], arcs):
            lonlat = [(x * sx + tx, y * sy + ty) for x, y in ring]
            # Wrap the Aleutians that cross the antimeridian onto the west.
            lonlat = [(lon - 360 if lon > 0 and sid == "alaska-northwest" else lon, lat) for lon, lat in lonlat]
            s = simplify(lonlat, SIMPLIFY_DEG)
            if len(s) >= 4 and abs(ring_area(s)) > 0.0005:
                rings.append([[round(lat, PRECISION), round(lon, PRECISION)] for lon, lat in s])
        if not rings:
            continue

        # Badge goes on the ring holding the most churches (WA rather than
        # Alaska, mainland rather than Hawaii), falling back to the largest.
        def weight(r):
            xy = [(lon, lat) for lat, lon in r]
            lons = [p[0] for p in xy]
            lats = [p[1] for p in xy]
            n = sum(1 for x, y in points
                    if min(lons) <= x <= max(lons) and min(lats) <= y <= max(lats) and point_in_ring(x, y, xy))
            return n, abs(ring_area(xy))
        main_ring = max(rings, key=weight)
        cx, cy = ring_centroid([(lon, lat) for lat, lon in main_ring])
        out.append({
            "id": sid,
            "name": name,
            "short": short,
            "label": [round(cy, 3), round(cx, 3)],
            "rings": rings,
        })

    path = ROOT / "data" / "synods.json"
    path.write_text(json.dumps({"synods": out}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"synods.json: {len(out)} synods, {sum(len(s['rings']) for s in out)} rings, {path.stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    main()
