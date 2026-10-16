let _config = null;

const BOARD_CATEGORIES = ['충무공동 시세동향', '분양·입주 소식', '부동산 세무·정책', '공인중개사 컬럼/일상'];

const CATEGORY_STYLES = {
  '충무공동 시세동향': 'bg-primary/10 text-primary',
  '분양·입주 소식': 'bg-tertiary/10 text-tertiary',
  '부동산 세무·정책': 'bg-secondary/10 text-secondary',
  '공인중개사 컬럼/일상': 'bg-surface-container text-foreground-secondary'
};

const LOCAL_POSTS_KEY = 'board_posts_cache';

async function loadConfig() {
  if (_config) return _config;
  let api = {}, file = {};
  try { const r = await fetch('/api/config'); if (r.ok) api = await r.json(); } catch(e) {}
  try { const r = await fetch('config/git_config.json'); if (r.ok) file = await r.json(); } catch(e) {}
  const apiTok = String(api.github_token || '').trim();
  const fileTok = String(file.github_token || '').trim();
  _config = {
    github_token: (apiTok && apiTok !== 'YOUR_GITHUB_TOKEN') ? apiTok : fileTok,
    github_owner: file.github_owner || '',
    github_repo: file.github_repo || '',
    data_file_path: file.data_file_path || 'data/posts.json',
    admin_password: api.admin_password || file.admin_password || 'admin1234'
  };
  return _config;
}

function cleanToken(token) {
  return String(token || '').replace(/\s+/g, '');
}

function hasGithubToken(cfg) {
  const t = cleanToken(cfg && cfg.github_token);
  return !!t && t !== 'YOUR_GITHUB_TOKEN' && !!cfg.github_owner && !!cfg.github_repo;
}

function isLocalHost() {
  return ['localhost', '127.0.0.1', '[::1]', ''].includes(location.hostname);
}

function githubHeaders(cfg) {
  return {
    'Authorization': 'token ' + cleanToken(cfg.github_token),
    'Accept': 'application/vnd.github+json'
  };
}

function githubContentsUrl(cfg) {
  const path = String(cfg.data_file_path).split('/').map(encodeURIComponent).join('/');
  return 'https://api.github.com/repos/' + encodeURIComponent(cfg.github_owner) + '/' + encodeURIComponent(cfg.github_repo) + '/contents/' + path;
}

async function githubError(res) {
  let msg = res.statusText || 'Error';
  try { const j = await res.json(); if (j && j.message) msg = j.message; } catch(e) {}
  return msg + '(' + res.status + ')';
}

function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

function base64ToUtf8(b64) {
  const bin = atob(String(b64 || '').replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function normalizePosts(list) {
  return (Array.isArray(list) ? list : [])
    .filter(p => p && p.id != null)
    .map(p => Object.assign({}, p, { id: String(p.id) }))
    .sort((a, b) => {
      const d = String(b.date || '').localeCompare(String(a.date || ''));
      if (d) return d;
      return b.id > a.id ? 1 : b.id < a.id ? -1 : 0;
    });
}

function readLocalPosts() {
  try {
    const raw = localStorage.getItem(LOCAL_POSTS_KEY);
    return raw ? normalizePosts(JSON.parse(raw)) : null;
  } catch(e) { return null; }
}

function writeLocalPosts(posts) {
  try { localStorage.setItem(LOCAL_POSTS_KEY, JSON.stringify(posts)); } catch(e) {}
}

async function fetchStaticPosts() {
  try {
    const r = await fetch('data/posts.json?t=' + Date.now(), { cache: 'no-store' });
    if (r.ok) return normalizePosts(await r.json());
  } catch(e) {}
  return null;
}

async function fetchRemotePosts(cfg) {
  const r = await fetch(githubContentsUrl(cfg) + '?t=' + Date.now(), { headers: githubHeaders(cfg), cache: 'no-store' });
  if (r.status === 404) return { posts: [], sha: null };
  if (!r.ok) throw new Error(await githubError(r));
  const j = await r.json();
  const text = base64ToUtf8(j.content).trim();
  return { posts: normalizePosts(text ? JSON.parse(text) : []), sha: j.sha };
}

async function putRemotePosts(cfg, posts, sha, message) {
  const body = { message: message, content: utf8ToBase64(JSON.stringify(posts, null, 2) + '\n') };
  if (sha) body.sha = sha;
  const r = await fetch(githubContentsUrl(cfg), {
    method: 'PUT',
    headers: Object.assign({}, githubHeaders(cfg), { 'Content-Type': 'application/json' }),
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error('저장 실패: ' + await githubError(r));
}

async function getPosts() {
  const cfg = await loadConfig();
  if (hasGithubToken(cfg)) {
    try {
      const { posts } = await fetchRemotePosts(cfg);
      writeLocalPosts(posts);
      return posts;
    } catch(e) {
      console.warn('GitHub 조회 실패, 정적 데이터로 대체합니다.', e);
    }
  } else {
    const local = readLocalPosts();
    if (local) return local;
  }
  const staticPosts = await fetchStaticPosts();
  if (staticPosts) return staticPosts;
  return readLocalPosts() || [];
}

async function getPost(id) {
  const posts = await getPosts();
  return posts.find(p => p.id === String(id)) || null;
}

async function mutatePosts(mutator, message) {
  const cfg = await loadConfig();
  if (hasGithubToken(cfg)) {
    const { posts, sha } = await fetchRemotePosts(cfg);
    const next = normalizePosts(mutator(posts));
    await putRemotePosts(cfg, next, sha, message);
    writeLocalPosts(next);
    return 'github';
  }
  if (!isLocalHost()) {
    throw new Error('GitHub 토큰이 설정되지 않았습니다. Vercel 환경변수 GITHUB_TOKEN을 확인해 주세요.');
  }
  const base = readLocalPosts() || (await fetchStaticPosts()) || [];
  writeLocalPosts(normalizePosts(mutator(base)));
  return 'local';
}

async function savePost(input) {
  const post = Object.assign({}, input);
  post.id = String(post.id || Date.now());
  post.updated_at = new Date().toISOString();
  let isNew = true;
  const mode = await mutatePosts(list => {
    const i = list.findIndex(p => p.id === post.id);
    if (i >= 0) { isNew = false; list[i] = Object.assign({}, list[i], post); }
    else list.unshift(post);
    return list;
  }, (post.id && !input.id ? 'post: create ' : 'post: update ') + post.title);
  return { post: post, mode: mode, isNew: isNew };
}

async function deletePost(id) {
  const target = String(id);
  return mutatePosts(list => list.filter(p => p.id !== target), 'post: delete ' + target);
}

function isAdmin() {
  try { return sessionStorage.getItem('isAdmin') === 'true'; } catch(e) { return false; }
}

function requireAdmin() {
  if (!isAdmin()) {
    location.replace('admin.html');
    return false;
  }
  return true;
}

async function adminLogin(password) {
  const cfg = await loadConfig();
  if (String(password) === String(cfg.admin_password)) {
    try { sessionStorage.setItem('isAdmin', 'true'); } catch(e) {}
    return true;
  }
  return false;
}

function adminLogout() {
  try { sessionStorage.clear(); } catch(e) {}
}

function handleAgentLogin(event) {
  if (event) event.preventDefault();
  location.href = 'admin.html';
}

function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDate(d) {
  const m = String(d || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[1] + '.' + m[2] + '.' + m[3] : String(d || '');
}

function getCategoryStyle(category) {
  return CATEGORY_STYLES[category] || 'bg-surface-container text-foreground-secondary';
}

function getQueryParam(name) {
  return new URLSearchParams(location.search).get(name);
}

function renderInlineMarkdown(text) {
  const parts = String(text).split('`');
  return parts.map((seg, idx) => {
    if (idx % 2 === 1 && idx < parts.length - 1) return '<code>' + escapeHtml(seg) + '</code>';
    let s = escapeHtml(idx % 2 === 1 ? '`' + seg : seg);
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (all, label, url) => {
      const raw = url.replace(/&amp;/g, '&');
      if (!/^(https?:\/\/|mailto:)/i.test(raw)) return label;
      return '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + label + '</a>';
    });
    s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/~~(.+?)~~/g, '<del>$1</del>');
    s = s.replace(/(^|[^*])\*([^*\s](?:[^*]*?[^*\s])?)\*(?!\*)/g, '$1<em>$2</em>');
    return s;
  }).join('');
}

function renderMarkdown(src) {
  const lines = String(src || '').replace(/\r\n?/g, '\n').split('\n');
  const hr = /^\s*([-*_])(\s*\1){2,}\s*$/;
  const ul = /^\s*[-*+]\s+/;
  const ol = /^\s*\d+[.)]\s+/;
  let html = '';
  let para = [];
  let i = 0;
  const flush = () => {
    if (para.length) { html += '<p>' + para.map(renderInlineMarkdown).join('<br>') + '</p>'; para = []; }
  };
  while (i < lines.length) {
    const line = lines[i];
    let m;
    if (/^\s*```/.test(line)) {
      flush();
      const buf = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++;
      html += '<pre><code>' + escapeHtml(buf.join('\n')) + '</code></pre>';
      continue;
    }
    if (!line.trim()) { flush(); i++; continue; }
    if ((m = line.match(/^\s*(#{1,6})\s+(.*?)\s*#*\s*$/))) {
      flush();
      const n = m[1].length;
      html += '<h' + n + '>' + renderInlineMarkdown(m[2]) + '</h' + n + '>';
      i++;
      continue;
    }
    if (hr.test(line)) { flush(); html += '<hr>'; i++; continue; }
    if (/^\s*>/.test(line)) {
      flush();
      const buf = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) { buf.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
      html += '<blockquote>' + renderMarkdown(buf.join('\n')) + '</blockquote>';
      continue;
    }
    if (ul.test(line) || ol.test(line)) {
      flush();
      const re = ul.test(line) ? ul : ol;
      const tag = re === ul ? 'ul' : 'ol';
      const items = [];
      while (i < lines.length && re.test(lines[i]) && !hr.test(lines[i])) { items.push(lines[i].replace(re, '')); i++; }
      html += '<' + tag + '>' + items.map(t => '<li>' + renderInlineMarkdown(t) + '</li>').join('') + '</' + tag + '>';
      continue;
    }
    para.push(line);
    i++;
  }
  flush();
  return html;
}

function markdownToText(src) {
  return String(src || '')
    .replace(/\r\n?/g, '\n')
    .replace(/^\s*```.*$/gm, '')
    .replace(/^\s*#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*([-*_])(\s*\1){2,}\s*$/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*\*|~~|`/g, '')
    .replace(/(^|[^*])\*([^*\s](?:[^*]*?[^*\s])?)\*/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim();
}

Object.assign(window, {
  BOARD_CATEGORIES, CATEGORY_STYLES, loadConfig, getPosts, getPost, savePost, deletePost,
  isAdmin, requireAdmin, adminLogin, adminLogout, handleAgentLogin, escapeHtml, formatDate,
  getCategoryStyle, getQueryParam, renderMarkdown, markdownToText
});
