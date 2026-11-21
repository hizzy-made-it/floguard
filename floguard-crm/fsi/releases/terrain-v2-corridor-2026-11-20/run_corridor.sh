#!/bin/bash
# Watershed-by-watershed terrain v2 for the lead corridor, pruning tile caches as it goes.
set -u
cd /home/claude/wt/main/floguard-crm/fsi
D=data/leads; D2=data/leads2m; P=data/leads/parts; mkdir -p $P
BIG=030802010700
log(){ echo "[$(date +%H:%M:%S)] $*" >> $P/driver.log; }
HUCS=$(python3 -c "
import json,collections;t=json.load(open('$D/plan.json'))['tiles'];c=collections.Counter()
for x in t: c[x['huc12']]+=x['height']*x['width']
print(' '.join(h for h,_ in sorted(c.items(),key=lambda x:x[1]) if h!='$BIG'))")
run_group(){ # dir huc tag
  local dir=$1 huc=$2 tag=$3
  if [ -f $P/zonal_$tag.csv ]; then log "skip $tag (done)"; return; fi
  log "terrain $tag"
  python3 -m pipeline.terrain_v2_run terrain --data-dir $dir --remote-dem --only $huc >> $P/terrain_$tag.log 2>&1 || { log "TERRAIN FAIL $tag"; return; }
  log "zonal $tag"
  python3 -m pipeline.terrain_v2_run zonal --data-dir $dir >> $P/zonal_$tag.log 2>&1 || { log "ZONAL FAIL $tag"; return; }
  mv $dir/zonal.csv $P/zonal_$tag.csv; mv $dir/street_pts.npy $P/street_$tag.npy
  rm -rf $dir/tiles/${huc}_*
  log "done $tag $(($(wc -l < $P/zonal_$tag.csv)-1)) parcels; disk free $(df -h / | awk 'NR==2{print $4}')"
}
for h in $HUCS; do run_group $D $h $h; done
# big watershed at 2 m in its own working dir
mkdir -p $D2; for f in huc12.gpkg nhd_flowlines.gpkg parcels.gpkg dem_1m_manifest.json dem_13_manifest.json roads; do [ -e $D2/$f ] || ln -s ../leads/$f $D2/$f; done
[ -f $D2/plan.json ] || python3 -m pipeline.terrain_v2_run plan --data-dir $D2 --cell 2 --chunk-m 3000 >> $P/plan2m.log 2>&1
run_group $D2 $BIG ${BIG}_2m
log "ALL GROUPS DONE"
