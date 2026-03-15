// ============================================================
// INSAN — app.js  (v32 — all 15 bugs fixed + instant dashboard for logged-in users)
// ============================================================

/* ==================== STATE ==================== */
const App = {
  session: null, currentUser: null, currentProfile: null,
  activeChatId: null, activePeerId: null,
  activeConvType: 'chat',   // 'chat' | 'channel' | 'group'
  activeConvData: null,     // current channel/group/peer object
  activeConvRole: null,     // 'admin' | 'member' | null
  activeTab: 'chats',
  isDark: localStorage.getItem('insan_theme') === 'dark',
  typingTimer: null, typingChannel: null,
  chatListSubs: [], chatScreenSubs: [],
  presenceCh: null,
  chats: [], messages: [],
  onlineUsers: new Set(), typingTimers: {}, unread: {},
  subscribedListIds: new Set(),
  ccMembers: [],    // create-channel modal
  cgMembers: [],    // create-group modal
  amMembers: [],    // add-members modal
  _memberCache: {}, // id -> profile (prevents &URLs in onclick attrs)
  _activePeerStatus: null, // { peerId, type } — tracks whose online status to update in chat header
  _listRefreshTimer: null,  // debounce timer for refreshChatListUI
  _lastLoadMs: { chats: 0, channels: 0, groups: 0 }, // throttle full reloads
};

/* ==================== UTILS ==================== */
const $ = id => document.getElementById(id);

function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function avatarSrc(p) {
  if (p && p.avatar_url) return p.avatar_url;
  const letter = encodeURIComponent(((p && (p.username || p.name || p.email)) || '?')[0].toUpperCase());
  var params = 'name=' + letter + '&background=2ECC71&color=fff&size=128&bold=true&rounded=true';
  return 'https://ui-avatars.com/api/?' + params;
}

function fmtTime(ts) {
  if (!ts) return '';
  const d = new Date(ts), now = new Date();
  const diff = Math.floor((now - d) / 86400000);
  if (diff === 0) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (diff === 1) return I18n.t('yesterday');
  if (diff < 7)  return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function fmtDateLabel(ts) {
  const d = new Date(ts), now = new Date();
  if (d.toDateString() === now.toDateString()) return I18n.t('today');
  const y = new Date(now); y.setDate(y.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return I18n.t('yesterday');
  return d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
}

function showToast(msg, type = 'success') {
  const c = $('toast-container'); if (!c) return;
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.textContent = msg;
  c.appendChild(t);
  requestAnimationFrame(() => requestAnimationFrame(() => t.classList.add('show')));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 320); }, 3600);
}

function setTheme(dark) {
  App.isDark = dark;
  document.documentElement.classList.toggle('dark', dark);
  localStorage.setItem('insan_theme', dark ? 'dark' : 'light');
  // Sync sidebar icon: show sun in dark mode (to switch back to light), moon in light mode
  var moon = $('sb-theme-icon-moon'), sun = $('sb-theme-icon-sun');
  if (moon) moon.style.display = dark ? 'none' : '';
  if (sun)  sun.style.display  = dark ? ''     : 'none';
  if (typeof updateThemeRadios === 'function') updateThemeRadios();
}

/* ==================== SETTINGS ==================== */

var APP_VERSION = '1.1.0';

// ── Top-level credential guard (runs before any Supabase call) ──
window._supabaseNotConfigured = (
  !window.SUPABASE_URL ||
  window.SUPABASE_URL.includes('YOUR_') ||
  !window.SUPABASE_ANON_KEY ||
  window.SUPABASE_ANON_KEY.includes('YOUR_')
);
if (window._supabaseNotConfigured) {
  console.warn('[Insan] Supabase credentials not set. Edit supabase-config.js before deploying.');
}

/* On version change: wipe all stale lock state */
function migrateLockState() {
  var storedVersion = localStorage.getItem('insan_version');
  if (storedVersion !== APP_VERSION) {
    localStorage.removeItem('insan_pin');
    localStorage.removeItem('insan_lock_active');
    try {
      var s = JSON.parse(localStorage.getItem('insan_settings') || '{}');
      s.app_lock = false;
      localStorage.setItem('insan_settings', JSON.stringify(s));
    } catch(e) {}
    localStorage.setItem('insan_version', APP_VERSION);
  }
  localStorage.removeItem('insan_lock_active');
}

var SETTINGS_DEFAULTS = {
  push_vibrate: true,
  enter_send: true, read_receipts: true, show_typing: true, auto_download: false,
  show_last_seen: true, profile_photo: 'Everyone', who_can_msg: 'Everyone',
  two_factor: false, app_lock: false, font_size: 1, language: 'en',
  call_ringtone: 0, call_vibrate: true, call_ringtone_custom: null, call_ringtone_data: null,
  bg_data: true, bg_sync: true,
};
var PRIVACY_CYCLE = ['Everyone', 'Contacts', 'Nobody'];
var FONT_LABELS   = ['Small', 'Medium', 'Large'];
var FONT_SCALES   = [0.88, 1, 1.13];
var LANGUAGES = [
  { code: 'en', flag: '\u{1F1EC}\u{1F1E7}', name: 'English' },
  { code: 'hi', flag: '\u{1F1EE}\u{1F1F3}', name: 'हिंदी (Hindi)' },
  { code: 'ur', flag: '\u{1F1F5}\u{1F1F0}', name: 'اردو (Urdu)' },
  { code: 'fa', flag: '\u{1F1EE}\u{1F1F7}', name: 'فارسی (Persian)' },
  { code: 'ar', flag: '\u{1F1F8}\u{1F1E6}', name: 'Arabic' },
  { code: 'fr', flag: '\u{1F1EB}\u{1F1F7}', name: 'French' },
  { code: 'de', flag: '\u{1F1E9}\u{1F1EA}', name: 'German' },
  { code: 'es', flag: '\u{1F1EA}\u{1F1F8}', name: 'Spanish' },
  { code: 'tr', flag: '\u{1F1F9}\u{1F1F7}', name: 'Turkish' },
  { code: 'zh', flag: '\u{1F1E8}\u{1F1F3}', name: 'Chinese' },
  { code: 'pt', flag: '\u{1F1E7}\u{1F1F7}', name: 'Portuguese' },
];

function loadSettingsData() {
  try { return JSON.parse(localStorage.getItem('insan_settings') || '{}'); } catch(e) { return {}; }
}
function saveSettingsData(d) { localStorage.setItem('insan_settings', JSON.stringify(d)); }
function getSetting(key) {
  var d = loadSettingsData();
  return key in d ? d[key] : SETTINGS_DEFAULTS[key];
}
function saveSetting(key, val) {
  var d = loadSettingsData(); d[key] = val; saveSettingsData(d);
  if (key === 'font_size') applyFontSize(val);
}
function applyFontSize(idx) {
  idx = Math.max(0, Math.min(2, idx));
  document.documentElement.style.fontSize = (FONT_SCALES[idx] * 16) + 'px';
  var lbl = $('stg-font-size-label'); if (lbl) lbl.textContent = FONT_LABELS[idx];
}
function updateThemeRadios() {
  var light = $('theme-radio-light'), dark = $('theme-radio-dark');
  if (!light || !dark) return;
  light.className = App.isDark ? 'theme-radio' : 'theme-radio selected';
  dark.className  = App.isDark ? 'theme-radio selected' : 'theme-radio';
}

function openSettings() {
  closeSidebar();
  var toggleMap = {
    'stg-enter-send': 'enter_send',         'stg-read-receipts': 'read_receipts',
    'stg-typing': 'show_typing',            'stg-auto-dl': 'auto_download',
    'stg-last-seen': 'show_last_seen',
    'stg-app-lock': 'app_lock',
    'stg-call-vibrate': 'call_vibrate',
    'stg-push-vibrate': 'push_vibrate',
  };
  // App Lock UI — enabled only when BOTH setting is true AND pin exists
  var appLockOn = getSetting('app_lock') === true && (localStorage.getItem('insan_pin') || '').length === 4;
  var changePinRow = $('change-pin-row');
  var apLockStatus = $('applock-status-text');
  if (changePinRow) changePinRow.style.display = appLockOn ? '' : 'none';
  if (apLockStatus) apLockStatus.textContent = appLockOn ? 'PIN enabled — tap to change' : 'Protect app with a 4-digit PIN';
  var appLockEl = $('stg-app-lock'); if (appLockEl) appLockEl.checked = appLockOn;

  // Init ringtone chips (3 built-in + custom)
  var ringtoneIdx = getSetting('call_ringtone');
  if (ringtoneIdx === undefined || ringtoneIdx === null) ringtoneIdx = 0;
  var customName  = getSetting('call_ringtone_custom');
  document.querySelectorAll('.tone-chip[data-ringtone]').forEach(function(c) {
    var v = c.dataset.ringtone === 'custom' ? 'custom' : parseInt(c.dataset.ringtone);
    c.classList.toggle('active', ringtoneIdx === 'custom' ? v === 'custom' : v === ringtoneIdx);
  });
  var rtLabel = $('stg-ringtone-label');
  var rtNames = ['Classic', 'Modern', 'Pulse'];
  if (rtLabel) rtLabel.textContent = ringtoneIdx === 'custom' && customName ? customName : (rtNames[ringtoneIdx] || 'Classic');
  var cnEl = $('custom-ringtone-name');
  if (cnEl) { cnEl.style.display = (ringtoneIdx === 'custom' && customName) ? '' : 'none'; if (customName) cnEl.textContent = '🎵 ' + customName; }

  Object.keys(toggleMap).forEach(function(id) {
    var el = $(id); if (el) el.checked = !!getSetting(toggleMap[id]);
  });

  updateThemeRadios();
  applyFontSize(getSetting('font_size'));
  var pp = $('stg-profile-photo'); if (pp) pp.textContent = getSetting('profile_photo');
  var wm = $('stg-who-can-msg');   if (wm) wm.textContent = getSetting('who_can_msg');
  var ll = $('stg-lang-label');
  if (ll) {
    var code = getSetting('language');
    var lang = LANGUAGES.find(function(l) { return l.code === code; }) || LANGUAGES[0];
    ll.textContent = lang.flag + ' ' + lang.name;
  }
  showScreen('settings');
  // Always scroll settings to top on open
  requestAnimationFrame(function() {
    var sb = document.querySelector('#screen-settings .settings-body');
    if (sb) sb.scrollTop = 0;
  });
}

function closeSettings() { showScreen('dashboard'); }

function changeFontSize(delta) {
  var next = Math.max(0, Math.min(2, getSetting('font_size') + delta));
  saveSetting('font_size', next);
}

function cyclePrivacyOpt(key, elId) {
  var cur = getSetting(key);
  var next = PRIVACY_CYCLE[(PRIVACY_CYCLE.indexOf(cur) + 1) % PRIVACY_CYCLE.length];
  saveSetting(key, next);
  var el = $(elId); if (el) el.textContent = next;
}

function openLanguagePicker() {
  var list = $('language-list'); if (!list) return;
  var cur = getSetting('language');
  list.innerHTML = LANGUAGES.map(function(l) {
    return '<div class="lang-option" onclick="selectLanguage(\'' + l.code + '\')">' +
      '<span class="lang-flag">' + l.flag + '</span>' +
      '<span class="lang-name">' + l.name + '</span>' +
      (l.code === cur ? '<span class="lang-check">&#10003;</span>' : '') +
    '</div>';
  }).join('');
  openModal('modal-language');
}

function selectLanguage(code) {
  saveSetting('language', code);
  var lang = LANGUAGES.find(function(l) { return l.code === code; }) || LANGUAGES[0];
  var ll = $('stg-lang-label'); if (ll) ll.textContent = lang.flag + ' ' + lang.name;
  I18n.apply(code);
  closeModal('modal-language');
  showToast('Language set to ' + lang.name);
}

function openChangePassword() {
  var n = $('cp-new'), c = $('cp-confirm');
  if (n) n.value = ''; if (c) c.value = '';
  openModal('modal-change-password');
  setTimeout(function() { var f = $('cp-new'); if (f) f.focus(); }, 150);
}

async function submitChangePassword() {
  var newPw  = ($('cp-new')     || {}).value;
  var confPw = ($('cp-confirm') || {}).value;
  if (!newPw || newPw.length < 6) return showToast('Password must be at least 6 characters', 'error');
  if (newPw !== confPw) return showToast(I18n.t('passwordMismatch'), 'error');
  var btn = $('cp-btn'); btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
  try {
    var r = await supabaseClient.auth.updateUser({ password: newPw });
    if (r.error) throw r.error;
    showToast('Password updated!');
    closeModal('modal-change-password');
  } catch(err) {
    showToast((err && err.message) || 'Failed to update', 'error');
  } finally { btn.disabled = false; btn.textContent = 'Update'; }
}

async function openActiveSessions() {
  var body = $('sessions-body'); if (!body) return;
  body.innerHTML = '<div style="display:flex;justify-content:center;padding:32px"><span class="spinner" style="border-color:var(--border);border-top-color:var(--accent)"></span></div>';
  openModal('modal-sessions');

  // Detect device type from UA
  var ua = navigator.userAgent || '';
  var platform = navigator.platform || navigator.userAgentData && navigator.userAgentData.platform || 'Unknown';
  var isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
  var isTablet = /iPad|Tablet/i.test(ua);
  var devType  = isTablet ? 'Tablet' : (isMobile ? 'Mobile' : 'Desktop');
  var browser  = /Chrome/i.test(ua) ? 'Chrome' : /Firefox/i.test(ua) ? 'Firefox' : /Safari/i.test(ua) ? 'Safari' : /Edge/i.test(ua) ? 'Edge' : 'Browser';
  var os       = /Android/i.test(ua) ? 'Android' : /iPhone|iPad|iPod/i.test(ua) ? 'iOS' : /Windows/i.test(ua) ? 'Windows' : /Mac/i.test(ua) ? 'macOS' : /Linux/i.test(ua) ? 'Linux' : platform;

  var devIcon = isMobile
    ? '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>'
    : '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>';

  // Get session info from Supabase (last_sign_in, current token)
  var sessionInfo = '';
  try {
    var { data: { session } } = await supabaseClient.auth.getSession();
    if (session && session.user && session.user.last_sign_in_at) {
      var d = new Date(session.user.last_sign_in_at);
      sessionInfo = 'Signed in ' + d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' at ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
  } catch(_) {}

  body.innerHTML =
    '<div class="session-item">' +
      '<div class="session-icon">' + devIcon + '</div>' +
      '<div class="session-info">' +
        '<div class="session-device">' + esc(devType + ' · ' + browser) + '</div>' +
        '<div class="session-time">' + esc(os) + (sessionInfo ? ' · ' + sessionInfo : '') + '</div>' +
      '</div>' +
      '<span class="session-current">Active now</span>' +
    '</div>' +
    '<p style="font-size:12px;color:var(--text3);text-align:center;margin:16px 0 8px;line-height:1.5">Insan uses one active session per sign-in. To revoke access on other devices, use Sign Out All Devices.</p>' +
    '<div style="margin-top:8px">' +
      '<button class="btn-danger" style="width:100%" onclick="_signOutAllDevices()">Sign Out All Devices</button>' +
    '</div>';
}

async function _signOutAllDevices() {
  closeModal('modal-sessions');
  try {
    // scope: 'global' revokes all refresh tokens across all devices
    await supabaseClient.auth.signOut({ scope: 'global' });
    showToast('Signed out of all devices');
  } catch(e) {
    // Fallback to local sign out
    await logout();
  }
}

function confirmDeleteAccount() {
  showConfirm(
    '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" fill="none" stroke="#f87171" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>',
    'Delete Account',
    'Permanently delete your account and all your data? This cannot be undone.',
    deleteAccount
  );
}

async function deleteAccount() {
  var btn = document.getElementById('confirm-action-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>'; }
  try {
    var uid = App.currentUser && App.currentUser.id;
    if (!uid) throw new Error('Not logged in');
    // Delete user data from all tables
    await supabaseClient.from('messages').delete().eq('sender_id', uid);
    await supabaseClient.from('channel_messages').delete().eq('sender_id', uid);
    await supabaseClient.from('group_messages').delete().eq('sender_id', uid);
    await supabaseClient.from('chat_members').delete().eq('user_id', uid);
    await supabaseClient.from('channel_members').delete().eq('user_id', uid);
    await supabaseClient.from('group_members').delete().eq('user_id', uid);
    await supabaseClient.from('blocked_users').delete().or('blocker_id.eq.' + uid + ',blocked_id.eq.' + uid);
    await supabaseClient.from('profiles').delete().eq('id', uid);
    // Sign out — Supabase admin deleteUser requires service role key (not available client-side)
    // Best practice: delete profile + data, then sign out
    _explicitLogout = true;
    await supabaseClient.auth.signOut();
    showToast('Account deleted. Goodbye!');
  } catch (err) {
    showToast((err && err.message) || 'Could not delete account', 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Delete'; }
  }
}


/* ==================== APP LOCK ==================== */

var _pinBuffer   = '';      // current input on lock screen
var _pinModalBuf = '';      // current input in setup/change modal
var _pinModalStep = 0;      // 0 = enter new PIN, 1 = confirm PIN
var _pinModalFirst = '';    // first entry for confirm step
var _pinModalMode = 'set';  // 'set' | 'change'

/* Called after login to decide whether to show lock screen */
function checkAppLockOnStart() {
  var pin = localStorage.getItem('insan_pin') || '';
  var appLockEnabled = getSetting('app_lock') === true;

  // Show lock screen ONLY if: setting is true AND a valid 4-digit PIN exists
  if (appLockEnabled && pin.length === 4) {
    showLockScreen();
  } else {
    // Not enabled or no valid PIN — make sure state is clean, go to dashboard
    if (pin && !appLockEnabled) {
      // PIN exists but setting is off — clear the orphaned PIN
      localStorage.removeItem('insan_pin');
    }
    showDashboard();
  }
}

/* Called after successful PIN verify on lock screen */
function unlockAndShowDashboard() {
  _pinBuffer = '';
  showDashboard();
}


function forgotPIN() {
  showConfirm(
    '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" fill="none" stroke="#f97316" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
    'Forgot PIN?',
    'This will remove your PIN and disable App Lock. You can set a new PIN in Settings > Security.',
    function() {
      saveSetting('app_lock', false);
      localStorage.removeItem('insan_pin');
      showDashboard();
    }
  );
}

/* Show the lock screen */
function showLockScreen() {
  _pinBuffer = '';
  renderPinDots('pd', 0);
  clearPinError('pin-error');
  showScreen('applock');
}

/* Digit pressed on lock screen */
function pinKey(digit) {
  if (_pinBuffer.length >= 4) return;
  _pinBuffer += digit;
  renderPinDots('pd', _pinBuffer.length);
  if (_pinBuffer.length === 4) {
    setTimeout(function() { verifyLockPin(); }, 80);
  }
}

/* Backspace on lock screen */
function pinBackspace() {
  if (!_pinBuffer.length) return;
  _pinBuffer = _pinBuffer.slice(0, -1);
  renderPinDots('pd', _pinBuffer.length);
  clearPinError('pin-error');
}

/* Verify PIN on lock screen */
function verifyLockPin() {
  var stored = localStorage.getItem('insan_pin') || '';
  if (_pinBuffer === stored) {
    unlockAndShowDashboard();
  } else {
    showPinError('pin-error', 'Incorrect PIN');
    flashPinDots('pd', 'error');
    setTimeout(function() {
      _pinBuffer = '';
      renderPinDots('pd', 0);
      clearPinError('pin-error');
    }, 900);
  }
}

/* ---- Modal PIN pad (set / change PIN) ---- */

/* Open from settings toggle or Change PIN button */
function openSetPIN(mode) {
  _pinModalMode = mode || 'set';
  _pinModalBuf  = '';
  _pinModalStep = 0;
  _pinModalFirst = '';
  var title = $('pin-modal-title'), sub = $('pin-modal-sub');
  if (title) title.textContent = _pinModalMode === 'change' ? 'Change PIN' : 'Set App Lock PIN';
  if (sub)   sub.textContent   = 'Enter a 4-digit PIN';
  renderPinDots('pmd', 0);
  clearPinError('pin-modal-error');
  openModal('modal-set-pin');
}

/* Alias for Change PIN row button */
function openChangePIN() { openSetPIN('change'); }

/* Digit in modal */
function pinModalKey(digit) {
  if (_pinModalBuf.length >= 4) return;
  _pinModalBuf += digit;
  renderPinDots('pmd', _pinModalBuf.length);
  if (_pinModalBuf.length === 4) {
    setTimeout(function() { processPinModalStep(); }, 80);
  }
}

/* Backspace in modal */
function pinModalBackspace() {
  if (!_pinModalBuf.length) return;
  _pinModalBuf = _pinModalBuf.slice(0, -1);
  renderPinDots('pmd', _pinModalBuf.length);
  clearPinError('pin-modal-error');
}

/* Handle the two-step PIN setup */
function processPinModalStep() {
  if (_pinModalStep === 0) {
    // First entry — ask to confirm
    _pinModalFirst = _pinModalBuf;
    _pinModalBuf = '';
    _pinModalStep = 1;
    var sub = $('pin-modal-sub');
    if (sub) sub.textContent = 'Confirm your PIN';
    renderPinDots('pmd', 0);
    clearPinError('pin-modal-error');
  } else {
    // Confirm entry
    if (_pinModalBuf === _pinModalFirst) {
      localStorage.setItem('insan_pin', _pinModalBuf);
      saveSetting('app_lock', true);
      closeModal('modal-set-pin');
      // Refresh security UI
      var al = $('stg-app-lock'); if (al) al.checked = true;
      var cpr = $('change-pin-row'); if (cpr) cpr.style.display = '';
      var ast = $('applock-status-text'); if (ast) ast.textContent = 'PIN enabled — tap to change';
      showToast('App Lock PIN set!');
    } else {
      showPinError('pin-modal-error', 'PINs do not match');
      flashPinDots('pmd', 'error');
      setTimeout(function() {
        _pinModalBuf = '';
        _pinModalStep = 0;
        _pinModalFirst = '';
        renderPinDots('pmd', 0);
        clearPinError('pin-modal-error');
        var sub = $('pin-modal-sub');
        if (sub) sub.textContent = 'Enter a 4-digit PIN';
      }, 900);
    }
  }
}

/* Cancel PIN setup */
function cancelPinSetup() {
  if (_pinModalMode === 'set') {
    // User cancelled — make sure app_lock is off and no partial PIN
    saveSetting('app_lock', false);
    localStorage.removeItem('insan_pin');
    var al = $('stg-app-lock'); if (al) al.checked = false;
    var cpr = $('change-pin-row'); if (cpr) cpr.style.display = 'none';
    var ast = $('applock-status-text'); if (ast) ast.textContent = 'Protect app with a 4-digit PIN';
  }
  _pinModalBuf = ''; _pinModalStep = 0; _pinModalFirst = '';
  closeModal('modal-set-pin');
}

/* Toggle from settings switch */
function toggleAppLock(enabled) {
  if (enabled) {
    openSetPIN('set');
  } else {
    // Confirm before disabling
    showConfirm(
      '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" fill="none" stroke="#f97316" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
      'Disable App Lock',
      'Are you sure you want to remove PIN protection?',
      function() {
        saveSetting('app_lock', false);
        localStorage.removeItem('insan_pin');
        var al = $('stg-app-lock'); if (al) al.checked = false;
        var cpr = $('change-pin-row'); if (cpr) cpr.style.display = 'none';
        var ast = $('applock-status-text'); if (ast) ast.textContent = 'Protect app with a 4-digit PIN';
        showToast('App Lock disabled');
      }
    );
    // Revert toggle visually until confirmed
    setTimeout(function() {
      var al = $('stg-app-lock');
      if (al && !getSetting('app_lock')) al.checked = false;
    }, 50);
  }
}

/* Helpers */
function renderPinDots(prefix, count) {
  for (var i = 0; i < 4; i++) {
    var d = $(prefix + i);
    if (d) { d.className = 'pin-dot' + (i < count ? ' filled' : ''); }
  }
}
function flashPinDots(prefix, cls) {
  for (var i = 0; i < 4; i++) {
    var d = $(prefix + i); if (d) d.className = 'pin-dot ' + cls;
  }
}
function showPinError(elId, msg) { var e = $(elId); if (e) e.textContent = msg; }
function clearPinError(elId) { var e = $(elId); if (e) e.textContent = ''; }

/* ==================== NOTIFICATION ENGINE ==================== */

var _swReg     = null;   // ServiceWorkerRegistration
var _audioCtx  = null;   // Web Audio context

/* ---- Boot: register SW + request permission ---- */
/* ══════════════════════════════════════════════════════════
   PUSH NOTIFICATIONS — Web Push API via Service Worker
   ══════════════════════════════════════════════════════════ */

async function initNotifications() {
  // Register service worker
  if ('serviceWorker' in navigator && !_swReg) {
    try {
      _swReg = await navigator.serviceWorker.register('sw.js');
      console.log('[Insan] SW registered, scope:', _swReg.scope);
      if (_swReg.waiting) _showUpdateAvailable();
      _swReg.addEventListener('updatefound', function() {
        var newSW = _swReg.installing;
        if (newSW) {
          newSW.addEventListener('statechange', function() {
            if (newSW.state === 'installed' && navigator.serviceWorker.controller) {
              _showUpdateAvailable();
            }
          });
        }
      });
      // Listen for SW messages — including background call answer/decline
      navigator.serviceWorker.addEventListener('message', function(e) {
        if (!e.data) return;
        var d = e.data;
        if (d.type === 'NOTIF_CLICK')  handleNotifClick(d.convId, d.convType);
        if (d.type === 'SW_UPDATED')   _showUpdateAvailable(d.version);

        // User tapped "Answer" on an OS call notification while app was in background
        if (d.type === 'CALL_ANSWER_FROM_NOTIF') {
          _handleBackgroundCallAnswer(d.callData);
        }
        // User tapped "Decline" on OS call notification
        if (d.type === 'CALL_DECLINED_FROM_NOTIF' || d.type === 'CALL_DISMISSED_FROM_NOTIF') {
          _handleBackgroundCallDecline(d.chatId);
        }
        // Legacy
        if (d.type === 'CALL_ANSWER' && VC.pendingOffer) acceptIncomingCall();
      });
      // Check for updates every 30 min
      setInterval(function() { _swReg.update().catch(function(){}); }, 30 * 60 * 1000);
    } catch (err) {
      console.warn('[Insan] SW registration failed:', err);
    }
  }

  // Check URL param for incoming call (app was opened by push notification answer)
  _checkIncomingCallFromUrl();
}

/* Request push (Notification API) permission — called from Settings.
   No VAPID / Web Push subscription — uses SW showNotification only. */
async function requestPushPermission(silent) {
  if (!('Notification' in window)) {
    if (!silent) showToast('Push notifications not supported in this browser', 'error');
    _updatePushStatusBadge(); return;
  }
  var perm = Notification.permission;
  if (perm === 'denied') {
    showToast('Push notifications are blocked — enable them in browser/OS settings', 'error');
    _updatePushStatusBadge(); return;
  }
  if (perm === 'granted') {
    if (!silent) showToast('Push notifications are already enabled ✓');
    _updatePushStatusBadge(); return;
  }
  localStorage.setItem('insan_push_asked', '1');
  try {
    var result = await Notification.requestPermission();
    if (result === 'granted') {
      showToast('Push notifications enabled ✓');
    } else {
      showToast('Push notifications not enabled', 'error');
    }
  } catch(e) {
    showToast('Could not request permission', 'error');
  }
  _updatePushStatusBadge();
}

/* Send a test push notification */
async function testPushNotification() {
  if (!('Notification' in window) || Notification.permission !== 'granted') {
    return showToast('Enable push notifications first', 'error');
  }
  await fireNotification({
    title: 'Insan',
    body:  'Push notifications are working! ✓',
    icon:  'icons/insan.png',
    convId: null, convType: 'chat',
    _forceBackground: true,
  });
  showToast('Test notification sent');
}

/* Update the live status badge in the Push Notifications settings row */
function _updatePushStatusBadge() {
  var el = document.getElementById('push-status-badge');
  if (!el) return;
  if (!('Notification' in window)) {
    el.textContent = 'Not supported'; el.className = 'push-status-badge push-badge-off'; return;
  }
  var p = Notification.permission;
  if (p === 'granted') {
    el.textContent = 'Enabled'; el.className = 'push-status-badge push-badge-on';
  } else if (p === 'denied') {
    el.textContent = 'Blocked'; el.className = 'push-status-badge push-badge-blocked';
  } else {
    el.textContent = 'Not enabled'; el.className = 'push-status-badge push-badge-off';
  }
}

/* ══════════════════════════════════════════════════════════
   FIRE NOTIFICATION — single entry point for all alerts
   ══════════════════════════════════════════════════════════ */
async function fireNotification(opts) {
  var isVisible = document.visibilityState === 'visible' && !document.hidden;
  var isCall    = opts.isCall === true;
  var forceBack = opts._forceBackground === true;

  // Skip if user is actively viewing this exact conversation (not for calls)
  if (!forceBack && isVisible && !isCall && App.activeChatId === opts.convId) return;

  var previewOn = getSetting('push_preview')  !== false;
  var vibrateOn = getSetting('push_vibrate')  !== false;
  var granted   = 'Notification' in window && Notification.permission === 'granted';

  var title   = opts.title || 'Insan';
  var rawBody = opts.body  || (isCall ? 'Incoming voice call' : 'New message');
  var body    = previewOn ? rawBody : (isCall ? '📞 Incoming voice call' : 'New message');
  var icon    = opts.icon  || 'icons/insan.png';
  var tag     = 'insan-' + (opts.convType || 'chat') + '-' + (opts.convId || Date.now());

  // ── 1. Vibrate ─────────────────────────────────────────────────────────────
  if (vibrateOn && navigator.vibrate) {
    navigator.vibrate(isCall ? [400, 200, 400, 200, 400] : [200, 80, 200]);
  }

  // ── 2. Sound ───────────────────────────────────────────────────────────────
  if (isCall) {
    _playCallRingtone();
  }

  // ── 3. Foreground: in-app banner ───────────────────────────────────────────
  if (isVisible && !forceBack) {
    showInAppBanner(title, previewOn ? rawBody : body,
                    opts.convId, opts.convType, opts.peerId, isCall);
    return;
  }

  // ── 4. Background: OS notification via Service Worker ──────────────────────
  if (!granted) return;

  var notifOpts = {
    body: body, icon: icon, badge: icon,
    tag: tag, renotify: true, silent: false,
    vibrate: vibrateOn ? (isCall ? [400, 200, 400, 200, 400] : [200, 100, 200]) : [],
    data: {
      convId:   opts.convId   || null,
      convType: opts.convType || 'chat',
      peerId:   opts.peerId   || null,
      url:      window.location.href,
    },
    actions: isCall
      ? [{ action: 'answer',  title: '✅ Answer' }, { action: 'decline', title: '❌ Decline' }]
      : [{ action: 'open',    title: 'Open'      }, { action: 'dismiss', title: 'Dismiss'  }],
  };

  // Use SW showNotification (shows on lock screen, works when tab is hidden)
  if (_swReg) {
    try { await _swReg.showNotification(title, notifOpts); return; } catch(e) {
      console.warn('[Insan] SW notification failed:', e);
    }
  }
  // Fallback: plain Notification API if SW unavailable
  try {
    var n = new Notification(title, notifOpts);
    n.onclick = function() {
      window.focus(); n.close();
      handleNotifClick(opts.convId, opts.convType, opts.peerId);
    };
    setTimeout(function() { try { n.close(); } catch(_) {} }, isCall ? 30000 : 8000);
  } catch(_) {}
}

/* In-app notification banner (foreground) — messages and calls */
function showInAppBanner(title, body, convId, convType, peerId, isCall) {
  // Remove any existing banner (cancel its auto-dismiss timer first)
  var old = document.getElementById('inapp-banner');
  if (old) { if (old._tid) clearTimeout(old._tid); old.remove(); }

  var banner = document.createElement('div');
  banner.id = 'inapp-banner';
  banner.className = 'inapp-banner' + (isCall ? ' inapp-banner-call' : '');

  // Icon: green phone circle for calls, app icon for messages
  var iconHtml = isCall
    ? '<div class="inapp-call-ring-wrap">' +
        '<div class="inapp-call-ring-pulse"></div>' +
        '<div class="inapp-call-ring-icon">' +
          '<svg viewBox="0 0 24 24" fill="white" width="18" height="18"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.91 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>' +
        '</div>' +
      '</div>'
    : '<div class="inapp-banner-icon"><img src="icons/insan.png" style="width:36px;height:36px;border-radius:10px;display:block" onerror="this.style.display=\'none\'"></div>';

  // Action buttons: Answer/Decline for calls; ✕ dismiss for messages
  var actionHtml = isCall
    ? '<div class="inapp-call-btns">' +
        '<button class="inapp-call-btn decline" id="inapp-decline-btn">Decline</button>' +
        '<button class="inapp-call-btn accept"  id="inapp-accept-btn">Answer</button>' +
      '</div>'
    : '<button class="inapp-banner-close" id="inapp-close-btn">&times;</button>';

  banner.innerHTML = iconHtml +
    '<div class="inapp-banner-text">' +
      '<div class="inapp-banner-title">' + esc(title) + '</div>' +
      '<div class="inapp-banner-body">'  + esc(body)  + '</div>' +
    '</div>' + actionHtml;

  document.body.appendChild(banner);

  // Wire events after DOM insertion (avoid inline onclick escaping issues)
  var closeBtn   = document.getElementById('inapp-close-btn');
  var acceptBtn  = document.getElementById('inapp-accept-btn');
  var declineBtn = document.getElementById('inapp-decline-btn');

  if (closeBtn)   closeBtn.addEventListener('click',   function(e) { e.stopPropagation(); banner.remove(); });
  if (acceptBtn)  acceptBtn.addEventListener('click',  function(e) { e.stopPropagation(); banner.remove(); acceptIncomingCall(); });
  if (declineBtn) declineBtn.addEventListener('click', function(e) { e.stopPropagation(); banner.remove(); declineIncomingCall(); });

  // Tapping banner body (for messages only) → open conversation
  if (!isCall) {
    banner.style.cursor = 'pointer';
    banner.addEventListener('click', function(e) {
      if (e.target.id === 'inapp-close-btn') return;
      banner.remove();
      handleNotifClick(convId, convType, peerId);
    });
  }

  // Auto-dismiss: 5s for messages, 30s for calls
  banner._tid = setTimeout(function() {
    if (!banner.parentElement) return;
    banner.remove();
    // If call banner timed out without an answer, clean up pending call state
    if (isCall && VC.pendingOffer && !VC.active) {
      _stopCallRingtone();
      _vcSignal({ type: 'vc-end', from: App.currentUser && App.currentUser.id });
      VC.pendingOffer = null;
      VC.pendingFrom  = null;
      _vcLeaveSignalChannel();
      showToast('Missed call from ' + (VC.peerName || 'someone'));
    }
  }, isCall ? 30000 : 5000);
}

/* Navigate to conversation when notification is tapped */
function handleNotifClick(convId, convType, peerId) {
  if (!convId) return;
  if (convType === 'chat')    openChat(convId, peerId);
  else if (convType === 'channel') openChannel(convId);
  else if (convType === 'group')   openGroup(convId);
}

/* Stubs kept for safety — push system handles everything */
function openNotifPanel()    {}
function closeNotifPanel()   {}
function updateNotifBadge()  {}
function renderNotifPanel()  {}
function clearAllNotifications() {}
function showNotifBanner()   {}
function dismissNotifBanner(){}


function autoResize(el) {
  el.style.height = 'auto';
  var newH = Math.min(el.scrollHeight, 120);
  el.style.height = newH + 'px';
}

/* ── Full-screen overlays (never become panels on desktop) ── */
var OVERLAY_SCREENS = ['splash','auth','applock','flow'];

function showScreen(name) {
  var isDesktop = window.matchMedia('(min-width: 768px)').matches;

  // Always remove active from all screens first
  document.querySelectorAll('.screen').forEach(function(s) { s.classList.remove('active'); });

  if (isDesktop && !OVERLAY_SCREENS.includes(name)) {
    // ── Desktop: dashboard + chat are always visible; settings overlays left panel ──
    // Dashboard panel: always shown via CSS (display:flex !important)
    var dash = $('screen-dashboard'); if (dash) dash.classList.add('active');

    if (name === 'chat') {
      var sc = $('screen-chat'); if (sc) sc.classList.add('active');
      showDesktopPlaceholder(false);
    } else if (name === 'settings') {
      var ss = $('screen-settings'); if (ss) ss.classList.add('active');
      showDesktopPlaceholder(true);
    } else {
      // 'dashboard' or any unknown → show placeholder on right panel
      showDesktopPlaceholder(true);
    }
    return;
  }

  // ── Mobile / overlay screens: original full-screen behavior ──
  var s = $('screen-' + name); if (s) s.classList.add('active');

  // On desktop, if an overlay is dismissed back to dashboard, restore panels
  if (isDesktop && OVERLAY_SCREENS.includes(name) === false) {
    var dash2 = $('screen-dashboard'); if (dash2) dash2.classList.add('active');
  }
}

function showDesktopPlaceholder(show) {
  var ph = $('desktop-no-chat');
  var chat = $('screen-chat');
  if (!ph) return;
  if (show) {
    ph.style.display = 'flex';
    // Clear active chat state visually
    var area = $('msg-area');
    if (area) area.innerHTML = '';
    var inp = $('msg-input-area'); if (inp) inp.style.display = 'none';
    var rb  = $('readonly-banner'); if (rb)  rb.style.display = 'none';
    var hdr = $('chat-header');     if (hdr) hdr.innerHTML    = '';
    if (chat) chat.classList.remove('active');
  } else {
    ph.style.display = 'none';
    var inp2 = $('msg-input-area'); if (inp2) inp2.style.display = '';
    if (chat) chat.classList.add('active');
  }
}

/* ==================== CLEANUP ==================== */
function cleanupChatScreenSubs() {
  App.chatScreenSubs.forEach(ch => { try { if (supabaseClient) supabaseClient.removeChannel(ch); } catch (_) {} });
  App.chatScreenSubs = [];
  App.typingChannel = null;
}
function cleanupChatListSubs() {
  App.chatListSubs.forEach(ch => { try { if (supabaseClient) supabaseClient.removeChannel(ch); } catch (_) {} });
  App.chatListSubs = [];
  App.subscribedListIds = new Set();
}
function cleanupAllSubs() {
  cleanupChatScreenSubs();
  cleanupChatListSubs();
  if (App.presenceCh) {
    try { if (supabaseClient) supabaseClient.removeChannel(App.presenceCh); } catch (_) {}
    App.presenceCh = null;
  }
  // Clear typing timers to prevent memory leak / ghost indicators
  clearTimeout(App.typingTimer);
  App.typingTimer = null;
  Object.keys(App.typingTimers).forEach(function(k) { clearTimeout(App.typingTimers[k]); });
  App.typingTimers = {};
  var bar = document.getElementById('typing-bar');
  if (bar) { bar.textContent = ''; bar.classList.remove('show'); }
}

/* ==================== INIT ==================== */
var _authReady       = false;
var _explicitLogout   = false; // true only when user clicks Logout

/* ─────────────────────────────────────────────────────────────────
   BACKGROUND RUNNING — Keep Supabase Realtime alive via heartbeat
   ─────────────────────────────────────────────────────────────── */
var _bgHeartbeatTimer = null;
var _bgPresenceTimer  = null;
var _bgSyncRegistered  = false;

function startBackgroundKeepAlive() {
  if (!App.currentUser || !_authReady) return;

  // 1) Register Periodic Background Sync (Chrome Android — fires every ~1 min when backgrounded)
  if (_swReg && 'periodicSync' in _swReg) {
    _swReg.periodicSync.register('insan-heartbeat', { minInterval: 60 * 1000 })
      .then(function() { _bgSyncRegistered = true; })
      .catch(function() {});
  }

  // 2) Register one-shot Background Sync (reconnect after going offline)
  if (_swReg && 'sync' in _swReg) {
    _swReg.sync.register('insan-keepalive').catch(function(){});
  }

  // 3) WS heartbeat every 6s — keeps Supabase Realtime WebSocket alive.
  //    Browsers throttle timers to ~1 min when hidden, but we still try.
  //    The SW-side periodicsync fills the gap.
  clearInterval(_bgHeartbeatTimer);
  _bgHeartbeatTimer = setInterval(function() {
    if (!App.currentUser || !_authReady) return;

    // a) Ping presence channel to keep WS alive
    if (App.presenceCh) {
      try { App.presenceCh.send({ type: 'broadcast', event: 'hb', payload: { ts: Date.now() } }); } catch(_) {}
    }

    // b) Re-subscribe chat-list subs if they dropped
    if (App.chatListSubs && App.chatListSubs.length === 0 && App.activeTab === 'chats') {
      App._lastLoadMs.chats = 0;
      loadChats();
    }

    // c) Re-establish personal call channel if it silently dropped
    if (!_vcUserCallCh) _vcStartUserCallChannel();

    // d) Re-subscribe CG background channels if dropped
    if (typeof _cgNotifSubs !== 'undefined' && _cgNotifSubs.length === 0) {
      subscribeCGBackground();
    }

    // e) Ping SW every 25s to confirm it is alive and have it relay SW_HEARTBEAT back
    if (Date.now() % 25000 < 6500 && navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'PING' });
    }
  }, 6000);

  // 4) Presence DB update every 20s — keeps last_seen fresh (always runs, even when hidden)
  clearInterval(_bgPresenceTimer);
  _bgPresenceTimer = setInterval(function() {
    if (!App.currentUser || !_authReady) return;
    supabaseClient
      .from('profiles')
      .update({ last_seen: new Date().toISOString() })
      .eq('id', App.currentUser.id)
      .then(function() {})
      .catch(function() {});
  }, 20000);

  // 5) Wake Lock API — prevents CPU/screen sleep on mobile while app is open
  _requestWakeLock();

  // 6) When app goes to background: tell SW to send a reconnect message back shortly.
  //    This ensures the app re-establishes Supabase WS even if timers throttle.
  document.addEventListener('visibilitychange', function _bgKeepaliveOnHide() {
    if (document.hidden && App.currentUser && _authReady) {
      // Re-register background sync so SW wakes us on next opportunity
      if (_swReg && 'sync' in _swReg) {
        _swReg.sync.register('insan-keepalive').catch(function(){});
      }
      // Ask SW to ping us back after 30s (SW timer isn't throttled)
      if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({ type: 'SCHEDULE_RECONNECT', delayMs: 30000 });
      }
    }
  });
}

var _wakeLock = null;
async function _requestWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    if (_wakeLock && _wakeLock.released === false) return; // already held
    _wakeLock = await navigator.wakeLock.request('screen');
    _wakeLock.addEventListener('release', function() {
      // Re-request when user comes back to page
    });
  } catch (_) {}
}

// Re-request wake lock when page becomes visible
document.addEventListener('visibilitychange', function() {
  if (document.visibilityState === 'visible' && App.currentUser) {
    _requestWakeLock();
  }
});

// SW heartbeat response — re-establish everything when SW wakes the app
navigator.serviceWorker && navigator.serviceWorker.addEventListener('message', function(e) {
  if (!e.data) return;

  if (e.data.type === 'SW_HEARTBEAT' || e.data.type === 'SW_RECONNECT') {
    if (!_authReady || !App.currentUser) return;
    // Re-establish call channel first (highest priority)
    if (!_vcUserCallCh) _vcStartUserCallChannel();
    // Re-subscribe to CG background notif channels
    subscribeCGBackground();
    // Re-load chat list if subs have dropped
    if (App.chatListSubs && App.chatListSubs.length === 0) {
      App._lastLoadMs.chats = 0;
      if (App.activeTab === 'chats') loadChats();
    }
  }

  if (e.data.type === 'CALL_ANSWER') {
    if (VC.pendingOffer) acceptIncomingCall();
  }
  if (e.data.type === 'NOTIF_CLICK' && e.data.convId) {
    handleNotifClick(e.data.convId, e.data.convType || 'chat', null);
  }
});

// Online/offline reconnect
window.addEventListener('online', function() {
  if (App.currentUser && _authReady) {
    showToast('Back online ✓');
    setTimeout(function() {
      cleanupAllSubs();
      subscribeCGBackground();
      _vcStartUserCallChannel();
      // Reload list to re-establish subscriptions for current tab
      if      (App.activeTab === 'chats')    loadChats();
      else if (App.activeTab === 'channels') loadChannels();
      else                                   loadGroups();
      if (App.activeChatId) {
        if      (App.activeConvType === 'chat')    subscribeMessages('chat',    App.activeChatId);
        else if (App.activeConvType === 'channel') subscribeMessages('channel', App.activeChatId);
        else if (App.activeConvType === 'group')   subscribeMessages('group',   App.activeChatId);
      }
    }, 1200);
  }
});
window.addEventListener('offline', function() { showToast('Offline — messages will retry when back online', 'error'); });

/* ---- Page visibility: refresh list when user switches back to tab ---- */
document.addEventListener('visibilitychange', function() {
  if (document.visibilityState === 'visible' && App.currentUser && _authReady) {
    // Re-request wake lock immediately on foreground
    _requestWakeLock();
    var dash = document.querySelector('#screen-dashboard.active');
    var onDesktop = window.matchMedia('(min-width: 768px)').matches;
    if (dash || onDesktop) {
      // Invalidate caches so we get fresh data — throttle guard will skip if too soon
      var freshThresh = Date.now() - 8000;
      if (App._lastLoadMs.chats    < freshThresh) { App._lastLoadMs.chats    = 0; }
      if (App._lastLoadMs.channels < freshThresh) { App._lastLoadMs.channels = 0; _cachedChannels = null; }
      if (App._lastLoadMs.groups   < freshThresh) { App._lastLoadMs.groups   = 0; _cachedGroups   = null; }
      if      (App.activeTab === 'chats')    loadChats();
      else if (App.activeTab === 'channels') loadChannels();
      else                                   loadGroups();
    }
  }
});

async function initApp() {
  migrateLockState();
  setTheme(App.isDark);

  // Apply saved language safely — never crash if I18n is missing
  try { I18n.apply(getSetting('language') || 'en'); } catch(e) { console.warn('[Insan] I18n init failed:', e); }

  initNotifications();

  // ── Supabase not configured ────────────────────────────────
  if (window._supabaseNotConfigured || !window.supabaseClient) {
    showScreen('auth');
    setTimeout(function() {
      showToast('Supabase not configured — update supabase-config.js', 'error');
    }, 400);
    return;
  }

  // ── FAST PATH: check localStorage for existing token ──────
  var hasToken = (function() {
    try {
      var keys = Object.keys(localStorage);
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        if (!(k.includes('supabase') || k.includes('-auth-token'))) continue;
        var v = JSON.parse(localStorage.getItem(k) || 'null');
        if (v && (v.refresh_token || v.access_token ||
                  (v.session && (v.session.refresh_token || v.session.access_token)))) {
          return true;
        }
      }
    } catch (_) {}
    return false;
  })();

  showScreen('splash');
  var splashDelay = hasToken ? 400 : 600;
  await new Promise(function(r) { setTimeout(r, splashDelay); });

  // ── Safety net: if we're still on splash after 8s, go to auth ─
  var splashSafetyTimer = setTimeout(function() {
    if (document.getElementById('screen-splash') &&
        document.getElementById('screen-splash').classList.contains('active')) {
      console.warn('[Insan] Splash timeout — forcing auth screen');
      showScreen('auth');
    }
  }, 8000);

  // ── Register listener for POST-startup auth events ────────────────────────
  supabaseClient.auth.onAuthStateChange(async function(event, session) {

    // User just logged in from the auth screen
    if (event === 'SIGNED_IN' && session && session.user && !_authReady) {
      clearTimeout(splashSafetyTimer);
      _authReady = true;
      App.session = session; App.currentUser = session.user;
      await loadProfile();
      checkAppLockOnStart();
      return;
    }

    // Token silently refreshed — update session, no navigation
    if (event === 'TOKEN_REFRESHED' && session) {
      App.session = session;
      // If refresh brought us a valid session but dashboard not shown yet
      if (!_authReady && session.user) {
        clearTimeout(splashSafetyTimer);
        _authReady = true;
        App.currentUser = session.user;
        await loadProfile();
        checkAppLockOnStart();
      }
      return;
    }

    // Explicit logout — navigate to login
    if (event === 'SIGNED_OUT' && _explicitLogout) {
      _authReady = false; _explicitLogout = false;
      App.session = null; App.currentUser = null; App.currentProfile = null;
      cleanupAllSubs();
      showScreen('auth');
    }
  });

  // ── getSession(): reads localStorage, refreshes if expired ────────────────
  var sessionData = null;
  try {
    // Race getSession against a 6-second timeout so we never hang on splash
    var sessionPromise = supabaseClient.auth.getSession();
    var timeoutPromise = new Promise(function(_, reject) {
      setTimeout(function() { reject(new Error('getSession timeout')); }, 6000);
    });
    var result = await Promise.race([sessionPromise, timeoutPromise]);
    sessionData = result && result.data && result.data.session;
  } catch (e) {
    console.warn('[Insan] getSession error:', e && e.message);
    // Fall through — sessionData stays null → show auth
  }

  clearTimeout(splashSafetyTimer);

  if (sessionData && sessionData.user) {
    // Returning user — go straight to dashboard
    if (_authReady) return; // TOKEN_REFRESHED already handled it
    _authReady = true;
    App.session = sessionData; App.currentUser = sessionData.user;
    await loadProfile();
    checkAppLockOnStart();
  } else {
    // No session — show login
    showScreen('auth');
  }
}

/* ==================== AUTH ==================== */
async function handleAuth(isLogin) {
  var emailEl    = $('auth-email');
  var pwEl       = $('auth-password');
  var confirmEl  = $('auth-confirm');
  var nameEl     = $('auth-name');
  var usernameEl = $('auth-username');

  var email    = emailEl    ? emailEl.value.trim()    : '';
  var password = pwEl       ? pwEl.value              : '';
  var confirm  = confirmEl  ? confirmEl.value         : '';
  var name     = nameEl     ? nameEl.value.trim()     : '';
  var username = usernameEl ? usernameEl.value.trim() : '';

  // Validation
  if (!email)    return showToast('Email daalo', 'error');
  if (!password) return showToast('Password daalo', 'error');

  if (!isLogin) {
    if (!name)                return showToast('Apna naam daalo', 'error');
    if (!username)            return showToast('Please choose a username', 'error');
    if (username.length < 3)  return showToast('Username kam se kam 3 characters ka hona chahiye', 'error');
    if (!/^[a-z0-9_.]+$/.test(username)) return showToast('Username may only contain letters, numbers, _ and .', 'error');
    if (password.length < 6)  return showToast('Password kam se kam 6 characters ka hona chahiye', 'error');
    if (password !== confirm)  return showToast(I18n.t('passwordMismatch'), 'error');
  }

  var btn = $('auth-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner" style="width:18px;height:18px;margin:0 auto"></span>'; }

  try {
    if (isLogin) {
      var { error: loginErr } = await supabaseClient.auth.signInWithPassword({ email, password });
      if (loginErr) throw loginErr;
    } else {
      // Check username uniqueness before creating account
      var { data: existing } = await supabaseClient.from('profiles')
        .select('id').eq('username', username).maybeSingle();
      if (existing) return showToast('@' + username + ' is already taken — please choose another', 'error');

      var { data: signUpData, error: signUpErr } = await supabaseClient.auth.signUp({ email, password });
      if (signUpErr) throw signUpErr;
      if (signUpData && signUpData.user) {
        var { error: profileErr } = await supabaseClient.from('profiles').upsert({
          id: signUpData.user.id,
          username: username,
          display_name: name,
          avatar_url: null,
          created_at: new Date().toISOString()
        });
        // Ignore profile error if display_name column doesn't exist yet (old schema)
        if (profileErr && !profileErr.message.includes('display_name')) {
          // Retry without display_name (backward compat with old schema)
          await supabaseClient.from('profiles').upsert({
            id: signUpData.user.id, username: username, avatar_url: null,
            created_at: new Date().toISOString()
          });
        }
      }
      showToast(I18n.t('accountCreated'));
      toggleAuthMode(true);
    }
  } catch (err) {
    var msg = (err && err.message) || 'Kuch galat hua';
    if (msg.includes('already registered') || msg.includes('already been registered')) msg = 'This email is already registered';
    if (msg.includes('Invalid login') || msg.includes('invalid_credentials')) msg = 'Incorrect email or password';
    if (msg.includes('Email not confirmed')) msg = 'Please confirm your email first';
    showToast(msg, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = isLogin ? 'Login' : 'Create Account'; }
  }
}

async function handleForgotPassword() {
  var emailEl = $('auth-email');
  var email = emailEl ? emailEl.value.trim() : '';
  if (!email) {
    showToast('Pehle apna email daalo', 'error');
    if (emailEl) emailEl.focus();
    return;
  }
  var btn = $('auth-btn');
  if (btn) { btn.disabled = true; }
  try {
    var { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.href
    });
    if (error) throw error;
    showToast('Password reset link sent — check your email 📧');
  } catch(e) {
    showToast((e && e.message) || 'Reset failed', 'error');
  } finally {
    if (btn) { btn.disabled = false; }
  }
}

function togglePwVis(inputId, btn) {
  var inp = $(inputId); if (!inp) return;
  var isHidden = inp.type === 'password';
  inp.type = isHidden ? 'text' : 'password';
  btn.innerHTML = isHidden
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
}

function toggleAuthMode(forceLogin) {
  var isLogin = forceLogin !== undefined ? forceLogin : $('auth-btn').dataset.mode !== 'login';
  $('auth-btn').dataset.mode        = isLogin ? 'login'   : 'signup';
  $('auth-btn').textContent         = isLogin ? 'Login'   : 'Create Account';
  $('auth-toggle-btn').textContent  = isLogin ? 'Sign Up' : 'Login';
  $('auth-toggle-text').textContent = isLogin ? "Don't have an account?" : 'Already have an account?';
  $('auth-title').textContent       = isLogin ? 'Login'   : 'Create Account';
  var subEl = $('auth-sub-text');
  if (subEl) subEl.textContent = isLogin ? 'Welcome back to Insan' : 'Join Insan \u2014 it\'s free';

  // Show/hide signup-only fields
  var nw  = $('auth-name-wrap'),
      uw  = $('auth-username-wrap'),
      cw  = $('auth-confirm-wrap'),
      fw  = $('auth-forgot-wrap');
  var display = isLogin ? 'none' : 'block';
  if (nw)  nw.style.display  = display;
  if (uw)  uw.style.display  = display;
  if (cw)  cw.style.display  = display;
  if (fw)  fw.style.display  = isLogin ? 'block' : 'none';

  // Clear signup fields when switching to login
  if (isLogin) {
    ['auth-name','auth-username','auth-confirm'].forEach(function(id) {
      var el = $(id); if (el) el.value = '';
    });
  }
}

async function logout() {
  _explicitLogout = true;
  _authReady = false;
  _sendingMsg = false;
  _openingConv = false;
  clearTimeout(App._listRefreshTimer);
  clearInterval(_bgHeartbeatTimer); _bgHeartbeatTimer = null;
  clearInterval(_bgPresenceTimer);  _bgPresenceTimer  = null;
  _vcStopUserCallChannel();
  endVoiceCall(false); // clean up any active call
  closeSidebar();
  cleanupAllSubs();
  App.unread = {};
  App.messages = [];
  App.chats = [];
  App._memberCache = {};
  try { await supabaseClient.auth.signOut(); } catch (e) {
    App.session = null; App.currentUser = null; App.currentProfile = null;
    showScreen('auth');
  }
}

/* ==================== PROFILE ==================== */
async function loadProfile() {
  if (!App.currentUser) return;
  try {
    var r = await supabaseClient.from('profiles').select('*').eq('id', App.currentUser.id).single();
    if (r && r.data) {
      App.currentProfile = r.data;
      // Ensure display_name fallback
      if (!App.currentProfile.display_name) {
        App.currentProfile.display_name = App.currentProfile.username || App.currentUser.email.split('@')[0];
      }
    } else {
      App.currentProfile = {
        id: App.currentUser.id,
        username: App.currentUser.email.split('@')[0],
        display_name: App.currentUser.email.split('@')[0],
        avatar_url: null
      };
    }
  } catch(e) {
    console.warn('[Insan] loadProfile error:', e && e.message);
    App.currentProfile = {
      id: App.currentUser.id,
      username: App.currentUser.email.split('@')[0],
      display_name: App.currentUser.email.split('@')[0],
      avatar_url: null
    };
  }
}

/* ==================== AVATAR UPLOAD ==================== */

var _pendingAvatarUrl = { profile: null, conv: null, cc: null, cg: null };

async function handleAvatarUpload(input, target) {
  var file = input.files && input.files[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) return showToast('Image must be under 5MB', 'error');

  var spinnerId, previewId;
  if      (target === 'profile') { spinnerId = 'ep-avatar-spinner';        previewId = 'ep-avatar-preview'; }
  else if (target === 'conv')    { spinnerId = 'edit-conv-avatar-spinner'; previewId = 'edit-conv-avatar-preview'; }
  else if (target === 'cc')      { spinnerId = 'cc-avatar-spinner';        previewId = 'cc-avatar-preview'; }
  else if (target === 'cg')      { spinnerId = 'cg-avatar-spinner';        previewId = 'cg-avatar-preview'; }
  else                           { spinnerId = 'ep-avatar-spinner';        previewId = 'ep-avatar-preview'; }
  var spinner = $(spinnerId), preview = $(previewId);
  if (spinner) spinner.style.display = 'flex';

  try {
    // Show local preview immediately
    var reader = new FileReader();
    reader.onload = function(e) { if (preview) preview.src = e.target.result; };
    reader.readAsDataURL(file);

    // Upload to Supabase Storage bucket 'avatars'
    var ext = file.name.split('.').pop() || 'jpg';
    var path = 'avatars/' + (App.currentUser ? App.currentUser.id : 'user') + '_' + target + '_' + Date.now() + '.' + ext;
    var { error: upErr } = await supabaseClient.storage.from('avatars').upload(path, file, {
      upsert: true, contentType: file.type
    });
    if (upErr) throw upErr;

    // Get public URL
    var { data: urlData } = supabaseClient.storage.from('avatars').getPublicUrl(path);
    var publicUrl = urlData && urlData.publicUrl;
    if (!publicUrl) throw new Error('Could not get image URL');

    _pendingAvatarUrl[target] = publicUrl;
    if (preview) preview.src = publicUrl;
    showToast('Photo ready — tap Save to apply');
  } catch(err) {
    // Fallback: store local data URL (works even without storage bucket)
    console.warn('Storage upload failed, using local URL:', err.message);
    var reader2 = new FileReader();
    reader2.onload = function(e) {
      _pendingAvatarUrl[target] = e.target.result;
      if (preview) preview.src = e.target.result;
      showToast('Photo ready — tap Save to apply');
    };
    reader2.readAsDataURL(file);
  } finally {
    if (spinner) spinner.style.display = 'none';
    if (input) input.value = '';
  }
}

async function saveProfile() {
  var displayName  = $('ep-display-name') ? $('ep-display-name').value.trim() : '';
  var username     = $('ep-username')     ? $('ep-username').value.trim()      : '';
  var bio          = $('ep-bio')          ? $('ep-bio').value.trim()           : '';
  var avatar_url   = _pendingAvatarUrl.profile || (App.currentProfile && App.currentProfile.avatar_url) || null;

  if (!displayName) return showToast('Apna naam daalo', 'error');
  if (!username)    return showToast('Username daalo', 'error');
  if (username.length < 3) return showToast('Username kam se kam 3 characters ka hona chahiye', 'error');
  if (!/^[a-z0-9_.]+$/.test(username)) return showToast('Username may only contain letters, numbers, _ and .', 'error');

  // Check uniqueness (allow keeping your own username)
  if (username !== (App.currentProfile && App.currentProfile.username)) {
    var { data: taken } = await supabaseClient.from('profiles')
      .select('id').eq('username', username).neq('id', App.currentUser.id).maybeSingle();
    if (taken) return showToast('@' + username + ' is already taken', 'error');
  }

  var saveBtn = $('ep-save-btn');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.innerHTML = '<span class="spinner" style="width:16px;height:16px;margin:0 auto"></span>'; }

  try {
    var upsertData = {
      id: App.currentUser.id,
      username: username,
      display_name: displayName,
      avatar_url: avatar_url || null,
      bio: bio || null
    };
    var { error } = await supabaseClient.from('profiles').upsert(upsertData);
    if (error && error.message.includes('display_name')) {
      // Fallback: old schema without display_name — store display name in bio field
      delete upsertData.display_name;
      var { error: e2 } = await supabaseClient.from('profiles').upsert(upsertData);
      if (e2) throw e2;
    } else if (error) {
      throw error;
    }
    _pendingAvatarUrl.profile = null;
    await loadProfile();
    showToast(I18n.t('profileUpdated'));
    closeModal('modal-editprofile');
    renderSidebarProfile();
    // Refresh chat list to show updated name
    if (App.activeTab === 'chats') loadChats();
  } catch(e) {
    showToast((e && e.message) || 'Could not save', 'error');
  } finally {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save'; }
  }
}

/* ==================== DASHBOARD ==================== */
/* Patch send button for edit mode + wire document context menu */
document.addEventListener('DOMContentLoaded', function() {
  _patchSendForEdit();
  _wireCtxDocLevel();
  _wireMicBtn();
});

function showDashboard() {
  _authReady = true;
  showScreen('dashboard');
  renderSidebarProfile();
  setActiveTab('chats');
  setupPresence();
  subscribeCGBackground();
  _vcStartUserCallChannel();  // listen for incoming calls from any screen
  loadBlockedUsers();
  startBackgroundKeepAlive();
  // Auto-request push permission once after login if not yet decided
  if ('Notification' in window && Notification.permission === 'default') {
    var _alreadyAsked = localStorage.getItem('insan_push_asked');
    if (!_alreadyAsked) {
      setTimeout(function() { requestPushPermission(true); }, 5000);
    }
  }
}

function renderSidebarProfile() {
  var p = App.currentProfile; if (!p) return;
  var img   = $('sb-avatar'), name = $('sb-name'), email = $('sb-email');
  if (img)   img.src          = avatarSrc(p);
  if (name)  name.textContent = p.display_name || p.username || 'User';
  if (email) {
    // Show @username below name, and email in small text
    var uname = p.username ? '@' + p.username : '';
    email.textContent = uname || (App.currentUser && App.currentUser.email) || '';
  }
}

function handleTopbarAction() {
  if      (App.activeTab === 'chats')    openSearch();
  else if (App.activeTab === 'channels') openCGSearch('channel');
  else if (App.activeTab === 'groups')   openCGSearch('group');
}

/* Channel/Group search & discover modal */
var _cgSearchTab = 'channel';
function openCGSearch(type) {
  _cgSearchTab = type || 'channel';
  var inp = $('cg-search-inp'), res = $('cg-search-results');
  if (inp) inp.value = '';
  if (res) res.innerHTML = '<p class="no-results" style="padding:18px 0">Search by name…</p>';
  setCGSearchTab(_cgSearchTab);
  openModal('modal-search-cg');
  setTimeout(function() { if (inp) inp.focus(); }, 150);
}

function setCGSearchTab(type) {
  _cgSearchTab = type;
  var chTab = $('cg-stab-channel'), grTab = $('cg-stab-group');
  if (chTab) chTab.classList.toggle('active', type === 'channel');
  if (grTab) grTab.classList.toggle('active', type === 'group');
  var title = $('cg-search-title');
  if (title) title.textContent = type === 'channel' ? 'Find Channels' : 'Find Groups';
  var q = $('cg-search-inp') ? $('cg-search-inp').value.trim() : '';
  if (q.length >= 3) searchChannelsGroups(q);
  else {
    var res = $('cg-search-results');
    if (res) res.innerHTML = '<p class="no-results" style="padding:18px 0">Search by name…</p>';
  }
}

var _searchCGTimer = null;
function searchChannelsGroups(query) {
  clearTimeout(_searchCGTimer);
  var res = $('cg-search-results'); if (!res) return;
  var q = (query || '').trim();
  if (!q) {
    res.innerHTML = '<p class="no-results" style="padding:18px 0">Search by name…</p>';
    return;
  }
  if (q.length < 3) {
    res.innerHTML = '<p class="no-results" style="padding:18px 0">Type at least 3 letters…</p>';
    return;
  }
  res.innerHTML = '<div style="display:flex;justify-content:center;padding:24px"><span class="spinner" style="border-color:var(--border);border-top-color:var(--accent)"></span></div>';
  _searchCGTimer = setTimeout(function() { _doSearchCG(q); }, 300);
}

async function _doSearchCG(q) {
  var res = $('cg-search-results'); if (!res) return;
  try {
    var table = _cgSearchTab === 'channel' ? 'channels' : 'groups';
    var memberTable = _cgSearchTab === 'channel' ? 'channel_members' : 'group_members';
    var idField = _cgSearchTab === 'channel' ? 'channel_id' : 'group_id';

    var r = await supabaseClient.from(table)
      .select('id, name, description, avatar_url')
      .ilike('name', '%' + q + '%')
      .limit(20);

    var items = r.data || [];
    if (!items.length) {
      res.innerHTML = '<div class="search-empty">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="40" height="40"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>' +
        '<p>"' + esc(q) + '" — no results found</p></div>';
      return;
    }

    // Check which ones the user has already joined
    var myRows = [];
    if (App.currentUser) {
      var mr = await supabaseClient.from(memberTable).select(idField)
        .eq('user_id', App.currentUser.id);
      myRows = (mr.data || []).map(function(r) { return r[idField]; });
    }

    res.innerHTML = items.map(function(item) {
      var joined = myRows.indexOf(item.id) >= 0;
      var av = avatarSrc({ username: item.name, avatar_url: item.avatar_url });
      var pill = _cgSearchTab === 'channel'
        ? '<span class="cg-type-pill channel">Channel</span>'
        : '<span class="cg-type-pill group">Group</span>';
      return '<div class="cg-search-result">' +
        '<img src="' + av + '" class="cg-avatar" alt="" style="width:42px;height:42px">' +
        '<div class="cg-search-result-info">' +
          '<div class="cg-search-result-name">' + esc(item.name) + ' ' + pill + '</div>' +
          (item.description ? '<div class="cg-search-result-sub">' + esc(item.description.slice(0,50)) + '</div>' : '') +
        '</div>' +
        '<button class="cg-join-btn ' + (joined ? 'joined' : '') + '" ' +
          'onclick="' + (joined
            ? (_cgSearchTab === 'channel'
                ? 'closeModal(&quot;modal-search-cg&quot;);openChannel(&quot;'+item.id+'&quot;)'
                : 'closeModal(&quot;modal-search-cg&quot;);openGroup(&quot;'+item.id+'&quot;)')
            : '_joinCG(&quot;'+item.id+'&quot;,&quot;'+_cgSearchTab+'&quot;,this)') + '">' +
          (joined ? 'Open' : 'Join') +
        '</button>' +
      '</div>';
    }).join('');
  } catch(e) {
    console.error('searchChannelsGroups:', e);
    res.innerHTML = '<p class="no-results">Something went wrong — please try again</p>';
  }
}

async function _joinCG(id, type, btn) {
  if (!App.currentUser || !id) return;
  if (btn) { btn.disabled = true; btn.textContent = '...'; }
  try {
    var table = type === 'channel' ? 'channel_members' : 'group_members';
    var idField = type === 'channel' ? 'channel_id' : 'group_id';
    var payload = { user_id: App.currentUser.id }; payload[idField] = id;
    var { error } = await supabaseClient.from(table).insert(payload);
    if (error && !error.message.includes('duplicate')) throw error;
    if (btn) { btn.disabled = false; btn.textContent = 'Open'; btn.classList.add('joined'); }
    showToast(type === 'channel' ? 'Joined channel! 📢' : 'Joined group! 👥');
    // Refresh after joining
    if (App.activeTab === (type === 'channel' ? 'channels' : 'groups')) {
      setTimeout(function() { type === 'channel' ? loadChannels() : loadGroups(); }, 300);
    }
  } catch(e) {
    if (btn) { btn.disabled = false; btn.textContent = 'Join'; }
    showToast((e && e.message) || 'Could not join', 'error');
  }
}

function setActiveTab(tab) {
  App.activeTab = tab;
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  const titleEl = $('topbar-title');
  if (titleEl) titleEl.textContent = tab === 'chats' ? 'Insan' : tab === 'channels' ? 'Channels' : 'Groups';
  const actionBtn = $('topbar-action-btn');
  if (actionBtn) {
    var SEARCH_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
    var PLUS_SVG   = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
    // Show search icon for all tabs (search users for chats, search channels/groups for those tabs)
    actionBtn.innerHTML = SEARCH_SVG;
    actionBtn.title = tab === 'chats' ? 'Find people' : tab === 'channels' ? 'Find channels' : 'Find groups';
  }
  if (tab === 'chats')         loadChats();
  else if (tab === 'channels') loadChannels();
  else                         loadGroups();
}

/* ==================== CHAT LIST ==================== */
async function loadChats() {
  const listEl = $('chat-list'); if (!listEl || !App.currentUser) return;
  var now = Date.now();
  // If we loaded < 4s ago and already have data, just re-render from cache (fast path)
  if (App.chats && App.chats.length > 0 && now - App._lastLoadMs.chats < 4000) {
    await renderChatList(App.chats); return;
  }
  App._lastLoadMs.chats = now;
  listEl.innerHTML = renderSkeletons(5);
  try {
    const { data: myRows, error: e1 } = await supabaseClient
      .from('chat_members').select('chat_id').eq('user_id', App.currentUser.id);
    if (e1) throw e1;
    if (!myRows || myRows.length === 0) { listEl.innerHTML = emptyChatsHtml(); return; }
    const chatIds = myRows.map(r => r.chat_id);
    const { data: chats, error: e2 } = await supabaseClient
      .from('chats')
      .select('*, chat_members(user_id), messages(content, created_at, sender_id)')
      .in('id', chatIds);
    if (e2) throw e2;
    App.chats = chats || [];
    await renderChatList(App.chats);
    const newIds = chatIds.filter(id => !App.subscribedListIds.has(id));
    if (newIds.length > 0) subscribeToChatList(newIds);
  } catch (e) {
    console.error('loadChats:', e);
    listEl.innerHTML = emptyChatsHtml();
  }
}


/* ── Prettify raw message content for chat-list preview ── */
function _previewContent(c) {
  if (!c) return '';
  if (/^🎙[\uFE0F]? \[voice:/.test(c) || /\/voice\//.test(c))  return '🎙 Voice message';
  if (/^🎵 \[audio:/.test(c))  return '🎵 Audio file';
  if (/^🎬 \[video:/.test(c))  return '🎬 Video';
  if (/^📷 \[image:/.test(c))  return '📷 Photo';
  if (/^📎 \[file:/.test(c))   { var m = c.match(/📎 \[file:([^:]+):/); return '📎 ' + (m ? m[1] : 'File'); }
  return c;
}

async function renderChatList(chats) {
  const listEl = $('chat-list'); if (!listEl) return;
  if (!chats || chats.length === 0) { listEl.innerHTML = emptyChatsHtml(); return; }

  // Batch-fetch all uncached peer profiles in ONE query instead of N individual calls
  var uncachedPeerIds = [];
  chats.forEach(function(chat) {
    (chat.chat_members || []).forEach(function(m) {
      if (m.user_id !== App.currentUser.id && !App._memberCache[m.user_id]) {
        uncachedPeerIds.push(m.user_id);
      }
    });
  });
  if (uncachedPeerIds.length > 0) {
    try {
      var bRes = await supabaseClient.from('profiles').select('*').in('id', uncachedPeerIds);
      (bRes.data || []).forEach(function(p) { App._memberCache[p.id] = p; });
    } catch(_) {}
  }

  // Build enriched list purely from cache — no more per-chat awaits
  const enriched = chats.map(function(chat) {
    const peerIds = (chat.chat_members || []).map(m => m.user_id).filter(id => id !== App.currentUser.id);
    const profile = peerIds.length > 0 ? (App._memberCache[peerIds[0]] || null) : null;
    const msgs = (chat.messages || []).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return { chat, profile, lastMsg: msgs[0] || null };
  });

  // Hide chats where the peer is blocked — they disappear until unblocked
  const visible = enriched.filter(function(item) {
    return !item.profile || !isUserBlocked(item.profile.id);
  });

  if (visible.length === 0) { listEl.innerHTML = emptyChatsHtml(); return; }

  visible.sort((a, b) => {
    const ta = a.lastMsg ? new Date(a.lastMsg.created_at) : new Date(a.chat.created_at);
    const tb = b.lastMsg ? new Date(b.lastMsg.created_at) : new Date(b.chat.created_at);
    return tb - ta;
  });
  listEl.innerHTML = visible.map(({ chat, profile, lastMsg }) => {
    const online = profile && App.onlineUsers.has(profile.id);
    const unread = App.unread[chat.id] || 0;
    return '<div class="chat-item" onclick="openChat(\'' + chat.id + '\',\'' + (profile ? profile.id : '') + '\')">' +
      '<div class="avatar-wrap">' +
        '<img src="' + avatarSrc(profile) + '" class="avatar" alt="">' +
        (online ? '<span class="online-dot"></span>' : '') +
      '</div>' +
      '<div class="chat-meta">' +
        '<div class="chat-row">' +
          '<span class="chat-name">' + esc(profile ? (profile.display_name || profile.username || 'Unknown') : 'Unknown') + '</span>' +
          '<span class="chat-time">' + fmtTime(lastMsg && lastMsg.created_at) + '</span>' +
        '</div>' +
        '<div class="chat-row2">' +
          '<span class="chat-preview">' + (lastMsg ? esc(_previewContent(lastMsg.content).substring(0, 42)) : 'Start chatting') + '</span>' +
          (unread > 0 ? '<span class="unread-badge">' + unread + '</span>' : '') +
        '</div>' +
      '</div>' +
    '</div>';
  }).join('');
}

function renderSkeletons(n) {
  return Array(n).fill(0).map(() =>
    '<div class="chat-item sk-item">' +
      '<div class="skeleton sk-avatar"></div>' +
      '<div class="chat-meta">' +
        '<div class="skeleton sk-line sk-w32"></div>' +
        '<div class="skeleton sk-line sk-w48 sk-mt"></div>' +
      '</div>' +
    '</div>'
  ).join('');
}

function emptyChatsHtml() {
  return '<div class="empty-state">' +
    '<div class="empty-icon"><svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></div>' +
    '<p class="empty-title">' + I18n.t('noChats') + '</p>' +
    '<p class="empty-desc">' + I18n.t('noChatsDesc') + '</p>' +
  '</div>';
}

/* ==================== CHANNEL LIST ==================== */
var _cachedChannels = null;
async function loadChannels() {
  const listEl = $('chat-list'); if (!listEl || !App.currentUser) return;
  var now = Date.now();
  if (_cachedChannels && now - App._lastLoadMs.channels < 4000) {
    listEl.innerHTML = _cachedChannels; return;
  }
  App._lastLoadMs.channels = now;
  listEl.innerHTML = renderSkeletons(4);
  try {
    const { data: myRows, error: e1 } = await supabaseClient
      .from('channel_members').select('channel_id').eq('user_id', App.currentUser.id);
    if (e1) throw e1;
    if (!myRows || myRows.length === 0) { listEl.innerHTML = emptyChannelsHtml(); return; }
    const channelIds = myRows.map(r => r.channel_id);
    const { data: channels, error: e2 } = await supabaseClient
      .from('channels').select('*').in('id', channelIds).order('created_at', { ascending: false });
    if (e2) throw e2;
    if (!channels || channels.length === 0) { listEl.innerHTML = emptyChannelsHtml(); return; }
    // Batch: fetch recent messages for ALL channels in one query, then group in JS
    const { data: recentChMsgs } = await supabaseClient
      .from('channel_messages')
      .select('channel_id, content, created_at')
      .in('channel_id', channelIds)
      .order('created_at', { ascending: false })
      .limit(Math.max(channelIds.length * 3, 30));
    // Build a map: channel_id -> latest message (already sorted desc)
    const chLastMsgMap = {};
    (recentChMsgs || []).forEach(function(m) {
      if (!chLastMsgMap[m.channel_id]) chLastMsgMap[m.channel_id] = m;
    });
    const enriched = channels.map(function(ch) {
      return { ch, lastMsg: chLastMsgMap[ch.id] || null };
    });
    var chHtml = enriched.map(function(item) {
      var ch = item.ch, lastMsg = item.lastMsg;
      var unread = App.unread[ch.id] || 0;
      return '<div class="cg-item" onclick="openChannel(\'' + ch.id + '\')">' +
        '<img src="' + avatarSrc({ username: ch.name, avatar_url: ch.avatar_url }) + '" class="cg-avatar" alt="">' +
        '<div class="cg-meta">' +
          '<div class="cg-row">' +
            '<span class="cg-name">' + esc(ch.name) + ' <span class="cg-type-pill channel">Channel</span></span>' +
            '<span class="cg-time">' + fmtTime(lastMsg && lastMsg.created_at) + '</span>' +
          '</div>' +
          '<div class="cg-row2">' +
            '<span class="cg-preview">' + (lastMsg ? esc(_previewContent(lastMsg.content).substring(0, 42)) : esc(ch.description || 'No posts yet')) + '</span>' +
            (unread > 0 ? '<span class="cg-badge channel">' + unread + '</span>' : '') +
          '</div>' +
        '</div>' +
      '</div>';
    }).join('');
    _cachedChannels = chHtml;
    listEl.innerHTML = chHtml;
  } catch (e) {
    console.error('loadChannels:', e);
    listEl.innerHTML = '<div class="empty-state"><p class="empty-title">Error</p><p class="empty-desc">' + esc(e.message) + '</p></div>';
  }
}

function emptyChannelsHtml() {
  return '<div class="empty-cg-state">' +
    '<div class="empty-cg-icon channel"><svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg></div>' +
    '<p class="empty-cg-title">No channels yet</p>' +
    '<p class="empty-cg-desc">Create a channel to broadcast messages</p>' +
    '<button class="empty-cg-btn channel" onclick="openCreateChannel()">+ Create Channel</button>' +
  '</div>';
}

/* ==================== GROUP LIST ==================== */
var _cachedGroups = null;
async function loadGroups() {
  const listEl = $('chat-list'); if (!listEl || !App.currentUser) return;
  var now = Date.now();
  if (_cachedGroups && now - App._lastLoadMs.groups < 4000) {
    listEl.innerHTML = _cachedGroups; return;
  }
  App._lastLoadMs.groups = now;
  listEl.innerHTML = renderSkeletons(4);
  try {
    const { data: myRows, error: e1 } = await supabaseClient
      .from('group_members').select('group_id').eq('user_id', App.currentUser.id);
    if (e1) throw e1;
    if (!myRows || myRows.length === 0) { listEl.innerHTML = emptyGroupsHtml(); return; }
    const groupIds = myRows.map(r => r.group_id);
    const { data: groups, error: e2 } = await supabaseClient
      .from('groups').select('*').in('id', groupIds).order('created_at', { ascending: false });
    if (e2) throw e2;
    if (!groups || groups.length === 0) { listEl.innerHTML = emptyGroupsHtml(); return; }
    // Batch: fetch recent messages for ALL groups in one query, then group in JS
    const { data: recentGrMsgs } = await supabaseClient
      .from('group_messages')
      .select('group_id, content, created_at, profiles(username)')
      .in('group_id', groupIds)
      .order('created_at', { ascending: false })
      .limit(Math.max(groupIds.length * 3, 30));
    const grLastMsgMap = {};
    (recentGrMsgs || []).forEach(function(m) {
      if (!grLastMsgMap[m.group_id]) grLastMsgMap[m.group_id] = m;
    });
    const enriched = groups.map(function(g) {
      return { g, lastMsg: grLastMsgMap[g.id] || null };
    });
    var grHtml = enriched.map(function(item) {
      var g = item.g, lastMsg = item.lastMsg;
      var unread = App.unread[g.id] || 0;
      var preview = lastMsg
        ? esc((lastMsg.profiles ? lastMsg.profiles.username + ': ' : '') + _previewContent(lastMsg.content).substring(0, 36))
        : esc(g.description || 'No messages yet');
      return '<div class="cg-item" onclick="openGroup(\'' + g.id + '\')">' +
        '<img src="' + avatarSrc({ username: g.name, avatar_url: g.avatar_url }) + '" class="cg-avatar" alt="">' +
        '<div class="cg-meta">' +
          '<div class="cg-row">' +
            '<span class="cg-name">' + esc(g.name) + ' <span class="cg-type-pill group">Group</span></span>' +
            '<span class="cg-time">' + fmtTime(lastMsg && lastMsg.created_at) + '</span>' +
          '</div>' +
          '<div class="cg-row2">' +
            '<span class="cg-preview">' + preview + '</span>' +
            (unread > 0 ? '<span class="cg-badge group">' + unread + '</span>' : '') +
          '</div>' +
        '</div>' +
      '</div>';
    }).join('');
    _cachedGroups = grHtml;
    listEl.innerHTML = grHtml;
  } catch (e) {
    console.error('loadGroups:', e);
    listEl.innerHTML = '<div class="empty-state"><p class="empty-title">Error</p><p class="empty-desc">' + esc(e.message) + '</p></div>';
  }
}

function emptyGroupsHtml() {
  return '<div class="empty-cg-state">' +
    '<div class="empty-cg-icon group"><svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></div>' +
    '<p class="empty-cg-title">No groups yet</p>' +
    '<p class="empty-cg-desc">Create a group to chat with multiple people</p>' +
    '<button class="empty-cg-btn group" onclick="openCreateGroup()">+ Create Group</button>' +
  '</div>';
}

/* ==================== OPEN CHAT ==================== */
var _openingConv = false; // guard against rapid tap opening multiple convs

async function openChat(chatId, peerId) {
  if (_openingConv) return;
  _openingConv = true;
  cleanupChatScreenSubs();
  App.activeChatId   = chatId;
  App.activeConvType = 'chat';
  App.activeConvData = null;
  App.activeConvRole = null;
  App.unread[chatId] = 0;

  let profile = null;

  // Resolve peerId from chat members if not provided or empty
  if (!peerId) {
    try {
      var mRes = await supabaseClient.from('chat_members').select('user_id').eq('chat_id', chatId);
      var others = (mRes.data || []).filter(function(m) { return m.user_id !== App.currentUser.id; });
      if (others.length > 0) peerId = others[0].user_id;
    } catch(e) { console.warn('openChat member lookup:', e && e.message); }
  }

  App.activePeerId = peerId;

  if (peerId) {
    // Check cache first to avoid extra DB call
    if (App._memberCache[peerId]) {
      profile = App._memberCache[peerId];
      if (!profile.id) profile.id = peerId; // ensure id is always set
    } else {
      try {
        const { data } = await supabaseClient.from('profiles').select('*').eq('id', peerId).single();
        profile = data;
        if (profile) App._memberCache[profile.id] = profile;
      } catch(e) { console.warn('openChat profile fetch:', e && e.message); }
    }
    App.activeConvData = profile;
  }

  showScreen('chat');
  const online = peerId && App.onlineUsers.has(peerId);

  var headerHtml =
    '<button class="back-btn" onclick="closeConv()">' +
      '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg>' +
    '</button>' +
    '<img src="' + avatarSrc(profile) + '" class="avatar avatar-sm" alt="" style="cursor:pointer" onclick="viewPeerProfile()">' +
    '<div class="chat-header-info" style="cursor:pointer" onclick="viewPeerProfile()">' +
      '<span class="chat-header-name">' + esc(profile ? (profile.display_name || profile.username || 'Chat') : 'Chat') + '</span>' +
      '<span class="chat-header-status ' + (online ? 'is-online' : '') + '">' + (online ? I18n.t('online') : I18n.t('offline')) + '</span>' +
    '</div>';
  $('chat-header').innerHTML = headerHtml;
  App._activePeerStatus = { peerId: peerId || null, headerEl: 'chat-header', type: 'chat' };

  $('msg-input-area').style.display = '';
  $('readonly-banner').style.display = 'none';
  // Remove any stale blocked banner from previous chat
  var oldBanner = $('blocked-chat-banner');
  if (oldBanner) oldBanner.remove();
  var inp = $('msg-input');
  if (inp) {
    inp.placeholder = 'Type a message…';
    inp.value = ''; // clear on open
    inp.dataset.editingMsgId = '';
    inp.onkeydown = function(e) {
      if (e.key === 'Enter' && !e.shiftKey && getSetting('enter_send')) {
        e.preventDefault(); sendMessage();
      }
    };
  }
  _updateSendMicVis(); // reset send/mic visibility

  App.messages = []; // clear before subscribing so buffer starts fresh
  _openingConv = false;
  _msgReactions = {}; // clear reactions for new conversation
  subscribeMessages('chat', chatId); // subscribe FIRST — no messages missed during history fetch
  subscribeTyping(chatId);
  await loadConvMessages('chat', chatId); // fetch history, merges with any realtime buffer
  _loadReactionsForConv(chatId, 'chat'); // load reactions (best-effort, async)
  // Show blocked banner if this user is blocked
  _updateBlockedBannerForChat();

  // Join voice-call signal channel for this chat to receive incoming calls
  _vcSubscribeIncoming(chatId);

  // Show voice call button with phone icon for direct chats
  var vcBtn = document.getElementById('voice-call-btn');
  if (vcBtn) { vcBtn.style.display = 'flex'; _setVcBtnIcon('phone'); }
}

/* ==================== OPEN CHANNEL ==================== */
async function openChannel(channelId) {
  if (_openingConv) return;
  // Phone icon for channel voice chat
  var vcBtn = document.getElementById('voice-call-btn');
  if (vcBtn) { vcBtn.style.display = 'flex'; _setVcBtnIcon('phone'); }
  _openingConv = true;
  cleanupChatScreenSubs();
  App.activeChatId      = channelId;
  App.activePeerId      = null;
  App.activeConvType    = 'channel';
  App.unread[channelId] = 0;
  App._activePeerStatus = null; // clear DM online-status tracking

  const { data: channel, error: ce } = await supabaseClient.from('channels').select('*').eq('id', channelId).single();
  if (ce) { _openingConv = false; console.error('openChannel:', ce); showToast('Could not open channel: ' + (ce.message||ce), 'error'); closeConv(); return; }
  const { data: members }  = await supabaseClient.from('channel_members').select('user_id, role').eq('channel_id', channelId);
  App.activeConvData = channel;
  var myMember = (members || []).find(function(m) { return m.user_id === App.currentUser.id; });
  App.activeConvRole = myMember ? myMember.role : 'member';
  var isAdmin = App.activeConvRole === 'admin';
  var memberCount = (members || []).length;

  showScreen('chat');
  var chName = channel ? channel.name : 'Channel';
  var chAvatar = avatarSrc({ username: chName, avatar_url: channel ? channel.avatar_url : null });
  $('chat-header').innerHTML =
    '<button class="back-btn" onclick="closeConv()">' +
      '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg>' +
    '</button>' +
    '<img src="' + chAvatar + '" class="avatar avatar-sm" alt="" style="cursor:pointer" onclick="openConvInfo()">' +
    '<div class="chat-header-info" style="cursor:pointer" onclick="openConvInfo()">' +
      '<span class="chat-header-name">' + esc(chName) + ' <span class="header-type-pill channel">Channel</span></span>' +
      '<span class="chat-header-sub">' + memberCount + ' member' + (memberCount !== 1 ? 's' : '') + '</span>' +
    '</div>';

  if (isAdmin) {
    $('msg-input-area').style.display = '';
    $('readonly-banner').style.display = 'none';
    var inp = $('msg-input');
    if (inp) {
      inp.placeholder = 'Post to channel…';
      inp.value = '';
      inp.dataset.editingMsgId = '';
      inp.onkeydown = function(e) {
        if (e.key === 'Enter' && !e.shiftKey && getSetting('enter_send')) {
          e.preventDefault(); sendMessage();
        }
      };
    }
    _updateSendMicVis();
  } else {
    $('msg-input-area').style.display = 'none';
    $('readonly-banner').style.display = 'flex';
  }

  App.messages = [];
  _openingConv = false;
  _msgReactions = {}; // clear reactions for new conversation
  subscribeMessages('channel', channelId); // subscribe first
  subscribeTyping(channelId);
  await loadConvMessages('channel', channelId);
  _loadReactionsForConv(channelId, 'channel');
}

/* ==================== OPEN GROUP ==================== */
async function openGroup(groupId) {
  if (_openingConv) return;
  // Phone icon for group voice chat
  var vcBtn = document.getElementById('voice-call-btn');
  if (vcBtn) { vcBtn.style.display = 'flex'; _setVcBtnIcon('phone'); }
  _openingConv = true;
  cleanupChatScreenSubs();
  App.activeChatId    = groupId;
  App.activePeerId    = null;
  App.activeConvType  = 'group';
  App.unread[groupId] = 0;
  App._activePeerStatus = null; // clear DM online-status tracking

  const { data: group, error: ge } = await supabaseClient.from('groups').select('*').eq('id', groupId).single();
  if (ge) { _openingConv = false; console.error('openGroup:', ge); showToast('Could not open group: ' + (ge.message||ge), 'error'); closeConv(); return; }
  const { data: members } = await supabaseClient.from('group_members').select('user_id, role').eq('group_id', groupId);
  App.activeConvData = group;
  var myMember = (members || []).find(function(m) { return m.user_id === App.currentUser.id; });
  App.activeConvRole = myMember ? myMember.role : 'member';
  var memberCount = (members || []).length;

  showScreen('chat');
  var gName = group ? group.name : 'Group';
  var gAvatar = avatarSrc({ username: gName, avatar_url: group ? group.avatar_url : null });
  $('chat-header').innerHTML =
    '<button class="back-btn" onclick="closeConv()">' +
      '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg>' +
    '</button>' +
    '<img src="' + gAvatar + '" class="avatar avatar-sm" alt="" style="cursor:pointer" onclick="openConvInfo()">' +
    '<div class="chat-header-info" style="cursor:pointer" onclick="openConvInfo()">' +
      '<span class="chat-header-name">' + esc(gName) + ' <span class="header-type-pill group">Group</span></span>' +
      '<span class="chat-header-sub">' + memberCount + ' member' + (memberCount !== 1 ? 's' : '') + '</span>' +
    '</div>';

  $('msg-input-area').style.display = '';
  $('readonly-banner').style.display = 'none';
  var inp = $('msg-input');
  if (inp) {
    inp.placeholder = 'Message group…';
    inp.value = '';
    inp.dataset.editingMsgId = '';
    inp.onkeydown = function(e) {
      if (e.key === 'Enter' && !e.shiftKey && getSetting('enter_send')) {
        e.preventDefault(); sendMessage();
      }
    };
  }
  _updateSendMicVis();

  App.messages = [];
  _openingConv = false;
  _msgReactions = {}; // clear reactions for new conversation
  subscribeMessages('group', groupId); // subscribe first
  subscribeTyping(groupId);
  await loadConvMessages('group', groupId);
  _loadReactionsForConv(groupId, 'group');
}

function closeConv() {
  cleanupChatScreenSubs();
  App.activeChatId = null; App.activePeerId = null;
  App.activeConvType = 'chat'; App.activeConvData = null; App.activeConvRole = null;
  showScreen('dashboard');
  // Refresh list to update unread counts and last message
  setTimeout(function() {
    if      (App.activeTab === 'chats')    loadChats();
    else if (App.activeTab === 'channels') loadChannels();
    else                                   loadGroups();
  }, 100);
}

/* ==================== MESSAGES ==================== */
async function loadConvMessages(type, id) {
  var area = $('msg-area'); if (!area) return;
  // Preserve any messages already buffered by the realtime subscription
  var realtimeBuffer = App.messages.slice();
  area.innerHTML = msgSkeletons();
  var tableMap = { chat: ['messages','chat_id'], channel: ['channel_messages','channel_id'], group: ['group_messages','group_id'] };
  var pair = tableMap[type];
  try {
    var r = await supabaseClient.from(pair[0]).select('*, profiles(id, username, avatar_url, display_name)').eq(pair[1], id).order('created_at', { ascending: true }).limit(200);
    if (r.error) throw r.error;
    var loaded = r.data || [];
    // For DM chats: filter out any messages from blocked users (history cleanup on block)
    if (type === 'chat') {
      loaded = loaded.filter(function(m) { return !isUserBlocked(m.sender_id); });
    }
    // Merge: history + any realtime messages that arrived during the fetch (dedup by id)
    var loadedIds = new Set(loaded.map(function(m) { return m.id; }));
    var extras = realtimeBuffer.filter(function(m) { return !loadedIds.has(m.id); });
    App.messages = loaded.concat(extras).sort(function(a, b) {
      return new Date(a.created_at) - new Date(b.created_at);
    });
    renderMessages(App.messages, type);
    scrollBottom(false);
  } catch(e) {
    area.innerHTML = '<div class="empty-state"><p class="empty-title">Failed to load</p><p class="empty-desc">' + esc(e.message) + '</p></div>';
  }
}

/* Parse a content string that may encode voice/file/image/audio/video */
function _parseContent(msg) {
  var c = msg.content || '';

  // Uploading (optimistic) placeholder
  if (msg._uploading) {
    var att = msg._attachment || {};
    var k = _getAttachKind(att.type, att.name);
    return { kind: 'uploading', name: att.name || 'File', attKind: k };
  }

  // Voice: 🎙 [voice:dur:url]
  // Comprehensive detection: structured format OR raw voice URL in content
  var _isVoice = msg._voiceUrl || /^🎙[\uFE0F]? \[voice:/.test(c);
  // Also catch raw Supabase voice URLs stored without wrapper (fallback for old/broken messages)
  var _rawVoiceUrl = null;
  if (!_isVoice && /^https?:\/\//i.test(c) && /\/voice\/[^\s]+\.(webm|ogg|m4a|mp3|opus)/i.test(c)) {
    var _rawMatch = c.match(/^(https?:\/\/[^\s]+\/voice\/[^\s]+\.(webm|ogg|m4a|mp3|opus)[^\s]*)$/i);
    if (_rawMatch) { _isVoice = true; _rawVoiceUrl = _rawMatch[1]; }
  }
  if (_isVoice) {
    var vurl = msg._voiceUrl || _rawVoiceUrl || '';
    var durS = '0:00';
    // Try structured format first: 🎙 [voice:M:SS:url]
    var vm = c.match(/^🎙[\uFE0F]? \[voice:(\d+:\d{2}):(.+)\]$/);
    if (vm) { durS = vm[1]; if (!vurl) vurl = vm[2]; }
    else {
      // Fallback: find first http URL in the bracket content
      var vmF = c.match(/^🎙[\uFE0F]? \[voice:(.+)\]$/);
      if (vmF) {
        var inner = vmF[1], httpI = inner.indexOf('http');
        if (httpI >= 0) {
          if (!vurl) vurl = inner.slice(httpI);
          var durPart = inner.slice(0, httpI).replace(/:$/, '');
          if (/^\d+:\d{2}$/.test(durPart)) durS = durPart;
        } else if (!vurl) vurl = inner;
      }
    }
    if (!durS || durS === '0:00') {
      var dv = msg._voiceDuration || 0;
      if (dv) durS = Math.floor(dv/60) + ':' + String(dv%60).padStart(2,'0');
    }
    if (!vurl) return { kind: 'text', text: c };
    return { kind: 'voice', url: vurl, dur: durS };
  }
  // Audio: 🎵 [audio:name:url]
  if (/^🎵 \[audio:/.test(c)) {
    var am = c.match(/^🎵 \[audio:([^:]+):(.+)\]$/);
    if (am) return { kind: 'audio', name: am[1], url: am[2] };
  }
  if (msg._isAttachMsg && msg._attachment && msg._attachment.kind === 'audio') {
    return { kind: 'audio', url: msg._attachment.url, name: msg._attachment.name };
  }
  // Video: 🎬 [video:name:url]
  if (/^🎬 \[video:/.test(c)) {
    var vvm = c.match(/^🎬 \[video:([^:]+):(.+)\]$/);
    if (vvm) return { kind: 'video', name: vvm[1], url: vvm[2] };
  }
  if (msg._isAttachMsg && msg._attachment && msg._attachment.kind === 'video') {
    return { kind: 'video', url: msg._attachment.url, name: msg._attachment.name };
  }
  // Image: 📷 [image:name:url]
  if (msg._isAttachMsg && msg._attachment && msg._attachment.isImage) {
    return { kind: 'image', url: msg._attachment.url, name: msg._attachment.name };
  }
  if (/^📷 \[image:/.test(c)) {
    var im = c.match(/^📷 \[image:([^:]+):(.+)\]$/);
    if (im) return { kind: 'image', name: im[1], url: im[2] };
  }
  // File: 📎 [file:name:size:url]
  if (msg._isAttachMsg && msg._attachment && !msg._attachment.isImage) {
    return { kind: 'file', url: msg._attachment.url, name: msg._attachment.name,
             size: msg._attachment.size ? _fmtBytes(msg._attachment.size) : '' };
  }
  if (/^📎 \[file:/.test(c)) {
    var fm = c.match(/^📎 \[file:([^:]+):([^:]+):(.+)\]$/);
    if (fm) return { kind: 'file', name: fm[1], size: fm[2], url: fm[3] };
  }
  return { kind: 'text', text: c };
}

function _renderMsgContent(msg, isMe, type) {
  var p = _parseContent(msg);

  // ── Uploading spinner ──────────────────────────────────────────────────────
  if (p.kind === 'uploading') {
    var iconSvg = p.attKind === 'image'
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>'
      : p.attKind === 'audio'
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>'
        : p.attKind === 'video'
          ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>'
          : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>';
    return '<div class="uploading-bubble">' +
      '<div class="uploading-spinner">' +
        '<svg class="upload-ring" viewBox="0 0 36 36" width="42" height="42">' +
          '<circle class="upload-ring-track" cx="18" cy="18" r="15" fill="none" stroke-width="3"/>' +
          '<circle class="upload-ring-fill" cx="18" cy="18" r="15" fill="none" stroke-width="3" stroke-dasharray="94" stroke-dashoffset="94">' +
            '<animateTransform attributeName="transform" type="rotate" dur="1s" from="0 18 18" to="360 18 18" repeatCount="indefinite"/>' +
          '</circle>' +
          '<g transform="translate(9,9)">' + iconSvg + '</g>' +
        '</svg>' +
      '</div>' +
      '<div class="uploading-label">' +
        '<span class="uploading-name">' + esc(p.name) + '</span>' +
        '<span class="uploading-status">Sending…</span>' +
      '</div>' +
    '</div>';
  }

  // ── Voice message — instant player, click play to start ──
  if (p.kind === 'voice') {
    var audioId  = 'rmsg-audio-'  + msg.id.replace(/[^a-zA-Z0-9]/g,'_');
    return '<div class="audio-msg voice-player" id="player-' + audioId + '">' +
        '<audio id="' + audioId + '" data-src="' + esc(p.url) + '" preload="none" style="display:none"></audio>' +
        '<button class="audio-play-btn" id="playbtn-' + audioId + '" onclick="_voicePlayInstant(\'' + audioId + '\',this)">' +
          '<svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><polygon points="5 3 19 12 5 21 5 3"/></svg>' +
        '</button>' +
        '<div class="audio-progress-wrap">' +
          '<div class="audio-progress-track" id="track-' + audioId + '" onclick="_seekAudio(\'' + audioId + '\',event)">' +
            '<div class="audio-progress-fill" id="fill-' + audioId + '"></div>' +
          '</div>' +
          '<div class="audio-duration" id="dur-' + audioId + '">' + esc(p.dur || '0:00') + '</div>' +
        '</div>' +
      '</div>';
  }

  // ── Audio file (mp3 etc) ────────────────────────────────────────────────────
  if (p.kind === 'audio') {
    var aid = 'rmsg-audio-' + msg.id.replace(/[^a-zA-Z0-9]/g,'_');
    return '<div class="audio-file-msg">' +
      '<audio id="' + aid + '" data-src="' + esc(p.url) + '" preload="none"></audio>' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18" style="flex-shrink:0;opacity:.7"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>' +
      '<div class="audio-file-info">' +
        '<span class="audio-file-name">' + esc(p.name) + '</span>' +
        '<div class="audio-msg" style="margin-top:6px">' +
          '<button class="audio-play-btn" onclick="_toggleAudio(\''+aid+'\',this)">' +
            '<svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13"><polygon points="5 3 19 12 5 21 5 3"/></svg>' +
          '</button>' +
          '<div class="audio-progress-wrap">' +
            '<div class="audio-progress-track" id="track-'+aid+'" onclick="_seekAudio(\''+aid+'\',event)">' +
              '<div class="audio-progress-fill" id="fill-'+aid+'"></div>' +
            '</div>' +
            '<div class="audio-duration" id="dur-'+aid+'">0:00</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  // ── Video ────────────────────────────────────────────────────────────────────
  if (p.kind === 'video') {
    return '<div class="video-msg">' +
      '<video class="video-preview" src="' + esc(p.url) + '" controls preload="metadata" playsinline ' +
             'style="max-width:240px;max-height:180px;border-radius:10px;display:block"></video>' +
      '<div class="video-caption">' + esc(p.name) + '</div>' +
    '</div>';
  }

  // ── Image ────────────────────────────────────────────────────────────────────
  if (p.kind === 'image') {
    return '<img class="attach-img" src="' + esc(p.url) + '" alt="' + esc(p.name) + '" ' +
           'onclick="_openImageFull(\'' + esc(p.url) + '\')">';
  }

  // ── Generic file ─────────────────────────────────────────────────────────────
  if (p.kind === 'file') {
    var fileExt = (p.name || '').split('.').pop().toLowerCase();
    var openableExts = ['pdf','txt','csv','json','xml','html','htm','png','jpg','jpeg','gif','webp','svg','mp4','webm','mp3','ogg','wav'];
    var canOpen = openableExts.indexOf(fileExt) >= 0 || (p.url && (p.url.indexOf('image') >= 0 || p.url.indexOf('video') >= 0 || p.url.indexOf('audio') >= 0));
    return '<div class="attach-file" onclick="_openFile(\'' + esc(p.url) + '\',\'' + esc(p.name) + '\')" style="cursor:pointer" title="' + (canOpen ? 'Open file' : 'Download file') + '">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="22" height="22" style="flex-shrink:0;opacity:.7"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>' +
      '<div class="attach-file-info" style="flex:1;min-width:0">' +
        '<div class="attach-file-name">' + esc(p.name) + '</div>' +
        '<div class="attach-file-size">' + esc(p.size) + '</div>' +
      '</div>' +
      '<a href="' + esc(p.url) + '" download="' + esc(p.name) + '" onclick="event.stopPropagation()" style="color:inherit;opacity:.7;flex-shrink:0;padding:4px" title="Download">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="16" height="16"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>' +
      '</a>' +
    '</div>';
  }

  // ── Normal text ──────────────────────────────────────────────────────────────
  return esc(p.text);
}

function _openImageFull(url) {
  // Remove any existing lightbox
  var old = document.getElementById('img-lightbox');
  if (old) old.remove();

  var ov = document.createElement('div');
  ov.id = 'img-lightbox';
  ov.style.cssText = [
    'position:fixed;inset:0;z-index:9999',
    'background:rgba(0,0,0,.94)',
    'display:flex;align-items:center;justify-content:center',
    'cursor:zoom-out',
    'animation:imgLbIn .18s ease'
  ].join(';');

  // Spinner shown while image loads
  var spinner = document.createElement('div');
  spinner.style.cssText = 'position:absolute;width:36px;height:36px;border:3px solid rgba(255,255,255,.15);border-top-color:#fff;border-radius:50%;animation:spin .7s linear infinite';
  ov.appendChild(spinner);

  // Close button
  var closeBtn = document.createElement('button');
  closeBtn.innerHTML = '&times;';
  closeBtn.style.cssText = 'position:absolute;top:16px;right:16px;background:rgba(255,255,255,.15);border:none;color:white;border-radius:50%;width:40px;height:40px;font-size:24px;cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:1;line-height:1';
  closeBtn.onclick = function(e) { e.stopPropagation(); ov.remove(); };
  ov.appendChild(closeBtn);

  var img = document.createElement('img');
  img.style.cssText = 'max-width:95vw;max-height:92vh;border-radius:8px;box-shadow:0 8px 40px rgba(0,0,0,.6);opacity:0;transition:opacity .2s ease;cursor:default';
  img.onload  = function() { spinner.remove(); img.style.opacity = '1'; };
  img.onerror = function() { spinner.remove(); showToast('Could not load image', 'error'); ov.remove(); };
  img.src = url;
  ov.appendChild(img);

  // Tap background to close; don't close when tapping the image itself
  ov.addEventListener('pointerdown', function(e) {
    if (e.target === img) return;
    ov.remove();
  });

  // Keyboard dismiss
  function onKey(e) { if (e.key === 'Escape') { ov.remove(); document.removeEventListener('keydown', onKey); } }
  document.addEventListener('keydown', onKey);
  ov.addEventListener('remove', function() { document.removeEventListener('keydown', onKey); });

  document.body.appendChild(ov);
}

function _wireAudioEvents(area) {
  /* Wire src + events for every <audio data-src="..."> in area */
  var PLAY_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
  area.querySelectorAll('audio[data-src]').forEach(function(audioEl) {
    var id = audioEl.id; if (!id) return;
    // Set src via JS (.src property always returns page URL when no attribute set — use getAttribute)
    if (!audioEl.getAttribute('src')) {
      audioEl.src = _decodeHtmlEntities(audioEl.dataset.src);
      audioEl.preload = 'auto';
      audioEl.load();
    }
    audioEl.ontimeupdate = null; audioEl.onended = null; audioEl.onloadedmetadata = null; audioEl.onerror = null;
    audioEl.ontimeupdate = function() {
      var fill = document.getElementById('fill-' + id);
      if (fill) fill.style.width = (audioEl.duration ? audioEl.currentTime / audioEl.duration * 100 : 0) + '%';
    };
    audioEl.onended = function() {
      // Voice messages use id="playbtn-xxx"; audio file messages use .audio-play-btn in parent
      var btn = document.getElementById('playbtn-' + id);
      if (!btn) {
        var par = audioEl.parentElement;
        btn = par && par.querySelector('.audio-play-btn');
      }
      if (btn) btn.innerHTML = PLAY_SVG;
      var fill = document.getElementById('fill-' + id);
      if (fill) fill.style.width = '0%';
      audioEl.currentTime = 0;
    };
    audioEl.onloadedmetadata = function() {
      var dur = audioEl.duration;
      if (!isFinite(dur) || dur <= 0) return;
      var el = document.getElementById('dur-' + id);
      if (el) el.textContent = _fmtDur(dur);
    };
    audioEl.onerror = function() { showToast('Could not load audio', 'error'); };
    var track = document.getElementById('track-' + id);
    if (track) {
      track.ontouchstart = function(e) { e.preventDefault(); _seekAudio(id, e); };
      track.ontouchmove  = function(e) { e.preventDefault(); _seekAudio(id, e); };
    }
  });
}

function _decodeHtmlEntities(str) {
  return (str || '').replace(/&amp;/g,'&').replace(/&#39;/g,"'").replace(/&quot;/g,'"').replace(/&lt;/g,'<').replace(/&gt;/g,'>');
}

function _fmtDur(secs) {
  var s = Math.floor(secs || 0);
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2,'0');
}


function renderMessages(msgs, type) {
  type = type || App.activeConvType;
  var area = $('msg-area'); if (!area) return;
  if (!msgs || msgs.length === 0) {
    area.innerHTML = '<div class="empty-state"><p class="empty-title">' + I18n.t('noMessages') + '</p><p class="empty-desc">' + I18n.t('noMessagesDesc') + '</p></div>';
    return;
  }
  var isGroupLike = type === 'group' || type === 'channel';
  var html = '', prevDate = null, prevSender = null;
  msgs.forEach(function(msg, i) {
    var isMe   = msg.sender_id === App.currentUser.id;
    var day    = new Date(msg.created_at).toDateString();
    var isLast = i === msgs.length - 1;
    if (day !== prevDate) {
      html += '<div class="date-sep"><span>' + fmtDateLabel(msg.created_at) + '</span></div>';
      prevDate = day; prevSender = null;
    }
    var showAvatar = !isMe && prevSender !== msg.sender_id;
    prevSender = msg.sender_id;
    if (!msg.profiles) msg.profiles = null;
    var bubbleClass = isMe
      ? (type === 'channel' ? 'bubble-channel' : 'bubble-me')
      : (type === 'group'   ? 'bubble-group-them' : 'bubble-them');
    html += '<div class="msg-row ' + (isMe ? 'msg-me' : 'msg-them') + '" id="msg-' + msg.id + '">';
    if (!isMe) {
      var _sid = msg.sender_id || '';
      var _clickAvatar = (_sid && isGroupLike) ? ' style="cursor:pointer" onclick="viewMemberProfile(\''+_sid+'\')"' : '';
      if (showAvatar) html += '<img src="' + avatarSrc(msg.profiles) + '" class="avatar avatar-xs" alt=""' + _clickAvatar + '>';
      else            html += '<span class="msg-avatar-spacer"></span>';
    }
    html += '<div class="msg-bwrap">';
    if (!isMe && showAvatar && isGroupLike && msg.profiles) {
      var _sn = esc((msg.profiles.display_name || msg.profiles.username) || '');
      var _sid2 = msg.sender_id || '';
      html += '<span class="msg-sender-name"' + (_sid2 ? ' style="cursor:pointer" onclick="viewMemberProfile(\''+_sid2+'\')"' : '') + '>' + _sn + '</span>';
    }
    html += '<div class="msg-bubble ' + bubbleClass + '">' + _renderMsgContent(msg, isMe, type) + '</div>';
    html += '<div class="msg-meta ' + (isMe ? 'meta-r' : 'meta-l') + '">';
    html += '<span class="msg-time">' + fmtTime(msg.created_at) + '</span>';
    if (isMe && isLast) html += '<span class="msg-tick">\u2713\u2713</span>';
    html += '</div></div></div>';
  });
  area.innerHTML = html;
  _wireAudioEvents(area);
  _wireContextMenus(area);
  scrollBottom(false);
}

function msgSkeletons() {
  var h = '<div class="sk-msgs">';
  for (var i = 0; i < 6; i++) {
    h += '<div class="sk-msg-row ' + (i % 2 === 0 ? 'sk-msg-r' : 'sk-msg-l') + '"><div class="skeleton sk-bubble"></div></div>';
  }
  return h + '</div>';
}

function scrollBottom(smooth) {
  var a = $('msg-area');
  if (!a) return;
  // requestAnimationFrame ensures DOM is rendered before scroll
  requestAnimationFrame(function() {
    a.scrollTop = a.scrollHeight;
    if (smooth) {
      setTimeout(function() { a.scrollTo({ top: a.scrollHeight, behavior: 'smooth' }); }, 50);
    }
  });
}

/* ==================== SEND MESSAGE ==================== */
var _sendingMsg = false;

async function sendMessage() {
  if (_sendingMsg) return;
  if (!App.activeChatId || !App.currentUser) return;

  // Prevent sending to blocked users
  if (App.activeConvType === 'chat' && App.activePeerId && isUserBlocked(App.activePeerId)) {
    return showToast('You have blocked this user. Unblock to send messages.', 'error');
  }

  var inp = $('msg-input');
  var content = inp ? inp.value.trim() : '';
  var hasAttachments = _attachments && _attachments.length > 0;
  if (!content && !hasAttachments) return;

  // Prepend reply context if replying
  if (_replyToMsg && content) {
    content = '↩ ' + _replyToMsg.senderName + ': "' + _replyToMsg.preview.slice(0, 60) + '"\n' + content;
    _clearReply();
  } else if (_replyToMsg) {
    _clearReply();
  }

  // Capture context before any async (race condition guard)
  var type = App.activeConvType;
  var id   = App.activeChatId;
  var tableMap = { chat: ['messages','chat_id'], channel: ['channel_messages','channel_id'], group: ['group_messages','group_id'] };
  var pair = tableMap[type];
  if (!pair) return;

  _sendingMsg = true;
  if (inp) { inp.value = ''; inp.style.height = 'auto'; }

  // ── Send attachments (image / audio / video / file) ─────────────────────
  if (hasAttachments) {
    var attCopy = _attachments.slice();
    _attachments = [];
    _renderAttachmentChips();

    for (var ai = 0; ai < attCopy.length; ai++) {
      var att = attCopy[ai];

      // ── Show "sending" optimistic bubble with circular progress ──────────
      var optAttId = 'opt-att-' + Date.now() + '-' + ai;
      var optAttMsg = {
        id: optAttId, sender_id: App.currentUser.id,
        content: '_uploading_', created_at: new Date().toISOString(),
        profiles: App.currentProfile,
        _uploading: true, _attachment: att,
      };
      App.messages.push(optAttMsg);
      appendMessageToDOM(optAttMsg, type);
      scrollBottom(true);

      var uploadedUrl = null;
      var uploadOk = false;

      // ── Upload to Supabase Storage ──────────────────────────────────────
      try {
        var blob = att.url.startsWith('data:') ? _dataURLtoBlob(att.url) : null;
        if (blob && supabaseClient) {
          var ext  = att.name.split('.').pop().toLowerCase() || 'bin';
          var path = 'attachments/' + App.currentUser.id + '_' + Date.now() + '_' + ai + '.' + ext;
          var up = await supabaseClient.storage.from('avatars').upload(path, blob, {
            upsert: true, contentType: att.type
          });
          if (!up.error) {
            var urlData = supabaseClient.storage.from('avatars').getPublicUrl(path);
            uploadedUrl = urlData.data && urlData.data.publicUrl;
            uploadOk = true;
          }
        }
      } catch(uploadErr) {
        console.warn('[Insan] Upload error:', uploadErr);
      }

      if (!uploadedUrl) uploadedUrl = att.url; // fallback to local data URL

      // ── Build encoded content string ────────────────────────────────────
      var attContent;
      var attKind = _getAttachKind(att.type, att.name);
      if      (attKind === 'image') attContent = '📷 [image:'  + esc(att.name) + ':' + uploadedUrl + ']';
      else if (attKind === 'audio') attContent = '🎵 [audio:'  + esc(att.name) + ':' + uploadedUrl + ']';
      else if (attKind === 'video') attContent = '🎬 [video:'  + esc(att.name) + ':' + uploadedUrl + ']';
      else                          attContent = '📎 [file:'   + esc(att.name) + ':' + _fmtBytes(att.size) + ':' + uploadedUrl + ']';

      // ── Save to DB ───────────────────────────────────────────────────────
      var attPayload = { sender_id: App.currentUser.id, content: attContent };
      attPayload[pair[1]] = id;
      try {
        var ar = await supabaseClient.from(pair[0]).insert(attPayload)
          .select('*, profiles(id, username, avatar_url, display_name)').single();
        if (!ar.error && App.activeChatId === id) {
          ar.data._attachment = { name: att.name, size: att.size, type: att.type,
                                   url: uploadedUrl, isImage: attKind === 'image',
                                   kind: attKind };
          ar.data._isAttachMsg = true;
          // Replace optimistic bubble
          App.messages = App.messages.map(function(m) { return m.id === optAttId ? ar.data : m; });
          renderMessages(App.messages, type);
        }
      } catch(dbErr) {
        // Remove optimistic bubble on error
        App.messages = App.messages.filter(function(m) { return m.id !== optAttId; });
        renderMessages(App.messages, type);
        showToast(att.name + ' could not be sent', 'error');
      }
    }
    scrollBottom(true);
  }

  // ── Send text message ────────────────────────────────────────────────────
  if (content && App.activeChatId === id) {
    var optId = 'opt-' + Date.now();
    App.messages.push({ id: optId, sender_id: App.currentUser.id, content: content,
                        created_at: new Date().toISOString(), profiles: App.currentProfile });
    if (App.activeChatId === id) { appendMessageToDOM(App.messages[App.messages.length-1], type); scrollBottom(true); }

    try {
      var payload = { sender_id: App.currentUser.id, content: content };
      payload[pair[1]] = id;
      var r = await supabaseClient.from(pair[0]).insert(payload).select('*, profiles(id, username, avatar_url, display_name)').single();
      if (r.error) throw r.error;
      App.messages = App.messages.map(function(m) { return m.id === optId ? r.data : m; });
      if (App.activeChatId === id) { renderMessages(App.messages, type); scrollBottom(false); }
    } catch(err) {
      App.messages = App.messages.filter(function(m) { return m.id !== optId; });
      if (App.activeChatId === id) renderMessages(App.messages, type);
      if (inp) { inp.value = content; autoResize(inp); }
      showToast((err && err.message) || 'Failed to send', 'error');
    }
  }

  _sendingMsg = false;
  _updateSendMicVis();
}

// Convert base64 data URL to Blob for upload
function _dataURLtoBlob(dataUrl) {
  var arr = dataUrl.split(','), mime = arr[0].match(/:(.*?);/)[1];
  var bstr = atob(arr[1]), n = bstr.length, u8 = new Uint8Array(n);
  while (n--) u8[n] = bstr.charCodeAt(n);
  return new Blob([u8], { type: mime });
}

/* ==================== TYPING ==================== */
function onTyping() {
  if (!App.activeChatId || !App.currentUser || !App.typingChannel) return;
  App.typingChannel.send({ type: 'broadcast', event: 'typing', payload: { user_id: App.currentUser.id, username: (App.currentProfile && App.currentProfile.username) || 'User' } });
  clearTimeout(App.typingTimer);
  // After 2.2s of silence automatically hide the typing bar locally
  App.typingTimer = setTimeout(function() {
    var bar = document.getElementById('typing-bar');
    if (bar) bar.classList.remove('show');
  }, 2200);
}

/* ==================== REALTIME ==================== */
function subscribeMessages(type, id) {
  var tableMap = { chat: ['messages','chat_id'], channel: ['channel_messages','channel_id'], group: ['group_messages','group_id'] };
  var pair = tableMap[type];

  var ch = supabaseClient
    .channel(type + '-msgs:' + id)
    .on('postgres_changes', {
      event:  'INSERT',
      schema: 'public',
      table:  pair[0],
      filter: pair[1] + '=eq.' + id
    }, async function(payload) {

      // Dedup: skip if already in local state (optimistic or history)
      if (App.messages.some(function(m) { return m.id === payload.new.id; })) return;

      // Race-condition fix: for own voice messages, realtime INSERT fires
      // before the upload+insert() response returns, so the optimistic
      // 'voice-opt-XXX' entry is still in App.messages under a different id.
      // Skip the raw realtime push here — _sendVoiceMessage handles replacement.
      if (payload.new.sender_id === (App.currentUser && App.currentUser.id)) {
        var rawC = payload.new.content || '';
        if (rawC.indexOf('🎙 [voice:') === 0) {
          var hasPendingVoiceOpt = App.messages.some(function(m) {
            return typeof m.id === 'string' && m.id.indexOf('voice-opt-') === 0;
          });
          if (hasPendingVoiceOpt) return;
        }
      }

      // Silently drop messages from blocked users
      if (type === 'chat' && isUserBlocked(payload.new.sender_id)) return;

      // Use cached sender profile if available; otherwise fetch
      var senderProfile = App._memberCache[payload.new.sender_id] || null;
      if (!senderProfile && payload.new.sender_id) {
        try {
          var pRes = await supabaseClient.from('profiles').select('*').eq('id', payload.new.sender_id).single();
          senderProfile = pRes.data || null;
          if (senderProfile) App._memberCache[senderProfile.id] = senderProfile;
        } catch (_) {}
      }

      var msg = Object.assign({}, payload.new, { profiles: senderProfile });

      // Append immediately — don't wait for full re-render
      App.messages.push(msg);

      // If the user is currently in this conversation, append to DOM instantly
      if (App.activeChatId === id) {
        appendMessageToDOM(msg, type);
        var area = $('msg-area');
        var nearBottom = area && (area.scrollHeight - area.scrollTop - area.clientHeight) < 160;
        if (nearBottom || payload.new.sender_id === App.currentUser.id) scrollBottom(true);
      }

      // Notification for this conversation is handled by subscribeToChatList (DMs)
      // and subscribeCGBackground (channels/groups) to avoid duplicates.
    })
    .subscribe(function(status, err) {
      if (status === 'SUBSCRIPTION_ERROR') {
        console.warn('[Insan] Realtime subscription error:', err);
        // Retry after 3 seconds
        setTimeout(function() {
          if (App.activeChatId === id) subscribeMessages(type, id);
        }, 3000);
      }
    });

  App.chatScreenSubs.push(ch);
}

/* Append a single new message to the DOM without full re-render */
function appendMessageToDOM(msg, type) {
  var area = $('msg-area'); if (!area) return;

  // If area shows empty/skeleton state, do a full render instead
  if (area.querySelector('.empty-state') || area.querySelector('.sk-msgs')) {
    renderMessages(App.messages, type);
    return;
  }

  var isMe = msg.sender_id === App.currentUser.id;
  var isGroupLike = type === 'group' || type === 'channel';

  // Check if we need a date separator
  var msgs = App.messages;
  var prevMsg = msgs.length >= 2 ? msgs[msgs.length - 2] : null;
  var html = '';
  if (!prevMsg || new Date(prevMsg.created_at).toDateString() !== new Date(msg.created_at).toDateString()) {
    html += '<div class="date-sep"><span>' + fmtDateLabel(msg.created_at) + '</span></div>';
  }

  var showAvatar = !isMe && (!prevMsg || prevMsg.sender_id !== msg.sender_id);
  var bubbleClass = isMe
    ? (type === 'channel' ? 'bubble-channel' : 'bubble-me')
    : (type === 'group' ? 'bubble-group-them' : 'bubble-them');

  html += '<div class="msg-row ' + (isMe ? 'msg-me' : 'msg-them') + '" id="msg-' + msg.id + '">';
  if (!isMe) {
    var _sid = msg.sender_id || '';
    var _clickAvatar = (_sid && isGroupLike) ? ' style="cursor:pointer" onclick="viewMemberProfile(\''+_sid+'\')"' : '';
    if (showAvatar) html += '<img src="' + avatarSrc(msg.profiles) + '" class="avatar avatar-xs" alt=""' + _clickAvatar + '>';
    else            html += '<span class="msg-avatar-spacer"></span>';
  }
  html += '<div class="msg-bwrap">';
  if (!isMe && showAvatar && isGroupLike && msg.profiles) {
    var _sn = esc((msg.profiles.display_name || msg.profiles.username) || '');
    var _sid2 = msg.sender_id || '';
    html += '<span class="msg-sender-name"' + (_sid2 ? ' style="cursor:pointer" onclick="viewMemberProfile(\''+_sid2+'\')"' : '') + '>' + _sn + '</span>';
  }
  html += '<div class="msg-bubble ' + bubbleClass + '">' + _renderMsgContent(msg, isMe, type) + '</div>';
  html += '<div class="msg-meta ' + (isMe ? 'meta-r' : 'meta-l') + '">';
  html += '<span class="msg-time">' + fmtTime(msg.created_at) + '</span>';
  html += '</div></div></div>';

  var el = document.createElement('div');
  el.innerHTML = html;
  while (el.firstChild) area.appendChild(el.firstChild);
  // Wire audio events for newly added message
  _wireAudioEvents(area);

  // Update last message tick on previous bubble if it was mine
  var prevMine = area.querySelectorAll('.msg-me .msg-meta');
  if (prevMine.length > 1) {
    var secondLast = prevMine[prevMine.length - 2];
    var oldTick = secondLast.querySelector('.msg-tick');
    if (oldTick) oldTick.remove();
  }
  if (isMe) {
    var myMeta = area.querySelector('#msg-' + msg.id + ' .msg-meta');
    if (myMeta) myMeta.insertAdjacentHTML('beforeend', '<span class="msg-tick">✓✓</span>');
  }
}

function subscribeTyping(id) {
  var ch = supabaseClient
    .channel('typing:' + id + ':' + Date.now())
    .on('broadcast', { event: 'typing' }, function(ev) {
      var payload = ev.payload;
      if (payload.user_id === App.currentUser.id) return;
      var bar = $('typing-bar');
      if (bar) { bar.textContent = payload.username + ' ' + I18n.t('typing'); bar.classList.add('show'); }
      clearTimeout(App.typingTimers[payload.user_id]);
      App.typingTimers[payload.user_id] = setTimeout(function() { var b = $('typing-bar'); if (b) b.classList.remove('show'); }, 2800);
    }).subscribe();
  App.typingChannel = ch;
  App.chatScreenSubs.push(ch);
}

function subscribeToChatList(newChatIds) {
  if (!newChatIds || newChatIds.length === 0) return;
  newChatIds.forEach(function(chatId) {
    App.subscribedListIds.add(chatId);
    var ch = supabaseClient.channel('list:' + chatId + ':' + Date.now())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: 'chat_id=eq.' + chatId }, function(payload) {
        if (!payload || !payload.new) return;
        var isOwnMsg    = payload.new.sender_id === App.currentUser.id;
        var isForegrounded = chatId === App.activeChatId &&
                             document.visibilityState === 'visible' && !document.hidden;
        // Ignore messages from blocked users entirely — no unread bump, no notification
        if (!isOwnMsg && isUserBlocked(payload.new.sender_id)) return;
        // Increment unread for chats not currently open
        if (!isForegrounded && !isOwnMsg) {
          if (chatId !== App.activeChatId) {
            App.unread[chatId] = (App.unread[chatId] || 0) + 1;
          }
          // Fire notification — this is the single source of truth for DM notifications
          (async function() {
            try {
              var pRes = await supabaseClient.from('profiles').select('username,avatar_url,display_name').eq('id', payload.new.sender_id).single();
              var sp = pRes && pRes.data;
              fireNotification({
                title:    sp ? (sp.display_name || sp.username) : 'New message',
                body:     _previewContent(payload.new.content || ''),
                icon:     sp ? avatarSrc(sp) : 'icons/insan.png',
                convId:   chatId,
                convType: 'chat',
                peerId:   payload.new.sender_id,
              });
            } catch (_) {}
          })();
        }
        // Debounced UI refresh — batch rapid messages into one render
        clearTimeout(App._listRefreshTimer);
        App._listRefreshTimer = setTimeout(refreshChatListUI, 300);
      }).subscribe();
    App.chatListSubs.push(ch);
  });
}

async function refreshChatListUI() {
  if (!App.currentUser || App.activeTab !== 'chats') return;
  // Re-use cached chat list if available; only do a lightweight last-message fetch
  if (!App.chats || App.chats.length === 0) { loadChats(); return; }
  try {
    var chatIds = App.chats.map(function(c) { return c.id; });
    var r = await supabaseClient.from('chats')
      .select('id, updated_at, messages(content, created_at, sender_id)')
      .in('id', chatIds);
    if (r.data) {
      // Merge fresh last-message data into cached chat objects
      var map = {};
      r.data.forEach(function(fresh) { map[fresh.id] = fresh; });
      App.chats = App.chats.map(function(c) {
        return map[c.id] ? Object.assign({}, c, { messages: map[c.id].messages }) : c;
      });
      await renderChatList(App.chats);
    }
  } catch (e) { console.error('refreshChatListUI:', e); }
}

/* ==================== BACKGROUND CHANNEL/GROUP NOTIF SUBS ==================== */
var _cgNotifSubs = [];

function subscribeCGBackground() {
  // Guard: supabaseClient may be null if credentials not configured
  if (!supabaseClient) return;
  // Clean up old subs
  _cgNotifSubs.forEach(function(ch) { try { supabaseClient.removeChannel(ch); } catch (_) {} });
  _cgNotifSubs = [];
  if (!App.currentUser) return;

  // Subscribe to channel_messages for channels the user is in
  supabaseClient.from('channel_members').select('channel_id').eq('user_id', App.currentUser.id)
    .then(function(r) {
      if (!r.data) return;
      r.data.forEach(function(row) {
        var chId = row.channel_id;
        var sub = supabaseClient
          .channel('bg-channel:' + chId + ':' + Date.now())
          .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'channel_messages', filter: 'channel_id=eq.' + chId }, async function(payload) {
            if (payload.new.sender_id === App.currentUser.id) return;
            // Skip only when user is foreground-viewing this exact channel
            var _chVisible = App.activeChatId === chId && document.visibilityState === 'visible' && !document.hidden;
            if (_chVisible) return;
            App.unread[chId] = (App.unread[chId] || 0) + 1;
            _cachedChannels = null; App._lastLoadMs.channels = 0; // invalidate cache
            var pRes = await supabaseClient.from('profiles').select('*').eq('id', payload.new.sender_id).single();
            var chRes = await supabaseClient.from('channels').select('name').eq('id', chId).single();
            fireNotification({
              title:    (chRes.data ? chRes.data.name : 'Channel') + ' (Channel)',
              body:     _previewContent(payload.new.content || ''),
              icon:   pRes.data ? avatarSrc(pRes.data) : '',
              convId:   chId,
              convType: 'channel',
            });
          }).subscribe();
        _cgNotifSubs.push(sub);
      });
    });

  // Subscribe to group_messages
  supabaseClient.from('group_members').select('group_id').eq('user_id', App.currentUser.id)
    .then(function(r) {
      if (!r.data) return;
      r.data.forEach(function(row) {
        var gId = row.group_id;
        var sub = supabaseClient
          .channel('bg-group:' + gId + ':' + Date.now())
          .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'group_messages', filter: 'group_id=eq.' + gId }, async function(payload) {
            if (payload.new.sender_id === App.currentUser.id) return;
            // Skip only when user is foreground-viewing this exact group
            var _grVisible = App.activeChatId === gId && document.visibilityState === 'visible' && !document.hidden;
            if (_grVisible) return;
            App.unread[gId] = (App.unread[gId] || 0) + 1;
            _cachedGroups = null; App._lastLoadMs.groups = 0; // invalidate cache
            var pRes = await supabaseClient.from('profiles').select('*').eq('id', payload.new.sender_id).single();
            var gRes = await supabaseClient.from('groups').select('name').eq('id', gId).single();
            fireNotification({
              title:    (gRes.data ? gRes.data.name : 'Group') + ' (Group)',
              body:     (pRes.data ? pRes.data.username + ': ' : '') + _previewContent(payload.new.content || ''),
              icon:   pRes.data ? avatarSrc(pRes.data) : '',
              convId:   gId,
              convType: 'group',
            });
          }).subscribe();
        _cgNotifSubs.push(sub);
      });
    });
}

function updateOpenChatOnlineStatus() {
  if (!App._activePeerStatus || !App._activePeerStatus.peerId) return;
  var statusEl = document.querySelector('.chat-header-status');
  if (!statusEl) return;
  var online = App.onlineUsers.has(App._activePeerStatus.peerId);
  statusEl.textContent = online ? I18n.t('online') : I18n.t('offline');
  statusEl.className = 'chat-header-status' + (online ? ' is-online' : '');
}

function setupPresence() {
  if (App.presenceCh) { try { supabaseClient.removeChannel(App.presenceCh); } catch (_) {} App.presenceCh = null; }
  App.presenceCh = supabaseClient.channel('online', { config: { presence: { key: App.currentUser.id } } });
  App.presenceCh
    .on('presence', { event: 'sync'  }, function() {
      App.onlineUsers = new Set(Object.keys(App.presenceCh.presenceState()));
      updateOpenChatOnlineStatus();
    })
    .on('presence', { event: 'join'  }, function(ev) {
      App.onlineUsers.add(ev.key);
      updateOpenChatOnlineStatus();
    })
    .on('presence', { event: 'leave' }, function(ev) {
      App.onlineUsers.delete(ev.key);
      updateOpenChatOnlineStatus();
    })
    .subscribe(async function(status) {
      if (status === 'SUBSCRIBED') await App.presenceCh.track({ user_id: App.currentUser.id, at: new Date().toISOString() });
    });
}

/* ==================== SEARCH USERS ==================== */
var _searchUsersTimer = null;
function searchUsers(query) {
  clearTimeout(_searchUsersTimer);
  var results = $('search-results'); if (!results) return;
  var q = (query || '').trim();
  if (!q) {
    results.innerHTML = '<p class="no-results" style="padding:18px 0">Search by @username or name</p>';
    return;
  }
  if (q.length < 3) {
    results.innerHTML = '<p class="no-results" style="padding:18px 0">Type at least 3 letters…</p>';
    return;
  }
  results.innerHTML = '<div style="display:flex;justify-content:center;padding:24px"><span class="spinner" style="border-color:var(--border);border-top-color:var(--accent)"></span></div>';
  _searchUsersTimer = setTimeout(function() { _doSearchUsers(q); }, 300);
}

async function _doSearchUsers(q) {
  var results = $('search-results'); if (!results) return;
  try {
    // Strip @ if typed
    var cleanQ = q.startsWith('@') ? q.slice(1) : q;
    // Search by username OR display_name
    var r = await supabaseClient
      .from('profiles')
      .select('id, username, display_name, avatar_url, bio')
      .neq('id', App.currentUser.id)
      .or('username.ilike.%' + cleanQ + '%,display_name.ilike.%' + cleanQ + '%')
      .limit(25);

    var users = (r.data || []);
    // Fallback: if display_name column doesn't exist, search username only
    if (r.error && r.error.message && r.error.message.includes('display_name')) {
      var r2 = await supabaseClient.from('profiles')
        .select('id, username, avatar_url, bio')
        .neq('id', App.currentUser.id)
        .ilike('username', '%' + cleanQ + '%').limit(25);
      users = r2.data || [];
    }

    if (!users.length) {
      results.innerHTML = '<div class="search-empty">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="40" height="40"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>' +
        '<p>"' + esc(q) + '" — no users found</p></div>';
      return;
    }
    users.forEach(function(p) { App._memberCache[p.id] = p; });
    results.innerHTML = users.map(function(p) {
      var isOnline = App.onlineUsers && App.onlineUsers.has(p.id);
      var displayName = p.display_name || p.username || 'Unknown';
      return '<div class="search-result" onclick="startChatWith(\'' + p.id + '\')">' +
        '<div style="position:relative;flex-shrink:0">' +
          '<img src="' + avatarSrc(p) + '" class="avatar avatar-sm" alt="">' +
          (isOnline ? '<div style="position:absolute;bottom:1px;right:1px;width:10px;height:10px;border-radius:50%;background:#2ECC71;border:2px solid var(--surface)"></div>' : '') +
        '</div>' +
        '<div class="search-result-info">' +
          '<p class="search-display-name">' + esc(displayName) + '</p>' +
          '<p class="search-at-username">@' + esc(p.username || '') + '</p>' +
          (p.bio ? '<p class="search-bio">' + esc(p.bio.length > 38 ? p.bio.slice(0,36)+'…' : p.bio) + '</p>' : '') +
        '</div>' +
        '<button class="start-btn" onclick="event.stopPropagation();startChatWith(\'' + p.id + '\')">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="13" height="13"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg> Chat' +
        '</button>' +
      '</div>';
    }).join('');
  } catch(e) {
    console.error('searchUsers:', e);
    results.innerHTML = '<p class="no-results">Something went wrong — please try again</p>';
  }
}

async function startChatWith(userId) {
  if (!userId || !App.currentUser) return;
  try {
    var r1 = await supabaseClient.from('chat_members').select('chat_id').eq('user_id', App.currentUser.id);
    var myChatIds = (r1.data || []).map(function(r) { return r.chat_id; });
    var chatId = null;
    if (myChatIds.length > 0) {
      var r2 = await supabaseClient.from('chat_members').select('chat_id').eq('user_id', userId).in('chat_id', myChatIds);
      chatId = r2.data && r2.data.length > 0 ? r2.data[0].chat_id : null;
    }
    if (!chatId) {
      var newChatId = crypto.randomUUID();
      var ce = await supabaseClient.from('chats').insert({ id: newChatId });
      if (ce.error) throw ce.error;
      var me = await supabaseClient.from('chat_members').insert([
        { chat_id: newChatId, user_id: App.currentUser.id },
        { chat_id: newChatId, user_id: userId }
      ]);
      if (me.error) throw me.error;
      chatId = newChatId;
    }
    closeModal('modal-search'); clearSearch();
    await openChat(chatId, userId);
  } catch (err) { showToast((err && err.message) || 'Could not start chat', 'error'); }
}

/* Alias used by profile modal "Message" button */
function startChatWithUser(userId) { return startChatWith(userId); }

/* ── Forward Message: open chat/contact picker ───────────────── */
var _forwardContent = '';
var _forwardMsgId   = null;

function _ctxForward() {
  if (!_ctxMsgData) return;
  // Grab the raw DB content from the original message object for faithful forwarding
  var msg = App.messages.find(function(m) { return m.id === _ctxMsgId; });
  var raw = msg ? (msg.content || '') : '';
  // Fallback: reconstruct from parsed data
  if (!raw) raw = _ctxMsgData.text || _ctxMsgData.url || '';
  if (!raw) return showToast('Nothing to forward', 'error');
  _forwardContent = raw;
  _forwardMsgId   = _ctxMsgId;
  openForwardPicker();
}

function _buildForwardRows(filter) {
  filter = (filter || '').toLowerCase().trim();
  var html = '';
  var matches = 0;

  // DM chats
  if (App.chats && App.chats.length > 0) {
    App.chats.forEach(function(c) {
      var peer = c._peerProfile || {};
      var name = peer.display_name || peer.username || 'Chat';
      if (filter && name.toLowerCase().indexOf(filter) === -1) return;
      matches++;
      html += '<div class="forward-chat-row" onclick="forwardToChat(\'' + c.id + '\',\'chat\',this)">' +
        '<img src="' + avatarSrc(peer) + '" class="avatar avatar-xs" alt="">' +
        '<div class="forward-chat-info"><span class="forward-chat-name">' + esc(name) + '</span>' +
        '<span class="forward-chat-type">Direct</span></div></div>';
    });
  }
  // Groups
  if (App.groups && App.groups.length > 0) {
    App.groups.forEach(function(g) {
      var name = g.name || 'Group';
      if (filter && name.toLowerCase().indexOf(filter) === -1) return;
      matches++;
      html += '<div class="forward-chat-row" onclick="forwardToChat(\'' + g.id + '\',\'group\',this)">' +
        '<img src="' + avatarSrc({ username: g.name, avatar_url: g.avatar_url }) + '" class="avatar avatar-xs" alt="">' +
        '<div class="forward-chat-info"><span class="forward-chat-name">' + esc(name) + '</span>' +
        '<span class="forward-chat-type">Group</span></div></div>';
    });
  }
  // Channels
  if (App.channels && App.channels.length > 0) {
    App.channels.forEach(function(ch) {
      var name = ch.name || 'Channel';
      if (filter && name.toLowerCase().indexOf(filter) === -1) return;
      matches++;
      html += '<div class="forward-chat-row" onclick="forwardToChat(\'' + ch.id + '\',\'channel\',this)">' +
        '<img src="' + avatarSrc({ username: ch.name, avatar_url: ch.avatar_url }) + '" class="avatar avatar-xs" alt="">' +
        '<div class="forward-chat-info"><span class="forward-chat-name">' + esc(name) + '</span>' +
        '<span class="forward-chat-type">Channel</span></div></div>';
    });
  }
  if (!matches) html = '<p style="text-align:center;color:var(--text3);padding:24px 0">' +
    (filter ? 'No matches' : 'No conversations') + '</p>';
  return html;
}

function openForwardPicker() {
  var modal = document.getElementById('modal-forward');
  if (!modal) return;
  var list = document.getElementById('forward-chat-list');
  if (!list) return;

  // Build search box + list
  list.innerHTML =
    '<div style="padding:0 16px 12px">' +
      '<input id="fw-search" type="text" placeholder="Search…" ' +
        'style="width:100%;box-sizing:border-box;padding:8px 12px;border-radius:10px;' +
        'border:1px solid var(--border);background:var(--input-bg);color:var(--text);font-size:14px" ' +
        'oninput="document.getElementById(\'fw-rows\').innerHTML=_buildForwardRows(this.value)">' +
    '</div>' +
    '<div id="fw-rows">' + _buildForwardRows('') + '</div>';
  openModal('modal-forward');
  setTimeout(function() { var s = document.getElementById('fw-search'); if (s) s.focus(); }, 150);
}

async function forwardToChat(convId, convType, rowEl) {
  if (!_forwardContent || !convId) return;
  document.querySelectorAll('.forward-chat-row').forEach(function(r) { r.classList.remove('fw-selected'); });
  if (rowEl) rowEl.classList.add('fw-selected');

  var tableMap = { chat: ['messages','chat_id'], group: ['group_messages','group_id'], channel: ['channel_messages','channel_id'] };
  var pair = tableMap[convType] || tableMap.chat;
  try {
    var payload = { sender_id: App.currentUser.id, content: '↪ ' + _forwardContent };
    payload[pair[1]] = convId;
    var r = await supabaseClient.from(pair[0]).insert(payload);
    if (r.error) throw r.error;
    closeModal('modal-forward');
    _forwardContent = '';
    _forwardMsgId   = null;
    showToast('Forwarded ✓');
    // Navigate to destination conversation
    if (convType === 'chat')    { var chat = (App.chats||[]).find(function(c){return c.id===convId;}); if (chat) openChat(convId); }
    else if (convType === 'group')   { openGroup(convId); }
    else if (convType === 'channel') { openChannel(convId); }
  } catch(e) {
    showToast((e && e.message) || 'Could not forward', 'error');
  }
}

/* ==================== CONVERSATION OPTIONS ==================== */
async function openConvOptions() {
  var type = App.activeConvType;
  var id   = App.activeChatId;
  var data = App.activeConvData;
  var role = App.activeConvRole;
  if (!id) return;

  var headerEl = $('conv-options-header');
  var listEl   = $('conv-options-list');

  // Build an option row — SAFE: fn is a simple function name string, no URLs
  function optRow(iconSvg, label, fn, danger) {
    return '<button class="option-row' + (danger ? ' option-danger' : '') + '" onclick="closeModal(\'modal-conv-options\');' + fn + '">' +
      '<span class="option-icon">' + iconSvg + '</span>' +
      '<span class="option-label">' + label + '</span>' +
      '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>' +
    '</button>';
  }

  var I = {
    user:    '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
    users:   '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    edit:    '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
    adduser: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>',
    info:    '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
    trash:   '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>',
    logout:  '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>',
    clear:   '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
  };

  if (type === 'chat') {
    var peer = data;
    headerEl.innerHTML =
      '<img src="' + avatarSrc(peer) + '" class="options-avatar" alt="">' +
      '<div class="options-header-info">' +
        '<div class="options-name">' + esc(peer ? peer.username : 'Chat') + '</div>' +
        '<div class="options-sub">Direct Message</div>' +
      '</div>';
    var peerId = App.activePeerId;
    var isBlocked = peerId && isUserBlocked(peerId);
    var blockSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>';
    var peerName = esc((data && data.username) || 'User');
    listEl.innerHTML =
      optRow(I.user,  'View Profile',   'viewPeerProfile()') +
      optRow(I.clear, 'Clear Messages', 'confirmClearChat()', true) +
      (peerId
        ? isBlocked
          ? optRow(blockSvg, 'Unblock User', "unblockUser('" + peerId + "')", false)
          : optRow(blockSvg, 'Block User',   "confirmBlockUser('" + peerId + "','" + peerName + "')", true)
        : '');

  } else if (type === 'channel') {
    var ch = data, isAdmin = role === 'admin';
    headerEl.innerHTML =
      '<img src="' + avatarSrc({ username: ch ? ch.name : 'C', avatar_url: ch ? ch.avatar_url : null }) + '" class="options-avatar" alt="">' +
      '<div class="options-header-info">' +
        '<div class="options-name">' + esc(ch ? ch.name : 'Channel') + '</div>' +
        '<div class="options-sub">' + (isAdmin ? 'You are the admin' : 'Channel member') + '</div>' +
      '</div>';
    var rows = optRow(I.users, 'View Members', 'closeModal(\'modal-conv-options\');openViewMembers()');
    if (isAdmin) {
      rows += optRow(I.edit,    'Edit Channel',   'openEditConv()');
      rows += optRow(I.adduser, 'Add Members',    'openAddMembers()');
      rows += optRow(I.info,    'Channel Info',   'closeModal(\'modal-conv-options\');openConvInfo()');
      rows += optRow(I.trash,   'Delete Channel', 'confirmDeleteConv()', true);
    } else {
      rows += optRow(I.info,   'Channel Info',  'closeModal(\'modal-conv-options\');openConvInfo()');
      rows += optRow(I.logout, 'Leave Channel', 'confirmLeaveConv()', true);
    }
    listEl.innerHTML = rows;

  } else if (type === 'group') {
    var g = data, isAdminG = role === 'admin';
    headerEl.innerHTML =
      '<img src="' + avatarSrc({ username: g ? g.name : 'G', avatar_url: g ? g.avatar_url : null }) + '" class="options-avatar" alt="">' +
      '<div class="options-header-info">' +
        '<div class="options-name">' + esc(g ? g.name : 'Group') + '</div>' +
        '<div class="options-sub">' + (isAdminG ? 'You are the admin' : 'Group member') + '</div>' +
      '</div>';
    var rowsG = optRow(I.users, 'View Members', 'closeModal(\'modal-conv-options\');openViewMembers()');
    if (isAdminG) {
      rowsG += optRow(I.edit,    'Edit Group',   'openEditConv()');
      rowsG += optRow(I.adduser, 'Add Members',  'openAddMembers()');
      rowsG += optRow(I.info,    'Group Info',   'closeModal(\'modal-conv-options\');openConvInfo()');
      rowsG += optRow(I.trash,   'Delete Group', 'confirmDeleteConv()', true);
    } else {
      rowsG += optRow(I.info,   'Group Info',  'closeModal(\'modal-conv-options\');openConvInfo()');
      rowsG += optRow(I.logout, 'Leave Group', 'confirmLeaveConv()', true);
    }
    listEl.innerHTML = rowsG;
  }

  openModal('modal-conv-options');
}

/* ==================== VIEW PEER PROFILE ==================== */
async function viewPeerProfile() {
  var peer   = App.activeConvData;
  var peerId = App.activePeerId;

  // Always fetch full profile — either from cache or DB
  if (peerId) {
    var cached = App._memberCache[peerId];
    if (cached && cached.username) {
      peer = cached;
    } else {
      try {
        var res = await supabaseClient.from('profiles').select('*').eq('id', peerId).single();
        if (res.data) {
          peer = res.data;
          App._memberCache[peerId] = peer;
        }
      } catch(e) { console.warn('viewPeerProfile fetch:', e && e.message); }
    }
    if (peer && !peer.id) peer.id = peerId;
    if (peer) App.activeConvData = peer;
  }

  if (!peer) return showToast('Could not load profile', 'error');
  if (!peer.id && peerId) peer.id = peerId;

  var titleEl = $('profile-modal-title'), bodyEl = $('profile-modal-body');
  if (!titleEl || !bodyEl) return showToast('Could not open profile', 'error');
  titleEl.textContent = 'Profile';
  _buildProfileHTML(peer, bodyEl, peerId, true);
  openModal('modal-view-profile');
}

function _buildProfileHTML(peer, bodyEl, viewedUserId, showMsgBtn) {
  // Support legacy 3-arg calls: _buildProfileHTML(peer, bodyEl, showMsgBool)
  if (typeof viewedUserId === 'boolean') { showMsgBtn = viewedUserId; viewedUserId = peer.id || null; }
  var uid = viewedUserId || peer.id || null;
  var isOnline = uid && App.onlineUsers.has(uid);
  var lastSeen = '';
  if (!isOnline && peer.last_seen) {
    var d = new Date(peer.last_seen);
    var diffMin = Math.floor((Date.now() - d) / 60000);
    if (diffMin < 1)       lastSeen = 'Last seen just now';
    else if (diffMin < 60) lastSeen = 'Last seen ' + diffMin + 'm ago';
    else if (diffMin < 1440) lastSeen = 'Last seen ' + Math.floor(diffMin/60) + 'h ago';
    else                   lastSeen = 'Last seen ' + d.toLocaleDateString([], {month:'short', day:'numeric'});
  }
  var msgBtnHtml = '';
  var peerId = peer.id || uid;
  if (showMsgBtn && peerId && peerId !== (App.currentUser && App.currentUser.id)) {
    msgBtnHtml = '<div class="profile-view-actions">' +
      '<button class="profile-view-msg-btn" onclick="closeModal(\'modal-view-profile\');startChatWithUser(\'" + peerId + "\')">' +
      '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>' +
      'Message</button></div>';
  }
  bodyEl.innerHTML =
    '<div class="profile-view">' +
      '<div class="profile-view-avatar-wrap">' +
        '<img src="' + avatarSrc(peer) + '" class="profile-view-avatar" alt="">' +
        '<span class="profile-view-dot' + (isOnline ? ' pv-online' : '') + '"></span>' +
      '</div>' +
      '<div class="profile-view-name">' + esc(peer.display_name || peer.username || 'User') + '</div>' +
      (peer.username ? '<div class="profile-view-username">@' + esc(peer.username) + '</div>' : '') +
      (peer.bio ? '<div class="profile-view-bio">' + esc(peer.bio) + '</div>' : '') +
      '<div class="profile-view-status' + (isOnline ? ' pv-status-online' : '') + '">' +
        (isOnline ? '● Online' : (lastSeen || '● Offline')) +
      '</div>' +
      msgBtnHtml +
    '</div>';
}
function _viewProfileInModal(peer, modalId, titleId, bodyId) {
  var titleEl = $(titleId), bodyEl = $(bodyId);
  if (!titleEl || !bodyEl) return;
  titleEl.textContent = 'Profile';
  _buildProfileHTML(peer, bodyEl, peer.id || null, false);
  openModal(modalId);
}

/* ==================== VIEW MEMBERS ==================== */
async function openViewMembers() {
  var type = App.activeConvType, id = App.activeChatId;
  var titleEl = $('modal-members-title'), bodyEl = $('members-list-body');
  if (!titleEl || !bodyEl) return;
  titleEl.textContent = type === 'channel' ? 'Channel Members' : 'Group Members';
  bodyEl.innerHTML = '<div style="display:flex;justify-content:center;padding:32px"><span class="spinner" style="border-color:var(--border);border-top-color:var(--accent)"></span></div>';
  openModal('modal-members');

  var memTable = type === 'channel' ? 'channel_members' : 'group_members';
  var idCol    = type === 'channel' ? 'channel_id' : 'group_id';
  var isAdmin  = App.activeConvRole === 'admin';

  // Step 1: fetch member rows (user_id + role only)
  var r = await supabaseClient
    .from(memTable)
    .select('user_id, role')
    .eq(idCol, id);

  if (r.error || !r.data) {
    bodyEl.innerHTML = '<div class="empty-state"><p class="empty-title">Could not load members</p><p class="empty-desc">' +
      esc((r.error && r.error.message) || 'Unknown error') + '</p></div>';
    return;
  }

  // Step 2: fetch all profiles in one query
  var allUserIds = r.data.map(function(m) { return m.user_id; });
  var profileMap = {};
  // Check cache first
  var uncached = allUserIds.filter(function(uid) { return !App._memberCache[uid] || !App._memberCache[uid].username; });
  if (uncached.length > 0) {
    try {
      var pr = await supabaseClient.from('profiles').select('id, username, display_name, avatar_url, bio, last_seen').in('id', uncached);
      if (pr.data) {
        pr.data.forEach(function(p) { App._memberCache[p.id] = p; });
      }
    } catch(e) { console.warn('openViewMembers profile fetch:', e && e.message); }
  }
  // Build profileMap from cache
  allUserIds.forEach(function(uid) { profileMap[uid] = App._memberCache[uid] || null; });
  // Attach profiles to member rows
  r.data = r.data.map(function(m) { return Object.assign({}, m, { profiles: profileMap[m.user_id] || null }); });

  var count = r.data.length;
  titleEl.textContent = (type === 'channel' ? 'Channel Members' : 'Group Members') + ' (' + count + ')';

  // Sort: admins first, then by name
  var sorted = r.data.slice().sort(function(a, b) {
    if (a.role === 'admin' && b.role !== 'admin') return -1;
    if (b.role === 'admin' && a.role !== 'admin') return  1;
    var an = (a.profiles && (a.profiles.display_name || a.profiles.username)) || '';
    var bn = (b.profiles && (b.profiles.display_name || b.profiles.username)) || '';
    return an.localeCompare(bn);
  });

  if (sorted.length === 0) {
    bodyEl.innerHTML = '<div class="empty-state"><p class="empty-title">No members</p></div>';
    return;
  }

  bodyEl.innerHTML = sorted.map(function(m) {
    var p        = m.profiles;
    var isMe     = m.user_id === App.currentUser.id;
    var canKick  = isAdmin && !isMe && m.role !== 'admin';
    var dispName = p ? (p.display_name || p.username || 'Unknown') : 'Unknown';
    var subLine  = (p && p.display_name && p.username) ? '@' + p.username : '';
    var clickFn  = (!isMe && p) ? 'onclick="viewMemberProfile(\'' + m.user_id + '\')"' : '';
    return '<div class="member-row' + (!isMe && p ? ' clickable' : '') + '" ' + clickFn + '>' +
      '<img src="' + avatarSrc(p) + '" class="avatar avatar-sm" alt="">' +
      '<div class="member-row-info">' +
        '<span class="member-row-name">' + esc(dispName) +
          (isMe ? ' <span style="font-size:11px;opacity:.5;font-weight:400">(you)</span>' : '') +
        '</span>' +
        (subLine ? '<span class="member-row-sub">' + esc(subLine) + '</span>' : '') +
        '<span class="member-row-role ' + (m.role === 'admin' ? 'role-admin' : 'role-member') + '">' + m.role + '</span>' +
      '</div>' +
      (canKick ? '<button class="kick-btn" onclick="event.stopPropagation();confirmKickMember(\'' + m.user_id + '\')">Remove</button>' : '') +
    '</div>';
  }).join('');
}

/* ==================== VIEW MEMBER PROFILE (from members list) ==================== */
async function viewMemberProfile(userId) {
  var p = App._memberCache[userId];
  // Fetch from DB if not cached
  if (!p) {
    try {
      var res = await supabaseClient.from('profiles').select('*').eq('id', userId).single();
      if (res.data) { p = res.data; App._memberCache[userId] = p; }
    } catch(e) { console.warn('viewMemberProfile fetch:', e && e.message); }
  }
  if (!p) return showToast('Could not load profile', 'error');
  if (!p.id) p.id = userId;
  var titleEl = $('profile-modal-title'), bodyEl = $('profile-modal-body');
  if (!titleEl || !bodyEl) return showToast('Could not open profile', 'error');
  titleEl.textContent = 'Profile';
  var showMsg = p.id !== (App.currentUser && App.currentUser.id);
  _buildProfileHTML(p, bodyEl, userId, showMsg);
  openModal('modal-view-profile');
}

/* ==================== KICK MEMBER ==================== */
function confirmKickMember(userId) {
  closeModal('modal-members');
  var p = App._memberCache[userId] || { username: 'this member' };
  showConfirm(
    '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" fill="none" stroke="#f87171" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="23" y1="11" x2="17" y2="11"/></svg>',
    'Remove Member',
    'Remove ' + esc(p.username) + ' from this ' + App.activeConvType + '?',
    async function() {
      var type  = App.activeConvType;
      var table = type === 'channel' ? 'channel_members' : 'group_members';
      var col   = type === 'channel' ? 'channel_id' : 'group_id';
      var r = await supabaseClient.from(table).delete().eq(col, App.activeChatId).eq('user_id', userId);
      if (r.error) return showToast(r.error.message, 'error');
      showToast('Member removed');
      openViewMembers();
    }
  );
}

/* ==================== ADD MEMBERS ==================== */
function openAddMembers() {
  App.amMembers = [];
  var srch = $('am-search'), res = $('am-member-results'), chips = $('am-members-list');
  if (srch)  srch.value = '';
  if (res)   res.innerHTML = '';
  if (chips) chips.innerHTML = '';
  var titleEl = $('modal-add-members-title');
  if (titleEl) titleEl.textContent = App.activeConvType === 'channel' ? 'Add to Channel' : 'Add to Group';
  openModal('modal-add-members');
  setTimeout(function() { var s = $('am-search'); if (s) s.focus(); }, 150);
}

async function submitAddMembers() {
  if (!App.amMembers.length) return showToast('No members selected', 'error');
  var btn = $('am-submit-btn');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
  var type  = App.activeConvType, id = App.activeChatId;
  var table = type === 'channel' ? 'channel_members' : 'group_members';
  var col   = type === 'channel' ? 'channel_id' : 'group_id';
  try {
    var rows = App.amMembers.map(function(m) {
      var row = { user_id: m.id, role: 'member' }; row[col] = id; return row;
    });
    var r = await supabaseClient.from(table).insert(rows);
    if (r.error) throw r.error;
    showToast('Added ' + App.amMembers.length + ' member' + (App.amMembers.length !== 1 ? 's' : ''));
    closeModal('modal-add-members');
    App.amMembers = [];
    if (type === 'channel') openChannel(id); else openGroup(id);
  } catch (err) {
    console.error('submitAddMembers error:', err);
    showToast((err && err.message) || 'Failed to add members', 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Add';
  }
}

/* ==================== EDIT CHANNEL / GROUP ==================== */
function openEditConv() {
  var data = App.activeConvData; if (!data) return;
  _pendingAvatarUrl.conv = null;
  var titleEl = $('modal-edit-conv-title'), nameEl = $('edit-conv-name'), descEl = $('edit-conv-desc');
  if (titleEl) titleEl.textContent = App.activeConvType === 'channel' ? 'Edit Channel' : 'Edit Group';
  if (nameEl)  nameEl.value = data.name || '';
  if (descEl)  descEl.value = data.description || '';
  var preview = $('edit-conv-avatar-preview');
  if (preview) preview.src = avatarSrc({ username: data.name || '?', avatar_url: data.avatar_url || null });
  openModal('modal-edit-conv');
  setTimeout(function() { if (nameEl) nameEl.focus(); }, 150);
}

async function submitEditConv() {
  var name = $('edit-conv-name') && $('edit-conv-name').value.trim();
  var desc = $('edit-conv-desc') ? ($('edit-conv-desc').value.trim() || null) : null;
  if (!name) return showToast('Name is required', 'error');
  var btn = $('edit-conv-btn');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
  var type = App.activeConvType, id = App.activeChatId;
  var table = type === 'channel' ? 'channels' : 'groups';
  var avatarUrl = _pendingAvatarUrl.conv || (App.activeConvData && App.activeConvData.avatar_url) || null;
  try {
    var r = await supabaseClient.from(table).update({ name: name, description: desc, avatar_url: avatarUrl }).eq('id', id);
    if (r.error) throw r.error;
    if (App.activeConvData) { App.activeConvData.name = name; App.activeConvData.description = desc; App.activeConvData.avatar_url = avatarUrl; }
    _pendingAvatarUrl.conv = null;
    showToast((type === 'channel' ? 'Channel' : 'Group') + ' updated!');
    closeModal('modal-edit-conv');
    if (type === 'channel') openChannel(id); else openGroup(id);
  } catch (err) {
    showToast((err && err.message) || 'Failed to update', 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Save';
  }
}

/* ==================== CONV INFO ==================== */
async function openConvInfo() {
  var type = App.activeConvType, data = App.activeConvData, id = App.activeChatId;
  var titleEl = $('modal-members-title'), bodyEl = $('members-list-body');
  if (!titleEl || !bodyEl) return;
  titleEl.textContent = type === 'channel' ? 'Channel Info' : 'Group Info';
  bodyEl.innerHTML = '<div style="display:flex;justify-content:center;padding:32px"><span class="spinner" style="border-color:var(--border);border-top-color:var(--accent)"></span></div>';
  openModal('modal-members');

  // Always fetch fresh conv data from DB (never rely on stale App.activeConvData)
  if (id) {
    try {
      var mainTable = type === 'channel' ? 'channels' : 'groups';
      var dr = await supabaseClient.from(mainTable).select('*').eq('id', id).single();
      if (dr.data) { data = dr.data; App.activeConvData = data; }
    } catch(e) { console.warn('openConvInfo data fetch:', e && e.message); }
  }
  if (!data) return showToast('Could not load info', 'error');

  // Fetch member count
  var memTable = type === 'channel' ? 'channel_members' : 'group_members';
  var idCol    = type === 'channel' ? 'channel_id' : 'group_id';
  var countRes = await supabaseClient.from(memTable).select('user_id', { count: 'exact', head: true }).eq(idCol, id);
  var memberCount = countRes.count || 0;

  var created = data && data.created_at
    ? new Date(data.created_at).toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' })
    : '';

  var isAdmin = App.activeConvRole === 'admin';
  var vcBtnLabel = GVC.active && GVC.chatId === id
    ? (GVC.joined ? 'Open Voice Chat' : 'Join Voice Chat')
    : (isAdmin || type === 'group' ? 'Start Voice Chat' : '');

  var vcBtn = vcBtnLabel
    ? '<button class="conv-info-members-btn" style="background:linear-gradient(135deg,rgba(46,204,113,.15),rgba(0,208,132,.1));border-color:var(--accent);color:var(--accent)" onclick="closeModal(\'modal-members\');' + (GVC.active && GVC.chatId === id ? 'gvcJoin()' : 'gvcStart()') + '">' +
        '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>' +
        vcBtnLabel + '</button>'
    : '';

  bodyEl.innerHTML =
    '<div class="conv-info-card">' +
      '<img src="' + avatarSrc({ username: data ? data.name : '?', avatar_url: data ? data.avatar_url : null }) + '" class="conv-info-avatar" alt="">' +
      '<div class="conv-info-name">' + esc(data ? data.name : '') + '</div>' +
      '<div class="conv-info-type-badge ' + type + '">' + (type === 'channel' ? 'Channel' : 'Group') + '</div>' +
      (data && data.description
        ? '<div class="conv-info-desc">' + esc(data.description) + '</div>'
        : '<div class="conv-info-desc" style="color:var(--text3);font-style:italic">No description</div>') +
      '<div class="conv-info-stats">' +
        '<div class="conv-info-stat"><span class="conv-info-stat-num">' + memberCount + '</span><span class="conv-info-stat-label">Members</span></div>' +
        (created ? '<div class="conv-info-stat"><span class="conv-info-stat-num" style="font-size:13px">' + created + '</span><span class="conv-info-stat-label">Created</span></div>' : '') +
      '</div>' +
      vcBtn +
      '<button class="conv-info-members-btn" onclick="closeModal(\'modal-members\');openViewMembers()">' +
        '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>' +
        'View Members' +
      '</button>' +
    '</div>';
}

/* ==================== DELETE CONV ==================== */
function confirmDeleteConv() {
  var type = App.activeConvType;
  showConfirm(
    '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" fill="none" stroke="#f87171" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>',
    'Delete ' + (type === 'channel' ? 'Channel' : 'Group'),
    'Permanently delete this ' + type + ' and all its messages? This cannot be undone.',
    async function() {
      var id       = App.activeChatId;
      var msgTable = type === 'channel' ? 'channel_messages' : 'group_messages';
      var memTable = type === 'channel' ? 'channel_members'  : 'group_members';
      var mainTable= type === 'channel' ? 'channels'         : 'groups';
      var col      = type === 'channel' ? 'channel_id'       : 'group_id';
      try {
        await supabaseClient.from(msgTable).delete().eq(col, id);
        await supabaseClient.from(memTable).delete().eq(col, id);
        var r = await supabaseClient.from(mainTable).delete().eq('id', id);
        if (r.error) throw r.error;
        showToast((type === 'channel' ? 'Channel' : 'Group') + ' deleted');
        closeConv();
      } catch (err) { showToast((err && err.message) || 'Failed to delete', 'error'); }
    }
  );
}

/* ==================== LEAVE CONV ==================== */
function confirmLeaveConv() {
  var type = App.activeConvType;
  showConfirm(
    '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" fill="none" stroke="#f87171" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>',
    'Leave ' + (type === 'channel' ? 'Channel' : 'Group'),
    'You will no longer receive messages from this ' + type + '.',
    async function() {
      var id    = App.activeChatId;
      var table = type === 'channel' ? 'channel_members' : 'group_members';
      var col   = type === 'channel' ? 'channel_id' : 'group_id';
      var r = await supabaseClient.from(table).delete().eq(col, id).eq('user_id', App.currentUser.id);
      if (r.error) return showToast(r.error.message, 'error');
      showToast('Left ' + type);
      closeConv();
    }
  );
}

/* ==================== CLEAR CHAT ==================== */
function confirmClearChat() {
  var type = App.activeConvType;
  var isAdmin = type === 'chat' || App.activeConvRole === 'admin';
  var desc = isAdmin
    ? 'Delete all messages in this conversation? This cannot be undone.'
    : 'Delete your messages in this conversation?';
  showConfirm(
    '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" fill="none" stroke="#f87171" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
    'Clear Messages',
    desc,
    async function() {
      var tableMap = { chat: ['messages','chat_id'], channel: ['channel_messages','channel_id'], group: ['group_messages','group_id'] };
      var pair = tableMap[type] || tableMap.chat;
      try {
        var q = supabaseClient.from(pair[0]).delete().eq(pair[1], App.activeChatId);
        // Non-admins can only delete their own messages
        if (!isAdmin) q = q.eq('sender_id', App.currentUser.id);
        var r = await q;
        if (r.error) throw r.error;
        App.messages = [];
        renderMessages([], type);
        showToast('Messages cleared');
      } catch(err) {
        showToast((err && err.message) || 'Failed to clear messages', 'error');
      }
    }
  );
}

/* ==================== BLOCK / UNBLOCK ==================== */

var _blockedUsers = []; // cache: [{id, username, avatar_url}]

async function loadBlockedUsers() {
  if (!App.currentUser) return;
  try {
    // Step 1: get blocked user IDs
    var r = await supabaseClient.from('blocked_users')
      .select('blocked_id')
      .eq('blocker_id', App.currentUser.id);
    if (r.error) throw r.error;
    var blockedIds = (r.data || []).map(function(row) { return row.blocked_id; });
    if (blockedIds.length === 0) {
      _blockedUsers = [];
    } else {
      // Step 2: fetch profiles for each blocked id
      var pr = await supabaseClient.from('profiles')
        .select('id, username, avatar_url')
        .in('id', blockedIds);
      _blockedUsers = pr.data || [];
    }
    // Update count label
    var lbl = $('blocked-count-label');
    if (lbl) lbl.textContent = _blockedUsers.length > 0
      ? _blockedUsers.length + ' blocked ' + (_blockedUsers.length === 1 ? 'user' : 'users')
      : 'Manage blocked accounts';
  } catch(e) {
    console.warn('loadBlockedUsers:', e.message);
    _blockedUsers = [];
  }
}

function isUserBlocked(userId) {
  return _blockedUsers.some(function(u) { return u.id === userId; });
}

async function blockUser(userId) {
  if (!App.currentUser || !userId) return;
  if (isUserBlocked(userId)) return showToast('User is already blocked');
  // Cancel any in-progress voice recording before blocking
  if (_rec.active || _rec.locked) cancelRecording(true); // silent: user is blocking, not explicitly cancelling
  try {
    var r = await supabaseClient.from('blocked_users').insert({
      blocker_id: App.currentUser.id, blocked_id: userId
    });
    if (r.error) throw r.error;
    await loadBlockedUsers();
    showToast('User blocked');
    closeModal('modal-conv-options');
    // If currently in a DM with this user — show blocked banner and hide input
    if (App.activeConvType === 'chat' && App.activePeerId === userId) {
      _updateBlockedBannerForChat();
    }
    // Refresh chat list so the blocked user's chat disappears
    if (App.activeTab === 'chats') await loadChats();
  } catch(e) {
    showToast((e && e.message) || 'Failed to block user', 'error');
  }
}

async function unblockUser(userId) {
  if (!App.currentUser || !userId) return;
  try {
    var r = await supabaseClient.from('blocked_users')
      .delete().eq('blocker_id', App.currentUser.id).eq('blocked_id', userId);
    if (r.error) throw r.error;
    await loadBlockedUsers();
    showToast('User unblocked');
    openBlockedUsers(); // refresh modal
    // If we're currently in a DM with this user, restore input
    if (App.activeConvType === 'chat' && App.activePeerId === userId) {
      _updateBlockedBannerForChat();
    }
    // Refresh chat list so the unblocked user's chat reappears
    if (App.activeTab === 'chats') await loadChats();
  } catch(e) {
    showToast((e && e.message) || 'Failed to unblock', 'error');
  }
}

function confirmBlockUser(userId, username) {
  showConfirm(
    '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" fill="none" stroke="#f97316" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>',
    'Block ' + esc(username || 'User') + '?',
    "They won't be able to send you messages. You can unblock them anytime in Settings \u203a Privacy.",
    function() { blockUser(userId); }
  );
}

/* Show/hide blocked banner when inside a DM with a blocked user */
function _updateBlockedBannerForChat() {
  if (App.activeConvType !== 'chat') return;
  var blocked = App.activePeerId && isUserBlocked(App.activePeerId);
  var inputArea = $('msg-input-area');
  var blockedBanner = $('blocked-chat-banner');

  if (blocked) {
    if (inputArea) inputArea.style.display = 'none';
    if (!blockedBanner) {
      var banner = document.createElement('div');
      banner.id = 'blocked-chat-banner';
      banner.className = 'readonly-banner';
      banner.style.cssText = 'display:flex;background:rgba(239,68,68,.08);border-top:1px solid rgba(239,68,68,.18);color:#ef4444;gap:8px;align-items:center;padding:14px 16px;font-size:13px;flex-shrink:0;';
      banner.innerHTML =
        '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>' +
        '<span>You have blocked this user. <button onclick="unblockUser(\'' + App.activePeerId + '\')" style="background:none;border:none;color:#ef4444;text-decoration:underline;cursor:pointer;font-size:13px;padding:0">Unblock</button></span>';
      var chatScreen = $('screen-chat');
      if (chatScreen) chatScreen.appendChild(banner);
    } else {
      blockedBanner.style.display = 'flex';
    }
  } else {
    if (inputArea) inputArea.style.display = '';
    if (blockedBanner) blockedBanner.style.display = 'none';
  }
}

async function openBlockedUsers() {
  var listEl = $('blocked-users-list');
  if (!listEl) return;
  await loadBlockedUsers();
  if (_blockedUsers.length === 0) {
    listEl.innerHTML = '<div class="empty-state" style="padding:32px 0"><p class="empty-title">No blocked users</p><p class="empty-desc">Users you block will appear here</p></div>';
  } else {
    listEl.innerHTML = _blockedUsers.map(function(u) {
      return '<div class="blocked-user-row">' +
        '<img src="' + avatarSrc(u) + '" class="avatar avatar-sm" alt="">' +
        '<span class="blocked-user-name">' + esc(u.username || 'User') + '</span>' +
        '<button class="unblock-btn" onclick="unblockUser(\'' + u.id + '\')">Unblock</button>' +
      '</div>';
    }).join('');
  }
  openModal('modal-blocked-users');
}

/* ==================== CONFIRM MODAL ==================== */
function showConfirm(iconHtml, title, desc, onConfirm) {
  var iconEl = $('confirm-icon'), titleEl = $('confirm-title'), descEl = $('confirm-desc');
  if (iconEl)  iconEl.innerHTML = iconHtml;
  if (titleEl) titleEl.textContent = title;
  if (descEl)  descEl.textContent  = desc;
  // Replace button to remove any stale event listeners
  var oldBtn = $('confirm-action-btn');
  var newBtn = oldBtn.cloneNode(true);
  oldBtn.parentNode.replaceChild(newBtn, oldBtn);
  newBtn.onclick = async function() { closeModal('modal-confirm'); await onConfirm(); };
  openModal('modal-confirm');
}

/* ==================== CREATE CHANNEL ==================== */
function openCreateChannel() {
  App.ccMembers = [];
  _pendingAvatarUrl.cc = null;
  ['cc-name','cc-desc','cc-member-search'].forEach(function(id) { var el = $(id); if (el) el.value = ''; });
  var fi = $('cc-avatar-file'); if (fi) fi.value = '';
  var prev = $('cc-avatar-preview'); if (prev) prev.src = avatarSrc({ username: 'Channel' });
  var r = $('cc-member-results'); if (r) r.innerHTML = '';
  renderMemberChips('cc');
  openModal('modal-create-channel');
  setTimeout(function() { var n = $('cc-name'); if (n) n.focus(); }, 150);
}

async function submitCreateChannel() {
  var name = $('cc-name') && $('cc-name').value.trim();
  if (!name) return showToast('Channel name is required', 'error');
  var description = $('cc-desc') ? ($('cc-desc').value.trim() || null) : null;
  var btn = $('cc-submit-btn');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
  try {
    var channelId = crypto.randomUUID();
    var ccAvatarUrl = _pendingAvatarUrl.cc || null;
    var r1 = await supabaseClient.from('channels').insert({ id: channelId, name: name, description: description, avatar_url: ccAvatarUrl, created_by: App.currentUser.id });
    if (r1.error) throw r1.error;
    var rows = [{ channel_id: channelId, user_id: App.currentUser.id, role: 'admin' }];
    App.ccMembers.forEach(function(m) { rows.push({ channel_id: channelId, user_id: m.id, role: 'member' }); });
    var r2 = await supabaseClient.from('channel_members').insert(rows);
    if (r2.error) throw r2.error;
    _pendingAvatarUrl.cc = null;
    showToast('Channel "' + name + '" created!');
    closeModal('modal-create-channel');
    setActiveTab('channels');
  } catch (err) {
    showToast((err && err.message) || 'Failed to create channel', 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Create Channel';
  }
}

/* ==================== CREATE GROUP ==================== */
function openCreateGroup() {
  App.cgMembers = [];
  _pendingAvatarUrl.cg = null;
  ['cg-name','cg-desc','cg-member-search'].forEach(function(id) { var el = $(id); if (el) el.value = ''; });
  var fi = $('cg-avatar-file'); if (fi) fi.value = '';
  var prev = $('cg-avatar-preview'); if (prev) prev.src = avatarSrc({ username: 'Group' });
  var r = $('cg-member-results'); if (r) r.innerHTML = '';
  renderMemberChips('cg');
  openModal('modal-create-group');
  setTimeout(function() { var n = $('cg-name'); if (n) n.focus(); }, 150);
}

async function submitCreateGroup() {
  var name = $('cg-name') && $('cg-name').value.trim();
  if (!name) return showToast('Group name is required', 'error');
  var description = $('cg-desc') ? ($('cg-desc').value.trim() || null) : null;
  var btn = $('cg-submit-btn');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
  try {
    var groupId = crypto.randomUUID();
    var cgAvatarUrl = _pendingAvatarUrl.cg || null;
    var r1 = await supabaseClient.from('groups').insert({ id: groupId, name: name, description: description, avatar_url: cgAvatarUrl, created_by: App.currentUser.id });
    if (r1.error) throw r1.error;
    var rows = [{ group_id: groupId, user_id: App.currentUser.id, role: 'admin' }];
    App.cgMembers.forEach(function(m) { rows.push({ group_id: groupId, user_id: m.id, role: 'member' }); });
    var r2 = await supabaseClient.from('group_members').insert(rows);
    if (r2.error) throw r2.error;
    _pendingAvatarUrl.cg = null;
    showToast('Group "' + name + '" created!');
    closeModal('modal-create-group');
    setActiveTab('groups');
  } catch (err) {
    showToast((err && err.message) || 'Failed to create group', 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Create Group';
  }
}

/* ==================== MEMBER SEARCH (all modals) ==================== */
// CRITICAL: NEVER put avatar URLs in onclick attributes
// avatarSrc() returns URLs with & which break HTML attribute parsing
// All profiles stored in App._memberCache[id]; onclick only passes prefix + id

var _msTimer = null;

async function searchMembersToAdd(prefix, query) {
  var resultsId = prefix === 'am' ? 'am-member-results' : prefix + '-member-results';
  var resultsEl = $(resultsId);
  clearTimeout(_msTimer);
  if (!resultsEl) return;
  var q = (query || '').trim();
  if (!q) { resultsEl.innerHTML = ''; return; }

  _msTimer = setTimeout(async function() {
    var cleanQ = q.startsWith('@') ? q.slice(1) : q;
    // Search by username OR display_name
    var r = await supabaseClient.from('profiles')
      .select('id, username, display_name, avatar_url, bio')
      .neq('id', App.currentUser.id)
      .or('username.ilike.%' + cleanQ + '%,display_name.ilike.%' + cleanQ + '%')
      .limit(10);

    // Fallback if display_name column missing
    var users = r.data || [];
    if (r.error && r.error.message && r.error.message.includes('display_name')) {
      var r2 = await supabaseClient.from('profiles')
        .select('id, username, avatar_url')
        .neq('id', App.currentUser.id)
        .ilike('username', '%' + cleanQ + '%').limit(10);
      users = r2.data || [];
    }

    if (!users.length) {
      resultsEl.innerHTML = '<div class="member-result-row"><span class="member-result-name" style="color:var(--text-sec)">@' + esc(cleanQ) + ' not found</span></div>';
      return;
    }

    users.forEach(function(p) { App._memberCache[p.id] = p; });

    var list = prefix === 'cc' ? App.ccMembers : prefix === 'cg' ? App.cgMembers : App.amMembers;
    resultsEl.innerHTML = users.map(function(p) {
      var added = list.some(function(m) { return m.id === p.id; });
      var displayName = p.display_name || p.username || 'User';
      return '<div class="member-result-row">' +
        '<img src="' + avatarSrc(p) + '" class="avatar avatar-xs" alt="">' +
        '<div style="flex:1;min-width:0">' +
          '<div class="member-result-name">' + esc(displayName) + '</div>' +
          '<div style="font-size:11px;color:var(--accent)">@' + esc(p.username || '') + '</div>' +
        '</div>' +
        '<button class="add-member-btn" ' + (added ? 'disabled' : '') + ' onclick="addMemberToList(\'' + prefix + '\',\'' + p.id + '\')">' +
          (added ? '&#10003;' : '+') +
        '</button>' +
      '</div>';
    }).join('');
  }, 280);
}

function addMemberToList(prefix, id) {
  var list = prefix === 'cc' ? App.ccMembers : prefix === 'cg' ? App.cgMembers : App.amMembers;
  if (list.some(function(m) { return m.id === id; })) return;
  var p = App._memberCache[id]; if (!p) return;
  list.push({ id: p.id, username: p.username, avatar_url: p.avatar_url });
  renderMemberChips(prefix);
  var searchId  = prefix === 'am' ? 'am-search' : prefix + '-member-search';
  var resultsId = prefix === 'am' ? 'am-member-results' : prefix + '-member-results';
  var inp = $(searchId); if (inp) inp.value = '';
  var res = $(resultsId); if (res) res.innerHTML = '';
}

function removeMemberFromList(prefix, id) {
  if      (prefix === 'cc') App.ccMembers = App.ccMembers.filter(function(m) { return m.id !== id; });
  else if (prefix === 'cg') App.cgMembers = App.cgMembers.filter(function(m) { return m.id !== id; });
  else                      App.amMembers = App.amMembers.filter(function(m) { return m.id !== id; });
  renderMemberChips(prefix);
}

function renderMemberChips(prefix) {
  var chipsId = prefix === 'am' ? 'am-members-list' : prefix + '-members-list';
  var el = $(chipsId); if (!el) return;
  var list = prefix === 'cc' ? App.ccMembers : prefix === 'cg' ? App.cgMembers : App.amMembers;
  // SAFE: only pass prefix + id in onclick (no URLs)
  el.innerHTML = list.map(function(m) {
    return '<div class="member-chip">' +
      '<img src="' + avatarSrc(m) + '" alt="">' +
      esc(m.username) +
      '<button class="chip-remove" onclick="removeMemberFromList(\'' + prefix + '\',\'' + m.id + '\')">&#215;</button>' +
    '</div>';
  }).join('');
}

/* ==================== UI HELPERS ==================== */
function openSidebar() {
  if (window.innerWidth >= 768) return; // sidebar always visible on desktop
  var sb = $('sidebar'), ov = $('sb-overlay');
  if (!sb) return;
  sb.classList.add('show');
  if (ov) ov.classList.add('show');
}
function closeSidebar() {
  if (window.innerWidth >= 768) return; // sidebar always visible on desktop
  var sb = $('sidebar'), ov = $('sb-overlay');
  if (sb) sb.classList.remove('show');
  if (ov) ov.classList.remove('show');
}
function openModal(id) {
  var m = $(id); if (!m) return;
  m.classList.add('show');
}
function closeModal(id) {
  var m = $(id); if (!m) return;
  m.classList.remove('show');
  if (id === 'modal-search') clearSearch();
  if (id === 'modal-search-cg') {
    var inp = $('cg-search-inp'), res = $('cg-search-results');
    if (inp) inp.value = '';
    if (res) res.innerHTML = '<p class="no-results" style="padding:18px 0">Search by name…</p>';
  }
}
function openSearch() {
  clearSearch(); openModal('modal-search');
  setTimeout(function() { var s = $('search-inp'); if (s) s.focus(); }, 150);
}
function clearSearch() {
  var i = $('search-inp'), r = $('search-results');
  if (i) i.value = ''; if (r) r.innerHTML = '';
}
function openEditProfile() {
  closeSidebar();
  _pendingAvatarUrl.profile = null;
  var p = App.currentProfile || {};
  var dnEl = $('ep-display-name'), unEl = $('ep-username'), bioEl = $('ep-bio');
  if (dnEl) dnEl.value  = p.display_name || p.username || '';
  if (unEl) unEl.value  = p.username || '';
  if (bioEl) bioEl.value = p.bio || '';
  var preview = $('ep-avatar-preview');
  if (preview) preview.src = avatarSrc(p);
  var fi = $('ep-avatar-file'); if (fi) fi.value = '';
  openModal('modal-editprofile');
}



/* ---- Android hardware back button ---- */
window.addEventListener('popstate', function() {
  // Close topmost open modal first
  var modals = document.querySelectorAll('.modal-backdrop.show');
  if (modals.length > 0) {
    var top = modals[modals.length - 1];
    top.classList.remove('show');
    // Clear search if search modal
    if (top.id === 'modal-search') clearSearch();
    history.pushState(null, '', location.href); // stay on page
    return;
  }
  var sidebar = $('sidebar');
  if (sidebar && sidebar.classList.contains('show')) { closeSidebar(); history.pushState(null, '', location.href); return; }
  var chatScreen = $('screen-chat');
  if (chatScreen && chatScreen.classList.contains('active')) { closeConv(); history.pushState(null, '', location.href); return; }
  var settingsScreen = $('screen-settings');
  if (settingsScreen && settingsScreen.classList.contains('active')) { closeSettings(); history.pushState(null, '', location.href); return; }
  history.pushState(null, '', location.href); // prevent browser from going back
});

/* visibilitychange handled in init section above */

/* ==================== BOOTSTRAP ==================== */
window.addEventListener('DOMContentLoaded', initApp);

/* ═══════════════════════════════════════════════════════════════════════════
   VOICE RECORDING, FILE ATTACHMENTS
   ═══════════════════════════════════════════════════════════════════════════ */

var _attachments = [];   // [{ name, size, type, url, isImage }]


/* ══════════════════════════════════════════════════════════
   VOICE RECORDING — clean rewrite
   ══════════════════════════════════════════════════════════ */

var _rec = {
  stream: null, mediaRec: null, chunks: [], audioCtx: null,
  analyser: null, rafId: null, rafId2: null, timer: null, seconds: 0,
  active: false, locked: false,
  startX: 0, startY: 0,
  cancelThreshold: 80,   // px slide-left to cancel
  lockThreshold:   60,   // px slide-up to lock
  cancelled: false,
  pendingStart: false    // true while getUserMedia is resolving (async gap guard)
};

function drawWaveform(canvasId, analyser, color, bars) {
  var canvas = document.getElementById(canvasId);
  if (!canvas || !analyser) return;
  var ctx = canvas.getContext('2d');
  var bufLen = analyser.frequencyBinCount;
  var data = new Uint8Array(bufLen);
  function draw() {
    analyser.getByteFrequencyData(data);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    var bw = canvas.width / bars;
    ctx.fillStyle = color;
    for (var i = 0; i < bars; i++) {
      var v = data[Math.floor(i / bars * bufLen * 0.6)] / 255;
      var h = Math.max(3, v * canvas.height);
      ctx.globalAlpha = 0.4 + v * 0.6;
      ctx.beginPath();
      var x = i * bw + bw * 0.1, y = (canvas.height - h) / 2;
      if (ctx.roundRect) ctx.roundRect(x, y, bw * 0.75, h, 2);
      else ctx.rect(x, y, bw * 0.75, h);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    return requestAnimationFrame(draw);
  }
  return draw();
}

/* ── Start MediaRecorder + waveform analyser ── */
async function _initRecorder() {
  try {
    _rec.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch(e) {
    showToast('Microphone access denied', 'error'); return false;
  }
  try {
    _rec.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    var src = _rec.audioCtx.createMediaStreamSource(_rec.stream);
    _rec.analyser = _rec.audioCtx.createAnalyser();
    _rec.analyser.fftSize = 256;
    src.connect(_rec.analyser);
  } catch(e) { _rec.analyser = null; }

  _rec.chunks = [];
  var mimes = ['audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus','audio/ogg','audio/mp4'];
  var mime = mimes.find(function(m){ try{ return MediaRecorder.isTypeSupported(m); }catch(e){ return false; }}) || '';
  try {
    _rec.mediaRec = mime ? new MediaRecorder(_rec.stream, { mimeType: mime }) : new MediaRecorder(_rec.stream);
  } catch(e) { _rec.mediaRec = new MediaRecorder(_rec.stream); }

  var actualMime = _rec.mediaRec.mimeType || mime || 'audio/webm';

  _rec.mediaRec.ondataavailable = function(e) {
    if (e.data && e.data.size > 0) _rec.chunks.push(e.data);
  };
  _rec.mediaRec.onstop = function() {
    var dur    = _rec.seconds;
    var chunks = _rec.chunks.slice();
    var wasCancelled = _rec.cancelled;
    _cleanupRecState();
    if (wasCancelled) return; // silently discard — single tap or programmatic cancel
    if (chunks.length === 0) { showToast('Recording failed — no audio captured', 'error'); return; }
    if (dur < 1) { showToast('Recording too short', 'error'); return; }
    var blob    = new Blob(chunks, { type: actualMime });
    var blobUrl = URL.createObjectURL(blob);
    _sendVoiceMessage(blobUrl, dur, actualMime);
  };

  // Do NOT start the MediaRecorder here.
  // _tgMicPointerDown checks _rec.cancelled after this resolves.
  // If user already released (single tap), we clean up without ever recording.
  return true;
}

/* Start the MediaRecorder — only called when pointer is confirmed still held */
function _startRecording() {
  _rec.mediaRec.start(250);
  _rec.active    = true;
  _rec.cancelled = false;
  _rec.seconds   = 0;
  _updateRecTimer();
  _rec.timer = setInterval(function() { _rec.seconds++; _updateRecTimer(); }, 1000);
}

function _updateRecTimer() {
  var t = _fmtDur(_rec.seconds);
  var el1 = document.getElementById('tg-rec-timer');
  var el2 = document.getElementById('tg-locked-timer');
  if (el1) el1.textContent = t;
  if (el2) el2.textContent = t;
}

/* ── Show the overlay and start waveform ── */
function _showRecOverlay() {
  var overlay = document.getElementById('tg-rec-overlay');
  if (overlay) {
    overlay.classList.add('visible');
    // Size canvas
    setTimeout(function() {
      var c = document.getElementById('tg-rec-waveform');
      if (c) c.width = Math.max(60, (c.parentElement ? c.parentElement.clientWidth - 100 : 200));
      if (_rec.analyser) _rec.rafId = drawWaveform('tg-rec-waveform', _rec.analyser, '#ef4444', 24);
    }, 40);
  }
}

function _hideRecOverlay() {
  var overlay = document.getElementById('tg-rec-overlay');
  if (overlay) overlay.classList.remove('visible');
  if (_rec.rafId) { cancelAnimationFrame(_rec.rafId); _rec.rafId = null; }
  var c = document.getElementById('tg-rec-waveform');
  if (c) c.getContext('2d').clearRect(0, 0, c.width, c.height);
  // Reset slide/lock hints
  var sh = document.getElementById('tg-slide-hint');
  var lh = document.getElementById('tg-lock-hint');
  if (sh) { sh.style.opacity = ''; sh.style.transform = ''; }
  if (lh) { lh.style.opacity = ''; lh.style.transform = ''; lh.classList.remove('locked'); }
}

/* ── Show locked row (after sliding up to lock) ── */
function _showLockedRow() {
  // Safety: if this is a blocked DM, cancel recording rather than locking
  if (App.activeConvType === 'chat' && App.activePeerId && isUserBlocked(App.activePeerId)) {
    cancelRecording(true); // silent: automatic safety stop
    return;
  }
  _rec.locked = true;
  _hideRecOverlay();
  var micBtn = document.getElementById('mic-btn');
  if (micBtn) micBtn.classList.remove('recording');
  var row = document.getElementById('tg-locked-row');
  if (row) {
    row.style.display = 'flex';
    setTimeout(function() {
      var c = document.getElementById('tg-locked-waveform');
      if (c) c.width = Math.max(60, (c.parentElement ? c.parentElement.clientWidth - 20 : 180));
      if (_rec.analyser) _rec.rafId2 = drawWaveform('tg-locked-waveform', _rec.analyser, '#ef4444', 24);
    }, 40);
  }
  // Hide the input row
  var rowMain = document.getElementById('input-row-main');
  if (rowMain) rowMain.style.display = 'none';
}

function _hideLockedRow() {
  var row = document.getElementById('tg-locked-row');
  if (row) row.style.display = 'none';
  if (_rec.rafId2) { cancelAnimationFrame(_rec.rafId2); _rec.rafId2 = null; }
  var c = document.getElementById('tg-locked-waveform');
  if (c) c.getContext('2d').clearRect(0, 0, c.width, c.height);
  var rowMain = document.getElementById('input-row-main');
  if (rowMain) rowMain.style.display = '';
}

/* ── Stop and send ── */
function stopRecording() {
  if (!_rec.mediaRec || _rec.mediaRec.state === 'inactive') return;
  clearInterval(_rec.timer); _rec.timer = null;
  if (_rec.rafId)  { cancelAnimationFrame(_rec.rafId);  _rec.rafId  = null; }
  if (_rec.rafId2) { cancelAnimationFrame(_rec.rafId2); _rec.rafId2 = null; }
  _rec.cancelled = false;
  try { _rec.mediaRec.stop(); } catch(e) {}
  _rec.active = false;
  _hideRecOverlay();
  _hideLockedRow();
  var micBtn = document.getElementById('mic-btn');
  if (micBtn) micBtn.classList.remove('recording');
  _updateSendMicVis();
}

/* ── Cancel and discard ── */
function cancelRecording(silent) {
  clearInterval(_rec.timer); _rec.timer = null;
  if (_rec.rafId)  { cancelAnimationFrame(_rec.rafId);  _rec.rafId  = null; }
  if (_rec.rafId2) { cancelAnimationFrame(_rec.rafId2); _rec.rafId2 = null; }
  if (_rec.mediaRec) {
    _rec.mediaRec.ondataavailable = null;
    // Keep onstop but flag cancelled
  }
  _rec.cancelled = true;
  _rec.active    = false;
  if (_rec.mediaRec && _rec.mediaRec.state !== 'inactive') {
    try { _rec.mediaRec.stop(); } catch(e) {}
  } else {
    _cleanupRecState();
  }
  _hideRecOverlay();
  _hideLockedRow();
  var micBtn = document.getElementById('mic-btn');
  if (micBtn) micBtn.classList.remove('recording');
  _updateSendMicVis();
  // Only show toast when explicitly cancelled by user (slide-left or trash)
  if (!silent) showToast('Recording cancelled', 'error');
}

function _cleanupRecState() {
  if (_rec.stream) { try { _rec.stream.getTracks().forEach(function(t){ t.stop(); }); } catch(e){} _rec.stream = null; }
  if (_rec.audioCtx) { try { _rec.audioCtx.close(); } catch(e){} _rec.audioCtx = null; }
  _rec.mediaRec = null; _rec.analyser = null;
  _rec.active = false; _rec.locked = false;
  _rec.pendingStart = false;
  _rec.seconds = 0; _rec.chunks = [];
}

function _resetRecordingUI() {
  _hideRecOverlay();
  _hideLockedRow();
  var micBtn = document.getElementById('mic-btn');
  if (micBtn) micBtn.classList.remove('recording');
  _updateSendMicVis();
}

/* ── Telegram-style pointer/touch events on mic button ── */
function _tgMicPointerDown(e) {
  if (e.button !== undefined && e.button !== 0) return; // left click only
  // Don't start recording in a DM with a blocked user
  if (App.activeConvType === 'chat' && App.activePeerId && isUserBlocked(App.activePeerId)) {
    showToast('You have blocked this user. Unblock to send messages.', 'error');
    return;
  }
  e.preventDefault();

  var clientX = e.clientX !== undefined ? e.clientX : (e.touches ? e.touches[0].clientX : 0);
  var clientY = e.clientY !== undefined ? e.clientY : (e.touches ? e.touches[0].clientY : 0);
  _rec.startX    = clientX;
  _rec.startY    = clientY;
  _rec.locked    = false;
  _rec.cancelled = false;
  _rec.pendingStart = true; // flag: pointerdown fired but getUserMedia not resolved yet

  var micBtn = document.getElementById('mic-btn');
  if (micBtn) micBtn.classList.add('recording');

  _initRecorder().then(function(ok) {
    _rec.pendingStart = false;
    if (!ok) {
      // getUserMedia failed (e.g. denied) — already toasted inside _initRecorder
      if (micBtn) micBtn.classList.remove('recording');
      return;
    }
    // Pointer released before getUserMedia resolved (single tap) → clean up silently
    if (_rec.cancelled) {
      _cleanupRecState();
      if (micBtn) micBtn.classList.remove('recording');
      _updateSendMicVis();
      return;
    }
    // Pointer still held → actually start the MediaRecorder now
    _startRecording();
    _showRecOverlay();
  });
}

function _tgMicPointerMove(e) {
  if (!_rec.active || _rec.locked) return;
  var clientX = e.clientX !== undefined ? e.clientX : (e.touches ? e.touches[0].clientX : 0);
  var clientY = e.clientY !== undefined ? e.clientY : (e.touches ? e.touches[0].clientY : 0);
  var dx = clientX - _rec.startX;  // negative = left
  var dy = clientY - _rec.startY;  // negative = up

  var slideHint  = document.getElementById('tg-slide-hint');
  var lockHint   = document.getElementById('tg-lock-hint');

  // Slide left → cancel hint fades/moves
  if (dx < 0 && Math.abs(dx) > Math.abs(dy)) {
    var pct = Math.min(1, Math.abs(dx) / _rec.cancelThreshold);
    if (slideHint) { slideHint.style.opacity = String(1 - pct * 0.5); slideHint.style.transform = 'translateX(' + (dx * 0.4) + 'px)'; }
    if (lockHint)  { lockHint.style.opacity = String(1 - pct); }
    if (Math.abs(dx) >= _rec.cancelThreshold) {
      cancelRecording(); return;
    }
  }

  // Slide up → lock
  if (dy < 0 && Math.abs(dy) > Math.abs(dx)) {
    var lockPct = Math.min(1, Math.abs(dy) / _rec.lockThreshold);
    if (lockHint)  { lockHint.style.opacity = '1'; lockHint.style.transform = 'translateY(' + (dy * 0.35) + 'px)'; lockHint.classList.toggle('locked', lockPct > 0.5); }
    if (slideHint) { slideHint.style.opacity = String(1 - lockPct); }
    if (Math.abs(dy) >= _rec.lockThreshold) {
      _showLockedRow(); return;
    }
  }
}

function _tgMicPointerUp(e) {
  if (_rec.locked) return; // locked: user must tap send/cancel explicitly
  if (_rec.pendingStart) {
    // pointerup fired before getUserMedia resolved — mark cancelled silently
    // _initRecorder().then() will handle cleanup with no toast
    _rec.cancelled = true;
    _rec.pendingStart = false;
    var micBtn = document.getElementById('mic-btn');
    if (micBtn) micBtn.classList.remove('recording');
    return;
  }
  if (!_rec.active) return;
  stopRecording();
}

/* Wire mic button events once DOM is ready */
function _wireMicBtn() {
  var btn = document.getElementById('mic-btn');
  if (!btn) return;

  // Pointer events (desktop + touch via pointer API)
  btn.addEventListener('pointerdown', function(e) {
    _tgMicPointerDown(e);
    btn.setPointerCapture(e.pointerId);
  }, { passive: false });

  btn.addEventListener('pointermove', function(e) {
    _tgMicPointerMove(e);
  }, { passive: false });

  btn.addEventListener('pointerup', function(e) {
    _tgMicPointerUp(e);
    try { btn.releasePointerCapture(e.pointerId); } catch(ex) {}
  }, { passive: false });

  btn.addEventListener('pointercancel', function(e) {
    if (_rec.active && !_rec.locked) stopRecording();
    try { btn.releasePointerCapture(e.pointerId); } catch(ex) {}
  }, { passive: false });

  // Prevent context menu on long-press mobile
  btn.addEventListener('contextmenu', function(e) { e.preventDefault(); }, { passive: false });
}

function handleMicClick() {
  // Fallback click handler — used if pointer events somehow don't fire
  // For locked recording: do nothing (send/cancel handled by locked-row buttons)
  if (_rec.locked) return;
  if (_rec.active) stopRecording();
  // If not active: do nothing — pointerdown already started it
}


/* -- Send voice message: upload blob to Supabase Storage then insert to DB -- */
async function _sendVoiceMessage(blobUrl, duration, mimeHint) {
  if (!App.currentUser || !App.activeChatId) { URL.revokeObjectURL(blobUrl); return; }
  // Don't upload/send if this is a blocked DM
  if (App.activeConvType === 'chat' && App.activePeerId && isUserBlocked(App.activePeerId)) {
    URL.revokeObjectURL(blobUrl);
    showToast('You have blocked this user. Unblock to send messages.', 'error');
    return;
  }
  var fmtDur   = _fmtDur(duration);
  var type     = App.activeConvType;
  var chatId   = App.activeChatId;
  var tableMap = { chat: ['messages','chat_id'], channel: ['channel_messages','channel_id'], group: ['group_messages','group_id'] };
  var pair     = tableMap[type]; if (!pair) { URL.revokeObjectURL(blobUrl); return; }

  var optId  = 'voice-opt-' + Date.now();
  var optMsg = {
    id: optId, sender_id: App.currentUser.id,
    content: '🎙 [voice:' + fmtDur + ':' + blobUrl + ']',
    created_at: new Date().toISOString(),
    profiles: App.currentProfile,
    _voiceUrl: blobUrl, _voiceDuration: duration
  };
  App.messages.push(optMsg);
  appendMessageToDOM(optMsg, type);
  scrollBottom(true);

  var publicUrl = null;
  try {
    var fetchResp = await fetch(blobUrl);
    if (!fetchResp.ok) throw new Error('blob fetch failed');
    var blob     = await fetchResp.blob();
    var blobMime = (blob.type && blob.type !== 'application/octet-stream') ? blob.type : (mimeHint || 'audio/webm');
    var ext      = blobMime.includes('mp4') ? 'm4a' : blobMime.includes('ogg') ? 'ogg' : 'webm';
    var path     = 'voice/' + App.currentUser.id + '_' + Date.now() + '.' + ext;
    var up       = await supabaseClient.storage.from('avatars').upload(path, blob, { upsert: true, contentType: blobMime, cacheControl: '3600' });
    if (!up.error) {
      var ud = supabaseClient.storage.from('avatars').getPublicUrl(path);
      if (ud && ud.data && ud.data.publicUrl) publicUrl = ud.data.publicUrl;
    } else { console.warn('[Insan] Voice upload error:', up.error.message); }
  } catch(e) { console.warn('[Insan] Voice upload exception:', e); }

  URL.revokeObjectURL(blobUrl);

  if (!publicUrl) {
    App.messages = App.messages.filter(function(m) { return m.id !== optId; });
    if (App.activeChatId === chatId) renderMessages(App.messages, type);
    showToast('Voice upload failed', 'error');
    return;
  }

  var dbContent = '🎙 [voice:' + fmtDur + ':' + publicUrl + ']';
  var payload = { sender_id: App.currentUser.id, content: dbContent };
  payload[pair[1]] = chatId;
  try {
    var r = await supabaseClient.from(pair[0]).insert(payload).select('*, profiles(id, username, avatar_url, display_name)').single();
    if (!r.error && r.data) {
      r.data._voiceUrl      = publicUrl;
      r.data._voiceDuration = duration;
      r.data.content        = dbContent; // ensure content matches exactly what we built
      // Remove opt placeholder and any raw realtime duplicate for this message
      App.messages = App.messages.filter(function(m) {
        if (m.id === r.data.id) return false; // remove realtime raw duplicate if it slipped in
        return true;
      });
      App.messages = App.messages.map(function(m) { return m.id === optId ? r.data : m; });
      if (App.activeChatId === chatId) { renderMessages(App.messages, type); scrollBottom(false); }
    } else { console.error('[Insan] _sendVoiceMessage insert error:', r.error); showToast('Voice message could not be saved', 'error'); }
  } catch(e) { console.error('[Insan] _sendVoiceMessage DB error:', e); showToast('Voice message could not be saved', 'error'); }
}


/* Show send button when text typed, mic button when empty */
function _updateSendMicVis() {
  if (_rec.active || _rec.locked) return; // don't disturb recording state
  var inp = document.getElementById('msg-input');
  var sendBtn = document.getElementById('send-btn');
  var micBtn  = document.getElementById('mic-btn');
  var hasText = inp && inp.value.trim().length > 0;
  var hasAtt  = _attachments && _attachments.length > 0;
  var showSend = hasText || hasAtt;
  if (sendBtn) sendBtn.style.display = showSend ? 'flex' : 'none';
  if (micBtn)  micBtn.style.display  = showSend ? 'none' : 'flex';
}

/* ══════════════════════════════════════════════════════════
   FILE ATTACHMENTS
   ══════════════════════════════════════════════════════════ */
function handleFileInputChange(files) {
  _processFiles(files);
  // Reset input so same file can be re-selected
  var fi = document.getElementById('file-attach-input');
  if (fi) fi.value = '';
}

function handleFileDrop(e) {
  e.preventDefault();
  handleDragLeave();
  _processFiles(e.dataTransfer.files);
}

function handleDragOver(e) {
  e.preventDefault();
  var hint = document.getElementById('drag-hint');
  if (hint) hint.style.display = 'block';
}

function handleDragLeave() {
  var hint = document.getElementById('drag-hint');
  if (hint) hint.style.display = 'none';
}

function _processFiles(files) {
  if (!files || !files.length) return;
  Array.from(files).forEach(function(file) {
    var maxMB = 50;
    if (file.size > maxMB * 1024 * 1024) {
      showToast(file.name + ' is too large (max ' + maxMB + 'MB)', 'error');
      return;
    }
    var kind = _getAttachKind(file.type, file.name);
    var reader = new FileReader();
    reader.onload = function(e) {
      _attachments.push({
        name: file.name, size: file.size, type: file.type,
        url: e.target.result,
        isImage: kind === 'image',
        kind: kind,
      });
      _renderAttachmentChips();
    };
    reader.readAsDataURL(file);
  });
}

function _renderAttachmentChips() {
  var wrap = document.getElementById('attach-preview');
  if (!wrap) return;
  if (_attachments.length === 0) { wrap.style.display = 'none'; wrap.innerHTML = ''; return; }
  wrap.style.display = 'flex';
  wrap.innerHTML = _attachments.map(function(a, i) {
    var k = a.kind || (a.isImage ? 'image' : 'file');
    var icons = {
      image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
      audio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
      video: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>',
      file:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>',
    };
    var icon = icons[k] || icons.file;
    var label = a.name.length > 18 ? a.name.slice(0,16)+'…' : a.name;
    // Thumbnail preview for images
    var thumb = (k === 'image' && a.url)
      ? '<img src="'+a.url+'" style="width:20px;height:20px;border-radius:4px;object-fit:cover;margin-right:2px">'
      : icon;
    return '<div class="attach-chip">' +
      thumb +
      '<span title="' + esc(a.name) + '">' + esc(label) + '</span>' +
      '<button class="attach-chip-del" onclick="_removeAttachment(' + i + ')" title="Remove">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="11" height="11"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
      '</button>' +
    '</div>';
  }).join('');
}

function _removeAttachment(idx) {
  _attachments.splice(idx, 1);
  _renderAttachmentChips();
}

function _fmtBytes(b) {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1048576).toFixed(1) + ' MB';
}


function _appendSystemMsg(text) {
  var area = document.getElementById('msg-area');
  if (!area) return;
  var div = document.createElement('div');
  div.className = 'msg-row';
  div.style.cssText = 'justify-content:center;margin:6px 0';
  div.innerHTML = '<div class="msg-bubble bubble-system">' + esc(text) + '</div>';
  area.appendChild(div);
  scrollBottom(true);
}

/* ══════════════════════════════════════════════════════════
   AUDIO PLAYBACK — _toggleAudio, _seekAudio, _voicePlayInstant
   ══════════════════════════════════════════════════════════ */

/* Stop all currently-playing audio elements and reset their buttons */
function _stopAllAudio() {
  var PLAY_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
  document.querySelectorAll('audio').forEach(function(a) {
    if (!a.paused) {
      a.pause();
      var btn = document.getElementById('playbtn-' + a.id);
      if (!btn) {
        var bub = a.closest ? a.closest('.msg-bubble') : null;
        btn = bub && bub.querySelector('.audio-play-btn');
        if (!btn) { var wr = a.parentElement; btn = wr && wr.querySelector('.audio-play-btn'); }
      }
      if (btn) btn.innerHTML = PLAY_SVG;
    }
  });
}

/* Ensure an <audio data-src="..."> has its src set via JS (getAttribute check avoids page-URL trap) */
function _ensureAudioSrc(audioEl) {
  if (!audioEl.getAttribute('src') && audioEl.dataset.src) {
    audioEl.src = _decodeHtmlEntities(audioEl.dataset.src);
    audioEl.preload = 'auto';
    audioEl.load();
  }
}

/* Play / pause toggle for audio file messages */
function _toggleAudio(audioId, btn) {
  var el = document.getElementById(audioId); if (!el) return;
  var PLAY_SVG  = '<svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
  var PAUSE_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';
  _ensureAudioSrc(el);
  if (!el.getAttribute('src')) return;
  if (!el.paused) { el.pause(); if (btn) btn.innerHTML = PLAY_SVG; return; }
  _stopAllAudio();
  if (btn) btn.innerHTML = PAUSE_SVG;
  var p = el.play();
  if (p && p.then) p.catch(function() { if (btn) btn.innerHTML = PLAY_SVG; });
}

/* Seek audio on progress-bar click / touch */
function _seekAudio(audioId, e) {
  var el = document.getElementById(audioId); if (!el || !el.duration) return;
  var track = document.getElementById('track-' + audioId); if (!track) return;
  var rect = track.getBoundingClientRect();
  var clientX = (e.touches && e.touches[0]) ? e.touches[0].clientX
              : (e.changedTouches && e.changedTouches[0]) ? e.changedTouches[0].clientX
              : e.clientX;
  el.currentTime = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * el.duration;
}

/* Play / pause toggle for voice messages */
function _voicePlayInstant(audioId, btn) {
  var el = document.getElementById(audioId); if (!el) return;
  var PLAY_SVG  = '<svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
  var PAUSE_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';
  _ensureAudioSrc(el);
  if (!el.getAttribute('src')) return;
  if (!el.paused) { el.pause(); if (btn) btn.innerHTML = PLAY_SVG; return; }
  _stopAllAudio();
  if (btn) btn.innerHTML = PAUSE_SVG;
  var p = el.play();
  if (p && p.then) p.catch(function() { if (btn) btn.innerHTML = PLAY_SVG; });
}

/* Dead-code stub kept so any old saved DB messages that reference _voiceDownload don't throw */
function _voiceDownload() {}

/* Determine kind of attachment from MIME type and extension */
function _getAttachKind(mimeType, name) {
  var mime = (mimeType || '').toLowerCase();
  var ext  = (name || '').split('.').pop().toLowerCase();
  if (mime.startsWith('image/')  || ['jpg','jpeg','png','gif','webp','bmp','svg','ico'].indexOf(ext) >= 0) return 'image';
  if (mime.startsWith('audio/')  || ['mp3','ogg','wav','flac','aac','m4a','opus','webm'].indexOf(ext) >= 0) return 'audio';
  if (mime.startsWith('video/')  || ['mp4','webm','mkv','avi','mov','m4v','ogv','3gp'].indexOf(ext) >= 0) return 'video';
  return 'file';
}

/* ══════════════════════════════════════════════════════
   CONTEXT MENU — Long-press / right-click on messages
   Telegram-style with reply, copy, forward, download, delete
   ══════════════════════════════════════════════════════ */

var _ctxMsgId   = null;
var _ctxMsgType = null;
var _ctxMsgData = null;
/* ══════════════════════════════════════════════════════════════
   CONTEXT MENU — single document-level delegation
   No duplicate listeners. Works on desktop (right-click) and
   mobile (long-press via touchstart non-passive).
   ══════════════════════════════════════════════════════════════ */

var _ctxLpTimer  = null;
var _ctxConvType = null;
var _ctxLpStartX = 0;
var _ctxLpStartY = 0;
var _ctxWiredDoc = false;   // guard — wire document only once

// Reply state
var _replyToMsg  = null;  // { id, senderName, preview }

/* Called from renderMessages + appendMessageToDOM — now a no-op body,
   all wiring is done once via _wireCtxDocLevel() on DOMContentLoaded */
function _wireContextMenus(area) { /* no-op — delegation is document-level */ }

/* Wire once on document. Called from DOMContentLoaded. */
function _wireCtxDocLevel() {
  if (_ctxWiredDoc) return;
  _ctxWiredDoc = true;

  /* ── Desktop: right-click ──────────────────────────────────── */
  document.addEventListener('contextmenu', function(e) {
    var bubble = e.target.closest('.msg-bubble');
    if (!bubble) return;
    e.preventDefault();
    _openCtxMenu(e.clientX, e.clientY, bubble);
  });

  /* ── Mobile: long-press via touchstart (non-passive so we can
       preventDefault to block native selection / callout)  ──── */
  document.addEventListener('touchstart', function(e) {
    var bubble = e.target.closest('.msg-bubble');
    if (!bubble) return;
    // Don't open context menu while a voice recording gesture is in progress
    if (_rec && _rec.active) return;

    // Don't block taps on interactive elements inside the bubble:
    // buttons (play/pause), links, audio/video elements, progress tracks, images
    var tgt = e.target;
    if (tgt.closest('button') || tgt.closest('a') ||
        tgt.tagName === 'AUDIO' || tgt.tagName === 'VIDEO' ||
        tgt.closest('.audio-progress-track') ||
        tgt.closest('.audio-play-btn') ||
        tgt.closest('.attach-img') ||
        tgt.closest('.attach-file') ||
        tgt.closest('.video-msg')) {
      return; // let the native tap / onclick fire normally
    }

    // Block native OS text-selection and iOS callout menu on plain text
    e.preventDefault();

    var t = e.touches[0];
    _ctxLpStartX = t.clientX;
    _ctxLpStartY = t.clientY;

    // Capture the message row id now so a re-render can't give us a stale bubble ref
    var msgRow = bubble.closest('.msg-row');
    var capturedMsgId = msgRow ? msgRow.id : null;

    clearTimeout(_ctxLpTimer);
    _ctxLpTimer = setTimeout(function() {
      _ctxLpTimer = null;
      // Re-resolve the bubble from the captured id in case DOM was updated
      var resolvedBubble = capturedMsgId
        ? document.querySelector('#' + capturedMsgId + ' .msg-bubble')
        : bubble;
      if (!resolvedBubble) return;
      navigator.vibrate && navigator.vibrate(40);
      _openCtxMenu(_ctxLpStartX, _ctxLpStartY, resolvedBubble);
    }, 500);
  }, { passive: false });   /* passive:false required for preventDefault */

  document.addEventListener('touchend', function(e) {
    if (_ctxLpTimer) { clearTimeout(_ctxLpTimer); _ctxLpTimer = null; }
  }, { passive: true });

  document.addEventListener('touchcancel', function(e) {
    if (_ctxLpTimer) { clearTimeout(_ctxLpTimer); _ctxLpTimer = null; }
  }, { passive: true });

  document.addEventListener('touchmove', function(e) {
    if (!_ctxLpTimer) return;
    var t = e.touches[0];
    var dx = t.clientX - _ctxLpStartX;
    var dy = t.clientY - _ctxLpStartY;
    if (dx*dx + dy*dy > 100) {       /* > 10px moved — cancel */
      clearTimeout(_ctxLpTimer); _ctxLpTimer = null;
    }
  }, { passive: true });

  /* Block selectstart on msg-bubbles — UNLESS the bubble has user-select
     temporarily re-enabled by _ctxSelectAll (Select Text action) */
  document.addEventListener('selectstart', function(e) {
    var bubble = e.target.closest('.msg-bubble');
    if (!bubble) return;
    // Inline style set by _ctxSelectAll — permit the selection
    if (bubble.style.userSelect === 'text' || bubble.style.webkitUserSelect === 'text') return;
    e.preventDefault();
  });
}

function _openCtxMenu(x, y, bubble) {
  var row = bubble.closest('.msg-row');
  if (!row) return;
  var msgId = row.id.replace('msg-', '');
  var msg   = App.messages.find(function(m) { return m.id === msgId; });
  if (!msg) return;

  _ctxMsgId    = msgId;
  _ctxConvType = App.activeConvType;
  var p = _parseContent(msg);
  _ctxMsgType  = p.kind === 'uploading' ? 'file' : p.kind;
  _ctxMsgData  = p;

  var isMe   = msg.sender_id === (App.currentUser && App.currentUser.id);
  var isText = _ctxMsgType === 'text';
  var hasUrl = !!p.url;

  var QUICK_EMOJIS = ['👍','❤️','😂','😮','😢','🙏'];

  var items = [];

  items.push({ icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>', label: 'Reply', fn: '_ctxReply()' });


  if (isText) {
    items.push({ icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>', label: 'Copy', fn: '_ctxCopy()' });
    items.push({ icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M9 7H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-3"/><path d="M9 15h3l8.5-8.5a1.5 1.5 0 0 0-3-3L9 12v3"/></svg>', label: 'Select Text', fn: '_ctxSelectAll()' });
  }

  // View/Open: for image (fullscreen viewer) and video (fullscreen player)
  if (_ctxMsgType === 'image') {
    items.push({ icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>', label: 'View Image', fn: '_ctxView()' });
  }
  if (_ctxMsgType === 'video') {
    items.push({ icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><polygon points="5 3 19 12 5 21 5 3"/></svg>', label: 'Play Video', fn: '_ctxView()' });
  }
  if (_ctxMsgType === 'file') {
    items.push({ icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>', label: 'Open File', fn: '_ctxView()' });
  }

  if (hasUrl) {
    items.push({ icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>', label: 'Download', fn: '_ctxDownload()' });
  }

  items.push({ icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><polyline points="15 17 20 12 15 7"/><path d="M4 18v-2a4 4 0 0 1 4-4h12"/></svg>', label: 'Forward', fn: '_ctxForward()' });

  if (hasUrl) {
    items.push({ icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>', label: 'Share', fn: '_ctxShare()' });
  }

  if (isMe && isText) {
    items.push({ icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>', label: 'Edit', fn: '_ctxEdit()' });
  }

  if (isMe) {
    items.push({ icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>', label: 'Delete', fn: '_ctxDelete()', danger: true });
  }

  _showCtxMenu(items, QUICK_EMOJIS, x, y);
}

function _showCtxMenu(items, emojis, x, y) {
  // Remove any existing menu immediately
  var old = document.getElementById('ctx-menu');
  if (old) old.remove();

  var menu = document.createElement('div');
  menu.id = 'ctx-menu';
  menu.className = 'ctx-menu';

  /* Stop any touch/pointer event inside the menu from bubbling to the
     document-level dismiss listener — this is the critical fix that
     makes tapping menu buttons actually work on mobile. */
  menu.addEventListener('touchstart',  function(e) { e.stopPropagation(); }, { passive: false });
  menu.addEventListener('pointerdown', function(e) { e.stopPropagation(); });

  // Emoji reaction row
  var emojiRow = document.createElement('div');
  emojiRow.className = 'ctx-emoji-row';
  emojis.forEach(function(emoji) {
    var btn = document.createElement('button');
    btn.className = 'ctx-emoji-btn';
    btn.textContent = emoji;
    var myReactions = (_msgReactions[_ctxMsgId] || []).filter(function(r) {
      return r.userId === (App.currentUser && App.currentUser.id);
    });
    if (myReactions.some(function(r) { return r.emoji === emoji; })) {
      btn.classList.add('ctx-emoji-active');
    }
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      _closeCtxMenu();
      _toggleReaction(_ctxMsgId, emoji);
    });
    emojiRow.appendChild(btn);
  });
  menu.appendChild(emojiRow);

  // Divider
  var divEl = document.createElement('div');
  divEl.className = 'ctx-divider';
  menu.appendChild(divEl);

  // Action items — use mousedown/touchend instead of click for snappier response
  items.forEach(function(item) {
    var btn = document.createElement('button');
    btn.className = 'ctx-menu-item' + (item.danger ? ' ctx-danger' : '');
    btn.innerHTML =
      '<span class="ctx-icon">' + item.icon + '</span>' +
      '<span class="ctx-label">' + item.label + '</span>';

    // Use pointerdown so it fires immediately without waiting for click delay
    btn.addEventListener('pointerdown', function(e) {
      e.stopPropagation();   // prevent document dismiss listener
      e.preventDefault();    // prevent focus/active state flicker
      _closeCtxMenu();
      // Small delay lets the close animation start before the action runs
      setTimeout(function() { (new Function(item.fn))(); }, 30);
    });
    menu.appendChild(btn);
  });

  document.body.appendChild(menu);

  // Measure and position
  var mw = 210;
  var mh = 64 + 1 + items.length * 44 + 8;
  var left = Math.min(x, window.innerWidth  - mw - 8);
  var top  = y - mh - 8;
  if (top < 60) top = Math.min(y + 12, window.innerHeight - mh - 8);
  if (left < 8) left = 8;
  menu.style.left = left + 'px';
  menu.style.top  = top  + 'px';

  requestAnimationFrame(function() { menu.classList.add('ctx-visible'); });

  /* Dismiss when tapping OUTSIDE the menu.
     We use a delayed touchstart/mousedown on document so:
     - The current touchstart (that opened the menu) doesn't immediately close it
     - The stopPropagation in the menu itself prevents it from closing on menu taps */
  setTimeout(function() {
    function outsideDismiss(ev) {
      var m = document.getElementById('ctx-menu');
      if (!m) { document.removeEventListener('touchstart', outsideDismiss, true); document.removeEventListener('mousedown', outsideDismiss, true); return; }
      if (!m.contains(ev.target)) {
        _closeCtxMenu();
        document.removeEventListener('touchstart', outsideDismiss, true);
        document.removeEventListener('mousedown',  outsideDismiss, true);
      }
    }
    document.addEventListener('touchstart', outsideDismiss, { capture: true, passive: true });
    document.addEventListener('mousedown',  outsideDismiss, { capture: true });
    document.addEventListener('scroll',     function() { _closeCtxMenu(); }, { once: true, capture: true });
  }, 80);
}

function _closeCtxMenu() {
  var m = document.getElementById('ctx-menu');
  if (!m) return;
  m.classList.remove('ctx-visible');
  setTimeout(function() { if (m.parentElement) m.remove(); }, 180);
}

/* ════════════════════════════════════════════════════════════════
   EMOJI REACTIONS — in-memory store + Supabase persistence
   ════════════════════════════════════════════════════════════════ */

// In-memory store: { [msgId]: [ { userId, emoji } ] }
var _msgReactions = {};

async function _toggleReaction(msgId, emoji) {
  if (!msgId || !emoji || !App.currentUser) return;
  var myId = App.currentUser.id;
  if (!_msgReactions[msgId]) _msgReactions[msgId] = [];

  var existing = _msgReactions[msgId].findIndex(function(r) { return r.userId === myId && r.emoji === emoji; });
  if (existing >= 0) {
    // Remove reaction
    _msgReactions[msgId].splice(existing, 1);
    _renderReactionBadge(msgId);
    // Delete from Supabase (best-effort)
    try {
      await supabaseClient.from('message_reactions')
        .delete()
        .eq('message_id', msgId)
        .eq('user_id', myId)
        .eq('emoji', emoji);
    } catch(_) {}
  } else {
    // Add reaction
    _msgReactions[msgId].push({ userId: myId, emoji: emoji, name: (App.currentProfile && (App.currentProfile.display_name || App.currentProfile.username)) || 'You' });
    _renderReactionBadge(msgId);
    // Persist to Supabase (best-effort)
    try {
      await supabaseClient.from('message_reactions').upsert({
        message_id: msgId,
        user_id: myId,
        emoji: emoji,
        conv_type: App.activeConvType || 'chat',
        conv_id: App.activeChatId || null,
      }, { onConflict: 'message_id,user_id,emoji' });
    } catch(_) {}
  }
}

function _renderReactionBadge(msgId) {
  var row = document.getElementById('msg-' + msgId);
  if (!row) return;
  var bwrap = row.querySelector('.msg-bwrap');
  if (!bwrap) return;

  // Remove existing badge
  var old = bwrap.querySelector('.msg-reactions');
  if (old) old.remove();

  var reactions = _msgReactions[msgId] || [];
  if (reactions.length === 0) return;

  // Group by emoji: { '👍': [{userId,name},...], ... }
  var grouped = {};
  reactions.forEach(function(r) {
    if (!grouped[r.emoji]) grouped[r.emoji] = [];
    grouped[r.emoji].push(r);
  });

  var myId = App.currentUser && App.currentUser.id;
  var html = '<div class="msg-reactions">';
  Object.keys(grouped).forEach(function(emoji) {
    var users = grouped[emoji];
    var iMine = users.some(function(r) { return r.userId === myId; });
    var tooltip = users.map(function(r) { return r.name || 'User'; }).join(', ');
    html += '<button class="msg-react-chip' + (iMine ? ' react-mine' : '') + '" title="' + esc(tooltip) + '" onclick="_toggleReaction(\'' + esc(msgId) + '\',\'' + emoji + '\')">' +
      emoji + '<span class="react-count">' + users.length + '</span>' +
    '</button>';
  });
  html += '</div>';

  bwrap.insertAdjacentHTML('beforeend', html);
}

async function _loadReactionsForConv(convId, convType) {
  if (!convId || !App.currentUser) return;
  try {
    var r = await supabaseClient.from('message_reactions')
      .select('message_id, user_id, emoji, profiles(display_name, username)')
      .eq('conv_id', convId)
      .eq('conv_type', convType);
    if (r.error || !r.data) return;
    // Rebuild in-memory store
    r.data.forEach(function(row) {
      var mid = row.message_id;
      if (!_msgReactions[mid]) _msgReactions[mid] = [];
      // Avoid duplicates
      if (!_msgReactions[mid].some(function(x) { return x.userId === row.user_id && x.emoji === row.emoji; })) {
        _msgReactions[mid].push({
          userId: row.user_id,
          emoji: row.emoji,
          name: row.profiles ? (row.profiles.display_name || row.profiles.username) : 'User',
        });
      }
    });
    // Render badges on already-loaded messages
    Object.keys(_msgReactions).forEach(function(mid) { _renderReactionBadge(mid); });
  } catch(_) { /* reactions table may not exist yet — silently skip */ }
}

/* ── Context actions ─────────────────────────────────────────── */

function _ctxReply() {
  var msg = App.messages.find(function(m) { return m.id === _ctxMsgId; });
  if (!msg) return;
  var senderName = (msg.profiles && (msg.profiles.display_name || msg.profiles.username)) || 'User';
  var p = _ctxMsgData || _parseContent(msg);
  var preview = p.kind === 'text' ? (p.text || '').slice(0, 80)
              : p.kind === 'voice' ? '🎙 Voice message'
              : p.kind === 'audio' ? '🎵 ' + (p.name || 'Audio')
              : p.kind === 'image' ? '📷 Photo'
              : p.kind === 'video' ? '🎬 Video'
              : '📎 ' + (p.name || 'File');

  _replyToMsg = { id: _ctxMsgId, senderName: senderName, preview: preview };

  // Show reply bar above input
  var bar = $('reply-bar');
  if (!bar) return;
  var nm  = bar.querySelector('.reply-bar-name');
  var prv = bar.querySelector('.reply-bar-preview');
  if (nm)  nm.textContent  = senderName;
  if (prv) prv.textContent = preview;
  bar.style.display = 'flex';
  var inp = $('msg-input');
  if (inp) inp.focus();
}

function _clearReply() {
  _replyToMsg = null;
  var bar = $('reply-bar');
  if (bar) bar.style.display = 'none';
}

function _ctxCopy() {
  if (!_ctxMsgData) return;
  var text = _ctxMsgData.text || _ctxMsgData.url || '';
  if (navigator.clipboard && text) {
    navigator.clipboard.writeText(text).then(function() { showToast('Copied ✓'); }).catch(function() { _ctxCopyFallback(text); });
  } else { _ctxCopyFallback(text); }
}
function _ctxCopyFallback(text) {
  var ta = document.createElement('textarea');
  ta.value = text; ta.style.cssText = 'position:fixed;opacity:0';
  document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); showToast('Copied ✓'); } catch(_) {}
  document.body.removeChild(ta);
}

function _ctxSelectAll() {
  if (!_ctxMsgData || !_ctxMsgData.text) return;
  var el = document.querySelector('#msg-' + _ctxMsgId + ' .msg-bubble');
  if (!el) return;
  // Temporarily re-enable user-select so the browser permits the range selection
  el.style.userSelect = 'text';
  el.style.webkitUserSelect = 'text';
  var sel = window.getSelection(), range = document.createRange();
  range.selectNodeContents(el);
  sel.removeAllRanges();
  sel.addRange(range);
  showToast('Text selected — copy with your device copy button');
  // Re-lock after 5 s so a stray tap doesn't leave permanent selection enabled
  setTimeout(function() {
    el.style.userSelect = '';
    el.style.webkitUserSelect = '';
  }, 5000);
}

function _ctxEdit() {
  if (!_ctxMsgId || !_ctxMsgData) return;
  var msg = App.messages.find(function(m) { return m.id === _ctxMsgId; });
  if (!msg || msg.sender_id !== (App.currentUser && App.currentUser.id)) return;
  var inp = $('msg-input');
  if (inp) {
    inp.value = _ctxMsgData.text || '';
    inp.dataset.editingMsgId = _ctxMsgId;
    inp.focus(); autoResize(inp);
    var sendBtn = $('send-btn');
    if (sendBtn) { sendBtn.style.background = 'var(--accent-lt)'; sendBtn.title = 'Save edit'; }
    showToast('Editing — tap Send to save');
  }
}

async function _ctxDelete() {
  if (!_ctxMsgId) return;
  var msg = App.messages.find(function(m) { return m.id === _ctxMsgId; });
  if (!msg) return;
  if (msg.sender_id !== (App.currentUser && App.currentUser.id)) return showToast('You can only delete your own messages', 'error');

  var type = _ctxConvType || App.activeConvType;
  var tableMap = { chat: 'messages', channel: 'channel_messages', group: 'group_messages' };
  var table = tableMap[type] || 'messages';
  try {
    var { error } = await supabaseClient.from(table).delete().eq('id', _ctxMsgId);
    if (error) throw error;
    App.messages = App.messages.filter(function(m) { return m.id !== _ctxMsgId; });
    var el = document.getElementById('msg-' + _ctxMsgId);
    if (el) {
      el.style.transition = 'opacity .2s,transform .2s';
      el.style.opacity = '0'; el.style.transform = 'scale(.95)';
      setTimeout(function() { if (el.parentElement) el.remove(); }, 200);
    }
    showToast('Deleted');
  } catch(e) { showToast((e && e.message) || 'Could not delete', 'error'); }
}

function _ctxShare() {
  var text = (_ctxMsgData && (_ctxMsgData.text || _ctxMsgData.url)) || '';
  if (navigator.share && text) {
    navigator.share({ title: 'Insan', text: _ctxMsgData.text || '', url: _ctxMsgData.url || window.location.href }).catch(function(){});
  } else if (text) {
    _ctxCopyFallback(text); showToast('Copied (share not supported on this browser)');
  }
}

function _ctxView() {
  if (!_ctxMsgData) return;
  var url = _ctxMsgData.url; if (!url) return;
  var k = _ctxMsgType;
  if (k === 'image') { _openImageFull(url); return; }
  if (k === 'video') { _openVideoFull(url, _ctxMsgData.name); return; }
  _openFile(url, _ctxMsgData.name);
}

async function _ctxDownload() {
  var url  = (_ctxMsgData && _ctxMsgData.url)  || '';
  var name = (_ctxMsgData && (_ctxMsgData.name || 'voice-message')) || 'insan-file';
  if (!url) return;

  // Fix name for voice messages
  if (_ctxMsgType === 'voice' && (!_ctxMsgData.name || _ctxMsgData.name === 'insan-file')) {
    var ext = url.includes('.ogg') ? 'ogg' : url.includes('.m4a') ? 'm4a' : 'webm';
    name = 'voice-message.' + ext;
  }

  showToast('Downloading ' + name + '…');
  try {
    // Use fetch+blob to handle cross-origin Supabase URLs properly
    var decodedUrl = url.replace(/&amp;/g,'&').replace(/&#39;/g,"'").replace(/&quot;/g,'"');
    var resp = await fetch(decodedUrl, { mode: 'cors', cache: 'no-store' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    var blob = await resp.blob();
    var objUrl = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = objUrl; a.download = name; a.style.display = 'none';
    document.body.appendChild(a); a.click();
    setTimeout(function() { document.body.removeChild(a); URL.revokeObjectURL(objUrl); }, 1000);
    showToast(name + ' saved ✓');
  } catch(err) {
    // Fallback to direct link
    var a = document.createElement('a');
    a.href = url; a.download = name; a.target = '_blank'; a.style.display = 'none';
    document.body.appendChild(a); a.click();
    setTimeout(function() { document.body.removeChild(a); }, 500);
  }
}

/* Video fullscreen viewer */
function _openVideoFull(url, name) {
  var old = document.getElementById('video-full-overlay');
  if (old) old.remove();

  var ov = document.createElement('div');
  ov.id = 'video-full-overlay';
  ov.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.97);display:flex;flex-direction:column;align-items:center;justify-content:center;animation:imgLbIn .18s ease';

  var closeBtn = document.createElement('button');
  closeBtn.innerHTML = '&times;';
  closeBtn.style.cssText = 'position:absolute;top:16px;right:16px;background:rgba(255,255,255,.15);border:none;color:white;border-radius:50%;width:40px;height:40px;font-size:24px;cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:1;line-height:1';
  closeBtn.onclick = function() { ov.remove(); };
  ov.appendChild(closeBtn);

  var video = document.createElement('video');
  video.src = url;
  video.controls = true;
  video.autoplay = true;
  video.setAttribute('playsinline', '');
  video.style.cssText = 'max-width:96vw;max-height:84vh;border-radius:10px;outline:none';
  video.onerror = function() { showToast('Could not play video', 'error'); ov.remove(); };
  ov.appendChild(video);

  if (name) {
    var label = document.createElement('div');
    label.textContent = name;
    label.style.cssText = 'color:rgba(255,255,255,.5);font-size:13px;margin-top:10px;max-width:90vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    ov.appendChild(label);
  }

  // Tap background to close
  ov.addEventListener('pointerdown', function(e) {
    if (e.target === video) return;
    ov.remove();
  });

  function onKey(e) { if (e.key === 'Escape') { ov.remove(); document.removeEventListener('keydown', onKey); } }
  document.addEventListener('keydown', onKey);

  document.body.appendChild(ov);
}

/* Open a file — viewable types open in a lightbox/new tab; others trigger download */
function _openFile(url, name) {
  if (!url) return;
  var decoded = url.replace(/&amp;/g,'&').replace(/&#39;/g,"'").replace(/&quot;/g,'"');
  var ext = (name || decoded).split('.').pop().toLowerCase().split('?')[0];

  // Images — use our lightbox
  if (['png','jpg','jpeg','gif','webp','svg','bmp','ico'].indexOf(ext) >= 0) {
    _openImageFull(decoded); return;
  }
  // Videos — use our video viewer
  if (['mp4','webm','ogg','mov','avi'].indexOf(ext) >= 0) {
    _openVideoFull(decoded, name); return;
  }
  // PDFs, text, HTML, audio — open in new browser tab (browser renders them inline)
  if (['pdf','txt','csv','json','xml','html','htm','mp3','wav','m4a'].indexOf(ext) >= 0) {
    window.open(decoded, '_blank', 'noopener'); return;
  }
  // Everything else — trigger download via anchor click
  var a = document.createElement('a');
  a.href = decoded; a.download = name || 'file'; a.target = '_blank';
  a.style.display = 'none';
  document.body.appendChild(a); a.click();
  setTimeout(function() { document.body.removeChild(a); }, 500);
}
var _origSend = null;
function _patchSendForEdit() {
  var inp = $('msg-input');
  if (!inp) return;
  inp.addEventListener('keydown', async function(e) {
    if (e.key === 'Enter' && !e.shiftKey && inp.dataset.editingMsgId) {
      e.preventDefault();
      await _saveEditedMessage(inp.dataset.editingMsgId, inp.value.trim());
    }
  });
}

async function _saveEditedMessage(msgId, newText) {
  if (!newText || !msgId) return;
  var type = App.activeConvType;
  var tableMap = { chat: 'messages', channel: 'channel_messages', group: 'group_messages' };
  var table = tableMap[type] || 'messages';
  try {
    var { error } = await supabaseClient.from(table).update({ content: newText }).eq('id', msgId);
    if (error) throw error;
    App.messages = App.messages.map(function(m) { return m.id === msgId ? Object.assign({}, m, { content: newText }) : m; });
    renderMessages(App.messages, type);
    var inp = $('msg-input');
    if (inp) { inp.value = ''; inp.dataset.editingMsgId = ''; autoResize(inp); }
    var sb = $('send-btn'); if (sb) { sb.style.background = ''; sb.title = ''; }
    showToast('Message updated ✓');
  } catch(e) {
    showToast((e && e.message) || 'Could not edit', 'error');
  }
}

/* ══════════════════════════════════════════════════════════════════════
   VOICE CHAT — Real-time WebRTC via Supabase Realtime signaling
   WhatsApp/Telegram style voice calls
   ══════════════════════════════════════════════════════════════════════

   SIGNAL FLOW (both sides use same Supabase broadcast channel):
     Caller: broadcast { type:'vc-call',   from, name, avatar, chatId }
     Callee: broadcast { type:'vc-answer', from, sdp  }
     Both:   broadcast { type:'vc-ice',    from, candidate }
     Either: broadcast { type:'vc-end',    from }
   ═══════════════════════════════════════════════════════════════════ */

var VC = {
  active:      false,
  isCaller:    false,
  muted:       false,
  speaker:     true,
  pc:          null,       // RTCPeerConnection
  localStream: null,
  remoteAudio: null,
  signalCh:    null,       // Supabase Realtime channel
  timerInt:    null,
  elapsed:     0,
  rafLocal:    null,
  rafRemote:   null,
  localCtx:    null,
  localAn:     null,
  remoteCtx:   null,
  remoteAn:    null,
  pendingOffer:null,       // stored while waiting for user to accept
  pendingFrom: null,
  chatId:      null,
  peerId:      null,
  peerName:    null,
  peerAvatar:  null,
  incomingRing:null,
  noAnswerTimer:null,      // auto-cancel if peer never answers
};

var STUN_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
  ]
};

/* ─── Start a call (caller side) ─────────────────────────────── */
async function startVoiceCall() {
  if (!App.activeChatId) return;

  // ── Group / Channel → Group Voice Chat ──
  if (App.activeConvType === 'group') {
    return gvcStart();
  }
  if (App.activeConvType === 'channel') {
    if (App.activeConvRole !== 'admin') {
      // Non-admin: can only join if room is active
      if (GVC.active && GVC.chatId === App.activeChatId) {
        return gvcJoin();
      }
      return showToast('Only the channel admin can start a voice chat', 'error');
    }
    return gvcStart();
  }

  // ── DM → 1-on-1 call (existing behaviour) ──
  if (VC.active) return showToast('A call is already active');

  // Get peer info
  var peerId = App.activePeerId;
  var peerProfile = peerId && App._memberCache[peerId];
  var peerName   = peerProfile ? (peerProfile.display_name || peerProfile.username || 'User') : 'User';
  var peerAvatar = peerProfile ? avatarSrc(peerProfile) : '';

  VC.isCaller   = true;
  VC.chatId     = App.activeChatId;
  VC.peerId     = peerId;
  VC.peerName   = peerName;
  VC.peerAvatar = peerAvatar;

  _vcShowOverlay(peerName, peerAvatar, 'Calling…');

  try {
    VC.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  } catch(e) {
    _vcHideOverlay();
    return showToast('Microphone access denied — please allow it', 'error');
  }

  _vcSetupLocalAudio();
  _vcSetupPeerConnection();

  // Signal peer via Supabase Realtime broadcast
  _vcJoinSignalChannel(App.activeChatId);

  // Create offer
  try {
    var offer = await VC.pc.createOffer({ offerToReceiveAudio: true });
    await VC.pc.setLocalDescription(offer);
    var _callPayload = { type: 'vc-call', from: App.currentUser.id,
      name:   App.currentProfile ? (App.currentProfile.display_name || App.currentProfile.username) : 'User',
      avatar: App.currentProfile ? avatarSrc(App.currentProfile) : '',
      chatId: App.activeChatId,
      sdp:    offer,
    };
    _vcSignal(_callPayload);
    // Also ring the peer on their personal call channel so they hear it
    // even if they are not currently in this chat
    if (peerId) {
      _vcRingPeer(peerId, _callPayload);
    }
    // Send a system message so peer sees it in chat
    _dmNotifyCallStarted();
    _vcShowStatus('Calling…', false);
    // Auto-cancel if peer never answers within 40 seconds
    clearTimeout(VC.noAnswerTimer);
    VC.noAnswerTimer = setTimeout(function() {
      if (VC.isCaller && !VC.active) {
        endVoiceCall(true);
        showToast(peerName + ' didn\'t answer', 'error');
      }
    }, 40000);
  } catch(e) {
    endVoiceCall(false);
    showToast('Could not start call — please try again', 'error');
  }
}

/* ─── Accept incoming call ────────────────────────────────────── */
async function acceptIncomingCall() {
  _vcHideIncoming();
  _stopCallRingtone();
  if (!VC.pendingOffer) return;

  _vcShowOverlay(VC.peerName, VC.peerAvatar, 'Connecting…');

  try {
    VC.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  } catch(e) {
    _vcHideOverlay();
    return showToast('Microphone access denied', 'error');
  }

  _vcSetupLocalAudio();
  _vcSetupPeerConnection();

  try {
    await VC.pc.setRemoteDescription(new RTCSessionDescription(VC.pendingOffer));
    var answer = await VC.pc.createAnswer();
    await VC.pc.setLocalDescription(answer);
    _vcSignal({ type: 'vc-answer', from: App.currentUser.id, sdp: answer });
    VC.pendingOffer = null;
    _vcShowStatus('Connecting…', false);
  } catch(e) {
    endVoiceCall(false);
    showToast('Could not connect call', 'error');
  }
}

/* ─── Decline ─────────────────────────────────────────────────── */
function declineIncomingCall() {
  _vcHideIncoming();
  _stopCallRingtone();
  _vcSignal({ type: 'vc-end', from: App.currentUser.id });
  // Save missed call to history
  if (VC.peerName || VC.pendingFrom) {
    _addCallHistory({ type: 'missed', name: VC.peerName || 'Unknown', avatar: VC.peerAvatar || '', duration: 0, chatId: VC.chatId });
  }
  VC.pendingOffer = null;
  VC.pendingFrom  = null;
  _vcLeaveSignalChannel();
}

/* ─── End call ────────────────────────────────────────────────── */
function endVoiceCall(notifyPeer) {
  if (notifyPeer !== false && VC.signalCh) {
    try { _vcSignal({ type: 'vc-end', from: App.currentUser.id }); } catch(_) {}
  }
  // Save call to history BEFORE resetting elapsed (must be first)
  if (VC.active && VC.elapsed > 0) {
    _addCallHistory({ type: VC.isCaller ? 'outgoing' : 'incoming', name: VC.peerName || 'Unknown', avatar: VC.peerAvatar || '', duration: VC.elapsed, chatId: VC.chatId });
  }
  // Stop no-answer timer
  clearTimeout(VC.noAnswerTimer); VC.noAnswerTimer = null;
  // Stop timer and reset elapsed
  clearInterval(VC.timerInt); VC.timerInt = null; VC.elapsed = 0;
  // Stop animations
  if (VC.rafLocal)  { cancelAnimationFrame(VC.rafLocal);  VC.rafLocal = null; }
  if (VC.rafRemote) { cancelAnimationFrame(VC.rafRemote); VC.rafRemote = null; }
  // Stop local stream
  if (VC.localStream) { VC.localStream.getTracks().forEach(function(t){ t.stop(); }); VC.localStream = null; }
  // Close audio contexts
  if (VC.localCtx)  { VC.localCtx.close().catch(function(){}); VC.localCtx  = null; }
  if (VC.remoteCtx) { VC.remoteCtx.close().catch(function(){}); VC.remoteCtx = null; }
  VC.localAn = null; VC.remoteAn = null;
  // Close peer connection
  if (VC.pc) { try { VC.pc.close(); } catch(_) {} VC.pc = null; }
  // Clean remote audio
  if (VC.remoteAudio) { VC.remoteAudio.srcObject = null; VC.remoteAudio = null; }
  // Leave signal channel
  _vcLeaveSignalChannel();
  // Hide UI
  _vcHideOverlay();
  _vcHideIncoming();
  _stopCallRingtone();
  VC.active      = false;
  VC.muted       = false;
  VC.isCaller    = false;
  VC.pendingOffer= null;
  VC.pendingFrom = null;
}

/* ─── Mute toggle ─────────────────────────────────────────────── */
function vcToggleMute() {
  VC.muted = !VC.muted;
  if (VC.localStream) {
    VC.localStream.getAudioTracks().forEach(function(t) { t.enabled = !VC.muted; });
  }
  var btn = document.getElementById('vc-mute-btn');
  var ico = document.getElementById('vc-mute-icon');
  var miniBtn = document.getElementById('vc-mini-mute-btn');
  if (btn) btn.classList.toggle('vc-ctrl-active', VC.muted);
  if (miniBtn) miniBtn.classList.toggle('muted', VC.muted);
  if (ico) ico.innerHTML = VC.muted
    ? '<line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>'
    : '<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>';
  // Also update mini-strip mute icon
  if (miniBtn) miniBtn.querySelector('svg').innerHTML = VC.muted
    ? '<line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>'
    : '<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>';
  showToast(VC.muted ? 'Muted' : 'Unmuted');
}

/* ─── Speaker toggle ──────────────────────────────────────────── */
function vcToggleSpeaker() {
  VC.speaker = !VC.speaker;
  if (VC.remoteAudio) VC.remoteAudio.volume = VC.speaker ? 1 : 0.1;
  var btn = document.getElementById('vc-speaker-btn');
  if (btn) btn.classList.toggle('vc-ctrl-active', !VC.speaker);
  showToast(VC.speaker ? 'Speaker on' : 'Earpiece mode');
}

/* ─── Setup RTCPeerConnection ─────────────────────────────────── */
function _vcSetupPeerConnection() {
  VC.pc = new RTCPeerConnection(STUN_SERVERS);

  // Add local tracks
  if (VC.localStream) {
    VC.localStream.getTracks().forEach(function(t) { VC.pc.addTrack(t, VC.localStream); });
  }

  // ICE candidates → signal to peer
  VC.pc.onicecandidate = function(e) {
    if (e.candidate) {
      _vcSignal({ type: 'vc-ice', from: App.currentUser.id, candidate: e.candidate });
    }
  };

  VC.pc.onconnectionstatechange = function() {
    var s = VC.pc && VC.pc.connectionState;
    if (s === 'connected')     { _vcOnConnected(); }
    if (s === 'disconnected' || s === 'failed' || s === 'closed') {
      if (VC.active) { endVoiceCall(false); showToast('Call disconnected', 'error'); }
    }
  };

  // Remote audio
  VC.pc.ontrack = function(e) {
    if (!VC.remoteAudio) {
      VC.remoteAudio = new Audio();
      VC.remoteAudio.autoplay = true;
      VC.remoteAudio.volume   = 1;
    }
    VC.remoteAudio.srcObject = e.streams[0];
    _vcSetupRemoteAudio(e.streams[0]);
  };
}

/* ─── Local audio analyser ────────────────────────────────────── */
function _vcSetupLocalAudio() {
  try {
    VC.localCtx = new (window.AudioContext || window.webkitAudioContext)();
    var src = VC.localCtx.createMediaStreamSource(VC.localStream);
    VC.localAn = VC.localCtx.createAnalyser();
    VC.localAn.fftSize = 256; VC.localAn.smoothingTimeConstant = 0.75;
    src.connect(VC.localAn);
    VC.rafLocal = drawWaveform('vc-local-waveform', VC.localAn, 'rgba(255,255,255,.5)', 16);
  } catch(_) {}
}

/* ─── Remote audio analyser + speaking detection ─────────────── */
function _vcSetupRemoteAudio(stream) {
  try {
    VC.remoteCtx = new (window.AudioContext || window.webkitAudioContext)();
    var src = VC.remoteCtx.createMediaStreamSource(stream);
    VC.remoteAn = VC.remoteCtx.createAnalyser();
    VC.remoteAn.fftSize = 256; VC.remoteAn.smoothingTimeConstant = 0.75;
    src.connect(VC.remoteAn);
    VC.rafRemote = drawWaveform('vc-waveform', VC.remoteAn, 'rgba(255,255,255,.85)', 28);
    // Speaking ring pulse
    var buf = new Uint8Array(VC.remoteAn.frequencyBinCount);
    (function checkSpeak() {
      if (!VC.active) return;
      VC.remoteAn.getByteFrequencyData(buf);
      var avg = buf.reduce(function(a,b){return a+b;},0)/buf.length;
      var ring = document.getElementById('vc-avatar-ring');
      if (ring) ring.classList.toggle('speaking', avg > 12);
      requestAnimationFrame(checkSpeak);
    })();
  } catch(_) {}
}

/* ─── Called when WebRTC is actually connected ───────────────── */
function _vcOnConnected() {
  if (VC.active) return; // already counted
  VC.active = true;
  _vcShowStatus('', true); // show timer
  VC.elapsed = 0;
  clearInterval(VC.timerInt);
  VC.timerInt = setInterval(function() {
    VC.elapsed++;
    var m = Math.floor(VC.elapsed/60), s = VC.elapsed%60;
    var timeStr = String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0');
    var el = document.getElementById('vc-call-timer');
    if (el) el.textContent = timeStr;
    // Update mini-strip time
    var miniTime = document.getElementById('vc-mini-time');
    if (miniTime) miniTime.innerHTML = '<span class="vc-mini-pulse"></span>' + timeStr;
  }, 1000);
}

/* ─── Supabase Realtime signaling channel ────────────────────── */
function _vcJoinSignalChannel(chatId) {
  _vcLeaveSignalChannel();
  VC.signalCh = supabaseClient
    .channel('vc-signal-' + chatId, { config: { broadcast: { self: false } } })
    .on('broadcast', { event: 'vc-signal' }, function(payload) {
      _vcHandleSignal(payload.payload || payload);
    })
    .subscribe();
}

function _vcLeaveSignalChannel() {
  if (VC.signalCh) {
    try { supabaseClient.removeChannel(VC.signalCh); } catch(_) {}
    VC.signalCh = null;
  }
}

function _vcSignal(data) {
  if (!VC.signalCh) return;
  VC.signalCh.send({ type: 'broadcast', event: 'vc-signal', payload: data }).catch(function(){});
}

async function _vcHandleSignal(data) {
  if (!data || !data.type) return;
  if (data.from === (App.currentUser && App.currentUser.id)) return; // own signal

  // vc-call is handled exclusively by _vcStartUserCallChannel (vc-calls-{userId} channel).
  // The signal channel (vc-signal-{chatId}) only carries vc-answer, vc-ice, vc-end.
  if (data.type === 'vc-call') return;

  if (data.type === 'vc-answer') {
    if (!VC.pc || !data.sdp) return;
    // Peer answered — cancel the no-answer timeout
    clearTimeout(VC.noAnswerTimer); VC.noAnswerTimer = null;
    try { await VC.pc.setRemoteDescription(new RTCSessionDescription(data.sdp)); } catch(_) {}
    return;
  }

  if (data.type === 'vc-ice') {
    if (!VC.pc || !data.candidate) return;
    try { await VC.pc.addIceCandidate(new RTCIceCandidate(data.candidate)); } catch(_) {}
    return;
  }

  if (data.type === 'vc-end') {
    if (VC.active || VC.pendingOffer) {
      _vcHideIncoming(); _stopCallRingtone();
      if (VC.active) { endVoiceCall(false); showToast('Call ended'); }
      else { VC.pendingOffer = null; showToast('Call missed'); }
    }
    return;
  }
}

/* ─── Subscribe to incoming calls on opened chat (caller-side signal channel) ── */
function _vcSubscribeIncoming(chatId) {
  if (!chatId || !App.currentUser) return;
  if (!VC.signalCh) _vcJoinSignalChannel(chatId);
}

/* ─── Per-user incoming call channel ─────────────────────────────────────────
   Listens on  vc-calls-{userId} — a personal broadcast channel the CALLER
   rings when initiating a call.  Works regardless of which screen the receiver
   is on.  Separate from vc-signal-{chatId} which carries ICE / SDP traffic.   */
var _vcUserCallCh  = null;  // personal incoming-call channel

function _vcStartUserCallChannel() {
  _vcStopUserCallChannel();
  if (!App.currentUser || !supabaseClient) return;
  _vcUserCallCh = supabaseClient
    .channel('vc-calls-' + App.currentUser.id, { config: { broadcast: { self: false } } })
    .on('broadcast', { event: 'vc-ring' }, function(payload) {
      var data = payload.payload || payload;
      if (!data) return;
      if (data.from === App.currentUser.id) return; // own echo
      if (VC.active) {
        // Already in a call — send busy signal back via a temporary channel
        _vcDeclineBusy(data.chatId);
        return;
      }
      // Store pending offer; join signal channel for answer/ice/end
      VC.pendingOffer = data.sdp;
      VC.pendingFrom  = data.from;
      VC.peerName   = data.name   || 'User';
      VC.peerAvatar = data.avatar || '';
      VC.chatId     = data.chatId || null;
      VC.isCaller   = false;
      _vcJoinSignalChannel(VC.chatId);
      // Show only the top-of-screen banner (no full-screen overlay)
      fireNotification({
        title:    (VC.peerName || 'Someone') + ' is calling…',
        body:     'Tap Answer to connect',
        icon:     VC.peerAvatar || 'icons/insan.png',
        convId:   VC.chatId,
        convType: 'chat',
        peerId:   VC.pendingFrom,
        isCall:   true,
      });
    })
    .subscribe();
}

function _vcStopUserCallChannel() {
  if (_vcUserCallCh) {
    try { supabaseClient.removeChannel(_vcUserCallCh); } catch(_) {}
    _vcUserCallCh = null;
  }
}

/* One-shot send to peer's personal call channel */
function _vcRingPeer(peerId, callPayload) {
  if (!peerId || !supabaseClient) return;

  // 1. Realtime broadcast — reaches user if app is open
  var ringCh = supabaseClient
    .channel('vc-calls-' + peerId, { config: { broadcast: { self: false } } })
    .subscribe(function(status) {
      if (status === 'SUBSCRIBED') {
        ringCh.send({ type: 'broadcast', event: 'vc-ring', payload: callPayload })
          .catch(function(){});
        setTimeout(function() { try { supabaseClient.removeChannel(ringCh); } catch(_) {} }, 4000);
      }
    });

  // 2. Web Push notification — reaches user even when app is CLOSED/backgrounded
  //    This is what enables true background calls like WhatsApp/Telegram
  _sendCallPushNotification(peerId, callPayload);
}

/* Send a Web Push call notification via Supabase Edge Function.
   This wakes the device even when the browser/app is completely closed. */
async function _sendCallPushNotification(targetUserId, callPayload) {
  if (!App.currentUser || !supabaseClient) return;
  // Edge function URL — set SUPABASE_URL in supabase-config.js
  var baseUrl = window.SUPABASE_URL;
  if (!baseUrl || baseUrl.includes('YOUR_')) return;

  var myName   = App.currentProfile ? (App.currentProfile.display_name || App.currentProfile.username || 'Someone') : 'Someone';
  var myAvatar = App.currentProfile ? avatarSrc(App.currentProfile) : '';

  try {
    var r = await fetch(baseUrl + '/functions/v1/send-push-notification', {
      method : 'POST',
      headers: {
        'Content-Type' : 'application/json',
        'Authorization': 'Bearer ' + (App.session && App.session.access_token ? App.session.access_token : ''),
      },
      body: JSON.stringify({
        target_user_id: targetUserId,
        type          : 'call',
        title         : '📞 ' + myName + ' is calling…',
        message_body  : 'Tap Answer to connect',
        chat_id       : callPayload.chatId,
        conv_type     : 'chat',
        call_data     : callPayload,   // full SDP offer — receiver uses this to answer
        sender_name   : myName,
        sender_avatar : myAvatar,
      }),
    });
    var result = await r.json();
    console.log('[Insan] Push call sent:', result);
  } catch(e) {
    console.warn('[Insan] Push call notification failed:', e && e.message);
    // This is non-fatal — Realtime broadcast may still reach them if app is open
  }
}

/* Send a group/channel voice chat push notification to all members */
async function _sendGvcPushNotification(memberIds) {
  if (!App.currentUser || !memberIds || memberIds.length === 0) return;
  var baseUrl = window.SUPABASE_URL;
  if (!baseUrl || baseUrl.includes('YOUR_')) return;

  var myName = App.currentProfile ? (App.currentProfile.display_name || App.currentProfile.username || 'Someone') : 'Someone';
  var convName = (App.activeConvData && App.activeConvData.name) || 'Voice Chat';

  for (var i = 0; i < memberIds.length; i++) {
    var uid = memberIds[i];
    if (uid === App.currentUser.id) continue;
    try {
      fetch(baseUrl + '/functions/v1/send-push-notification', {
        method : 'POST',
        headers: {
          'Content-Type' : 'application/json',
          'Authorization': 'Bearer ' + (App.session && App.session.access_token ? App.session.access_token : ''),
        },
        body: JSON.stringify({
          target_user_id: uid,
          type          : 'gvc',
          title         : '🎙 ' + convName,
          message_body  : myName + ' started a voice chat — tap to join',
          chat_id       : App.activeChatId,
          conv_type     : App.activeConvType,
          sender_name   : myName,
        }),
      }).catch(function(){});
    } catch(e) {}
  }
}

/* Decline with busy signal via a temp channel */
function _vcDeclineBusy(chatId) {
  if (!chatId) return;
  var ch = supabaseClient
    .channel('vc-signal-' + chatId, { config: { broadcast: { self: false } } })
    .subscribe(function(status) {
      if (status === 'SUBSCRIBED') {
        ch.send({ type: 'broadcast', event: 'vc-signal',
          payload: { type: 'vc-end', from: App.currentUser.id } }).catch(function(){});
        setTimeout(function() { try { supabaseClient.removeChannel(ch); } catch(_) {} }, 3000);
      }
    });
}

/* ─── UI helpers ──────────────────────────────────────────────── */
function _vcShowOverlay(name, avatarUrl, status) {
  var ov = document.getElementById('vc-overlay'); if (!ov) return;
  var img = document.getElementById('vc-remote-img');
  var ini = document.getElementById('vc-avatar-initials');
  var nm  = document.getElementById('vc-remote-name');
  var tim = document.getElementById('vc-call-timer');
  if (img) { img.src = avatarUrl || ''; img.style.display = avatarUrl ? 'block' : 'none'; }
  if (ini) { ini.textContent = (name||'?')[0].toUpperCase(); ini.style.display = avatarUrl ? 'none' : 'flex'; }
  if (nm)  nm.textContent  = name || 'User';
  if (tim) tim.textContent = '';
  _vcShowStatus(status || 'Connecting…', false);
  // Hide mini-strip if it was showing
  var strip = document.getElementById('vc-mini-strip');
  if (strip) strip.style.display = 'none';
  ov.style.display = 'flex';
  requestAnimationFrame(function() { ov.classList.add('vc-visible'); });
}

function _vcHideOverlay() {
  var ov = document.getElementById('vc-overlay'); if (!ov) return;
  ov.classList.remove('vc-visible');
  setTimeout(function() { ov.style.display = 'none'; }, 350);
  // Also hide mini-strip
  var strip = document.getElementById('vc-mini-strip');
  if (strip) strip.style.display = 'none';
}

/* Minimize — hide full overlay, show mini strip */
function vcMinimize() {
  var ov = document.getElementById('vc-overlay'); if (!ov) return;
  ov.classList.remove('vc-visible');
  setTimeout(function() { ov.style.display = 'none'; }, 300);
  // Populate and show mini-strip
  var strip = document.getElementById('vc-mini-strip');
  if (!strip) return;
  var miniAv = document.getElementById('vc-mini-avatar');
  var miniNm = document.getElementById('vc-mini-name');
  var miniTm = document.getElementById('vc-mini-time');
  if (miniAv) {
    if (VC.peerAvatar) {
      miniAv.style.backgroundImage = 'url(' + VC.peerAvatar + ')';
      miniAv.textContent = '';
    } else {
      miniAv.style.backgroundImage = '';
      miniAv.textContent = (VC.peerName || '?')[0].toUpperCase();
    }
  }
  if (miniNm) miniNm.textContent = VC.peerName || 'User';
  var elapsed = VC.elapsed || 0;
  if (miniTm) {
    if (VC.active && elapsed > 0) {
      var m = Math.floor(elapsed/60), s = elapsed % 60;
      miniTm.innerHTML = '<span class="vc-mini-pulse"></span>' + String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0');
    } else {
      miniTm.innerHTML = '<span class="vc-mini-pulse"></span>Calling\u2026';
    }
  }
  // Sync mute state
  var miniMuteBtn = document.getElementById('vc-mini-mute-btn');
  if (miniMuteBtn) miniMuteBtn.classList.toggle('muted', !!VC.muted);
  strip.style.display = 'flex';
}

/* Maximize — hide mini strip, show full overlay */
function vcMaximize() {
  var strip = document.getElementById('vc-mini-strip');
  if (strip) strip.style.display = 'none';
  var ov = document.getElementById('vc-overlay'); if (!ov) return;
  ov.style.display = 'flex';
  requestAnimationFrame(function() { ov.classList.add('vc-visible'); });
}

function _vcShowStatus(text, showTimer) {
  var chip = document.getElementById('vc-status-chip');
  var dot  = document.getElementById('vc-status-dot');
  var stxt = document.getElementById('vc-status-text');
  var tim  = document.getElementById('vc-call-timer');
  if (showTimer) {
    if (chip) chip.style.display = 'none';
    if (tim)  tim.style.display  = 'block';
    if (dot)  dot.classList.add('connected');
  } else {
    if (chip) chip.style.display = '';
    if (stxt) stxt.textContent = text;
    if (tim)  tim.style.display  = 'none';
  }
}

function _vcShowIncoming(name, avatarUrl) {
  var inc = document.getElementById('vc-incoming'); if (!inc) return;
  var av  = document.getElementById('vc-inc-avatar');
  var nm  = document.getElementById('vc-inc-name');
  if (av) { av.textContent = (name||'?')[0].toUpperCase(); av.style.backgroundImage = avatarUrl ? 'url('+avatarUrl+')' : ''; }
  if (nm) nm.textContent = name || 'User';
  inc.style.display = 'flex';
  requestAnimationFrame(function() { inc.classList.add('vc-inc-visible'); });
}

function _vcHideIncoming() {
  var inc = document.getElementById('vc-incoming'); if (!inc) return;
  inc.classList.remove('vc-inc-visible');
  setTimeout(function() { inc.style.display = 'none'; }, 300);
}




/* ══════════════════════════════════════════════════════════
   CALLS HISTORY
   ══════════════════════════════════════════════════════════ */

var _callsHistory = [];
var _callsFilter  = 'all';

function _addCallHistory(entry) {
  entry.ts = Date.now();
  _callsHistory.unshift(entry);
  // Persist to localStorage
  try { localStorage.setItem('insan_calls_history', JSON.stringify(_callsHistory.slice(0, 100))); } catch(_) {}
}

function _loadCallsHistory() {
  try {
    var stored = localStorage.getItem('insan_calls_history');
    if (stored) _callsHistory = JSON.parse(stored);
  } catch(_) {}
}

function openCallsHistory() {
  _loadCallsHistory();
  _callsFilter = 'all';
  _updateCallsFilterBtns();
  _renderCallsHistory();
  openModal('modal-calls-history');
}

function filterCalls(type) {
  _callsFilter = type;
  _updateCallsFilterBtns();
  _renderCallsHistory();
}

function _updateCallsFilterBtns() {
  ['all','incoming','outgoing','missed'].forEach(function(t) {
    var btn = document.getElementById('calls-filter-' + t);
    if (btn) btn.classList.toggle('active', _callsFilter === t);
  });
}

function _renderCallsHistory() {
  var list = document.getElementById('calls-history-list');
  if (!list) return;
  var filtered = _callsFilter === 'all' ? _callsHistory : _callsHistory.filter(function(c) { return c.type === _callsFilter; });
  if (!filtered.length) {
    list.innerHTML = '<div class="calls-empty-state">' +
      '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity:.3;margin-bottom:10px"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>' +
      '<p style="color:var(--text-sec);font-size:14px">No ' + (_callsFilter === 'all' ? '' : _callsFilter + ' ') + 'calls yet</p></div>';
    return;
  }
  var html = '<ul class="calls-list">';
  filtered.forEach(function(c) {
    var icon = c.type === 'incoming'
      ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="8 7 3 12 8 17"/><line x1="3" y1="12" x2="15" y2="12"/></svg>'
      : c.type === 'outgoing'
      ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="16 7 21 12 16 17"/><line x1="21" y1="12" x2="9" y2="12"/></svg>'
      : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.5"><polyline points="8 7 3 12 8 17"/><line x1="3" y1="12" x2="15" y2="12"/></svg>';
    var color = c.type === 'missed' ? '#ef4444' : c.type === 'outgoing' ? 'var(--accent)' : 'var(--text-sec)';
    var durStr = c.duration > 0 ? (Math.floor(c.duration/60) + ':' + String(c.duration%60).padStart(2,'0')) : '';
    var timeStr = _fmtCallTime(c.ts);
    var avatarLetter = (c.name||'?')[0].toUpperCase();
    html += '<li class="call-item">' +
      '<div class="call-item-avatar" style="background:var(--accent-bg);color:var(--accent)">' + avatarLetter + '</div>' +
      '<div class="call-item-info">' +
        '<span class="call-item-name">' + esc(c.name) + '</span>' +
        '<span class="call-item-meta" style="color:' + color + '">' + icon + ' ' + c.type.charAt(0).toUpperCase() + c.type.slice(1) + (durStr ? ' · ' + durStr : '') + '</span>' +
      '</div>' +
      '<span class="call-item-time">' + timeStr + '</span>' +
    '</li>';
  });
  html += '</ul>';
  list.innerHTML = html;
}

function _fmtCallTime(ts) {
  var d = new Date(ts);
  var now = new Date();
  var diff = now - d;
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return Math.floor(diff/60000) + 'm ago';
  if (diff < 86400000) return Math.floor(diff/3600000) + 'h ago';
  var dd = d.getDate(), mm = d.getMonth()+1;
  return (dd<10?'0':'')+dd+'/'+(mm<10?'0':'')+mm;
}

/* ══════════════════════════════════════════════════════════
   INVITE FRIENDS
   ══════════════════════════════════════════════════════════ */

function openInvite() {
  var link = window.location.origin + window.location.pathname;
  var inp = document.getElementById('invite-link-input');
  if (inp) inp.value = link;
  openModal('modal-invite');
}

function copyInviteLink() {
  var inp = document.getElementById('invite-link-input');
  var link = inp ? inp.value : window.location.href;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(link).then(function() {
      var btn = document.getElementById('invite-copy-btn');
      if (btn) {
        var orig = btn.innerHTML;
        btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Copied!';
        btn.disabled = true;
        setTimeout(function() { btn.innerHTML = orig; btn.disabled = false; }, 2000);
      }
      showToast('Link copied!');
    }).catch(function() { showToast('Could not copy link', 'error'); });
  } else {
    try {
      inp.select(); document.execCommand('copy');
      showToast('Link copied!');
    } catch(_) { showToast('Could not copy link', 'error'); }
  }
}

function shareInvite(platform) {
  var inp = document.getElementById('invite-link-input');
  var link = encodeURIComponent(inp ? inp.value : window.location.href);
  var text = encodeURIComponent('Join me on Insan Chat! ');
  if (platform === 'whatsapp') {
    window.open('https://wa.me/?text=' + text + link, '_blank');
  } else if (platform === 'telegram') {
    window.open('https://t.me/share/url?url=' + link + '&text=' + text, '_blank');
  } else if (platform === 'native' && navigator.share) {
    navigator.share({ title: 'Insan Chat', text: 'Join me on Insan Chat!', url: decodeURIComponent(link) }).catch(function(){});
  } else {
    copyInviteLink();
  }
}

/* ══════════════════════════════════════════════════════════
   UPDATE DETECTION & ABOUT
   ══════════════════════════════════════════════════════════ */

var _updateAvailable = false;
var _updateVersion   = null;

function _showUpdateAvailable(version) {
  _updateAvailable = true;
  _updateVersion   = version || null;
  // Show the sidebar update button
  var btn = document.getElementById('sb-update-btn');
  if (btn) btn.style.display = 'flex';
  // Show persistent top banner
  _showUpdateTopBanner(version);
}

function _showUpdateTopBanner(version) {
  var existing = document.getElementById('app-update-banner');
  if (existing) return; // already showing
  var bar = document.createElement('div');
  bar.id = 'app-update-banner';
  bar.className = 'app-update-banner';
  bar.innerHTML =
    '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>' +
    '<span>' + (version ? 'Version ' + version + ' available!' : 'New version available!') + '</span>' +
    '<button class="app-update-now-btn" onclick="applyUpdate()">Update Now</button>' +
    '<button class="app-update-dismiss-btn" onclick="this.closest(\'#app-update-banner\').remove()" title="Dismiss">&times;</button>';
  document.body.insertBefore(bar, document.body.firstChild);
}

function applyUpdate() {
  // Tell waiting SW to skip waiting, then reload
  if (_swReg && _swReg.waiting) {
    _swReg.waiting.postMessage({ type: 'SKIP_WAITING' });
  }
  showToast('Applying update…');
  setTimeout(function() { window.location.reload(true); }, 800);
}

function checkForUpdate() {
  if (_swReg) {
    _swReg.update().then(function() {
      if (!_updateAvailable) {
        showToast('You\'re on the latest version ✓');
      }
    }).catch(function() {
      showToast('Could not check for updates', 'error');
    });
  } else {
    showToast('Checking…');
    setTimeout(function() { window.location.reload(true); }, 1000);
  }
}

function checkForUpdateManual() {
  var btn = document.getElementById('about-check-btn');
  if (btn) { btn.textContent = 'Checking…'; btn.disabled = true; }

  if (_updateAvailable) {
    // Already have an update waiting
    var banner = document.getElementById('about-update-banner');
    var upToDate = document.getElementById('about-up-to-date');
    if (banner) { banner.style.display = 'flex'; }
    if (upToDate) upToDate.style.display = 'none';
    if (btn) { btn.textContent = 'Check for Updates'; btn.disabled = false; }
    return;
  }

  if (_swReg) {
    _swReg.update().then(function() {
      setTimeout(function() {
        if (btn) { btn.textContent = 'Check for Updates'; btn.disabled = false; }
        var banner = document.getElementById('about-update-banner');
        var upToDate = document.getElementById('about-up-to-date');
        if (_updateAvailable) {
          if (banner) banner.style.display = 'flex';
          if (upToDate) upToDate.style.display = 'none';
        } else {
          if (banner) banner.style.display = 'none';
          if (upToDate) upToDate.style.display = 'flex';
        }
      }, 1500);
    }).catch(function() {
      if (btn) { btn.textContent = 'Check for Updates'; btn.disabled = false; }
      showToast('Could not check for updates', 'error');
    });
  } else {
    setTimeout(function() {
      if (btn) { btn.textContent = 'Check for Updates'; btn.disabled = false; }
      var upToDate = document.getElementById('about-up-to-date');
      if (upToDate) upToDate.style.display = 'flex';
    }, 1200);
  }
}

function openAbout() {
  // Set version text
  var versionEl = document.getElementById('about-version-text');
  if (versionEl) versionEl.textContent = 'Version ' + APP_VERSION;

  // Show/hide update banner based on current state
  var banner  = document.getElementById('about-update-banner');
  var upToDate = document.getElementById('about-up-to-date');
  var updateText = document.getElementById('about-update-text');
  if (banner && upToDate) {
    if (_updateAvailable) {
      banner.style.display = 'flex';
      upToDate.style.display = 'none';
      if (updateText && _updateVersion) updateText.textContent = 'Version ' + _updateVersion + ' available!';
    } else {
      banner.style.display = 'none';
      upToDate.style.display = 'none'; // only show after manual check
    }
  }
  openModal('modal-about');
}

/* ══════════════════════════════════════════════════════════════════════
   GROUP / CHANNEL VOICE CHAT  (GVC)
   - Groups: anyone can start/join
   - Channels: only admin can start; members can join when active
   - WebRTC mesh: each participant connects P2P with every other participant
   - Supabase Realtime broadcast for signaling
   ══════════════════════════════════════════════════════════════════════ */

var GVC = {
  active:      false,   // is there a live voice room for current conv?
  joined:      false,   // has current user joined?
  muted:       false,
  speaker:     true,    // speakerphone mode (true = loud speaker, false = earpiece/quiet)
  chatId:      null,
  chatType:    null,    // 'group'|'channel'
  initiatorId: null,    // userId who started the room
  localStream: null,
  peers:       {},      // userId -> { pc, remoteStream, name, avatar, audioEl, speaking, muted }
  participants:{},      // userId -> { name, avatar } — everyone who has joined (even before our join)
  signalCh:    null,    // Supabase realtime channel
  heartbeatInt:null,
  speakTimers: {},
};

/* ── Helpers ─────────────────────────────────────────────────────── */
function _gvcMyName()   { return App.currentProfile ? (App.currentProfile.display_name || App.currentProfile.username || 'Me') : 'Me'; }
function _gvcMyAvatar() { return App.currentProfile ? avatarSrc(App.currentProfile) : ''; }
function _gvcMyId()     { return App.currentUser && App.currentUser.id; }

/* ── Join the Supabase signaling channel ─────────────────────────── */
function _gvcJoinSignal(chatId) {
  _gvcLeaveSignal();
  GVC.signalCh = supabaseClient
    .channel('gvc-' + chatId, { config: { broadcast: { self: false } } })
    .on('broadcast', { event: 'gvc' }, function(ev) { _gvcHandleSignal(ev.payload || ev); })
    .subscribe();
}

function _gvcLeaveSignal() {
  if (GVC.signalCh) {
    try { supabaseClient.removeChannel(GVC.signalCh); } catch(_) {}
    GVC.signalCh = null;
  }
}

function _gvcSend(data) {
  if (!GVC.signalCh) return;
  GVC.signalCh.send({ type: 'broadcast', event: 'gvc', payload: data }).catch(function(){});
}

/* ── Start a new voice room ─────────────────────────────────────── */
async function gvcStart() {
  if (!App.activeChatId) return;
  var type = App.activeConvType;
  if (type === 'channel' && App.activeConvRole !== 'admin') {
    return showToast('Only the channel admin can start a voice chat', 'error');
  }

  // If a room already exists for this conv, just join it
  if (GVC.active && GVC.chatId === App.activeChatId) {
    return gvcJoin();
  }

  // End any previous GVC
  if (GVC.active) _gvcCleanup(false);

  GVC.chatId      = App.activeChatId;
  GVC.chatType    = type;
  GVC.initiatorId = _gvcMyId();
  GVC.active      = true;
  GVC.participants= {};
  GVC.peers       = {};

  _gvcJoinSignal(GVC.chatId);
  // Broadcast room start
  _gvcSend({ type: 'gvc-start', from: _gvcMyId(), name: _gvcMyName(), avatar: _gvcMyAvatar(), chatId: GVC.chatId });

  _gvcShowBar(App.activeChatId);
  await _gvcJoinAudio();
  // Notify all members and show global mini strip
  _gvcNotifyMembersCallStarted();
  _gvcShowGlobalMiniStrip();
}

/* ── Join an existing voice room ────────────────────────────────── */
async function gvcJoin() {
  if (!GVC.active) return showToast('No voice chat is active', 'error');
  if (GVC.joined)  { return gvcShowPanel(); }

  if (!GVC.signalCh) _gvcJoinSignal(GVC.chatId);

  await _gvcJoinAudio();
}

/* ── Actually acquire mic + create PeerConnections ──────────────── */
async function _gvcJoinAudio() {
  if (GVC.joined) return;

  try {
    GVC.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  } catch(e) {
    return showToast('Microphone access denied', 'error');
  }

  GVC.joined = true;
  GVC.muted  = false;

  // Add ourselves to participants
  GVC.participants[_gvcMyId()] = { name: _gvcMyName(), avatar: _gvcMyAvatar(), muted: false };

  // Tell others we joined — they will send us offers
  _gvcSend({ type: 'gvc-join', from: _gvcMyId(), name: _gvcMyName(), avatar: _gvcMyAvatar() });

  // Start heartbeat
  clearInterval(GVC.heartbeatInt);
  GVC.heartbeatInt = setInterval(function() {
    if (GVC.joined) {
      _gvcSend({ type: 'gvc-presence', from: _gvcMyId(), name: _gvcMyName(), avatar: _gvcMyAvatar(), muted: GVC.muted });
    }
  }, 8000);

  _gvcRefreshBar();
  _gvcRefreshPanel();
  _gvcUpdateHeaderBtn();
  gvcShowPanel();
  _gvcShowGlobalMiniStrip();
  showToast('Joined voice chat', 'success');
}

/* ── Leave the voice room ───────────────────────────────────────── */
function gvcLeave() {
  if (!GVC.joined) { _gvcCleanup(true); return; }
  _gvcSend({ type: 'gvc-leave', from: _gvcMyId() });
  _gvcCleanup(true);
  showToast('Left voice chat');
}

/* ── End the room for everyone (admin/initiator) ─────────────────── */
function gvcEnd() {
  var canEnd = GVC.initiatorId === _gvcMyId() || App.activeConvRole === 'admin';
  if (!canEnd) return showToast('Only the room creator or admin can end the voice chat', 'error');
  _gvcSend({ type: 'gvc-end', from: _gvcMyId() });
  _gvcCleanup(true);
  showToast('Voice chat ended');
}

/* ── Full cleanup ───────────────────────────────────────────────── */
function _gvcCleanup(isLeaving) {
  clearInterval(GVC.heartbeatInt);
  // Close all peer connections
  Object.keys(GVC.peers).forEach(function(uid) { _gvcClosePeer(uid); });
  GVC.peers = {};
  // Stop local stream
  if (GVC.localStream) { GVC.localStream.getTracks().forEach(function(t) { t.stop(); }); GVC.localStream = null; }
  if (isLeaving) {
    _gvcLeaveSignal();
    GVC.active       = false;
    GVC.joined       = false;
    GVC.chatId       = null;
    GVC.initiatorId  = null;
    GVC.participants = {};
  } else {
    GVC.joined = false;
  }
  GVC.muted = false;
  _gvcHideBar();
  gvcHidePanel();
  _gvcUpdateHeaderBtn();
  // Hide global mini strip if it was showing for GVC
  _gvcHideGlobalMiniStrip();
}

function _gvcClosePeer(uid) {
  var peer = GVC.peers[uid];
  if (!peer) return;
  if (peer.pc) { try { peer.pc.close(); } catch(_) {} }
  if (peer.audioEl) { peer.audioEl.srcObject = null; peer.audioEl.remove(); }
  delete GVC.peers[uid];
}

/* ── Mute toggle ────────────────────────────────────────────────── */
function gvcToggleMute() {
  GVC.muted = !GVC.muted;
  if (GVC.localStream) {
    GVC.localStream.getAudioTracks().forEach(function(t) { t.enabled = !GVC.muted; });
  }
  // Update local participant muted state
  if (GVC.participants[_gvcMyId()]) GVC.participants[_gvcMyId()].muted = GVC.muted;
  _gvcSend({ type: 'gvc-mute', from: _gvcMyId(), muted: GVC.muted });
  // Update button
  var btn  = $('gvc-mute-btn'),
      icon = $('gvc-mute-icon'),
      lbl  = $('gvc-mute-label');
  if (btn)  btn.classList.toggle('active', GVC.muted);
  if (lbl)  lbl.textContent = GVC.muted ? 'Unmute' : 'Mute';
  if (icon) icon.innerHTML = GVC.muted
    ? '<line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>'
    : '<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>';
  // Sync global mini strip mute state
  var gmsBtn = document.getElementById('gvc-gms-mute-btn');
  if (gmsBtn) gmsBtn.classList.toggle('muted', GVC.muted);
  _gvcRefreshPanel();
  showToast(GVC.muted ? 'Muted' : 'Unmuted');
}

function gvcToggleSpeaker() {
  GVC.speaker = !GVC.speaker;
  var vol = GVC.speaker ? 1 : 0.15;
  // Apply volume to all connected peer audio elements
  Object.values(GVC.peers).forEach(function(peer) {
    if (peer.audioEl) peer.audioEl.volume = vol;
  });
  var btn = $('gvc-speaker-btn'),
      lbl = $('gvc-speaker-label');
  if (btn) btn.classList.toggle('active', !GVC.speaker);
  if (lbl) lbl.textContent = GVC.speaker ? 'Speaker' : 'Earpiece';
  showToast(GVC.speaker ? 'Speaker on' : 'Earpiece mode');
}

/* ── Create a WebRTC P2P connection to a peer ────────────────────── */
async function _gvcConnectToPeer(uid, asOfferer) {
  if (GVC.peers[uid]) return; // already connected
  var pc = new RTCPeerConnection({ iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ]});

  var audioEl = new Audio();
  audioEl.autoplay = true;
  audioEl.volume = GVC.speaker ? 1 : 0.15;

  GVC.peers[uid] = { pc: pc, audioEl: audioEl, speaking: false, muted: false };

  // Add local tracks
  if (GVC.localStream) {
    GVC.localStream.getTracks().forEach(function(t) { pc.addTrack(t, GVC.localStream); });
  }

  // ICE
  pc.onicecandidate = function(e) {
    if (e.candidate) {
      _gvcSend({ type: 'gvc-ice', from: _gvcMyId(), to: uid, candidate: e.candidate });
    }
  };

  // Remote audio
  pc.ontrack = function(e) {
    audioEl.srcObject = e.streams[0];
    _gvcSetupSpeakDetect(uid, e.streams[0]);
  };

  pc.onconnectionstatechange = function() {
    var s = pc.connectionState;
    if (s === 'disconnected' || s === 'failed' || s === 'closed') {
      delete GVC.participants[uid];
      _gvcClosePeer(uid);
      _gvcRefreshBar();
      _gvcRefreshPanel();
    }
  };

  if (asOfferer) {
    var offer = await pc.createOffer({ offerToReceiveAudio: true });
    await pc.setLocalDescription(offer);
    _gvcSend({ type: 'gvc-offer', from: _gvcMyId(), to: uid, sdp: offer });
  }
}

/* ── Speaking detection via analyser ───────────────────────────── */
function _gvcSetupSpeakDetect(uid, stream) {
  try {
    var ctx = new (window.AudioContext || window.webkitAudioContext)();
    var src = ctx.createMediaStreamSource(stream);
    var an  = ctx.createAnalyser();
    an.fftSize = 256; an.smoothingTimeConstant = 0.75;
    src.connect(an);
    var buf = new Uint8Array(an.frequencyBinCount);
    (function tick() {
      if (!GVC.peers[uid]) { ctx.close(); return; }
      an.getByteFrequencyData(buf);
      var avg = buf.reduce(function(a,b){return a+b;},0)/buf.length;
      var speaking = avg > 10;
      if (GVC.peers[uid] && GVC.peers[uid].speaking !== speaking) {
        GVC.peers[uid].speaking = speaking;
        _gvcRefreshParticipantCard(uid);
      }
      requestAnimationFrame(tick);
    })();
  } catch(_) {}
}

/* ── Handle incoming signals ────────────────────────────────────── */
async function _gvcHandleSignal(data) {
  if (!data || !data.type) return;
  var from = data.from;
  if (!from || from === _gvcMyId()) return;

  if (data.type === 'gvc-start') {
    // Someone started a room — show the bar for this conv
    if (!GVC.active) {
      GVC.active      = true;
      GVC.chatId      = data.chatId || App.activeChatId;
      GVC.chatType    = App.activeConvType;
      GVC.initiatorId = from;
      GVC.participants= {};
      _gvcJoinSignal(GVC.chatId);
    }
    GVC.participants[from] = { name: data.name || 'User', avatar: data.avatar || '' };
    if (App.activeChatId === GVC.chatId) {
      _gvcShowBar(GVC.chatId);
      _gvcRefreshBar();
    }
    return;
  }

  if (data.type === 'gvc-end') {
    if (GVC.chatId && (data.chatId === GVC.chatId || !data.chatId)) {
      showToast('Voice chat ended by admin');
      _gvcCleanup(true);
    }
    return;
  }

  if (data.type === 'gvc-join') {
    // Someone joined — if we are in the room, send them an offer
    GVC.participants[from] = { name: data.name || 'User', avatar: data.avatar || '' };
    _gvcRefreshBar();
    _gvcRefreshPanel();
    if (GVC.joined && !GVC.peers[from]) {
      await _gvcConnectToPeer(from, true); // we are the offerer
    }
    return;
  }

  if (data.type === 'gvc-leave') {
    delete GVC.participants[from];
    _gvcClosePeer(from);
    _gvcRefreshBar();
    _gvcRefreshPanel();
    // If room is empty, mark inactive
    if (Object.keys(GVC.participants).length === 0) {
      GVC.active = false;
      _gvcHideBar();
    }
    return;
  }

  if (data.type === 'gvc-mute') {
    if (GVC.participants[from]) GVC.participants[from].muted = !!data.muted;
    if (GVC.peers[from])       GVC.peers[from].muted = !!data.muted;
    _gvcRefreshParticipantCard(from);
    return;
  }

  if (data.type === 'gvc-presence') {
    if (!GVC.participants[from]) {
      GVC.participants[from] = { name: data.name || 'User', avatar: data.avatar || '' };
      _gvcRefreshBar();
      _gvcRefreshPanel();
    } else {
      GVC.participants[from].name   = data.name   || GVC.participants[from].name;
      GVC.participants[from].avatar = data.avatar || GVC.participants[from].avatar;
      GVC.participants[from].muted  = !!data.muted;
    }
    return;
  }

  // WebRTC signaling — only relevant if we've joined
  if (!GVC.joined) return;
  if (data.to && data.to !== _gvcMyId()) return; // not for us

  if (data.type === 'gvc-offer') {
    // Create peer, set remote, answer
    if (!GVC.peers[from]) await _gvcConnectToPeer(from, false);
    var peer = GVC.peers[from];
    if (!peer) return;
    try {
      await peer.pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
      var answer = await peer.pc.createAnswer();
      await peer.pc.setLocalDescription(answer);
      _gvcSend({ type: 'gvc-answer', from: _gvcMyId(), to: from, sdp: answer });
    } catch(e) { console.error('gvc-offer error', e); }
    return;
  }

  if (data.type === 'gvc-answer') {
    var p = GVC.peers[from];
    if (!p || !p.pc) return;
    try { await p.pc.setRemoteDescription(new RTCSessionDescription(data.sdp)); } catch(_) {}
    return;
  }

  if (data.type === 'gvc-ice') {
    var pp = GVC.peers[from];
    if (!pp || !pp.pc) return;
    try { await pp.pc.addIceCandidate(new RTCIceCandidate(data.candidate)); } catch(_) {}
    return;
  }
}

/* ── Subscribe to GVC when opening a group/channel conv ─────────── */
function _gvcSubscribeForConv(chatId, chatType) {
  // Leave old signal if switching convs
  if (GVC.chatId && GVC.chatId !== chatId && GVC.joined) {
    gvcLeave();
    return;
  }
  // Check if a room is already active — listen for announcements
  if (!GVC.active || GVC.chatId !== chatId) {
    // Join signal channel to hear gvc-start broadcasts
    if (!GVC.signalCh) {
      GVC.chatId   = chatId;
      GVC.chatType = chatType;
      _gvcJoinSignal(chatId);
    }
    _gvcHideBar();
  } else {
    _gvcShowBar(chatId);
    _gvcRefreshBar();
  }
}

/* ── UI: Bar ────────────────────────────────────────────────────── */
function _gvcShowBar(chatId) {
  if (App.activeChatId !== chatId) return;
  var bar = $('gvc-bar');
  if (bar) bar.style.display = 'flex';
  _gvcRefreshBar();
}

function _gvcHideBar() {
  var bar = $('gvc-bar'); if (bar) bar.style.display = 'none';
}

function _gvcRefreshBar() {
  var joinBtn  = $('gvc-join-btn'),
      leaveBtn = $('gvc-leave-btn'),
      endBtn   = $('gvc-end-btn'),
      membersEl= $('gvc-bar-members'),
      avList   = $('gvc-bar-avatars');

  if (!joinBtn) return;

  var count = Object.keys(GVC.participants).length;
  if (membersEl) membersEl.textContent = count + ' participant' + (count !== 1 ? 's' : '');

  // Avatars strip
  if (avList) {
    avList.innerHTML = Object.values(GVC.participants).slice(0,4).map(function(p) {
      return '<img class="gvc-bar-avatar" src="' + esc(p.avatar) + '" alt="" onerror="this.src=\'' + avatarSrc({username:p.name}) + '\'">';
    }).join('');
  }

  if (GVC.joined) {
    joinBtn.style.display  = 'none';
    leaveBtn.style.display = '';
    // Show "End" button only to initiator or channel admin
    var canEnd = GVC.initiatorId === _gvcMyId() || App.activeConvRole === 'admin';
    if (endBtn) endBtn.style.display = canEnd ? '' : 'none';
    _gvcUpdateMiniStripCount();
  } else {
    joinBtn.style.display  = '';
    leaveBtn.style.display = 'none';
    if (endBtn) endBtn.style.display = 'none';
  }
}

/* ── UI: Panel ──────────────────────────────────────────────────── */
function gvcShowPanel() {
  var panel = $('gvc-panel');
  if (panel) panel.classList.add('gvc-visible');
  _gvcRefreshPanel();
}

function gvcHidePanel() {
  var panel = $('gvc-panel');
  if (panel) panel.classList.remove('gvc-visible');
}

function _gvcRefreshPanel() {
  var titleEl = $('gvc-panel-title'),
      subEl   = $('gvc-panel-subtitle'),
      grid    = $('gvc-participants-grid'),
      emptyEl = $('gvc-panel-empty'),
      endCtrl = $('gvc-end-ctrl');

  if (titleEl) titleEl.textContent = App.activeConvData ? (App.activeConvData.name || 'Voice Chat') : 'Voice Chat';

  var allParts = Object.assign({}, GVC.participants);
  // Make sure current user is shown if joined
  if (GVC.joined) allParts[_gvcMyId()] = { name: _gvcMyName(), avatar: _gvcMyAvatar(), muted: GVC.muted };

  var count = Object.keys(allParts).length;
  if (subEl) subEl.textContent = count + ' participant' + (count !== 1 ? 's' : '');

  if (!grid) return;

  if (count === 0) {
    if (emptyEl) emptyEl.style.display = 'flex';
    // Clear old cards
    Array.from(grid.querySelectorAll('.gvc-participant')).forEach(function(el) { el.remove(); });
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';

  // Build all participant cards fresh
  var html = '';
  Object.keys(allParts).forEach(function(uid) {
    var p = allParts[uid];
    var isMe = uid === _gvcMyId();
    var peerInfo = GVC.peers[uid] || {};
    var isSpeaking = isMe ? false : (peerInfo.speaking || false);
    var isMuted   = isMe ? GVC.muted : (p.muted || peerInfo.muted || false);
    html += _gvcParticipantCardHTML(uid, p, isMe, isSpeaking, isMuted);
  });

  // Replace all cards
  var existing = Array.from(grid.querySelectorAll('.gvc-participant'));
  existing.forEach(function(el) { el.remove(); });
  grid.insertAdjacentHTML('beforeend', html);

  // End ctrl visibility
  var canEnd = GVC.initiatorId === _gvcMyId() || App.activeConvRole === 'admin';
  if (endCtrl) endCtrl.style.display = canEnd ? 'flex' : 'none';
}

function _gvcRefreshParticipantCard(uid) {
  var card = document.getElementById('gvc-p-' + uid);
  if (!card) { _gvcRefreshPanel(); return; }
  var p = GVC.participants[uid] || { name: 'User', avatar: '' };
  var peerInfo = GVC.peers[uid] || {};
  var isMe = uid === _gvcMyId();
  var isSpeaking = isMe ? false : (peerInfo.speaking || false);
  var isMuted    = isMe ? GVC.muted : (p.muted || peerInfo.muted || false);
  card.outerHTML = _gvcParticipantCardHTML(uid, p, isMe, isSpeaking, isMuted);
}

function _gvcParticipantCardHTML(uid, p, isMe, isSpeaking, isMuted) {
  return '<div class="gvc-participant' + (isSpeaking ? ' speaking' : '') + (isMuted ? ' muted' : '') + '" id="gvc-p-' + uid + '">' +
    '<div class="gvc-p-avatar-wrap">' +
      '<img class="gvc-p-avatar" src="' + esc(p.avatar) + '" alt="" onerror="this.src=\'' + avatarSrc({username:p.name}) + '\'">' +
      '<div class="gvc-p-speaking-ring"></div>' +
      '<div class="gvc-p-mute-icon">' +
        '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>' +
      '</div>' +
    '</div>' +
    '<div class="gvc-p-name">' + esc(p.name || 'User') + (isMe ? '' : '') + '</div>' +
    (isMe ? '<div class="gvc-p-you">You</div>' : '') +
  '</div>';
}

/* ── Hide global GVC mini strip ─────────────────────────────────── */
function _gvcHideGlobalMiniStrip() {
  var strip = document.getElementById('gvc-global-mini-strip');
  if (strip) strip.style.display = 'none';
}

/* ── Show global GVC mini strip (visible from any screen) ────────── */
function _gvcShowGlobalMiniStrip() {
  var strip = document.getElementById('gvc-global-mini-strip');
  if (!strip) return;
  var nameEl = document.getElementById('gvc-mini-conv-name');
  var countEl = document.getElementById('gvc-mini-part-count');
  var convName = (App.activeConvData && App.activeConvData.name) || 'Voice Chat';
  var count = Object.keys(GVC.participants).length;
  if (nameEl) nameEl.textContent = convName;
  if (countEl) countEl.textContent = count + ' participant' + (count !== 1 ? 's' : '');
  strip.style.display = 'flex';
}

/* ── Notify all group/channel members about voice chat start ─────── */
async function _gvcNotifyMembersCallStarted() {
  if (!App.activeChatId || !App.currentUser) return;
  var type = App.activeConvType;
  var myName = App.currentProfile ? (App.currentProfile.display_name || App.currentProfile.username || 'Someone') : 'Someone';

  try {
    var memTable = type === 'channel' ? 'channel_members' : 'group_members';
    var idCol    = type === 'channel' ? 'channel_id'      : 'group_id';
    var r = await supabaseClient.from(memTable).select('user_id').eq(idCol, App.activeChatId);
    var allMembers = r.data || [];
    var otherIds = allMembers.map(function(m) { return m.user_id; })
                             .filter(function(id) { return id !== App.currentUser.id; });

    // 1. Send a system message in the chat (visible when they open the app)
    var msgTable = type === 'channel' ? 'channel_messages' : 'group_messages';
    var msgPayload = { sender_id: App.currentUser.id, content: '📞 ' + myName + ' started a voice chat. Tap to join.' };
    msgPayload[idCol] = App.activeChatId;
    await supabaseClient.from(msgTable).insert(msgPayload);

    // 2. Send Web Push to all members who might be offline
    if (otherIds.length > 0) {
      _sendGvcPushNotification(otherIds);
    }
  } catch(e) {
    console.warn('[Insan] _gvcNotifyMembersCallStarted:', e && e.message);
  }
}

/* ── Notify peer (DM) about incoming call via system message ─────── */
async function _dmNotifyCallStarted() {
  if (!App.activeChatId || !App.currentUser || App.activeConvType !== 'chat') return;
  var myName = App.currentProfile ? (App.currentProfile.display_name || App.currentProfile.username || 'Someone') : 'Someone';
  try {
    var payload = { sender_id: App.currentUser.id, content: '📞 ' + myName + ' is calling you. Answer the call.' };
    payload.chat_id = App.activeChatId;
    await supabaseClient.from('messages').insert(payload);
  } catch(e) {
    console.warn('[Insan] _dmNotifyCallStarted:', e && e.message);
  }
}

/* ── Update GVC mini strip participant count ─────────────────────── */
function _gvcUpdateMiniStripCount() {
  if (!GVC.joined) return;
  var countEl = document.getElementById('gvc-mini-part-count');
  var count = Object.keys(GVC.participants).length;
  if (countEl) countEl.textContent = count + ' participant' + (count !== 1 ? 's' : '');
}

/* ── Swap the voice-call-btn icon: 'phone' for DM, 'mic' for GVC ── */
function _setVcBtnIcon(mode) {
  var ph  = document.getElementById('vc-icon-phone');
  var mic = document.getElementById('vc-icon-mic');
  if (!ph || !mic) return;
  if (mode === 'mic') {
    ph.style.display  = 'none';
    mic.style.display = '';
  } else {
    ph.style.display  = '';
    mic.style.display = 'none';
  }
}

function _gvcUpdateHeaderBtn() {
  var btn = document.getElementById('voice-call-btn');
  if (!btn) return;

  var type = App.activeConvType;

  // Always show button — always use phone icon
  btn.style.display = 'flex';
  _setVcBtnIcon('phone');

  if (type === 'group' || type === 'channel') {
    if (GVC.joined && GVC.chatId === App.activeChatId) {
      btn.classList.add('gvc-active');
      btn.title = 'Open voice chat panel';
    } else if (GVC.active && GVC.chatId === App.activeChatId) {
      btn.classList.remove('gvc-active');
      btn.title = 'Join voice chat';
    } else {
      btn.classList.remove('gvc-active');
      if (type === 'group') btn.title = 'Start voice chat';
      else btn.title = App.activeConvRole === 'admin' ? 'Start voice chat' : 'Voice chat (admin only)';
    }
  } else {
    btn.classList.remove('gvc-active');
    btn.title = 'Voice call';
  }
}

/* ── Call gvcShowPanel if already joined (header button click) ────── */
// Integrated into startVoiceCall() routing above

/* ══════════════════════════════════════════════════════════════════
   HOOK GVC subscribe into openChannel / openGroup
   ══════════════════════════════════════════════════════════════════ */

// Patch: after opening a group or channel, subscribe GVC signals
var _origOpenChannel = typeof openChannel === 'function' ? openChannel : null;
var _origOpenGroup   = typeof openGroup   === 'function' ? openGroup   : null;

document.addEventListener('DOMContentLoaded', function() {
  // We patch after DOMContentLoaded to ensure the original functions are defined
  var origOC = window.openChannel;
  window.openChannel = async function(id) {
    var result = await origOC.apply(this, arguments);
    if (App.activeConvType === 'channel') _gvcSubscribeForConv(id, 'channel');
    _gvcUpdateHeaderBtn();
    return result;
  };
  var origOG = window.openGroup;
  window.openGroup = async function(id) {
    var result = await origOG.apply(this, arguments);
    if (App.activeConvType === 'group') _gvcSubscribeForConv(id, 'group');
    _gvcUpdateHeaderBtn();
    return result;
  };
});

/* ══════════════════════════════════════════════════════════════════════
   FLOW — Bale-style public posts feed
   Users create text/image/video posts visible to all users
   ══════════════════════════════════════════════════════════════════════ */

var _flowPosts    = [];         // cached posts
var _flowLoading  = false;
var _flowLastTs   = null;       // for pagination cursor
var _flowTab      = 'feed';     // 'feed' | 'my'
var _flowNewPostMedia = [];     // pending media for new post

/* ── Open Flow screen ────────────────────────────────────────────── */
function openFlow() {
  closeSidebar();
  var screen = document.getElementById('screen-flow');
  if (!screen) return;
  showScreen('flow');
  _flowTab = 'feed';
  _flowUpdateTabs();
  _flowLoadPosts(true);
}

function closeFlow() {
  showScreen('dashboard');
}

function _flowUpdateTabs() {
  var feedTab = document.getElementById('flow-tab-feed');
  var myTab   = document.getElementById('flow-tab-my');
  if (feedTab) feedTab.classList.toggle('active', _flowTab === 'feed');
  if (myTab)   myTab.classList.toggle('active',   _flowTab === 'my');
}

function flowSwitchTab(tab) {
  _flowTab = tab;
  _flowUpdateTabs();
  _flowLoadPosts(true);
}

/* ── Load posts from Supabase ────────────────────────────────────── */
async function _flowLoadPosts(reset) {
  if (_flowLoading) return;
  _flowLoading = true;
  var listEl = document.getElementById('flow-posts-list');
  if (!listEl) { _flowLoading = false; return; }

  if (reset) {
    _flowPosts = [];
    _flowLastTs = null;
    listEl.innerHTML = '<div class="flow-loading"><span class="spinner" style="border-color:var(--border);border-top-color:var(--accent)"></span></div>';
  }

  try {
    var q = supabaseClient
      .from('flow_posts')
      .select('*, profiles!user_id(id, username, display_name, avatar_url)')
      .order('created_at', { ascending: false })
      .limit(20);

    if (_flowTab === 'my' && App.currentUser) {
      q = q.eq('user_id', App.currentUser.id);
    }
    if (_flowLastTs) {
      q = q.lt('created_at', _flowLastTs);
    }

    var r = await q;
    var posts = r.data || [];

    if (reset) _flowPosts = posts;
    else       _flowPosts = _flowPosts.concat(posts);

    if (posts.length > 0) {
      _flowLastTs = posts[posts.length - 1].created_at;
    }

    _flowRenderPosts(reset);
  } catch(e) {
    console.warn('[Insan] _flowLoadPosts:', e && e.message);
    if (reset) {
      listEl.innerHTML = '<div class="flow-empty"><p>Could not load posts. Make sure the flow_posts table exists.</p></div>';
    }
  }
  _flowLoading = false;
}

/* ── Render posts list ───────────────────────────────────────────── */
function _flowRenderPosts(reset) {
  var listEl = document.getElementById('flow-posts-list');
  if (!listEl) return;

  if (_flowPosts.length === 0) {
    listEl.innerHTML = '<div class="flow-empty">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48" style="opacity:.3"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>' +
      '<p>' + (_flowTab === 'my' ? 'You haven\'t posted yet. Create your first post!' : 'No posts yet. Be the first to share!') + '</p>' +
      (_flowTab === 'my' ? '<button class="flow-empty-btn" onclick="openFlowCompose()">Create Post</button>' : '') +
    '</div>';
    return;
  }

  var html = '';
  _flowPosts.forEach(function(post) {
    html += _flowPostHTML(post);
  });

  if (reset) {
    listEl.innerHTML = html;
  } else {
    var loader = listEl.querySelector('.flow-load-more-btn');
    if (loader) loader.remove();
    listEl.insertAdjacentHTML('beforeend', html);
  }

  // Add load more if we got exactly 20
  if (_flowPosts.length % 20 === 0 && _flowPosts.length > 0) {
    listEl.insertAdjacentHTML('beforeend',
      '<div style="text-align:center;padding:16px">' +
      '<button class="flow-load-more-btn" onclick="_flowLoadPosts(false)">Load more</button>' +
      '</div>');
  }
}

function _flowPostHTML(post) {
  var p = post.profiles || {};
  var isMe = App.currentUser && post.user_id === App.currentUser.id;
  var name = p.display_name || p.username || 'User';
  var time = fmtTime(post.created_at);
  var likes = post.likes_count || 0;
  var comments = post.comments_count || 0;
  var postId = post.id;
  var myLiked = post._liked || false;

  var mediaHtml = '';
  if (post.media_url) {
    var isVideo = /\.(mp4|webm|mov|avi|ogv)/i.test(post.media_url) ||
                  post.media_type === 'video';
    if (isVideo) {
      mediaHtml = '<div class="flow-post-media">' +
        '<video class="flow-post-video" src="' + esc(post.media_url) + '" controls preload="metadata" playsinline></video>' +
        '</div>';
    } else {
      mediaHtml = '<div class="flow-post-media">' +
        '<img class="flow-post-img" src="' + esc(post.media_url) + '" alt="" onclick="_openImageFull(\'' + esc(post.media_url) + '\')" loading="lazy">' +
        '</div>';
    }
  }

  return '<div class="flow-post" id="flow-post-' + postId + '">' +
    '<div class="flow-post-header">' +
      '<img src="' + avatarSrc(p) + '" class="flow-post-avatar" alt="" onclick="viewMemberProfile(\'' + esc(p.id || '') + '\')" style="cursor:pointer">' +
      '<div class="flow-post-meta">' +
        '<span class="flow-post-name">' + esc(name) + '</span>' +
        '<span class="flow-post-time">' + time + '</span>' +
      '</div>' +
      (isMe ? '<button class="flow-post-del-btn" onclick="_flowDeletePost(\'' + postId + '\')" title="Delete post">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>' +
      '</button>' : '') +
    '</div>' +
    (post.text_content ? '<p class="flow-post-text">' + esc(post.text_content) + '</p>' : '') +
    mediaHtml +
    '<div class="flow-post-actions">' +
      '<button class="flow-action-btn' + (myLiked ? ' liked' : '') + '" onclick="_flowToggleLike(\'' + postId + '\')">' +
        '<svg viewBox="0 0 24 24" fill="' + (myLiked ? 'currentColor' : 'none') + '" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>' +
        '<span class="flow-action-count">' + (likes || '') + '</span>' +
      '</button>' +
      '<button class="flow-action-btn" onclick="_flowOpenComments(\'' + postId + '\')">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>' +
        '<span class="flow-action-count">' + (comments || '') + '</span>' +
      '</button>' +
      '<button class="flow-action-btn" onclick="_flowShare(\'' + postId + '\')">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>' +
      '</button>' +
    '</div>' +
  '</div>';
}

/* ── Toggle like ─────────────────────────────────────────────────── */
async function _flowToggleLike(postId) {
  if (!App.currentUser) return;
  var post = _flowPosts.find(function(p) { return p.id === postId; });
  if (!post) return;

  var wasLiked = !!post._liked;
  post._liked = !wasLiked;
  post.likes_count = (post.likes_count || 0) + (wasLiked ? -1 : 1);

  // Re-render just this post's actions
  var postEl = document.getElementById('flow-post-' + postId);
  if (postEl) {
    var actEl = postEl.querySelector('.flow-post-actions');
    if (actEl) {
      var newPost = Object.assign({}, post);
      var tempDiv = document.createElement('div');
      tempDiv.innerHTML = _flowPostHTML(newPost);
      var newActions = tempDiv.querySelector('.flow-post-actions');
      if (newActions) actEl.replaceWith(newActions);
    }
  }

  // Persist to Supabase
  try {
    if (wasLiked) {
      await supabaseClient.from('flow_likes').delete()
        .eq('post_id', postId).eq('user_id', App.currentUser.id);
      await supabaseClient.from('flow_posts').update({ likes_count: post.likes_count }).eq('id', postId);
    } else {
      await supabaseClient.from('flow_likes').upsert({ post_id: postId, user_id: App.currentUser.id });
      await supabaseClient.from('flow_posts').update({ likes_count: post.likes_count }).eq('id', postId);
    }
  } catch(e) {
    console.warn('[Insan] _flowToggleLike:', e && e.message);
  }
}

/* ── Open comments ───────────────────────────────────────────────── */
var _flowActivePostId = null;

async function _flowOpenComments(postId) {
  _flowActivePostId = postId;
  var modal = document.getElementById('modal-flow-comments');
  var body  = document.getElementById('flow-comments-body');
  var inp   = document.getElementById('flow-comment-input');
  if (!modal || !body) return;
  if (inp) inp.value = '';
  body.innerHTML = '<div style="display:flex;justify-content:center;padding:24px"><span class="spinner" style="border-color:var(--border);border-top-color:var(--accent)"></span></div>';
  openModal('modal-flow-comments');

  try {
    var r = await supabaseClient.from('flow_comments')
      .select('*, profiles!user_id(id, username, display_name, avatar_url)')
      .eq('post_id', postId)
      .order('created_at', { ascending: true })
      .limit(50);

    var comments = r.data || [];
    if (comments.length === 0) {
      body.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text3);font-size:13px">No comments yet. Be the first!</div>';
      return;
    }
    body.innerHTML = comments.map(function(c) {
      var p = c.profiles || {};
      return '<div class="flow-comment">' +
        '<img src="' + avatarSrc(p) + '" class="flow-comment-avatar" alt="">' +
        '<div class="flow-comment-body">' +
          '<span class="flow-comment-name">' + esc(p.display_name || p.username || 'User') + '</span>' +
          '<span class="flow-comment-text">' + esc(c.content) + '</span>' +
          '<span class="flow-comment-time">' + fmtTime(c.created_at) + '</span>' +
        '</div>' +
      '</div>';
    }).join('');
  } catch(e) {
    body.innerHTML = '<div style="text-align:center;padding:24px;color:var(--red);font-size:13px">Could not load comments</div>';
  }
}

async function _flowSubmitComment() {
  if (!_flowActivePostId || !App.currentUser) return;
  var inp = document.getElementById('flow-comment-input');
  var text = inp ? inp.value.trim() : '';
  if (!text) return;
  var btn = document.getElementById('flow-comment-send-btn');
  if (btn) { btn.disabled = true; }
  if (inp) inp.value = '';

  try {
    await supabaseClient.from('flow_comments').insert({
      post_id: _flowActivePostId,
      user_id: App.currentUser.id,
      content: text
    });
    // Update count
    var post = _flowPosts.find(function(p) { return p.id === _flowActivePostId; });
    if (post) post.comments_count = (post.comments_count || 0) + 1;
    await supabaseClient.from('flow_posts').update({ comments_count: post ? post.comments_count : 1 }).eq('id', _flowActivePostId);
    // Re-open to refresh
    _flowOpenComments(_flowActivePostId);
  } catch(e) {
    showToast('Could not post comment', 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

/* ── Share post ──────────────────────────────────────────────────── */
function _flowShare(postId) {
  var post = _flowPosts.find(function(p) { return p.id === postId; });
  var text = (post && post.text_content) || 'Check this post on Insan!';
  if (navigator.share) {
    navigator.share({ title: 'Insan Flow', text: text, url: window.location.href }).catch(function(){});
  } else {
    navigator.clipboard && navigator.clipboard.writeText(text).then(function() { showToast('Copied ✓'); });
  }
}

/* ── Delete post ─────────────────────────────────────────────────── */
function _flowDeletePost(postId) {
  showConfirm(
    '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" fill="none" stroke="#f87171" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>',
    'Delete Post',
    'Permanently delete this post?',
    async function() {
      try {
        await supabaseClient.from('flow_comments').delete().eq('post_id', postId);
        await supabaseClient.from('flow_likes').delete().eq('post_id', postId);
        await supabaseClient.from('flow_posts').delete().eq('id', postId).eq('user_id', App.currentUser.id);
        _flowPosts = _flowPosts.filter(function(p) { return p.id !== postId; });
        var el = document.getElementById('flow-post-' + postId);
        if (el) { el.style.opacity = '0'; el.style.transform = 'scale(.95)'; setTimeout(function() { el.remove(); }, 200); }
        showToast('Post deleted');
        if (_flowPosts.length === 0) _flowRenderPosts(true);
      } catch(e) {
        showToast('Could not delete post', 'error');
      }
    }
  );
}

/* ── Compose new post ────────────────────────────────────────────── */
function openFlowCompose() {
  _flowNewPostMedia = [];
  var textEl = document.getElementById('flow-compose-text');
  var previewEl = document.getElementById('flow-compose-preview');
  if (textEl) textEl.value = '';
  if (previewEl) { previewEl.innerHTML = ''; previewEl.style.display = 'none'; }
  // Set current user avatar in compose modal
  var avEl = document.getElementById('flow-compose-avatar');
  var nmEl = document.getElementById('flow-compose-user-name');
  var commAvEl = document.getElementById('flow-comments-avatar');
  if (App.currentProfile) {
    if (avEl) avEl.src = avatarSrc(App.currentProfile);
    if (nmEl) nmEl.textContent = App.currentProfile.display_name || App.currentProfile.username || 'You';
    if (commAvEl) commAvEl.src = avatarSrc(App.currentProfile);
  }
  openModal('modal-flow-compose');
  setTimeout(function() { if (textEl) textEl.focus(); }, 150);
}

function _flowComposeAddMedia() {
  var fi = document.getElementById('flow-compose-file');
  if (fi) fi.click();
}

async function _flowHandleMediaFile(input) {
  var file = input && input.files && input.files[0];
  if (!file) return;
  if (file.size > 50 * 1024 * 1024) return showToast('File too large (max 50MB)', 'error');

  var previewEl = document.getElementById('flow-compose-preview');
  var isVideo = file.type.startsWith('video/');
  var isImage = file.type.startsWith('image/');

  // Show local preview
  var reader = new FileReader();
  reader.onload = function(e) {
    _flowNewPostMedia = [{ file: file, url: e.target.result, type: isVideo ? 'video' : 'image' }];
    if (previewEl) {
      previewEl.style.display = 'block';
      if (isVideo) {
        previewEl.innerHTML = '<div class="flow-compose-media-wrap">' +
          '<video src="' + e.target.result + '" controls style="max-width:100%;max-height:220px;border-radius:12px;display:block"></video>' +
          '<button class="flow-compose-media-del" onclick="_flowRemoveComposeMedia()">×</button>' +
        '</div>';
      } else {
        previewEl.innerHTML = '<div class="flow-compose-media-wrap">' +
          '<img src="' + e.target.result + '" style="max-width:100%;max-height:220px;border-radius:12px;display:block;object-fit:cover">' +
          '<button class="flow-compose-media-del" onclick="_flowRemoveComposeMedia()">×</button>' +
        '</div>';
      }
    }
  };
  reader.readAsDataURL(file);
  if (input) input.value = '';
}

function _flowRemoveComposeMedia() {
  _flowNewPostMedia = [];
  var previewEl = document.getElementById('flow-compose-preview');
  if (previewEl) { previewEl.innerHTML = ''; previewEl.style.display = 'none'; }
}

async function _flowSubmitPost() {
  if (!App.currentUser) return;
  var textEl = document.getElementById('flow-compose-text');
  var text = textEl ? textEl.value.trim() : '';
  var media = _flowNewPostMedia[0] || null;

  if (!text && !media) return showToast('Write something or add a photo/video', 'error');

  var btn = document.getElementById('flow-compose-submit-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>'; }

  try {
    var mediaUrl = null;
    var mediaType = null;

    // Upload media if present
    if (media && media.file) {
      var ext = media.file.name.split('.').pop().toLowerCase() || 'jpg';
      var path = 'flow/' + App.currentUser.id + '_' + Date.now() + '.' + ext;
      var blob = _dataURLtoBlob(media.url);
      var up = await supabaseClient.storage.from('avatars').upload(path, blob, { upsert: true, contentType: media.file.type });
      if (!up.error) {
        var ud = supabaseClient.storage.from('avatars').getPublicUrl(path);
        mediaUrl = ud.data && ud.data.publicUrl;
        mediaType = media.type;
      }
    }

    var r = await supabaseClient.from('flow_posts').insert({
      user_id: App.currentUser.id,
      text_content: text || null,
      media_url: mediaUrl,
      media_type: mediaType,
      likes_count: 0,
      comments_count: 0
    }).select('*, profiles!user_id(id, username, display_name, avatar_url)').single();

    if (r.error) throw r.error;

    closeModal('modal-flow-compose');
    _flowNewPostMedia = [];
    showToast('Post shared! ✓');

    // Add to top of feed if on feed tab
    if (_flowTab === 'feed' || _flowTab === 'my') {
      _flowPosts.unshift(r.data);
      var listEl = document.getElementById('flow-posts-list');
      if (listEl) {
        var emptyEl = listEl.querySelector('.flow-empty');
        if (emptyEl) listEl.innerHTML = '';
        var div = document.createElement('div');
        div.innerHTML = _flowPostHTML(r.data);
        while (div.firstChild) listEl.prepend(div.firstChild);
      }
    }
  } catch(e) {
    showToast((e && e.message) || 'Could not post', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Share'; }
  }
}

/* ── Load liked posts for current user on open ───────────────────── */
async function _flowLoadMyLikes() {
  if (!App.currentUser) return;
  try {
    var r = await supabaseClient.from('flow_likes').select('post_id').eq('user_id', App.currentUser.id);
    var likedIds = new Set((r.data || []).map(function(l) { return l.post_id; }));
    _flowPosts.forEach(function(p) { p._liked = likedIds.has(p.id); });
  } catch(e) {}
}

/* ══════════════════════════════════════════════════════════
   BACKGROUND CALL HANDLERS
   Called when user taps Answer/Decline on an OS push notification
   while the app was closed or backgrounded.
   ══════════════════════════════════════════════════════════ */

/* Called when SW relays CALL_ANSWER_FROM_NOTIF (app was in background) */
async function _handleBackgroundCallAnswer(callData) {
  if (!callData || !callData.sdp) return;

  // Store as pending offer so acceptIncomingCall() can use it
  VC.pendingOffer = callData.sdp;
  VC.pendingFrom  = callData.from;
  VC.peerName     = callData.name   || 'User';
  VC.peerAvatar   = callData.avatar || '';
  VC.chatId       = callData.chatId || null;
  VC.isCaller     = false;

  // Join signal channel so ICE candidates can flow
  _vcJoinSignalChannel(VC.chatId);

  // Wait for auth to be ready (app may have just opened)
  if (!_authReady) {
    var waitCount = 0;
    await new Promise(function(resolve) {
      var iv = setInterval(function() {
        waitCount++;
        if (_authReady || waitCount > 40) { clearInterval(iv); resolve(); }
      }, 500);
    });
  }

  if (_authReady && App.currentUser) {
    // Navigate to the chat first
    if (VC.chatId) {
      await openChat(VC.chatId, VC.pendingFrom);
    }
    // Answer the call
    setTimeout(function() { acceptIncomingCall(); }, 300);
  }
}

/* Called when user declines a call from OS notification */
function _handleBackgroundCallDecline(chatId) {
  if (!chatId) return;
  // Send vc-end signal so caller knows we declined
  var ch = supabaseClient
    .channel('vc-signal-' + chatId, { config: { broadcast: { self: false } } })
    .subscribe(function(status) {
      if (status === 'SUBSCRIBED') {
        ch.send({
          type: 'broadcast', event: 'vc-signal',
          payload: { type: 'vc-end', from: App.currentUser && App.currentUser.id },
        }).catch(function(){});
        setTimeout(function() { try { supabaseClient.removeChannel(ch); } catch(_) {} }, 3000);
      }
    });
}

/* Check URL param for incoming call — set when app is opened from push notification */
function _checkIncomingCallFromUrl() {
  try {
    var params = new URLSearchParams(window.location.search);
    var callJson = params.get('incoming_call');
    if (!callJson) return;

    // Clean the URL immediately
    var cleanUrl = window.location.origin + window.location.pathname;
    history.replaceState(null, '', cleanUrl);

    var callData = JSON.parse(decodeURIComponent(callJson));
    if (!callData || !callData.sdp) return;

    // Wait for auth to be ready then auto-answer
    console.log('[Insan] Incoming call from URL param — will auto-answer after login');
    var waitCount = 0;
    var iv = setInterval(function() {
      waitCount++;
      if (_authReady && App.currentUser) {
        clearInterval(iv);
        _handleBackgroundCallAnswer(callData);
      } else if (waitCount > 60) {
        clearInterval(iv); // give up after 30s
      }
    }, 500);
  } catch(e) {
    console.warn('[Insan] _checkIncomingCallFromUrl error:', e);
  }
}

/* ══════════════════════════════════════════════════════════
   CALL RINGTONE SETTINGS
   ══════════════════════════════════════════════════════════ */

var RINGTONE_NAMES = ['Classic', 'Modern', 'Pulse'];

function selectRingtone(idx) {
  saveSetting('call_ringtone', idx);
  document.querySelectorAll('.tone-chip[data-ringtone]').forEach(function(c) {
    c.classList.toggle('active', c.dataset.ringtone === 'custom' ? false : parseInt(c.dataset.ringtone) === idx);
  });
  var rtLabel = $('stg-ringtone-label');
  if (rtLabel) rtLabel.textContent = RINGTONE_NAMES[idx] || 'Classic';
  var cnEl = $('custom-ringtone-name');
  if (cnEl) cnEl.style.display = 'none';
  _previewRingtone(idx);
  showToast('Ringtone: ' + (RINGTONE_NAMES[idx] || 'Classic'));
}

function pickCustomRingtone() {
  var fi = $('custom-ringtone-file');
  if (fi) fi.click();
}

function handleCustomRingtone(input) {
  var file = input && input.files && input.files[0];
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function(e) {
    // Store base64 audio in settings
    saveSetting('call_ringtone', 'custom');
    saveSetting('call_ringtone_custom', file.name);
    saveSetting('call_ringtone_data', e.target.result);
    // Update UI
    document.querySelectorAll('.tone-chip[data-ringtone]').forEach(function(c) {
      c.classList.toggle('active', c.dataset.ringtone === 'custom');
    });
    var rtLabel = $('stg-ringtone-label');
    if (rtLabel) rtLabel.textContent = file.name;
    var cnEl = $('custom-ringtone-name');
    if (cnEl) { cnEl.style.display = ''; cnEl.textContent = '🎵 ' + file.name; }
    showToast('Custom ringtone set: ' + file.name);
    // Reset file input
    input.value = '';
  };
  reader.readAsDataURL(file);
}

function _previewRingtone(idx) {
  // Generate a short preview beep for each ringtone type using Web Audio
  try {
    var ctx = new (window.AudioContext || window.webkitAudioContext)();
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);

    var configs = [
      { type: 'sine',     freq: 880,  dur: 0.4 },   // Classic
      { type: 'triangle', freq: 660,  dur: 0.4 },   // Modern
      { type: 'square',   freq: 440,  dur: 0.3 },   // Pulse
    ];
    var cfg = configs[idx] || configs[0];
    osc.type = cfg.type;
    osc.frequency.value = cfg.freq;
    gain.gain.setValueAtTime(0.18, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + cfg.dur);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + cfg.dur);
    setTimeout(function() { try { ctx.close(); } catch(_) {} }, cfg.dur * 1000 + 100);
  } catch(_) {}
}

/* Play ringtone when call arrives (called by VC module) */
function _playCallRingtone() {
  var ringtoneIdx = getSetting('call_ringtone');
  var callVibrate = getSetting('call_vibrate');

  // Vibrate pattern for calls
  if (callVibrate && navigator.vibrate) {
    navigator.vibrate([500, 200, 500, 200, 500]);
  }

  // Custom ringtone from file
  if (ringtoneIdx === 'custom') {
    var data = getSetting('call_ringtone_data');
    if (data) {
      try {
        var audio = new Audio(data);
        audio.loop = true;
        audio.volume = 0.8;
        window._callRingtoneAudio = audio;
        audio.play().catch(function(){});
        return;
      } catch(_) {}
    }
  }

  // Built-in ringtones using oscillators
  _playBuiltinRingtone(ringtoneIdx || 0);
}

function _stopCallRingtone() {
  if (window._callRingtoneAudio) {
    try { window._callRingtoneAudio.pause(); window._callRingtoneAudio = null; } catch(_) {}
  }
  if (window._callRingtoneOsc) {
    try { window._callRingtoneOsc.stop(); window._callRingtoneOsc = null; } catch(_) {}
  }
  if (navigator.vibrate) navigator.vibrate(0);
}

function _playBuiltinRingtone(idx) {
  // Looping ring pattern
  var playing = true;
  var configs = [
    // 0: Classic — steady two-tone ring
    [{ f: 880, t: 'sine',     d: 0.5 }, { f: 0, d: 0.3 }],
    // 1: Modern — ascending triplet
    [{ f: 660, t: 'triangle', d: 0.3 }, { f: 880, t: 'triangle', d: 0.3 }, { f: 0, d: 0.5 }],
    // 2: Pulse — rapid double beep
    [{ f: 440, t: 'square',   d: 0.15}, { f: 0, d: 0.1 }, { f: 440, t: 'square', d: 0.15 }, { f: 0, d: 0.6 }],
  ];
  var pattern = configs[idx] || configs[0];

  function playPattern() {
    if (!playing) return;
    var ctx = new (window.AudioContext || window.webkitAudioContext)();
    var offset = 0;
    pattern.forEach(function(n) {
      if (n.f > 0) {
        var osc = ctx.createOscillator();
        var g = ctx.createGain();
        osc.connect(g); g.connect(ctx.destination);
        osc.type = n.t || 'sine';
        osc.frequency.value = n.f;
        g.gain.setValueAtTime(0.2, ctx.currentTime + offset);
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + offset + n.d);
        osc.start(ctx.currentTime + offset);
        osc.stop(ctx.currentTime + offset + n.d);
      }
      offset += n.d;
    });
    window._callRingtoneTimer = setTimeout(function() {
      ctx.close().catch(function(){});
      if (playing) playPattern();
    }, offset * 1000 + 50);
  }

  window._callRingtoneOsc = { stop: function() {
    playing = false;
    clearTimeout(window._callRingtoneTimer);
  }};
  playPattern();
}

/* ══════════════════════════════════════════════════════════
   BACKGROUND DATA / SYNC — Always on, not user-configurable
   ══════════════════════════════════════════════════════════ */

/* Always keep all Supabase subs alive — called any time we need to ensure
   CG background channels are subscribed (foreground and background). */
function applyBgDataSetting() {
  if (typeof subscribeCGBackground === 'function') subscribeCGBackground();
}

/* Register Background Sync API — always, regardless of any setting */
function applyBgSyncSetting() {
  if (navigator.serviceWorker && navigator.serviceWorker.ready) {
    navigator.serviceWorker.ready.then(function(reg) {
      if (reg.sync) reg.sync.register('insan-bg-sync').catch(function(){});
    }).catch(function(){});
  }
}

/* Ensure every sub and the call channel are alive on every visibility change */
document.addEventListener('visibilitychange', function() {
  if (!App.currentUser || !_authReady) return;
  if (document.hidden) {
    // Going to background — register sync so SW can wake us if WS drops
    applyBgSyncSetting();
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'SCHEDULE_RECONNECT', delayMs: 30000 });
    }
  } else {
    // Coming back to foreground — fully re-establish everything immediately
    if (!_vcUserCallCh) _vcStartUserCallChannel();
    subscribeCGBackground();
    // Reauth token in case it expired while backgrounded
    supabaseClient.auth.getSession().then(function(r) {
      if (r && r.data && r.data.session) App.session = r.data.session;
    }).catch(function(){});
  }
});
