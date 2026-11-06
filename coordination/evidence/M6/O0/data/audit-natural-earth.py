"""Reproduce the O0 vector-point audit; this does not generate runtime masks."""

import argparse
import hashlib
import json
from pathlib import Path
import struct
import urllib.request


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--download", action="store_true", help="fetch missing pinned sources")
    parser.add_argument("--write", action="store_true", help="regenerate sample evidence")
    args = parser.parse_args()
    evidence = Path(__file__).resolve().parent
    root = evidence.parents[4]
    assets = root / "packages/engine/Source/Assets/Textures/WebGPU/Ocean"
    manifest = json.loads((assets / "manifest.json").read_text())
    assert hashlib.sha256((assets / manifest["license"]["textFile"]).read_bytes()).hexdigest() == manifest["license"]["textSha256"]
    assert manifest["runtimeAssets"]["status"] == "NOT_GENERATED"
    assert manifest["runtimeAssets"]["files"] == []
    cache = root / manifest["audit"]["sourceCache"]
    if args.download:
        cache.mkdir(parents=True, exist_ok=True)
    checked = []
    for layer in manifest["source"]["layers"]:
        for source in layer["files"]:
            path = cache / source["file"]
            if args.download and not path.exists():
                with urllib.request.urlopen(source["url"], timeout=60) as response:
                    path.write_bytes(response.read())
            data = path.read_bytes()
            digest = hashlib.sha256(data).hexdigest()
            assert digest == source["sha256"], f"source checksum mismatch: {path}"
            assert len(data) == source["bytes"], f"source size mismatch: {path}"
            checked.append({"file": source["file"], "sha256": digest})
    polygons = {name: load_polygons(cache / f"ne_10m_{name}.shp") for name in ("ocean", "land", "lakes")}
    components = ocean_components(polygons["ocean"])
    inputs = json.loads((evidence / "samples-input.json").read_text())
    samples = []
    for sample in inputs:
        actual, hits = classify(sample["longitudeDegrees"], sample["latitudeDegrees"], polygons, components)
        assert actual == sample["expectedClass"], f"{sample['id']}: expected {sample['expectedClass']}, got {actual} ({hits})"
        samples.append({**sample, "actualClass": actual, "layerMembership": hits,
                        "geographicAgreement": actual == sample["geographicClass"]})
    assert classify(0, 0, {})[0] == "unknown"
    assert all(sample["actualClass"] == "ocean" for sample in samples if sample["id"].startswith("date-wrap-"))
    result = {
        "schemaVersion": 1,
        "sourceId": manifest["sourceId"],
        "sourceCommit": manifest["source"]["commit"],
        "method": "direct-vector-point-classification; no raster generated",
        "checkedSourceFiles": checked,
        "geometry": {name: {"records": len(records), "rings": sum(len(rings) for _, rings in records)} for name, records in polygons.items()},
        "oceanTopology": [{"ringIndex": index, "globalOcean": connected, "bounds": bounds} for index, connected, bounds, _ in components],
        "missingSourceCheck": {"class": "unknown", "oceanDrawAllowed": False},
        "samples": samples,
    }
    output = (json.dumps(result, indent=2, ensure_ascii=False) + "\n").encode("utf-8")
    destination = evidence / "samples-result.json"
    digest = hashlib.sha256(output).hexdigest()
    hashes = f"{digest}  samples-result.json\n".encode("ascii")
    if args.write:
        destination.write_bytes(output)
        (evidence / "SHA256SUMS.txt").write_bytes(hashes)
    else:
        assert destination.read_bytes() == output, "sample evidence differs; inspect before regenerating"
        assert (evidence / "SHA256SUMS.txt").read_bytes() == hashes
    limits = [sample["id"] for sample in samples if not sample["geographicAgreement"]]
    print(json.dumps({"checkedSourceFiles": len(checked), "samples": len(samples), "knownSourceLimitations": limits, "resultSha256": digest}))


def load_polygons(path):
    data = path.read_bytes()
    assert struct.unpack_from(">i", data)[0] == 9994
    assert struct.unpack_from(">i", data, 24)[0] * 2 == len(data)
    assert struct.unpack_from("<2i", data, 28) == (1000, 5)
    records = []
    offset = 100
    while offset < len(data):
        _, words = struct.unpack_from(">2i", data, offset)
        body = memoryview(data)[offset + 8:offset + 8 + words * 2]
        assert struct.unpack_from("<i", body)[0] == 5
        bounds = struct.unpack_from("<4d", body, 4)
        parts, count = struct.unpack_from("<2i", body, 36)
        starts = [*struct.unpack_from(f"<{parts}i", body, 44), count]
        points = list(struct.iter_unpack("<2d", body[44 + parts * 4:]))
        assert len(points) == count
        rings = []
        for index in range(parts):
            ring = points[starts[index]:starts[index + 1]]
            assert ring[0] == ring[-1]
            xs, ys = zip(*ring)
            rings.append(((min(xs), min(ys), max(xs), max(ys)), ring))
        records.append((bounds, rings))
        offset += 8 + words * 2
    assert offset == len(data)
    return records


def ocean_components(records):
    assert len(records) == 1, "audit is scoped to the pinned Natural Earth ocean record"
    outers = [(index, bounds, ring) for index, (bounds, ring) in enumerate(records[0][1])
              if sum(ax * by - bx * ay for (ax, ay), (bx, by) in zip(ring, ring[1:])) < 0]
    connected = [index for index, bounds, ring in outers if in_bounds(-150, 0, bounds) and in_ring(-150, 0, ring) == 1]
    assert len(connected) == 1
    return [(index, index in connected, bounds, ring) for index, bounds, ring in outers]


def classify(longitude, latitude, polygons, components=()):
    longitude = (longitude + 180) % 360 - 180
    # The file has artificial cuts at the periodic seam and at the two poles.
    if longitude == -180:
        longitude += 1e-9
    latitude = min(90 - 1e-9, max(-90 + 1e-9, latitude))
    hits = {name: membership(longitude, latitude, records) for name, records in polygons.items()}
    lake = hits.get("lakes", "outside")
    land = hits.get("land", "outside")
    ocean = hits.get("ocean", "outside")
    if lake == "boundary" or land == ocean == "boundary":
        return "unknown", hits
    if lake == "inside":
        return "inland-water", hits
    if land != "outside":
        return "land", hits
    if ocean != "outside":
        for _, connected, bounds, ring in components:
            if in_bounds(longitude, latitude, bounds) and in_ring(longitude, latitude, ring) == 1:
                hits["oceanConnectivity"] = "global-ocean" if connected else "closed-inland"
                return "ocean" if connected else "inland-water", hits
    return "unknown", hits


def membership(x, y, records):
    boundary = False
    for bounds, rings in records:
        if not in_bounds(x, y, bounds):
            continue
        inside = False
        record_boundary = False
        for bounds, ring in rings:
            if not in_bounds(x, y, bounds):
                continue
            state = in_ring(x, y, ring)
            record_boundary |= state == -1
            inside ^= state == 1
        if inside and not record_boundary:
            return "inside"
        boundary |= record_boundary
    return "boundary" if boundary else "outside"


def in_bounds(x, y, bounds):
    return bounds[0] <= x <= bounds[2] and bounds[1] <= y <= bounds[3]


def in_ring(x, y, ring):
    inside = False
    for (ax, ay), (bx, by) in zip(ring, ring[1:]):
        cross = (x - ax) * (by - ay) - (y - ay) * (bx - ax)
        if abs(cross) <= 1e-12 * max(1, abs(bx - ax), abs(by - ay)) and min(ax, bx) <= x <= max(ax, bx) and min(ay, by) <= y <= max(ay, by):
            return -1
        if (ay > y) != (by > y) and x < (bx - ax) * (y - ay) / (by - ay) + ax:
            inside = not inside
    return 1 if inside else 0


if __name__ == "__main__":
    main()
