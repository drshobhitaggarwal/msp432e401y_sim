/* UI: debugger (breakpoints, stepping, call stack, variables, watch) and the peripheral register viewer. Depends on MSP. */
(function () {
'use strict';
var $ = function (id) { return document.getElementById(id); };
function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
var ctx, S, bps = {}, allBps = {}, watches = [], sel = 0, dbgOn = false, lastRev = -1, prevVals = {}, regBlock = 'SYSCTL', regPrev = {}, lastRegDraw = 0, editing = null, hexOn = true;
var store = null;

function hex8(v) { return '0x' + (v >>> 0).toString(16).toUpperCase().padStart(8, '0'); }
function bin32(v) { var s = (v >>> 0).toString(2).padStart(32, '0'); return s.replace(/(.{8})(?=.)/g, '$1 '); }

/* ---------- value formatting ---------- */
function isPrintableStr(a) {
  if (!a.length || a.length < 2 || typeof a[0] !== 'number') return null;
  var s = '';
  for (var i = 0; i < a.length; i++) {
    var c = a[i];
    if (c === 0) return i >= 2 ? s : null;
    if (typeof c !== 'number' || c < 9 || c > 126 || (c > 13 && c < 32)) return null;
    s += String.fromCharCode(c);
  }
  return null;
}
function fmtVal(v, kind) {
  if (v === undefined) return '<span class="dim">not set</span>';
  if (typeof v === 'number') {
    if (kind === 'f' || (v % 1 !== 0)) return esc(String(+v.toPrecision(7)));
    var h = ' <span class="dim">' + hex8(v).replace(/^0x0+(?=.)/, '0x') + '</span>';
    return esc(String(v)) + (hexOn && (v > 9 || v < 0) ? h : '');
  }
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (Array.isArray(v)) {
    var str = isPrintableStr(v), shown = v.slice(0, 16).map(function (x) { return typeof x === 'number' ? (x % 1 ? +x.toPrecision(5) : x) : '[…]'; }).join(', ');
    return (str !== null ? '"' + esc(str) + '" ' : '') + '<span class="dim">[' + esc(shown) + (v.length > 16 ? ', … ' + v.length + ' items' : '') + ']</span>';
  }
  if (typeof v === 'string') return '"' + esc(v) + '"';
  if (v && typeof v === 'object' && 'v' in v) { try { return '→ ' + fmtVal(v.v, kind); } catch (e) { return '→ ?'; } }
  return esc(String(v));
}
function rowsFor(frame, names, kindsScope) {
  var kinds = (ctx.compiled() && ctx.compiled().dbg && ctx.compiled().dbg.kinds) || {};
  return names.map(function (n) {
    var r = S.dbgEval(frame, n), kind = (kinds[kindsScope] && kinds[kindsScope][n]) || (kinds[''] && kinds[''][n]);
    var key = kindsScope + ':' + n, txt = r.err ? '<span class="dim">not in scope yet</span>' : fmtVal(r.v, kind);
    var changed = prevVals[key] !== undefined && prevVals[key] !== txt;
    prevVals[key] = txt;
    return '<tr' + (changed ? ' class="chg"' : '') + '><th>' + esc(n) + '</th><td>' + txt + '</td></tr>';
  }).join('');
}

/* ---------- breakpoints ---------- */
function saveBps() {
  allBps[ctx.cur()] = bps;
  if (store) store.set('e401y.bps', JSON.stringify(allBps));
}
function applyBps() { S.dbg.bps = {}; Object.keys(bps).forEach(function (l) { S.dbg.bps[l] = bps[l]; }); }
function toggleBp(line) {
  if (bps[line]) delete bps[line]; else bps[line] = true;
  saveBps(); applyBps();
  if (!dbgOn) { setDebug(true); return; }
  ctx.updateGutter(); drawBpList();
}
function drawBpList() {
  var ls = Object.keys(bps).map(Number).sort(function (a, b) { return a - b; }), box = $('dbgBps');
  if (!ls.length) { box.innerHTML = '<li class="dim">None. Click a line number in the editor, or press F9 on the line with the cursor.</li>'; return; }
  box.innerHTML = ls.map(function (l) {
    var c = bps[l] && bps[l].cond ? bps[l].cond : '';
    return '<li><b>line ' + l + '</b><input type="text" data-l="' + l + '" value="' + esc(c) + '" placeholder="condition, e.g. i == 3" aria-label="Condition for the breakpoint on line ' + l + '" spellcheck="false" autocomplete="off"><button type="button" class="x" data-del="' + l + '" aria-label="Remove breakpoint on line ' + l + '">×</button></li>';
  }).join('');
}

/* ---------- debug mode ---------- */
function setDebug(on, silent) {
  dbgOn = !!on; $('dbgOn').checked = dbgOn;
  if (store) store.set('e401y.debug', dbgOn ? '1' : '0');
  $('dbgHint').textContent = dbgOn ? '' : 'Debug build is off. Tick it (or set a breakpoint) to enable stepping.';
  if (!silent) ctx.rebuild();
  else ctx.updateGutter();
}
function stepBtns(en) { ['dbgGo', 'dbgOver', 'dbgInto', 'dbgOut'].forEach(function (id) { $(id).disabled = !en; }); }

function step(mode) {
  if (!S.loaded || S.halted || !S.paused) return;
  S.dbgResume(mode);
  selReset(); ctx.setRunning(true); ctx.updateGutter();
  stepBtns(false); lastRev = -1;
}
function selReset() { sel = 0; }

/* ---------- panels ---------- */
function drawStack() {
  var fr = S.dbg.frames, box = $('dbgStack');
  if (!dbgOn || !ctx.compiled() || !ctx.compiled().debug) { box.innerHTML = '<li class="dim">Debug build is off.</li>'; return; }
  if (!S.paused) { box.innerHTML = '<li class="dim">' + (S.loaded && !S.halted ? 'Running. Press Pause or hit a breakpoint.' : 'Not running.') + '</li>'; return; }
  var out = [];
  for (var i = fr.length - 1, k = 0; i >= 0; i--, k++) {
    var f = fr[i], label = f.isr ? '⚡ ' + esc(f.name) + ' <span class="dim">interrupt</span>' : esc(f.name);
    out.push('<li><button type="button" data-fr="' + k + '" class="' + (k === sel ? 'on' : '') + '">' + label + '<span class="dim"> line ' + f.line + '</span></button></li>');
  }
  box.innerHTML = out.join('');
}
function frameAt(k) { var fr = S.dbg.frames; return fr[fr.length - 1 - k]; }
function drawVars() {
  var box = $('dbgVars'), cp = ctx.compiled();
  if (!dbgOn || !cp || !cp.debug || !S.paused) { box.innerHTML = '<tr><td class="dim">' + (dbgOn ? 'Variables show while the program is stopped.' : '') + '</td></tr>'; return; }
  var f = frameAt(sel) || frameAt(0), info = cp.dbg.fns[f.name] || { params: [], locals: [] };
  var html = '<tr><th colspan="2" class="sub">' + esc(f.name) + '()</th></tr>' + rowsFor(f, info.params.concat(info.locals), f.name);
  var g = cp.dbg.globals.filter(function (n) { return !/^[A-Z][A-Z0-9_]*$/.test(n) || true; });
  if (g.length) html += '<tr><th colspan="2" class="sub">Globals</th></tr>' + rowsFor(frameAt(0), g, '');
  box.innerHTML = html;
}
function drawWatch() {
  var box = $('dbgWatch');
  if (!watches.length) { box.innerHTML = '<tr><td class="dim">Add an expression: a variable, <code>count * 2</code>, <code>GPIO_PORTN_AHB-&gt;DATA</code>, <code>TIMER0_RIS_R</code>. Reads have no side effects.</td></tr>'; return; }
  var cp = ctx.compiled(), can = dbgOn && cp && cp.debug && S.paused, f = can ? frameAt(sel) || frameAt(0) : null;
  box.innerHTML = watches.map(function (w, i) {
    var txt;
    if (!f) txt = '<span class="dim">' + (S.loaded ? 'running' : 'not running') + '</span>';
    else { var r = S.dbgEval(f, w); txt = r.err ? '<span class="err">' + esc(r.err) + '</span>' : fmtVal(r.v); }
    var key = 'w:' + w, changed = prevVals[key] !== undefined && prevVals[key] !== txt; prevVals[key] = txt;
    return '<tr' + (changed ? ' class="chg"' : '') + '><th>' + esc(w) + '</th><td>' + txt + '</td><td><button type="button" class="x" data-w="' + i + '" aria-label="Remove watch ' + esc(w) + '">×</button></td></tr>';
  }).join('');
}
function drawWhere() {
  var el = $('dbgWhere'), d = S.dbg;
  if (!S.loaded) el.textContent = '';
  else if (S.paused) el.textContent = (d.reason === 'breakpoint' ? 'Stopped at breakpoint' : d.reason === 'paused' ? 'Paused' : 'Stopped') + ' on line ' + d.line + ' in ' + (d.where === 'main' ? 'main code' : d.where + ' (interrupt)');
  else el.textContent = '';
}

/* ---------- register viewer ---------- */
function regValue(r) {
  try { return S.getRegs().peek(r.addr, 4); } catch (e) { return 0; }
}
function drawRegs(force) {
  var tbody = $('dbgRegs'), blk = S.getRegs().dump(regBlock);
  if (editing && !force) return;
  var html = blk.map(function (r) {
    var key = regBlock + r.addr, prev = regPrev[key], chg = prev !== undefined && prev !== r.value;
    regPrev[key] = r.value;
    return '<tr' + (chg ? ' class="chg"' : '') + '><th title="' + hex8(r.addr) + '">+' + (r.addr & 0xFFF).toString(16).toUpperCase().padStart(3, '0') + ' ' + esc(r.name) + '</th>' +
      '<td class="hx"><button type="button" class="val" data-ra="' + r.addr + '" ' + (r.ro ? 'disabled title="read-only"' : 'title="click to edit"') + '>' + hex8(r.value) + '</button></td>' +
      '<td class="bn">' + bin32(r.value) + '</td></tr>';
  }).join('');
  tbody.innerHTML = html || '<tr><td class="dim">No registers.</td></tr>';
}
function fillRegSel() {
  var s = $('regSel'); s.textContent = '';
  S.getRegs().blocks.forEach(function (b) { var o = document.createElement('option'); o.value = b.id; o.textContent = b.title; s.appendChild(o); });
  s.value = regBlock;
}
function startEdit(btn) {
  var addr = +btn.getAttribute('data-ra'), cell = btn.parentNode;
  editing = addr;
  var inp = document.createElement('input'); inp.type = 'text'; inp.value = btn.textContent; inp.setAttribute('aria-label', 'New value for register at ' + hex8(addr)); inp.spellcheck = false;
  cell.textContent = ''; cell.appendChild(inp); inp.focus(); inp.select();
  function done(commit) {
    if (editing === null) return; editing = null;
    if (commit) {
      var v = inp.value.trim(), n = /^0x/i.test(v) ? parseInt(v, 16) : /^0b/i.test(v) ? parseInt(v.slice(2), 2) : parseInt(v, 10);
      if (isNaN(n)) $('dbgRegMsg').textContent = 'Not a number: ' + v;
      else {
        try { S.getRegs().write(addr, n >>> 0, 4); S.sync(); $('dbgRegMsg').textContent = 'Wrote ' + hex8(n) + ' to ' + hex8(addr) + '.'; }
        catch (e) { $('dbgRegMsg').textContent = (e && e.message) ? e.message : String(e); }
      }
    }
    drawRegs(true);
  }
  inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); done(true); } else if (e.key === 'Escape') { e.preventDefault(); done(false); } });
  inp.addEventListener('blur', function () { done(false); });
}

/* ---------- events ---------- */
function bind() {
  $('dbgOn').addEventListener('change', function () { setDebug($('dbgOn').checked); });
  $('dbgGo').addEventListener('click', function () { step('run'); });
  $('dbgOver').addEventListener('click', function () { step('over'); });
  $('dbgInto').addEventListener('click', function () { step('into'); });
  $('dbgOut').addEventListener('click', function () { step('out'); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'F8' || e.key === 'F5') { if (S.paused) { e.preventDefault(); step('run'); } }
    else if (e.key === 'F10') { if (S.paused) { e.preventDefault(); step('over'); } }
    else if (e.key === 'F11') { if (S.paused) { e.preventDefault(); step(e.shiftKey ? 'out' : 'into'); } }
  });
  $('dbgStack').addEventListener('click', function (e) { var b = e.target.closest('button[data-fr]'); if (!b) return; sel = +b.getAttribute('data-fr'); var f = frameAt(sel); if (f) { S.dbg.line = f.line; ctx.updateGutter(); ctx.scrollToLine(f.line); } drawStack(); drawVars(); drawWatch(); });
  $('dbgBps').addEventListener('click', function (e) { var b = e.target.closest('button[data-del]'); if (!b) return; delete bps[b.getAttribute('data-del')]; saveBps(); applyBps(); ctx.updateGutter(); drawBpList(); });
  $('dbgBps').addEventListener('change', function (e) {
    var i = e.target; if (!i.getAttribute || !i.getAttribute('data-l')) return;
    var l = i.getAttribute('data-l'), c = i.value.trim(); bps[l] = c ? { cond: c } : true; saveBps(); applyBps();
  });
  $('dbgWatchForm').addEventListener('submit', function (e) {
    e.preventDefault(); var inp = $('dbgWatchIn'), v = inp.value.trim(); if (!v) return;
    if (watches.indexOf(v) < 0) watches.push(v);
    if (store) store.set('e401y.watch', JSON.stringify(watches)); inp.value = ''; drawWatch();
  });
  $('dbgWatch').addEventListener('click', function (e) { var b = e.target.closest('button[data-w]'); if (!b) return; watches.splice(+b.getAttribute('data-w'), 1); if (store) store.set('e401y.watch', JSON.stringify(watches)); drawWatch(); });
  $('regSel').addEventListener('change', function () { regBlock = $('regSel').value; if (store) store.set('e401y.regblk', regBlock); regPrev = {}; drawRegs(true); });
  $('dbgRegs').addEventListener('click', function (e) { var b = e.target.closest('button.val'); if (b && !b.disabled) startEdit(b); });
  $('dbgHex').addEventListener('change', function () { hexOn = $('dbgHex').checked; prevVals = {}; drawVars(); drawWatch(); });
}

var api = {
  init: function (c) {
    ctx = c; S = c.S(); store = c.store;
    try { allBps = JSON.parse(store.get('e401y.bps') || '{}') || {}; } catch (e) { allBps = {}; }
    try { watches = JSON.parse(store.get('e401y.watch') || '[]') || []; } catch (e) { watches = []; }
    dbgOn = store.get('e401y.debug') === '1'; $('dbgOn').checked = dbgOn;
    regBlock = store.get('e401y.regblk') || regBlock;
    bps = allBps[ctx.cur()] || {};
    fillRegSel(); bind();
    $('dbgHint').textContent = dbgOn ? '' : 'Debug build is off. Tick it (or set a breakpoint) to enable stepping.';
    drawBpList(); drawStack(); drawVars(); drawWatch(); stepBtns(false);
  },
  enabled: function () { return dbgOn; },
  hasBp: function (l) { return !!bps[l]; },
  curLine: function () { return S && S.paused && S.loaded ? S.dbg.line : 0; },
  toggleBp: toggleBp,
  setExample: function (id) { saveBps(); bps = allBps[id] || {}; applyBps(); drawBpList(); },
  onStart: function () { S = ctx.S(); applyBps(); sel = 0; prevVals = {}; lastRev = -1; fillRegSel(); drawStack(); drawVars(); drawWatch(); drawWhere(); drawRegs(true); },
  onEdit: function (oldN, newN, caretLine) {
    if (oldN === newN) return; var d = newN - oldN, nb = {};
    Object.keys(bps).forEach(function (k) { var l = +k; if (l > caretLine - (d > 0 ? 1 : 0) && l >= caretLine) { l += d; } if (l >= 1) nb[l] = bps[k]; });
    bps = nb; saveBps(); applyBps(); drawBpList();
  },
  step: step,
  paused: function () { return S && S.paused; },
  frame: function (ts) {
    S = ctx.S();
    if (S.paused && S.dbg.rev !== lastRev) {
      lastRev = S.dbg.rev; sel = 0; stepBtns(true);
      drawStack(); drawVars(); drawWatch(); drawWhere(); ctx.updateGutter(); ctx.scrollToLine(S.dbg.line); drawRegs(true);
    } else if (!S.paused && lastRev !== -1) { lastRev = -1; stepBtns(false); drawStack(); drawVars(); drawWatch(); drawWhere(); ctx.updateGutter(); }
    if (ts - lastRegDraw > 250) { lastRegDraw = ts; if (window.Win && Win.isOpen('program')) { drawRegs(false); if (!S.paused) drawWatch(); } }
  }
};
window.DbgUI = api;
})();
