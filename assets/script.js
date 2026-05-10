const DATA_INDEX_URL = 'data/index.data';
const SEARCH_MAX = 200;
const PAGE_SIZE_CLANS = 40;
const PAGE_SIZE_MEMBERS = 24;
const MOBILE_PAGE_SIZE = 10;
const NO_CLAN = '__NOCLAN__';
const SEARCH_DEBOUNCE_MS = 300;

const ui = {
  skeletonCard: 'skeleton-card',
  skeletonText: 'skeleton-text',
  timeline: 'timeline',
  timelineItem: 'timeline-item',
  timelineItemNoClan: 'timeline-item-noclan',
  card: 'member-card',
  cardExpanded: 'member-card-expanded',
  cardHeader: 'member-card-header',
  cardBody: 'member-card-body',
  cardButtons: 'member-card-buttons',
  pillButton: 'pill-button',
  memberCopy: 'member-copy',
  memberToggle: 'member-toggle',
  memberArrow: 'member-toggle-arrow',
  memberArrowOpen: 'is-open',
  memberToggleText: 'member-toggle-text',
  memberDetails: 'member-details',
  details: 'member-details-grid',
  detail: 'member-detail',
  detailLabel: 'member-detail-label',
  detailValue: 'member-detail-value',
  sectionTitle: 'section-title',
  pager: 'pager',
  pagerInfo: 'pager-info',
  pagerBtn: 'pager-btn',
  emptyState: 'empty-state',
  searchCount: 'search-count',
  listItem: 'list-item',
  listItemActive: 'list-item-active',
  listTitle: 'list-title',
  listSub: 'list-sub',
  clanCard: 'clan-card',
  clanCardActive: 'clan-card-active',
  clanCardNoClan: 'clan-card-noclan',
  timelineButton: 'timeline-button'
};

const state = {
  index: null,
  nameIndexBuckets: new Map(),
  historyIndexBuckets: new Map(),
  serverKey: null,
  clanKey: null,
  expandedMemberId: null,
  clanPage: 1,
  memberPage: 1,
  clanData: [],
  renderedData: [],
  clanCache: new Map(),
  isLoading: false,
  searchTimeoutId: null,
  searchQuery: '',
  searchMode: 'current' // 'current' or 'history'
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function showSkeletonLoading(target = 'members') {
  const el = document.getElementById(target);
  if(!el) return;

  if(target === 'members') {
    el.innerHTML = `
      <div class="${ui.skeletonCard}">
        <div class="${ui.skeletonText}" style="width:60%;animation:skeleton-shimmer 2s infinite;"></div>
        <div class="${ui.skeletonText}" style="width:40%;animation:skeleton-shimmer 2s infinite;"></div>
      </div>
      <div class="${ui.skeletonCard}">
        <div class="${ui.skeletonText}" style="width:70%;animation:skeleton-shimmer 2s infinite;"></div>
        <div class="${ui.skeletonText}" style="width:50%;animation:skeleton-shimmer 2s infinite;"></div>
      </div>
      <div class="${ui.skeletonCard}">
        <div class="${ui.skeletonText}" style="width:65%;animation:skeleton-shimmer 2s infinite;"></div>
        <div class="${ui.skeletonText}" style="width:45%;animation:skeleton-shimmer 2s infinite;"></div>
      </div>
    `;
  } else if(target === 'clans') {
    el.innerHTML = `
      <div class="${ui.skeletonCard}">
        <div class="${ui.skeletonText}" style="width:70%;animation:skeleton-shimmer 2s infinite;"></div>
      </div>
      <div class="${ui.skeletonCard}">
        <div class="${ui.skeletonText}" style="width:75%;animation:skeleton-shimmer 2s infinite;"></div>
      </div>
      <div class="${ui.skeletonCard}">
        <div class="${ui.skeletonText}" style="width:65%;animation:skeleton-shimmer 2s infinite;"></div>
      </div>
      <div class="${ui.skeletonCard}">
        <div class="${ui.skeletonText}" style="width:80%;animation:skeleton-shimmer 2s infinite;"></div>
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

function getActiveServer(){
  return state.index?.servers?.find(server => server.key === state.serverKey) || null;
}

function getActiveClan(){
  const server = getActiveServer();
  return server?.clans?.find(clan => getClanKeyFromName(clan.name) === state.clanKey) || null;
}

function getVisibleMemberCount(){
  if(state.searchQuery){
    return Array.isArray(state.renderedData) ? state.renderedData.length : 0;
  }
  return Array.isArray(state.clanData) ? state.clanData.length : 0;
}

function updateStatusBar(){
  const serverEl = document.getElementById('status-server');
  const clanEl = document.getElementById('status-clan');
  const visibleEl = document.getElementById('status-visible');
  const modeEl = document.getElementById('status-mode');
  const server = getActiveServer();
  const clan = getActiveClan();
  const visibleCount = getVisibleMemberCount();

  if(serverEl){
    serverEl.textContent = server?.name || 'No server';
  }
  if(clanEl){
    clanEl.textContent = state.searchQuery ? `Search: ${state.searchQuery}` : (clan?.name || 'No clan');
  }
  if(visibleEl){
    visibleEl.textContent = `${visibleCount} member${visibleCount === 1 ? '' : 's'}`;
  }
  if(modeEl){
    if(state.searchQuery){
      modeEl.textContent = `Search (${state.searchMode === 'history' ? 'clan history' : 'current clan'})`;
    } else {
      modeEl.textContent = 'Browse';
    }
  }
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

function getMatchingHistoryClanKeys(serverKey, query){
  const server = state.index?.servers?.find(entry => entry.key === serverKey) || null;
  const text = normalizeSearchValue(query);
  if(!server || !text){
    return [];
  }

  // Get the buckets that match the query (only clans starting with these letters)
  const buckets = getSearchBuckets(query);
  if(!buckets.length){
    return [];
  }

  const clanKeys = [];
  const seen = new Set();
  for(const clan of server.clans || []){
    const clanKey = getClanKeyFromName(clan.name);
    if(clanKey === NO_CLAN || seen.has(clanKey)){
      continue;
    }
    
    const normalizedName = normalizeSearchValue(clan.name);
    // Only process clans that start with one of the search buckets
    const startsWithBucket = buckets.some(bucket => 
      normalizedName.startsWith(bucket) || normalizeSearchValue(clanKey).startsWith(bucket)
    );
    
    if(startsWithBucket && (normalizedName.includes(text) || normalizeSearchValue(clanKey).includes(text))){
      seen.add(clanKey);
      clanKeys.push(clanKey);
    }
  }
  return clanKeys;
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

async function loadServerHistoryIndexBucket(serverKey, bucket){
  const safeServerKey = serverKey || '';
  const safeBucket = bucket || '_';
  const cacheKey = `${safeServerKey}:${safeBucket}`;
  if(state.historyIndexBuckets.has(cacheKey)){
    return state.historyIndexBuckets.get(cacheKey);
  }
  try {
    const data = await loadDataResource(`data/servers/${safeServerKey}/history-clan-index/${safeBucket}.data`);
    const list = Array.isArray(data) ? data : [];
    state.historyIndexBuckets.set(cacheKey, list);
    return list;
  } catch (err) {
    console.warn(`Failed to load history index bucket ${cacheKey}:`, err);
    state.historyIndexBuckets.set(cacheKey, []);
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
  if(!list?.length) return '<div class="history-empty">No history</div>';
  const sorted = sortByDate(list);
  return `<div class="${ui.timeline}">${sorted.map(entry=>{
    const isNoClan = kind === 'clan' && entry.clan === '';
    const label = kind === 'level' ? `Level ${entry.lvl ?? ''}` : (isNoClan ? 'No clan' : (entry.clan || ''));
    const date = formatDate(entry.date);
    const cls = `${ui.timelineItem}${kind === 'level' ? ' timeline-item-level' : ''}${isNoClan ? ` ${ui.timelineItemNoClan}` : ''}`;
    if(kind === 'clan'){
      const fv = isNoClan ? NO_CLAN : label;
      return `<div class="${cls}"><div class="timeline-title-wrap"><button class="${ui.timelineButton}" data-filter="${escapeHtml(fv)}" data-kind="clan">${escapeHtml(label)}</button></div><div class="timeline-date">${escapeHtml(date)}</div></div>`;
    }
    return `<div class="${cls}"><div class="timeline-title-text">${escapeHtml(label)}</div><div class="timeline-date">${escapeHtml(date)}</div></div>`;
  }).join('')}</div>`;
}

function renderMemberCard(it, idx){
  const memberId = getMemberId(it);
  const isExpanded = state.expandedMemberId === memberId;
  return `
    <div class="${ui.card}${isExpanded ? ` ${ui.cardExpanded}` : ''}" style="animation:cardIn 500ms ease both;animation-delay:${Math.min(idx,10)*40}ms" data-member-card="true" data-member-id="${escapeHtml(memberId)}">
      <div class="${ui.cardHeader}">
        <div class="${ui.cardBody}">
          <div class="member-name">${escapeHtml(it.name||'')}</div>
          <div class="member-meta">Last clan: ${escapeHtml(getLatestClan(it)||'No clan')}</div>
        </div>
        <div class="${ui.cardButtons}">
          <button type="button" class="${ui.memberCopy}" data-action="member-copy" data-member-id="${escapeHtml(memberId)}" aria-label="Copy member info">Copy</button>
          <button class="${ui.pillButton}" data-filter="${escapeHtml(it.server||'')}" data-kind="server">${escapeHtml(it.server||'')}</button>
          <button type="button" class="${ui.memberToggle}" data-action="member-toggle" aria-expanded="${isExpanded}" aria-label="${isExpanded ? 'Hide member details' : 'Show member details'}">
            <span class="${ui.memberArrow}${isExpanded ? ` ${ui.memberArrowOpen}` : ''}" aria-hidden="true">▾</span>
            <span class="${ui.memberToggleText}">${isExpanded ? 'Hide' : 'Details'}</span>
          </button>
        </div>
      </div>
      <div class="${ui.memberDetails}"${isExpanded?'':' hidden'}>
        <div class="${ui.details}">
          <div class="${ui.detail}"><div class="${ui.detailLabel}">Class</div><div class="${ui.detailValue}">${escapeHtml(getMainClass(it))}</div></div>
          <div class="${ui.detail}"><div class="${ui.detailLabel}">Last update</div><div class="${ui.detailValue}">${escapeHtml(formatDate(it.last_update))}</div></div>
          <div class="${ui.detail}"><div class="${ui.detailLabel}">Latest clan</div><div class="${ui.detailValue}"><button class="${ui.pillButton}" data-filter="${escapeHtml(getLatestClan(it)||NO_CLAN)}" data-kind="clan">${escapeHtml(getLatestClan(it)||'No clan')}</button></div></div>
          <div class="${ui.detail}"><div class="${ui.detailLabel}">Found date</div><div class="${ui.detailValue}">${escapeHtml(formatDate(it.found_date))}</div></div>
        </div>
        <div class="${ui.sectionTitle}">Clan history</div>
        ${renderTimeline(it.clan,'clan')}
        <div class="${ui.sectionTitle}">Level history</div>
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
    <div class="${ui.pager}" role="navigation" aria-label="${kind} pagination">
      <button type="button" class="${ui.pagerBtn}" data-page-kind="${kind}" data-page="${page - 1}" ${prevDisabled}>Prev</button>
      <div class="${ui.pagerInfo}">Page ${page} of ${totalPages}</div>
      <button type="button" class="${ui.pagerBtn}" data-page-kind="${kind}" data-page="${page + 1}" ${nextDisabled}>Next</button>
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
      ? 'No members matched that search. Try a different name, server, or clan.'
      : 'No members to show for the selected clan yet.';
    el.innerHTML = `<div class="${ui.emptyState}">${escapeHtml(message)}</div>`;
    updateStatusBar();
    return;
  }

  const { totalPages, page, start, end } = getPagination(list.length, getPageSize(PAGE_SIZE_MEMBERS), state.memberPage);
  state.memberPage = page;
  const pageItems = list.slice(start, end);

  let html = '';
  if(isSearchActive){
    html += `<div class="${ui.searchCount}">Showing <span class="search-count-value">${list.length}</span> result${list.length !== 1 ? 's' : ''}</div>`;
  }
  html += pageItems.map(renderMemberCard).join('') + renderPager('members', page, totalPages);
  el.innerHTML = html;
  updateStatusBar();
}

function renderServers(servers, activeKey){
  const el = document.getElementById('servers');
  if(!el){
    return;
  }
  el.innerHTML = '';
  [...servers].sort((a,b)=>a.name.localeCompare(b.name)).forEach(sv=>{
    const d = document.createElement('div');
    d.className = `${ui.listItem}${sv.key===activeKey ? ` ${ui.listItemActive}` : ''}`;
    d.setAttribute('data-server', sv.key);
    d.innerHTML = `
      <div>
        <div class="${ui.listTitle}">${escapeHtml(sv.name)}</div>
        <div class="${ui.listSub}">${sv.count} members</div>
      </div>
      <button type="button" class="${ui.pillButton}" data-filter="${escapeHtml(sv.key)}" data-kind="server">View</button>`;
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
    option.textContent = `${sv.name} (${sv.count})`;
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
    btn.className = `${ui.clanCard}${key===activeClanKey ? ` ${ui.clanCardActive}` : ''}${key===NO_CLAN ? ` ${ui.clanCardNoClan}` : ''}`;
    btn.setAttribute('data-clan', key);
    btn.setAttribute('aria-pressed', key===activeClanKey?'true':'false');
    btn.setAttribute('aria-label', `Select ${escapeHtml(clan.name||'No clan')} clan`);
    btn.innerHTML = `<div class="${ui.listTitle}">${escapeHtml(clan.name||'No clan')}</div><div class="${ui.listSub}">${clan.count} members</div>`;
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
  state.searchQuery = '';
  state.clanData = [];
  state.renderedData = [];
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
  state.clanKey = firstClanKey;
  updateStatusBar();
  if(firstClanKey){
    await setActiveClan(firstClanKey);
  }
}

async function setActiveClan(clanKey){
  state.clanKey = clanKey;
  state.expandedMemberId = null;
  state.memberPage = 1;
  state.searchQuery = '';
  state.clanData = [];
  state.renderedData = [];
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
    updateStatusBar();
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
  state.searchQuery = q;

  if(!q){
    // Restore current clan view
    renderMembers(state.clanData || []);
    updateStatusBar();
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
    
    if(state.searchMode === 'history'){
      const historyClanKeys = getMatchingHistoryClanKeys(serverKey, q);
      if(historyClanKeys.length){
        const historyIndex = (await Promise.all(historyClanKeys.map(clanKey=>loadServerHistoryIndexBucket(serverKey, clanKey)))).flat();
        const seen = new Set();
        const matches = historyIndex.filter(entry => {
          const entryId = `${normalizeSearchValue(entry.name)}|${normalizeSearchValue(entry.server)}`;
          if(seen.has(entryId)){
            return false;
          }
          const matched = [entry.name, entry.server, entry.clan, entry.historyClan, entry.historyClanKey]
            .some(v => normalizeSearchValue(v).includes(q));
          if(matched){
            seen.add(entryId);
          }
          return matched;
        });

        renderMembers(matches.slice(0, SEARCH_MAX));
        return;
      }

      const nameIndex = (await Promise.all(buckets.map(bucket=>loadServerNameIndexBucket(serverKey, bucket)))).flat();
      const matches = nameIndex.filter(e => [e.name, e.server, e.clan]
        .some(v => normalizeSearchValue(v).includes(q)));

      renderMembers(matches.slice(0, SEARCH_MAX));
    } else {
      // Search current clan index (default)
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
    }
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
  const toggleButtons = document.querySelectorAll('[data-target]');

  toggleButtons.forEach(btn => {
    const target = btn.getAttribute('data-target');
    if(!target) return;
    const collapseEl = document.querySelector(target);
    if(!collapseEl) return;

    function updateText(){
      const isHidden = collapseEl.classList.contains('hidden');
      const textEl = btn.querySelector('.toggle-text');
      if(textEl){
        textEl.textContent = isHidden ? 'Show' : 'Hide';
      }
      btn.setAttribute('aria-expanded', isHidden ? 'false' : 'true');
    }

    // Initial state
    updateText();

    btn.addEventListener('click', () => {
      collapseEl.classList.toggle('hidden');
      updateText();
    });
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
      // Debounced search to avoid immediate multiple queries
      debouncedApplySearch();
    });

    // Search mode toggle
    const searchModeToggle = document.getElementById('search-mode-toggle');
    if(searchModeToggle){
      const syncSearchModeToggle = ()=>{
        const historyMode = state.searchMode === 'history';
        const modeText = searchModeToggle.querySelector('.search-mode-toggle-state');
        if(modeText){
          modeText.textContent = historyMode ? 'On' : 'Off';
        }
        searchModeToggle.setAttribute('aria-checked', String(historyMode));
        searchModeToggle.classList.toggle('active', historyMode);
        searchModeToggle.setAttribute('title', historyMode ? 'Clan history is on.' : 'Clan history is off.');
      };
      syncSearchModeToggle();
      searchModeToggle.addEventListener('click', ()=>{
        state.searchMode = state.searchMode === 'current' ? 'history' : 'current';
        syncSearchModeToggle();

        // Re-apply search (debounced) if there's an active query
        if(filterInput.value.trim()){
          debouncedApplySearch();
        }
      });
    }

    // Load first server and first clan by default
    const firstServer = [...idx.servers].sort((a,b)=>a.name.localeCompare(b.name))[0];
    if(firstServer){
      await setActiveServer(firstServer.key);
    }
    updateStatusBar();
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
    ['clansCollapse'].forEach(id=>{
      const el = document.getElementById(id);
      if(!el) return;
      const btn = document.querySelector(`[data-target="#${id}"]`);
      if(isDesktop){ el.classList.remove('hidden'); btn?.setAttribute('aria-expanded','true'); }
      else { el.classList.add('hidden'); btn?.setAttribute('aria-expanded','false'); }
      if(btn){
        const textEl = btn.querySelector('.toggle-text');
        if(textEl) textEl.textContent = isDesktop ? 'Hide' : 'Show';
      }
    });
  };
  applyCollapseDefaults();
  window.addEventListener('resize', applyCollapseDefaults);

  // Global click delegation
  document.body.addEventListener('click', async e=>{
    const pagerBtn = e.target.closest('[data-page-kind]');
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
    const toggle = e.target.closest('[data-action="member-toggle"]');
    if(toggle){
      e.preventDefault();
      const card = toggle.closest('[data-member-card]');
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

    const copyBtn = e.target.closest('[data-action="member-copy"]');
    if(copyBtn){
      const card = copyBtn.closest('[data-member-card]');
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
    if(serverRow && !e.target.closest('[data-filter]')){
      state.expandedMemberId = null;
      document.getElementById('filter').value = '';
      await setActiveServer(serverRow.getAttribute('data-server'));
      return;
    }

    // Clan card click
    const clanCard = e.target.closest('[data-clan]');
    if(clanCard && clanCard.matches('button[data-clan]')){
      state.expandedMemberId = null;
      document.getElementById('filter').value = '';
      document.getElementById('clear-search').hidden = true;
      await setActiveClan(clanCard.getAttribute('data-clan'));
    }
  });
});

// ── Dark Mode ─────────────────────────────────────────────────────────────────

function initTheme() {
  const saved = localStorage.getItem('theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const isDark = saved === 'dark' || (!saved && prefersDark);
  
  if(isDark) {
    document.documentElement.classList.add('dark-mode');
  }
  
  const themeToggle = document.getElementById('theme-toggle');
  if(themeToggle) {
    themeToggle.addEventListener('click', toggleTheme);
  }
}

function toggleTheme() {
  const isDark = document.documentElement.classList.toggle('dark-mode');
  localStorage.setItem('theme', isDark ? 'dark' : 'light');
}

// Initialize theme on page load
initTheme();
