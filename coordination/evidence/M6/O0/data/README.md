# O0-02 — phase-one ocean classification data audit

Date: 2026-11-06. Source checkout: `157a40eed3290b1abed82c64f4e428209b146958`.
The evidence below describes the O0 changes against that checkpoint. This task changes no
engine JavaScript, runtime raster, rendering result or WebGL behavior.

## Frozen source and legal availability

Use **Natural Earth Vector v5.1.2**, fixed commit
`f1890d9f152c896d250a77557a5751a93d494776`, exclusively for the first global
classification. Download the base `ne_10m_ocean`, `ne_10m_land` and
`ne_10m_lakes` layers from that commit's `10m_physical` directory. The
layer-local versions are **5.1.1, 5.1.1 and 5.0.0**, respectively, not a
fabricated common layer version. “10m” is **1:10 million cartographic scale**,
not ten metres. No paid account, API key or runtime external service is
needed. Redistribution and modification are allowed by the public-domain
data terms; attribution is optional and retained here anyway.

Official sources browsed on 2026-11-06:

- [Data terms](https://www.naturalearthdata.com/about/terms-of-use/): public-domain grant, modification/electronic redistribution/commercial use and accuracy disclaimer.
- [Official repository release](https://github.com/nvkelso/natural-earth-vector/releases/tag/v5.1.2): release tag and fixed commit.
- [Official repository README at that commit](https://github.com/nvkelso/natural-earth-vector/blob/f1890d9f152c896d250a77557a5751a93d494776/README.md): public-domain dataset, generalized linework and release versioning.
- [Ocean](https://www.naturalearthdata.com/downloads/10m-physical-vectors/10m-ocean/), [land](https://www.naturalearthdata.com/downloads/10m-physical-vectors/10m-land/) and [base lakes](https://www.naturalearthdata.com/downloads/10m-physical-vectors/10m-lakes/): layer versions and source limitations. Ocean documentation explicitly flags the Caspian/Garabogaz theme issue. Land documentation flags coastlines in northern Russia and southern Chile.
- [ESRI shapefile format](https://www.esri.com/library/whitepapers/pdfs/shapefile.pdf): the audit's small Polygon-only reader uses the documented header, records, parts and clockwise outer-ring convention. It is scoped to these hashed files, not a new general GIS library.
- [California Department of Fish and Wildlife Alcatraz site sheet](https://filelib.wildlife.ca.gov/Public/OSPR/WebMapping/ACP/dfg_ospr_acp2/pdfs/sensitive_sites/2-402-C.pdf): independent island location used to expose a real omitted-island limitation.

The exact per-file download URLs, SHA256 digests and byte sizes for **21
actually downloaded files** are in
[manifest.json](../../../../../packages/engine/Source/Assets/Textures/WebGPU/Ocean/manifest.json).
The retained [data permission/disclaimer text](../../../../../packages/engine/Source/Assets/Textures/WebGPU/Ocean/LICENSE-NATURAL-EARTH.txt)
has its own checked SHA256 in that manifest. Sources are cached under ignored
`.cache/m6-ocean-natural-earth-v5.1.2/`, not committed. Each layer's SHP, SHX,
DBF, PRJ, CPG, VERSION.txt and README.html was downloaded and hashed; the
audit consumes SHP geometry and verifies the other files as source evidence.
There is no hash for an absent runtime asset.

## Classification and connectivity

Codes: `unknown=0`, `ocean=1`, `land=2`, `inland-water=3`. WGS84 geographic
coordinates use **OGC:CRS84, longitude then latitude in degrees**. No input
here has height, bathymetry or a vertical datum.

The ocean shapefile contains one record, **6,822 rings and two clockwise
outer components**. The implementation derives outer rings from winding;
the open-Pacific seed `(-150°, 0°)` selects the global component. The other
outer component is the closed Caspian/Garabogaz basin. Its ring index 5778
and the global ring's index 0 are **observed audit output**, not business
logic constants. Its bounds are `[46.680430535000085, 36.58270905200004,
54.76742597700007, 47.12091705900008]` degrees. The source lakes layer does
not contain the Caspian; trusting the ocean layer name would flood it.

After exact-boundary handling, lakes override land; land overrides ocean
components; a covered closed component is inland water; a covered component
connected to the seed is ocean; uncovered/conflicting shoreline data is
unknown. Source polygon holes and land islands remain excluded. Lake water
can override continental land polygons because those land polygons are not
cut to all inland lakes. Neither negative elevation nor waterMask can create
ocean. No raster flood fill is used to infer connectivity: a narrowed or
visually closed raster channel cannot convert the Black Sea or a bay to a
lake. This is static current-water connectivity, not a potential tidal zone.

Longitudes wrap to `[-180°, 180°)`. The point audit evaluates the seam from
its canonical interior (`-180° + 1e-9°`) and poles by the cap limit
`±(90° - 1e-9°)`, avoiding the shapefile's artificial map-cut edges. These
epsilon values are numerical cut handling, not claimed coastline accuracy.
The North Pole is ocean regardless of longitude; the South Pole is Antarctic
land. A real shoreline vertex shared by ocean and land returns unknown.

## O1 generation contract — not implemented here

The manifest freezes a single `level=0` output: **8192×4096** global R8
classification, split into **16×8 tiles of 512×512 bytes** at
`coverage/0/{x}/{y}.r8`. It is 33,554,432 bytes uncompressed in total. Tile
indices start at the north-west; rows run north-to-south, columns west-to-east.
Each headerless row-major byte is one class code. Nearest sampling has no
linear blending or mipmaps. The global longitude/latitude steps are both
`0.0439453125°`; equatorial spacing is approximately **4.89 km per texel**.

O1-02 processing must read the pinned shapes, derive the same vector
components, overlay lakes/land/components, and test **the entire texel
footprint**. Any semantic class boundary crossing or wholly enclosed inside
a footprint yields unknown; checking only centre/four corners would miss
small islands. Artificial map cuts do not count as shorelines. Normalize
date-line footprints and polar caps consistently. The point audit below
is not a substitute for this full-footprint rasterization. O1-02 must add its
actual generation command and generated tile hashes before publishing them;
there is deliberately no fake raster-generation command or empty texture.

No parent asset is generated in the initial single level. Keep valid data
for the same tile until its replacement is ready. A real valid parent may
be used if one exists in a later level; otherwise missing/failed coverage is
unknown, preserves terrain/imagery and suppresses ocean drawing. A build
with missing or mismatched input hashes fails instead of publishing all-zero
assets. Package all generated tiles locally so subsequent use is independent
of Natural Earth's servers.

## Actual checks and limitations

`audit-natural-earth.py` uses installed Python 3.14.6 and only its standard
library. The final offline check verifies all 21 source hashes/lengths and
the retained license hash, parses actual vector rings, derives component
connectivity and compares all **26** frozen point classifications with the
checked-in evidence. The samples cover wrapped longitude, both poles,
Antarctica, ocean bays/straits, large/small islands, Baikal/Dead Sea,
Caspian/Garabogaz and dry depressions in Death Valley/Qattara. It also checks
missing-source unknown and a real shared coastline vertex. Every frozen
processed expectation passes; **one geographic discrepancy remains**:
Natural Earth omits the audited Alcatraz island point and classifies it as
ocean. That discrepancy is explicit in `samples-result.json`, not called a
geographic or rendering pass.

Natural Earth provides generalized map data, not a guaranteed absolute
coastline error bound. The 4.89 km grid spacing is an additional sampling
limit. Mixed cells can intentionally suppress narrow sea channels, and
detecting source boundaries cannot restore islands the source omits. The
Golden Gate and Bosphorus vector points pass; their runtime texels are
**unverified** until O1. Retain real terrain/island depth and occlusion even
in source-classified ocean. Only an explicitly identified ocean zero-height
lid may receive O1's bounded surface policy. This audit cannot qualify
global fine coasts, shoreline elevations, seafloor, tide inundation or sea ice.

Exploration history: the first Bosphorus coordinate `(29.05, 41.15)` was on
the western shore, and the first Baikal coordinate `(107.5, 53.5)` was not
lake interior. They were corrected to water-channel/lake-interior inputs
before evidence freezing; those probes are not final failures. The initial
direct ocean-layer classification exposed the real Caspian theme problem,
which is resolved here by derived vector components. The website's old
download links were malformed, GitHub API lookup was rate-limited, and a
direct terms HTML fetch returned HTTP 406; browsing the official terms and
using immutable official repository file URLs succeeded. No source hash was
filled from an unperformed download.

From repository root in PowerShell:

```powershell
# First acquisition only; reads public fixed URLs, writes ignored .cache.
python -B coordination/evidence/M6/O0/data/audit-natural-earth.py --download

# Offline verification against frozen JSON and SHA256SUMS; no network needed.
python -B coordination/evidence/M6/O0/data/audit-natural-earth.py

# Deliberate evidence regeneration after inspecting an authorized input change.
python -B coordination/evidence/M6/O0/data/audit-natural-earth.py --write

git diff --check
```

No runtime tests, build, Full suite or GPU rendering were run: no runtime
code changed, and rasterization/terrain integration belongs to O1-02.
Next action: O0-03 consumers use the corrected classification/connectivity
contract; O1-02 implements and verifies the frozen tiled raster output.
