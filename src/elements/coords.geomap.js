import {default as d3} from 'd3';
import {default as _} from 'underscore';
import {default as topojson} from 'topojson';
import {utilsDraw} from '../utils/utils-draw';
import {CSS_PREFIX} from '../const';
import {FormatterRegistry} from '../formatter-registry';

var hierarchy = [

    'land',

    'continents',

    'georegions',

    'countries',

    'regions',
    'subunits',
    'states',

    'counties'
];

export class GeoMap {

    constructor(config) {
        super();

        this.config = config;
        this.config.guide = _.defaults(
            this.config.guide || {},
            {
                defaultFill: '#C0C0C0',
                padding: {l: 0, r: 0, t: 0, b: 0},
                showNames: true
            });
    }

    drawLayout(fnCreateScale) {

        var node = this.config;

        var options = node.options;
        var padding = node.guide.padding;

        var innerWidth = options.width - (padding.l + padding.r);
        var innerHeight = options.height - (padding.t + padding.b);

        // y - latitude
        this.latScale = fnCreateScale('pos', node.latitude, [0, innerHeight]);
        // x - longitude
        this.lonScale = fnCreateScale('pos', node.longitude, [innerWidth, 0]);
        // size
        this.sizeScale = fnCreateScale('size', node.size);
        // color
        this.colorScale = fnCreateScale('color', node.color);

        // code
        this.codeScale = fnCreateScale('value', node.code);
        // fill
        this.fillScale = fnCreateScale('fill', node.fill);

        this.W = innerWidth;
        this.H = innerHeight;

        return this;
    }

    drawFrames(frames) {

        var guide = this.config.guide;

        if (typeof (guide.sourcemap) === 'string') {

            d3.json(guide.sourcemap, (e, topoJSONData) => {

                if (e) {
                    throw e;
                }

                this._drawMap(frames, topoJSONData);
            });

        } else {
            this._drawMap(frames, guide.sourcemap);
        }
    }

    _drawMap(frames, topoJSONData) {

        var guide = this.config.guide;
        var options = this.config.options;
        var node = this.config.options.container;

        var latScale = this.latScale;
        var lonScale = this.lonScale;
        var sizeScale = this.sizeScale;
        var colorScale = this.colorScale;

        var codeScale = this.codeScale;
        var fillScale = this.fillScale;

        var groupByCode = frames.reduce(
            (groups, f) => {
                var data = f.take();
                return data.reduce(
                    (memo, rec) => {
                        var key = rec[codeScale.dim];
                        var val = rec[fillScale.dim];
                        memo[key] = val;
                        return memo;
                    },
                    groups);
            },
            {});

        var contours = hierarchy.filter((h) => (topoJSONData.objects || {}).hasOwnProperty(h));

        if (contours.length === 0) {
            throw new Error('Invalid map: should contain some contours');
        }

        var contourToFill;
        if (!fillScale.dim) {

            contourToFill = contours[contours.length - 1];

        } else if (codeScale.georole) {

            if (contours.indexOf(codeScale.georole) === -1) {
                console.log(`There is no contour for georole "${codeScale.georole}"`);
                console.log(`Available contours are: ${contours.join(' | ')}`);

                throw new Error(`Invalid [georole]`);
            }

            contourToFill = codeScale.georole;

        } else {
            console.log('Specify [georole] for code scale');
            throw new Error('[georole] is missing');
        }

        var center;

        if (latScale.dim && lonScale.dim) {
            var lats = d3.extent(latScale.domain());
            var lons = d3.extent(lonScale.domain());
            center = [
                ((lons[1] + lons[0]) / 2),
                ((lats[1] + lats[0]) / 2)
            ];
        }

        var d3Projection = this._createProjection(topoJSONData, contours[0], center);

        var path = d3.geo.path().projection(d3Projection);

        node.append('g')
            .selectAll('path')
            .data(topojson.feature(topoJSONData, topoJSONData.objects[contourToFill]).features)
            .enter()
            .append('path')
            .attr('d', path)
            .attr('fill', (d) => {
                var props = d.properties;
                var codes = ['c1', 'c2', 'c3']
                    .filter((c) => (props.hasOwnProperty(c) && props[c] && groupByCode.hasOwnProperty(props[c])));

                var value;
                if (codes.length === 0) {
                    // doesn't match
                    value = guide.defaultFill;
                } else if (codes.length > 0) {
                    value = fillScale(groupByCode[props[codes[0]]]);
                }

                return value;
            })
            .call(function () {
                // TODO: update map with contour objects names
                this.append('title')
                    .text((d) => {
                        var p = d.properties;
                        return p.name || d.id;
                    });
            });

        var grayScale = ['#fbfbfb', '#fffefe', '#fdfdff', '#fdfdfd', '#ffffff'];
        var reverseContours = contours.reduceRight((m, t) => (m.concat(t)), []);
        reverseContours.forEach((c, i) => {
            node.append('path')
                .datum(topojson.mesh(topoJSONData, topoJSONData.objects[c]))
                .attr('fill', 'none')
                .attr('stroke', grayScale[i])
                .attr('stroke-linejoin', 'round')
                .attr('d', path);
        });

        if (guide.showNames) {
            reverseContours.forEach((c) => {
                var contourFeatures = topojson.feature(topoJSONData, topoJSONData.objects[c]).features || [];
                node.selectAll(`.place-label-${c}`)
                    .data(contourFeatures)
                    .enter()
                    .append('text')
                    .attr('class', `place-label-${c}`)
                    .attr('transform', (d) => `translate(${path.centroid(d)})`)
                    .text((d) => ((d.properties || {}).name));
            });
        }

        if (topoJSONData.objects.hasOwnProperty('places')) {

            path.pointRadius(1.5);

            var placesFeature = topojson.feature(topoJSONData, topoJSONData.objects.places);

            node.append('path')
                .datum(placesFeature)
                .attr('d', path)
                .attr('class', 'place');

            node.selectAll('.place-label')
                .data(placesFeature.features)
                .enter()
                .append('text')
                .attr('class', 'place-label')
                .attr('transform', (d) => `translate(${d3Projection(d.geometry.coordinates)})`)
                .attr('dx', '.35em')
                .attr('dy', '.35em')
                .text((d) => d.properties.name);
        }

        if (!latScale.dim || !lonScale.dim) {
            return [];
        }

        var update = function () {
            return this
                .attr({
                    r: ({data: d}) => sizeScale(d[sizeScale.dim]),
                    transform: ({data: d}) => `translate(${d3Projection([d[lonScale.dim], d[latScale.dim]])})`,
                    class: ({data: d}) => colorScale(d[colorScale.dim]),
                    opacity: 0.5
                });
        };

        var updateGroups = function () {

            this.attr('class', (f) => `frame-id-${options.uid} frame-${f.hash}`)
                .call(function () {
                    var points = this
                        .selectAll('circle')
                        .data(frame => frame.data.map(item => ({data: item, uid: options.uid})));
                    points
                        .exit()
                        .remove();
                    points
                        .call(update);
                    points
                        .enter()
                        .append('circle')
                        .call(update);
                });
        };

        var mapper = (f) => ({tags: f.key || {}, hash: f.hash(), data: f.take()});

        var frameGroups = options.container
            .selectAll('.frame-id-' + options.uid)
            .data(frames.map(mapper), (f) => f.hash);
        frameGroups
            .exit()
            .remove();
        frameGroups
            .call(updateGroups);
        frameGroups
            .enter()
            .append('g')
            .call(updateGroups);

        return [];
    }

    _createProjection(topoJSONData, topContour, center) {

        // The map's scale out is based on the solution:
        // http://stackoverflow.com/questions/14492284/center-a-map-in-d3-given-a-geojson-object

        var width = this.W;
        var height = this.H;
        var guide = this.config.guide;

        var scale = 100;
        var offset = [width / 2, height / 2];

        var mapCenter = center || topoJSONData.center;
        var mapProjection = guide.projection || topoJSONData.projection || 'mercator';

        var d3Projection = this._createD3Projection(mapProjection, mapCenter, scale, offset);

        var path = d3.geo.path().projection(d3Projection);

        // using the path determine the bounds of the current map and use
        // these to determine better values for the scale and translation
        var bounds = path.bounds(topojson.feature(topoJSONData, topoJSONData.objects[topContour]));

        var hscale = scale * width  / (bounds[1][0] - bounds[0][0]);
        var vscale = scale * height / (bounds[1][1] - bounds[0][1]);

        scale = (hscale < vscale) ? hscale : vscale;
        offset = [
            width - (bounds[0][0] + bounds[1][0]) / 2,
            height - (bounds[0][1] + bounds[1][1]) / 2
        ];

        // new projection
        return this._createD3Projection(mapProjection, mapCenter, scale, offset);
    }

    _createD3Projection(projection, center, scale, translate) {

        var d3ProjectionMethod = d3.geo[projection];

        if (!d3ProjectionMethod) {
            console.log(`Unknown projection "${projection}"`);
            console.log(`See available projection types here: https://github.com/mbostock/d3/wiki/Geo-Projections`);
            throw new Error(`Invalid map: unknown projection "${projection}"`);
        }

        var d3Projection = d3ProjectionMethod();

        var steps = [
            {method:'scale', args: scale},
            {method:'center', args: center},
            {method:'translate', args: translate}
        ].filter((step) => step.args);

        // because the Albers USA projection does not support rotation or centering
        return steps.reduce(
            (proj, step) => {
                if (proj[step.method]) {
                    proj = proj[step.method](step.args);
                }
                return proj;
            },
            d3Projection);
    }
}