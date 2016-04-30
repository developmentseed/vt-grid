#!/usr/bin/env bash

node osm-roads.js | ./summarize elapsed:mean elapsed:standard_deviation data.layers.layer:mean > results/osm-roads.ndjson
