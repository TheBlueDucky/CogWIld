#!/bin/bash
# Plays several seeds quickly (tools/video): ./batch.sh <kind> <arena> <tod> <seed...>  -> one RESULT line each
kind=$1; arena=$2; tod=$3; shift 3
for s in "$@"; do timeout 600 npx electron match.js $kind $s $arena $tod 2>/dev/null | grep RESULT | cut -c8-; done
