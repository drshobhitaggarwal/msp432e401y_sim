/* Floating windows over the bench: drag by the title, resize from the corner, close, maximize. Open state and size are remembered.
   On a phone a window fills the screen instead. */
var Win = (function () {
'use strict';
var desk, store, wins = {}, order = [], zTop = 20, saved = {}, btns = {};
function phone() { try { return window.matchMedia('(max-width: 720px)').matches; } catch (e) { return false; } }
function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; }
function persist() {
  var o = {};
  Object.keys(wins).forEach(function (id) { var w = wins[id]; o[id] = { open: !w.el.hidden, x: w.x, y: w.y, w: w.w, h: w.h, max: !!w.max }; });
  try { store.set('e401y.win', JSON.stringify(o)); } catch (e) {}
}
var pt = 0; function later() { clearTimeout(pt); pt = setTimeout(persist, 250); }
function place(w) {
  var s = w.el.style, dw = desk.clientWidth || 1000, dh = desk.clientHeight || 700;
  if (w.max) { s.left = '0px'; s.top = '0px'; s.width = dw + 'px'; s.height = dh + 'px'; return; }
  w.w = Math.max(280, Math.min(w.w, dw - 8)); w.h = Math.max(160, Math.min(w.h, dh - 8));
  w.x = Math.max(-w.w + 90, Math.min(w.x, dw - 90)); w.y = Math.max(0, Math.min(w.y, dh - 40));
  s.left = w.x + 'px'; s.top = w.y + 'px'; s.width = w.w + 'px'; s.height = w.h + 'px';
}
function focus(id) {
  var w = wins[id]; if (!w) return;
  w.el.style.zIndex = ++zTop;
  Object.keys(wins).forEach(function (k) { wins[k].el.classList.toggle('front', k === id); });
}
function mark(id) { var b = btns[id]; if (b) b.setAttribute('aria-pressed', wins[id] && !wins[id].el.hidden ? 'true' : 'false'); }
function open(id) {
  var w = wins[id]; if (!w) return;
  var was = w.el.hidden; w.el.hidden = false; place(w); focus(id); mark(id); later();
  if (was) { try { document.dispatchEvent(new CustomEvent('winshow', { detail: id })); } catch (e) {} if (w.onopen) w.onopen(); }
}
function close(id) { var w = wins[id]; if (!w || w.el.hidden) return; w.el.hidden = true; mark(id); later(); if (w.onclose) w.onclose(); }
function toggle(id) { var w = wins[id]; if (!w) return; if (w.el.hidden) open(id); else close(id); }
function isOpen(id) { return !!wins[id] && !wins[id].el.hidden; }
function create(id, title, content, o) {
  o = o || {};
  var sv = saved[id] || {}, n = Object.keys(wins).length;
  var w = { id: id, x: sv.x !== undefined ? sv.x : (o.x !== undefined ? o.x : 24 + n * 26), y: sv.y !== undefined ? sv.y : (o.y !== undefined ? o.y : 16 + n * 22),
    w: sv.w || o.w || 460, h: sv.h || o.h || 420, max: !!sv.max, onopen: o.onopen, onclose: o.onclose };
  var e = el('div', 'win'); e.id = 'win-' + id; e.hidden = true; e.setAttribute('role', 'dialog'); e.setAttribute('aria-label', title);
  var hd = el('div', 'wh'), tt = el('span', 'wt'); tt.textContent = title; hd.appendChild(tt);
  var mx = el('button', 'wx wm'); mx.type = 'button'; mx.setAttribute('aria-label', 'Maximize ' + title); mx.title = 'Maximize'; mx.innerHTML = '&#9633;';
  var cx = el('button', 'wx'); cx.type = 'button'; cx.setAttribute('aria-label', 'Close ' + title); cx.title = 'Close'; cx.innerHTML = '&times;';
  hd.appendChild(mx); hd.appendChild(cx); e.appendChild(hd);
  var body = el('div', 'wb'); if (o.cls) body.className += ' ' + o.cls; if (content) body.appendChild(content); e.appendChild(body);
  desk.appendChild(e); w.el = e; w.body = body; w.title = tt; wins[id] = w; order.push(id);
  cx.addEventListener('click', function () { close(id); });
  mx.addEventListener('click', function () { w.max = !w.max; place(w); later(); });
  e.addEventListener('pointerdown', function () { focus(id); }, true);
  var drag = null;
  hd.addEventListener('pointerdown', function (ev) {
    if (ev.target.closest('button') || w.max || phone()) return;
    drag = { sx: ev.clientX, sy: ev.clientY, x: w.x, y: w.y };
    try { hd.setPointerCapture(ev.pointerId); } catch (x) {}
    ev.preventDefault();
  });
  hd.addEventListener('pointermove', function (ev) { if (!drag) return; w.x = drag.x + ev.clientX - drag.sx; w.y = drag.y + ev.clientY - drag.sy; place(w); });
  ['pointerup', 'pointercancel'].forEach(function (n) { hd.addEventListener(n, function () { if (drag) { drag = null; later(); } }); });
  hd.addEventListener('dblclick', function (ev) { if (!ev.target.closest('button')) { w.max = !w.max; place(w); later(); } });
  if (window.ResizeObserver) {
    var first = true;
    new ResizeObserver(function () {
      if (first) { first = false; return; }
      if (e.hidden || w.max || phone()) return;
      var r = e.getBoundingClientRect(); if (r.width > 0) { w.w = Math.round(r.width); w.h = Math.round(r.height); later(); }
    }).observe(e);
  }
  if (sv.open) open(id);
  return w;
}
function bind(btn, id) { btns[id] = btn; btn.addEventListener('click', function () { toggle(id); }); mark(id); }
function setTitle(id, t) { var w = wins[id]; if (w) { w.title.textContent = t; w.el.setAttribute('aria-label', t); } }
function init(deskEl, st) {
  desk = deskEl; store = st;
  try { saved = JSON.parse(store.get('e401y.win') || '{}') || {}; } catch (e) { saved = {}; }
  window.addEventListener('resize', function () { Object.keys(wins).forEach(function (k) { if (!wins[k].el.hidden) place(wins[k]); }); });
  document.addEventListener('keydown', function (ev) {
    if (ev.key !== 'Escape') return;
    if (ev.target && /^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName) && ev.target.id === 'code') return;
    var top = null, z = -1; Object.keys(wins).forEach(function (k) { var w = wins[k]; if (!w.el.hidden && +w.el.style.zIndex > z && w.el.classList.contains('front')) { z = +w.el.style.zIndex; top = k; } });
    if (top && document.activeElement && wins[top].el.contains(document.activeElement) && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) close(top);
  });
}
return { init: init, create: create, open: open, close: close, toggle: toggle, isOpen: isOpen, focus: focus, bind: bind, setTitle: setTitle, get: function (id) { return wins[id]; } };
})();
