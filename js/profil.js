'use strict';
/* ============================================================
   Profil opérateur : affiche la session, change le PIN, déconnexion.
   (L'identité vient du serveur ; pas de saisie locale du profil.)
   ============================================================ */
const ProfilModule = (() => {
  function load() {
    const s = AuthModule.session() || {};
    _set('prof-nom', s.nom || '—');
    _set('prof-id', s.identifiant || '—');
    _set('prof-fonction', s.fonction || '—');
    _set('prof-role', s.is_admin ? 'Administrateur' : 'Opérateur');
    _updateBar(s);
  }

  function _updateBar(s) {
    const bar = document.getElementById('profil-bar-text');
    const btn = document.getElementById('profil-bar');
    if (!bar) return;
    if (s && s.nom) {
      bar.textContent = s.nom + (s.fonction ? ' — ' + s.fonction : '') + (s.is_admin ? ' (admin)' : '');
      btn && btn.classList.remove('is-empty');
    } else {
      bar.textContent = 'Opérateur';
      btn && btn.classList.add('is-empty');
    }
  }

  async function changePin() {
    const oldp = document.getElementById('prof-old-pin').value.trim();
    const newp = document.getElementById('prof-new-pin').value.trim();
    if (!oldp || !newp) { alert('Saisissez l\'ancien et le nouveau PIN.'); return; }
    if (newp.length < 4) { alert('Le nouveau PIN doit comporter au moins 4 caractères.'); return; }
    try {
      const r = await ServerModule.changePin(AuthModule.token(), oldp, newp);
      if (r && r.ok) {
        alert('PIN modifié.');
        document.getElementById('prof-old-pin').value = '';
        document.getElementById('prof-new-pin').value = '';
      } else {
        alert(r && r.error === 'pin' ? 'Ancien PIN incorrect.' : 'Échec de la modification.');
      }
    } catch (e) {
      alert('Erreur réseau : impossible de changer le PIN hors-ligne.');
    }
  }

  function _set(id, v) { const el = document.getElementById(id); if (el) el.textContent = v; }

  return { load, changePin, updateBar: _updateBar };
})();
