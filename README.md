# Page Steel Material Management - V11

V11 is a phone-first proof of concept for managing material across a large yard. It brings two kinds of material into one simple system:

- **Tracked inventory:** numbered material with an exact quantity, unit, location code, photo, and map position.
- **Leftovers, offcuts, and scrap:** untracked material found by description, current photo, and last known map location.

The original problem was that useful offcuts and scrap could be found only through one experienced person's memory. V11 captures that practical knowledge so another employee can search, see likely locations, and go directly to the material.

## Live V11

- [Choose a task](https://zhinii.github.io/inventory-map/?v=11)
- [Find scrap](https://zhinii.github.io/inventory-map/scrap.html?v=11)
- [Add or replace a scrap photo](https://zhinii.github.io/inventory-map/collect.html?v=11)
- [Find or update tracked inventory](https://zhinii.github.io/inventory-map/inventory.html?v=11)
- [Add inventory and photo](https://zhinii.github.io/inventory-map/inventory-add.html?v=11)
- [Admin work queue](https://zhinii.github.io/inventory-map/admin.html?v=11)

## What V11 has

- A clear four-task home screen designed for straightforward phone use.
- Photo-based scrap and offcut records with material labels and notes.
- Photo EXIF/GPS reading, phone-location fallback, and manual map correction.
- Map-based search with pins hidden until a search is made.
- Nearby-record checks when replacing an existing scrap photo.
- A 90-day stale-photo rule and administrator refresh tasks.
- Tracked inventory numbers, exact quantities, units, location codes, photos, and coordinates.
- Inventory actions for availability checks, use/removal, receiving, moving, and counting.
- Required inventory updates, transaction history, no-result alerts, and incomplete-update alerts.
- Administrator views for open alerts, resolved history, and recent searches.
- The ability to resolve an alert, inspect it later, and reopen it.
- GitHub Pages hosting, Leaflet maps, and Supabase data/photo storage.

## What V11 does not have

- Verified user accounts, roles, or access-controlled administration.
- Private data hosting; the proof-of-concept site and configured demo access are public.
- ERP, purchasing, barcode, RFID, scale, or accounting integration.
- Automatic identification of material from the image itself.
- Guaranteed indoor or rack-level GPS accuracy; the location code and manual pin remain important.
- Automatic email, text, or push notifications.
- An offline mode, formal backup/recovery process, production monitoring, or a completed field validation program.
- A claim of perfect inventory accuracy; accuracy depends on employees completing updates.

## Build story

The prototype was vibe coded on a phone through an iterative conversation with ChatGPT/AI. Human input defined the yard problem, workflows, terminology, priorities, and usability corrections; AI helped generate and revise the implementation. Total hands-on development time was approximately five hours.

## Current application commit

V11 application baseline:

`66e5448ec93c9f248cf60a79be9fdfb2830ee6be` - `Simplify inventory upload and admin history`

The `?v=11` query value is a cache-busting/version label for the deployed interface. The Git commit above is the exact source baseline verified for the V11 competition package.

## Technology and deployment

- Static HTML, CSS, and JavaScript hosted by GitHub Pages.
- Leaflet with Esri/OpenStreetMap tiles for the yard map.
- Supabase tables and Storage for current records, photos, searches, alerts, and transactions.
- Browser-side EXIF parsing and device geolocation.

The SQL in `supabase/` configures a public proof of concept, not a production security model. Before operational use, add authenticated users and roles, private storage/data policies, backups, monitoring, notification routing, and a field-tested operating procedure.
