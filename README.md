# Page Steel Material Inventory Map

A lightweight public proof of concept for capturing the geographic knowledge of a large, unstructured material yard.

The first goal is not a perfect count of every piece. It is to help someone who does not know the yard answer:

> Where should I start looking for this material?

## Live prototype

After GitHub Pages is enabled:

**https://zhinii.github.io/inventory-map/**

## Included

- Leaflet map centered on the supplied Page Steel pin.
- Satellite and OpenStreetMap layers.
- Hidden inventory pins until a search is performed.
- Weighted text search using material, geometry, aliases, appearance, descriptions, tags, landmarks, and knowledge notes.
- Clearly marked demonstration records.
- Browser-side EXIF/GPS extraction from original photos.
- Draggable correction from camera position to material position.
- Manual site-boundary tracing.
- JSON export for inventory and site data.
- Automatic GitHub Pages deployment workflow.

## Enable GitHub Pages

1. Upload this project to the repository root.
2. Open **Settings → Pages**.
3. Set **Source** to **GitHub Actions**.
4. Open **Actions** and wait for **Deploy static site to Pages** to finish.

## Field workflow

1. Open `collect.html` on the published site.
2. Choose untouched original camera photos.
3. Confirm which photos contain GPS.
4. Drag each marker from the camera position onto the photographed pile when needed.
5. Enter material, geometry, description, ordinary names, landmarks, and experienced-worker notes.
6. Export `inventory.json`.
7. Put the original photos in `images/` without renaming them.
8. Replace `data/inventory.json` with the export and commit.

## Boundary

Thirteen Google Maps short links are preserved in `data/site.json`, but their coordinates are not fabricated. Trace the boundary in `collect.html`, export `site.json`, and replace the existing file.

## Public-data warning

This is a public repository and public GitHub Pages site. Any committed photographs, coordinates, and inventory data are publicly accessible, even though the interface hides markers until search.
