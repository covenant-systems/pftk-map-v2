#!/usr/bin/env python3
"""
Converts the upstream GeoJSON files (published by the pftk-map repo's
SharePoint sync) into the compact, column-oriented JSON this site loads.

    python scripts/build_data.py [upstream_dir] [out_dir]

Why a separate build step instead of loading the GeoJSON directly:
  - The upstream file is pretty-printed GeoJSON (~800 KB). Rows-as-arrays,
    5-decimal coordinates (~1 m precision) and no whitespace cut that to
    roughly a quarter before gzip.
  - Validation happens once at build time, so a malformed row never ships.
    The browser still escapes every value before rendering it.

Only the fields listed in CHURCH_FIELDS are carried over (an allowlist,
matching the upstream sync script's security model).
"""

import json
import re
import sys
from pathlib import Path

CHURCH_FIELDS = ["id", "name", "lat", "lon", "rating", "address", "url", "maps", "size", "affiliate", "synod", "presbytery"]
SEMINARY_FIELDS = ["name", "city", "address", "denomination", "lat", "lon"]

SIZES = {"XS", "S", "M", "L", "XL"}
SEMINARY_DENOMINATIONS = {
    "ABCUSA", "ELCA", "PC(USA)", "RCA", "TEC", "UCC", "UMC", "Interdenominational",
}

# Google Maps "cid" links are by far the most common shape; storing just
# the number saves ~40 bytes a row. Anything else is kept verbatim.
CID_RE = re.compile(r"^https://(?:www\.)?(?:maps\.)?google\.com/(?:maps)?\?cid=(\d+)$")


def text(value):
    if value is None:
        return None
    s = " ".join(str(value).split())
    return s or None


def coords(feature):
    geom = feature.get("geometry") or {}
    if geom.get("type") != "Point":
        return None
    c = geom.get("coordinates") or []
    if len(c) < 2:
        return None
    lon, lat = c[0], c[1]
    if not all(isinstance(v, (int, float)) for v in (lat, lon)):
        return None
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return None
    return round(lat, 5), round(lon, 5)


def is_truthy(value):
    if value is True or value == 1:
        return True
    return isinstance(value, str) and value.strip().lower() in {"1", "true", "yes", "y", "affiliate", "affiliated"}


def load_regions(path, key):
    """Outlines from build_regions.py as (id, rings, record), each ring with
    its bounding box for a quick reject before the point-in-polygon test."""
    if not path.exists():
        return [], {}
    payload = json.loads(path.read_text(encoding="utf-8"))
    regions = []
    for r in payload[key]:
        rings = []
        for ring in r.get("rings", []):
            lats = [p[0] for p in ring]
            lons = [p[1] for p in ring]
            rings.append((min(lats), max(lats), min(lons), max(lons), ring))
        regions.append((r["id"], rings, r))
    return regions, payload


def region_for(lat, lon, regions):
    """Even-odd test against each region's rings. Points that fall just
    outside every outline (a coastal church past the simplified shoreline)
    go to the region with the nearest vertex."""
    for rid, rings, _ in regions:
        inside = False
        for lat0, lat1, lon0, lon1, r in rings:
            if not (lat0 <= lat <= lat1 and lon0 <= lon <= lon1):
                continue
            for (ya, xa), (yb, xb) in zip(r, r[1:]):
                if (ya > lat) != (yb > lat) and lon < (xb - xa) * (lat - ya) / (yb - ya) + xa:
                    inside = not inside
        if inside:
            return rid
    best, best_d = None, float("inf")
    for rid, rings, _ in regions:
        for *_, r in rings:
            for y, x in r:
                d = (y - lat) ** 2 + (x - lon) ** 2
                if d < best_d:
                    best, best_d = rid, d
    return best


def placer(out):
    """Returns place(id, lat, lon) -> (presbytery, synod). A church's
    presbytery is its recorded one (build_regions.py matched it against the
    full congregation list) or else the outline it sits in; its synod is
    always its presbytery's, so the two levels agree."""
    presbyteries, payload = load_regions(out / "presbyteries.json", "presbyteries")
    synods, _ = load_regions(out / "synods.json", "synods")
    overrides = payload.get("church_overrides", {}) if presbyteries else {}
    synod_of = {rid: rec["synod"] for rid, _, rec in presbyteries}

    def place(church_id, lat, lon):
        if presbyteries:
            pid = overrides.get(church_id) or region_for(lat, lon, presbyteries)
            return pid, synod_of.get(pid)
        return None, region_for(lat, lon, synods) if synods else None
    return place


def build_churches(src, place):
    features = json.loads(src.read_text(encoding="utf-8"))["features"]
    rows, skipped = [], 0
    for i, f in enumerate(features):
        p = f.get("properties") or {}
        point = coords(f)
        name = text(p.get("church_name"))
        if not point or not name:
            skipped += 1
            continue
        try:
            rating = int(p.get("lib_level"))
        except (TypeError, ValueError):
            rating = None
        size = p.get("size_bucket") if p.get("size_bucket") in SIZES else None
        maps = text(p.get("google_maps_url"))
        m = CID_RE.match(maps or "")
        if m:
            maps = m.group(1)
        affiliate = any(is_truthy(p.get(k)) for k in ("affiliate", "affliate", "is_affiliate", "pftk_affiliate"))
        church_id = str(f.get("id") or i)
        presbytery, synod = place(church_id, point[0], point[1])
        rows.append([
            church_id, name, point[0], point[1], rating,
            text(p.get("full_address")), text(p.get("url")), maps, size, 1 if affiliate else 0,
            synod, presbytery,
        ])
    rows.sort(key=lambda r: r[1].lower())
    return {"fields": CHURCH_FIELDS, "rows": rows}, skipped


def build_seminaries(src):
    features = json.loads(src.read_text(encoding="utf-8"))["features"]
    rows, skipped = [], 0
    for f in features:
        p = f.get("properties") or {}
        point = coords(f)
        name = text(p.get("name"))
        denom = p.get("denomination")
        if not point or not name or denom not in SEMINARY_DENOMINATIONS:
            skipped += 1
            continue
        rows.append([name, text(p.get("city")), text(p.get("address")), denom, point[0], point[1]])
    return {"fields": SEMINARY_FIELDS, "rows": rows}, skipped


def write(path, payload):
    path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return path.stat().st_size


def main():
    upstream = Path(sys.argv[1] if len(sys.argv) > 1 else "upstream")
    out = Path(sys.argv[2] if len(sys.argv) > 2 else "data")
    out.mkdir(parents=True, exist_ok=True)

    churches, skipped_c = build_churches(upstream / "PCUSA_Congregations.geojson", placer(out))
    seminaries, skipped_s = build_seminaries(upstream / "seminaries.geojson")
    if not churches["rows"]:
        sys.exit("No valid congregations found; refusing to publish an empty map.")

    size_c = write(out / "churches.json", churches)
    size_s = write(out / "seminaries.json", seminaries)
    print(f"churches.json: {len(churches['rows'])} rows ({skipped_c} skipped), {size_c / 1024:.0f} KB")
    print(f"seminaries.json: {len(seminaries['rows'])} rows ({skipped_s} skipped), {size_s / 1024:.0f} KB")


if __name__ == "__main__":
    main()
