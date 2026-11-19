/*!
 * tl-nav-toggle.js — v1.1.1
 *
 * A small, dependency-free add-on for TimelineJS3 (https://timeline.knightlab.com)
 * that collapses the navigation bar and hands the freed-up height back to the
 * slides. Ships with a "tab" control that sits on the top-left corner of the
 * navigation — a chevron on narrow screens, chevron + "timeline" on wide ones.
 *
 * ---------------------------------------------------------------------------
 * WHY CSS ALONE DOESN'T WORK
 * ---------------------------------------------------------------------------
 * `display: none` on `.tl-timenav` really does hide the nav — but the space it
 * occupied is *not* CSS layout space. TL.Timeline._updateDisplay() computes the
 * size of both halves in JavaScript and writes them as inline pixel heights:
 *
 *     nav.style.height         = timenav_height
 *     storyslider.style.height = containerHeight - timenav_height
 *
 * So the story slider keeps its short inline height and you're left with an
 * empty band where the nav used to be. Because those numbers are recomputed on
 * every resize (and every call to timeline.updateDisplay()), no amount of CSS
 * `height: 100%` survives either.
 *
 * This script fixes it at the source: it wraps the (private, but stable)
 * `_calculateTimeNavHeight()` method so that, while the nav is collapsed,
 * TimelineJS itself believes the nav is 0px tall. It then asks TimelineJS to
 * run its normal layout pass, which grows the story slider to the full
 * container height. Everything else (markers, zoom, slides) is untouched, so
 * showing the nav again restores the exact original layout.
 *
 * ---------------------------------------------------------------------------
 * USAGE
 * ---------------------------------------------------------------------------
 *   <link rel="stylesheet" href=".../timeline.css">
 *   <script src=".../timeline.js"></script>        <!-- TimelineJS3 -->
 *   <script src="tl-nav-toggle.js"></script>
 *
 *   var timeline = new TL.Timeline('timeline-embed', data, {
 *     timenav_position: 'bottom'                   // the tab assumes a bottom nav
 *   });
 *
 *   new TLNavToggle(timeline);                     // visible by default, tab UI
 *
 *   navToggle.hide();  navToggle.show();  navToggle.toggle();
 *
 * See README.md for the full list of options and events.
 *
 * License: MIT
 */
(function (root, factory) {
  if (typeof define === "function" && define.amd) {
    define([], factory);
  } else if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.TLNavToggle = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var VERSION = "1.1.1";
  var STYLE_ID = "tlnav-toggle-styles";
  var EVENT_NAME = "tlnav:toggle";

  /** TL.Timeline instance -> controller (so calling twice is harmless). */
  var registry = new WeakMap();
  var uid = 0;

  var DEFAULTS = {
    /* state */
    hidden: false, // the navigation is visible by default
    animate: true, // ease the collapse/expand
    duration: 280, // ms
    /* chrome */
    hideMenuBar: true, // the zoom in/out buttons only drive the nav
    hideAttribution: false, // keep Knight Lab's credit unless you ask
    /* the control */
    button: true, // true | false | element | selector | "inline"
    buttonStyle: "tab", // "tab" (edge tab) | "pill" (floating corner button)
    label: "timeline", // tab caption, hidden below `compactBelow`
    compactBelow: 560, // container px width that drops the caption
    buttonPosition: "top-right", // pill only
    hideText: "Hide timeline",
    showText: "Show timeline",
    mount: null, // element/selector to put the control in
    /* extras */
    storageKey: null, // e.g. "tl-nav-hidden" — remember the choice
    onChange: null, // function (hidden, controller, timeline) {}
  };

  /* ------------------------------------------------------------------ *
   * Tiny helpers
   * ------------------------------------------------------------------ */

  function extend(target) {
    for (var i = 1; i < arguments.length; i++) {
      var src = arguments[i];
      if (!src) continue;
      for (var key in src) {
        if (Object.prototype.hasOwnProperty.call(src, key) && src[key] !== undefined) {
          target[key] = src[key];
        }
      }
    }
    return target;
  }

  function toElement(value) {
    if (!value) return null;
    if (typeof value === "string") return document.querySelector(value);
    if (value.nodeType === 1) return value;
    return null;
  }

  function prefersReducedMotion() {
    try {
      return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch (e) {
      return false;
    }
  }

  var CHEVRON_SVG = '<svg viewBox="0 0 20 20" width="14" height="14" focusable="false" aria-hidden="true">' + '<path d="M4.5 7.5 10 13l5.5-5.5" fill="none" stroke="currentColor" ' + 'stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  /* ------------------------------------------------------------------ *
   * Finding the TL.Timeline object
   * ------------------------------------------------------------------ */

  /**
   * TimelineJS keeps no back-reference from the container element to the
   * Timeline object, so we add one the first time this script sees
   * `TL.Timeline`. That makes `new TLNavToggle('#timeline-embed')` work for
   * timelines created *after* this script loaded.
   */
  function tagContainer(instance) {
    try {
      if (instance && instance._el && instance._el.container) {
        instance._el.container.__tlNavToggleTimeline = instance;
      }
    } catch (e) {
      /* never let the hook break the timeline */
    }
  }

  /**
   * TimelineJS keeps no back-reference from the container element to the
   * Timeline object, so we add one. Two hooks, because timing matters:
   *
   *  - `_loadStyles` / `_loadLanguage` run *synchronously inside the
   *    constructor*, so the container is tagged the moment
   *    `new TL.Timeline(...)` returns. That is what makes
   *    `new TLNavToggle('#timeline-embed')` work immediately, before the data
   *    has loaded.
   *  - `_initLayout` runs when the timeline builds its DOM (after the data
   *    arrives), which covers timelines that were re-initialised.
   *
   * (Replacing TL.Timeline itself is not an option: the distributed bundle
   * exposes it as a getter-only export.)
   */
  function hookTimelineClass() {
    var TL = window.TL;
    if (!TL || typeof TL.Timeline !== "function") return false;

    var proto = TL.Timeline.prototype;
    if (!proto || proto.__tlnavToggleHooked) return true;

    ["_loadStyles", "_loadLanguage", "_initLayout"].forEach(function (name) {
      var original = proto[name];
      if (typeof original !== "function" || original.__tlnavToggleWrapped) return;

      var wrapped = function () {
        tagContainer(this);
        return original.apply(this, arguments);
      };
      wrapped.__tlnavToggleWrapped = true;
      proto[name] = wrapped;
    });

    proto.__tlnavToggleHooked = true;
    return true;
  }

  function resolveTimeline(target) {
    if (!target) return null;

    // 1. A TL.Timeline instance was passed directly.
    if (target._el && target._el.container && typeof target._calculateTimeNavHeight === "function") {
      return target;
    }

    // 2. An element or selector.
    var el = toElement(target);
    if (!el) return null;
    return el.__tlNavToggleTimeline || null;
  }

  /* ------------------------------------------------------------------ *
   * Styles for the bundled controls
   * ------------------------------------------------------------------ */

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;

    var css = [
      /* ---------- shared ---------- */
      /* Every visual knob is a CSS custom property, so you can restyle
               the controls from your own stylesheet:
                 .tlnav-tab, .tlnav-toggle {
                   --tlnav-bg: #1a1a1a;  --tlnav-color: #fff;  ...
                 } */
      ".tlnav-toggle,.tlnav-tab{",
      "  margin:0;border:0;cursor:pointer;",
      "  color:var(--tlnav-color,#fff);",
      "  font:600 var(--tlnav-font-size,11px)/1 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;",
      "  -webkit-font-smoothing:antialiased;-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);",
      "  background:var(--tlnav-bg,rgba(24,24,27,.8));",
      "}",
      ".tlnav-toggle:hover,.tlnav-tab:hover{background:var(--tlnav-bg-hover,rgba(24,24,27,.95))}",
      ".tlnav-toggle:focus-visible,.tlnav-tab:focus-visible{",
      "  outline:2px solid var(--tlnav-focus,#c34528);outline-offset:-2px",
      "}",
      ".tlnav-toggle__icon,.tlnav-tab__icon{display:inline-flex}",
      ".tlnav-toggle__icon svg,.tlnav-tab__icon svg{display:block}",

      /* ---------- the edge tab (default) ---------- */
      ".tlnav-tab{",
      "  position:absolute;left:0;z-index:21;",
      "  display:inline-flex;align-items:center;gap:5px;",
      "  height:26px;padding:0 12px 0 9px;",
      "  border-radius:0 var(--tlnav-radius,10px) 0 0;",
      "  letter-spacing:.045em;",
      "  box-shadow:inset 0 1px 0 rgba(255,255,255,.07),0 -3px 10px rgba(0,0,0,.16);",
      "  transition:height .18s ease,background-color .18s ease,opacity .25s ease;",
      "}",
      ".tlnav-tab:hover{height:29px}",
      ".tlnav-tab__icon{transition:transform .28s cubic-bezier(.4,0,.2,1)}",
      ".tlnav-tab[aria-expanded='false'] .tlnav-tab__icon{transform:rotate(180deg)}",
      /* narrow container: chevron only */
      ".tlnav-tab--compact{width:30px;padding:0;justify-content:center;gap:0}",
      ".tlnav-tab--compact .tlnav-tab__text{display:none}",
      /* nav pinned to the top instead of the bottom (mirror image) */
      ".tlnav-tab--top{border-radius:0 0 var(--tlnav-radius,10px) 0}",
      ".tlnav-tab--top .tlnav-tab__icon{transform:rotate(180deg)}",
      ".tlnav-tab--top[aria-expanded='false'] .tlnav-tab__icon{transform:rotate(0deg)}",

      /* ---------- the floating pill ---------- */
      ".tlnav-toggle{",
      "  position:absolute;z-index:21;",
      "  display:inline-flex;align-items:center;gap:.45em;",
      "  padding:.5em .85em;border-radius:999px;letter-spacing:.01em;",
      "  box-shadow:0 2px 10px rgba(0,0,0,.25);",
      "  transition:background-color .18s ease;",
      "}",
      ".tlnav-toggle--top-right{top:12px;right:12px}",
      ".tlnav-toggle--top-left{top:12px;left:12px}",
      ".tlnav-toggle--bottom-right{bottom:12px;right:12px}",
      ".tlnav-toggle--bottom-left{bottom:12px;left:12px}",
      ".tlnav-toggle--inline{position:static}",
      ".tlnav-toggle__icon{transition:transform .25s ease}",
      ".tlnav-toggle[aria-expanded='false'] .tlnav-toggle__icon{transform:rotate(180deg)}",
      ".tlnav-toggle__text,.tlnav-tab__text{white-space:nowrap}",
      /* roomier hit area where fingers are used instead of cursors */
      "@media (pointer:coarse){",
      "  .tlnav-tab{height:32px}",
      "  .tlnav-tab:hover{height:32px}",
      "  .tlnav-tab--compact{width:38px}",
      "}",
    ].join("\n");

    var style = document.createElement("style");
    style.id = STYLE_ID;
    style.appendChild(document.createTextNode(css));
    (document.head || document.documentElement).appendChild(style);
  }

  /* ------------------------------------------------------------------ *
   * The controller
   * ------------------------------------------------------------------ */

  function createController(timeline, options) {
    var opts = extend({}, DEFAULTS, options);
    var navAtTop = timeline.options && timeline.options.timenav_position === "top";

    var state = {
      hidden: false,
      ready: false,
      patched: false,
      destroyed: false,
      compact: null,
      origCalculateHeight: null,
      rafId: null,
      observer: null,
      onResize: null,
    };

    var btn = null; // the control element
    var labelEl = null; // its text label (tab or pill)
    var isTab = false;

    var api = {
      version: VERSION,
      timeline: timeline,
      get button() {
        return btn;
      },
      hide: function () {
        return setHidden(true);
      },
      show: function () {
        return setHidden(false);
      },
      toggle: function () {
        return setHidden(!state.hidden);
      },
      isHidden: function () {
        return state.hidden;
      },
      refresh: function () {
        ensureMounted();
        redraw();
        rideAlong(opts.duration);
        return api;
      },
      setOptions: function (next) {
        extend(opts, next);
        syncButton();
        return api;
      },
      destroy: destroy,
    };

    /* --------------------------- element lookup --------------------------- */

    function elements() {
      var container = timeline._el && timeline._el.container;
      if (!container) return { container: null };
      return {
        container: container,
        nav: container.querySelector(".tl-timenav"),
        slider: container.querySelector(".tl-storyslider"),
        menubar: container.querySelector(".tl-menubar"),
        attribution: container.querySelector(".tl-attribution"),
      };
    }

    /* ------------------------------ patching ------------------------------ */

    function patch() {
      if (state.patched) return;
      state.origCalculateHeight = timeline._calculateTimeNavHeight;
      if (typeof state.origCalculateHeight !== "function") {
        throw new Error("[TLNavToggle] This build of TimelineJS3 does not expose " + "_calculateTimeNavHeight(), which is what the collapse relies on. " + "Please open an issue with your timeline.js version.");
      }

      timeline._calculateTimeNavHeight = function () {
        // Only report a 0px nav once the timeline has finished its first
        // layout pass. During init the TimeNav component is *built* from
        // this number, and a 0 there would give it a broken scale.
        if (state.hidden && state.ready) return 0;
        return state.origCalculateHeight.apply(this, arguments);
      };
      state.patched = true;
    }

    function unpatch() {
      if (!state.patched) return;
      timeline._calculateTimeNavHeight = state.origCalculateHeight;
      state.patched = false;
    }

    /* ------------------------------ layout ------------------------------- */

    // Ask TimelineJS to re-derive its own layout. This is what actually
    // resizes .tl-storyslider — see the header comment.
    function redraw() {
      if (!timeline.ready || typeof timeline.updateDisplay !== "function") return;
      timeline.updateDisplay();
    }

    function setTransition(els, duration) {
      var value = duration ? "height " + duration + "ms cubic-bezier(.4,0,.2,1)" : "";
      if (els.nav) els.nav.style.transition = value;
      if (els.slider) els.slider.style.transition = value;
    }

    // Chrome = anything that is *not* part of the height maths.
    function beginChrome(els, hidden) {
      if (els.nav && !hidden) {
        els.nav.style.visibility = "";
        els.nav.style.pointerEvents = "";
        els.nav.style.borderTopWidth = ""; // back before the height animates
        els.nav.removeAttribute("aria-hidden");
        els.nav.setAttribute("tabindex", "0");
      }
      if (els.menubar) {
        els.menubar.style.display = hidden && opts.hideMenuBar ? "none" : "";
      }
      if (els.attribution) {
        els.attribution.style.display = hidden && opts.hideAttribution ? "none" : "";
        // When collapsed the credit and the tab would fight over the
        // bottom-left corner — move the credit out of the way instead
        // of covering it up.
        els.attribution.style.left = hidden ? "auto" : "";
        els.attribution.style.right = hidden ? "0" : "";
      }
    }

    function endChrome(els, hidden) {
      if (!els.nav) return;
      if (hidden) {
        els.nav.style.borderTopWidth = "0px"; // kills the 1px divider
        els.nav.style.visibility = "hidden"; // keeps offsetWidth readable
        els.nav.style.pointerEvents = "none";
        els.nav.setAttribute("aria-hidden", "true");
        els.nav.setAttribute("tabindex", "-1");
      } else {
        els.nav.style.borderTopWidth = "";
        els.nav.style.visibility = "";
      }
    }

    /* --------------------------- tab positioning -------------------------- */

    // Distance from the container's edge to the edge of the nav the tab is
    // glued to, measured live so the tab rides the border while the
    // collapse animates. Measured as a position difference (not as a
    // height) so sub-pixel rounding can't leave a hairline gap.
    function navEdgeOffset() {
      var els = elements();
      if (!els.nav || !els.container) return 0;
      var c = els.container.getBoundingClientRect();
      var n = els.nav.getBoundingClientRect();
      var offset = navAtTop ? n.bottom - c.top : c.bottom - n.top;
      return offset > 0.5 ? Math.round(offset * 100) / 100 : 0;
    }

    function placeTab(offset) {
      if (!isTab || !btn) return;
      var h = offset === undefined ? navEdgeOffset() : offset;
      if (navAtTop) {
        btn.style.top = h + "px";
        btn.style.bottom = "";
      } else {
        btn.style.bottom = h + "px";
        btn.style.top = "";
      }
    }

    // Follow the nav's edge frame by frame for the length of the animation.
    function rideAlong(ms) {
      if (!isTab || !btn) return;
      if (state.rafId) window.cancelAnimationFrame(state.rafId);

      var started = null;
      function frame(now) {
        if (started === null) started = now;
        placeTab();
        if (now - started < ms + 80) {
          state.rafId = window.requestAnimationFrame(frame);
        } else {
          state.rafId = null;
          placeTab();
        }
      }
      state.rafId = window.requestAnimationFrame(frame);
    }

    // Catches nav height changes we didn't cause (font load, layout shift,
    // a container that resizes without a window resize event, ...).
    function watchNav() {
      if (!isTab || typeof window.ResizeObserver !== "function") return;
      var els = elements();
      if (!els.nav || state.observer) return;
      state.observer = new window.ResizeObserver(function () {
        placeTab();
      });
      state.observer.observe(els.nav);
      placeTab();
    }

    /* ------------------------------ the action --------------------------- */

    function setHidden(hidden, runOptions) {
      runOptions = runOptions || {};
      hidden = !!hidden;
      if (state.destroyed) return api;

      var changed = hidden !== state.hidden;
      state.hidden = hidden;

      // Not laid out yet: remember the intent, the "ready" handler replays it.
      if (!state.ready) {
        syncButton();
        return api;
      }

      var animate = (runOptions.animate === undefined ? opts.animate : runOptions.animate) && opts.duration > 0 && !prefersReducedMotion();

      var els = elements();

      ensureMounted();
      beginChrome(els, hidden);
      setTransition(els, animate ? opts.duration : 0);
      redraw();

      if (animate) {
        rideAlong(opts.duration);
        window.setTimeout(function () {
          if (state.destroyed || state.hidden !== hidden) return;
          setTransition(els, 0);
          endChrome(els, hidden);
        }, opts.duration + 40);
      } else {
        endChrome(els, hidden);
        placeTab();
      }

      if (opts.storageKey) writeStorage(hidden);
      syncButton();
      if (changed) emit(hidden);
      return api;
    }

    function emit(hidden) {
      if (typeof opts.onChange === "function") {
        opts.onChange(hidden, api, timeline);
      }
      var els = elements();
      if (!els.container || typeof window.CustomEvent !== "function") return;
      els.container.dispatchEvent(
        new window.CustomEvent(EVENT_NAME, {
          detail: { hidden: hidden, timeline: timeline },
          bubbles: true,
        }),
      );
    }

    /* ------------------------------- storage ----------------------------- */

    function readStorage() {
      if (!opts.storageKey) return null;
      try {
        var value = window.localStorage.getItem(opts.storageKey);
        return value === null ? null : value === "1";
      } catch (e) {
        return null;
      }
    }

    function writeStorage(hidden) {
      try {
        window.localStorage.setItem(opts.storageKey, hidden ? "1" : "0");
      } catch (e) {
        /* private mode, quota, ... */
      }
    }

    /* -------------------------------- control ---------------------------- */

    function buildButton() {
      if (!opts.button) return;

      // A pre-existing element the caller wants to use as the control.
      if (typeof opts.button === "string" && opts.button !== "inline") {
        var found = toElement(opts.button);
        if (found) return wireButton(found);
      } else if (opts.button && opts.button.nodeType === 1) {
        return wireButton(opts.button);
      }

      injectStyles();

      isTab = opts.buttonStyle !== "pill";
      btn = document.createElement("button");
      btn.type = "button";
      btn.innerHTML = '<span class="__icon" aria-hidden="true">' + CHEVRON_SVG + "</span>" + '<span class="__text"></span>';

      if (isTab) {
        btn.className = "tlnav-tab" + (navAtTop ? " tlnav-tab--top" : "");
        labelEl = btn.querySelector(".__text");
        labelEl.className = "tlnav-tab__text";
        labelEl.textContent = opts.label;
        btn.querySelector(".__icon").className = "tlnav-tab__icon";
        btn.style.opacity = "0"; // faded in once the timeline is laid out
      } else {
        btn.className = "tlnav-toggle tlnav-toggle--" + (opts.buttonPosition || "top-right");
        labelEl = btn.querySelector(".__text");
        labelEl.className = "tlnav-toggle__text";
        btn.querySelector(".__icon").className = "tlnav-toggle__icon";
      }

      btn.addEventListener("click", function (event) {
        event.preventDefault();
        api.toggle();
      });

      syncButton();
      syncCompact();
    }

    function wireButton(el) {
      btn = el;
      if (el.tagName === "BUTTON" && !el.getAttribute("type")) el.type = "button";
      btn.addEventListener("click", function (event) {
        event.preventDefault();
        api.toggle();
      });
      syncButton();
    }

    // TimelineJS empties the container in its own _initLayout(), so the
    // control is mounted after the timeline's "ready" event — and re-mounted
    // if the timeline ever rebuilds its DOM.
    function ensureMounted() {
      if (!btn || btn.parentNode) return;
      mount().appendChild(btn);
      if (isTab) {
        window.requestAnimationFrame(function () {
          if (btn) btn.style.opacity = "";
        });
      }
    }

    // The tab has to be positioned against the timeline container itself
    // (that is what "glued to the top of the nav" means), so that is the
    // default host. `.tl-timeline` is already position:relative.
    function mount() {
      var explicit = toElement(opts.mount);
      if (explicit) return explicit;
      if (isTab && timeline._el && timeline._el.container) return timeline._el.container;
      var container = timeline._el && timeline._el.container;
      return (container && container.parentElement) || document.body;
    }

    function syncButton() {
      if (!btn) return;
      var hidden = state.hidden;

      btn.setAttribute("aria-expanded", hidden ? "false" : "true");
      btn.setAttribute("aria-label", hidden ? opts.showText : opts.hideText);
      btn.title = hidden ? opts.showText : opts.hideText;

      if (!isTab && labelEl) {
        labelEl.textContent = hidden ? opts.showText : opts.hideText;
      }

      var els = elements();
      if (els.nav) {
        if (!els.nav.id) els.nav.id = "tl-timenav-" + ++uid;
        btn.setAttribute("aria-controls", els.nav.id);
      }
    }

    // Chevron only on narrow timelines, chevron + caption on wide ones.
    function syncCompact() {
      if (!isTab || !btn) return;
      var els = elements();
      var width = els.container ? els.container.offsetWidth : window.innerWidth;
      var compact = width < opts.compactBelow;
      if (compact === state.compact) return;
      state.compact = compact;
      btn.classList.toggle("tlnav-tab--compact", compact);
    }

    /* -------------------------------- init ------------------------------- */

    function onReady() {
      if (state.destroyed) return;
      state.ready = true;
      ensureMounted();
      watchNav();

      var stored = readStorage();
      var hidden = opts.hidden === null || opts.hidden === undefined ? stored : opts.hidden;

      if (hidden) {
        setHidden(true, { animate: false });
      } else {
        placeTab();
        syncButton();
      }

      if (typeof window.ResizeObserver !== "function") {
        state.onResize = function () {
          placeTab();
          syncCompact();
        };
        window.addEventListener("resize", state.onResize);
      } else {
        // ResizeObserver keeps the tab glued; the caption breakpoint
        // still needs a plain listener.
        state.onResize = function () {
          syncCompact();
        };
        window.addEventListener("resize", state.onResize);
      }
    }

    function destroy() {
      if (state.destroyed) return;
      setHidden(false, { animate: false });
      state.destroyed = true;

      if (state.rafId) window.cancelAnimationFrame(state.rafId);
      if (state.observer) state.observer.disconnect();
      if (state.onResize) window.removeEventListener("resize", state.onResize);

      redraw();
      unpatch();

      if (btn && btn.parentNode && /tlnav-(tab|toggle)/.test(btn.className)) {
        btn.parentNode.removeChild(btn);
      }
      btn = null;
      labelEl = null;

      var els = elements();
      if (els.menubar) els.menubar.style.display = "";
      if (els.attribution) {
        els.attribution.style.display = "";
        els.attribution.style.left = "";
        els.attribution.style.right = "";
      }
      redraw();

      registry.delete(timeline);
    }

    /* ------------------------------ go go go ----------------------------- */

    hookTimelineClass();
    patch();
    buildButton();

    if (timeline.ready) {
      onReady();
    } else if (typeof timeline.on === "function") {
      timeline.on("ready", onReady);
    } else {
      onReady();
    }

    return api;
  }

  /* ------------------------------------------------------------------ *
   * Public entry point
   * ------------------------------------------------------------------ */

  function TLNavToggle(target, options) {
    var timeline = resolveTimeline(target);

    if (!timeline) {
      throw new Error("[TLNavToggle] Could not find a TimelineJS instance for " + target + ". " + "Simplest fix: `var timeline = new TL.Timeline(...)` and then " + "`new TLNavToggle(timeline)`. " + "If you passed a selector/element instead, make sure tl-nav-toggle.js is loaded " + "before the timeline is created.");
    }

    if (registry.has(timeline)) {
      var existing = registry.get(timeline);
      if (options) existing.setOptions(options);
      return existing;
    }

    var controller = createController(timeline, options);
    registry.set(timeline, controller);
    return controller;
  }

  TLNavToggle.version = VERSION;
  TLNavToggle.defaults = DEFAULTS;
  TLNavToggle.eventName = EVENT_NAME;
  TLNavToggle.hookTimelineClass = hookTimelineClass;

  // Best-effort: if TL is already on the page, install the container
  // back-reference now.
  try {
    hookTimelineClass();
  } catch (e) {
    /* ignore */
  }

  return TLNavToggle;
});
