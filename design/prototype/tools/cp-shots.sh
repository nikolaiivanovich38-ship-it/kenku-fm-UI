#!/bin/bash
# Campaigns/Campaign/Session screenshots for the campaigns builder.
cd "$(dirname "$0")/.." && OUT=campaigns.html node src/build.js >/dev/null
S(){ OUT=campaigns.html node tools/shot.js "$@"; }
for r in campaigns campaign/crown session/crown/s14; do n=$(echo $r | tr '/' '-');
  S "#/$r" shots/campaigns-$n-960.png 960 1000
  S "#/$r" shots/campaigns-$n-960-parch.png 960 1000 parchment
  S "#/$r" shots/campaigns-$n-720.png 720 900
  S "#/$r" shots/campaigns-$n-1280.png 1280 1000
done
