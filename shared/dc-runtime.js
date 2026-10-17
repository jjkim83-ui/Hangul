/* =========================================================
   dc-runtime.js — runs the design-canvas pages as plain web pages.
   Supports: {{path}} holes, <sc-for list as>, <sc-if value>,
   onClick / onChange / onKeyDown handlers, a DCLogic base class
   (state, setState, componentDidMount, componentWillUnmount),
   scale-to-fit for the fixed 1280x720 stage, and offline data
   (content/*.js registers JSON so pages also work from file://).
   Needs morphdom (shared/vendor/morphdom.min.js) loaded first.
========================================================= */
(function () {
  'use strict';

  /* ---------- offline data for fetch() ---------- */
  window.DC_DATA = window.DC_DATA || {};
  const realFetch = window.fetch ? window.fetch.bind(window) : null;
  window.fetch = function (url, opts) {
    const key = typeof url === 'string' ? url.replace(/^\.\//, '') : '';
    if (key && Object.prototype.hasOwnProperty.call(window.DC_DATA, key)) {
      const data = window.DC_DATA[key];
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(JSON.parse(JSON.stringify(data))) });
    }
    if (!realFetch) return Promise.reject(new Error('fetch unavailable'));
    return realFetch(url, opts);
  };

  /* ---------- base class ---------- */
  class DCLogic {
    constructor(props) { this.props = props || {}; this.state = {}; }
    setState(patch, cb) {
      const p = typeof patch === 'function' ? patch(this.state, this.props) : patch;
      this.state = Object.assign({}, this.state, p || {});
      if (this.__dc) this.__dc.schedule();
      if (cb) Promise.resolve().then(cb);
    }
    forceUpdate() { if (this.__dc) this.__dc.schedule(); }
  }
  window.DCLogic = DCLogic;

  /* ---------- template rendering ---------- */
  const VOID = { area: 1, base: 1, br: 1, col: 1, embed: 1, hr: 1, img: 1, input: 1, link: 1, meta: 1, source: 1, track: 1, wbr: 1 };
  const EVT = { onclick: 'click', onchange: 'input', oninput: 'input', onkeydown: 'keydown', onkeyup: 'keyup', onsubmit: 'submit', onblur: 'blur', onfocus: 'focus', onpointerdown: 'pointerdown' };
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const escA = (s) => esc(s).replace(/"/g, '&quot;');

  function resolve(expr, scope) {
    expr = expr.trim();
    if (expr === 'true') return true;
    if (expr === 'false') return false;
    if (expr === 'null') return null;
    if (/^-?\d+(\.\d+)?$/.test(expr)) return Number(expr);
    if (/^'.*'$/.test(expr)) return expr.slice(1, -1);
    let v = scope;
    for (const part of expr.split('.')) {
      if (v === null || v === undefined) return undefined;
      v = v[part];
    }
    return v;
  }
  const HOLE = /\{\{([^}]*)\}\}/g;
  const ONLY_HOLE = /^\s*\{\{([^}]*)\}\}\s*$/;
  function interp(str, scope) {
    return str.replace(HOLE, (m, e) => { const v = resolve(e, scope); return v === undefined || v === null || v === false ? '' : String(v); });
  }

  function renderNodes(nodes, scope, ctx) {
    let out = '';
    for (const n of nodes) out += renderNode(n, scope, ctx);
    return out;
  }
  function kids(n) { return n.content ? Array.from(n.content.childNodes) : Array.from(n.childNodes); }

  function renderNode(n, scope, ctx) {
    if (n.nodeType === 3) return esc(interp(n.nodeValue, scope));
    if (n.nodeType !== 1) return '';
    const tag = n.localName;
    if (tag === 'sc-for') {
      const list = resolve((n.getAttribute('list') || '').replace(/^\s*\{\{|\}\}\s*$/g, ''), scope) || [];
      const as = n.getAttribute('as') || 'item';
      let out = '';
      list.forEach((item, i) => { const s = Object.create(scope); s[as] = item; s.$index = i; out += renderNodes(kids(n), s, ctx); });
      return out;
    }
    if (tag === 'sc-if') {
      const v = resolve((n.getAttribute('value') || '').replace(/^\s*\{\{|\}\}\s*$/g, ''), scope);
      return v ? renderNodes(kids(n), scope, ctx) : '';
    }
    let attrs = '';
    for (const a of Array.from(n.attributes)) {
      const name = a.name;
      if (name.indexOf('hint-placeholder') === 0) continue;
      const lname = name.toLowerCase();
      if (EVT[lname]) {
        const m = a.value.match(ONLY_HOLE);
        const fn = m ? resolve(m[1], scope) : null;
        if (typeof fn === 'function') {
          const id = ctx.handlers.push(fn) - 1;
          attrs += ' data-dc-' + EVT[lname] + '="' + id + '"';
        }
        continue;
      }
      const m = a.value.match(ONLY_HOLE);
      if (m) {
        const v = resolve(m[1], scope);
        if (v === undefined || v === null || v === false) continue;
        attrs += ' ' + name + '="' + escA(v === true ? '' : v) + '"';
      } else {
        attrs += ' ' + name + '="' + escA(interp(a.value, scope)) + '"';
      }
    }
    if (VOID[tag]) return '<' + tag + attrs + '>';
    return '<' + tag + attrs + '>' + renderNodes(kids(n), scope, ctx) + '</' + tag + '>';
  }

  /* ---------- stage scaling ---------- */
  // phones: the 1280x720 stage renders at ~0.5x, so <html> gets .dc-phone (theme.css enlarges
  // text + tap targets under it) and the stage widens to the screen's aspect (up to PHONE_MAXW)
  // so the bigger type has room instead of sitting between two empty side bars.
  const PHONE_MAXW = 1600;
  function isPhone() {
    const vw = window.innerWidth, vh = window.innerHeight;
    return Math.min(vw, vh) < 500 && Math.max(vw, vh) < 1000;
  }
  function fit(stage, w, h) {
    const phone = isPhone();
    document.documentElement.classList.toggle('dc-phone', phone);
    let sw = w;
    if (phone && window.innerWidth > window.innerHeight) {
      sw = Math.round(Math.min(PHONE_MAXW, Math.max(w, h * window.innerWidth / window.innerHeight)));
    }
    if (stage.style.width !== sw + 'px') stage.style.width = sw + 'px';
    const s = Math.min(window.innerWidth / sw, window.innerHeight / h);
    stage.style.transform = 'translate(-50%, -50%) scale(' + s + ')';
    window.DC_SCALE = s;
  }

  /* ---------- mount ---------- */
  function mount(Component, opts) {
    opts = opts || {};
    const tpl = document.getElementById('dc-view');
    const W = opts.width || 1280, H = opts.height || 720;
    const stage = document.createElement('div');
    stage.id = 'dc-stage';
    stage.style.cssText = 'position:fixed;left:50%;top:50%;width:' + W + 'px;height:' + H + 'px;transform-origin:50% 50%';
    const root = document.createElement('div');
    root.style.cssText = 'width:100%;height:100%';
    stage.appendChild(root);
    document.body.appendChild(stage);
    // phones held upright: the 16:9 stage would be tiny, so ask to rotate
    const rot = document.createElement('div');
    rot.id = 'dc-rotate';
    rot.style.cssText = "position:fixed;inset:0;z-index:99999;display:none;flex-direction:column;align-items:center;justify-content:center;gap:18px;padding:24px;box-sizing:border-box;text-align:center;background:linear-gradient(160deg,#E4DCF4,#FCE3DE 55%,#DDF3E9);color:#2B2C6B;font-family:'Jua','Nunito',system-ui,sans-serif";
    rot.innerHTML = '<div style="font-size:84px;line-height:1;animation:dcTilt 1.8s ease-in-out infinite">📱</div>'
      + '<div style="font-size:30px;line-height:1.25">휴대폰을 옆으로<br>돌려 주세요</div>'
      + '<div style="font-family:Nunito,system-ui,sans-serif;font-weight:800;font-size:16px;color:#4A4C80">Handy quer halten · Turn your phone sideways</div>'
      + '<style>@keyframes dcTilt{0%,25%{transform:rotate(0)}55%,85%{transform:rotate(-90deg)}100%{transform:rotate(0)}}</style>';
    document.body.appendChild(rot);
    const onResize = () => {
      fit(stage, W, H);
      const upright = window.innerHeight > window.innerWidth && window.innerWidth < 760;
      rot.style.display = upright ? 'flex' : 'none';
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', () => setTimeout(onResize, 150));
    if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize);
    if (window.matchMedia) { try { window.matchMedia('(orientation: landscape)').addEventListener('change', onResize); } catch (e) {} }
    // installed on an Android home screen: keep it sideways (iPhones don't allow a site to lock this)
    const lockLandscape = () => { try { if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {}); } catch (e) {} };
    lockLandscape(); window.addEventListener('pointerdown', lockLandscape, { once: true });
    onResize();

    const nodes = kids(tpl);
    const comp = new Component({});
    let handlers = [];
    let queued = false, mounted = false;

    function render() {
      queued = false;
      let vals;
      try { vals = comp.renderVals ? comp.renderVals() : {}; } catch (e) { console.error('[dc] renderVals failed', e); return; }
      const ctx = { handlers: [] };
      const html = renderNodes(nodes, vals || {}, ctx);
      handlers = ctx.handlers;
      if (!mounted) { root.innerHTML = html; return; }
      const next = document.createElement('div');
      next.innerHTML = html;
      window.morphdom(root, next, {
        childrenOnly: true,
        onBeforeElUpdated(from, to) {
          // keep the caret / IME composition of the field being typed in
          if (from === document.activeElement && (from.tagName === 'INPUT' || from.tagName === 'TEXTAREA') && from.type !== 'range') {
            const v = to.getAttribute('value') || '';
            if (from.value === v || composing) {
              for (const a of Array.from(to.attributes)) if (a.name !== 'value' && from.getAttribute(a.name) !== a.value) from.setAttribute(a.name, a.value);
              return false;
            }
          }
          return true;
        }
      });
    }
    let composing = false;
    comp.__dc = { schedule() { if (!queued) { queued = true; Promise.resolve().then(render); } } };

    function dispatch(type) {
      root.addEventListener(type, (e) => {
        let el = e.target;
        while (el && el !== root) {
          const id = el.getAttribute && el.getAttribute('data-dc-' + type);
          if (id !== null && id !== undefined) {
            const fn = handlers[+id];
            if (fn) {
              const se = {
                type, target: el, currentTarget: el, key: e.key, nativeEvent: e,
                preventDefault: () => e.preventDefault(), stopPropagation: () => e.stopPropagation()
              };
              fn(se);
            }
            return;
          }
          el = el.parentNode;
        }
      }, type === 'focus' || type === 'blur');
    }
    ['click', 'input', 'keydown', 'keyup', 'submit', 'pointerdown'].forEach(dispatch);
    root.addEventListener('compositionstart', () => { composing = true; });
    root.addEventListener('compositionend', (e) => { composing = false; e.target.dispatchEvent(new Event('input', { bubbles: true })); });

    render();
    mounted = true;
    if (comp.componentDidMount) comp.componentDidMount();
    window.addEventListener('pagehide', () => { if (comp.componentWillUnmount) comp.componentWillUnmount(); });
    window.__dcComponent = comp;
    return comp;
  }

  window.DC = { mount, DCLogic };
})();
