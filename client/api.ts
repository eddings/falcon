import {scaleLinear, ScaleLinear} from 'd3-scale';
import {debugging} from '../config';
import Cache from './cache';

class API {

  private cache: Cache;
  private activeDimension: string;
  private ranges: {[dimension: string]: Interval} = {};
  private _onResult: any;
  private scales: {[dimension: string]: ScaleLinear<number, number>} = {};

  constructor(public dimensions: Dimension[], public connection: any) {
    this.activeDimension = dimensions[0].name;
    dimensions.forEach(dimension => {
      this.ranges[dimension.name] = dimension.range;
      this.scales[dimension.name] = scaleLinear().domain(dimension.range).range([0, 100]);
    });

    this.cache = new Cache(dimensions.map(d => d.name));
  }

  public init(resolutions: { dimension: string, value: number }[]) {
    if (debugging.logApi) {
      console.log(`API: init ${resolutions.map(r => `${r.dimension}:${r.value}`).join(', ')}`);
    }

    resolutions.forEach((resolution) => {
      const dimension = this.dimensions.find(d => d.name === resolution.dimension);
      if (dimension) {
        this.scales[dimension.name] = scaleLinear().domain(dimension.range).range([0, resolution.value]);
      }
    });

    this.connection.send({
      type: 'init',
      resolutions: resolutions
    });
  }

  public setState(dimension: Dimension, range: Interval) {

    this.setActiveDimension(dimension);
    this.ranges[dimension.name] = range;

    // TODO: This needs to be updated
    //       so that it selects the best approximation
    //       if the exact one isn't available in the cache.
    //
    //       We should also update the onResult handler
    //       so that it sees if incoming results are better
    //       approximations than the current.

    // Convert the range to cache index:
    const scale = this.scales[this.activeDimension];

    const scaledRange = range.map((d) => Math.round(scale(d)));

    const c0 = this.cache.getAll(scaledRange[0]);
    const c1 = this.cache.getAll(scaledRange[1]);

    if (c0.hit && c1.hit) {
      Object.keys(c0.data).forEach(dim => {
        if (!c1.data[dim]) {
          return;
        }

        const data = this.combineRanges(c0.data[dim], c1.data[dim]);
        if (this._onResult) {
          this._onResult(dim, data);
        }
      });
    }

  }

  public setRange(dimension: Dimension, range: Interval) {
    if (debugging.logApi) {
      console.log(`API: setRange ${dimension.name} ${range}`);
    }

    this.setState(dimension, range);
    this.connection.send({
      type: 'setRange',
      dimension: this.activeDimension,
      range: range
    });
  }


  // Call this when you want to request a value
  // to be computed immediately.
  public load(dimension: Dimension, value: number) {
    if (debugging.logApi) {
      console.log(`API: load ${dimension.name} ${value}`);
    }

    this.setActiveDimension(dimension);

    const scale = this.scales[this.activeDimension];
    const index = Math.round(scale(value));

    if (this.cache.hasFullData(index)) {
      return;
    }

    this.connection.send({
      type: 'load',
      dimension: this.activeDimension,
      value: index
    });
  }

  // Call this when you want to suggest how the
  // server should prioritize background queries.
  public preload(dimension: Dimension, value: number) {
    if (debugging.logApi) {
      console.log(`API: preload ${dimension.name} ${value}`);
    }

    this.setActiveDimension(dimension);

    const scale = this.scales[this.activeDimension];
    const index = Math.round(scale(value));

    this.connection.send({
      type: 'preload',
      dimension: this.activeDimension,
      value: index
    });
  }

  public onResult(callback: (dimension: string, data: number[]) => any) {
    this._onResult = callback;
    return (result: Result) => {
      console.log(result);

      // Ignore results from stale queries (wrong dimension)
      if (result.activeDimension === this.activeDimension) {
        this.cache.set(result.index, result.dimension, result.data);

        // This attempts to see if the new result is exactly what
        // the brush is set to now, and if so, updates it.
        const range = this.ranges[this.activeDimension];
        const scale = this.scales[this.activeDimension];
        const scaledRange = range.map(d => Math.round(scale(d)));

        const c0 = this.cache.get(scaledRange[0], result.dimension);
        const c1 = this.cache.get(scaledRange[1], result.dimension);

        if (c0.hit && c1.hit) {
          const combined = this.combineRanges(c0.data, c1.data);
          callback(result.dimension, combined);
        }
      }
    };
  }

  private combineRanges(low: number[], high: number[]) {
    if (low.length !== high.length) {
      throw Error('low and high have to have the same length');
    }

    const data: number[] = [];

    for (let bucket = 0; bucket < low.length; bucket++) {
      data[bucket] = +high[bucket] - low[bucket];

      if (data[bucket] < 0) {
        console.error('Invalid data.');
      }
    }

    return data;
  }

  private setActiveDimension(dimension: Dimension) {
    if (this.activeDimension !== dimension.name) {
      // Clear cache because we only cache 1 dimension at a time.
      this.cache.invalidate();
    }

    this.activeDimension = dimension.name;
  }
}

export default API;