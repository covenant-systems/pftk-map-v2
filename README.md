# The PftK Map (v2)

A reworked version of [pftk-map](https://github.com/Presbyterians-for-the-Kingdom/pftk-map), deployed side by side so the two can be compared. It uses the same data: every deploy pulls the latest GeoJSON from the upstream repo, so this site needs no SharePoint secrets.

## What's different

**Finding churches**
- Sidebar (desktop) or swipeable bottom sheet (mobile) listing the churches in view, sorted by distance from the map center.
- Search by church name, city, state (code or full name) or ZIP. The map zooms to the matches; Enter opens the first one.
- "Near me" uses the browser's location (it never leaves the device) and sorts the list by miles.
- Filter chips for rating, size and affiliates only, plus a Reset button.
- Seminaries are a toggle layer on the same map. `seminary-map.html` redirects to `?seminaries=1`.

**Synods and presbyteries**
- The map has three levels. Zoomed all the way out, it shows the 16 synods. From about state level (zoom 5) it shows presbyteries, with synod borders drawn on top. From about metro level (zoom 7.5) the pins and clusters come back, and the outlines stay as faint borders.
- Each synod or presbytery shows a badge with its church count and is shaded by the average rating of its churches, on a fixed scale from blue (2, Good fit) to green (3, Great fit). Hovering a badge shows the exact average. Presbyteries with fewer than 5 rated churches are drawn paler, because one or two ratings can swing their color.
- Clicking a synod zooms in to its presbyteries, and clicking a presbytery zooms in to its pins. Badges that would overlap shrink to just their count, and crowded presbytery badges hide until you zoom in.
- Synod and Presbytery filters in the sidebar. Picking a synod shows its presbyteries and narrows the presbytery list. Picking a presbytery shows its pins. Both can be linked to: `?synod=<id>`, `?presbytery=<id>`.
- Counts and colors follow the rating and size filters. Searching or choosing "Affiliates only" always shows pins.
- Church popups name the church's presbytery and synod.

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
python scripts/build_data.py   # upstream/*.geojson + region outlines -> data/*.json
python -m http.server 8000
```

## Deploying

`.github/workflows/pages.yml` runs on push to `main`, every 6 hours, and on demand. It fetches upstream data, rebuilds `data/`, and publishes to GitHub Pages. In the repo's Settings → Pages, set **Source** to **GitHub Actions**.

## Presbytery and synod boundaries

`data/presbyteries.json` and `data/synods.json` are built by `scripts/build_regions.py`. It runs locally, not in CI, and needs Shapely. It uses Census county boundaries (us-atlas) and the congregation list in the pcusa_map project, which gives a presbytery for each of its 8,606 churches. Only church locations, names, ZIPs and presbyteries are read from that list, and none of it is published.

- Each county goes to the presbytery most of its churches belong to. Empty counties take their neighbors' presbytery. Los Angeles County, which several presbyteries share, is split around individual churches.
- Six non-geographic presbyteries (three Korean American ones, Dakota, Indian Nations, and Sheppards and Lapsley) are left out when drawing boundaries. Their churches are still tagged with them.
- Each presbytery's synod is the majority synod of its churches by state, with Upper Ohio Valley overridden to Trinity. Synod outlines are the union of their presbyteries, so the two levels always nest.
- All 1,503 PftK churches matched an entry in the congregation list. When a church's real presbytery differs from the outline it sits in, the real one is recorded, and `build_data.py` uses it.

**Limitations:** presbyteries that split a county (other than Los Angeles) are approximated at the county line. Snake River Presbytery has only one church in the source list, so it has no outline. Check the presbytery-to-synod assignments against PC(USA)'s directory before relying on them.

## Link preview image

`og-image.png` is the 1200x630 card shown when the link is shared on Facebook, LinkedIn, iMessage, Slack or X. The Open Graph tags in `index.html` point to it. To redraw it from the current data, run `pip install pillow`, then `python scripts/make_og_image.py`. If the site moves to a new URL, update the absolute URLs in those tags.
