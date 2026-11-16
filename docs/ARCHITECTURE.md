# Tacit Soul — architecture notes

Target server: Komari 1.6.1.

## Design decisions

1. All settings live in the in-theme settings page (`/theme-settings`). `komari-theme.json` declares
   `configuration.type = "redirect"` so the admin menu entry opens that page. No managed form.
2. Globe: The cobe dot globe, with flag markers, highlighted countries and arcs drawn on top
   (see "Globe view"). An earlier globe.gl / three.js earth was dropped.
3. Group tabs + region bar are shared by the card, matrix and table views.
4. Matrix card: layout, sizes and data colours of the matrix layer; surfaces/borders/text follow clean / deepspace.
5. Verification: guest-level reads of a live Komari through the read-only gateway; logged-in flows on
   a throwaway loopback-only Komari 1.6.1 container.

## Layout

- `src/` — base (palettes: clean = `:root`, deepspace = `[data-theme="deepspace"]`).
- `src/matrix/` — matrix view code, imports use `@/matrix/x`,
  CSS custom properties prefixed `--ts-` so they cannot collide with the base tokens.
  Boundary modules are adapters onto the base data layer (single polling loop, single RPC client):
  `services/nodeStore.ts`, `hooks/useNode.ts`, `hooks/useThemeSettings.ts`, `hooks/usePreferences.ts`.
- One ping model for every view: matrix view bindings (`homepagePingBindings`, three-line mode).
  Simulated latency is deliberately not implemented.
- Views: globe / grid (card) / matrix (matrix card) / table (tabular rows) / uptime.

## Facts verified against a live server (read-only, Komari 1.6.1)

- `net_out` = upload, `net_in` = download: 119 of 132 samples matched `net_out == report.network.up`,
  0 matched the reverse. The base adapter had them swapped; fixed in `src/services/api.ts`.

## Storage keys

- `appearance` — Komari's shared key: `light` | `dark` | `system` (clean / deepspace / follow OS).
  Legacy `clean`, `deepspace`, `auto` values are remapped on read.

## Matrix layer — adapter design

The matrix view code talks to the rest of the app only through the boundary modules below:

| Module (under `src/matrix/`) | Role |
|---|---|
| `services/rpc2Client.ts` | Thin wrapper over the base `rpc2Client` (one RPC connection for the whole app); maps the base's typed RPC error to the matrix layer's `RpcResponseError`. |
| `services/nodeStore.ts` | External store fed from the base node list (`useMatrixNodeSync`, layout effect in the view container). Holds matrix-shaped meta / metrics / 18-sample traffic trend per node. No second polling loop. |
| `hooks/useNode.ts` | `useNodeCardSnapshots`, `useVisibleNodeUuids`, `useAllNodeMeta` on top of the store. |
| `utils/themeSettings.ts`, `hooks/useThemeSettings.ts` | Normalise the raw `theme_settings` record (from the base `AppConfig`) into the fields the matrix code reads. Result is memoised by JSON signature so effects do not restart on every settings refresh. |
| `hooks/useAuth.ts`, `hooks/usePreferences.ts`, `hooks/useMetricColors.ts`, `hooks/useVisibleNodes.ts` | Login state, applied appearance (`light`/`dark`), constant colour version, empty theme-level hidden list. |
| `hooks/useHomeFilterOrder.ts` | Drag-reorder persistence through read–merge–write. |
| `styles/tokens.css` | `--ts-*` tokens: data colours are the matrix layer's values; surfaces, borders and text map onto the base tokens. |

Rules that keep this safe:

- Settings are only ever written when the server reports `theme === "TacitSoul"`; in development against
  another theme's instance every write path is disabled (and the dev gateway refuses writes anyway).
- Appearance for canvas redraws comes from an "applied appearance" store that flips *after* the
  `data-theme` / `data-appearance` attributes are on `<html>`, so canvases never cache the previous
  palette's colours.
- Simulated latency is not implemented.
- Nothing under `src/matrix` is imported by the entry chunk; views that need it are lazy.

Setting keys: base theme `snake_case`, matrix layer `camelCase`.

## Shared list chrome (phase 2)

- `components/fleet/ClusterStatusPanel.tsx` — cluster card: online rate, one block per
  node (two-part bar from 51 nodes), total bandwidth, up / down canvas charts. Chart points come from
  `lib/fleetRateHistory.ts`, fed by the app on each *live* poll (never the offline cache, never seeded).
- `components/fleet/FleetFilterBars.tsx` — group tabs + region chips; selection in
  `lib/fleetFilter.ts` so card / matrix / table share it. The old group dropdown is gone.
- Matrix view = `NodeList` with `defaultView="matrix"` → lazy `matrix/MatrixGrid.tsx`.

## Card and table views (phase 4)

- One latency source for every view: `matrix/hooks/useNodeLatency.ts` reads the matrix store
  with the matrix card's selection rules (three-line mode → the node's line 1; else the single
  binding; else "not configured"). `useLatencyFeed` keeps the matrix node store in step with the
  app's node list and registers one more consumer of the single poller.
- The store got a store-wide change signal (`usePingStoreVersion`) and a plain read
  (`readPingSnapshot`) so the table can sort by latency
  with one subscription.
- Card view = `components/cards/` : 2×2 capsule bars with
  60 / 80 % thresholds, latency / loss sparklines over the last hour, live speeds,
  chips for tags / group / expiry / price, offline overlay. Settings keys:
  `cardProgressLayout` (`2col` / `1col`), `trafficSplitColor`.
- Table view = `components/table/` : 10-segment bars with tiered colours, 20 latency
  history blocks, traffic badge (SUM / OUT / IN / MAX / MIN, ∞ when unlimited), expiry + price.
  Sorting (react-table, missing values last) and window virtualisation stay from the base. Below a
  1366 px viewport the rows stack.
- The base card / table and their per-node CPU sparkline poller (`useRecentStats`) are removed.
- White-field flags get a hairline outline in the light palette (global rule in `index.css`).

## Globe view

- Base: cobe 2.0.1 dot globe (same palette, map density, spin, radar sweep and rings).
  An earlier globe.gl / three.js earth was removed; its overlays stay:
- `components/globe/cobeProjection.ts` reproduces cobe's projection (unit vector, phi / theta
  rotation, radius 0.8 × scale) — tests pin it against cobe's own anchor maths and d3-geo.
- `components/globe/DotGlobe.tsx`: one render loop drives cobe and the overlays together:
  country fills / outlines of regions with nodes (2D canvas, d3-geo orthographic with cobe's exact
  rotation, clipped at the horizon), hub-and-spoke arcs (lifted great circles, faint line plus a
  travelling dash, hidden behind the sphere), flag markers (HTML, positioned per frame; hover /
  selection scale through a CSS variable inside the transform so a flag scales about its own
  centre). Selecting a node turns the globe the short way round and opens the region card.
- Regions / outlines: `earth/earthRegions.ts` (world-countries centroids, sea-locked overrides) and
  `earth/earthPolygons.ts` (world-atlas 110m; discs for territories missing at that scale).
- Settings keep their keys: `globe_mode`, `globe_respect_reduced_motion`, `globe_marker_style`
  (rich = flags + pulses, calm = flags, lite = status dots), `globe_hub_node`.
- Frame budget: spin 30 / 20 fps, arcs alone 20 fps, idle → no frames, full rate while dragging or
  turning; paused when hidden / off screen; below 8 fps at full rate the globe stops spinning.
- Bundle: cobe (~13 KB) + d3-geo instead of globe.gl + three (~1.9 MB); no textures.

## Finishing pass (phase 6)

- Interface text of the matrix layer: every visible zh-Hans literal is wrapped in `tsText()`; `src/matrix/i18n/tsText.ts` holds English and
  Traditional Chinese (OpenCC cn→twp, reviewed), `tsTextKeys.json` lists the wrapped keys and a test
  fails when one has no English entry. Developer-only console warnings stay in Chinese.
- One unit system theme-wide: sizes and speeds are 1024-based and labelled KB / MB / GB (as
  Komari's own web UI); speeds keep three significant digits and are promoted at 1000, so a value
  reads the same in the footer, sidebar, cards, matrix, table and globe.
- Three-line task labels drop a trailing protocol note ("（TCP 80）") so names fit; the row title
  keeps the full name.
