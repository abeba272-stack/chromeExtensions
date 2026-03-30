(function (global) {
  /**
   * WaveDropIcons — inline SVG icon registry.
   *
   * Every function returns a ready-to-insert HTML string.
   * Icons use currentColor so they inherit the surrounding text/fill colour.
   * Pass an integer `size` to override the rendered pixel size (default 24).
   *
   * Usage in JS templates:
   *   root.innerHTML = `<div>${WaveDropIcons.nineNineNine(96)}</div>`;
   *
   * To swap an icon, edit only this file — all callers update automatically.
   */

  /* ── Decorative "999" numeral mark ─────────────────────────────────────── */
  function nineNineNine(size) {
    var s = size || 24;
    var w = Math.round(s * 2.4); /* wider aspect for three glyphs */
    return (
      '<svg xmlns="http://www.w3.org/2000/svg"' +
      ' width="' + w + '" height="' + s + '"' +
      ' viewBox="0 0 56 24"' +
      ' fill="currentColor" aria-hidden="true">' +
      '<text x="0" y="19"' +
      ' font-family="Baskerville,\'Palatino Linotype\',Palatino,Georgia,serif"' +
      ' font-size="22" font-weight="700" letter-spacing="2">999</text>' +
      '</svg>'
    );
  }

  /* ── Lemonade / juice glass  ────────────────────────────────────────────── */
  function lemonade(size) {
    var s = size || 24;
    return (
      '<svg xmlns="http://www.w3.org/2000/svg"' +
      ' width="' + s + '" height="' + s + '"' +
      ' viewBox="0 0 24 24"' +
      ' fill="none" stroke="currentColor"' +
      ' stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"' +
      ' aria-hidden="true">' +
      /* glass body (trapezoid) */
      '<path d="M9 4h6l-2 17h-2z"/>' +
      /* rim */
      '<line x1="8.5" y1="4" x2="15.5" y2="4"/>' +
      /* straw */
      '<line x1="13.5" y1="4" x2="16" y2="1"/>' +
      /* liquid level */
      '<line x1="9.6" y1="12" x2="14.4" y2="12" stroke-opacity="0.5"/>' +
      '</svg>'
    );
  }

  /* ── Three vertical dots (control-centre trigger) ───────────────────────── */
  function dotsVertical(size) {
    var s = size || 16;
    return (
      '<svg xmlns="http://www.w3.org/2000/svg"' +
      ' width="' + s + '" height="' + s + '"' +
      ' viewBox="0 0 16 16"' +
      ' fill="currentColor" aria-hidden="true">' +
      '<circle cx="8" cy="3"  r="1.5"/>' +
      '<circle cx="8" cy="8"  r="1.5"/>' +
      '<circle cx="8" cy="13" r="1.5"/>' +
      '</svg>'
    );
  }

  /* ── Download arrow ─────────────────────────────────────────────────────── */
  function download(size) {
    var s = size || 16;
    return (
      '<svg xmlns="http://www.w3.org/2000/svg"' +
      ' width="' + s + '" height="' + s + '"' +
      ' viewBox="0 0 24 24"' +
      ' fill="none" stroke="currentColor"' +
      ' stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"' +
      ' aria-hidden="true">' +
      '<path d="M12 3v13"/>' +
      '<path d="M7 11l5 5 5-5"/>' +
      '<path d="M4 20h16"/>' +
      '</svg>'
    );
  }

  /* ── External link ──────────────────────────────────────────────────────── */
  function externalLink(size) {
    var s = size || 12;
    return (
      '<svg xmlns="http://www.w3.org/2000/svg"' +
      ' width="' + s + '" height="' + s + '"' +
      ' viewBox="0 0 24 24"' +
      ' fill="none" stroke="currentColor"' +
      ' stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"' +
      ' aria-hidden="true">' +
      '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>' +
      '<polyline points="15 3 21 3 21 9"/>' +
      '<line x1="10" y1="14" x2="21" y2="3"/>' +
      '</svg>'
    );
  }

  /* ── Gear / settings ────────────────────────────────────────────────────── */
  function gear(size) {
    var s = size || 14;
    return (
      '<svg xmlns="http://www.w3.org/2000/svg"' +
      ' width="' + s + '" height="' + s + '"' +
      ' viewBox="0 0 24 24"' +
      ' fill="none" stroke="currentColor"' +
      ' stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"' +
      ' aria-hidden="true">' +
      '<circle cx="12" cy="12" r="3"/>' +
      '<path d="M12 2v2M12 20v2' +
      'M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42' +
      'M2 12h2M20 12h2' +
      'M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>' +
      '</svg>'
    );
  }

  /* ── X / close ──────────────────────────────────────────────────────────── */
  function xMark(size) {
    var s = size || 12;
    return (
      '<svg xmlns="http://www.w3.org/2000/svg"' +
      ' width="' + s + '" height="' + s + '"' +
      ' viewBox="0 0 24 24"' +
      ' fill="none" stroke="currentColor"' +
      ' stroke-width="2" stroke-linecap="round"' +
      ' aria-hidden="true">' +
      '<line x1="18" y1="6" x2="6"  y2="18"/>' +
      '<line x1="6"  y1="6" x2="18" y2="18"/>' +
      '</svg>'
    );
  }

  /* ── Public API ─────────────────────────────────────────────────────────── */
  global.WaveDropIcons = Object.freeze({
    nineNineNine  : nineNineNine,
    lemonade      : lemonade,
    dotsVertical  : dotsVertical,
    download      : download,
    externalLink  : externalLink,
    gear          : gear,
    xMark         : xMark
  });

})(typeof globalThis !== "undefined" ? globalThis : this);
