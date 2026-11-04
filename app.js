import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { T } from './i18n.js';

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

/* ---------- helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const fmt = n => Math.round(Number(n) || 0).toLocaleString('en-US');
const fmtK = n => fmt(n) + ' ₭';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const parseAmt = s => Number(String(s).replace(/[^\d]/g, '')) || 0;
const store = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } }
};

/* ---------- i18n ---------- */
let LANG = store.get('lang');
const t = (k, vars) => {
  let s = (T[LANG || 'lo'][k] ?? T.lo[k] ?? k);
  if (vars) for (const [a, b] of Object.entries(vars)) s = s.split(`{${a}}`).join(b);
  return s;
};
const L = () => T[LANG || 'lo'];
function applyI18n() {
  document.documentElement.lang = LANG || 'lo';
  document.title = t('appName');
  $$('[data-i18n]').forEach(el => { el.innerHTML = t(el.dataset.i18n); });
  $$('[data-i18n-ph]').forEach(el => { el.placeholder = t(el.dataset.i18nPh); });
  $$('[data-setlang]').forEach(b => b.classList.toggle('active', b.dataset.setlang === LANG));
  $('#switch-method').textContent = authMethod === 'phone' ? t('useEmail') : t('usePhone');
  $('#email-submit').textContent = emailMode === 'login' ? t('login') : t('signup');
  $('#phone-submit').textContent = phoneMode === 'login' ? t('login') : t('signup');
}
async function setLang(l) {
  const first = !LANG;
  LANG = l; store.set('lang', l); applyI18n();
  if (first) { showAuth(); return; }
  if (S.user) {
    sb.from('profiles').update({ lang: l, updated_at: new Date().toISOString() }).eq('id', S.user.id).then(() => {});
    renderProfileBits();
    await loadCats();
    renderCatSettings();
    go(S.page);
  }
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-setlang]');
  if (b) setLang(b.dataset.setlang);
});

const monthLabel = d => `${L().months[d.getMonth()]} ${d.getFullYear()}`;
const dayLabel = s => { const d = parseYmd(s); return `${L().days[d.getDay()]} ${d.getDate()} ${L().monthsS[d.getMonth()]}`; };
const monthRange = (offset = 0) => {
  const n = new Date(); const a = new Date(n.getFullYear(), n.getMonth() + offset, 1);
  const b = new Date(a.getFullYear(), a.getMonth() + 1, 0); return [a, b];
};
const weekRange = (offset = 0) => {
  const n = new Date(); const dow = (n.getDay() + 6) % 7; // Monday = 0
  const a = new Date(n.getFullYear(), n.getMonth(), n.getDate() - dow + offset * 7);
  const b = new Date(a.getFullYear(), a.getMonth(), a.getDate() + 6); return [a, b];
};
function toast(msg) {
  const el = $('#toast'); el.textContent = msg; el.classList.remove('hidden');
  clearTimeout(toast._t); toast._t = setTimeout(() => el.classList.add('hidden'), 2400);
}
function fail(e) { console.error(e); toast('❌ ' + (e?.message || t('error'))); }
function bindAmount(input) {
  input.addEventListener('input', () => { const v = parseAmt(input.value); input.value = v ? fmt(v) : ''; });
}

/* ---------- state ---------- */
const S = {
  user: null, profile: null, cats: [], catMap: {}, page: 'home',
  txOffset: 0, planPeriod: 'month', planOffset: 0, dashRange: 6,
  editing: null, budgets: [], budgetCat: null, charts: {}
};

/* ---------- auth: views ---------- */
let authMethod = 'phone', emailMode = 'login';
function showAuth() {
  $('#app').classList.add('hidden');
  if (!LANG) { $('#auth-view').classList.add('hidden'); $('#lang-view').classList.remove('hidden'); return; }
  $('#lang-view').classList.add('hidden'); $('#auth-view').classList.remove('hidden');
  applyI18n();
}
function authMsg(text, kind = '') { const m = $('#auth-msg'); m.className = 'msg ' + kind; m.textContent = text || ''; }
function showAuthStep(step) {
  $('#phone-form').classList.toggle('hidden', step !== 'phone');
  $('#email-form').classList.toggle('hidden', step !== 'email');
  authMsg('');
}
$('#switch-method').onclick = () => {
  authMethod = authMethod === 'phone' ? 'email' : 'phone';
  showAuthStep(authMethod); applyI18n();
};

/* phone + password (free: account is created by the phone-signup edge function, no SMS) */
const PHONE_DOMAIN = 'phone.money-app.la';
let phoneMode = 'login';
function normalizePhone(raw) {
  let d = String(raw).replace(/\D/g, '');
  if (d.startsWith('856')) d = d.slice(3);
  if (d.startsWith('0')) d = d.slice(1);
  return d.length >= 8 && d.length <= 10 ? '856' + d : null;
}
const phoneEmail = p => `${p}@${PHONE_DOMAIN}`;
$$('#phone-mode button').forEach(b => b.onclick = () => {
  phoneMode = b.dataset.pmode;
  $$('#phone-mode button').forEach(x => x.classList.toggle('active', x === b));
  const su = phoneMode === 'signup';
  $('#name-row').classList.toggle('hidden', !su);
  $('#pass2-row').classList.toggle('hidden', !su);
  $('#su-name').required = su; $('#phone-pass2').required = su;
  $('#phone-pass').autocomplete = su ? 'new-password' : 'current-password';
  applyI18n(); authMsg('');
});
$('#phone-form').onsubmit = async e => {
  e.preventDefault();
  const phone = normalizePhone($('#phone-input').value);
  const password = $('#phone-pass').value;
  if (!phone) return authMsg(t('errPhone'), 'err');
  if (password.length < 6) return authMsg(t('errPassShort'), 'err');
  const btn = $('#phone-submit'); btn.disabled = true; authMsg(t('working'));
  try {
    if (phoneMode === 'signup') {
      const name = $('#su-name').value.trim();
      if (!name) throw new Error(t('nameRequired'));
      if (password !== $('#phone-pass2').value) throw new Error(t('errPassMatch'));
      const { error } = await sb.functions.invoke('phone-signup', { body: { phone, password, name, lang: LANG || 'lo' } });
      if (error) {
        let code = '';
        try { code = (await error.context.json()).error; } catch { /* ignore */ }
        throw new Error(code === 'exists' ? t('errPhoneExists') : code === 'phone' ? t('errPhone')
          : code === 'password' ? t('errPassShort') : (code || error.message));
      }
    }
    const { error } = await sb.auth.signInWithPassword({ email: phoneEmail(phone), password });
    if (error) throw new Error(/invalid login/i.test(error.message) ? t('errPhoneLogin') : error.message);
    authMsg('');
  } catch (err) { authMsg(err.message, 'err'); }
  finally { btn.disabled = false; }
};

/* email fallback */
$$('#auth-mode button').forEach(b => b.onclick = () => {
  emailMode = b.dataset.mode;
  $$('#auth-mode button').forEach(x => x.classList.toggle('active', x === b));
  $('#auth-pass').autocomplete = emailMode === 'login' ? 'current-password' : 'new-password';
  applyI18n(); authMsg('');
});
$('#email-form').onsubmit = async e => {
  e.preventDefault();
  const email = $('#auth-email').value.trim(), password = $('#auth-pass').value;
  const btn = $('#email-submit'); btn.disabled = true; authMsg(t('working'));
  try {
    if (emailMode === 'login') {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
    } else {
      const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } });
      if (error) throw error;
      if (!data.session) authMsg(t('signupOk'), 'ok');
    }
  } catch (err) {
    const m = err.message || '';
    authMsg(/invalid login/i.test(m) ? t('errLogin') : /not confirmed/i.test(m) ? t('errConfirm')
      : /already registered/i.test(m) ? t('errExists') : m, 'err');
  } finally { btn.disabled = false; }
};

sb.auth.onAuthStateChange((_ev, session) => {
  const u = session?.user || null;
  if (u?.id === S.user?.id) { if (u) S.user = u; return; }
  S.user = u;
  // defer: awaiting Supabase calls inside this callback can deadlock
  setTimeout(() => u ? startApp() : showAuth(), 0);
});

/* ---------- profile ---------- */
function initials(name) { return (name || '?').trim().charAt(0).toUpperCase() || '?'; }
function paintAvatar(el, url, name) {
  el.innerHTML = url ? `<img src="${esc(url)}" alt="">` : `<b>${esc(initials(name))}</b>`;
}
function contactOf(u) {
  if (u?.user_metadata?.phone) return u.user_metadata.phone;
  if (u?.phone) return '+' + u.phone.replace(/^\+/, '');
  return u?.email || '';
}
function renderProfileBits() {
  const p = S.profile || {};
  paintAvatar($('#top-avatar'), p.avatar_url, p.display_name);
  paintAvatar($('#s-avatar'), p.avatar_url, p.display_name);
  $('#s-name').textContent = p.display_name || '';
  $('#s-contact').textContent = contactOf(S.user);
  $('#hello').innerHTML = p.display_name ? `${LANG === 'en' ? 'Hi' : 'ສະບາຍດີ'}, <b>${esc(p.display_name)}</b> 👋` : '';
}
async function loadProfile() {
  let { data, error } = await sb.from('profiles').select('*').eq('id', S.user.id).maybeSingle();
  if (error) { fail(error); return null; }
  if (!data) {
    const ins = await sb.from('profiles').insert({ id: S.user.id, lang: LANG || 'lo' }).select().single();
    if (ins.error) { fail(ins.error); return null; }
    data = ins.data;
  }
  return data;
}
let pfMandatory = false, pfFile = null, pfResolve = null;
function openProfile(mandatory) {
  pfMandatory = mandatory; pfFile = null;
  const p = S.profile || {};
  $('#profile-title').textContent = mandatory ? t('profileSetupTitle') : t('editProfile');
  $('#profile-sub').classList.toggle('hidden', !mandatory);
  $('#profile-close').classList.toggle('hidden', mandatory);
  $('#pf-name').value = p.display_name || '';
  paintAvatar($('#pf-avatar'), p.avatar_url, p.display_name || '+');
  $('#pf-photo-label').textContent = p.avatar_url ? t('changePhoto') : t('addPhoto');
  $('#profile-sheet').classList.remove('hidden');
  return new Promise(res => { pfResolve = res; });
}
$('#pf-file').onchange = e => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  if (f.size > 15 * 1024 * 1024) return toast(t('photoTooBig'));
  pfFile = f;
  $('#pf-avatar').innerHTML = `<img src="${URL.createObjectURL(f)}" alt="">`;
  $('#pf-photo-label').textContent = t('changePhoto');
};
async function squareJpeg(file, size = 320) {
  const img = await new Promise((res, rej) => {
    const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file);
  });
  const s = Math.min(img.naturalWidth, img.naturalHeight);
  const c = document.createElement('canvas'); c.width = c.height = size;
  c.getContext('2d').drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, size, size);
  return new Promise(res => c.toBlob(res, 'image/jpeg', 0.85));
}
$('#pf-name').addEventListener('input', () => { if (!pfFile && !S.profile?.avatar_url) paintAvatar($('#pf-avatar'), null, $('#pf-name').value || '+'); });
$('#profile-form').onsubmit = async e => {
  e.preventDefault();
  const name = $('#pf-name').value.trim();
  if (!name) return toast(t('nameRequired'));
  const btn = $('#pf-save'); btn.disabled = true;
  try {
    const upd = { display_name: name, lang: LANG || 'lo', updated_at: new Date().toISOString() };
    if (pfFile) {
      toast(t('uploading'));
      const blob = await squareJpeg(pfFile);
      const path = `${S.user.id}/avatar.jpg`;
      const { error: upErr } = await sb.storage.from('avatars').upload(path, blob, { upsert: true, contentType: 'image/jpeg' });
      if (upErr) throw upErr;
      upd.avatar_url = sb.storage.from('avatars').getPublicUrl(path).data.publicUrl + '?v=' + Date.now();
    }
    const { data, error } = await sb.from('profiles').update(upd).eq('id', S.user.id).select().single();
    if (error) throw error;
    S.profile = data; pfFile = null;
    renderProfileBits();
    $('#profile-sheet').classList.add('hidden');
    toast(t('saved'));
    if (pfResolve) { pfResolve(); pfResolve = null; }
  } catch (err) { fail(err); }
  finally { btn.disabled = false; }
};

/* ---------- start ---------- */
async function startApp() {
  if (!LANG) LANG = 'lo';
  $('#lang-view').classList.add('hidden'); $('#auth-view').classList.add('hidden');
  S.profile = await loadProfile();
  if (!store.get('lang') && S.profile?.lang) { LANG = S.profile.lang; store.set('lang', LANG); }
  applyI18n();
  if (!S.profile?.display_name) await openProfile(true);
  $('#app').classList.remove('hidden');
  renderProfileBits();
  await loadCats();
  go(S.page);
}

/* ---------- categories ---------- */
const catName = c => (c?.key && L().cat[c.key]) || c?.name || t('noCat');
async function loadCats() {
  const { data, error } = await sb.from('categories').select('*').order('type').order('sort').order('created_at');
  if (error) return fail(error);
  S.cats = data; S.catMap = Object.fromEntries(data.map(c => [c.id, c]));
  const sel = $('#tx-cat'), cur = sel.value;
  sel.innerHTML = `<option value="">${esc(t('allCats'))}</option>` + data.map(c => `<option value="${c.id}">${esc(c.icon)} ${esc(catName(c))}</option>`).join('');
  sel.value = cur;
}
const catOf = id => S.catMap[id] || { name: t('noCat'), icon: '❔' };

/* ---------- navigation ---------- */
const TITLE_KEYS = { home: 'home', tx: 'txTitle', plan: 'planTitle', dash: 'dash' };
function go(page) {
  S.page = page;
  $$('.page').forEach(p => p.classList.toggle('hidden', p.id !== 'page-' + page));
  $$('.tabbar [data-page]').forEach(b => b.classList.toggle('active', b.dataset.page === page));
  $('#page-title').textContent = t(TITLE_KEYS[page]);
  window.scrollTo(0, 0);
  ({ home: renderHome, tx: renderTx, plan: renderPlan, dash: renderDash })[page]();
}
document.addEventListener('click', e => {
  const g = e.target.closest('[data-goto],[data-page]');
  if (g) return go(g.dataset.goto || g.dataset.page);
  const a = e.target.closest('[data-add]');
  if (a) return openTx(null, a.dataset.add);
  const c = e.target.closest('[data-close]');
  if (c) return c.closest('.sheet-bg').classList.add('hidden');
  if (e.target.classList.contains('sheet-bg')) {
    if (e.target.id === 'profile-sheet' && pfMandatory) return;
    e.target.classList.add('hidden');
  }
  const tx = e.target.closest('[data-tx]');
  if (tx) return openTxById(tx.dataset.tx);
});
const refresh = () => go(S.page);

/* ---------- tx rendering ---------- */
function txRow(x) {
  const c = catOf(x.category_id);
  return `<div class="tx-item" data-tx="${x.id}">
    <div class="tx-ico ${x.type}">${esc(c.icon)}</div>
    <div class="tx-main"><div class="t">${esc(catName(c))}</div><div class="s">${esc(x.note || dayLabel(x.tx_date))}</div></div>
    <div class="tx-amt ${x.type}">${x.type === 'income' ? '+' : '−'}${fmt(x.amount)}</div></div>`;
}
const txCache = new Map();

/* ---------- HOME ---------- */
async function renderHome() {
  const [a, b] = monthRange(0);
  const [bal, mon, recent, cs, buds] = await Promise.all([
    sb.rpc('get_balance'),
    sb.rpc('get_monthly_summary', { p_from: ymd(a), p_to: ymd(b) }),
    sb.from('transactions').select('*').order('tx_date', { ascending: false }).order('created_at', { ascending: false }).limit(6),
    sb.rpc('get_category_summary', { p_from: ymd(a), p_to: ymd(b) }),
    sb.from('budgets').select('*').eq('period', 'month')
  ]);
  const err = [bal, mon, recent, cs, buds].find(r => r.error); if (err) return fail(err.error);
  const B = bal.data[0] || { income: 0, expense: 0 };
  $('#bal-total').textContent = fmtK(B.income - B.expense);
  const M = mon.data[0] || { income: 0, expense: 0 };
  $('#bal-month-in').textContent = fmt(M.income);
  $('#bal-month-out').textContent = fmt(M.expense);

  recent.data.forEach(x => txCache.set(x.id, x));
  $('#home-recent').innerHTML = recent.data.length ? recent.data.map(txRow).join('')
    : `<div class="empty">${t('noTxYet')}</div>`;

  const spent = Object.fromEntries(cs.data.filter(r => r.type === 'expense').map(r => [r.category_id, r.total]));
  const list = buds.data.filter(x => S.catMap[x.category_id])
    .map(x => ({ ...x, spent: spent[x.category_id] || 0 }))
    .sort((p, q) => q.spent / (q.amount || 1) - p.spent / (p.amount || 1)).slice(0, 3);
  $('#home-budget').innerHTML = list.length ? list.map(budRow).join('')
    : `<div class="empty" style="padding:12px">${esc(t('noBudgetYet'))} <a data-goto="plan">${esc(t('setBudgetNow'))}</a></div>`;
}

/* ---------- TRANSACTIONS ---------- */
$('#tx-prev').onclick = () => { S.txOffset--; renderTx(); };
$('#tx-next').onclick = () => { S.txOffset++; renderTx(); };
['#tx-type', '#tx-cat'].forEach(s => $(s).onchange = () => renderTx());
$('#tx-search').oninput = () => { clearTimeout(renderTx._t); renderTx._t = setTimeout(renderTx, 250); };

async function renderTx() {
  const [a, b] = monthRange(S.txOffset);
  $('#tx-month-label').textContent = monthLabel(a);
  let q = sb.from('transactions').select('*').gte('tx_date', ymd(a)).lte('tx_date', ymd(b))
    .order('tx_date', { ascending: false }).order('created_at', { ascending: false }).range(0, 4999);
  const type = $('#tx-type').value, cat = $('#tx-cat').value, s = $('#tx-search').value.trim();
  if (type) q = q.eq('type', type);
  if (cat) q = q.eq('category_id', cat);
  if (s) q = q.ilike('note', `%${s.replace(/[%_]/g, '')}%`);
  const { data, error } = await q; if (error) return fail(error);
  let inn = 0, out = 0; const days = {};
  data.forEach(x => {
    txCache.set(x.id, x);
    x.type === 'income' ? inn += x.amount : out += x.amount;
    (days[x.tx_date] ||= []).push(x);
  });
  $('#tx-sum-in').textContent = fmt(inn);
  $('#tx-sum-out').textContent = fmt(out);
  const net = $('#tx-sum-net'); net.textContent = fmt(inn - out);
  net.className = inn - out >= 0 ? 'c-in' : 'c-out';
  $('#tx-list').innerHTML = data.length ? Object.entries(days).map(([d, items]) => {
    const dn = items.reduce((sum, x) => sum + (x.type === 'income' ? x.amount : -x.amount), 0);
    return `<div class="day"><div class="day-head"><span>${dayLabel(d)}</span><span>${dn >= 0 ? '+' : '−'}${fmt(Math.abs(dn))}</span></div>${items.map(txRow).join('')}</div>`;
  }).join('') : `<div class="empty">${esc(t('noTxMonth'))}</div>`;
}

/* ---------- ADD / EDIT ---------- */
let fType = 'expense', fCat = null;
bindAmount($('#f-amount'));
$$('#f-type button').forEach(b => b.onclick = () => setFType(b.dataset.t));
function setFType(ty) {
  fType = ty;
  $$('#f-type button').forEach(x => x.classList.toggle('active', x.dataset.t === ty));
  if (fCat && S.catMap[fCat]?.type !== ty) fCat = null;
  const cats = S.cats.filter(c => c.type === ty);
  if (!fCat && cats.length) fCat = cats[0].id;
  $('#f-cats').innerHTML = cats.map(c => `<button type="button" class="chip ${c.id === fCat ? 'active' : ''}" data-cat="${c.id}">${esc(c.icon)} ${esc(catName(c))}</button>`).join('');
}
$('#f-cats').onclick = e => {
  const c = e.target.closest('[data-cat]'); if (!c) return;
  fCat = c.dataset.cat;
  $$('#f-cats .chip').forEach(x => x.classList.toggle('active', x === c));
};
function openTx(tx, type = 'expense') {
  S.editing = tx;
  $('#tx-sheet-title').textContent = tx ? t('editTx') : t('addTx');
  fCat = tx?.category_id || null;
  setFType(tx?.type || type);
  $('#f-amount').value = tx ? fmt(tx.amount) : '';
  $('#f-date').value = tx?.tx_date || ymd(new Date());
  $('#f-note').value = tx?.note || '';
  $('#f-delete').classList.toggle('hidden', !tx);
  $('#tx-sheet').classList.remove('hidden');
  if (!tx) setTimeout(() => $('#f-amount').focus(), 250);
}
function openTxById(id) { const x = txCache.get(id); if (x) openTx(x); }

$('#tx-form').onsubmit = async e => {
  e.preventDefault();
  const amount = parseAmt($('#f-amount').value);
  if (!amount) return toast(t('enterAmount'));
  if (!fCat) return toast(t('pickCat'));
  const row = { type: fType, amount, category_id: fCat, tx_date: $('#f-date').value, note: $('#f-note').value.trim() || null };
  const btn = $('#f-save'); btn.disabled = true;
  const { error } = S.editing
    ? await sb.from('transactions').update(row).eq('id', S.editing.id)
    : await sb.from('transactions').insert(row);
  btn.disabled = false;
  if (error) return fail(error);
  $('#tx-sheet').classList.add('hidden');
  toast(S.editing ? t('edited') : t('saved'));
  refresh();
};
$('#f-delete').onclick = async () => {
  if (!S.editing || !confirm(t('confirmDeleteTx'))) return;
  const { error } = await sb.from('transactions').delete().eq('id', S.editing.id);
  if (error) return fail(error);
  txCache.delete(S.editing.id);
  $('#tx-sheet').classList.add('hidden'); toast(t('deleted')); refresh();
};

/* ---------- PLAN ---------- */
$$('#plan-period button').forEach(b => b.onclick = () => {
  S.planPeriod = b.dataset.p; S.planOffset = 0;
  $$('#plan-period button').forEach(x => x.classList.toggle('active', x === b));
  renderPlan();
});
$('#plan-prev').onclick = () => { S.planOffset--; renderPlan(); };
$('#plan-next').onclick = () => { S.planOffset++; renderPlan(); };

function budRow(x) {
  const c = catOf(x.category_id), pct = x.amount ? x.spent / x.amount * 100 : 0;
  const cls = pct > 100 ? 'over' : pct >= 80 ? 'warn' : '';
  const left = x.amount - x.spent;
  return `<div class="bud" data-bud="${x.category_id}">
    <div class="bud-top"><span class="tx-ico expense">${esc(c.icon)}</span><span class="name">${esc(catName(c))}</span>
      <span class="nums"><b>${fmt(x.spent)}</b> / ${fmt(x.amount)}</span></div>
    <div class="bar"><i class="${cls}" style="width:${Math.min(pct, 100)}%"></i></div>
    <div class="bud-foot"><span>${Math.round(pct)}%</span><span class="${left < 0 ? 'c-out' : ''}">${left < 0 ? t('overBy') + ' ' + fmt(-left) : t('left') + ' ' + fmt(left)}</span></div></div>`;
}

async function renderPlan() {
  const isM = S.planPeriod === 'month';
  const [a, b] = isM ? monthRange(S.planOffset) : weekRange(S.planOffset);
  const ms = L().monthsS;
  $('#plan-label').textContent = isM ? monthLabel(a) : `${a.getDate()} ${ms[a.getMonth()]} – ${b.getDate()} ${ms[b.getMonth()]} ${b.getFullYear()}`;
  const [cs, buds] = await Promise.all([
    sb.rpc('get_category_summary', { p_from: ymd(a), p_to: ymd(b) }),
    sb.from('budgets').select('*').eq('period', S.planPeriod)
  ]);
  if (cs.error) return fail(cs.error); if (buds.error) return fail(buds.error);
  S.budgets = buds.data;
  const spent = {}; let income = 0, spentAll = 0;
  cs.data.forEach(r => {
    if (r.type === 'expense') { spent[r.category_id] = r.total; spentAll += r.total; }
    else income += r.total;
  });
  const bmap = Object.fromEntries(buds.data.map(x => [x.category_id, x.amount]));
  const exp = S.cats.filter(c => c.type === 'expense');
  const withB = exp.filter(c => bmap[c.id]).map(c => ({ category_id: c.id, amount: bmap[c.id], spent: spent[c.id] || 0 }));
  const noB = exp.filter(c => !bmap[c.id]);
  const total = withB.reduce((s, x) => s + x.amount, 0);
  const used = withB.reduce((s, x) => s + x.spent, 0);
  $('#plan-total').textContent = fmt(total);
  $('#plan-spent').textContent = fmt(used);
  const leftEl = $('#plan-left'); leftEl.textContent = fmt(total - used); leftEl.className = total - used < 0 ? 'c-out' : 'c-in';
  const save = income - total;
  const p = isM ? t('periodMonth') : t('periodWeek');
  $('#plan-income').innerHTML = `${esc(t('incomeIn', { p }))} <b>${fmt(income)}</b> · ${esc(t('totalExpense'))} <b>${fmt(spentAll)}</b>` +
    (total ? `<br>${esc(t('ifOnBudget'))} <b class="${save < 0 ? 'c-out' : ''}">${fmt(save)}</b>` : '');
  $('#plan-list').innerHTML = withB.map(budRow).join('') +
    (noB.length ? `<h4>${esc(t('noBudget'))}</h4>` + noB.map(c => `<div class="bud nobud" data-bud="${c.id}">
      <div class="bud-top"><span class="tx-ico expense">${esc(c.icon)}</span><span class="name">${esc(catName(c))}</span>
      <span class="nums">${esc(t('spent'))} <b>${fmt(spent[c.id] || 0)}</b></span></div></div>`).join('') : '');
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-bud]'); if (!b) return;
  if (S.page !== 'plan') return go('plan');
  const c = catOf(b.dataset.bud); S.budgetCat = b.dataset.bud;
  const cur = S.budgets.find(x => x.category_id === S.budgetCat);
  const p = S.planPeriod === 'month' ? t('periodMonth') : t('periodWeek');
  $('#b-title').textContent = `${c.icon} ${catName(c)}`;
  $('#b-sub').textContent = t('budgetPer', { p });
  $('#b-amount').value = cur ? fmt(cur.amount) : '';
  $('#budget-sheet').classList.remove('hidden');
  setTimeout(() => $('#b-amount').focus(), 250);
});
bindAmount($('#b-amount'));
$('#budget-form').onsubmit = async e => {
  e.preventDefault();
  const amount = parseAmt($('#b-amount').value);
  const { error } = amount
    ? await sb.from('budgets').upsert({ user_id: S.user.id, category_id: S.budgetCat, period: S.planPeriod, amount }, { onConflict: 'user_id,category_id,period' })
    : await sb.from('budgets').delete().eq('category_id', S.budgetCat).eq('period', S.planPeriod);
  if (error) return fail(error);
  $('#budget-sheet').classList.add('hidden'); toast(t('budgetSaved')); renderPlan();
};

/* ---------- DASHBOARD ---------- */
$$('#dash-range button').forEach(b => b.onclick = () => {
  S.dashRange = +b.dataset.r;
  $$('#dash-range button').forEach(x => x.classList.toggle('active', x === b));
  renderDash();
});
$('#dash-cat-month').onchange = () => renderCatChart();
const PALETTE = ['#0f766e', '#f59e0b', '#3b82f6', '#ef4444', '#8b5cf6', '#10b981', '#ec4899', '#64748b', '#84cc16', '#06b6d4', '#f97316', '#a855f7'];

async function renderDash() {
  const n = S.dashRange;
  const [a] = monthRange(-(n - 1)); const [, b] = monthRange(0);
  const { data, error } = await sb.rpc('get_monthly_summary', { p_from: ymd(a), p_to: ymd(b) });
  if (error) return fail(error);
  const map = Object.fromEntries(data.map(r => [r.month.slice(0, 7), r]));
  const months = [...Array(n)].map((_, i) => { const [m] = monthRange(i - n + 1); return m; });
  const rows = months.map(m => map[ymd(m).slice(0, 7)] || { income: 0, expense: 0 });
  const tin = rows.reduce((s, r) => s + r.income, 0), tout = rows.reduce((s, r) => s + r.expense, 0);
  $('#k-in').textContent = fmt(tin); $('#k-out').textContent = fmt(tout);
  const net = $('#k-net'); net.textContent = fmt(tin - tout); net.className = tin - tout < 0 ? 'c-out' : 'c-in';
  $('#k-rate').textContent = tin ? Math.round((tin - tout) / tin * 100) + '%' : '–';

  if (!window.Chart) return;
  S.charts.m?.destroy();
  S.charts.m = new Chart($('#ch-monthly'), {
    type: 'bar',
    data: {
      labels: months.map(m => L().monthsS[m.getMonth()]),
      datasets: [
        { label: t('income'), data: rows.map(r => r.income), backgroundColor: '#16a34a', borderRadius: 4 },
        { label: t('expense'), data: rows.map(r => r.expense), backgroundColor: '#dc2626', borderRadius: 4 }
      ]
    },
    options: {
      maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { family: 'Noto Sans Lao' } } },
        tooltip: { callbacks: { label: c => `${c.dataset.label}: ${fmt(c.raw)}` } } },
      scales: { y: { ticks: { callback: v => v >= 1e6 ? (v / 1e6) + 'M' : v >= 1e3 ? (v / 1e3) + 'K' : v } }, x: { grid: { display: false } } }
    }
  });

  const sel = $('#dash-cat-month'), cur = sel.value;
  sel.innerHTML = months.slice().reverse().map(m => `<option value="${ymd(m)}">${L().monthsS[m.getMonth()]} ${m.getFullYear()}</option>`).join('');
  if (cur && [...sel.options].some(o => o.value === cur)) sel.value = cur;
  renderCatChart();
}
async function renderCatChart() {
  const a = parseYmd($('#dash-cat-month').value), b = new Date(a.getFullYear(), a.getMonth() + 1, 0);
  const { data, error } = await sb.rpc('get_category_summary', { p_from: ymd(a), p_to: ymd(b) });
  if (error) return fail(error);
  const rows = data.filter(r => r.type === 'expense').sort((p, q) => q.total - p.total);
  const total = rows.reduce((s, r) => s + r.total, 0);
  S.charts.c?.destroy();
  if (!rows.length) { $('#dash-cat-table').innerHTML = `<div class="empty">${esc(t('noExpenseMonth'))}</div>`; return; }
  S.charts.c = new Chart($('#ch-cat'), {
    type: 'doughnut',
    data: { labels: rows.map(r => catName(catOf(r.category_id))), datasets: [{ data: rows.map(r => r.total), backgroundColor: rows.map((_, i) => PALETTE[i % PALETTE.length]), borderWidth: 2 }] },
    options: { maintainAspectRatio: false, cutout: '62%', plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `${c.label}: ${fmt(c.raw)}` } } } }
  });
  $('#dash-cat-table').innerHTML = rows.map((r, i) => { const c = catOf(r.category_id); return `<div class="cat-row">
    <span class="sw" style="background:${PALETTE[i % PALETTE.length]}"></span><span class="n">${esc(c.icon)} ${esc(catName(c))}</span>
    <b>${fmt(r.total)}</b><span class="p">${Math.round(r.total / total * 100)}%</span></div>`; }).join('');
}

/* ---------- SETTINGS ---------- */
let sType = 'expense';
$('#btn-settings').onclick = () => { renderProfileBits(); renderCatSettings(); $('#settings-sheet').classList.remove('hidden'); };
$('#s-edit').onclick = () => { $('#settings-sheet').classList.add('hidden'); openProfile(false); };
$$('#s-cat-type button').forEach(b => b.onclick = () => {
  sType = b.dataset.t; $$('#s-cat-type button').forEach(x => x.classList.toggle('active', x === b)); renderCatSettings();
});
function renderCatSettings() {
  $('#s-cat-list').innerHTML = S.cats.filter(c => c.type === sType).map(c => `<div class="cat-row">
    <span>${esc(c.icon)}</span><span class="n">${esc(catName(c))}</span><button class="del" data-delcat="${c.id}">${esc(t('delete'))}</button></div>`).join('');
}
$('#s-cat-list').onclick = async e => {
  const d = e.target.closest('[data-delcat]'); if (!d) return;
  const c = S.catMap[d.dataset.delcat];
  if (!confirm(t('confirmDeleteCat', { n: catName(c) }))) return;
  const { error } = await sb.from('categories').delete().eq('id', c.id);
  if (error) return fail(error);
  await loadCats(); renderCatSettings();
};
$('#s-cat-form').onsubmit = async e => {
  e.preventDefault();
  const name = $('#s-cat-name').value.trim(); if (!name) return;
  const sort = Math.max(0, ...S.cats.filter(c => c.type === sType).map(c => c.sort)) + 1;
  const { error } = await sb.from('categories').insert({ name, type: sType, icon: $('#s-cat-icon').value.trim() || (sType === 'income' ? '💵' : '📦'), sort });
  if (error) return fail(error);
  $('#s-cat-name').value = ''; $('#s-cat-icon').value = '';
  await loadCats(); renderCatSettings(); toast(t('catAdded'));
};
$('#s-logout').onclick = async () => {
  await sb.auth.signOut();
  $('#settings-sheet').classList.add('hidden');
  S.profile = null; showAuthStep('phone'); authMethod = 'phone';
};
$('#s-export').onclick = async () => {
  const all = []; let from = 0;
  for (;;) {
    const { data, error } = await sb.from('transactions').select('*').order('tx_date').range(from, from + 999);
    if (error) return fail(error);
    all.push(...data); if (data.length < 1000) break; from += 1000;
  }
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = '﻿' + [t('csvHead'),
    ...all.map(x => [x.tx_date, t(x.type), catName(catOf(x.category_id)), x.amount, x.note].map(q).join(','))].join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `money-${ymd(new Date())}.csv`; a.click();
};

/* ---------- boot ---------- */
applyI18n();
showAuthStep('phone');
const { data: { session } } = await sb.auth.getSession();
if (!session) showAuth();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
