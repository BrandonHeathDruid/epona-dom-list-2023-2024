const DATA_INDEX_URL = 'data/index.data';
const SEARCH_MAX = 200;
const PAGE_SIZE_CLANS = 40;
const PAGE_SIZE_MEMBERS = 24;
const MOBILE_PAGE_SIZE = 10;
const NO_CLAN = '__NOCLAN__';
const SEARCH_DEBOUNCE_MS = 300;

const state = {
  index: null,
  nameIndexBuckets: new Map(),
  serverKey: null,
  clanKey: null,
  expandedMemberId: null,
  clanPage: 1,
  memberPage: 1,
  clanData: [],
  renderedData: [],   // what's currently shown (search results or clan members)
  clanCache: new Map(),
  isLoading: false,
  searchTimeoutId: null
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function showSkeletonLoading(target = 'members') {
  const el = document.getElementById(target);
  if(!el) return;

  if(target === 'members') {
    el.innerHTML = `
      <div class="skeleton-card">
        <div class="skeleton skeleton-text" style="width:60%;"></div>
        <div class="skeleton skeleton-text" style="width:40%;"></div>
      </div>
      <div class="skeleton-card">
        <div class="skeleton skeleton-text" style="width:70%;"></div>
        <div class="skeleton skeleton-text" style="width:50%;"></div>
      </div>
      <div class="skeleton-card">
        <div class="skeleton skeleton-text" style="width:65%;"></div>
        <div class="skeleton skeleton-text" style="width:45%;"></div>
      </div>
    `;
  } else if(target === 'clans') {
    el.innerHTML = `
      <div class="skeleton-card">
        <div class="skeleton skeleton-text" style="width:70%;"></div>
      </div>
      <div class="skeleton-card">
        <div class="skeleton skeleton-text" style="width:75%;"></div>
      </div>
      <div class="skeleton-card">
        <div class="skeleton skeleton-text" style="width:65%;"></div>
      </div>
      <div class="skeleton-card">
        <div class="skeleton skeleton-text" style="width:80%;"></div>
      </div>
    `;
  }
}

function showServerSelectSkeleton() {
  const el = document.getElementById('server-select');
  if(el) {
    el.innerHTML = '<option disabled>Loading...</option>';
    el.disabled = true;
  }
}

function setLoading(isLoading) {
  state.isLoading = isLoading;
  if(isLoading) {
    showSkeletonLoading();
  }
}

function showError(message, delayMs = 1500) {
  setTimeout(() => {
    const modal = document.getElementById('error-modal');
    const msgEl = document.getElementById('error-modal-message');
    if(modal && msgEl) {
      msgEl.textContent = message;
      modal.classList.remove('hidden');
    }
  }, delayMs);
}

function showCopyPopup(text, title = 'Copy unavailable') {
  const modal = document.getElementById('copy-modal');
  const titleEl = document.getElementById('copy-modal-title');
  const statusEl = document.getElementById('copy-modal-status');
  const textEl = document.getElementById('copy-modal-text');
  if(!modal || !textEl) {
    return;
  }

  if(titleEl) {
    titleEl.textContent = title;
  }
  if(statusEl) {
    statusEl.textContent = 'Clipboard access failed on this device. Select the text below and copy it manually.';
  }

  textEl.value = text;
  modal.classList.remove('hidden');
  window.requestAnimationFrame(() => {
    textEl.focus();
    textEl.select();
    textEl.setSelectionRange(0, textEl.value.length);
  });
}

function debounce(fn, delayMs) {
  return function(...args) {
    clearTimeout(state.searchTimeoutId);
    state.searchTimeoutId = setTimeout(() => fn(...args), delayMs);
  };
}

// ── Data loading ──────────────────────────────────────────────────────────────

async function loadIndex(){
  try {
    return await loadDataResource(DATA_INDEX_URL);
  } catch (err) {
    console.error('Failed to load index:', err);
    throw err;
  }
}

async function decodeBase64GzipJson(base64){
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for(let i = 0; i < binary.length; i++){
    bytes[i] = binary.charCodeAt(i);
  }

  if(typeof DecompressionStream === 'undefined'){
    if(typeof window.pako === 'undefined'){
      await loadPakoFallback();
    }
    if(typeof window.pako === 'undefined' || typeof window.pako.inflate !== 'function'){
      throw new Error('This browser does not support gzip decoding');
    }
    const decoded = window.pako.inflate(bytes, { to: 'string' });
    return JSON.parse(decoded);
  }

  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  const text = await new Response(stream).text();
  return JSON.parse(text);
}

async function loadPakoFallback(){
  if(window.pako){
    return;
  }
  await new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-pako-fallback="true"]');
    if(existing){
      existing.addEventListener('load', resolve, { once: true });
      existing.addEventListener('error', reject, { once: true });
      return;
    }
    const script = document.createElement('script');
    script.dataset.pakoFallback = 'true';
    script.src = 'https://cdn.jsdelivr.net/npm/pako@2.1.0/dist/pako.min.js';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load gzip fallback decoder'));
    document.head.appendChild(script);
  });
}

async function loadDataResource(url){
  const resp = await fetch(url);
  if(!resp.ok){
    throw new Error(`HTTP ${resp.status}`);
  }

  const payload = (await resp.text()).trim();
  if(!payload){
    return null;
  }

  if(payload.startsWith('{') || payload.startsWith('[')){
    const parsed = JSON.parse(payload);
    if(parsed && parsed.encoding === 'base64+gzip' && typeof parsed.data === 'string'){
      return decodeBase64GzipJson(parsed.data);
    }
    return parsed;
  }

  return decodeBase64GzipJson(payload);
}

function getSearchBuckets(query){
  const text = (query || '').trim().toLowerCase();
  if(!text) return [];
  const tokens = text.split(/[^a-z0-9]+/i).filter(Boolean);
  const tokensToProcess = tokens.length > 0 ? tokens : [text];
  const buckets = new Set();
  for(const token of tokensToProcess){
    const first = token[0];
    buckets.add(/[a-z0-9]/.test(first) ? first : '_');
  }
  return [...buckets].slice(0, 4);
}

function normalizeSearchValue(value){
  if(value === null || value === undefined){
    return '';
  }
  return String(value).toLowerCase();
}

async function loadServerNameIndexBucket(serverKey, bucket){
  const safeServerKey = serverKey || '';
  const safeBucket = bucket || '_';
  const cacheKey = `${safeServerKey}:${safeBucket}`;
  if(state.nameIndexBuckets.has(cacheKey)){
    return state.nameIndexBuckets.get(cacheKey);
  }
  try {
    const data = await loadDataResource(`data/servers/${safeServerKey}/name-index/${safeBucket}.data`);
    const list = Array.isArray(data) ? data : [];
    state.nameIndexBuckets.set(cacheKey, list);
    return list;
  } catch (err) {
    console.warn(`Failed to load name index bucket ${cacheKey}:`, err);
    state.nameIndexBuckets.set(cacheKey, []);
    return [];
  }
}

async function loadClanFile(filePath){
  if(state.clanCache.has(filePath)) return state.clanCache.get(filePath);
  try {
    const data = await loadDataResource(filePath);
    if(data && data.paged && Array.isArray(data.pages)) {
      const base = filePath.slice(0, filePath.lastIndexOf('/') + 1);
      const pageData = await Promise.all(data.pages.map(page=>loadDataResource(base + page)));
      const list = pageData.flatMap(p=>Array.isArray(p) ? p : [p]);
      state.clanCache.set(filePath, list);
      return list;
    }
    const list = Array.isArray(data) ? data : [data];
    state.clanCache.set(filePath, list);
    return list;
  } catch (err) {
    console.error(`Failed to load clan file ${filePath}:`, err);
    throw err;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseDate(v){
  if(!v) return null;
  if(typeof v === 'string') return new Date(v);
  if(v.$date) return new Date(v.$date);
  return null;
}

function formatDate(v){
  const d = parseDate(v);
  if(!d || isNaN(d)) return '';
  return d.toISOString().split('T')[0];
}

function getLatestLevel(it){
  if(Array.isArray(it?.level)) return it.level.length ? (it.level[it.level.length-1].lvl ?? '') : '';
  if(it?.level && typeof it.level === 'object') return it.level.lvl ?? '';
  return it?.level ?? '';
}
function getMainClass(it){
  if(Array.isArray(it?.class)) return it.class.length ? (it.class[it.class.length-1].class || '') : '';
  if(it?.class && typeof it.class === 'object') return it.class.class ?? '';
  return it?.class ?? '';
}
function getLatestClan(it){
  if(Array.isArray(it?.clan)) return it.clan.length ? (it.clan[it.clan.length-1].clan || '') : '';
  if(it?.clan && typeof it.clan === 'object') return it.clan.clan ?? '';
  return it?.clan ?? '';
}
function getMemberId(it){ return it.id || it._id?.$oid || `${it.server||''}:${it.name||''}`; }

function formatHistoryList(list, valueKey){
  if(!list || !list.length){
    return 'None';
  }
  const sorted = sortByDate(list);
  return sorted.map(entry=>{
    const value = entry[valueKey] ?? '';
    const date = formatDate(entry.date);
    return `- ${value} (${date})`;
  }).join('\n');
}

function buildDiscordMemberText(it){
  const name = it.name || 'Unknown';
  const server = it.server || 'Unknown';
  const latestClan = getLatestClan(it) || 'No clan';
  const latestLevel = getLatestLevel(it) || 'Unknown';
  const mainClass = getMainClass(it) || 'Unknown';
  const lastUpdate = formatDate(it.last_update) || 'Unknown';
  const foundDate = formatDate(it.found_date) || 'Unknown';
  const clanHistory = formatHistoryList(it.clan, 'clan');
  const levelHistory = formatHistoryList(it.level, 'lvl');

  return [
    `**${name}** (${server})`,
    `Class: ${mainClass}`,
    `Latest clan: ${latestClan}`,
    `Latest level: ${latestLevel}`,
    `Found: ${foundDate}`,
    `Last update: ${lastUpdate}`,
    '',
    '**Clan history**',
    clanHistory,
    '',
    '**Level history**',
    levelHistory
  ].join('\n');
}

async function copyTextToClipboard(text){
  if(navigator.clipboard && typeof navigator.clipboard.writeText === 'function'){
    try{
      await navigator.clipboard.writeText(text);
      return true;
    }catch{
      // Fall through to the manual selection-based copy path.
    }
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.top = '-9999px';
  textarea.style.left = '-9999px';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  let copied = false;
  try{
    copied = document.execCommand('copy');
  }catch{
    copied = false;
  }

  document.body.removeChild(textarea);
  return copied;
}

function getSafeKey(v, fallback){
  if(!v || !String(v).trim()) return fallback;
  return String(v).replace(/[^A-Za-z0-9._-]/g, '_') || fallback;
}

function getClanKeyFromName(name){
  return (!name || name === 'No clan') ? NO_CLAN : getSafeKey(name, NO_CLAN);
}

function getClanFilePath(serverKey, clanKey){
  return `data/servers/${serverKey}/clans/${clanKey}.data`;
}

function getClanFilePathFromEntry(serverKey, clanFile){
  return `data/servers/${serverKey}/clans/${clanFile}`;
}

function escapeHtml(s){ return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]); }

function sortByDate(list){
  return [...list].sort((a,b)=>{
    const ad = parseDate(a.date)||new Date(0);
    const bd = parseDate(b.date)||new Date(0);
    return ad - bd;
  });
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function renderTimeline(list, kind){
  if(!list?.length) return '<div class="meta">No history</div>';
  const sorted = sortByDate(list);
  return `<div class="timeline">${sorted.map(entry=>{
    const isNoClan = kind === 'clan' && entry.clan === '';
    const label = kind === 'level' ? `Level ${entry.lvl ?? ''}` : (isNoClan ? 'No clan' : (entry.clan || ''));
    const date = formatDate(entry.date);
    const cls = `timeline-item${kind === 'level' ? ' level' : ''}${isNoClan ? ' noclan' : ''}`;
    if(kind === 'clan'){
      const fv = isNoClan ? NO_CLAN : label;
      return `<div class="${cls}"><div class="timeline-title"><button class="filter-link" data-filter="${escapeHtml(fv)}" data-kind="clan">${escapeHtml(label)}</button></div><div class="timeline-sub">${escapeHtml(date)}</div></div>`;
    }
    return `<div class="${cls}"><div class="timeline-title">${escapeHtml(label)}</div><div class="timeline-sub">${escapeHtml(date)}</div></div>`;
  }).join('')}</div>`;
}

function renderMemberCard(it, idx){
  const memberId = getMemberId(it);
  const isExpanded = state.expandedMemberId === memberId;
  return `
    <div class="card${isExpanded?' expanded':''}" style="animation-delay:${Math.min(idx,10)*40}ms" data-member-id="${escapeHtml(memberId)}">
      <div class="card-header">
        <div>
          <div class="name">${escapeHtml(it.name||'')}</div>
          <div class="meta">Last clan: ${escapeHtml(getLatestClan(it)||'No clan')}</div>
        </div>
        <div class="card-buttons">
          <button type="button" class="member-copy" data-member-id="${escapeHtml(memberId)}" aria-label="Copy member info">Copy</button>
          <button class="filter-link" data-filter="${escapeHtml(it.server||'')}" data-kind="server">${escapeHtml(it.server||'')}</button>
          <button type="button" class="member-toggle" aria-expanded="${isExpanded}" aria-label="Toggle member details">
            <span class="arrow">▾</span>
          </button>
        </div>
      </div>
      <div class="member-details"${isExpanded?'':' hidden'}>
        <div class="details">
          <div class="detail"><div class="detail-label">Class</div><div class="detail-value">${escapeHtml(getMainClass(it))}</div></div>
          <div class="detail"><div class="detail-label">Last update</div><div class="detail-value">${escapeHtml(formatDate(it.last_update))}</div></div>
          <div class="detail"><div class="detail-label">Latest clan</div><div class="detail-value"><button class="filter-link" data-filter="${escapeHtml(getLatestClan(it)||NO_CLAN)}" data-kind="clan">${escapeHtml(getLatestClan(it)||'No clan')}</button></div></div>
          <div class="detail"><div class="detail-label">Found date</div><div class="detail-value">${escapeHtml(formatDate(it.found_date))}</div></div>
        </div>
        <div class="section-title">Clan history</div>
        ${renderTimeline(it.clan,'clan')}
        <div class="section-title">Level history</div>
        ${renderTimeline(it.level,'level')}
      </div>
    </div>`;
}

function getPagination(total, pageSize, page){
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * pageSize;
  const end = start + pageSize;
  return { totalPages, page: safePage, start, end };
}

function getPageSize(base){
  const width = window.innerWidth;
  if(width < 640) return MOBILE_PAGE_SIZE;
  if(width < 1024) return Math.max(12, Math.floor(base * 0.75));
  if(width > 1920) return Math.ceil(base * 1.25);
  return base;
}

function renderPager(kind, page, totalPages){
  if(totalPages <= 1){
    return '';
  }
  const prevDisabled = page <= 1 ? 'disabled' : '';
  const nextDisabled = page >= totalPages ? 'disabled' : '';
  return `
    <div class="pager" role="navigation" aria-label="${kind} pagination">
      <button type="button" class="pager-btn" data-page-kind="${kind}" data-page="${page - 1}" ${prevDisabled}>Prev</button>
      <div class="pager-info">Page ${page} of ${totalPages}</div>
      <button type="button" class="pager-btn" data-page-kind="${kind}" data-page="${page + 1}" ${nextDisabled}>Next</button>
    </div>
  `;
}

function renderMembers(items){
  state.renderedData = items;
  const el = document.getElementById('members');
  const list = Array.isArray(items) ? items : [];

  const filterInput = document.getElementById('filter');
  const isSearchActive = filterInput && filterInput.value.trim().length > 0;

  if(!list.length){
    const message = isSearchActive
      ? 'No members found. Try a different search.'
      : 'No members to show.';
    el.innerHTML = `<div class="meta empty-state">${escapeHtml(message)}</div>`;
    return;
  }

  const { totalPages, page, start, end } = getPagination(list.length, getPageSize(PAGE_SIZE_MEMBERS), state.memberPage);
  state.memberPage = page;
  const pageItems = list.slice(start, end);

  let html = '';
  if(isSearchActive){
    html += `<div class="search-result-count">Found <span class="count-number">${list.length}</span> member${list.length !== 1 ? 's' : ''}</div>`;
  }
  html += pageItems.map(renderMemberCard).join('') + renderPager('members', page, totalPages);
  el.innerHTML = html;
}

function renderServers(servers, activeKey){
  const el = document.getElementById('servers');
  if(!el){
    return;
  }
  el.innerHTML = '';
  [...servers].sort((a,b)=>a.name.localeCompare(b.name)).forEach(sv=>{
    const d = document.createElement('div');
    d.className = `list-item${sv.key===activeKey?' active':''}`;
    d.setAttribute('data-server', sv.key);
    d.innerHTML = `
      <div>
        <div class="list-title">${escapeHtml(sv.name)}</div>
        <div class="list-sub">${sv.count} members</div>
      </div>
      <button type="button" class="filter-link" data-filter="${escapeHtml(sv.key)}" data-kind="server">View</button>`;
    el.appendChild(d);
  });
}

function renderServerSelect(servers, activeKey){
  const el = document.getElementById('server-select');
  if(!el){
    return;
  }
  el.disabled = false;
  el.innerHTML = '';
  [...servers].sort((a,b)=>a.name.localeCompare(b.name)).forEach(sv=>{
    const option = document.createElement('option');
    option.value = sv.key;
    option.textContent = sv.name;
    if(sv.key === activeKey){
      option.selected = true;
    }
    el.appendChild(option);
  });
}

function renderClans(clans, activeClanKey){
  const el = document.getElementById('clans');
  el.innerHTML = '';
  const sorted = [...clans].sort((a,b)=>a.name.localeCompare(b.name));
  const { totalPages, page, start, end } = getPagination(sorted.length, getPageSize(PAGE_SIZE_CLANS), state.clanPage);
  state.clanPage = page;
  sorted.slice(start, end).forEach(clan=>{
    const key = getClanKeyFromName(clan.name);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `clan-card${key===activeClanKey?' active':''}${key===NO_CLAN?' noclan':''}`;
    btn.setAttribute('data-clan', key);
    btn.setAttribute('aria-pressed', key===activeClanKey?'true':'false');
    btn.setAttribute('aria-label', `Select ${escapeHtml(clan.name||'No clan')} clan`);
    btn.innerHTML = `<div class="list-title">${escapeHtml(clan.name||'No clan')}</div><div class="list-sub">${clan.count} members</div>`;
    el.appendChild(btn);
  });
  if(totalPages > 1){
    const pager = document.createElement('div');
    pager.innerHTML = renderPager('clans', page, totalPages);
    el.appendChild(pager.firstElementChild);
  }
}

// ── Navigation ────────────────────────────────────────────────────────────────

async function setActiveServer(serverKey){
  state.serverKey = serverKey;
  state.expandedMemberId = null;
  state.clanPage = 1;
  const serverSelect = document.getElementById('server-select');
  const filterInput = document.getElementById('filter');
  const clearSearchBtn = document.getElementById('clear-search');

  if(serverSelect && serverSelect.value !== serverKey){
    serverSelect.value = serverKey || '';
  }

  if(filterInput) filterInput.value = '';
  if(clearSearchBtn) clearSearchBtn.hidden = true;

  showSkeletonLoading('clans');
  showSkeletonLoading('members');

  const server = state.index.servers.find(s=>s.key===serverKey);
  renderServerSelect(state.index.servers, serverKey);
  renderServers(state.index.servers, serverKey);
  const clans = server?.clans || [];
  // Skip __NOCLAN__ and find the first real clan
  const firstRealClan = clans.find(c => getClanKeyFromName(c.name) !== '__NOCLAN__');
  const firstClanKey = firstRealClan ? getClanKeyFromName(firstRealClan.name) : null;
  renderClans(clans, firstClanKey);
  if(firstClanKey){
    await setActiveClan(firstClanKey);
  }
}

async function setActiveClan(clanKey){
  state.clanKey = clanKey;
  state.expandedMemberId = null;
  state.memberPage = 1;
  if(!clanKey){ state.clanData=[]; renderMembers([]); return; }
  const server = state.index.servers.find(s=>s.key===state.serverKey);
  const clan = server?.clans.find(c=>getClanKeyFromName(c.name)===clanKey);
  if(!clan){ state.clanData=[]; renderMembers([]); return; }
  renderClans(server.clans, clanKey);
  setLoading(true);
  try {
    const data = await loadClanFile(getClanFilePath(state.serverKey, clanKey));
    state.clanData = data;
    renderMembers(data);
  } catch (err) {
    console.error('Failed to load clan:', err);
    showError('Failed to load clan members. Please try again.');
  } finally {
    setLoading(false);
  }
}

// ── Search ────────────────────────────────────────────────────────────────────

async function applySearch(){
  const q = document.getElementById('filter').value.trim().toLowerCase();
  state.expandedMemberId = null;
  state.memberPage = 1;

  if(!q){
    // Restore current clan view
    renderMembers(state.clanData || []);
    return;
  }

  // Load only the relevant bucket(s) for this query.
  const buckets = getSearchBuckets(q);
  if(!buckets.length){
    renderMembers([]);
    return;
  }

  setLoading(true);
  try {
    const serverKey = document.getElementById('server-select')?.value || state.serverKey;
    const nameIndex = (await Promise.all(buckets.map(bucket=>loadServerNameIndexBucket(serverKey, bucket)))).flat();
    const matches = nameIndex.filter(e => [e.name, e.server, e.clan]
      .some(v => normalizeSearchValue(v).includes(q)));

    if(!matches.length){
      renderMembers([]);
      return;
    }

    // Use name-index entries directly as search results
    const results = matches.slice(0, SEARCH_MAX);
    renderMembers(results);
  } catch (err) {
    console.error('Search failed:', err);
    showError('Search failed. Please try again.');
  } finally {
    setLoading(false);
  }
}

const debouncedApplySearch = debounce(applySearch, SEARCH_DEBOUNCE_MS);

// ── Toggle text ───────────────────────────────────────────────────────────────

function initToggleText(){
  const toggleButtons = document.querySelectorAll('.collapse-toggle');

  toggleButtons.forEach(btn => {
    const target = btn.getAttribute('data-bs-target');
    const collapseEl = document.querySelector(target);
    if(!collapseEl) return;

    function updateText(){
      const isShown = collapseEl.classList.contains('show');
      const textEl = btn.querySelector('.toggle-text');
      if(textEl){
        textEl.textContent = isShown ? 'Hide' : 'Show';
      }
      btn.setAttribute('aria-expanded', isShown ? 'true' : 'false');
    }

    // Wait for Bootstrap to initialize collapse state
    setTimeout(() => {
      updateText();
    }, 10);

    collapseEl.addEventListener('shown.bs.collapse', updateText);
    collapseEl.addEventListener('hidden.bs.collapse', updateText);
  });
}

// ── Init & events ─────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async ()=>{
  initToggleText();
  showServerSelectSkeleton();
  showSkeletonLoading('clans');
  showSkeletonLoading('members');
  try {
    const idx = await loadIndex();
    state.index = idx;
    renderServerSelect(idx.servers, null);
    const serverSelect = document.getElementById('server-select');
    if(serverSelect){
      serverSelect.disabled = false;
    }

    const filterInput = document.getElementById('filter');
    const clearSearchBtn = document.getElementById('clear-search');

    function updateClearSearchVisibility(){
      clearSearchBtn.hidden = !filterInput.value.trim();
    }

    filterInput.addEventListener('input', ()=>{
      updateClearSearchVisibility();
      debouncedApplySearch();
    });

    clearSearchBtn.addEventListener('click', ()=>{
      filterInput.value = '';
      clearSearchBtn.hidden = true;
      applySearch();
      filterInput.focus();
    });

    serverSelect.addEventListener('change', async ()=>{
      const nextServer = serverSelect.value || null;
      await setActiveServer(nextServer);
      await applySearch();
    });

    // Load first server and first clan by default
    const firstServer = [...idx.servers].sort((a,b)=>a.name.localeCompare(b.name))[0];
    if(firstServer){
      await setActiveServer(firstServer.key);
    }
  } catch (err) {
    console.error('Failed to initialize:', err);
    showSkeletonLoading();
    showError('Failed to load data. Please refresh the page.');
  }

  // Error modal handlers
  const errorModal = document.getElementById('error-modal');
  const errorCloseBtn = document.getElementById('error-modal-close');
  const errorReloadBtn = document.getElementById('error-modal-reload');
  const copyModal = document.getElementById('copy-modal');
  const copyCloseBtn = document.getElementById('copy-modal-close');
  const copyCopyBtn = document.getElementById('copy-modal-copy');
  const copyTextarea = document.getElementById('copy-modal-text');
  if(errorCloseBtn) errorCloseBtn.addEventListener('click', ()=>{
    if(errorModal) errorModal.classList.add('hidden');
  });
  if(errorReloadBtn) errorReloadBtn.addEventListener('click', ()=>{
    location.reload();
  });
  if(copyCloseBtn) copyCloseBtn.addEventListener('click', ()=>{
    if(copyModal) copyModal.classList.add('hidden');
  });
  if(copyCopyBtn && copyTextarea) copyCopyBtn.addEventListener('click', async ()=>{
    const copied = await copyTextToClipboard(copyTextarea.value);
    copyCopyBtn.textContent = copied ? 'Copied' : 'Copy failed';
    setTimeout(()=>{ copyCopyBtn.textContent = 'Copy'; }, copied ? 1200 : 1500);
  });
  if(copyModal && copyTextarea){
    copyModal.addEventListener('click', (event)=>{
      if(event.target === copyModal){
        copyModal.classList.add('hidden');
      }
    });
    copyTextarea.addEventListener('click', ()=>{
      copyTextarea.select();
      copyTextarea.setSelectionRange(0, copyTextarea.value.length);
    });
  }

  // Collapse/expand defaults by viewport
  const applyCollapseDefaults = ()=>{
    const isDesktop = window.matchMedia('(min-width:900px)').matches;
    ['serversCollapse','clansCollapse'].forEach(id=>{
      const el = document.getElementById(id);
      if(!el) return;
      const btn = el.previousElementSibling?.querySelector('.collapse-toggle');
      if(isDesktop){ el.classList.add('show'); btn?.setAttribute('aria-expanded','true'); }
      else { el.classList.remove('show'); btn?.setAttribute('aria-expanded','false'); }
    });
  };
  applyCollapseDefaults();
  window.addEventListener('resize', applyCollapseDefaults);

  // Global click delegation
  document.body.addEventListener('click', async e=>{
    const pagerBtn = e.target.closest('.pager-btn');
    if(pagerBtn){
      const kind = pagerBtn.getAttribute('data-page-kind');
      const page = parseInt(pagerBtn.getAttribute('data-page') || '1', 10);
      if(kind === 'members'){
        state.memberPage = page;
        renderMembers(state.renderedData || []);
      }else if(kind === 'clans'){
        state.clanPage = page;
        const server = state.index.servers.find(s=>s.key===state.serverKey);
        renderClans(server?.clans || [], state.clanKey);
      }
      return;
    }
    // Accordion toggle
    const toggle = e.target.closest('.member-toggle');
    if(toggle){
      e.preventDefault();
      const card = toggle.closest('.card');
      if(!card) return;
      const mid = card.getAttribute('data-member-id')||'';
      state.expandedMemberId = state.expandedMemberId === mid ? null : mid;

      if(state.expandedMemberId === mid){
        const member = (state.renderedData || []).find(it=>getMemberId(it) === mid);
        if(member && (!Array.isArray(member.class) || !Array.isArray(member.level) || !Array.isArray(member.clan)) && member.clanFile){
          try {
            const clanFilePath = getClanFilePathFromEntry(member.serverKey || state.serverKey, member.clanFile);
            const clanMembers = await loadClanFile(clanFilePath);
            const fullMember = clanMembers.find(it=>getMemberId(it) === mid || (it.name === member.name && it.server === member.server));
            if(fullMember){
              Object.assign(member, fullMember);
            }
          } catch (err) {
            console.error('Failed to load member details:', err);
          }
        }
      }

      renderMembers(state.renderedData);
      return;
    }

    const copyBtn = e.target.closest('.member-copy');
    if(copyBtn){
      const card = copyBtn.closest('.card');
      if(!card){
        return;
      }
      const memberId = card.getAttribute('data-member-id') || '';
      const member = (state.renderedData || []).find(it=>getMemberId(it) === memberId);
      if(!member){
        return;
      }
      const text = buildDiscordMemberText(member);
      try{
        const copied = await copyTextToClipboard(text);
        copyBtn.textContent = copied ? 'Copied' : 'Copy failed';
        if(!copied){
          showCopyPopup(text, 'Copy failed');
        }
        setTimeout(()=>{ copyBtn.textContent = 'Copy'; }, copied ? 1200 : 1500);
      }catch{
        copyBtn.textContent = 'Copy failed';
        showCopyPopup(text, 'Copy failed');
        setTimeout(()=>{ copyBtn.textContent = 'Copy'; }, 1500);
      }
      return;
    }

    // Filter/navigation buttons
    const btn = e.target.closest('[data-filter]');
    if(btn){
      e.preventDefault();
      const kind = btn.getAttribute('data-kind');
      const value = btn.getAttribute('data-filter')||'';
      // Clear search box and member filter text
      document.getElementById('filter').value = '';
      state.expandedMemberId = null;
      if(kind === 'server'){
        await setActiveServer(value);
      } else if(kind === 'clan'){
        await setActiveClan(value);
      }
      return;
    }

    // Server list row click
    const serverRow = e.target.closest('[data-server]');
    if(serverRow && !e.target.closest('.filter-link')){
      state.expandedMemberId = null;
      document.getElementById('filter').value = '';
      await setActiveServer(serverRow.getAttribute('data-server'));
      return;
    }

    // Clan card click
    const clanCard = e.target.closest('[data-clan]');
    if(clanCard && clanCard.classList.contains('clan-card')){
      state.expandedMemberId = null;
      document.getElementById('filter').value = '';
      document.getElementById('clear-search').hidden = true;
      await setActiveClan(clanCard.getAttribute('data-clan'));
    }
  });
});
