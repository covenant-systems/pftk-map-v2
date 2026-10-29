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
- Zoomed out, the map shows the 16 PC(USA) synods instead of cluster circles. From zoom level 6 the pins and clusters come back, and the outlines stay as faint borders.
- Each synod has a badge with its church count and is shaded by the average rating of its churches, on a fixed scale from blue (2, Good fit) to green (3, Great fit). Hovering a badge shows the exact average. Badges that would overlap shrink to just their count.
- Clicking a synod, or picking one from the Synod dropdown, filters the map and list to just its churches and frames it. A chip at the top of the map names the synod, and its × shows everything again. A synod can be linked to as `?synod=<id>`.
- Counts and colors follow the rating and size filters. Searching or choosing "Affiliates only" always shows pins.
- Church popups name the church's synod.

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
python scripts/build_data.py   # upstream/*.geojson + synod outlines -> data/*.json
python -m http.server 8000
```

## Deploying

`.github/workflows/pages.yml` runs on push to `main`, every 6 hours, and on demand. It fetches upstream data, rebuilds `data/`, and publishes to GitHub Pages. In the repo's Settings → Pages, set **Source** to **GitHub Actions**.

## Synod boundaries

The map shows synods only, but their outlines are built from presbyteries, because PC(USA) synods are made of presbyteries and those don't always follow state lines. Building them this way puts the Nebraska panhandle in Rocky Mountains, eastern Ohio in Trinity, and West Virginia's eastern panhandle in Mid-Atlantic, which a state-by-state list gets wrong.

`scripts/build_regions.py` writes `data/presbyteries.json` and `data/synods.json`. It runs locally, not in CI, and needs Shapely. It uses Census county boundaries (us-atlas) and the congregation list in the pcusa_map project, which gives a presbytery for each of its 8,606 churches. Only church locations, names, ZIPs and presbyteries are read from that list, and none of it is published.

- Each county goes to the presbytery most of its churches belong to. Empty counties take their neighbors' presbytery. Los Angeles County, which several presbyteries share, is split around individual churches.
- Six non-geographic presbyteries (three Korean American ones, Dakota, Indian Nations, and Sheppards and Lapsley) are left out when drawing boundaries.
- Each presbytery's synod is the majority synod of its churches by state, with Upper Ohio Valley overridden to Trinity. Synod outlines are the union of their presbyteries.
- `build_data.py` gives each church the synod of its presbytery. All 1,503 PftK churches matched an entry in the congregation list, so a church whose real presbytery differs from the outline it sits in still gets the right synod.
- `presbyteries.json` is only a build input. The deploy leaves it out of the site.

**Limitations:** presbyteries that split a county (other than Los Angeles) are approximated at the county line, which can move a synod border by up to a county. Check the presbytery-to-synod assignments against PC(USA)'s directory before relying on them.

## Link preview image

`og-image.png` is the 1200x630 card shown when the link is shared on Facebook, LinkedIn, iMessage, Slack or X. The Open Graph tags in `index.html` point to it. To redraw it from the current data, run `pip install pillow`, then `python scripts/make_og_image.py`. If the site moves to a new URL, update the absolute URLs in those tags.
