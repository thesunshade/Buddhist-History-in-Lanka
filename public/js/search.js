/**
 * search.js — Timeline search overlay
 *
 * Completely independent from timeline3/. Reads data/timeline.json at runtime,
 * builds an in-memory search index, and injects a search icon + panel into the
 * page. Navigation is done by setting window.location.hash to the format that
 * TimelineJS3 already listens to: "#event-{unique_id}".
 *
 * No external libraries required.
 */

(function () {
  "use strict";

  /* -------------------------------------------------------------------------
   * Config
   * ---------------------------------------------------------------------- */
  var DATA_URL = "data/timeline.json";

  /* -------------------------------------------------------------------------
   * Slugify — mirrors TimelineJS3's internal j() / _assignID() logic so that
   * the unique_id we compute matches what the timeline widget actually uses.
   * ---------------------------------------------------------------------- */
  // Exact FROM/TO strings extracted directly from timeline3/js/timeline.js j()
  var DIACRITIC_FROM = "ãàáäâẽèéëêìíïîõòóöôùúüûñç·/_,:;";
  var DIACRITIC_TO = "aaaaaeeeeeiiiiooooouuuunc------";

  function stripHtml(str) {
    // Remove HTML tags and decode simple entities
    return str
      .replace(/<[^>]*>/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'")
      .replace(/&nbsp;/g, " ");
  }

  function slugify(str) {
    if (!str) return "";
    // Strip HTML first (matches TL3's O() call before j())
    str = stripHtml(str);
    str = str.toLowerCase();
    for (var i = 0; i < DIACRITIC_FROM.length; i++) {
      str = str.split(DIACRITIC_FROM[i]).join(DIACRITIC_TO[i]);
    }
    str = str.replace(/[^a-z0-9 -]/g, "");
    str = str.replace(/\s+/g, "-");
    str = str.replace(/-+/g, "-");
    // TL3 also prepends "d-" when the slug starts with a digit
    str = str.replace(/^([0-9])/, "_$1");
    return str;
  }

  /* -------------------------------------------------------------------------
   * Diacritic-insensitive normalise for search matching
   * Uses Unicode NFD decomposition + strip combining marks when available,
   * otherwise falls back to the same map used for slugs.
   * ---------------------------------------------------------------------- */
  function normalise(str) {
    if (!str) return "";
    str = stripHtml(str).toLowerCase();
    if (str.normalize) {
      // NFD splits é → e + combining acute; strip the combining chars
      str = str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    } else {
      for (var i = 0; i < DIACRITIC_FROM.length; i++) {
        str = str.split(DIACRITIC_FROM[i]).join(DIACRITIC_TO[i]);
      }
    }
    return str;
  }

  /* -------------------------------------------------------------------------
   * Build search index from raw timeline JSON
   * ---------------------------------------------------------------------- */
  var searchIndex = []; // [{id, headline, year, displayDate, searchText}]

  /**
   * Assign unique IDs exactly as TL3 does: start from the headline slug,
   * append "-N" to avoid collisions (TL3 appends the array index).
   */
  function buildIndex(data) {
    searchIndex = [];
    var seen = {};

    function assignId(candidate, idx) {
      if (!candidate) candidate = "event-" + idx;
      if (!(candidate in seen)) {
        seen[candidate] = true;
        return candidate;
      }
      // TL3 collision resolution: append "-{idx}" until unique
      var attempt = candidate + "-" + idx;
      while (attempt in seen) {
        idx++;
        attempt = candidate + "-" + idx;
      }
      seen[attempt] = true;
      return attempt;
    }

    var events = data.events || [];
    for (var i = 0; i < events.length; i++) {
      var ev = events[i];
      var headline = ev.text && ev.text.headline ? ev.text.headline : "";
      var bodyText = ev.text && ev.text.text ? ev.text.text : "";
      var caption = ev.media && ev.media.caption ? ev.media.caption : "";
      var credit = ev.media && ev.media.credit ? ev.media.credit : "";
      var group = ev.group || "";
      var tag = ev.tag || "";

      // Determine slug — prefer explicit unique_id from JSON
      var slug = ev.unique_id ? ev.unique_id : slugify(headline);
      var uid = assignId(slug, i);

      // Human-readable date label
      var year = ev.start_date ? ev.start_date.year : null;
      var displayDate = ev.display_date || (year !== null ? (year < 0 ? Math.abs(year) + " BCE" : year + " CE") : "");

      // Concatenated searchable text (all significant fields)
      var searchText = normalise([headline, bodyText, caption, credit, group, tag, displayDate].join(" "));

      searchIndex.push({
        id: uid,
        headline: headline,
        year: year,
        displayDate: displayDate,
        searchText: searchText,
      });
    }
  }

  /* -------------------------------------------------------------------------
   * Search
   * ---------------------------------------------------------------------- */
  function search(query) {
    if (!query || !query.trim()) return [];
    var terms = normalise(query).split(/\s+/).filter(Boolean);
    return searchIndex.filter(function (entry) {
      return terms.every(function (term) {
        return entry.searchText.indexOf(term) !== -1;
      });
    });
  }

  /* -------------------------------------------------------------------------
   * DOM helpers
   * ---------------------------------------------------------------------- */
  function el(tag, className, attrs) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (attrs) {
      for (var k in attrs) {
        if (Object.prototype.hasOwnProperty.call(attrs, k)) {
          node.setAttribute(k, attrs[k]);
        }
      }
    }
    return node;
  }

  /* -------------------------------------------------------------------------
   * UI state
   * ---------------------------------------------------------------------- */
  var state = {
    open: false,
    results: [],
    active: -1, // keyboard-highlighted result index
  };

  /* -------------------------------------------------------------------------
   * DOM refs (populated in buildUI)
   * ---------------------------------------------------------------------- */
  var dom = {};

  /* -------------------------------------------------------------------------
   * Build UI
   * ---------------------------------------------------------------------- */
  function buildUI() {
    // --- Trigger button (search icon, top-right corner) ---
    dom.btn = el("button", "tl-search-btn", {
      type: "button",
      "aria-label": "Open search",
      "aria-expanded": "false",
      "aria-controls": "tl-search-panel",
    });
    dom.btn.innerHTML = searchIcon();
    dom.btn.addEventListener("click", togglePanel);
    document.body.appendChild(dom.btn);

    // --- Overlay backdrop ---
    dom.backdrop = el("div", "tl-search-backdrop");
    dom.backdrop.setAttribute("aria-hidden", "true");
    dom.backdrop.addEventListener("click", closePanel);
    document.body.appendChild(dom.backdrop);

    // --- Panel ---
    dom.panel = el("div", "tl-search-panel", {
      id: "tl-search-panel",
      role: "search",
    });

    // Input row
    var inputRow = el("div", "tl-search-input-row");

    dom.input = el("input", "tl-search-input", {
      type: "search",
      placeholder: "Search events…",
      "aria-label": "Search timeline events",
      "aria-autocomplete": "list",
      "aria-controls": "tl-search-results",
      autocomplete: "off",
      spellcheck: "false",
    });
    dom.input.addEventListener("input", onInput);
    dom.input.addEventListener("keydown", onInputKeydown);

    var closeBtn = el("button", "tl-search-close", {
      type: "button",
      "aria-label": "Close search",
    });
    closeBtn.innerHTML = closeIcon();
    closeBtn.addEventListener("click", closePanel);

    inputRow.appendChild(dom.input);
    inputRow.appendChild(closeBtn);
    dom.panel.appendChild(inputRow);

    // Results list
    dom.results = el("ul", "tl-search-results", {
      id: "tl-search-results",
      role: "listbox",
      "aria-label": "Search results",
    });
    dom.panel.appendChild(dom.results);

    // Status message (screen readers)
    dom.status = el("div", "tl-search-status", {
      "aria-live": "polite",
      "aria-atomic": "true",
    });
    dom.panel.appendChild(dom.status);

    document.body.appendChild(dom.panel);
  }

  /* -------------------------------------------------------------------------
   * SVG icons
   * ---------------------------------------------------------------------- */
  function searchIcon() {
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + '<circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="2"/>' + '<line x1="15.5" y1="15.5" x2="21" y2="21" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' + "</svg>";
  }

  function closeIcon() {
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + '<line x1="4" y1="4" x2="20" y2="20" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' + '<line x1="20" y1="4" x2="4" y2="20" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' + "</svg>";
  }

  /* -------------------------------------------------------------------------
   * Panel open / close
   * ---------------------------------------------------------------------- */
  function openPanel() {
    state.open = true;
    dom.btn.setAttribute("aria-expanded", "true");
    dom.panel.classList.add("tl-search-panel--open");
    dom.backdrop.classList.add("tl-search-backdrop--open");
    dom.input.value = "";
    renderResults([]);
    // Slight delay so the CSS transition finishes before focus
    setTimeout(function () {
      dom.input.focus();
    }, 50);
  }

  function closePanel() {
    state.open = false;
    state.active = -1;
    dom.btn.setAttribute("aria-expanded", "false");
    dom.panel.classList.remove("tl-search-panel--open");
    dom.backdrop.classList.remove("tl-search-backdrop--open");
    dom.btn.focus();
  }

  function togglePanel() {
    if (state.open) closePanel();
    else openPanel();
  }

  /* -------------------------------------------------------------------------
   * Input handlers
   * ---------------------------------------------------------------------- */
  function onInput() {
    var q = dom.input.value;
    state.results = search(q);
    renderResults(state.results, q);

    // Auto-highlight the first result so the user can see what Enter will pick
    state.active = state.results.length ? 0 : -1;
    highlightActive();
  }

  function onInputKeydown(e) {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        moveActive(1);
        break;
      case "ArrowUp":
        e.preventDefault();
        moveActive(-1);
        break;
      case "Enter":
        // Use the highlighted result, or fall back to the first one
        var idx = state.active >= 0 ? state.active : 0;
        if (state.results[idx]) {
          e.preventDefault();
          navigateTo(state.results[idx]);
        }
        break;
      case "Escape":
        closePanel();
        break;
    }
  }

  function moveActive(delta) {
    var len = state.results.length;
    if (len === 0) return;
    state.active = Math.max(0, Math.min(len - 1, state.active + delta));
    highlightActive();
  }

  function highlightActive() {
    var items = dom.results.querySelectorAll(".tl-search-result");
    for (var i = 0; i < items.length; i++) {
      var isActive = i === state.active;
      items[i].setAttribute("aria-selected", isActive ? "true" : "false");
      items[i].classList.toggle("tl-search-result--active", isActive);
    }
    if (state.active >= 0 && items[state.active]) {
      items[state.active].scrollIntoView({ block: "nearest" });
      dom.input.setAttribute("aria-activedescendant", items[state.active].id);
    } else {
      dom.input.removeAttribute("aria-activedescendant");
    }
  }

  /* -------------------------------------------------------------------------
   * Render results
   * ---------------------------------------------------------------------- */
  function renderResults(results, query) {
    dom.results.innerHTML = "";
    dom.input.removeAttribute("aria-activedescendant");

    if (!query || !query.trim()) {
      dom.status.textContent = "";
      return;
    }

    if (results.length === 0) {
      var empty = el("li", "tl-search-no-results");
      empty.textContent = "No events found";
      dom.results.appendChild(empty);
      dom.status.textContent = "No results found";
      return;
    }

    dom.status.textContent = results.length + " result" + (results.length === 1 ? "" : "s") + " found";

    for (var i = 0; i < results.length; i++) {
      (function (entry, idx) {
        var item = el("li", "tl-search-result", {
          id: "tl-search-result-" + idx,
          role: "option",
          "aria-selected": "false",
          tabindex: "-1",
        });

        var titleEl = el("span", "tl-search-result__title");
        titleEl.textContent = stripHtml(entry.headline);

        var dateEl = el("span", "tl-search-result__date");
        dateEl.textContent = entry.displayDate;

        item.appendChild(titleEl);
        item.appendChild(dateEl);

        item.addEventListener("click", function () {
          navigateTo(entry);
        });

        item.addEventListener("keydown", function (e) {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            navigateTo(entry);
          } else if (e.key === "ArrowDown") {
            e.preventDefault();
            state.active = idx;
            moveActive(1);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            state.active = idx;
            moveActive(-1);
          } else if (e.key === "Escape") {
            closePanel();
          }
        });

        item.addEventListener("mouseenter", function () {
          state.active = idx;
          highlightActive();
        });

        dom.results.appendChild(item);
      })(results[i], i);
    }
  }

  /* -------------------------------------------------------------------------
   * Navigate
   * ---------------------------------------------------------------------- */
  function navigateTo(entry) {
    closePanel();
    // TimelineJS3 listens for the hashchange event when hash_bookmark is true
    window.location.hash = "#event-" + entry.id;
  }

  /* -------------------------------------------------------------------------
   * Global keyboard shortcut: "/" or Ctrl+K to open search
   * ---------------------------------------------------------------------- */
  document.addEventListener("keydown", function (e) {
    // Ctrl+K or Cmd+K
    if ((e.ctrlKey || e.metaKey) && e.key === "k") {
      e.preventDefault();
      if (state.open) closePanel();
      else openPanel();
      return;
    }
    // Escape anywhere closes
    if (e.key === "Escape" && state.open) {
      closePanel();
    }
  });

  /* -------------------------------------------------------------------------
   * Init
   * ---------------------------------------------------------------------- */
  function init() {
    buildUI();

    fetch(DATA_URL)
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (data) {
        buildIndex(data);
      })
      .catch(function (err) {
        console.warn("[search] Could not load timeline data:", err);
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
