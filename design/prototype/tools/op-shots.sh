#!/bin/sh
# Outputs view screenshots: sh tools/op-shots.sh
cd "$(dirname "$0")/.." || exit 1
export OUT=outputs.html
S=shots
PLAY="L.play('t13',{fade:0}); L.play('b01',{fade:0});"
SIDE="L.botJoin('b2','g1','c2'); await new Promise(r=>setTimeout(r,1300));"
node tools/shot.js '#/outputs' $S/outputs-960.png 960 1000 '' "$PLAY"
node tools/shot.js '#/outputs' $S/outputs-960-parchment.png 960 1000 parchment "$PLAY"
node tools/shot.js '#/outputs' $S/outputs-720.png 720 900 '' "$PLAY"
node tools/shot.js '#/outputs' $S/outputs-1280.png 1280 1000 '' "$PLAY"
node tools/shot.js '#/outputs' $S/outputs-side-960.png 960 1000 '' "(async()=>{ $PLAY $SIDE L.play('t02',{fade:0,target:'b2'}); })()"
node tools/shot.js '#/outputs' $S/outputs-side-960-parchment.png 960 1000 parchment "(async()=>{ $PLAY $SIDE L.play('t02',{fade:0,target:'b2'}); })()"
node tools/shot.js '#/outputs' $S/outputs-side-720.png 720 900 '' "(async()=>{ $PLAY $SIDE })()"
node tools/shot.js '#/outputs' $S/outputs-side-1280.png 1280 1000 '' "(async()=>{ $PLAY $SIDE L.play('t02',{fade:0,target:'b2'}); })()"
node tools/shot.js '#/outputs' $S/outputs-twice-960.png 960 1000 '' "(async()=>{ $PLAY L.botJoin('b2','g1','c1'); await new Promise(r=>setTimeout(r,1300)); })()"
node tools/shot.js '#/outputs' $S/outputs-bring-960.png 960 1000 '' "(async()=>{ $PLAY document.querySelector('[data-k=\"op-bring-c1\"]').click(); })()"
node tools/shot.js '#/outputs' $S/outputs-menu-960.png 960 1000 '' "(async()=>{ $PLAY $SIDE document.querySelector('[data-k=\"op-room-b2\"]').click(); })()"
node tools/shot.js '#/outputs' $S/outputs-livemenu-960.png 960 1000 '' "(async()=>{ $SIDE L.menu(document.querySelector('h1'), L.botsMenuHTML(), 'Discord'); })()"
node tools/shot.js '#/outputs' $S/outputs-collapsed-1280.png 1280 1000 '' "document.querySelector('[data-k=\"pane-op-r-b1\"]').click();"
