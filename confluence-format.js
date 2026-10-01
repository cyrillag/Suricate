// Turns a fragment of Confluence storage-format HTML (a Week summary cell or one of its bullets) into
// a small, safe HTML subset that keeps the PM's formatting — bold, italics, underline, strikethrough,
// colours, links — for the report's Highlights (see FUNCTIONAL_RULES.md "Highlights formatting").
//
// The output is inserted into the report as-is, so this is an allowlist, never a blocklist: the
// input is tokenised into tags and text, every tag outside the list is dropped (its text kept),
// attributes are rebuilt from scratch rather than copied, links must be http(s)/mailto, and styles
// keep only explicit colour values and a few text decorations. Text stays exactly as Confluence
// escaped it, with any stray "<" / ">" re-escaped.
const CONFLUENCE_BASE = process.env.CONFLUENCE_BASE || 'https://confluence.ovhcloud.tools';
const JIRA_BASE = 'https://jira.ovhcloud.tools';

const SIMPLE = { strong: 'strong', b: 'strong', em: 'em', i: 'em', u: 'u', s: 's', del: 's', strike: 's', sup: 'sup', sub: 'sub', code: 'code' };
// Atlassian's default body text colour: dropping it lets the text inherit the report's own colour
// instead of being pinned to Confluence's slightly different navy.
const DEFAULT_TEXT = /^#172b4d$/i;

const escAttr = s => String(s).replace(/&(?!(?:[a-z]+|#\d+|#x[0-9a-f]+);)/gi, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escText = s => String(s).replace(/&(?!(?:[a-z]+|#\d+|#x[0-9a-f]+);)/gi, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const attr = (tag, name) => { const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`, 'i')); return m ? m[1] : null; };

// A colour value Confluence writes either plainly (#36B37E, rgb(…)) or as an Atlassian design token
// with a fallback (var(--ds-text-success,#216e4e)) — only the explicit value survives.
function cleanColour(v) {
  if (!v) return null;
  const fallback = v.match(/var\(\s*--[a-z0-9-]+\s*,\s*([^)]+)\)/i);
  const c = (fallback ? fallback[1] : v).trim();
  if (/^#[0-9a-f]{3,8}$/i.test(c)) return c;
  if (/^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d+)\s*)?\)$/i.test(c)) return c.replace(/\s+/g, '');
  return null;
}

// Keeps colour, background colour, bold, italic and underline/strikethrough from an inline style.
function cleanStyle(style) {
  if (!style) return '';
  const out = [];
  style.split(';').forEach(decl => {
    const i = decl.indexOf(':');
    if (i < 0) return;
    const prop = decl.slice(0, i).trim().toLowerCase(), val = decl.slice(i + 1).trim();
    if (prop === 'color') { const c = cleanColour(val); if (c && !DEFAULT_TEXT.test(c)) out.push(`color:${c}`); }
    else if (prop === 'background-color') { const c = cleanColour(val); if (c) out.push(`background-color:${c}`); }
    else if (prop === 'font-weight' && /^(bold|[6-9]00)$/i.test(val)) out.push('font-weight:700');
    else if (prop === 'font-style' && /^italic$/i.test(val)) out.push('font-style:italic');
    else if (prop === 'text-decoration' || prop === 'text-decoration-line') {
      const d = ['underline', 'line-through'].filter(x => val.toLowerCase().includes(x));
      if (d.length) out.push(`text-decoration:${d.join(' ')}`);
    }
  });
  return out.join(';');
}

function safeHref(href) {
  if (!href) return null;
  const h = href.replace(/&amp;/g, '&').trim();
  return /^(https?:\/\/|mailto:)/i.test(h) ? h : null;
}

// Confluence-specific constructs, rewritten to plain HTML before tokenising.
function expandMacros(html, space) {
  return html
    // Jira issue macro → a link to the issue
    .replace(/<ac:structured-macro[^>]*ac:name="jira"[^>]*>[\s\S]*?<ac:parameter ac:name="key">([A-Z][A-Z0-9]*-\d+)<\/ac:parameter>[\s\S]*?<\/ac:structured-macro>/gi,
      (_, key) => `<a href="${JIRA_BASE}/browse/${key}">${key}</a>`)
    // status lozenge → its title
    .replace(/<ac:structured-macro[^>]*ac:name="status"[^>]*>[\s\S]*?<ac:parameter ac:name="title">([^<]*)<\/ac:parameter>[\s\S]*?<\/ac:structured-macro>/gi, ' $1 ')
    // any other macro: dropped whole (its parameters aren't readable text)
    .replace(/<ac:structured-macro[\s\S]*?<\/ac:structured-macro>/gi, '')
    // link to a Confluence page → a link to that page, with its own link text (or the page title)
    .replace(/<ac:link[^>]*>([\s\S]*?)<\/ac:link>/gi, (_, inner) => {
      const page = inner.match(/<ri:page[^>]*ri:content-title="([^"]*)"[^>]*\/?>/i);
      const pageSpace = (inner.match(/ri:space-key="([^"]*)"/i) || [])[1] || space;
      const body = (inner.match(/<ac:(?:plain-text-)?link-body>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/ac:(?:plain-text-)?link-body>/i) || [])[1];
      if (!page) return body ? escText(body) : '';
      const title = page[1];
      const href = `${CONFLUENCE_BASE}/display/${encodeURIComponent(pageSpace || '')}/${encodeURIComponent(title.replace(/&amp;/g, '&')).replace(/%20/g, '+')}`;
      return `<a href="${href}">${body || title}</a>`;
    })
    // date macro → its date
    .replace(/<time[^>]*datetime="([^"]*)"[^>]*\/?>/gi, ' $1 ')
    // drop non-content elements entirely
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '');
}

// `wrapStyle`: a style carried by the bullet itself (<li style="color:…; font-weight:bold">) — the
// report renders its own <li>, so it's applied as a wrapping span instead.
function toSafeInlineHtml(html, { space = null, wrapStyle = null } = {}) {
  const src = expandMacros(String(html || ''), space);
  let out = '';
  const open = [];
  const re = /<\/?([a-z][a-z0-9:-]*)\b[^>]*>|[^<]+|</gi;
  let m;
  while ((m = re.exec(src))) {
    const tok = m[0];
    if (!m[1]) { out += tok === '<' ? '&lt;' : escText(tok); continue; }
    const name = m[1].toLowerCase(), closing = tok[1] === '/';
    if (name === 'br') { out += '<br>'; continue; }
    if (name === 'p' || name === 'div') { if (closing && out && !out.endsWith('<br>')) out += '<br>'; continue; }
    // nested bullets (rare): flattened to line breaks with an indent marker
    if (name === 'li' && !closing) { out += (out && !out.endsWith('<br>') ? '<br>' : '') + '◦ '; continue; }
    let emit = null;
    if (SIMPLE[name]) emit = SIMPLE[name];
    else if (name === 'span') emit = 'span';
    else if (name === 'a') emit = 'a';
    if (!emit) continue; // unknown/unsafe tag: dropped, its text is kept
    if (closing) {
      const idx = open.lastIndexOf(emit);
      if (idx < 0) continue;
      while (open.length > idx) out += `</${open.pop()}>`;
      continue;
    }
    if (emit === 'span') {
      const style = cleanStyle(attr(tok, 'style'));
      if (!style) { open.push('span'); out += '<span>'; continue; }
      open.push('span'); out += `<span style="${escAttr(style)}">`;
    } else if (emit === 'a') {
      const href = safeHref(attr(tok, 'href'));
      open.push('a');
      out += href ? `<a href="${escAttr(href)}" target="_blank" rel="noopener">` : '<a>';
    } else {
      open.push(emit); out += `<${emit}>`;
    }
  }
  while (open.length) out += `</${open.pop()}>`;
  out = out.replace(/\s+/g, ' ').replace(/(\s*<br>\s*)+$/g, '').replace(/^(\s*<br>\s*)+/, '').trim();
  const ws = cleanStyle(wrapStyle);
  return ws && out ? `<span style="${escAttr(ws)}">${out}</span>` : out;
}

// Top-level <li> items of a list, nesting-aware (a regex stopping at the first </li> would cut a
// bullet that has sub-bullets in half). Returns [{ attrs, html }].
function topLevelItems(html) {
  const items = [];
  const re = /<(\/?)(li|ul|ol)\b([^>]*)>/gi;
  let depth = 0, liDepth = 0, start = -1, attrs = '', m;
  while ((m = re.exec(html))) {
    const closing = m[1] === '/', tag = m[2].toLowerCase();
    if (tag === 'ul' || tag === 'ol') { depth += closing ? -1 : 1; continue; }
    if (!closing && start < 0) { start = re.lastIndex; attrs = m[3]; liDepth = depth; }
    else if (closing && start >= 0 && depth === liDepth) { items.push({ attrs, html: html.slice(start, m.index) }); start = -1; }
  }
  return items;
}

module.exports = { toSafeInlineHtml, topLevelItems, cleanStyle };
