# The PftK Map (v2)

A reworked version of [pftk-map](https://github.com/Presbyterians-for-the-Kingdom/pftk-map), deployed side by side so the two can be compared. It uses the same data: every deploy pulls the latest GeoJSON from the upstream repo, so this site needs no SharePoint secrets.

## What's different

**Finding churches**
- Sidebar (desktop) or swipeable bottom sheet (mobile) listing the churches in view, sorted by distance from the map center.
- Search by church name, city, state (code or full name) or ZIP. The map zooms to the matches; Enter opens the first one.
- "Near me" uses the browser's location (it never leaves the device) and sorts the list by miles.
- Filter chips for rating, size and affiliates only, plus a Reset button.
- Seminaries are a toggle layer on the same map. `seminary-map.html` redirects to `?seminaries=1`.

**Popups and sharing**
- Rating, size and affiliate status are shown as tags. Directions, Website and Share are buttons.
- Every church has a shareable link (`?church=<id>`) that opens the map on it.
- Pin rings are colored by rating (green 3, blue 2), and affiliates get a gold ring.

**Performance and fixes**
- The data is about 4x smaller (212 KB, down from 805 KB). It's built into compact rows by `scripts/build_data.py`, and the browser starts downloading it with `<link rel="preload">` before the scripts run.
- Removed `refreshClusters()` on every `moveend`. It re-clustered all markers on every pan and zoom.
- Scripts are `defer`red, popups are built lazily, and the list re-renders at most once per frame.
- Fonts now load. The original CSP blocked Google Fonts, so Lexend and Merriweather never rendered.
- `full_address` is now HTML-escaped (the original popup injected it raw).
- Keyboard and screen-reader support: a skip link, focus rings, list items that are real buttons, Escape closes popups, and a live result count.

## Running locally

```bash
python scripts/build_data.py   # upstream/*.geojson -> data/*.json
python -m http.server 8000
```

## Deploying

`.github/workflows/pages.yml` runs on push to `main`, every 6 hours, and on demand. It fetches upstream data, rebuilds `data/`, and publishes to GitHub Pages. In the repo's Settings → Pages, set **Source** to **GitHub Actions**.
