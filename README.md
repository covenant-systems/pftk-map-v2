# The PftK Map (v2)

A reworked version of [pftk-map](https://github.com/Presbyterians-for-the-Kingdom/pftk-map), deployed side by side so the two can be compared. It uses the same data: every deploy pulls the latest GeoJSON from the upstream repo, so this site needs no SharePoint secrets.

## What's different

**Finding churches**
- Sidebar (desktop) or swipeable bottom sheet (mobile) listing the churches in view, sorted by distance from the map center.
- Search by church name, city, state (code or full name) or ZIP. The map zooms to the matches; Enter opens the first one.
- "Near me" uses the browser's location (it never leaves the device) and sorts the list by miles.
- Filter chips for rating, size and affiliates only, plus a Reset button.
- Seminaries are a toggle layer on the same map. `seminary-map.html` redirects to `?seminaries=1`.

**Synod overview**
- Zoomed out, the map shows PC(USA) synod outlines with a church count in each instead of cluster circles. Clicking a synod zooms in. From zoom level 6 the pins and clusters come back, and the outlines stay as faint borders.
- A Synod filter in the sidebar outlines one synod, dims the rest and filters the list. It can be linked to as `?synod=<id>`.
- Counts follow the rating and size filters. Searching or choosing "Affiliates only" always shows pins.

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

## Synod boundaries

`data/synods.json` is built by `scripts/build_synods.py`, which merges Census county boundaries (us-atlas) into synods. Most synods are whole states. The counties that belong elsewhere are listed in `COUNTY_OVERRIDES`: Southern California, North Idaho and El Paso. `build_data.py` uses the outlines to tag each church with its synod.

**Not yet verified:** the state and county mapping was written without an official PC(USA) source. Before relying on it, check it against PC(USA)'s synod map. The script's docstring lists two known simplifications: eastern Ohio is left in the Synod of the Covenant, and West Virginia's eastern panhandle in the Synod of the Trinity.

## Link preview image

`og-image.png` is the 1200x630 card shown when the link is shared on Facebook, LinkedIn, iMessage, Slack or X. The Open Graph tags in `index.html` point to it. To redraw it from the current data, run `pip install pillow`, then `python scripts/make_og_image.py`. If the site moves to a new URL, update the absolute URLs in those tags.
