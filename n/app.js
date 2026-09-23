// app.js – Bar Organizer Deluxe (client)
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
    getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, sendPasswordResetEmail,
    sendEmailVerification, setPersistence, browserLocalPersistence, browserSessionPersistence,
    EmailAuthProvider, reauthenticateWithCredential, updatePassword,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

// ============================================================================
// Config
// ============================================================================
const WORKER_URL = 'https://gremlin.bobbywaterson1930.workers.dev';
const firebaseConfig = {
    apiKey: 'AIzaSyAVEM6X3OEUuCDBrpShe02Rnq8p13oEf4s',
    authDomain: 'bar-organizer-f3784.firebaseapp.com',
    databaseURL: 'https://bar-organizer-f3784-default-rtdb.europe-west1.firebasedatabase.app',
    projectId: 'bar-organizer-f3784',
    storageBucket: 'bar-organizer-f3784.appspot.com',
    messagingSenderId: '908059088110',
    appId: '1:908059088110:web:03b861013c137ef1e2cfff',
    measurementId: 'G-M99V8FNP35',
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
auth.languageCode = 'de';

// ============================================================================
// State
// ============================================================================
let allCategories = {};
let allDrinks = {};
let allIngredients = {};
let appSettings = {};
let currentRev = null;
let me = null;                 // { uid, email, emailVerified, displayName, role, permissions, favorites }
let serverSettings = {};
let mode = 'view';             // 'view' | 'edit' | 'staff'
let selectedCategoryId = null;
let initialLoadComplete = false;
let currentFilterType = 'Alles';
let currentSearchQuery = '';
let favOnly = false;
let lastSelectedSourceCategoryId = null;
let sortableInstance = null;
let ingredientSortable = null;
let currentRecipePopupDrinkId = null;
let prefs = loadPrefs();

function loadPrefs() {
    const d = { view: 'grid', sort: 'name', showImages: true, clampRecipe: true, searchAll: false, lastCategory: null };
    try { return { ...d, ...JSON.parse(localStorage.getItem('barPrefs') || '{}') }; } catch { return d; }
}
function savePrefs() { try { localStorage.setItem('barPrefs', JSON.stringify(prefs)); } catch { /* ignore */ } }

// ============================================================================
// Small helpers
// ============================================================================
const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = (u) => { try { const x = new URL(u); return (x.protocol === 'https:' || x.protocol === 'http:') ? x.toString() : ''; } catch { return ''; } };
const safeColor = (c) => (/^#[0-9a-f]{6}$/i.test(c || '') ? c : '#64748b');
const initials = (name) => (name || '?').trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase() || '?';
const byOrder = ([, a], [, b]) => (a.order || 0) - (b.order || 0);
const sortedCategoryEntries = () => Object.entries(allCategories).sort(byOrder);
const fmtDate = (ts) => (ts ? new Date(ts).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const relTime = (ts) => {
    if (!ts) return 'nie';
    const s = Math.round((Date.now() - ts) / 1000);
    if (s < 60) return 'gerade eben';
    if (s < 3600) return `vor ${Math.round(s / 60)} Min.`;
    if (s < 86400) return `vor ${Math.round(s / 3600)} Std.`;
    if (s < 86400 * 30) return `vor ${Math.round(s / 86400)} Tagen`;
    return new Date(ts).toLocaleDateString('de-DE');
};
const perm = (k) => !!me?.permissions?.[k];
const isEdit = () => mode === 'edit';
const isStaff = () => mode === 'staff';

class ApiError extends Error { constructor(code, message, status) { super(message); this.code = code; this.status = status; } }

// ============================================================================
// Toasts, alerts, confirms, modals
// ============================================================================
function toast(message, type = 'info', { action, duration = 3800 } = {}) {
    const colors = {
        success: 'bg-emerald-600 text-white', error: 'bg-rose-600 text-white', info: 'bg-plum-900 text-white dark:bg-white dark:text-plum-900',
    };
    const icon = { success: 'fa-circle-check', error: 'fa-circle-exclamation', info: 'fa-circle-info' }[type];
    const el = document.createElement('div');
    el.className = `toast-enter pointer-events-auto flex max-w-md items-center gap-3 rounded-xl px-4 py-3 text-sm shadow-xl ${colors[type] || colors.info}`;
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    el.innerHTML = `<i class="fas ${icon}"></i><span class="flex-1"></span>`;
    el.querySelector('span').textContent = message;
    if (action) {
        const b = document.createElement('button');
        b.className = 'rounded-md px-2 py-1 font-semibold underline-offset-2 hover:underline';
        b.textContent = action.label;
        b.addEventListener('click', () => { el.remove(); action.onClick(); });
        el.appendChild(b);
    }
    $('toastContainer').appendChild(el);
    setTimeout(() => el.remove(), action ? Math.max(duration, 6500) : duration);
}

const modalStack = [];
function openModal(el) {
    if (!el) return;
    el.classList.remove('hidden');
    el.classList.add('flex');
    if (!modalStack.includes(el)) modalStack.push(el);
    setTimeout(() => {
        const f = el.querySelector('[autofocus], input:not([type=hidden]):not([readonly]):not([type=checkbox]), select, textarea');
        if (f && window.innerWidth >= 640) f.focus({ preventScroll: true });
    }, 30);
}
function closeModal(el, force = false) {
    if (!el || el.classList.contains('hidden')) return;
    if (!force && el.dataset.guardDirty && isFormDirty(el.dataset.guardDirty)) {
        showConfirm('Ungespeicherte Änderungen verwerfen?', { confirmLabel: 'Verwerfen' }).then((ok) => { if (ok) closeModal(el, true); });
        return;
    }
    el.classList.add('hidden');
    el.classList.remove('flex');
    const i = modalStack.indexOf(el);
    if (i >= 0) modalStack.splice(i, 1);
    if (el.id === 'recipePopupModal') currentRecipePopupDrinkId = null;
}
document.querySelectorAll('.modal').forEach((m) => {
    m.addEventListener('mousedown', (e) => { m._downOnBackdrop = e.target === m; });
    m.addEventListener('click', (e) => { if (e.target === m && m._downOnBackdrop && m.id !== 'confirmModal' && m.id !== 'customAlertModal') closeModal(m); });
    m.querySelectorAll('.modal-close').forEach((b) => b.addEventListener('click', () => closeModal(m)));
});

let formSnapshots = {};
function snapshotForm(id) { formSnapshots[id] = serializeForm(id); }
function serializeForm(id) {
    const f = $(id); if (!f) return '';
    return JSON.stringify([...f.querySelectorAll('input, select, textarea')].map((x) => (x.type === 'checkbox' ? x.checked : (x.dataset.selectedItem ?? x.value))));
}
function isFormDirty(id) { return formSnapshots[id] !== undefined && formSnapshots[id] !== serializeForm(id); }

function showCustomAlert(message) {
    $('customAlertText').textContent = message;
    openModal($('customAlertModal'));
}
$('customAlertCloseBtn').addEventListener('click', () => closeModal($('customAlertModal')));

let confirmResolver = null;
function showConfirm(text, { title = 'Bist du sicher?', confirmLabel = 'Bestätigen', danger = true, typeToConfirm = null } = {}) {
    if (confirmResolver) confirmResolver(false);
    $('confirmTitle').textContent = title;
    $('confirmModalText').textContent = text;
    const yes = $('confirmYes');
    yes.textContent = confirmLabel;
    yes.className = `btn ${danger ? 'btn-danger' : 'btn-primary'}`;
    const wrap = $('confirmTypeWrap');
    const input = $('confirmTypeInput');
    input.value = '';
    if (typeToConfirm) {
        wrap.classList.remove('hidden');
        wrap.querySelector('label').textContent = `Tippe „${typeToConfirm}" zur Bestätigung:`;
        yes.disabled = true;
        input.oninput = () => { yes.disabled = input.value.trim() !== typeToConfirm; };
    } else { wrap.classList.add('hidden'); yes.disabled = false; input.oninput = null; }
    openModal($('confirmModal'));
    if (!typeToConfirm) setTimeout(() => yes.focus(), 40);
    return new Promise((resolve) => { confirmResolver = resolve; });
}
function resolveConfirm(v) { const r = confirmResolver; confirmResolver = null; closeModal($('confirmModal'), true); if (r) r(v); }
$('confirmYes').addEventListener('click', () => resolveConfirm(true));
$('confirmNo').addEventListener('click', () => resolveConfirm(false));

// Legacy style helper kept for existing flows
function showConfirmModal(text, callback, opts) { showConfirm(text, opts).then((ok) => { if (ok) callback(); }); }

async function withBusy(btn, fn) {
    if (!btn) return fn();
    const prev = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i>';
    try { return await fn(); } finally { btn.disabled = false; btn.innerHTML = prev; }
}

// ============================================================================
// API
// ============================================================================
async function api(path, { method = 'GET', body, authed = true, retry = true } = {}) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (authed) {
        if (!auth.currentUser) throw new ApiError('no_token', 'Nicht angemeldet.', 401);
        headers.Authorization = `Bearer ${await auth.currentUser.getIdToken()}`;
    }
    let res;
    try {
        res = await fetch(WORKER_URL + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, cache: 'no-store' });
    } catch {
        throw new ApiError('network', navigator.onLine ? 'Server nicht erreichbar. Bitte später erneut versuchen.' : 'Keine Internetverbindung.', 0);
    }
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && authed && retry && auth.currentUser) {
        await auth.currentUser.getIdToken(true).catch(() => {});
        return api(path, { method, body, authed, retry: false });
    }
    if (!res.ok) {
        const err = new ApiError(data.error || `http_${res.status}`, data.message || `Fehler (${res.status}).`, res.status);
        if (['account_disabled', 'not_registered', 'email_unverified'].includes(err.code)) handleBlocked(err);
        throw err;
    }
    return data;
}

/** Runs a data action on the worker, then refreshes the state. Returns the result or null on error. */
async function act(action, payload = {}, { modeOverride, silent = false } = {}) {
    try {
        const res = await api('/api/action', { method: 'POST', body: { action, mode: modeOverride || mode, ...payload } });
        refreshState();
        return res;
    } catch (e) {
        if (!silent) toast(e.message, 'error');
        return null;
    }
}

// ============================================================================
// Auth screens
// ============================================================================
function showScreen(which) {
    $('bootScreen').classList.toggle('hidden', which !== 'boot');
    $('authScreen').classList.toggle('hidden', which !== 'auth');
    $('appShell').classList.toggle('hidden', which !== 'app');
}
function showAuthView(view) {
    ['loginForm', 'registerForm', 'forgotForm', 'blockedView'].forEach((id) => $(id).classList.add('hidden'));
    const map = { login: 'loginForm', register: 'registerForm', forgot: 'forgotForm', blocked: 'blockedView' };
    $(map[view]).classList.remove('hidden');
    ['loginError', 'registerError', 'forgotMsg'].forEach((id) => $(id).classList.add('hidden'));
    if (view === 'forgot' && $('loginEmail').value) $('forgotEmail').value = $('loginEmail').value;
    const first = $(map[view]).querySelector('input');
    if (first && window.innerWidth >= 640) setTimeout(() => first.focus(), 30);
}
document.querySelectorAll('[data-auth-view]').forEach((b) => b.addEventListener('click', () => showAuthView(b.dataset.authView)));
document.querySelectorAll('.pw-toggle').forEach((b) => b.addEventListener('click', () => {
    const input = b.parentElement.querySelector('input');
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    b.innerHTML = `<i class="fas ${show ? 'fa-eye-slash' : 'fa-eye'}"></i>`;
    b.setAttribute('aria-label', show ? 'Passwort verbergen' : 'Passwort anzeigen');
}));

function showFormError(id, msg) { const el = $(id); el.textContent = msg; el.classList.remove('hidden'); }

function authErrorMessage(e) {
    const c = e?.code || '';
    if (c.includes('invalid-credential') || c.includes('wrong-password') || c.includes('user-not-found') || c.includes('invalid-login')) return 'E-Mail oder Passwort ist falsch.';
    if (c.includes('user-disabled')) return 'Dieses Konto wurde deaktiviert.';
    if (c.includes('too-many-requests')) return 'Zu viele Versuche. Bitte warte einen Moment.';
    if (c.includes('network-request-failed')) return 'Keine Verbindung. Prüfe deine Internetverbindung.';
    if (c.includes('invalid-email')) return 'Ungültige E-Mail-Adresse.';
    if (c.includes('requires-recent-login')) return 'Bitte melde dich erneut an und versuche es noch einmal.';
    if (c.includes('weak-password')) return 'Das Passwort ist zu schwach.';
    return e?.message || 'Unbekannter Fehler.';
}

async function loadPublicConfig() {
    try {
        const cfg = await api('/api/public-config', { authed: false });
        $('registerLinkWrap').classList.toggle('hidden', !cfg.registrationEnabled);
    } catch { $('registerLinkWrap').classList.remove('hidden'); }
}

$('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('loginEmail').value.trim();
    const pw = $('loginPassword').value;
    if (!email || !pw) return showFormError('loginError', 'Bitte E-Mail und Passwort eingeben.');
    const btn = e.submitter || $('loginForm').querySelector('[type=submit]');
    await withBusy(btn, async () => {
        try {
            await setPersistence(auth, $('loginRemember').checked ? browserLocalPersistence : browserSessionPersistence);
            await signInWithEmailAndPassword(auth, email, pw);
            $('loginPassword').value = '';
        } catch (err) { showFormError('loginError', authErrorMessage(err)); }
    });
});

function passwordScore(pw) {
    let s = 0;
    if (pw.length >= 8) s++;
    if (pw.length >= 12) s++;
    if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++;
    if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) s++;
    return s;
}
$('regPassword').addEventListener('input', () => {
    const s = passwordScore($('regPassword').value);
    const cls = ['bg-rose-500', 'bg-orange-400', 'bg-zest-400', 'bg-emerald-500'];
    document.querySelectorAll('.pw-bar').forEach((bar, i) => {
        bar.className = `pw-bar h-1 flex-1 rounded ${i < s ? cls[s - 1] : 'bg-gray-200 dark:bg-plum-700'}`;
    });
});

$('registerForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const displayName = $('regName').value.trim();
    const email = $('regEmail').value.trim();
    const pw = $('regPassword').value;
    if (!displayName || !email) return showFormError('registerError', 'Bitte Name und E-Mail angeben.');
    if (pw.length < 8) return showFormError('registerError', 'Das Passwort muss mindestens 8 Zeichen lang sein.');
    if (pw !== $('regPassword2').value) return showFormError('registerError', 'Die Passwörter stimmen nicht überein.');
    const btn = $('registerForm').querySelector('[type=submit]');
    await withBusy(btn, async () => {
        try {
            await api('/api/register', { method: 'POST', body: { email, password: pw, displayName }, authed: false });
            await setPersistence(auth, browserLocalPersistence);
            const cred = await signInWithEmailAndPassword(auth, email, pw);
            sendEmailVerification(cred.user).catch(() => {});
            $('registerForm').reset();
            toast('Konto erstellt. Wir haben dir einen Bestätigungslink geschickt.', 'success');
        } catch (err) {
            showFormError('registerError', err instanceof ApiError ? err.message : authErrorMessage(err));
            if (err.code === 'registration_disabled') loadPublicConfig();
        }
    });
});

$('forgotForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('forgotEmail').value.trim();
    const msg = $('forgotMsg');
    if (!email) return;
    await withBusy($('forgotForm').querySelector('[type=submit]'), async () => {
        try {
            await sendPasswordResetEmail(auth, email);
        } catch (err) {
            if (err?.code?.includes('invalid-email') || err?.code?.includes('network') || err?.code?.includes('too-many')) {
                msg.className = 'rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-900/30 dark:text-rose-300';
                msg.textContent = authErrorMessage(err);
                return;
            }
        }
        // Same message whether or not the account exists (no account enumeration)
        msg.className = 'rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300';
        msg.textContent = 'Falls ein Konto mit dieser Adresse existiert, ist der Link unterwegs. Prüfe auch den Spam-Ordner.';
    });
});

function handleBlocked(err) {
    stopStream();
    showScreen('auth');
    showAuthView('blocked');
    const titles = { account_disabled: 'Konto gesperrt', not_registered: 'Konto nicht freigeschaltet', email_unverified: 'E-Mail bestätigen' };
    $('blockedTitle').textContent = titles[err.code] || 'Kein Zugriff';
    $('blockedText').textContent = err.message;
    $('blockedResendBtn').classList.toggle('hidden', err.code !== 'email_unverified');
}
$('blockedRetryBtn').addEventListener('click', async () => {
    if (!auth.currentUser) return showAuthView('login');
    await auth.currentUser.reload().catch(() => {});
    await auth.currentUser.getIdToken(true).catch(() => {});
    bootApp();
});
$('blockedResendBtn').addEventListener('click', () => resendVerification($('blockedResendBtn')));
$('blockedLogoutBtn').addEventListener('click', () => logout());

async function resendVerification(btn) {
    if (!auth.currentUser) return;
    await withBusy(btn, async () => {
        try { await sendEmailVerification(auth.currentUser); toast('Bestätigungslink gesendet.', 'success'); }
        catch (e) { toast(authErrorMessage(e), 'error'); }
    });
}

async function logout() {
    stopStream();
    closeAllMenus();
    modalStack.slice().forEach((m) => closeModal(m, true));
    try { sessionStorage.removeItem('barMode'); } catch { /* ignore */ }
    await signOut(auth).catch(() => {});
}

onAuthStateChanged(auth, (user) => {
    if (user) {
        bootApp();
    } else {
        resetAppState();
        loadPublicConfig();
        showScreen('auth');
        showAuthView('login');
    }
});

function resetAppState() {
    allCategories = {}; allDrinks = {}; allIngredients = {}; appSettings = {};
    me = null; mode = 'view'; initialLoadComplete = false; currentRev = null; selectedCategoryId = null;
    $('drinksContainer').innerHTML = '';
    $('categoriesContainer').innerHTML = '';
}

async function bootApp() {
    showScreen('app');
    $('loadingIndicator').classList.remove('hidden');
    try {
        await refreshState({ throwOnError: true });
        startStream();
    } catch (e) {
        if (!['account_disabled', 'not_registered', 'email_unverified'].includes(e.code)) {
            $('loadingIndicator').classList.add('hidden');
            $('noCategoriesMessage').textContent = `${e.message}`;
            $('noCategoriesMessage').classList.remove('hidden');
            setTimeout(() => { if (auth.currentUser && !initialLoadComplete) bootApp(); }, 8000);
        }
    }
}

// ============================================================================
// State loading & live updates
// ============================================================================
let refreshInFlight = null;
let refreshQueued = false;

async function refreshState({ throwOnError = false } = {}) {
    if (refreshInFlight) { refreshQueued = true; return refreshInFlight; }
    refreshInFlight = (async () => {
        try {
            const s = await api('/api/state');
            applyState(s);
        } catch (e) {
            if (throwOnError) throw e;
            if (e.code !== 'network') console.warn('refresh failed', e);
        } finally {
            refreshInFlight = null;
            if (refreshQueued) { refreshQueued = false; refreshState(); }
        }
    })();
    return refreshInFlight;
}

function applyState(s) {
    const prevPerms = me?.permissions;
    me = s.me;
    serverSettings = s.settings || {};
    allCategories = s.data.categories || {};
    allDrinks = s.data.drinks || {};
    allIngredients = s.data.ingredients || {};
    appSettings = s.data.appSettings || {};
    currentRev = s.data.rev ?? null;
    me.favorites = me.favorites || {};

    // Mode handling: restore from session, drop modes the role no longer has
    if (!initialLoadComplete) {
        let saved = null;
        try { saved = sessionStorage.getItem('barMode'); } catch { /* ignore */ }
        if (saved === 'edit' && perm('editMode')) mode = 'edit';
        else if (saved === 'staff' && perm('staffMode')) mode = 'staff';
    }
    if ((mode === 'edit' && !perm('editMode')) || (mode === 'staff' && !perm('staffMode'))) {
        setMode('view', { silent: true });
        toast('Deine Berechtigungen haben sich geändert.', 'info');
    } else if (prevPerms && JSON.stringify(prevPerms) !== JSON.stringify(me.permissions)) {
        toast('Deine Berechtigungen wurden aktualisiert.', 'info');
    }

    // Folder selection
    const defaultId = appSettings.defaultCategoryId;
    if (!initialLoadComplete) {
        if (prefs.lastCategory && allCategories[prefs.lastCategory]) selectedCategoryId = prefs.lastCategory;
        else if (defaultId && allCategories[defaultId]) selectedCategoryId = defaultId;
        else selectedCategoryId = sortedCategoryEntries()[0]?.[0] || null;
        initialLoadComplete = true;
    } else if (!selectedCategoryId || !allCategories[selectedCategoryId]) {
        selectedCategoryId = (defaultId && allCategories[defaultId]) ? defaultId : (sortedCategoryEntries()[0]?.[0] || null);
    }

    $('loadingIndicator').classList.add('hidden');
    $('noCategoriesMessage').classList.toggle('hidden', Object.keys(allCategories).length > 0);
    updateUserUI();
    updateActiveModesUI();
    if (!$('ingredientEditorModal').classList.contains('hidden')) renderIngredientEditor();
    if (!$('addExistingDrinkModal').classList.contains('hidden')) { populateCategorySelectInForms(); renderSourceDrinksList(); }
    if (currentRecipePopupDrinkId) {
        if (allDrinks[currentRecipePopupDrinkId]) showRecipePopup(currentRecipePopupDrinkId, { keepServings: true });
        else closeModal($('recipePopupModal'), true);
    }
}

let streamCtrl = null;
let streamRetry = 1000;
let streamTimer = null;
let pollTimer = null;

function setLive(state) {
    const dot = $('liveDot');
    dot.classList.toggle('is-live', state === 'live');
    dot.classList.toggle('is-offline', state === 'offline');
    dot.title = state === 'live' ? 'Live verbunden – Änderungen erscheinen sofort' : state === 'offline' ? 'Offline' : 'Verbindung wird aufgebaut…';
}

function stopStream() {
    if (streamCtrl) streamCtrl.abort();
    streamCtrl = null;
    clearTimeout(streamTimer);
    clearInterval(pollTimer);
    pollTimer = null;
}

async function startStream() {
    stopStream();
    if (!auth.currentUser) return;
    const ctrl = new AbortController();
    streamCtrl = ctrl;
    // Fallback polling while the stream is not connected
    pollTimer = setInterval(() => { if (document.visibilityState === 'visible') refreshState(); }, 60000);
    try {
        const token = await auth.currentUser.getIdToken();
        const res = await fetch(`${WORKER_URL}/api/stream`, { headers: { Authorization: `Bearer ${token}` }, signal: ctrl.signal, cache: 'no-store' });
        if (!res.ok || !res.body) throw new Error(`stream ${res.status}`);
        setLive('live');
        streamRetry = 1000;
        clearInterval(pollTimer); pollTimer = null;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        let refreshTimer = null;
        for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            let idx;
            while ((idx = buf.indexOf('\n\n')) >= 0) {
                const chunk = buf.slice(0, idx);
                buf = buf.slice(idx + 2);
                let event = 'message'; let data = '';
                for (const line of chunk.split('\n')) {
                    if (line.startsWith('event:')) event = line.slice(6).trim();
                    else if (line.startsWith('data:')) data += line.slice(5).trim();
                }
                if (event === 'put' || event === 'patch') {
                    let rev = null;
                    try { rev = JSON.parse(data)?.data ?? null; } catch { /* ignore */ }
                    if (rev === null || rev !== currentRev) {
                        clearTimeout(refreshTimer);
                        refreshTimer = setTimeout(() => refreshState(), 200);
                    }
                } else if (event === 'cancel' || event === 'auth_revoked') {
                    ctrl.abort();
                }
            }
        }
    } catch (e) {
        if (ctrl.signal.aborted && streamCtrl !== ctrl) return; // replaced / stopped intentionally
    }
    if (streamCtrl !== ctrl) return;
    setLive(navigator.onLine ? 'connecting' : 'offline');
    streamTimer = setTimeout(() => { if (auth.currentUser) startStream(); }, streamRetry);
    streamRetry = Math.min(streamRetry * 2, 30000);
}

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && auth.currentUser && initialLoadComplete) {
        refreshState();
        if (!streamCtrl) startStream();
    }
});
window.addEventListener('online', () => { if (auth.currentUser) { refreshState(); startStream(); } });
window.addEventListener('offline', () => setLive('offline'));
window.addEventListener('app-updated', () => toast('Eine neue Version ist verfügbar.', 'info', { action: { label: 'Neu laden', onClick: () => location.reload() } }));

// ============================================================================
// Sidebar
// ============================================================================
const sidebar = $('sidebar');
const mainArea = $('mainArea');
const sidebarOverlay = $('sidebarOverlay');
const isMobile = () => window.innerWidth < 768;

function setSidebar(open) {
    sidebar.classList.toggle('-translate-x-full', !open);
    if (isMobile()) { sidebarOverlay.classList.toggle('hidden', !open); mainArea.classList.remove('md:ml-64'); }
    else { sidebarOverlay.classList.add('hidden'); mainArea.classList.toggle('md:ml-64', open); }
}
function toggleSidebar() { setSidebar(sidebar.classList.contains('-translate-x-full')); }
$('sidebarOpenBtn').addEventListener('click', toggleSidebar);
$('sidebarCloseBtn').addEventListener('click', () => setSidebar(false));
sidebarOverlay.addEventListener('click', () => setSidebar(false));
let lastWasMobile = null;
function initializeSidebarState() {
    const m = isMobile();
    if (m === lastWasMobile) return; // only react when crossing the breakpoint (fixes sidebar closing on every mobile resize/keyboard)
    lastWasMobile = m;
    setSidebar(!m);
}
window.addEventListener('resize', initializeSidebarState);
initializeSidebarState();
$('sidebarUserBtn').addEventListener('click', () => openProfile());
$('folderFilterInput').addEventListener('input', renderCategories);

// ============================================================================
// Theme
// ============================================================================
function applyTheme(choice) {
    try { localStorage.setItem('theme', choice); } catch { /* ignore */ }
    const dark = choice === 'dark' || (choice === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark', dark);
    document.querySelectorAll('.theme-option-button').forEach((b) => b.classList.toggle('is-active', b.dataset.themeValue === choice));
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#1e1633' : '#4f46e5');
}
document.querySelectorAll('.theme-option-button').forEach((b) => b.addEventListener('click', () => applyTheme(b.dataset.themeValue)));
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if ((localStorage.getItem('theme') || 'system') === 'system') applyTheme('system');
});
applyTheme(localStorage.getItem('theme') || 'system');

// ============================================================================
// Header / user menu / settings
// ============================================================================
function closeAllMenus() { $('userMenu').classList.add('hidden'); $('userMenuBtn').setAttribute('aria-expanded', 'false'); }
$('userMenuBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    const open = $('userMenu').classList.contains('hidden');
    closeAllMenus();
    if (open) { $('userMenu').classList.remove('hidden'); $('userMenuBtn').setAttribute('aria-expanded', 'true'); }
});
document.addEventListener('click', (e) => { if (!e.target.closest('#userMenu')) closeAllMenus(); });
$('menuProfileBtn').addEventListener('click', () => { closeAllMenus(); openProfile(); });
$('menuUsersBtn').addEventListener('click', () => { closeAllMenus(); openUsersPanel(); });
$('menuSettingsBtn').addEventListener('click', () => { closeAllMenus(); openModal($('settingsModal')); });
$('menuLogoutBtn').addEventListener('click', () => logout());
$('settingsButton').addEventListener('click', () => openModal($('settingsModal')));
$('settingsUsersBtn').addEventListener('click', () => { closeModal($('settingsModal')); openUsersPanel(); });
$('verifyBannerBtn').addEventListener('click', () => resendVerification($('verifyBannerBtn')));

$('showImagesToggle').checked = prefs.showImages;
$('clampRecipeToggle').checked = prefs.clampRecipe;
$('showImagesToggle').addEventListener('change', (e) => { prefs.showImages = e.target.checked; savePrefs(); filterAndRenderDrinks(); });
$('clampRecipeToggle').addEventListener('change', (e) => { prefs.clampRecipe = e.target.checked; savePrefs(); filterAndRenderDrinks(); });

function roleChip(role) {
    const c = safeColor(role?.color);
    return `<span class="chip" style="background:${c}22;color:${c};box-shadow:inset 0 0 0 1px ${c}55">${esc(role?.name || 'Standard')}</span>`;
}

function updateUserUI() {
    if (!me) return;
    const name = me.displayName || me.email;
    const ini = initials(name);
    ['userMenuBtn', 'sidebarAvatar', 'profileAvatar'].forEach((id) => { $(id).textContent = ini; });
    $('userMenuName').textContent = name;
    $('userMenuEmail').textContent = me.email;
    $('sidebarUserName').textContent = name;
    $('sidebarUserRole').textContent = me.role?.name || 'Standard';
    const userPanel = perm('admin') || perm('manageUsers') || perm('disableUsers') || perm('deleteUsers');
    $('menuUsersBtn').classList.toggle('hidden', !userPanel);
    $('settingsUsersSection').classList.toggle('hidden', !userPanel);
    $('verifyBanner').classList.toggle('hidden', !!me.emailVerified);
}

// ============================================================================
// Modes (replaces the old access codes – driven by role permissions)
// ============================================================================
function setMode(next, { silent = false } = {}) {
    if (next === 'edit' && !perm('editMode')) return toast('Keine Berechtigung für den Bearbeitungsmodus.', 'error');
    if (next === 'staff' && !perm('staffMode')) return toast('Keine Berechtigung für den Personal Modus.', 'error');
    mode = next;
    try { sessionStorage.setItem('barMode', mode); } catch { /* ignore */ }
    if (!silent) {
        const label = { edit: 'Bearbeitungsmodus aktiv', staff: 'Personal Modus aktiv', view: 'Ansichtsmodus' }[mode];
        toast(label, 'info', { duration: 1800 });
    }
    updateActiveModesUI();
    if (next === 'edit' && initialLoadComplete && (!appSettings.defaultCategoryId || !allCategories[appSettings.defaultCategoryId]) && sortedCategoryEntries().length) {
        setDefaultCategory(sortedCategoryEntries()[0][0], { silent: true });
    }
}

$('modalEditModeButton').addEventListener('click', () => setMode(isEdit() ? 'view' : 'edit'));
$('modalStaffModeButton').addEventListener('click', () => setMode(isStaff() ? 'view' : 'staff'));

function styleModeButton(btn, active, { on, off, iconOn, iconOff, color }) {
    btn.className = `btn w-full ${active ? 'btn-danger' : color}`;
    btn.innerHTML = `<i class="fas ${active ? iconOn : iconOff}"></i> ${active ? on : off}`;
}

function updateActiveModesUI() {
    const canEdit = perm('editMode');
    const canStaff = perm('staffMode');
    $('editModeRow').classList.toggle('hidden', !canEdit);
    $('staffModeRow').classList.toggle('hidden', !canStaff);
    $('noModesHint').classList.toggle('hidden', canEdit || canStaff);
    styleModeButton($('modalEditModeButton'), isEdit(), { on: 'Bearbeitungsmodus verlassen', off: 'Bearbeitungsmodus aktivieren', iconOn: 'fa-lock-open', iconOff: 'fa-pen-ruler', color: 'bg-amber-500 text-white hover:bg-amber-600' });
    styleModeButton($('modalStaffModeButton'), isStaff(), { on: 'Personal Modus verlassen', off: 'Personal Modus aktivieren', iconOn: 'fa-user-shield', iconOff: 'fa-user-tie', color: 'bg-violet-600 text-white hover:bg-violet-700' });
    $('dataManagementSection').classList.toggle('hidden', !isEdit());

    const status = $('headerModeStatus');
    if (mode === 'view') status.classList.add('hidden');
    else {
        status.classList.remove('hidden');
        status.className = `chip cursor-pointer ${isEdit() ? 'bg-amber-400 text-amber-950' : 'bg-violet-500 text-white'}`;
        status.innerHTML = `<i class="fas ${isEdit() ? 'fa-pen-ruler' : 'fa-user-tie'}"></i><span class="hidden sm:inline">${isEdit() ? 'Bearbeiten' : 'Personal'}</span>`;
        status.title = 'Klicken, um den Modus zu verlassen';
    }
    renderCategories();
    filterAndRenderDrinks();
}
$('headerModeStatus').addEventListener('click', () => setMode('view'));

// ============================================================================
// Folders (sidebar)
// ============================================================================
function drinkCountByCategory() {
    const counts = {};
    for (const d of Object.values(allDrinks)) counts[d.categoryId] = (counts[d.categoryId] || 0) + 1;
    return counts;
}

function renderCategories() {
    if (sortableInstance) { sortableInstance.destroy(); sortableInstance = null; }
    const container = $('categoriesContainer');
    container.innerHTML = '';
    const entries = sortedCategoryEntries();
    const filter = $('folderFilterInput').value.trim().toLowerCase();
    $('addCategoryButton').classList.toggle('hidden', !isEdit());
    if (!entries.length) {
        container.innerHTML = `<p class="px-2 text-sm text-gray-500 dark:text-gray-400">${isEdit() ? 'Erstelle unten deinen ersten Ordner.' : 'Keine Ordner vorhanden.'}</p>`;
        updateMainActionButtonsVisibility();
        return;
    }
    const counts = drinkCountByCategory();
    const canDelete = entries.length > 1;
    entries.forEach(([id, category]) => {
        if (filter && !category.name.toLowerCase().includes(filter)) return;
        const isActive = id === selectedCategoryId;
        const isHome = id === appSettings.defaultCategoryId;
        const div = document.createElement('div');
        div.dataset.id = id;
        div.className = `group flex cursor-pointer items-center gap-1 rounded-lg px-2.5 py-2 text-sm transition-colors ${isActive ? 'bg-indigo-600 text-white shadow-sm' : 'text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-plum-800'}`;
        div.setAttribute('role', 'button');
        div.tabIndex = 0;
        const muted = isActive ? 'text-indigo-200 hover:text-white' : 'text-gray-400 hover:text-gray-700 dark:hover:text-white';
        div.innerHTML = `
            ${isEdit() && !filter ? `<span class="drag-handle ${muted} pr-1" title="Ziehen zum Sortieren"><i class="fas fa-grip-vertical"></i></span>` : ''}
            ${isHome ? `<i class="fas fa-house text-xs ${isActive ? 'text-zest-300' : 'text-zest-500'}" title="Startordner"></i>` : ''}
            <span class="min-w-0 flex-1 truncate font-medium">${esc(category.name)}</span>
            <span class="rounded-full px-2 text-xs ${isActive ? 'bg-white/20' : 'bg-gray-100 text-gray-500 dark:bg-plum-800 dark:text-gray-400'}">${counts[id] || 0}</span>
            ${isEdit() ? `
                <button data-id="${esc(id)}" title="Als Startordner festlegen" aria-label="Als Startordner festlegen" class="set-home-category-btn p-1 ${muted}"><i class="${isHome ? 'fas' : 'far'} fa-star"></i></button>
                <button data-id="${esc(id)}" title="Ordner bearbeiten" aria-label="Ordner bearbeiten" class="edit-category-btn p-1 ${muted}"><i class="fas fa-pen"></i></button>
                ${canDelete ? `<button data-id="${esc(id)}" title="Ordner löschen" aria-label="Ordner löschen" class="delete-category-btn p-1 ${isActive ? 'text-rose-200 hover:text-white' : 'text-rose-400 hover:text-rose-600'}"><i class="fas fa-trash"></i></button>` : ''}
            ` : ''}`;
        const select = () => {
            if (selectedCategoryId !== id) {
                selectedCategoryId = id;
                prefs.lastCategory = id; savePrefs();
                renderCategories();
                filterAndRenderDrinks();
                $('mainArea').scrollTo({ top: 0 });
            }
            if (isMobile()) setSidebar(false);
        };
        div.addEventListener('click', (e) => { if (!e.target.closest('button, .drag-handle')) select(); });
        div.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === div) { e.preventDefault(); select(); } });
        container.appendChild(div);
    });
    container.querySelectorAll('.edit-category-btn').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); openCategoryModal(b.dataset.id); }));
    container.querySelectorAll('.delete-category-btn').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); handleDeleteCategory(b.dataset.id); }));
    container.querySelectorAll('.set-home-category-btn').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); setDefaultCategory(b.dataset.id); }));
    if (isEdit() && !filter && typeof Sortable !== 'undefined') {
        sortableInstance = new Sortable(container, {
            animation: 150, handle: '.drag-handle', ghostClass: 'sortable-ghost',
            onEnd: async () => {
                const ids = [...container.children].map((el) => el.dataset.id).filter(Boolean);
                ids.forEach((id, i) => { if (allCategories[id]) allCategories[id].order = i; });
                const res = await act('reorderCategories', { ids }, { modeOverride: 'edit' });
                if (!res) renderCategories();
            },
        });
    }
    updateMainActionButtonsVisibility();
}

async function setDefaultCategory(catId, { silent = false } = {}) {
    if (!catId || !allCategories[catId]) return showCustomAlert('Ungültiger Ordner kann nicht als Standard festgelegt werden.');
    if (appSettings.defaultCategoryId === catId) return;
    const res = await act('setDefaultCategory', { id: catId }, { modeOverride: 'edit' });
    if (res && !silent) toast(`„${allCategories[catId]?.name}" ist jetzt der Startordner.`, 'success');
}

function updateMainActionButtonsVisibility() {
    const cat = selectedCategoryId && allCategories[selectedCategoryId];
    const s = cat ? cat.staffSettings || {} : {};
    $('staffAddExistingDrinkMainBtn').classList.toggle('hidden', !(isStaff() && cat && s.allowAddExisting));
    $('staffAddNewRecipeMainBtn').classList.toggle('hidden', !(isStaff() && cat && s.allowAddNewRecipe));
    $('staffPurgeCategoryBtn').classList.toggle('hidden', !(isStaff() && cat && s.darfOrdnerLeeren));
    $('addDrinkButton').classList.toggle('hidden', !(isEdit() && cat));
    $('editModeCloneDrinkBtn').classList.toggle('hidden', !(isEdit() && cat));
}

// ============================================================================
// Drinks – filtering, sorting, rendering
// ============================================================================
function searchTerms() { return currentSearchQuery.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean); }

function drinkMatchesSearch(drink, terms) {
    if (!terms.length) return true;
    const hay = [drink.name, drink.glass, drink.garnish, ...(drink.ingredients || []).map((i) => i?.item)].filter(Boolean).map((s) => String(s).toLowerCase());
    return terms.every((t) => hay.some((h) => h.includes(t)));
}

function getVisibleDrinks() {
    const terms = searchTerms();
    const acrossAll = prefs.searchAll && terms.length > 0;
    const list = Object.entries(allDrinks).filter(([id, d]) => {
        if (!acrossAll && d.categoryId !== selectedCategoryId) return false;
        if (acrossAll && !allCategories[d.categoryId]) return false;
        if (currentFilterType !== 'Alles' && d.type !== currentFilterType) return false;
        if (favOnly && !me?.favorites?.[id]) return false;
        return drinkMatchesSearch(d, terms);
    });
    const fav = (id) => (me?.favorites?.[id] ? 1 : 0);
    const nameCmp = ([, a], [, b]) => (a.name || '').localeCompare(b.name || '', 'de', { sensitivity: 'base' });
    switch (prefs.sort) {
        case 'name-desc': list.sort((x, y) => nameCmp(y, x)); break;
        case 'newest': list.sort(([, a], [, b]) => (b.createdAt || 0) - (a.createdAt || 0) || nameCmp([, a], [, b])); break;
        case 'favorites': list.sort((x, y) => fav(y[0]) - fav(x[0]) || nameCmp(x, y)); break;
        default: list.sort(nameCmp);
    }
    return { list, acrossAll };
}

function popupAllowedFor(drink) {
    const s = allCategories[drink?.categoryId]?.staffSettings;
    return s ? s.enableRecipePopup !== false : true;
}

function quickConfirmTarget(drink) {
    const s = allCategories[drink.categoryId]?.staffSettings;
    const t = s?.schnellbestaetigungZielordnerId;
    return (s?.darfSchnellbestaetigung && t && t !== drink.categoryId && allCategories[t]) ? t : null;
}

function filterAndRenderDrinks() {
    const container = $('drinksContainer');
    const noDrinks = $('noDrinksMessage');
    const title = $('categoryTitle');
    const meta = $('categoryMeta');
    $('searchAllWrap').classList.toggle('hidden', !currentSearchQuery.trim());
    $('searchAllWrap').classList.toggle('flex', !!currentSearchQuery.trim());

    if (!selectedCategoryId || !allCategories[selectedCategoryId]) {
        title.textContent = Object.keys(allCategories).length ? 'Ordner wählen' : 'Keine Ordner';
        meta.textContent = '';
        container.innerHTML = '';
        noDrinks.classList.toggle('hidden', !Object.keys(allCategories).length);
        noDrinks.textContent = 'Wähle links einen Ordner aus.';
        updateMainActionButtonsVisibility();
        return;
    }
    const currentCategory = allCategories[selectedCategoryId];
    const { list, acrossAll } = getVisibleDrinks();
    title.textContent = acrossAll ? 'Alle Ordner' : currentCategory.name;
    const total = Object.values(allDrinks).filter((d) => d.categoryId === selectedCategoryId).length;
    meta.textContent = acrossAll ? `${list.length} Treffer in allen Ordnern` : (list.length === total ? `${total} Drink${total === 1 ? '' : 's'}` : `${list.length} von ${total} Drinks`);

    container.className = prefs.view === 'list' ? 'flex flex-col gap-2' : 'grid grid-cols-1 gap-4 sm:gap-5 md:grid-cols-2 xl:grid-cols-3';
    container.innerHTML = '';
    if (!list.length) {
        noDrinks.classList.remove('hidden');
        const q = currentSearchQuery.trim();
        if (q) noDrinks.innerHTML = `Keine Drinks für „${esc(q)}" gefunden.${!prefs.searchAll ? ' <button id="searchAllInline" class="font-semibold text-indigo-600 underline dark:text-zest-300">In allen Ordnern suchen</button>' : ''}`;
        else if (favOnly) noDrinks.textContent = 'Keine Favoriten in diesem Ordner. Tippe auf den Stern eines Drinks, um ihn zu merken.';
        else if (isEdit()) noDrinks.innerHTML = 'Dieser Ordner ist leer. <button id="emptyAddDrink" class="font-semibold text-indigo-600 underline dark:text-zest-300">Ersten Drink anlegen</button>';
        else noDrinks.textContent = 'Dieser Ordner ist leer.';
        $('searchAllInline')?.addEventListener('click', () => { $('searchAllToggle').checked = true; prefs.searchAll = true; savePrefs(); filterAndRenderDrinks(); });
        $('emptyAddDrink')?.addEventListener('click', () => openDrinkModal(null, selectedCategoryId));
    } else noDrinks.classList.add('hidden');

    const frag = document.createDocumentFragment();
    list.forEach(([id, drink]) => frag.appendChild(prefs.view === 'list' ? buildDrinkRow(id, drink, acrossAll) : buildDrinkCard(id, drink, acrossAll)));
    container.appendChild(frag);
    updateMainActionButtonsVisibility();
}

function typePill(type) {
    const mock = type === 'Mocktail';
    return `<span class="chip ${mock ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200' : 'bg-rose-100 text-rose-800 dark:bg-rose-900/50 dark:text-rose-200'}">${esc(type)}</span>`;
}

function drinkActionButtons(id, drink) {
    const b = (cls, icon, label, extra = '') => `<button data-id="${esc(id)}" class="${cls} btn btn-sm btn-secondary" ${extra}><i class="fas ${icon}"></i><span class="hidden sm:inline">${label}</span></button>`;
    let html = '';
    if (isEdit()) {
        html += b('edit-drink-btn', 'fa-pen', 'Bearbeiten', 'aria-label="Bearbeiten"');
        html += b('duplicate-drink-btn', 'fa-copy', 'Duplizieren', 'aria-label="Duplizieren"');
        html += `<button data-id="${esc(id)}" class="delete-drink-btn btn btn-sm btn-ghost text-rose-600 dark:text-rose-400" aria-label="Löschen"><i class="fas fa-trash"></i></button>`;
    } else if (isStaff()) {
        const s = allCategories[drink.categoryId]?.staffSettings || {};
        const target = quickConfirmTarget(drink);
        if (target) html += `<button data-id="${esc(id)}" class="quick-confirm-btn btn btn-sm btn-success" title="Schnellbestätigen nach ${esc(allCategories[target].name)}"><i class="fas fa-check-double"></i><span class="hidden sm:inline">Bestätigen</span></button>`;
        if (s.darfDrinksLoeschen) html += `<button data-id="${esc(id)}" class="delete-drink-btn btn btn-sm btn-ghost text-rose-600 dark:text-rose-400" aria-label="Löschen"><i class="fas fa-trash"></i><span class="hidden sm:inline">Löschen</span></button>`;
    }
    return html;
}

function favButton(id, extraCls = '') {
    const on = !!me?.favorites?.[id];
    return `<button data-id="${esc(id)}" class="fav-btn ${extraCls} flex h-9 w-9 items-center justify-center rounded-full ${on ? 'text-zest-500' : 'text-gray-400 hover:text-zest-500'}" aria-pressed="${on}" aria-label="${on ? 'Aus Favoriten entfernen' : 'Zu Favoriten'}"><i class="${on ? 'fas' : 'far'} fa-star"></i></button>`;
}

function wireCard(el, id) {
    el.querySelector('.edit-drink-btn')?.addEventListener('click', () => openDrinkModal(id));
    el.querySelector('.duplicate-drink-btn')?.addEventListener('click', () => duplicateDrink(id));
    el.querySelector('.delete-drink-btn')?.addEventListener('click', () => handleDeleteDrink(id));
    el.querySelector('.quick-confirm-btn')?.addEventListener('click', () => handleQuickConfirmDrink(id));
    el.querySelectorAll('.fav-btn').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); toggleFavorite(id); }));
    el.querySelector('.open-recipe-btn')?.addEventListener('click', () => showRecipePopup(id));
    el.addEventListener('dblclick', (e) => { if (!e.target.closest('button')) handleDrinkCardDoubleClick(id); });
    let lastTap = 0;
    el.addEventListener('touchend', (e) => {
        if (e.target.closest('button')) return;
        const now = Date.now();
        if (now - lastTap < 300) { e.preventDefault(); handleDrinkCardDoubleClick(id); lastTap = 0; } else lastTap = now;
    });
}

function buildDrinkCard(id, drink, showFolder) {
    const card = document.createElement('article');
    card.className = 'drink-card flex flex-col overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-gray-200/70 dark:bg-plum-900 dark:ring-plum-800';
    card.dataset.drinkId = id;
    const img = prefs.showImages && safeUrl(drink.imageUrl);
    const ingredients = drink.ingredients || [];
    const actions = drinkActionButtons(id, drink);
    const popup = popupAllowedFor(drink);
    card.innerHTML = `
        ${img ? `<div class="relative h-40 bg-gray-100 dark:bg-plum-800"><img src="${esc(img)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" class="h-full w-full object-cover"></div>` : ''}
        <div class="flex flex-1 flex-col p-5">
            <div class="mb-3 flex items-start gap-2">
                <div class="min-w-0 flex-1">
                    <h3 class="font-display text-xl font-bold leading-tight text-gray-900 dark:text-white sm:text-2xl">${esc(drink.name)} <span class="text-lg">${esc(drink.symbols || '')}</span></h3>
                    <div class="mt-1.5 flex flex-wrap items-center gap-1.5">
                        ${typePill(drink.type)}
                        ${drink.glass ? `<span class="chip bg-gray-100 text-gray-600 dark:bg-plum-800 dark:text-gray-300"><i class="fas fa-whiskey-glass"></i>${esc(drink.glass)}</span>` : ''}
                        ${showFolder ? `<span class="chip bg-indigo-50 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-200"><i class="fas fa-folder"></i>${esc(allCategories[drink.categoryId]?.name || '')}</span>` : ''}
                    </div>
                </div>
                ${favButton(id, '-mr-2 -mt-1')}
            </div>
            ${ingredients.length ? `
            <ul class="mb-3 space-y-0.5 text-sm text-gray-700 dark:text-gray-300">
                ${ingredients.map((i) => `<li class="flex gap-2"><span class="w-20 flex-shrink-0 text-right font-semibold tabular-nums text-gray-900 dark:text-white">${esc(i.amount)}</span><span>${esc(i.item)}</span></li>`).join('')}
            </ul>` : ''}
            ${drink.recipe ? `<p class="${prefs.clampRecipe ? 'clamp-4' : ''} whitespace-pre-wrap text-sm text-gray-500 dark:text-gray-400">${esc(drink.recipe)}</p>` : ''}
            ${drink.garnish ? `<p class="mt-2 text-xs text-gray-500 dark:text-gray-400"><i class="fas fa-lemon mr-1 text-zest-500"></i>${esc(drink.garnish)}</p>` : ''}
            ${drink.notes ? `<p class="mt-2 rounded-lg bg-zest-300/15 px-2.5 py-1.5 text-xs text-gray-700 dark:text-zest-300"><i class="fas fa-note-sticky mr-1"></i>${esc(drink.notes)}</p>` : ''}
            <div class="mt-auto flex flex-wrap items-center justify-end gap-1.5 pt-4">
                ${popup ? `<button class="open-recipe-btn btn btn-sm btn-ghost mr-auto" aria-label="Rezept öffnen"><i class="fas fa-up-right-and-down-left-from-center"></i><span class="hidden sm:inline">Öffnen</span></button>` : ''}
                ${actions}
            </div>
        </div>`;
    const im = card.querySelector('img');
    if (im) im.addEventListener('error', () => im.parentElement.remove(), { once: true });
    wireCard(card, id);
    return card;
}

function buildDrinkRow(id, drink, showFolder) {
    const row = document.createElement('article');
    row.className = 'drink-card flex items-center gap-3 rounded-xl bg-white px-3 py-2.5 shadow-sm ring-1 ring-gray-200/70 dark:bg-plum-900 dark:ring-plum-800';
    row.dataset.drinkId = id;
    const img = prefs.showImages && safeUrl(drink.imageUrl);
    row.innerHTML = `
        ${img ? `<img src="${esc(img)}" alt="" loading="lazy" referrerpolicy="no-referrer" class="h-11 w-11 flex-shrink-0 rounded-lg object-cover">` : `<span class="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg bg-gray-100 text-lg dark:bg-plum-800">${esc((drink.symbols || '').slice(0, 2)) || '🍸'}</span>`}
        <div class="min-w-0 flex-1 cursor-pointer open-recipe-area">
            <div class="flex items-center gap-2"><h3 class="truncate font-semibold text-gray-900 dark:text-white">${esc(drink.name)}</h3>${typePill(drink.type)}${showFolder ? `<span class="chip hidden bg-indigo-50 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-200 sm:inline-flex">${esc(allCategories[drink.categoryId]?.name || '')}</span>` : ''}</div>
            <p class="truncate text-xs text-gray-500 dark:text-gray-400">${esc((drink.ingredients || []).map((i) => i.item).join(', ') || 'Keine Zutaten')}</p>
        </div>
        <div class="flex flex-shrink-0 items-center gap-1">${drinkActionButtons(id, drink)}${favButton(id)}</div>`;
    const im = row.querySelector('img');
    if (im) im.addEventListener('error', () => { im.replaceWith(Object.assign(document.createElement('span'), { className: 'flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg bg-gray-100 text-lg dark:bg-plum-800', textContent: '🍸' })); }, { once: true });
    row.querySelector('.open-recipe-area').addEventListener('click', () => { if (popupAllowedFor(drink)) showRecipePopup(id); });
    wireCard(row, id);
    return row;
}

function handleDrinkCardDoubleClick(drinkId) {
    const d = allDrinks[drinkId];
    if (d && allCategories[d.categoryId] && popupAllowedFor(d)) showRecipePopup(drinkId);
}

// ----- search / filter / sort / view controls -----
let searchDebounce = null;
function handleSearchInput(e) {
    currentSearchQuery = e.target.value;
    if (e.target.id === 'searchInput') $('searchInputMobile').value = currentSearchQuery;
    else $('searchInput').value = currentSearchQuery;
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(filterAndRenderDrinks, 120);
}
$('searchInput').addEventListener('input', handleSearchInput);
$('searchInputMobile').addEventListener('input', handleSearchInput);
$('searchAllToggle').checked = prefs.searchAll;
$('searchAllToggle').addEventListener('change', (e) => { prefs.searchAll = e.target.checked; savePrefs(); filterAndRenderDrinks(); });

document.querySelectorAll('.filter-btn').forEach((btn) => btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach((b) => b.classList.toggle('is-active', b === btn));
    currentFilterType = btn.dataset.type;
    filterAndRenderDrinks();
}));
$('favFilterBtn').addEventListener('click', () => {
    favOnly = !favOnly;
    const b = $('favFilterBtn');
    b.setAttribute('aria-pressed', String(favOnly));
    b.className = `btn btn-sm ${favOnly ? 'bg-zest-400 text-plum-950 hover:bg-zest-500' : 'btn-secondary'}`;
    b.innerHTML = `<i class="${favOnly ? 'fas' : 'far'} fa-star"></i> Favoriten`;
    filterAndRenderDrinks();
});
$('sortSelect').value = prefs.sort;
$('sortSelect').addEventListener('change', (e) => { prefs.sort = e.target.value; savePrefs(); filterAndRenderDrinks(); });
function syncViewButtons() { document.querySelectorAll('.view-btn').forEach((b) => b.classList.toggle('is-active', b.dataset.view === prefs.view)); }
document.querySelectorAll('.view-btn').forEach((b) => b.addEventListener('click', () => { prefs.view = b.dataset.view; savePrefs(); syncViewButtons(); filterAndRenderDrinks(); }));
syncViewButtons();

$('randomDrinkBtn').addEventListener('click', () => {
    const { list } = getVisibleDrinks();
    if (!list.length) return toast('Keine Drinks zur Auswahl.', 'info');
    const [id, drink] = list[Math.floor(Math.random() * list.length)];
    const el = document.querySelector(`[data-drink-id="${CSS.escape(id)}"]`);
    if (popupAllowedFor(drink)) showRecipePopup(id);
    else if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }
    toast(`Wie wär's mit: ${drink.name}?`, 'info', { duration: 2500 });
});

// ----- favorites -----
async function toggleFavorite(id) {
    if (!me) return;
    const on = !me.favorites[id];
    if (on) me.favorites[id] = true; else delete me.favorites[id];
    filterAndRenderDrinks();
    if (currentRecipePopupDrinkId === id) updatePopupFav();
    try { await api('/api/action', { method: 'POST', body: { action: 'toggleFavorite', drinkId: id, on } }); }
    catch (e) {
        if (on) delete me.favorites[id]; else me.favorites[id] = true;
        filterAndRenderDrinks();
        toast(e.message, 'error');
    }
}

// ============================================================================
// Recipe popup (with servings scaling & print)
// ============================================================================
let popupServings = 1;

function scaleAmount(amount, factor) {
    if (factor === 1 || !amount) return amount;
    const usesComma = /\d,\d/.test(amount);
    const fmt = (n) => {
        const r = Math.round(n * 100) / 100;
        const s = String(r);
        return usesComma ? s.replace('.', ',') : s;
    };
    // Fractions (1/2) first, then plain numbers (2, 2.5, 2,5). Ranges like 8-10 scale both ends. No lookbehind (older Safari).
    return amount.replace(/(\d+(?:[.,]\d+)?)\s*\/\s*(\d+)|(\d+(?:[.,]\d+)?)/g, (m, fa, fb, n) => {
        if (fa !== undefined) return Number(fb) ? fmt((parseFloat(fa.replace(',', '.')) / Number(fb)) * factor) : m;
        return fmt(parseFloat(n.replace(',', '.')) * factor);
    });
}

function updatePopupFav() {
    const on = !!me?.favorites?.[currentRecipePopupDrinkId];
    const b = $('recipePopupFavBtn');
    b.innerHTML = `<i class="${on ? 'fas text-zest-500' : 'far'} fa-star"></i>`;
    b.setAttribute('aria-pressed', String(on));
}

function showRecipePopup(drinkId, { keepServings = false } = {}) {
    const drink = allDrinks[drinkId];
    if (!drink || !allCategories[drink.categoryId]) return showCustomAlert('Drink oder zugehöriger Ordner nicht gefunden.');
    if (!keepServings || currentRecipePopupDrinkId !== drinkId) popupServings = 1;
    currentRecipePopupDrinkId = drinkId;
    $('recipePopupTitle').textContent = drink.name + (drink.symbols ? ` ${drink.symbols}` : '');

    const img = safeUrl(drink.imageUrl);
    const imgEl = $('recipePopupImage');
    if (img) {
        imgEl.onerror = () => $('recipePopupImageContainer').classList.add('hidden');
        imgEl.referrerPolicy = 'no-referrer';
        imgEl.src = img;
        $('recipePopupImageContainer').classList.remove('hidden');
    } else $('recipePopupImageContainer').classList.add('hidden');

    const renderBody = () => {
        const ings = drink.ingredients || [];
        const ingredientsHtml = ings.length
            ? `<ul class="space-y-1 text-base">${ings.map((i) => `<li class="flex gap-3"><span class="w-24 flex-shrink-0 text-right font-semibold tabular-nums text-gray-900 dark:text-white">${esc(scaleAmount(i.amount, popupServings))}</span><span>${esc(i.item)}</span></li>`).join('')}</ul>`
            : '<p class="text-sm text-gray-500">Keine Zutaten gelistet.</p>';
        const updated = drink.updatedAt ? `Zuletzt bearbeitet ${relTime(drink.updatedAt)}${drink.updatedByName ? ` von ${esc(drink.updatedByName)}` : ''}` : (drink.createdAt ? `Angelegt ${relTime(drink.createdAt)}${drink.createdByName ? ` von ${esc(drink.createdByName)}` : ''}` : '');
        $('recipePopupContent').innerHTML = `
            <div class="space-y-5 text-gray-700 dark:text-gray-300">
                <div class="flex flex-wrap items-center gap-2">
                    ${typePill(drink.type)}
                    ${drink.glass ? `<span class="chip bg-gray-100 text-gray-700 dark:bg-plum-800 dark:text-gray-200"><i class="fas fa-whiskey-glass"></i>${esc(drink.glass)}</span>` : ''}
                    <span class="chip bg-indigo-50 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-200"><i class="fas fa-folder"></i>${esc(allCategories[drink.categoryId]?.name || '')}</span>
                </div>
                <div>
                    <div class="mb-2 flex items-center justify-between">
                        <h4 class="font-display text-lg font-bold text-gray-900 dark:text-white">Zutaten</h4>
                        ${ings.length ? `<div class="no-print flex items-center gap-1 rounded-lg bg-gray-100 p-1 dark:bg-plum-800" aria-label="Portionen">
                            <button class="serv-minus flex h-7 w-7 items-center justify-center rounded-md hover:bg-white dark:hover:bg-plum-700" aria-label="Weniger Portionen"><i class="fas fa-minus text-xs"></i></button>
                            <span class="min-w-[4.5rem] text-center text-xs font-semibold">${popupServings} Portion${popupServings === 1 ? '' : 'en'}</span>
                            <button class="serv-plus flex h-7 w-7 items-center justify-center rounded-md hover:bg-white dark:hover:bg-plum-700" aria-label="Mehr Portionen"><i class="fas fa-plus text-xs"></i></button>
                        </div>` : ''}
                    </div>
                    ${ingredientsHtml}
                </div>
                <div>
                    <h4 class="mb-2 font-display text-lg font-bold text-gray-900 dark:text-white">Zubereitung</h4>
                    <p class="whitespace-pre-wrap text-base leading-relaxed">${esc(drink.recipe || 'Kein Rezept vorhanden.')}</p>
                </div>
                ${drink.garnish ? `<p><span class="font-semibold text-gray-900 dark:text-white">Garnitur:</span> ${esc(drink.garnish)}</p>` : ''}
                ${drink.notes ? `<p class="rounded-lg bg-zest-300/15 p-3 text-sm"><i class="fas fa-note-sticky mr-1"></i>${esc(drink.notes)}</p>` : ''}
                ${updated ? `<p class="hint">${updated}</p>` : ''}
            </div>`;
        $('recipePopupContent').querySelector('.serv-minus')?.addEventListener('click', () => { if (popupServings > 1) { popupServings--; renderBody(); } });
        $('recipePopupContent').querySelector('.serv-plus')?.addEventListener('click', () => { if (popupServings < 50) { popupServings++; renderBody(); } });
    };
    renderBody();

    const target = isStaff() ? quickConfirmTarget(drink) : null;
    const qc = $('recipePopupSchnellbestaetigungBtn');
    qc.classList.toggle('hidden', !target);
    qc.onclick = target ? () => handleQuickConfirmDrink(drinkId) : null;
    const eb = $('recipePopupEditBtn');
    eb.classList.toggle('hidden', !isEdit());
    eb.onclick = () => { closeModal($('recipePopupModal'), true); openDrinkModal(drinkId); };
    updatePopupFav();
    openModal($('recipePopupModal'));
}
$('recipePopupFavBtn').addEventListener('click', () => { if (currentRecipePopupDrinkId) toggleFavorite(currentRecipePopupDrinkId); });
$('recipePopupPrintBtn').addEventListener('click', () => {
    document.body.classList.add('printing-recipe');
    window.print();
});
window.addEventListener('afterprint', () => document.body.classList.remove('printing-recipe'));

// ============================================================================
// Folder create / edit / delete
// ============================================================================
$('addCategoryButton').addEventListener('click', () => openCategoryModal());

function populateQuickConfirmTargetFolderSelect(editingId, selectedTargetId) {
    const sel = $('categoryQuickConfirmTargetFolder');
    sel.innerHTML = '<option value="">– Zielordner wählen –</option>';
    sortedCategoryEntries().forEach(([id, cat]) => {
        if (id === editingId) return;
        const o = document.createElement('option');
        o.value = id; o.textContent = cat.name;
        if (id === selectedTargetId) o.selected = true;
        sel.appendChild(o);
    });
}

function openCategoryModal(id = null) {
    if (!isEdit()) return;
    $('categoryForm').reset();
    $('categoryId').value = id || '';
    const cat = id ? allCategories[id] : null;
    const s = cat?.staffSettings || {};
    $('categoryModalTitle').textContent = cat ? 'Ordner bearbeiten' : 'Neuen Ordner erstellen';
    $('categoryName').value = cat?.name || '';
    $('categoryEnableStaffAddDrink').checked = s.allowAddExisting ?? true;
    $('categoryEnableStaffAddRezept').checked = s.allowAddNewRecipe ?? true;
    $('categoryEnableStaffDeleteDrink').checked = s.darfDrinksLoeschen ?? true;
    $('categoryEnableStaffPurgeFolder').checked = s.darfOrdnerLeeren ?? false;
    $('categoryEnableStaffQuickConfirm').checked = !!s.darfSchnellbestaetigung;
    $('categoryEnableRecipePopup').checked = s.enableRecipePopup ?? true;
    populateQuickConfirmTargetFolderSelect(id, s.schnellbestaetigungZielordnerId);
    $('quickConfirmTargetFolderContainer').classList.toggle('hidden', !$('categoryEnableStaffQuickConfirm').checked);
    openModal($('categoryModal'));
}
$('categoryEnableStaffQuickConfirm').addEventListener('change', (e) => {
    $('quickConfirmTargetFolderContainer').classList.toggle('hidden', !e.target.checked);
    if (!e.target.checked) $('categoryQuickConfirmTargetFolder').value = '';
});

$('categoryForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = $('categoryId').value;
    const name = $('categoryName').value.trim();
    if (!name) return showCustomAlert('Der Ordnername darf nicht leer sein.');
    const staffSettings = {
        allowAddExisting: $('categoryEnableStaffAddDrink').checked,
        allowAddNewRecipe: $('categoryEnableStaffAddRezept').checked,
        darfDrinksLoeschen: $('categoryEnableStaffDeleteDrink').checked,
        darfOrdnerLeeren: $('categoryEnableStaffPurgeFolder').checked,
        darfSchnellbestaetigung: $('categoryEnableStaffQuickConfirm').checked,
        schnellbestaetigungZielordnerId: $('categoryEnableStaffQuickConfirm').checked ? $('categoryQuickConfirmTargetFolder').value || null : null,
        enableRecipePopup: $('categoryEnableRecipePopup').checked,
    };
    if (staffSettings.darfSchnellbestaetigung && !staffSettings.schnellbestaetigungZielordnerId) {
        return showCustomAlert('Bitte einen Zielordner für die Schnellbestätigung wählen oder die Option deaktivieren.');
    }
    await withBusy(e.submitter, async () => {
        const res = await act('saveCategory', { id: id || undefined, name, staffSettings }, { modeOverride: 'edit' });
        if (res) {
            closeModal($('categoryModal'), true);
            if (!id && res.id) { selectedCategoryId = res.id; prefs.lastCategory = res.id; savePrefs(); }
            toast(id ? 'Ordner gespeichert.' : `Ordner „${name}" erstellt.`, 'success');
        }
    });
});

async function handleDeleteCategory(id) {
    const cat = allCategories[id];
    if (!cat) return showCustomAlert('Ordner nicht gefunden.');
    if (Object.keys(allCategories).length <= 1) return showCustomAlert('Der letzte Ordner kann nicht gelöscht werden.');
    const n = Object.values(allDrinks).filter((d) => d.categoryId === id).length;
    const ok = await showConfirm(
        n ? `Der Ordner „${cat.name}" und alle ${n} Drinks darin werden endgültig gelöscht.` : `Der leere Ordner „${cat.name}" wird gelöscht.`,
        { title: 'Ordner löschen?', confirmLabel: 'Endgültig löschen', typeToConfirm: n ? cat.name : null },
    );
    if (!ok) return;
    const res = await act('deleteCategory', { id }, { modeOverride: 'edit' });
    if (res) {
        if (selectedCategoryId === id) selectedCategoryId = null;
        toast(`Ordner „${cat.name}" gelöscht.`, 'success');
    }
}

// ============================================================================
// Drink form
// ============================================================================
$('addDrinkButton').addEventListener('click', () => {
    if (selectedCategoryId && allCategories[selectedCategoryId]) openDrinkModal(null, selectedCategoryId);
    else if (sortedCategoryEntries().length) openDrinkModal(null, sortedCategoryEntries()[0][0]);
    else showCustomAlert('Bitte erstelle zuerst einen Ordner.');
});
$('staffAddNewRecipeMainBtn').addEventListener('click', () => {
    if (selectedCategoryId && allCategories[selectedCategoryId]) openDrinkModal(null, null, true, selectedCategoryId);
    else showCustomAlert('Bitte wähle zuerst einen Ordner aus.');
});
$('staffAddExistingDrinkMainBtn').addEventListener('click', () => openAddExistingDrinkModal(selectedCategoryId));
$('editModeCloneDrinkBtn').addEventListener('click', () => openAddExistingDrinkModal(selectedCategoryId));

function populateCategorySelectInForms() {
    const drinkSel = $('drinkCategory');
    const srcSel = $('sourceCategorySelect');
    const keepDrink = drinkSel.value;
    const keepSrc = srcSel.value;
    drinkSel.innerHTML = '';
    srcSel.innerHTML = '<option value="">– Ordner wählen –</option>';
    const counts = drinkCountByCategory();
    sortedCategoryEntries().forEach(([id, c]) => {
        drinkSel.add(new Option(c.name, id));
        srcSel.add(new Option(`${c.name} (${counts[id] || 0})`, id));
    });
    if (keepDrink && allCategories[keepDrink]) drinkSel.value = keepDrink;
    if (keepSrc && allCategories[keepSrc]) srcSel.value = keepSrc;
    else if (lastSelectedSourceCategoryId && allCategories[lastSelectedSourceCategoryId]) srcSel.value = lastSelectedSourceCategoryId;
}

function toggleRequiredFields(optional) {
    document.querySelector('label[for="drinkRecipe"]').textContent = optional ? 'Rezept' : 'Rezept*';
    document.querySelector('.ingredients-label').textContent = optional ? 'Zutaten' : 'Zutaten*';
}
$('allowEmptyFieldsToggle').addEventListener('change', (e) => toggleRequiredFields(e.target.checked));

function updateImagePreview() {
    const url = safeUrl($('drinkImageUrl').value.trim());
    const img = $('drinkImagePreview');
    if (!url) { img.classList.add('hidden'); img.removeAttribute('src'); return; }
    img.onerror = () => img.classList.add('hidden');
    img.onload = () => img.classList.remove('hidden');
    img.referrerPolicy = 'no-referrer';
    img.src = url;
}
$('drinkImageUrl').addEventListener('input', () => { clearTimeout(updateImagePreview.t); updateImagePreview.t = setTimeout(updateImagePreview, 400); });

function openDrinkModal(id = null, catIdForNew = null, isStaffNewRecipe = false, staffTargetCategoryId = null) {
    if (!isEdit() && !(isStaffNewRecipe && isStaff())) return;
    const form = $('drinkForm');
    form.reset();
    $('ingredientsContainer').innerHTML = '';
    $('drinkId').value = id || '';
    $('drinkModalTargetCategoryId').value = isStaffNewRecipe ? staffTargetCategoryId : '';
    populateCategorySelectInForms();
    let catId;
    const drink = id ? allDrinks[id] : null;
    if (drink) {
        $('drinkModalTitle').textContent = `„${drink.name}" bearbeiten`;
        $('emptyFieldsToggleContainer').classList.add('hidden');
        $('emptyFieldsToggleContainer').classList.remove('flex');
        $('allowEmptyFieldsToggle').checked = !drink.recipe || !(drink.ingredients || []).length;
        $('drinkName').value = drink.name || '';
        $('drinkType').value = drink.type === 'Mocktail' ? 'Mocktail' : 'Cocktail';
        $('drinkSymbols').value = drink.symbols || '';
        $('drinkImageUrl').value = drink.imageUrl || '';
        $('drinkRecipe').value = drink.recipe || '';
        $('drinkGlass').value = drink.glass || '';
        $('drinkGarnish').value = drink.garnish || '';
        $('drinkNotes').value = drink.notes || '';
        catId = drink.categoryId;
        (drink.ingredients || []).length ? drink.ingredients.forEach((i) => addIngredientField(i.item, i.amount)) : addIngredientField();
        $('drinkCategory').disabled = false;
    } else {
        addIngredientField();
        $('emptyFieldsToggleContainer').classList.remove('hidden');
        $('emptyFieldsToggleContainer').classList.add('flex');
        $('allowEmptyFieldsToggle').checked = false;
        if (isStaffNewRecipe && allCategories[staffTargetCategoryId]) {
            $('drinkModalTitle').textContent = `Neues Rezept für „${allCategories[staffTargetCategoryId].name}"`;
            catId = staffTargetCategoryId;
            $('drinkCategory').disabled = true;
        } else {
            $('drinkModalTitle').textContent = 'Neuen Drink erstellen';
            catId = catIdForNew || selectedCategoryId;
            $('drinkCategory').disabled = false;
        }
    }
    if (catId && allCategories[catId]) $('drinkCategory').value = catId;
    else if (!sortedCategoryEntries().length) return showCustomAlert('Es muss mindestens ein Ordner existieren.');
    toggleRequiredFields($('allowEmptyFieldsToggle').checked);
    updateImagePreview();
    if (ingredientSortable) ingredientSortable.destroy();
    if (typeof Sortable !== 'undefined') ingredientSortable = new Sortable($('ingredientsContainer'), { animation: 150, handle: '.ing-handle', ghostClass: 'sortable-ghost' });
    openModal($('drinkModal'));
    snapshotForm('drinkForm');
}

$('drinkForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = $('drinkId').value;
    const staffTarget = $('drinkModalTargetCategoryId').value;
    const categoryId = staffTarget || $('drinkCategory').value;
    const name = $('drinkName').value.trim();
    const recipe = $('drinkRecipe').value.trim();
    const quick = $('allowEmptyFieldsToggle').checked;
    if (!name || !categoryId) return showCustomAlert('Bitte fülle alle Pflichtfelder aus (Name, Typ, Ordner).');
    if (!allCategories[categoryId]) return showCustomAlert('Ungültiger Ordner ausgewählt.');

    const ingredients = [];
    let invalid = false;
    document.querySelectorAll('#ingredientsContainer .ingredient-field').forEach((f) => {
        const input = f.querySelector('input[name="ingredientSearch"]');
        const amount = f.querySelector('input[name="ingredientAmount"]').value.trim();
        const item = (input.dataset.selectedItem || '').trim();
        if (item && amount) ingredients.push({ item, amount });
        else if (item || amount || input.value.trim()) { invalid = true; f.classList.add('ring-2', 'ring-rose-400', 'rounded-lg'); }
    });
    if (invalid) return showCustomAlert('Bitte wähle jede Zutat aus der Liste und gib eine Menge an – oder entferne die leere Zeile.');
    if (!quick && !recipe) return showCustomAlert('Bitte fülle das Rezept aus.');
    if (!quick && !ingredients.length) return showCustomAlert('Bitte füge mindestens eine Zutat hinzu.');
    const url = $('drinkImageUrl').value.trim();
    if (url && !safeUrl(url)) return showCustomAlert('Die Bild-URL muss mit http:// oder https:// beginnen.');

    const drink = {
        name, categoryId, recipe, ingredients,
        type: $('drinkType').value,
        symbols: $('drinkSymbols').value.trim(),
        imageUrl: url,
        glass: $('drinkGlass').value.trim(),
        garnish: $('drinkGarnish').value.trim(),
        notes: $('drinkNotes').value.trim(),
    };
    const actionMode = staffTarget && isStaff() ? 'staff' : 'edit';
    await withBusy($('drinkSaveBtn'), async () => {
        const res = await act('saveDrink', { id: id || undefined, drink, quick }, { modeOverride: actionMode });
        if (res) {
            closeModal($('drinkModal'), true);
            toast(id ? 'Drink gespeichert.' : `„${name}" angelegt.`, 'success');
        }
    });
});
$('addIngredientBtn').addEventListener('click', () => {
    const f = addIngredientField();
    f.querySelector('input[name="ingredientSearch"]').focus();
});

function ingredientNames() { return Object.values(allIngredients).map((i) => i?.name).filter(Boolean); }

function addIngredientField(item = '', amount = '') {
    const wrap = document.createElement('div');
    wrap.className = 'ingredient-field flex items-start gap-2';
    wrap.innerHTML = `
        <span class="ing-handle drag-handle flex h-[42px] items-center px-1 text-gray-400" aria-hidden="true"><i class="fas fa-grip-vertical"></i></span>
        <div class="relative min-w-0 flex-1">
            <input type="text" name="ingredientSearch" placeholder="Zutat wählen…" autocomplete="off" role="combobox" aria-expanded="false" aria-autocomplete="list" class="input pr-8">
            <button type="button" class="clear-ingredient-btn absolute inset-y-0 right-0 hidden px-2.5 text-gray-400 hover:text-rose-500" aria-label="Auswahl entfernen"><i class="fas fa-times text-xs"></i></button>
            <div class="ingredient-search-results absolute z-20 mt-1 hidden max-h-52 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg dark:border-plum-700 dark:bg-plum-800" role="listbox"></div>
        </div>
        <input type="text" name="ingredientAmount" placeholder="Menge" maxlength="50" class="input w-28 sm:w-32">
        <button type="button" class="remove-ingredient-btn icon-btn text-rose-500" aria-label="Zutat entfernen"><i class="fas fa-minus-circle"></i></button>`;
    $('ingredientsContainer').appendChild(wrap);
    const input = wrap.querySelector('input[name="ingredientSearch"]');
    const results = wrap.querySelector('.ingredient-search-results');
    const clearBtn = wrap.querySelector('.clear-ingredient-btn');
    wrap.querySelector('input[name="ingredientAmount"]').value = amount;
    let activeIdx = -1;

    const select = (name) => {
        input.value = name;
        input.dataset.selectedItem = name;
        input.readOnly = true;
        input.classList.add('bg-gray-100', 'dark:bg-plum-800');
        clearBtn.classList.remove('hidden');
        hide();
        wrap.classList.remove('ring-2', 'ring-rose-400');
        wrap.querySelector('input[name="ingredientAmount"]').focus();
    };
    const hide = () => { results.classList.add('hidden'); input.setAttribute('aria-expanded', 'false'); activeIdx = -1; };
    const render = () => {
        if (input.readOnly) return;
        const q = input.value.trim().toLowerCase();
        results.innerHTML = '';
        activeIdx = -1;
        const names = ingredientNames();
        const starts = names.filter((n) => n.toLowerCase().startsWith(q));
        const contains = q ? names.filter((n) => !n.toLowerCase().startsWith(q) && n.toLowerCase().includes(q)) : [];
        const list = [...starts.sort((a, b) => a.localeCompare(b, 'de')), ...contains.sort((a, b) => a.localeCompare(b, 'de'))].slice(0, 50);
        list.forEach((n) => {
            const d = document.createElement('div');
            d.className = 'ing-opt cursor-pointer px-3 py-2 text-sm hover:bg-indigo-50 dark:hover:bg-plum-700';
            d.setAttribute('role', 'option');
            d.textContent = n;
            d.addEventListener('mousedown', (ev) => { ev.preventDefault(); select(n); });
            results.appendChild(d);
        });
        const exact = names.some((n) => n.toLowerCase() === q);
        if (q && !exact && isEdit()) {
            const d = document.createElement('div');
            d.className = 'ing-opt cursor-pointer border-t border-gray-100 px-3 py-2 text-sm font-semibold text-indigo-600 hover:bg-indigo-50 dark:border-plum-700 dark:text-zest-300 dark:hover:bg-plum-700';
            d.dataset.create = '1';
            d.innerHTML = '<i class="fas fa-plus-circle mr-1"></i> ';
            d.append(`„${input.value.trim()}" als neue Zutat anlegen`);
            d.addEventListener('mousedown', async (ev) => { ev.preventDefault(); await createAndSelect(); });
            results.appendChild(d);
        } else if (!list.length) {
            results.innerHTML = '<div class="px-3 py-2 text-xs text-gray-500">Keine Treffer.</div>';
        }
        results.classList.remove('hidden');
        input.setAttribute('aria-expanded', 'true');
    };
    const createAndSelect = async () => {
        const name = input.value.trim();
        if (!name) return;
        const res = await act('addIngredient', { name }, { modeOverride: 'edit' });
        if (res) { allIngredients[res.id] = { name }; select(name); }
    };
    input.addEventListener('focus', render);
    input.addEventListener('input', render);
    input.addEventListener('keydown', (e) => {
        const opts = [...results.querySelectorAll('.ing-opt')];
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (!opts.length) return;
            activeIdx = (activeIdx + (e.key === 'ArrowDown' ? 1 : -1) + opts.length) % opts.length;
            opts.forEach((o, i) => o.classList.toggle('bg-indigo-100', i === activeIdx));
            opts[activeIdx].scrollIntoView({ block: 'nearest' });
        } else if (e.key === 'Enter') {
            e.preventDefault();
            const o = opts[activeIdx >= 0 ? activeIdx : 0];
            if (!o) return;
            if (o.dataset.create) createAndSelect(); else select(o.textContent);
        } else if (e.key === 'Escape' && !results.classList.contains('hidden')) {
            e.stopPropagation(); hide();
        }
    });
    input.addEventListener('blur', () => setTimeout(() => {
        // Auto-select an exact (case-insensitive) match when the user typed the full name
        if (!input.readOnly) {
            const match = ingredientNames().find((n) => n.toLowerCase() === input.value.trim().toLowerCase());
            if (match) { input.value = match; input.dataset.selectedItem = match; input.readOnly = true; input.classList.add('bg-gray-100', 'dark:bg-plum-800'); clearBtn.classList.remove('hidden'); }
        }
        hide();
    }, 150));
    clearBtn.addEventListener('click', () => {
        input.value = '';
        delete input.dataset.selectedItem;
        input.readOnly = false;
        input.classList.remove('bg-gray-100', 'dark:bg-plum-800');
        clearBtn.classList.add('hidden');
        input.focus();
    });
    wrap.querySelector('.remove-ingredient-btn').addEventListener('click', () => wrap.remove());
    if (item) {
        input.value = item;
        input.dataset.selectedItem = item;
        input.readOnly = true;
        input.classList.add('bg-gray-100', 'dark:bg-plum-800');
        clearBtn.classList.remove('hidden');
    }
    return wrap;
}

// ============================================================================
// Drink actions: delete (with undo), duplicate, clone, quick confirm, purge
// ============================================================================
async function handleDeleteDrink(id) {
    const d = allDrinks[id];
    if (!d) return;
    const ok = await showConfirm(`„${d.name}" wird gelöscht.`, { title: 'Drink löschen?', confirmLabel: 'Löschen' });
    if (!ok) return;
    const usedMode = mode;
    const snapshot = JSON.parse(JSON.stringify(d));
    const res = await act('deleteDrink', { id }, { modeOverride: usedMode });
    if (res) {
        toast(`„${d.name}" gelöscht.`, 'success', {
            action: {
                label: 'Rückgängig',
                onClick: async () => {
                    const r = await act('restoreDrink', { id, drink: snapshot }, { modeOverride: usedMode });
                    if (r) toast(`„${snapshot.name}" wiederhergestellt.`, 'success');
                },
            },
        });
    }
}

async function duplicateDrink(id) {
    const d = allDrinks[id];
    if (!d) return;
    const res = await act('cloneDrink', { sourceId: id, targetCategoryId: d.categoryId }, { modeOverride: 'edit' });
    if (res) toast(`„${d.name}" dupliziert.`, 'success', { action: { label: 'Bearbeiten', onClick: async () => { await refreshState(); if (allDrinks[res.id]) openDrinkModal(res.id); } } });
}

function openAddExistingDrinkModal(targetCatId) {
    if (!targetCatId || !allCategories[targetCatId]) return showCustomAlert('Bitte wähle zuerst einen Ordner aus.');
    $('addExistingDrinkTargetCategoryId').value = targetCatId;
    $('addExistingTitle').textContent = isEdit() ? `Drink nach „${allCategories[targetCatId].name}" klonen` : `Drink zu „${allCategories[targetCatId].name}" hinzufügen`;
    populateCategorySelectInForms();
    $('sourceDrinkSearch').value = '';
    renderSourceDrinksList();
    openModal($('addExistingDrinkModal'));
}
$('sourceCategorySelect').addEventListener('change', (e) => { lastSelectedSourceCategoryId = e.target.value; renderSourceDrinksList(); });
$('sourceDrinkSearch').addEventListener('input', renderSourceDrinksList);

function renderSourceDrinksList() {
    const box = $('sourceDrinksListContainer');
    const srcId = $('sourceCategorySelect').value;
    const targetId = $('addExistingDrinkTargetCategoryId').value;
    const term = $('sourceDrinkSearch').value.trim().toLowerCase();
    box.innerHTML = '';
    if (!srcId && !term) { box.innerHTML = '<p class="py-6 text-center text-sm text-gray-500 dark:text-gray-400">Wähle einen Ordner oder suche direkt nach einem Drink.</p>'; return; }
    const targetNames = new Set(Object.values(allDrinks).filter((d) => d.categoryId === targetId).map((d) => d.name.toLowerCase()));
    const list = Object.entries(allDrinks)
        .filter(([, d]) => (srcId ? d.categoryId === srcId : allCategories[d.categoryId]) && (!term || drinkMatchesSearch(d, [term])))
        .sort(([, a], [, b]) => a.name.localeCompare(b.name, 'de'))
        .slice(0, 200);
    if (!list.length) { box.innerHTML = '<p class="py-6 text-center text-sm text-gray-500 dark:text-gray-400">Keine passenden Drinks gefunden.</p>'; return; }
    list.forEach(([drinkId, d]) => {
        const exists = targetNames.has(d.name.toLowerCase());
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'flex w-full items-center gap-3 rounded-xl bg-gray-50 p-3 text-left transition-colors hover:bg-indigo-50 dark:bg-plum-800/60 dark:hover:bg-plum-700';
        row.innerHTML = `
            <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-2"><span class="font-semibold text-gray-900 dark:text-white">${esc(d.name)}</span>${typePill(d.type)}${!srcId ? `<span class="chip bg-indigo-50 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-200">${esc(allCategories[d.categoryId]?.name || '')}</span>` : ''}${exists ? '<span class="chip bg-zest-300/30 text-amber-800 dark:text-zest-300">schon im Ordner</span>' : ''}</div>
                <p class="truncate text-xs text-gray-500 dark:text-gray-400">${esc((d.ingredients || []).map((i) => i.item).join(', '))}</p>
            </div>
            <i class="fas fa-plus text-indigo-500"></i>`;
        row.addEventListener('click', () => withBusy(row, async () => {
            if (!allCategories[targetId]) return showCustomAlert('Zielordner ist ungültig.');
            const res = await act('cloneDrink', { sourceId: drinkId, targetCategoryId: targetId });
            if (res) { toast(`„${d.name}" zu „${allCategories[targetId]?.name}" hinzugefügt.`, 'success'); closeModal($('addExistingDrinkModal'), true); }
        }));
        box.appendChild(row);
    });
}

async function handleQuickConfirmDrink(drinkId) {
    const d = allDrinks[drinkId];
    if (!d) return showCustomAlert('Drink nicht gefunden.');
    const target = quickConfirmTarget(d);
    if (!target) return showCustomAlert('Der Zielordner für die Schnellbestätigung ist nicht (mehr) gültig.');
    const ok = await showConfirm(`„${d.name}" nach „${allCategories[target].name}" kopieren?`, { title: 'Schnellbestätigung', confirmLabel: 'Bestätigen', danger: false });
    if (!ok) return;
    const res = await act('quickConfirm', { drinkId }, { modeOverride: 'staff' });
    if (res) {
        toast(`„${d.name}" nach „${res.targetName}" kopiert.`, 'success');
        closeModal($('recipePopupModal'), true);
    }
}

$('staffPurgeCategoryBtn').addEventListener('click', async () => {
    const cat = allCategories[selectedCategoryId];
    if (!isStaff() || !cat) return;
    if (!cat.staffSettings?.darfOrdnerLeeren) return showCustomAlert('Diese Aktion ist für diesen Ordner nicht erlaubt.');
    const n = Object.values(allDrinks).filter((d) => d.categoryId === selectedCategoryId).length;
    if (!n) return toast(`„${cat.name}" ist bereits leer.`, 'info');
    const ok = await showConfirm(`Alle ${n} Drinks in „${cat.name}" werden endgültig gelöscht.`, { title: 'Ordner leeren?', confirmLabel: 'Alle löschen', typeToConfirm: cat.name });
    if (!ok) return;
    const res = await act('purgeCategory', { id: selectedCategoryId }, { modeOverride: 'staff' });
    if (res) toast(`${res.removed} Drink(s) aus „${cat.name}" gelöscht.`, 'success');
});

// ============================================================================
// Ingredient editor
// ============================================================================
$('manageIngredientsBtn').addEventListener('click', () => {
    closeModal($('settingsModal'));
    $('ingredientFilterInput').value = '';
    renderIngredientEditor();
    openModal($('ingredientEditorModal'));
});
$('ingredientFilterInput').addEventListener('input', renderIngredientEditor);

function ingredientUsage() {
    const u = {};
    for (const d of Object.values(allDrinks)) for (const i of d.ingredients || []) if (i?.item) u[i.item] = (u[i.item] || 0) + 1;
    return u;
}

function renderIngredientEditor() {
    const box = $('ingredientListContainer');
    const q = $('ingredientFilterInput').value.trim().toLowerCase();
    const usage = ingredientUsage();
    const list = Object.entries(allIngredients).filter(([, i]) => i?.name && (!q || i.name.toLowerCase().includes(q))).sort(([, a], [, b]) => a.name.localeCompare(b.name, 'de'));
    box.innerHTML = '';
    if (!list.length) { box.innerHTML = `<p class="py-6 text-center text-sm text-gray-500 dark:text-gray-400">${q ? 'Keine Treffer.' : 'Noch keine Zutaten angelegt.'}</p>`; return; }
    box.classList.add('space-y-2');
    list.forEach(([id, ing]) => {
        const row = document.createElement('div');
        row.className = 'flex items-center gap-2';
        row.dataset.id = id;
        const n = usage[ing.name] || 0;
        row.innerHTML = `
            <input type="text" maxlength="100" class="ingredient-name-input input py-2" aria-label="Zutatenname">
            <span class="w-16 flex-shrink-0 text-center text-xs text-gray-500 dark:text-gray-400" title="Verwendet in ${n} Drink(s)">${n}× <i class="fas fa-martini-glass"></i></span>
            <button class="delete-ingredient-btn icon-btn text-rose-500" aria-label="Zutat löschen"><i class="fas fa-trash"></i></button>`;
        row.querySelector('input').value = ing.name;
        box.appendChild(row);
    });
}

$('addIngredientForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('newIngredientName').value.trim();
    if (!name) return;
    if (ingredientNames().some((n) => n.toLowerCase() === name.toLowerCase())) return toast(`Die Zutat „${name}" existiert bereits.`, 'error');
    const res = await act('addIngredient', { name }, { modeOverride: 'edit' });
    if (res) { $('newIngredientName').value = ''; toast(`„${name}" hinzugefügt.`, 'success'); }
});

$('ingredientListContainer').addEventListener('click', async (e) => {
    const btn = e.target.closest('.delete-ingredient-btn');
    if (!btn) return;
    const id = btn.closest('[data-id]').dataset.id;
    const name = allIngredients[id]?.name || 'diese Zutat';
    const n = ingredientUsage()[name] || 0;
    const ok = await showConfirm(n ? `„${name}" wird in ${n} Drink(s) verwendet. Die Drinks behalten die Zutat, sie ist aber nicht mehr auswählbar.` : `„${name}" wird gelöscht.`, { title: 'Zutat löschen?', confirmLabel: 'Löschen' });
    if (ok && await act('deleteIngredient', { id }, { modeOverride: 'edit' })) toast(`„${name}" gelöscht.`, 'success');
});

$('ingredientListContainer').addEventListener('change', async (e) => {
    const input = e.target.closest('.ingredient-name-input');
    if (!input) return;
    const id = input.closest('[data-id]').dataset.id;
    const old = allIngredients[id]?.name;
    const name = input.value.trim();
    if (!name) { toast('Der Zutatenname darf nicht leer sein.', 'error'); input.value = old; return; }
    if (name === old) return;
    const n = ingredientUsage()[old] || 0;
    let propagate = false;
    if (n) propagate = await showConfirm(`„${old}" wird in ${n} Drink(s) verwendet. Soll der neue Name dort ebenfalls übernommen werden?`, { title: 'Umbenennen', confirmLabel: 'Überall umbenennen', danger: false });
    const res = await act('renameIngredient', { id, name, propagate }, { modeOverride: 'edit' });
    if (!res) input.value = old;
    else toast(res.changedDrinks ? `Umbenannt, ${res.changedDrinks} Drink(s) aktualisiert.` : 'Zutat umbenannt.', 'success');
});

// ============================================================================
// Profile
// ============================================================================
const PERM_LABELS = {
    editMode: 'Bearbeitungsmodus', staffMode: 'Personal Modus', manageUsers: 'Benutzer verwalten',
    disableUsers: 'Benutzer sperren', deleteUsers: 'Benutzer löschen', admin: 'Administrator',
};

function openProfile() {
    if (!me) return;
    $('profileEmail').textContent = me.email;
    $('profileRole').innerHTML = roleChip(me.role);
    $('profileName').value = me.displayName || '';
    const granted = Object.keys(PERM_LABELS).filter((k) => me.permissions[k]);
    $('profilePerms').innerHTML = granted.length
        ? granted.map((k) => `<span class="chip bg-gray-100 text-gray-700 dark:bg-plum-800 dark:text-gray-200"><i class="fas fa-check text-emerald-500"></i>${PERM_LABELS[k]}</span>`).join('')
        : '<span class="hint">Nur Ansicht – keine besonderen Rechte.</span>';
    $('profileVerifyRow').classList.toggle('hidden', !!me.emailVerified);
    $('passwordForm').reset();
    openModal($('profileModal'));
}
$('profileVerifyBtn').addEventListener('click', () => resendVerification($('profileVerifyBtn')));
$('profileLogoutBtn').addEventListener('click', () => logout());

$('profileNameForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const displayName = $('profileName').value.trim();
    if (!displayName) return toast('Der Name darf nicht leer sein.', 'error');
    await withBusy(e.submitter, async () => {
        try {
            await api('/api/me', { method: 'POST', body: { action: 'updateProfile', displayName } });
            me.displayName = displayName;
            updateUserUI();
            toast('Name gespeichert.', 'success');
        } catch (err) { toast(err.message, 'error'); }
    });
});

$('passwordForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const cur = $('pwCurrent').value;
    const nw = $('pwNew').value;
    if (!cur) return toast('Bitte aktuelles Passwort eingeben.', 'error');
    if (nw.length < 8) return toast('Das neue Passwort muss mindestens 8 Zeichen lang sein.', 'error');
    if (nw !== $('pwNew2').value) return toast('Die neuen Passwörter stimmen nicht überein.', 'error');
    await withBusy(e.submitter, async () => {
        try {
            const user = auth.currentUser;
            await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, cur));
            await updatePassword(user, nw);
            $('passwordForm').reset();
            toast('Passwort geändert.', 'success');
        } catch (err) { toast(authErrorMessage(err), 'error'); }
    });
});

// ============================================================================
// User management panel
// ============================================================================
let adminData = null;   // { users, roles, settings, stats }
let activeTab = 'users';

const myRoleIndex = () => me?.role?.index ?? 0;
const roleById = (id) => adminData?.roles.find((r) => r.id === id) || adminData?.roles.find((r) => r.id === 'default');
const roleIsAdmin = (r) => !!r?.permissions?.admin;
function canActOn(u) {
    if (!me || u.uid === me.uid) return false;
    if (perm('admin')) return true;
    if (!u.hasProfile) return false;
    const r = roleById(u.roleId);
    return !roleIsAdmin(r) && (r?.index ?? 0) < myRoleIndex();
}
function assignableRoles() {
    if (!adminData) return [];
    if (perm('admin')) return adminData.roles;
    return adminData.roles.filter((r) => !roleIsAdmin(r) && r.index < myRoleIndex());
}

async function openUsersPanel() {
    if (!(perm('admin') || perm('manageUsers') || perm('disableUsers') || perm('deleteUsers'))) return;
    document.querySelector('[data-tab="audit"]').classList.toggle('hidden', !perm('admin'));
    document.querySelector('[data-tab="data"]').classList.toggle('hidden', !(perm('admin') || perm('editMode')));
    $('importBox').classList.toggle('hidden', !perm('admin'));
    $('createUserBtn').classList.toggle('hidden', !perm('manageUsers'));
    $('createRoleBtn').classList.toggle('hidden', !perm('admin'));
    openModal($('usersModal'));
    switchTab(activeTab);
    await loadAdminData();
}

async function loadAdminData() {
    $('usersList').innerHTML = '<p class="py-8 text-center text-gray-500"><i class="fas fa-circle-notch fa-spin mr-2"></i>Lade Benutzer…</p>';
    try {
        adminData = await api('/api/admin/overview');
        renderAdmin();
    } catch (e) {
        $('usersList').innerHTML = `<p class="py-8 text-center text-rose-600">${esc(e.message)}</p>`;
    }
}
$('usersRefreshBtn').addEventListener('click', () => { loadAdminData(); if (activeTab === 'audit') loadAudit(); });

function switchTab(tab) {
    activeTab = tab;
    document.querySelectorAll('#usersModal .tab-btn').forEach((b) => { b.classList.toggle('is-active', b.dataset.tab === tab); b.setAttribute('aria-selected', String(b.dataset.tab === tab)); });
    document.querySelectorAll('[data-tab-panel]').forEach((p) => p.classList.toggle('hidden', p.dataset.tabPanel !== tab));
    if (tab === 'audit') loadAudit();
}
document.querySelectorAll('#usersModal .tab-btn').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));

function renderAdmin() {
    if (!adminData) return;
    // role filter
    const rf = $('userRoleFilter');
    const keep = rf.value;
    rf.innerHTML = '<option value="">Alle Rollen</option><option value="__none">Ohne Profil</option><option value="__disabled">Gesperrt</option>';
    adminData.roles.forEach((r) => rf.add(new Option(r.name, r.id)));
    rf.value = keep || '';
    renderUsersList();
    renderRolesList();
    // settings
    $('setRegistration').checked = !!adminData.settings.registrationEnabled;
    $('setRegistration').disabled = !perm('manageUsers');
    $('setVerification').checked = !!adminData.settings.requireEmailVerification;
    $('setVerification').disabled = !perm('admin');
    const s = adminData.stats || {};
    $('statsGrid').innerHTML = [['Benutzer', s.users, 'fa-users'], ['Ordner', s.categories, 'fa-folder'], ['Drinks', s.drinks, 'fa-martini-glass-citrus'], ['Zutaten', s.ingredients, 'fa-lemon']]
        .map(([l, v, i]) => `<div class="rounded-xl bg-gray-50 p-4 dark:bg-plum-800/60"><i class="fas ${i} text-indigo-500"></i><p class="mt-2 font-display text-2xl font-bold">${Number(v) || 0}</p><p class="hint">${l}</p></div>`).join('');
}
$('userSearchInput').addEventListener('input', renderUsersList);
$('userRoleFilter').addEventListener('change', renderUsersList);

function renderUsersList() {
    const box = $('usersList');
    if (!adminData) return;
    const q = $('userSearchInput').value.trim().toLowerCase();
    const rf = $('userRoleFilter').value;
    const users = adminData.users.filter((u) => {
        if (q && !`${u.displayName} ${u.email}`.toLowerCase().includes(q)) return false;
        if (rf === '__none') return !u.hasProfile;
        if (rf === '__disabled') return u.disabled || u.authDisabled;
        if (rf) return u.hasProfile && u.roleId === rf;
        return true;
    });
    box.innerHTML = users.length ? '' : '<p class="py-8 text-center text-sm text-gray-500">Keine Benutzer gefunden.</p>';
    const assignable = assignableRoles();
    users.forEach((u) => {
        const role = u.hasProfile ? roleById(u.roleId) : null;
        const actOk = canActOn(u);
        const disabled = u.disabled || u.authDisabled;
        const row = document.createElement('div');
        row.className = `flex flex-col gap-3 rounded-xl border border-gray-100 p-3 dark:border-plum-800 sm:flex-row sm:items-center ${disabled ? 'opacity-70' : ''}`;
        const badges = [
            u.uid === me.uid ? '<span class="chip bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-200">Du</span>' : '',
            role ? roleChip(role) : '<span class="chip bg-gray-100 text-gray-600 dark:bg-plum-800 dark:text-gray-300">Ohne Profil</span>',
            disabled ? '<span class="chip bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-200"><i class="fas fa-ban"></i>Gesperrt</span>' : '',
            u.emailVerified === false ? '<span class="chip bg-zest-300/30 text-amber-800 dark:text-zest-300" title="E-Mail nicht bestätigt"><i class="fas fa-envelope"></i>unbestätigt</span>' : '',
        ].join('');
        row.innerHTML = `
            <div class="flex min-w-0 flex-1 items-center gap-3">
                <span class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-sm font-bold text-white" style="background:${safeColor(role?.color || '#64748b')}">${esc(initials(u.displayName || u.email))}</span>
                <div class="min-w-0">
                    <p class="truncate font-semibold">${esc(u.displayName || '—')}</p>
                    <p class="truncate text-xs text-gray-500 dark:text-gray-400 selectable">${esc(u.email)}</p>
                    <div class="mt-1 flex flex-wrap gap-1">${badges}</div>
                    <p class="hint mt-1">Zuletzt aktiv: ${esc(relTime(u.lastSeen || u.lastLoginAt))}</p>
                </div>
            </div>
            <div class="flex flex-wrap items-center gap-2"></div>`;
        const ctr = row.lastElementChild;
        if (actOk && perm('manageUsers')) {
            const sel = document.createElement('select');
            sel.className = 'input w-auto py-1.5 text-xs';
            sel.setAttribute('aria-label', `Rolle von ${u.displayName || u.email}`);
            if (!u.hasProfile) sel.add(new Option('– Freischalten als –', ''));
            assignable.forEach((r) => sel.add(new Option(r.name, r.id)));
            if (u.hasProfile && !assignable.some((r) => r.id === u.roleId)) sel.add(new Option(role?.name || '?', u.roleId));
            sel.value = u.hasProfile ? u.roleId : '';
            sel.addEventListener('change', () => changeUserRole(u, sel.value, sel));
            ctr.appendChild(sel);
        }
        if (actOk && perm('disableUsers') && (u.hasProfile || perm('admin'))) {
            const b = document.createElement('button');
            b.className = `btn btn-sm ${disabled ? 'btn-success' : 'btn-secondary'}`;
            b.innerHTML = disabled ? '<i class="fas fa-lock-open"></i> Entsperren' : '<i class="fas fa-ban"></i> Sperren';
            b.addEventListener('click', () => toggleUserDisabled(u, !disabled, b));
            ctr.appendChild(b);
        }
        if (actOk && perm('deleteUsers') && (u.hasProfile || perm('admin'))) {
            const b = document.createElement('button');
            b.className = 'btn btn-sm btn-ghost text-rose-600 dark:text-rose-400';
            b.setAttribute('aria-label', 'Benutzer löschen');
            b.innerHTML = '<i class="fas fa-trash"></i>';
            b.addEventListener('click', () => deleteUser(u));
            ctr.appendChild(b);
        }
        if (!ctr.children.length && u.uid !== me.uid) ctr.innerHTML = '<span class="hint"><i class="fas fa-lock mr-1"></i>Keine Rechte</span>';
        box.appendChild(row);
    });
}

async function adminAct(body, btn) {
    return withBusy(btn, async () => {
        try {
            const r = await api('/api/admin/action', { method: 'POST', body });
            await loadAdminData();
            refreshState();
            return r;
        } catch (e) { toast(e.message, 'error'); renderAdmin(); return null; }
    });
}

async function changeUserRole(u, roleId, sel) {
    if (!roleId) return;
    const r = roleById(roleId);
    if (roleIsAdmin(r)) {
        const ok = await showConfirm(`${u.displayName || u.email} erhält volle Administratorrechte.`, { title: 'Administrator ernennen?', confirmLabel: 'Ernennen' });
        if (!ok) return renderUsersList();
    }
    if (await adminAct({ action: 'setUserRole', uid: u.uid, roleId }, sel)) toast(`Rolle geändert: ${r?.name}`, 'success');
}
async function toggleUserDisabled(u, disabled, btn) {
    if (disabled && !(await showConfirm(`${u.displayName || u.email} kann sich danach nicht mehr anmelden.`, { title: 'Benutzer sperren?', confirmLabel: 'Sperren' }))) return;
    if (await adminAct({ action: 'setUserDisabled', uid: u.uid, disabled }, btn)) toast(disabled ? 'Benutzer gesperrt.' : 'Benutzer entsperrt.', 'success');
}
async function deleteUser(u) {
    const ok = await showConfirm(`Das Konto von ${u.email} wird endgültig gelöscht. Von dieser Person angelegte Drinks bleiben erhalten.`, { title: 'Benutzer löschen?', confirmLabel: 'Endgültig löschen', typeToConfirm: 'LÖSCHEN' });
    if (ok && await adminAct({ action: 'deleteUser', uid: u.uid })) toast('Benutzer gelöscht.', 'success');
}

// ----- create user -----
$('createUserBtn').addEventListener('click', () => {
    $('createUserForm').reset();
    const sel = $('cuRole');
    sel.innerHTML = '';
    assignableRoles().slice().sort((a, b) => a.index - b.index).forEach((r) => sel.add(new Option(r.name, r.id)));
    sel.value = 'default';
    if (!sel.value && sel.options.length) sel.selectedIndex = 0;
    openModal($('createUserModal'));
});
$('createUserForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const displayName = $('cuName').value.trim();
    const email = $('cuEmail').value.trim();
    if (!displayName || !email) return toast('Bitte Name und E-Mail angeben.', 'error');
    const r = await adminAct({ action: 'createUser', displayName, email, roleId: $('cuRole').value }, e.submitter);
    if (r) {
        closeModal($('createUserModal'), true);
        try { await sendPasswordResetEmail(auth, email); toast(`Konto angelegt. Einladung an ${email} gesendet.`, 'success'); }
        catch { toast('Konto angelegt, aber die Einladungs-E-Mail konnte nicht gesendet werden. Die Person kann „Passwort vergessen" nutzen.', 'info'); }
    }
});

// ----- roles -----
function renderRolesList() {
    const box = $('rolesList');
    const counts = {};
    adminData.users.forEach((u) => { if (u.hasProfile) counts[u.roleId] = (counts[u.roleId] || 0) + 1; });
    const nonDefault = adminData.roles.filter((r) => r.id !== 'default').length;
    $('createRoleBtn').disabled = nonDefault >= 10;
    $('createRoleBtn').title = nonDefault >= 10 ? 'Maximal 10 Rollen' : '';
    box.innerHTML = '';
    adminData.roles.slice().sort((a, b) => b.index - a.index).forEach((r) => {
        const row = document.createElement('div');
        row.className = 'flex flex-col gap-2 rounded-xl border border-gray-100 p-3 dark:border-plum-800 sm:flex-row sm:items-center';
        const perms = Object.keys(PERM_LABELS).filter((k) => r.permissions[k]);
        row.innerHTML = `
            <div class="flex w-14 flex-shrink-0 flex-col items-center"><span class="font-display text-2xl font-bold" style="color:${safeColor(r.color)}">${r.index}</span><span class="hint">Index</span></div>
            <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-2">${roleChip(r)}${r.id === 'default' ? '<span class="hint">Standardrolle für neue Konten</span>' : ''}<span class="hint">${counts[r.id] || 0} Benutzer</span></div>
                <div class="mt-1.5 flex flex-wrap gap-1">${perms.length ? perms.map((k) => `<span class="chip ${k === 'admin' ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-200' : 'bg-gray-100 text-gray-700 dark:bg-plum-800 dark:text-gray-200'}">${PERM_LABELS[k]}</span>`).join('') : '<span class="hint">Nur Ansicht</span>'}</div>
            </div>`;
        if (perm('admin')) {
            const b = document.createElement('button');
            b.className = 'btn btn-sm btn-secondary self-start sm:self-center';
            b.innerHTML = '<i class="fas fa-pen"></i> Bearbeiten';
            b.addEventListener('click', () => openRoleModal(r));
            row.appendChild(b);
        }
        box.appendChild(row);
    });
}
$('createRoleBtn').addEventListener('click', () => openRoleModal(null));

function openRoleModal(role) {
    $('roleForm').reset();
    $('roleId').value = role?.id || '';
    $('roleModalTitle').textContent = role ? 'Rolle bearbeiten' : 'Neue Rolle';
    $('roleName').value = role?.name || '';
    $('roleColor').value = safeColor(role?.color || '#6366f1');
    const isDefault = role?.id === 'default';
    $('roleIndexWrap').classList.toggle('hidden', isDefault);
    const used = new Set(adminData.roles.filter((r) => r.id !== 'default' && r.id !== role?.id).map((r) => r.index));
    const sel = $('roleIndex');
    sel.innerHTML = '';
    for (let i = 10; i >= 1; i--) { const o = new Option(`${i}${used.has(i) ? ' (vergeben)' : ''}`, String(i)); o.disabled = used.has(i); sel.add(o); }
    const firstFree = [...sel.options].find((o) => !o.disabled);
    sel.value = role && !isDefault ? String(role.index) : (firstFree?.value || '');
    document.querySelectorAll('#roleForm [data-perm]').forEach((c) => { c.checked = !!role?.permissions?.[c.dataset.perm]; });
    $('rolePermAdminRow').classList.toggle('hidden', isDefault);
    $('roleDefaultHint').classList.toggle('hidden', !isDefault);
    $('roleDeleteBtn').classList.toggle('hidden', !role || isDefault);
    openModal($('roleModal'));
}
$('roleForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = $('roleId').value || undefined;
    const permissions = {};
    document.querySelectorAll('#roleForm [data-perm]').forEach((c) => { permissions[c.dataset.perm] = c.checked; });
    if (id === 'default') permissions.admin = false;
    const body = { action: 'saveRole', id, name: $('roleName').value.trim(), color: $('roleColor').value, index: Number($('roleIndex').value), permissions };
    if (!body.name) return toast('Bitte einen Namen angeben.', 'error');
    if (await adminAct(body, e.submitter)) { closeModal($('roleModal'), true); toast('Rolle gespeichert.', 'success'); }
});
$('roleDeleteBtn').addEventListener('click', async () => {
    const id = $('roleId').value;
    const r = roleById(id);
    const n = adminData.users.filter((u) => u.hasProfile && u.roleId === id).length;
    const ok = await showConfirm(n ? `${n} Benutzer mit der Rolle „${r?.name}" erhalten danach die Standardrolle.` : `Die Rolle „${r?.name}" wird gelöscht.`, { title: 'Rolle löschen?', confirmLabel: 'Löschen' });
    if (ok && await adminAct({ action: 'deleteRole', id })) { closeModal($('roleModal'), true); toast('Rolle gelöscht.', 'success'); }
});

// ----- settings -----
$('setRegistration').addEventListener('change', async (e) => {
    if (!(await adminAct({ action: 'updateSettings', registrationEnabled: e.target.checked }))) return;
    toast(e.target.checked ? 'Registrierung erlaubt.' : 'Registrierung deaktiviert.', 'success');
});
$('setVerification').addEventListener('change', async (e) => {
    if (!(await adminAct({ action: 'updateSettings', requireEmailVerification: e.target.checked }))) return;
    toast(e.target.checked ? 'E-Mail-Bestätigung ist jetzt Pflicht.' : 'E-Mail-Bestätigung ist optional.', 'success');
});

// ----- audit -----
const AUDIT_LABELS = {
    register: 'Registriert', bootstrap_admin: 'Erster Admin', set_role: 'Rolle geändert', disable_user: 'Gesperrt', enable_user: 'Entsperrt',
    delete_user: 'Benutzer gelöscht', create_user: 'Benutzer angelegt', update_settings: 'Einstellungen', create_role: 'Rolle erstellt',
    update_role: 'Rolle geändert', delete_role: 'Rolle gelöscht', create_folder: 'Ordner erstellt', rename_folder: 'Ordner umbenannt',
    delete_folder: 'Ordner gelöscht', delete_drink: 'Drink gelöscht', restore_drink: 'Drink wiederhergestellt', purge_folder: 'Ordner geleert',
    delete_ingredient: 'Zutat gelöscht', export: 'Export', import: 'Import',
};
async function loadAudit() {
    const box = $('auditList');
    box.innerHTML = '<p class="py-8 text-center text-gray-500"><i class="fas fa-circle-notch fa-spin"></i></p>';
    try {
        const { entries } = await api('/api/admin/audit');
        box.innerHTML = entries.length ? '' : '<p class="py-8 text-center text-sm text-gray-500">Noch keine Einträge.</p>';
        entries.forEach((en) => {
            const row = document.createElement('div');
            row.className = 'flex flex-col gap-0.5 rounded-lg px-3 py-2 odd:bg-gray-50 dark:odd:bg-plum-800/40 sm:flex-row sm:items-baseline sm:gap-3';
            row.innerHTML = `<span class="w-36 flex-shrink-0 text-xs tabular-nums text-gray-500">${esc(fmtDate(en.ts))}</span>
                <span class="w-40 flex-shrink-0 text-sm font-semibold">${esc(AUDIT_LABELS[en.action] || en.action)}</span>
                <span class="min-w-0 flex-1 text-sm text-gray-600 dark:text-gray-300 selectable">${esc(en.details)}</span>
                <span class="text-xs text-gray-500">${esc(en.name || '')}</span>`;
            box.appendChild(row);
        });
    } catch (e) { box.innerHTML = `<p class="py-8 text-center text-rose-600">${esc(e.message)}</p>`; }
}

// ----- export / import -----
$('exportBtn').addEventListener('click', (e) => withBusy(e.currentTarget, async () => {
    try {
        const data = await api('/api/export');
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `bar-organizer-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
        toast('Sicherung heruntergeladen.', 'success');
    } catch (err) { toast(err.message, 'error'); }
}));
$('importFile').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 7_500_000) return toast('Die Datei ist zu groß.', 'error');
    let payload;
    try { payload = JSON.parse(await file.text()); } catch { return toast('Die Datei ist kein gültiges JSON.', 'error'); }
    const n = Object.keys(payload?.drinks || {}).length;
    if (!(await showConfirm(`Die Datei enthält ${n} Drinks. Nur neue Einträge werden hinzugefügt – nichts wird überschrieben.`, { title: 'Import starten?', confirmLabel: 'Importieren', danger: false }))) return;
    try {
        const r = await api('/api/import', { method: 'POST', body: { categories: payload.categories, drinks: payload.drinks, ingredients: payload.ingredients } });
        showCustomAlert(`Import abgeschlossen: ${r.categories} Ordner, ${r.drinks} Drinks und ${r.ingredients} Zutaten hinzugefügt, ${r.skipped} übersprungen (bereits vorhanden oder ungültig).`);
        refreshState();
        loadAdminData();
    } catch (err) { toast(err.message, 'error'); }
});

// ============================================================================
// Keyboard shortcuts
// ============================================================================
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        if (!$('userMenu').classList.contains('hidden')) return closeAllMenus();
        const top = modalStack[modalStack.length - 1];
        if (top) {
            if (top.id === 'confirmModal') resolveConfirm(false);
            else closeModal(top);
            return;
        }
        if (isMobile() && !sidebar.classList.contains('-translate-x-full')) setSidebar(false);
        return;
    }
    const typing = e.target.closest('input, textarea, select, [contenteditable]');
    if (typing || e.metaKey || e.ctrlKey || e.altKey || modalStack.length || $('appShell').classList.contains('hidden')) return;
    if (e.key === '/') {
        e.preventDefault();
        (isMobile() ? $('searchInputMobile') : $('searchInput')).focus();
    } else if ((e.key === 'n' || e.key === 'N') && isEdit()) {
        e.preventDefault();
        $('addDrinkButton').click();
    }
});
