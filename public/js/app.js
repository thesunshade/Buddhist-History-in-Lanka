/**
 * app.js — initialises the TimelineJS3 widget.
 *
 * The timeline data is loaded from data/timeline.json (a standard HTTP
 * request), which means you must preview the site through a local web server
 * rather than opening index.html directly via file://.
 *
 * Quick local server (run from the project root):
 *   cd public
 *   python -m http.server 8000
 * Then open http://localhost:8000 in your browser.
 *
 * Full option reference:
 *   https://timeline.knightlab.com/#options
 */

(function () {
  "use strict";

  /** Path to the data file, relative to index.html */
  var DATA_URL = "data/timeline.json";

  /**
   * Read --tl-default-bg from CSS (defined in style.css) and convert the
   * comma-separated "R, G, B" string into the object TimelineJS3 expects.
   */
  function getBgColorFromCSS() {
    var raw = getComputedStyle(document.documentElement)
      .getPropertyValue("--tl-default-bg").trim();  // e.g. "255, 255, 255"
    var parts = raw.split(",").map(function (n) { return parseInt(n, 10); });
    return { r: parts[0], g: parts[1], b: parts[2] };
  }

  /** TimelineJS3 configuration options */
  var options = {
    timenav_position: "bottom",
    initial_zoom: 2,
    language: "en",
    default_bg_color: getBgColorFromCSS()   // colour is set in css/style.css --tl-default-bg
  };

  window.addEventListener("DOMContentLoaded", function () {
    /* global TL */
    new TL.Timeline("timeline-embed", DATA_URL, options);
  });

}());

