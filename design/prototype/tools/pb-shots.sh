#!/bin/bash
# Pad boards screenshots: bash tools/pb-shots.sh
cd "$(dirname "$0")/.."
S=shots
SHRINK="document.querySelector('[data-k=pb-c-dn]').click(); document.querySelector('[data-k=slot-4]').click();"
GROW="document.querySelector('[data-k=pb-c-up]').click();"
run() { OUT=boards.html node tools/shot.js "$@"; }
run '#/boards' $S/boards-list-960.png 960 1000 &
run '#/boards' $S/boards-list-960-parchment.png 960 1000 parchment &
run '#/boards' $S/boards-list-720.png 720 900 &
run '#/boards' $S/boards-list-1280.png 1280 1000 &
wait
run '#/board/abbey' $S/boards-abbey-960.png 960 1000 &
run '#/board/abbey' $S/boards-abbey-960-parchment.png 960 1000 parchment &
run '#/board/abbey' $S/boards-abbey-720.png 720 900 &
run '#/board/abbey' $S/boards-abbey-1280.png 1280 1000 &
wait
run '#/board/abbey' $S/boards-shrink-960.png 960 1000 '' "$SHRINK" &
run '#/board/abbey' $S/boards-shrink-960-parchment.png 960 1000 parchment "$SHRINK" &
run '#/board/abbey' $S/boards-shrink-720.png 720 900 '' "$SHRINK" &
run '#/board/abbey' $S/boards-grow-960.png 960 1000 '' "$GROW" &
wait
