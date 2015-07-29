# vt-grid
Build up a pyramid of [Mapbox vector
tiles](https://github.com/mapbox/vector-tile-spec) by aggregating quantitative
data into grids at lower zooms.

## Motivation

Say you have a dataset of polygons that have some kind of density data
(population, vegetation, ...), and you want to build an interactive map with
it.  Vector tiles are great for this--especially with
[mapbox-gl](https://github.com/mapbox/mapbox-gl-js) steadily maturing.

But if your data is at a fine resolution and you don't want to be limited to
very high zoom levels, you're stuck using standard simplification techniques.
For some kinds of data this is just fine, but it's not ideal here: for
instance, in simplification many small, high-density polygons get dropped, even
though these are often important features.

This tool is an alternative to simplification: using a grid whose resolution
varies with zoom level, aggregate the quantitative features of interest, so
that you can visualize the spatial distribution of your data at any scale.


## Installation

```sh
npm install vt-grid
```


## Usage

To start, you'll need an `mbtiles` file containing the original polygon data at
some (high) zoom level.  If you've got the data in, say, a shapefile or
PostGIS, you can use Mapbox Studio to create a source and then export to
MBTiles -- just set the min and max zoom to something high enough, and,
importantly, set the buffer to 0.

Let's say you've got the data in `data.mbtiles`, at zoom 12 in a layer called
`'foo'`, and each polygon in this layer has a field called `density`. Then, you
can build the grid pyramid above this base layer with:

```sh
vt-grid data.mbtiles --basezoom 12 --minzoom 1 --gridsize 16 --layer foo \
 --fields 'density:areaWeightedMean(density)'
```

Starting at zoom 11 and going down to zoom 1, this will build a 16x16 grid in
each tile, aggregating the data from the zoom level above.  The aggregations
are defined by the `--fields` parameters.  Each one is of the form:
`outputField:aggregationFunction(inputField)`, where `aggregationFunction` can
be any of the built-in aggregations available in
[`geojson-polygon-aggregate`](https://github.com/anandthakker/geojson-polygon-aggregate).
So, in this case, we'll end up with a grid where each box has a `density`
property, which is the (correctly weighted) mean of the densities of the
polygons from the previous (higher) zoom level that fall within that box.

With other aggregations, other stats.  For instance, we could have done:

```sh
# first use count() to find out the number of polygons from the original
# dataset being aggregated into each grid box at z11
vt-grid data.mbtiles --basezoom 12 --minzoom 11 --gridsize 16 --layer foo \
  --fields 'density:areaWeightedMean(density)' 'numzones:count()'

# now, for z10 and below, sum the counts
vt-grid data.mbtiles --basezoom 12 --minzoom 11 --gridsize 16 --layer foo \
  --fields 'density:areaWeightedMean(density)' 'numzones:sum(numzones)'
```

