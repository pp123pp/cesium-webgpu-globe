# M6 ocean classification assets

O0 freezes the data source and O1 output contract here. **No runtime mask has
been generated or loaded.** `manifest.json` records real checksums for the
downloaded source files; `runtimeAssets.files` remains empty.

The unique phase-one source is Natural Earth Vector **v5.1.2**, commit
`f1890d9f152c896d250a77557a5751a93d494776`, at **1:10 million cartographic
scale**. “10m” means that scale, not ten-metre spatial resolution. The ocean
and land layer versions are 5.1.1; base lakes is 5.0.0. Data is public domain,
free to acquire, modify and redistribute; no account or token is needed.
Keep [the data terms](LICENSE-NATURAL-EARTH.txt) with generated assets.

Classification codes are `unknown=0`, `ocean=1`, `land=2`, `inland-water=3`.
Natural Earth's ocean layer includes the closed Caspian component. The O0
audit derives the clockwise outer rings from the actual geometry and selects
the component containing the open-Pacific seed `(-150°, 0°)` as global ocean.
Other ocean outer rings are inland water. Lakes override land, land overrides
water components, and unresolved source/shore boundaries are unknown. No
elevation threshold, waterMask or raster flood fill can promote a location
to ocean. This preserves the source's connected bays and straits even if a
coarse mask cannot display their channels.

O1 will generate 128 headerless 512×512 R8 tiles, a 16×8 grid covering an
8192×4096 longitude/latitude raster in OGC:CRS84. Nearest sampling, no mipmaps,
north-to-south rows and periodic longitude are required. Each texel must be
uniformly one processed class over its whole geographic footprint; source
boundaries crossing or wholly inside that footprint make it unknown.
Checking only the centre or four corners misses enclosed small islands.
Artificial source cuts at the date line/poles are periodic/cap boundaries,
not coasts. Details are in the manifest and data audit.

At the equator the grid spacing is about 4.89 km; that is sampling spacing,
not a coastline accuracy claim. Natural Earth's generalized coastlines omit
small islands (the audited Alcatraz point is an observed example), and narrow
channels can become unknown after rasterization. Keep real terrain/island
occlusion: classification alone never authorizes deleting arbitrary terrain.
Only an identified ocean zero-height lid can receive the bounded O1 surface
policy. Fine global coasts, bathymetry, tidal connectivity and sea ice are
outside this dataset's guarantees.

The first output has one level (`level=0`), with no invented parent asset.
Keep already valid data for a tile while replacing/loading it. A real valid
parent may be used if a later level supplies one; otherwise missing data is
unknown and keeps the existing terrain/imagery visible without ocean draw.
All generated tiles are distributable local assets; runtime classification
needs no external data service. The current audit uses downloaded vectors
only and is not O1 rasterization or rendering acceptance.

Reproduce the source audit and small samples using
[the O0 data evidence](../../../../../../../coordination/evidence/M6/O0/data/README.md).
