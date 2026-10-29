#!/usr/bin/env python3
"""
Builds the presbytery and synod outlines drawn on the map:
data/presbyteries.json and data/synods.json.

    pip install shapely
    curl -fsSL https://cdn.jsdelivr.net/npm/us-atlas@3.0.1/counties-10m.json -o counties-10m.json
    python scripts/build_regions.py counties-10m.json path/to/pcusa_map/data/churches.json

Inputs:
  - us-atlas counties: the Census Bureau's 1:10m county boundaries as TopoJSON.
  - The pcusa_map congregation list (8,600+ PC(USA) churches with their
    presbytery). Only lat, lon, church_name, address_zip and presbytery
    are read; nothing else from it reaches the output.

How the boundaries are made:
  1. Every county goes to the presbytery most of its churches belong to.
     Non-geographic presbyteries (NON_GEOGRAPHIC) don't vote, because they
     overlap the geographic ones.
  2. A county genuinely shared by presbyteries (Los Angeles) is split
     instead: each church gets the area closer to it than to any other
     church (a Voronoi cell), and the cells join their church's presbytery.
  3. A county won by one or two churches, with no neighbour in the same
     presbytery, is treated as noise and joins its neighbours.
  4. Counties with no churches take the most common presbytery among their
     neighbours, repeated until every county has one. Islands with no
     neighbours join the nearest presbytery in their state.
  5. Each presbytery's synod is the majority synod of its churches under
     the state-level SYNODS table, plus PRESBYTERY_SYNOD overrides.
     Synod outlines are the union of their presbyteries, so the two
     levels always nest.

Other presbyteries that split a county are approximated at the county line.

The output is committed; this runs locally, not in CI. Re-run it when
presbytery boundaries change or after big changes to either input.
build_data.py reads the output to tag each church with its presbytery
and synod.
"""

import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

import shapely
from shapely.geometry import MultiPoint, Point, Polygon

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

# County FIPS -> synod for counties outside their state's usual synod. Only
# used to vote on each presbytery's synod (step 5), so it only has to be
# right for the majority of a presbytery's churches.
COUNTY_SYNOD = {
    **{f"06{c}": "southern-california-hawaii" for c in [
        "025", "037", "059", "065", "071", "073", "079", "083", "111",
    ]},
}

# Presbyteries whose churches mostly sit in a state of a different synod.
PRESBYTERY_SYNOD = {
    "Upper Ohio Valley": "trinity",
}

# Language and ethnic presbyteries overlap the geographic ones. Their
# churches still count toward their own presbytery and synod; they just
# don't shape the map.
NON_GEOGRAPHIC = {
    "Atlantic Korean American",
    "Eastern Korean American",
    "Midwest Korean American",
    "Dakota",
    "Indian Nations",
    "Sheppards And Lapsley",
}

# A county is split (step 2) when its runner-up presbytery has at least
# this many churches and this share of the county's churches.
SPLIT_MIN_CHURCHES = 10
SPLIT_MIN_SHARE = 0.15

SIMPLIFY_DEG = 0.012   # about 1 km
MIN_AREA = 0.0005      # square degrees; drops specks of islands
PRECISION = 3          # decimal places kept in output coordinates


def slug(name):
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def display_name(name):
    name = name.replace(" And ", " and ")
    name = name[0].upper() + name[1:]
    return name if name.startswith("Presbiterio") else name + " Presbytery"


def norm(s):
    return re.sub(r"[^a-z0-9]+", " ", str(s or "").lower()).strip()


# ---------- Geometry ----------

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


def county_shape(g, arcs, to_lonlat):
    alaska = g["id"].startswith("02")
    polys = []
    for poly in polygons_of(g):
        rings = []
        for ring in poly:
            pts = []
            for i in ring:
                a = arcs[i] if i >= 0 else arcs[~i][::-1]
                pts.extend(a if not pts else a[1:])
            lonlat = [to_lonlat(p) for p in pts]
            if alaska:  # Aleutians across the antimeridian go west
                lonlat = [(lon - 360 if lon > 0 else lon, lat) for lon, lat in lonlat]
            rings.append(lonlat)
        if len(rings[0]) >= 4:
            polys.append(Polygon(rings[0], [r for r in rings[1:] if len(r) >= 4]))
    return shapely.make_valid(shapely.union_all(polys)) if polys else None


def polygons(geom):
    if geom.is_empty:
        return []
    if geom.geom_type == "Polygon":
        return [geom]
    return [p for g in getattr(geom, "geoms", []) for p in polygons(g)]


def to_rings(geom):
    """Shapely geometry -> list of [lat, lon] rings for Leaflet. Holes are
    separate rings; the browser fills with the even-odd rule."""
    rings, exteriors = [], []
    for poly in polygons(geom.simplify(SIMPLIFY_DEG, preserve_topology=True)):
        if poly.area < MIN_AREA:
            continue
        for k, ring in enumerate([poly.exterior, *poly.interiors]):
            coords = [[round(lat, PRECISION), round(lon, PRECISION)] for lon, lat in ring.coords]
            if len(coords) >= 4:
                rings.append(coords)
                if k == 0:
                    exteriors.append(Polygon([(lon, lat) for lat, lon in coords]))
    return rings, exteriors


def label_for(exteriors, points):
    """Badge position: inside the part holding the most PftK churches
    (Washington rather than Alaska), falling back to the largest part.
    representative_point() is always inside, unlike a centroid."""
    main = max(exteriors, key=lambda p: (sum(1 for pt in points if p.contains(pt)), p.area))
    pt = main.representative_point() if not main.contains(main.centroid) else main.centroid
    return [round(pt.y, 3), round(pt.x, 3)]


def main():
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    topo = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    source = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))
    sx, sy = topo["transform"]["scale"]
    tx, ty = topo["transform"]["translate"]
    arcs = decode_arcs(topo)
    to_lonlat = lambda p: (p[0] * sx + tx, p[1] * sy + ty)

    counties = {}
    arc_owner = defaultdict(set)
    for g in topo["objects"]["counties"]["geometries"]:
        if not g.get("id") or not polygons_of(g):
            continue
        shape = county_shape(g, arcs, to_lonlat)
        if shape is None or shape.is_empty:
            continue
        counties[g["id"]] = shape
        for poly in polygons_of(g):
            for ring in poly:
                for i in ring:
                    arc_owner[i if i >= 0 else ~i].add(g["id"])
    neighbours = defaultdict(set)
    for owners in arc_owner.values():
        for f in owners:
            neighbours[f] |= owners - {f}

    fips_list = list(counties)
    tree = shapely.STRtree([counties[f] for f in fips_list])

    def county_at(lon, lat):
        hits = tree.query(Point(lon, lat), predicate="intersects")
        return fips_list[hits[0]] if len(hits) else None

    # 1. Majority vote.
    sf = {n: i for i, n in enumerate(source["fields"])}
    votes = defaultdict(Counter)
    county_churches = defaultdict(list)
    source_churches = []
    unplaced = 0
    for r in source["rows"]:
        lat, lon, presby = r[sf["lat"]], r[sf["lon"]], r[sf["presbytery"]]
        if not presby or lat is None or lon is None:
            continue
        fips = county_at(lon, lat)
        source_churches.append((r, fips))
        if fips is None:
            unplaced += 1
        elif presby not in NON_GEOGRAPHIC:
            votes[fips][presby] += 1
            county_churches[fips].append((lon, lat, presby))
    county_presby = {f: v.most_common(1)[0][0] for f, v in votes.items()}

    # 2. Split shared counties into per-church Voronoi cells.
    pieces = defaultdict(list)
    split = []
    for f, v in votes.items():
        top = v.most_common(2)
        n = sum(v.values())
        if len(top) < 2 or top[1][1] < SPLIT_MIN_CHURCHES or top[1][1] / n < SPLIT_MIN_SHARE:
            continue
        split.append(f)
        sites = {}
        for lon, lat, presby in county_churches[f]:
            sites.setdefault((round(lon, 5), round(lat, 5)), presby)
        keys = list(sites)
        cells = shapely.voronoi_polygons(MultiPoint(keys), extend_to=counties[f].envelope.buffer(0.5), ordered=True)
        for key, cell in zip(keys, cells.geoms):
            piece = cell.intersection(counties[f])
            if not piece.is_empty:
                pieces[sites[key]].append(piece)

    # 3. Smooth one- and two-church outliers before filling, so they don't spread.
    smoothed = 0
    for f, v in votes.items():
        if sum(v.values()) <= 2:
            around = Counter(county_presby[n] for n in neighbours[f] if n in county_presby)
            if around and county_presby[f] not in around:
                county_presby[f] = around.most_common(1)[0][0]
                smoothed += 1

    # 4. Fill empty counties from their neighbours, then islands by distance.
    while True:
        changed = False
        for f in counties:
            if f in county_presby:
                continue
            around = Counter(county_presby[n] for n in neighbours[f] if n in county_presby)
            if around:
                county_presby[f] = around.most_common(1)[0][0]
                changed = True
        if not changed:
            break
    for f in counties:
        if f in county_presby:
            continue
        same_state = [g for g in county_presby if g[:2] == f[:2]]
        if same_state:
            near = min(same_state, key=lambda g: counties[g].distance(counties[f]))
            county_presby[f] = county_presby[near]
    leftover = [f for f in counties if f not in county_presby]

    # 5. Presbytery -> synod.
    state_synod = {st: sid for sid, _, _, states in SYNODS for st in states}
    synod_votes = defaultdict(Counter)
    for r, fips in source_churches:
        if fips:
            synod_votes[r[sf["presbytery"]]][COUNTY_SYNOD.get(fips) or state_synod.get(fips[:2])] += 1
    presby_synod = {p: PRESBYTERY_SYNOD.get(p) or v.most_common(1)[0][0] for p, v in synod_votes.items()}

    # Presbytery shapes.
    parts = defaultdict(list)
    for f, p in county_presby.items():
        if f not in split:
            parts[p].append(counties[f])
    for p, ps in pieces.items():
        parts[p].extend(ps)
    presby_geom = {p: shapely.union_all(ps) for p, ps in parts.items()}

    # PftK churches: used for badge placement, and to record the ones whose
    # real presbytery isn't the outline they sit in (language presbyteries,
    # county-line approximations).
    pftk = json.loads((ROOT / "data" / "churches.json").read_text(encoding="utf-8"))
    pf = {n: i for i, n in enumerate(pftk["fields"])}
    points = [Point(r[pf["lon"]], r[pf["lat"]]) for r in pftk["rows"]]

    by_key = {}
    for r, _ in source_churches:
        by_key[(norm(r[sf["church_name"]]), str(r[sf["address_zip"]] or "")[:5].zfill(5))] = r
    shape_names = list(presby_geom)
    shape_tree = shapely.STRtree([presby_geom[p] for p in shape_names])
    overrides = {}
    matched = 0
    for r, pt in zip(pftk["rows"], points):
        zip_match = re.search(r"\b(\d{3,5})(?:-\d{4})?$", r[pf["address"]] or "")
        zip5 = zip_match.group(1).zfill(5) if zip_match else ""
        src = by_key.get((norm(r[pf["name"]]), zip5))
        if src is None:
            # Nearest source church within ~300 m sharing the first word of its name.
            best, best_d = None, 0.003 ** 2
            first = norm(r[pf["name"]]).split(" ")[0]
            for s, _ in source_churches:
                d = (s[sf["lat"]] - r[pf["lat"]]) ** 2 + (s[sf["lon"]] - r[pf["lon"]]) ** 2
                if d < best_d and norm(s[sf["church_name"]]).split(" ")[0] == first:
                    best, best_d = s, d
            src = best
        if src is None:
            continue
        matched += 1
        real = src[sf["presbytery"]]
        hits = shape_tree.query(pt, predicate="intersects")
        if not any(shape_names[h] == real for h in hits):
            overrides[r[pf["id"]]] = slug(real)

    presbyteries = []
    for p in sorted(set(presby_synod)):
        entry = {
            "id": slug(p),
            "name": display_name(p),
            "short": p.replace(" And ", " & ").replace("Presbiterio ", ""),
            "synod": presby_synod[p],
            "geographic": p not in NON_GEOGRAPHIC,
        }
        if p in presby_geom:
            rings, exteriors = to_rings(presby_geom[p])
            if rings:
                entry["label"] = label_for(exteriors, points)
                entry["rings"] = rings
        presbyteries.append(entry)

    synod_parts = defaultdict(list)
    for p, geom in presby_geom.items():
        synod_parts[presby_synod[p]].append(geom)
    synods = []
    for sid, name, short, _ in SYNODS:
        if not synod_parts[sid]:
            continue
        rings, exteriors = to_rings(shapely.union_all(synod_parts[sid]))
        if rings:
            synods.append({"id": sid, "name": name, "short": short, "label": label_for(exteriors, points), "rings": rings})

    def write(name, payload):
        path = ROOT / "data" / name
        path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        return path.stat().st_size / 1024

    kb_p = write("presbyteries.json", {"presbyteries": presbyteries, "church_overrides": overrides})
    kb_s = write("synods.json", {"synods": synods})
    print(f"source churches: {len(source_churches)} ({unplaced} outside every county)")
    print(f"counties: {len(county_presby)} assigned, {len(split)} split {split}, {smoothed} smoothed, "
          f"{len(leftover)} left over {leftover[:8]}")
    print(f"presbyteries.json: {len(presbyteries)} presbyteries, "
          f"{sum(1 for p in presbyteries if 'rings' in p)} with outlines, {kb_p:.0f} KB")
    print(f"synods.json: {len(synods)} synods, {kb_s:.0f} KB")
    print(f"PftK churches matched to the source list: {matched}/{len(pftk['rows'])}, overrides: {len(overrides)}")


if __name__ == "__main__":
    main()
