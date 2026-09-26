#!/usr/bin/env python3
"""Re-crop only previously failed buildings (tiles now present)."""
import sys, os
sys.path.insert(0, "/Users/lou/beirut/scripts")
from crop_maps import crop_one  # reuse exact crop logic

FAIL_LOG = "/Users/lou/beirut/data/buildings/maps/failures.log"
GEO_PATH = "/Users/lou/beirut/data/buildings_geo.json"

import json
fail_ids = set(int(l.split("\t")[0]) for l in open(FAIL_LOG) if l.strip())
recs = [r for r in json.load(open(GEO_PATH)) if r["id"] in fail_ids]
print(f"re-processing {len(recs)} buildings", flush=True)

fails = []
for rec in recs:
    f = crop_one(rec)
    if f is not None:
        fails.append(f)

# append new failures (keep original log for history)
with open(FAIL_LOG, "a") as fh:
    for bid, reason in fails:
        fh.write(f"{bid}\tRETRY\t{reason}\n")
print(f"ok {len(recs) - len(fails)}, still failed {len(fails)}", flush=True)
for f in fails:
    print("STILL_FAIL", f)