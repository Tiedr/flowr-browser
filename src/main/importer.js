function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < String(text || '').length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
    else field += char;
  }
  if (field || row.length) { row.push(field.replace(/\r$/, '')); rows.push(row); }
  return rows;
}

function parsePasswordCsv(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const headers = rows[0].map(value => value.trim().toLowerCase());
  const column = (...names) => names.map(name => headers.indexOf(name)).find(index => index >= 0) ?? -1;
  const nameIndex = column('name', 'title');
  const urlIndex = column('url', 'origin', 'website');
  const usernameIndex = column('username', 'user', 'login_username');
  const passwordIndex = column('password', 'login_password');
  if (passwordIndex < 0) return [];
  return rows.slice(1).map(values => ({
    title: nameIndex >= 0 ? values[nameIndex] : '',
    url: urlIndex >= 0 ? values[urlIndex] : '',
    username: usernameIndex >= 0 ? values[usernameIndex] : '',
    password: values[passwordIndex] || ''
  })).filter(item => item.password && /^https?:\/\//i.test(item.url || ''));
}

function decodeHtml(value) {
  return String(value || '').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function parseBookmarkHtml(text) {
  const bookmarks = [];
  const source = String(text || '');
  const pattern = /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = pattern.exec(source))) {
    const url = decodeHtml(match[1]);
    if (!/^https?:\/\//i.test(url)) continue;
    const title = decodeHtml(match[2].replace(/<[^>]+>/g, '').trim()) || url;
    bookmarks.push({ url, title });
  }
  return bookmarks;
}

function parseChromiumBookmarks(value) {
  const document = typeof value === 'string' ? JSON.parse(value) : value;
  const bookmarks = [];
  const visit = (node, folder = '') => {
    if (!node) return;
    if (node.type === 'url' && /^https?:\/\//i.test(node.url || '')) bookmarks.push({ url: node.url, title: node.name || node.url, folder });
    if (Array.isArray(node.children)) {
      const nextFolder = node.name && !/^(bookmark_bar|other|synced)$/i.test(node.name) ? node.name : folder;
      node.children.forEach(child => visit(child, nextFolder));
    }
  };
  Object.values(document?.roots || {}).forEach(root => visit(root));
  return bookmarks;
}

module.exports = { parseCsv, parsePasswordCsv, parseBookmarkHtml, parseChromiumBookmarks };
