/* C subset -> JavaScript generator code. Pass 1: tokens (macros, declarations, casts). Pass 2: acorn AST edits. */
var CC = (function () {
'use strict';
function getAcorn() { return typeof acorn !== 'undefined' ? acorn : require('acorn'); }

var BASE = 'void int char short long float double unsigned signed bool _Bool size_t ssize_t uint8_t uint16_t uint32_t uint64_t int8_t int16_t int32_t int64_t uintptr_t intptr_t'.split(' ');
var QUAL = ['const', 'volatile', 'static', 'extern', 'register', 'inline', 'auto'];
var BLOCKING = { SysCtlDelay: 1, SysCtlSleep: 1, __WFI: 1, UARTCharPut: 1, UARTCharGet: 1, UARTprintf: 1, UARTwrite: 1, printf: 1, puts: 1, putchar: 1, SSIDataPut: 1, SSIDataGet: 1 };
var FLOATFN = { sqrt: 1, sqrtf: 1, sin: 1, sinf: 1, cos: 1, cosf: 1, tan: 1, tanf: 1, pow: 1, powf: 1, fabs: 1, fabsf: 1, log: 1, logf: 1, log10: 1, exp: 1, expf: 1, atan2: 1, atan2f: 1, fmin: 1, fmax: 1 };
var PUNCT = ['<<=', '>>=', '...', '->', '++', '--', '<<', '>>', '<=', '>=', '==', '!=', '&&', '||', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^='];

function CErr(line, msg) { this.line = line; this.msg = msg; this.isCErr = true; }

/* ---------- tokenizer ---------- */
function tokenize(src, startLine) {
  var toks = [], i = 0, n = src.length, line = startLine || 1, pre = '', bol = true, m;
  var ESC = { n: 10, r: 13, t: 9, '0': 0, '\\': 92, "'": 39, '"': 34, a: 7, b: 8, f: 12, v: 11 };
  while (i < n) {
    var c = src[i];
    if (c === '\n') { pre += c; line++; i++; bol = true; continue; }
    if (c === ' ' || c === '\t' || c === '\r') { pre += c; i++; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') {
      var j = src.indexOf('*/', i + 2); if (j < 0) j = n - 2;
      var nl = (src.slice(i, j + 2).match(/\n/g) || []).length;
      pre += new Array(nl + 1).join('\n'); line += nl; i = j + 2; continue;
    }
    if (c === '#' && bol) {
      var s = i;
      while (i < n && src[i] !== '\n') { if (src[i] === '\\' && src[i + 1] === '\n') { i += 2; line++; pre += '\n'; } else i++; }
      toks.push({ t: 'pp', v: src.slice(s, i).replace(/\\\n/g, ' '), pre: pre, line: line }); pre = ''; continue;
    }
    bol = false;
    var t;
    if (/[A-Za-z_]/.test(c)) {
      var s2 = i; while (i < n && /[A-Za-z0-9_]/.test(src[i])) i++;
      t = { t: 'id', v: src.slice(s2, i) };
    } else if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      m = /^(0[xX][0-9a-fA-F]+|0[bB][01]+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)([uUlLfF]*)/.exec(src.slice(i, i + 40));
      i += m[0].length;
      var isHex = /^0[xX]/.test(m[1]);
      t = { t: 'num', v: m[1], f: !isHex && (/[.eE]/.test(m[1]) || /[fF]/.test(m[2])) };
    } else if (c === '"') {
      var s3 = i++; while (i < n && src[i] !== '"') { if (src[i] === '\\') i++; i++; } i++;
      t = { t: 'str', v: src.slice(s3, i) };
    } else if (c === "'") {
      var s4 = i++, body = '';
      while (i < n && src[i] !== "'") { if (src[i] === '\\') { body += src[i++]; } body += src[i++]; } i++;
      var code;
      if (body[0] === '\\') { m = /^\\x([0-9a-fA-F]+)$/.exec(body); code = m ? parseInt(m[1], 16) : (ESC[body[1]] !== undefined ? ESC[body[1]] : body.charCodeAt(1)); }
      else code = body.charCodeAt(0);
      t = { t: 'num', v: String(code), f: false };
    } else {
      var p3 = src.substr(i, 3), p2 = src.substr(i, 2), pm = PUNCT.filter(function (p) { return p === p3 || p === p2; })[0];
      var len = pm ? pm.length : 1; t = { t: 'p', v: src.substr(i, len) }; i += len;
    }
    t.pre = pre; t.line = line; pre = ''; toks.push(t);
  }
  return toks;
}

/* ---------- preprocessor ---------- */
function preprocess(toks) {
  var macros = {}, out = [], stack = [], on = true;
  function active() { return stack.every(function (s) { return s.on; }); }
  toks.forEach(function (tk) {
    if (tk.t !== 'pp') { if (active()) out.push(tk); return; }
    var m = /^#\s*(\w+)\s*(.*)$/.exec(tk.v.replace(/\s+$/, '')); if (!m) return;
    var d = m[1], rest = m[2], keepNl = tk.pre;
    if (d === 'ifdef' || d === 'ifndef') { var def = rest.trim() in macros; stack.push({ on: d === 'ifdef' ? def : !def, taken: (d === 'ifdef' ? def : !def) }); }
    else if (d === 'if') { var v = !/^\(?\s*0\s*\)?$/.test(rest.trim()); stack.push({ on: v, taken: v }); }
    else if (d === 'elif') { var s = stack[stack.length - 1]; if (s) { var v2 = !s.taken && !/^\(?\s*0\s*\)?$/.test(rest.trim()); s.on = v2; s.taken = s.taken || v2; } }
    else if (d === 'else') { var s2 = stack[stack.length - 1]; if (s2) { s2.on = !s2.taken; s2.taken = true; } }
    else if (d === 'endif') stack.pop();
    else if (active() && d === 'define') {
      var dm = /^(\w+)(\(([^)]*)\))?\s*(.*)$/.exec(rest);
      if (dm) macros[dm[1]] = { params: dm[2] ? dm[3].split(',').map(function (x) { return x.trim(); }).filter(Boolean) : null, body: tokenize(dm[4]) };
    } else if (active() && d === 'undef') delete macros[rest.trim()];
    if (active() && out.length === 0 && keepNl) out.push({ t: 'nl', v: '', pre: keepNl, line: tk.line });
  });
  return { toks: expand(out, macros, {}), macros: macros };
}
function expand(toks, macros, hide) {
  var out = [];
  for (var i = 0; i < toks.length; i++) {
    var tk = toks[i], mc = tk.t === 'id' && !hide[tk.v] ? macros[tk.v] : null;
    if (!mc) { out.push(tk); continue; }
    var h2 = Object.create(hide), body; h2[tk.v] = true;
    var extraNl = '';
    if (mc.params === null) {
      body = mc.body.map(function (b) { return { t: b.t, v: b.v, f: b.f, pre: ' ', line: tk.line }; });
    } else {
      var j = i + 1; while (j < toks.length && toks[j].t === 'nl') j++;
      if (!(toks[j] && toks[j].v === '(')) { out.push(tk); continue; }
      var args = [], cur = [], depth = 0; j++;
      for (; j < toks.length; j++) {
        var x = toks[j];
        if (x.v === '(') depth++;
        if (x.v === ')') { if (depth === 0) break; depth--; }
        if (x.v === ',' && depth === 0) { args.push(cur); cur = []; continue; }
        extraNl += (x.pre.match(/\n/g) || []).join(''); cur.push(x);
      }
      args.push(cur); if (args.length === 1 && !args[0].length) args = [];
      body = [];
      mc.body.forEach(function (b) {
        var k = b.t === 'id' ? mc.params.indexOf(b.v) : -1;
        if (k >= 0 && args[k]) args[k].forEach(function (a) { body.push({ t: a.t, v: a.v, f: a.f, pre: ' ', line: tk.line }); });
        else body.push({ t: b.t, v: b.v, f: b.f, pre: ' ', line: tk.line });
      });
      i = j;
    }
    body = expand(body, macros, h2);
    if (body.length) body[0] = { t: body[0].t, v: body[0].v, f: body[0].f, pre: tk.pre + extraNl, line: tk.line };
    else if (tk.pre || extraNl) out.push({ t: 'nl', v: '', pre: tk.pre + extraNl, line: tk.line });
    body.forEach(function (b) { out.push(b); });
  }
  return out;
}

/* ---------- register prepass: ->, HWREG(), *(volatile T*)ADDR, (T*)ADDR, NAME_R ---------- */
function regPrepass(toks, known) {
  var Q = {}; QUAL.forEach(function (t) { Q[t] = 1; });
  var TY = {}; BASE.forEach(function (t) { TY[t] = 1; });
  function isTy(t) { return t && t.t === 'id' && (TY[t.v] || Q[t.v]); }
  function mt(v, ref, t) { return { t: t || 'p', v: v, pre: ref ? ref.pre : ' ', line: ref ? ref.line : 0 }; }
  function match(a, j) {
    var o = a[j].v, cl = o === '(' ? ')' : o === '[' ? ']' : '}', d = 0;
    for (; j < a.length; j++) { if (a[j].v === o) d++; else if (a[j].v === cl) { d--; if (!d) return j; } }
    return a.length - 1;
  }
  function addrLike(sl) {
    return sl.some(function (t) {
      if (t.t === 'num') { var n = /^0[xX]/.test(t.v) ? parseInt(t.v, 16) : parseFloat(t.v); return n >= 0x1000; }
      return t.t === 'id' && known && known[t.v] && /_BASE$|_ADDR$/.test(t.v);
    });
  }
  function sizeName(typ) {
    var s = typ.map(function (t) { return t.v; }).join(' ');
    return /char|8/.test(s) ? '8' : /short|16/.test(s) ? '16' : '32';
  }
  function castAt(a, j) {                        // a[j] === '(' : returns {typ, end(index of ')'), ptr} or null
    var k = j + 1, typ = [];
    while (isTy(a[k])) { typ.push(a[k]); k++; }
    if (!typ.length) return null;
    var st = 0; while (a[k] && a[k].v === '*') { st++; k++; }
    if (!st || !a[k] || a[k].v !== ')') return null;
    return { typ: typ, end: k };
  }
  function prevOperand(out) {
    var p = out.length ? out[out.length - 1] : null; while (p && p.t === 'nl') { out = out.slice(0, -1); p = out.length ? out[out.length - 1] : null; }
    if (!p) return false;
    if (p.t === 'num' || p.t === 'str') return true;
    if (p.t === 'id') return ['return', 'case', 'else', 'do', 'sizeof'].indexOf(p.v) < 0;
    return p.v === ')' || p.v === ']';
  }
  function run(a) {
    var out = [], i = 0;
    while (i < a.length) {
      var tk = a[i], nx = a[i + 1];
      if (tk.t === 'id') {
        if (known && known[tk.v] === 2) { out.push({ t: 'id', v: '__r.' + tk.v, pre: tk.pre, line: tk.line }); i++; continue; }
        if ((tk.v === 'HWREG' || tk.v === 'HWREGH' || tk.v === 'HWREGB') && nx && nx.v === '(') {
          var e = match(a, i + 1);
          out.push(mt(tk.v === 'HWREG' ? '__M32' : tk.v === 'HWREGH' ? '__M16' : '__M8', tk, 'id'), mt('[', null));
          run(a.slice(i + 2, e)).forEach(function (t) { out.push(t); });
          out.push(mt(']', null)); i = e + 1; continue;
        }
      }
      if (tk.t === 'p' && tk.v === '->') { out.push(mt('.', tk)); i++; continue; }
      if (tk.t === 'p' && tk.v === '*' && nx && nx.v === '(' && !prevOperand(out)) {
        var cs = castAt(a, i + 1), outer = null, operand = null, endIdx = 0;
        if (!cs && a[i + 2] && a[i + 2].v === '(') {                  // *( (T*)operand )
          cs = castAt(a, i + 2);
          if (cs) { var oc = match(a, i + 1); operand = a.slice(cs.end + 1, oc); endIdx = oc + 1; }
        } else if (cs) {                                              // *(T*)operand
          var k = cs.end + 1;
          if (a[k] && a[k].v === '(') endIdx = match(a, k) + 1; else endIdx = k + 1;
          operand = a.slice(k, endIdx);
        }
        if (cs && operand && operand.length && addrLike(operand)) {
          out.push(mt('__M' + sizeName(cs.typ), tk, 'id'), mt('[', null));
          run(operand).forEach(function (t) { out.push(t); });
          out.push(mt(']', null)); i = endIdx; continue;
        }
      }
      if (tk.t === 'p' && tk.v === '(' && !(out.length && out[out.length - 1].v === 'sizeof')) {
        var c2 = castAt(a, i);
        if (c2) {
          var n2 = a[c2.end + 1], opEnd = null;
          if (n2 && n2.t === 'num' && addrLike([n2])) opEnd = c2.end + 2;
          else if (n2 && n2.v === '(') { var me = match(a, c2.end + 1); if (addrLike(a.slice(c2.end + 1, me + 1))) opEnd = me + 1; }
          if (opEnd) {
            out.push(mt('__P' + sizeName(c2.typ), tk, 'id'), mt('(', null));
            run(a.slice(c2.end + 1, opEnd)).forEach(function (t) { out.push(t); });
            out.push(mt(')', null)); i = opEnd; continue;
          }
        }
      }
      out.push(tk); i++;
    }
    return out;
  }
  return run(toks);
}

/* ---------- pass 1: declarations, casts, pointers ---------- */
function pass1(toks, src) {
  var TYPES = {}; BASE.forEach(function (t) { TYPES[t] = 1; });
  var Q = {}; QUAL.forEach(function (t) { Q[t] = 1; });
  var out = [], i = 0, depth = 0, fn = '';
  var kinds = { '': {} };          // scope -> name -> 'f' | 'i'
  var arrays = {}, floatFns = {}, fnNames = [];
  function k(scope, n, v) { (kinds[scope] || (kinds[scope] = {}))[n] = v; }
  function isType(tk) { return tk && tk.t === 'id' && (TYPES[tk.v] || Q[tk.v]); }
  function emit(tk, text) { out.push(tk.pre + text); }
  function prevV() { return prevTok ? prevTok.v : ';'; }
  var prevTok = null;
  function stmtStart() { var p = prevTok ? prevTok.v : ';'; return p === ';' || p === '{' || p === '}' || p === ':' || p === 'else' || p === 'do'; }
  function operandPrev() {
    if (!prevTok) return false;
    if (prevTok.t === 'num' || prevTok.t === 'str') return true;
    if (prevTok.t === 'id') return ['return', 'case', 'else', 'do'].indexOf(prevTok.v) < 0;
    return prevTok.v === ')' || prevTok.v === ']';
  }
  function fail(tk, msg) { throw new CErr(tk.line, msg); }
  function operandPrev2() { return false; }
  function typeSpan(j) {                      // returns {end, isFloat, isInt, named}
    var isF = false, isI = false, named = 0;
    while (isType(toks[j])) {
      var v = toks[j].v;
      if (v === 'float' || v === 'double') isF = true; else if (!Q[v] && v !== 'void') isI = true;
      if (!Q[v]) named++; j++;
    }
    return { end: j, f: isF, i: isI, named: named };
  }
  function skipStars(j) { while (toks[j] && toks[j].v === '*') j++; return j; }
  function matching(j, open, close) {
    var d = 0; for (; j < toks.length; j++) { if (toks[j].v === open) d++; else if (toks[j].v === close) { d--; if (!d) return j; } }
    return toks.length - 1;
  }
  function operandEnd(j) {
    while (toks[j] && ['-', '+', '!', '~'].indexOf(toks[j].v) >= 0) j++;
    var t0 = toks[j]; if (!t0) return j;
    if (t0.v === '(') j = matching(j, '(', ')') + 1;
    else if (t0.t === 'id' || t0.t === 'num' || t0.t === 'str') j++;
    else return j;
    for (;;) {
      var t = toks[j]; if (!t) break;
      if (t.v === '(') j = matching(j, '(', ')') + 1;
      else if (t.v === '[') j = matching(j, '[', ']') + 1;
      else if (t.v === '++' || t.v === '--') j++;
      else if (t.v === '.' && toks[j + 1] && toks[j + 1].t === 'id') j += 2;
      else break;
    }
    return j;
  }
  function emitTok(j) {                       // emit one token or token group, return next index
    var tk = toks[j], nx = toks[j + 1];
    if (tk.t === 'num') { emit(tk, tk.v); prevTok = tk; return j + 1; }
    if (tk.t === 'id') {
      if (tk.v === 'sizeof' && nx && nx.v === '(') {
        var e = matching(j + 1, '(', ')'), inner = toks.slice(j + 2, e), txt;
        var ts = typeSpan(j + 2);
        if (ts.end === j + 2 + inner.length || skipStars(ts.end) === e) {
          var s = inner.map(function (x) { return x.v; }).join(' ');
          txt = /\*/.test(s) ? '4' : /double|64/.test(s) ? '8' : /char|8/.test(s) ? '1' : /short|16/.test(s) ? '2' : '4';
        } else if (inner.length === 1 && inner[0].t === 'id') txt = arrays[inner[0].v] ? inner[0].v + '.length' : '4';
        else txt = '1';
        emit(tk, txt); prevTok = toks[e]; return e + 1;
      }
      if (arrays[tk.v] && nx && (nx.v === '++' || nx.v === '--' || nx.v === '+=' || nx.v === '-=') || (arrays[tk.v] && prevTok && (prevTok.v === '++' || prevTok.v === '--') && !operandPrev2()))
        fail(tk, "Pointer arithmetic on '" + tk.v + "' (" + tk.v + "++, *" + tk.v + "++, " + tk.v + " += n) is not supported by this simulator yet. Walk the data with an index instead, for example: for (i = 0; " + tk.v + "[i]; i++).");
      if (tk.v === 'struct' || tk.v === 'union' || tk.v === 'goto') fail(tk, "'" + tk.v + "' is not supported by this simulator.");
      emit(tk, tk.v); prevTok = tk; return j + 1;
    }
    if (tk.t === 'p') {
      if (tk.v === '(' && isType(nx)) {                       // cast
        var ts2 = typeSpan(j + 1), e2 = skipStars(ts2.end);
        if (toks[e2] && toks[e2].v === ')' && ts2.named) {
          var isPtr = e2 > ts2.end;
          if (!isPtr && ts2.i && !ts2.f) {                      // integer cast truncates its operand
            var end = operandEnd(e2 + 1);
            if (end > e2 + 1) {
              emit(tk, 'Math.trunc('); prevTok = { t: 'p', v: '(' };
              for (var q = e2 + 1; q < end;) q = emitTok(q);
              out.push(')'); prevTok = toks[end - 1]; return end;
            }
          }
          emit(tk, ts2.f && !isPtr ? '1.0*' : ' ');
          prevTok = { t: 'p', v: '(' }; return e2 + 1;
        }
      }
      if (!operandPrev() && nx && nx.t === 'id' && (tk.v === '*' || tk.v === '&')) {
        if (tk.v === '*') { emit(tk, ''); emit(nx, nx.v + '.v'); prevTok = nx; return j + 2; }
        if (arrays[nx.v]) { emit(tk, ''); emit(nx, nx.v); prevTok = nx; return j + 2; }
        emit(tk, '__ref(()=>' + nx.v + ',(__v)=>{' + nx.v + '=__v;})'); out[out.length - 1] += ''; prevTok = nx; return j + 2;
      }
      emit(tk, tk.v); prevTok = tk; return j + 1;
    }
    if (tk.t === 'str') { emit(tk, '__cs(' + tk.v + ')'); prevTok = tk; return j + 1; }   // string literals are char arrays
    emit(tk, tk.v); prevTok = tk; return j + 1;
  }
  function emitInit(j) {                      // initializer expression, stops at depth-0 ',' or ';' or ')'
    var d = 0;
    while (j < toks.length) {
      var tk = toks[j];
      if (d === 0 && (tk.v === ',' || tk.v === ';' || tk.v === ')')) break;
      if (tk.v === '{') { emit(tk, '['); d++; prevTok = tk; j++; continue; }
      if (tk.v === '}') { emit(tk, ']'); d--; prevTok = tk; j++; continue; }
      var j2 = emitTok(j);
      for (var q = j; q < j2; q++) { var v = toks[q].v; if (v === '(' || v === '[') d++; else if (v === ')' || v === ']') d--; }
      j = j2;
    }
    return j;
  }
  function declList(j, ts, scope) {           // after the base type; emits "let a = .., b = .." up to and including ';'
    out.push(' let');
    for (;;) {
      j = skipStars(j);
      var nm = toks[j]; if (!nm || nm.t !== 'id') fail(toks[Math.min(j, toks.length - 1)], 'Expected a variable name in this declaration.');
      emit({ pre: ' ' }, nm.v); j++;
      k(scope, nm.v, ts.f ? 'f' : ts.i ? 'i' : 'x');
      var dims = [];
      while (toks[j] && toks[j].v === '[') { var e = matching(j, '[', ']'); dims.push(toks.slice(j + 1, e)); j = e + 1; }
      if (dims.length) arrays[nm.v] = 1;
      var hasInit = toks[j] && toks[j].v === '=';
      if (dims.length && !hasInit) {
        out.push(' = __mk([' + dims.map(function (d) { return d.map(function (x) { return x.v; }).join(' ') || '0'; }).join(',') + '])');
      } else if (hasInit) {
        out.push(' ='); j++;
        var save = prevTok; prevTok = { v: '=' };
        j = emitInit(j); prevTok = save;
      } else out.push(' = 0');
      if (toks[j] && toks[j].v === ',') { out.push(','); j++; continue; }
      break;
    }
    if (toks[j] && toks[j].v === ';') { emit(toks[j], ';'); prevTok = toks[j]; j++; }
    return j;
  }
  function enumDecl(j, scope) {               // at 'enum'; returns index after ';' ; names list in out
    var tk = toks[j]; j++;
    if (toks[j] && toks[j].t === 'id') j++;
    if (!toks[j] || toks[j].v !== '{') fail(tk, 'Expected { after enum.');
    var e = matching(j, '{', '}'), items = [], cur = [];
    for (var q = j + 1; q < e; q++) { if (toks[q].v === ',') { items.push(cur); cur = []; } else cur.push(toks[q]); }
    if (cur.length) items.push(cur);
    var prev = null, parts = [];
    items.forEach(function (it) {
      var nm = it[0].v, val = it.length > 2 ? it.slice(2).map(function (x) { return x.v; }).join(' ') : (prev === null ? '0' : '(' + prev + ' + 1)');
      parts.push(nm + ' = ' + val); prev = nm; k(scope, nm, 'i');
    });
    emit(tk, 'let ' + parts.join(', ') + ';');
    return e + 1;
  }
  var nlc = 0, scanned = 0;
  while (i < toks.length) {
    if (i > 0) {                                  // keep generated line numbers equal to C line numbers
      for (; scanned < out.length; scanned++) { var mm = String(out[scanned]).match(/\n/g); if (mm) nlc += mm.length; }
      var want = (toks[i - 1].line || 1) - 1;
      if (nlc < want) { out.push(new Array(want - nlc + 1).join('\n')); }
    }
    var tk = toks[i];
    if (tk.t === 'nl') { out.push(tk.pre); i++; continue; }
    if (tk.v === '{') { depth++; emit(tk, '{'); prevTok = tk; i++; continue; }
    if (tk.v === '}') { depth--; if (depth === 0) fn = ''; emit(tk, '}'); prevTok = tk; i++; continue; }
    if (tk.t === 'id' && tk.v === 'typedef' && stmtStart()) {
      var nx = toks[i + 1];
      if (nx && nx.v === 'enum') {
        var e = i + 1; while (toks[e] && toks[e].v !== '{') e++;
        var close = matching(e, '{', '}'); var name = toks[close + 1];
        out.push(tk.pre); var after = enumDecl(i + 1, fn); TYPES[name.v] = 1; i = close + 3; prevTok = { v: ';' }; continue;
      }
      var ts0 = typeSpan(i + 1), nm0 = toks[skipStars(ts0.end)];
      if (!nm0 || toks[i + 1].v === 'struct') fail(tk, 'typedef of struct/union is not supported by this simulator.');
      TYPES[nm0.v] = 1; out.push(tk.pre); i = skipStars(ts0.end) + 2; prevTok = { v: ';' }; continue;
    }
    if (tk.t === 'id' && tk.v === 'enum' && stmtStart()) { i = enumDecl(i, fn); if (toks[i] && toks[i].v === ';') i++; prevTok = { v: ';' }; continue; }
    if (tk.t === 'id' && isType(tk) && stmtStart()) {
      var ts = typeSpan(i);
      if (ts.named) {
        var j = skipStars(ts.end), nm = toks[j];
        if (nm && nm.t === 'id' && toks[j + 1] && toks[j + 1].v === '(' && depth === 0) {
          var pe = matching(j + 1, '(', ')'), params = [], cur = [];
          for (var q = j + 2; q < pe; q++) { if (toks[q].v === ',' && true) { params.push(cur); cur = []; } else cur.push(toks[q]); }
          if (cur.length) params.push(cur);
          var names = [];
          params.forEach(function (p) {
            var pts = 0, f = false, nmm = null;
            p.forEach(function (x) {
              if (x.t === 'id' && TYPES[x.v] || Q[x.v]) { if (x.v === 'float' || x.v === 'double') f = true; if (x.v !== 'void' && !Q[x.v]) pts++; }
              else if (x.t === 'id') nmm = x;
            });
            if (nmm) { names.push(nmm.v); k(nm.v, nmm.v, f ? 'f' : 'i'); if (p.some(function (x) { return x.v === '[' || x.v === '*'; })) arrays[nmm.v] = 1; }
          });
          if (toks[pe + 1] && toks[pe + 1].v === ';') {                 // prototype: drop it
            out.push(tk.pre); i = pe + 2; prevTok = { v: ';' }; continue;
          }
          fn = nm.v; fnNames.push(nm.v); if (ts.f && j === ts.end) floatFns[nm.v] = 1;
          emit(tk, 'function ' + nm.v + '(' + names.join(', ') + ')');
          prevTok = toks[pe]; i = pe + 1; continue;
        }
        out.push(tk.pre); i = declList(j, ts, fn); continue;
      }
    }
    if (tk.t === 'id' && tk.v === 'for' && toks[i + 1] && toks[i + 1].v === '(' && isType(toks[i + 2])) {
      emit(tk, 'for'); emit(toks[i + 1], '(');
      var ts3 = typeSpan(i + 2); i = declList(ts3.end, ts3, fn); prevTok = { v: ';' };
      continue;
    }
    i = emitTok(i);
  }
  return { js: out.join(''), kinds: kinds, arrays: arrays, floatFns: floatFns, fns: fnNames };
}

/* ---------- pass 2: generators, integer division ---------- */
function pass2(js, info, known, opts) {
  opts = opts || {};
  var dbgInfo = { fns: {}, globals: [], kinds: info.kinds, arrays: info.arrays };
  var HOOK_EV = 'function(__x){return eval(__x)}';
  function hookText(line) { return 'if(__d(' + line + ',' + HOOK_EV + '))yield __DBG;'; }
  var ast;
  try { ast = getAcorn().parse(js, { ecmaVersion: 2020, locations: true, allowReturnOutsideFunction: true }); }
  catch (e) {
    var ln = e.loc ? e.loc.line : 1, msg = String(e.message).replace(/\s*\(\d+:\d+\)$/, '');
    throw new CErr(ln, 'Syntax error: ' + msg + '. Check this line and the one above for a missing ; ) or }.');
  }
  var edits = [], order = 0, userFns = {};
  info.fns.forEach(function (n) { userFns[n] = 1; });
  function ins(pos, text, kind) { edits.push({ pos: pos, del: 0, text: text, rank: kind === 'close' ? 0 : 2, ord: order++ }); }
  function kindOf(scope, n) { var a = info.kinds[scope]; if (a && a[n]) return a[n]; a = info.kinds['']; return a && a[n]; }
  function isF(n, scope) {
    if (!n) return false;
    switch (n.type) {
      case 'Literal': return typeof n.value === 'number' && !/^0[xXbB]/.test(n.raw) && /[.eE]/.test(n.raw);
      case 'Identifier': return kindOf(scope, n.name) === 'f';
      case 'MemberExpression': return n.object.type === 'Identifier' && kindOf(scope, n.object.name) === 'f';
      case 'CallExpression': return n.callee.type === 'Identifier' && (info.floatFns[n.callee.name] || FLOATFN[n.callee.name]);
      case 'BinaryExpression': return '+-*/'.indexOf(n.operator) >= 0 && (isF(n.left, scope) || isF(n.right, scope));
      case 'LogicalExpression': return false;
      case 'UnaryExpression': return n.operator !== '!' && isF(n.argument, scope);
      case 'ConditionalExpression': return isF(n.consequent, scope) || isF(n.alternate, scope);
      case 'AssignmentExpression': return isF(n.right, scope);
      case 'SequenceExpression': return isF(n.expressions[n.expressions.length - 1], scope);
    }
    return false;
  }
  function trunc(node) { ins(node.start, 'Math.trunc(', 'open'); ins(node.end, ')', 'close'); }
  function loopBody(b, loop) {
    var t = 'if(__chk())yield 0;' + (opts.debug ? hookText(loop.loc.start.line) : '');
    if (b.type === 'BlockStatement') ins(b.start + 1, t, 'open');
    else { ins(b.start, '{' + t, 'open'); ins(b.end, '}', 'close'); }
  }
  var STMT = { ExpressionStatement: 1, VariableDeclaration: 1, ReturnStatement: 1, IfStatement: 1, ForStatement: 1, WhileStatement: 1, DoWhileStatement: 1, SwitchStatement: 1, BlockStatement: 0 };
  function hookStmts(list) { list.forEach(function (s) { if (STMT[s.type]) ins(s.start, hookText(s.loc.start.line), 'open'); }); }
  function wrapBody(b) {                         // if / else bodies without braces
    if (!b || b.type === 'BlockStatement' || b.type === 'IfStatement' || !STMT[b.type]) return;
    ins(b.start, '{' + hookText(b.loc.start.line), 'open'); ins(b.end, '}', 'close');
  }
  function collectNames(n, set) {
    if (!n || typeof n.type !== 'string') return;
    if (n.type === 'VariableDeclarator' && n.id.type === 'Identifier') set.push(n.id.name);
    for (var key in n) { if (key === 'loc' || key === 'type') continue; var v = n[key]; if (Array.isArray(v)) v.forEach(function (c) { collectNames(c, set); }); else if (v && typeof v.type === 'string') collectNames(v, set); }
  }
  function walk(n, scope, inFn) {
    if (!n || typeof n.type !== 'string') return;
    switch (n.type) {
      case 'FunctionDeclaration':
        ins(n.start + 8, '*', 'open'); scope = n.id.name; inFn = true;
        if (opts.debug) {
          ins(n.body.start + 1, '__enter(' + JSON.stringify(n.id.name) + ',' + n.loc.start.line + ');try{', 'open');
          ins(n.body.end - 1, '}finally{__leave();}', 'open');
          var locals = []; collectNames(n.body, locals);
          dbgInfo.fns[n.id.name] = { line: n.loc.start.line, params: n.params.map(function (p) { return p.name; }), locals: locals.filter(function (x, i) { return locals.indexOf(x) === i; }) };
        }
        break;
      case 'BlockStatement': if (inFn && opts.debug) hookStmts(n.body); break;
      case 'SwitchCase': if (inFn && opts.debug) hookStmts(n.consequent); break;
      case 'IfStatement': if (inFn && opts.debug) { wrapBody(n.consequent); wrapBody(n.alternate); } break;
      case 'CallExpression':
        if (inFn && n.callee.type === 'Identifier' && (userFns[n.callee.name] || BLOCKING[n.callee.name])) { ins(n.start, '(yield* ', 'open'); ins(n.end, ')', 'close'); }
        break;
      case 'ForStatement': case 'WhileStatement': case 'DoWhileStatement': if (inFn) loopBody(n.body, n); break;
      case 'BinaryExpression':
        if (n.operator === '/' && !isF(n.left, scope) && !isF(n.right, scope)) trunc(n);
        break;
      case 'AssignmentExpression':
        if (n.operator === '/=' && n.left.type === 'Identifier' && !isF(n.left, scope) && !isF(n.right, scope)) {
          var opS = n.left.end, txt = js.slice(n.left.end, n.right.start), idx = txt.indexOf('/=');
          edits.push({ pos: opS + idx, del: 2, text: '=', rank: 1, ord: order++ });
          ins(n.right.start, 'Math.trunc(' + n.left.name + ' / (', 'open'); ins(n.right.end, '))', 'close');
        } else if (n.operator === '=' && n.left.type === 'Identifier' && kindOf(scope, n.left.name) === 'i' && isF(n.right, scope)) trunc(n.right);
        break;
      case 'VariableDeclarator':
        if (n.init && n.id.type === 'Identifier' && kindOf(scope, n.id.name) === 'i' && isF(n.init, scope) && n.init.type !== 'ArrayExpression') trunc(n.init);
        break;
    }
    for (var key in n) {
      if (key === 'loc' || key === 'type') continue;
      var v = n[key];
      if (Array.isArray(v)) v.forEach(function (c) { walk(c, scope, inFn); });
      else if (v && typeof v.type === 'string') walk(v, scope, inFn);
    }
  }
  var declared = { Math: 1, undefined: 1, NaN: 1, Infinity: 1 };
  Object.keys(info.kinds).forEach(function (s) { declared[s] = 1; Object.keys(info.kinds[s]).forEach(function (n) { declared[n] = 1; }); });
  info.fns.forEach(function (n) { declared[n] = 1; });
  var undeclared = null;
  function refs(n, parent) {
    if (!n || typeof n.type !== 'string' || undeclared) return;
    if (n.type === 'Identifier') {
      if (!declared[n.name] && !(known && known[n.name]) && n.name.slice(0, 2) !== '__') undeclared = n;
      return;
    }
    for (var key in n) {
      if (key === 'loc' || key === 'type') continue;
      if (n.type === 'MemberExpression' && key === 'property' && !n.computed) continue;
      var v = n[key];
      if (Array.isArray(v)) v.forEach(function (c) { refs(c, n); });
      else if (v && typeof v.type === 'string') refs(v, n);
    }
  }
  if (known) {
    refs(ast, null);
    if (undeclared) throw new CErr(undeclared.loc.start.line, "'" + undeclared.name + "' is not declared. Check the spelling, or declare it (for example: int " + undeclared.name + ";). It is also not a function or constant this simulator provides.");
  }
  if (opts.debug) ast.body.forEach(function (s) { if (s.type === 'VariableDeclaration') s.declarations.forEach(function (d) { if (d.id.type === 'Identifier') dbgInfo.globals.push(d.id.name); }); });
  walk(ast, '', false);
  edits.sort(function (a, b) {
    if (a.pos !== b.pos) return a.pos - b.pos;
    if (a.rank !== b.rank) return a.rank - b.rank;
    return a.rank === 0 ? b.ord - a.ord : a.ord - b.ord;
  });
  var res = js;
  for (var q = edits.length - 1; q >= 0; q--) res = res.slice(0, edits[q].pos) + edits[q].text + res.slice(edits[q].pos + edits[q].del);
  pass2.lastDbg = dbgInfo;
  return res;
}

function compile(src, known, opts) {
  try {
    var toks = tokenize(src), pp = preprocess(toks), p1 = pass1(regPrepass(pp.toks, known), src);
    var js = pass2(p1.js, p1, known, opts);
    if (p1.fns.indexOf('main') < 0) throw new CErr(1, 'No main() function found. Every program needs int main(void) { ... }.');
    var seen = {}, fns = p1.fns.filter(function (n) { return seen[n] ? false : (seen[n] = 1); });
    return { js: js, fns: fns, debug: !!(opts && opts.debug), dbg: pass2.lastDbg };
  } catch (e) {
    if (e && e.isCErr) return { error: { line: e.line, msg: e.msg } };
    throw e;
  }
}
return { compile: compile, tokenize: tokenize, _p1: function (s) { var pp = preprocess(tokenize(s)); return pass1(pp.toks, s).js; } };
})();
if (typeof module !== 'undefined') module.exports = CC;
