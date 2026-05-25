(function (global) {
  "use strict";

  class JsWebpDecoder {
    constructor(decoder) {
      this.decoder = decoder;
    }

    static async create() {
      if (typeof global.PureJsWebpDecoder !== "function") {
        throw new Error("PureJsWebpDecoder is not loaded. Include WebP-dec.js before webp-js-decoder.js.");
      }

      return new JsWebpDecoder(new global.PureJsWebpDecoder());
    }

    async decodeUrl(url) {
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Failed to fetch WebP: ${response.status} ${response.statusText}`);
      }

      return this.decode(await response.arrayBuffer());
    }

    async decode(arrayBuffer) {
      return this.decoder.decode(arrayBuffer);
    }
  }

  global.JsWebpDecoder = JsWebpDecoder;
})(typeof globalThis !== "undefined" ? globalThis : window);
