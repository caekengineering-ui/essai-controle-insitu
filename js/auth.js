'use strict';
/* ============================================================
   Connexion opérateur (identifiant + PIN) + session.
   - Session conservée en localStorage (survit au rechargement).
   - Re-vérifiée auprès du serveur AVANT chaque enregistrement/validation
     (op_verify) : si l'opérateur a été désactivé -> blocage + re-login.
   - Hors-ligne : l'enregistrement local reste possible (mis en file d'attente).
   ============================================================ */
const AuthModule = (() => {
  const KEY = 'caek-session';
  let _session = null;

  function _load() {
    if (_session) return _session;
    try { _session = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (_) { _session = null; }
    return _session;
  }
  function _save(s) { _session = s; localStorage.setItem(KEY, JSON.stringify(s)); }
  function clear()  { _session = null; localStorage.removeItem(KEY); }

  function session()    { return _load(); }
  function token()      { const s = _load(); return s ? s.token : null; }
  function isLoggedIn() { return !!token(); }
  function currentName(){ const s = _load(); return s ? s.nom : ''; }
  function identifiant(){ const s = _load(); return s ? s.identifiant : ''; }
  function isAdmin()    { const s = _load(); return !!(s && s.is_admin); }

  /* ---- Écran de connexion ---- */
  function showLogin() {
    document.getElementById('login-screen').hidden = false;
    document.getElementById('app-root').hidden = true;
    const err = document.getElementById('login-error');
    if (err) err.hidden = true;
    const idf = document.getElementById('login-id');
    if (idf) { idf.value = ''; setTimeout(() => idf.focus(), 100); }
    document.getElementById('login-pin').value = '';
  }
  function showApp() {
    document.getElementById('login-screen').hidden = true;
    document.getElementById('app-root').hidden = false;
  }

  function _error(msg) {
    const err = document.getElementById('login-error');
    if (err) { err.textContent = msg; err.hidden = false; }
  }

  async function doLogin() {
    const identifiantVal = document.getElementById('login-id').value.trim();
    const pin = document.getElementById('login-pin').value.trim();
    if (!identifiantVal || !pin) { _error('Saisissez l\'identifiant et le code PIN.'); return; }
    if (!ServerModule.configured()) { _error('Serveur non configuré. Renseignez js/config.js (voir guide).'); return; }
    const btn = document.getElementById('login-btn');
    btn.disabled = true; const old = btn.textContent; btn.textContent = 'Connexion…';
    try {
      const r = await ServerModule.login(identifiantVal, pin);
      if (!r || !r.ok) {
        _error(r && r.error === 'pin' ? 'Code PIN incorrect.'
             : r && r.error === 'inactif' ? 'Compte désactivé. Contactez l\'administrateur.'
             : 'Identifiant inconnu.');
        return;
      }
      _save({ token: r.token, identifiant: r.identifiant, nom: r.nom, fonction: r.fonction || '', is_admin: !!r.is_admin });
      showApp();
      if (typeof AppMain !== 'undefined') await AppMain.onLoggedIn();
    } catch (e) {
      _error(e instanceof ServerModule.NetworkError
        ? 'Pas de connexion au serveur. Vérifiez le réseau.'
        : ('Erreur : ' + e.message));
    } finally {
      btn.disabled = false; btn.textContent = old;
    }
  }

  function logout() {
    if (!confirm('Se déconnecter ?')) return;
    clear();
    showLogin();
  }

  /* ---- Vérif avant enregistrement ----
     Renvoie { ok:true, offline:false }  -> opérateur valide
              { ok:true, offline:true  } -> hors-ligne, enregistrement local autorisé (file d'attente)
              { ok:false }               -> session invalide -> re-login imposé          */
  async function ensureValid() {
    const t = token();
    if (!t) { showLogin(); return { ok: false }; }
    try {
      const r = await ServerModule.verify(t);
      if (r && r.ok) return { ok: true, offline: false };
      // session refusée -> opérateur désactivé/supprimé
      clear();
      alert('Session expirée ou compte désactivé. Veuillez vous reconnecter.');
      showLogin();
      return { ok: false };
    } catch (e) {
      if (e instanceof ServerModule.NetworkError) return { ok: true, offline: true };
      // autre erreur serveur : on autorise l'enregistrement local par sécurité
      return { ok: true, offline: true };
    }
  }

  function boot() {
    if (isLoggedIn()) showApp(); else showLogin();
  }

  return {
    boot, showLogin, showApp, doLogin, logout, ensureValid,
    session, token, isLoggedIn, currentName, identifiant, isAdmin, clear,
  };
})();
