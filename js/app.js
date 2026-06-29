'use strict';

/* ---- Navigation entre écrans ---- */
const AppNav = (() => {
  const _history = [];
  function goto(id, push = true) {
    const cur = document.querySelector('.screen.is-active');
    if (cur && push && cur.id !== id) _history.push(cur.id);
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('is-active'));
    const t = document.getElementById(id);
    if (t) t.classList.add('is-active');
    window.scrollTo(0, 0);
  }
  function back() { if (_history.length) goto(_history.pop(), false); else goto('screen-accueil', false); }
  return { goto, back };
})();

/* ---- GPS partagé (plaque + compacité) ---- */
const GpsHelper = (() => {
  function locate(inputId, hintId, btnId) {
    const hint = document.getElementById(hintId);
    const fail = 'Localisation indisponible. Saisissez les coordonnées manuellement.';
    if (!navigator.geolocation || window.isSecureContext === false) {
      if (hint) { hint.textContent = fail + (window.isSecureContext === false ? ' (HTTPS requis)' : ''); hint.classList.add('hint-error'); }
      alert(fail); return;
    }
    const btn = document.getElementById(btnId), old = btn ? btn.textContent : '';
    if (btn) { btn.textContent = '⏳ Localisation…'; btn.disabled = true; }
    navigator.geolocation.getCurrentPosition(
      pos => {
        document.getElementById(inputId).value = `${pos.coords.latitude.toFixed(6)}, ${pos.coords.longitude.toFixed(6)}`;
        if (btn) { btn.textContent = old; btn.disabled = false; }
        if (hint) { hint.textContent = 'Position obtenue (modifiable à la main).'; hint.classList.remove('hint-error'); }
      },
      () => { if (btn) { btn.textContent = old; btn.disabled = false; } if (hint) { hint.textContent = fail; hint.classList.add('hint-error'); } alert(fail); },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }
  return { locate };
})();

/* ---- Orchestration après connexion ---- */
const AppMain = (() => {
  async function onLoggedIn() {
    ProfilModule.load();
    const adm = AuthModule.isAdmin();
    document.getElementById('btn-header-admin').hidden = !adm;
    document.getElementById('btn-accueil-admin').hidden = !adm;
    AppNav.goto('screen-accueil', false);
    await Referentiel.sync();
    await SyncModule.flushOutbox();
  }
  return { onLoggedIn };
})();

document.addEventListener('DOMContentLoaded', async () => {
  const av = document.getElementById('app-version'); if (av) av.textContent = (CAEK_CONFIG && CAEK_CONFIG.APP_VERSION) || '1.0';

  /* Service worker */
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./service-worker.js').catch(() => {});
  SyncModule.init();

  /* ---- Connexion ---- */
  document.getElementById('login-btn').addEventListener('click', () => AuthModule.doLogin());
  document.getElementById('login-pin').addEventListener('keydown', e => { if (e.key === 'Enter') AuthModule.doLogin(); });

  /* ---- data-goto ---- */
  document.addEventListener('click', e => {
    const btn = e.target.closest('[data-goto]'); if (!btn) return;
    const target = btn.dataset.goto;
    if (target === 'back') { AppNav.back(); return; }
    AppNav.goto(target);
    if (target === 'screen-profil') ProfilModule.load();
    if (target === 'screen-admin') AdminModule.load();
  });

  /* ---- Accueil : 2 modules + répertoire ---- */
  document.getElementById('mod-plaque').addEventListener('click', () => CampagneModule.nouvelle());
  document.getElementById('mod-compacite').addEventListener('click', () => CompaciteModule.nouvelle());
  const repBtn = document.getElementById('btn-repertoire');
  if (repBtn) repBtn.addEventListener('click', () => { AppNav.goto('screen-repertoire'); RepertoireModule.load(); });
  const admBtn = document.getElementById('btn-accueil-admin');
  if (admBtn) admBtn.addEventListener('click', () => { AppNav.goto('screen-admin'); AdminModule.load(); });

  /* ---- Profil ---- */
  document.getElementById('btn-change-pin').addEventListener('click', () => ProfilModule.changePin());
  document.getElementById('btn-logout').addEventListener('click', () => AuthModule.logout());

  /* ---- Admin ---- */
  document.getElementById('adm-tab-op').addEventListener('click', () => AdminModule.showTab('op'));
  document.getElementById('adm-tab-ent').addEventListener('click', () => AdminModule.showTab('ent'));
  document.getElementById('adm-tab-proj').addEventListener('click', () => AdminModule.showTab('proj'));
  document.getElementById('adm-op-add').addEventListener('click', () => AdminModule.showAddOp());
  document.getElementById('adm-op-save').addEventListener('click', () => AdminModule.saveOp());
  document.getElementById('adm-op-cancel').addEventListener('click', () => { document.getElementById('adm-op-form').hidden = true; });
  document.getElementById('adm-ent-add').addEventListener('click', () => AdminModule.showAddEnt());
  document.getElementById('adm-ent-save').addEventListener('click', () => AdminModule.saveEnt());
  document.getElementById('adm-ent-cancel').addEventListener('click', () => { document.getElementById('adm-ent-form').hidden = true; });
  document.getElementById('adm-proj-add').addEventListener('click', () => AdminModule.showAddProj());
  document.getElementById('adm-proj-save').addEventListener('click', () => AdminModule.saveProj());
  document.getElementById('adm-proj-cancel').addEventListener('click', () => { document.getElementById('adm-proj-form').hidden = true; });
  document.getElementById('adm-proj-excel').addEventListener('change', async e => { const f = e.target.files[0]; if (f) await AdminModule.importExcel(f); e.target.value = ''; });

  /* ---- Assistant PLAQUE ---- */
  document.getElementById('nv-btn-next').addEventListener('click', () => CampagneModule.nextStep());
  document.getElementById('nv-btn-prev').addEventListener('click', () => CampagneModule.prevStep());
  document.getElementById('nv-code').addEventListener('input', () => CampagneModule.onCodeInput());
  document.getElementById('nv-pmode-client').addEventListener('click', () => CampagneModule.setProjetMode('client'));
  document.getElementById('nv-pmode-code').addEventListener('click', () => CampagneModule.setProjetMode('code'));
  document.getElementById('nv-sel-client').addEventListener('change', () => CampagneModule.onSelClient());
  document.getElementById('nv-sel-projet').addEventListener('change', () => CampagneModule.onSelProjet());
  document.getElementById('nv-partie-toggle').addEventListener('change', () => CampagneModule.togglePartie());
  document.getElementById('nv-ref-manuelle').addEventListener('change', () => CampagneModule.toggleRefManuelle());
  document.getElementById('nv-nbessais').addEventListener('change', () => CampagneModule.onNbSelect());
  document.getElementById('nv-reaction-camion').addEventListener('click', () => CampagneModule.setReaction('camion'));
  document.getElementById('nv-reaction-engin').addEventListener('click', () => CampagneModule.setReaction('engin'));
  document.getElementById('nv-reaction-autre').addEventListener('click', () => CampagneModule.setReaction('autre'));
  document.getElementById('nv-btn-commencer').addEventListener('click', () => CampagneModule.commencerTest());
  document.getElementById('es-raz-oui').addEventListener('click', () => CampagneModule.setRaz('oui'));
  document.getElementById('es-raz-non').addEventListener('click', () => CampagneModule.setRaz('non'));
  document.getElementById('es-btn-gps').addEventListener('click', () => CampagneModule.localiserGPS());
  document.getElementById('es-btn-resultats').addEventListener('click', () => CampagneModule.afficherResultats());
  document.getElementById('es-btn-suspendre').addEventListener('click', () => CampagneModule.suspendre());
  document.getElementById('es-btn-next').addEventListener('click', () => CampagneModule.enregistrerEtSuivant());

  /* ---- Assistant COMPACITÉ ---- */
  document.getElementById('nc-btn-next').addEventListener('click', () => CompaciteModule.nextStep());
  document.getElementById('nc-btn-prev').addEventListener('click', () => CompaciteModule.prevStep());
  document.getElementById('nc-code').addEventListener('input', () => CompaciteModule.onCodeInput());
  document.getElementById('nc-pmode-client').addEventListener('click', () => CompaciteModule.setProjetMode('client'));
  document.getElementById('nc-pmode-code').addEventListener('click', () => CompaciteModule.setProjetMode('code'));
  document.getElementById('nc-sel-client').addEventListener('change', () => CompaciteModule.onSelClient());
  document.getElementById('nc-sel-projet').addEventListener('change', () => CompaciteModule.onSelProjet());
  document.getElementById('nc-partie-toggle').addEventListener('change', () => CompaciteModule.togglePartie());
  document.getElementById('nc-ref-manuelle').addEventListener('change', () => CompaciteModule.toggleRefManuelle());
  document.getElementById('nc-nbessais').addEventListener('change', () => CompaciteModule.onNbSelect());
  document.getElementById('nc-methode').addEventListener('change', () => CompaciteModule.onMethodeChange());
  document.getElementById('nc-unite-tm3').addEventListener('click', () => CompaciteModule.setUnite('t/m3'));
  document.getElementById('nc-unite-gcm3').addEventListener('click', () => CompaciteModule.setUnite('g/cm3'));
  document.getElementById('nc-btn-commencer').addEventListener('click', () => CompaciteModule.commencerTest());
  document.getElementById('ec-mode-calc').addEventListener('click', () => CompaciteModule.setMode('calc'));
  document.getElementById('ec-mode-direct').addEventListener('click', () => CompaciteModule.setMode('direct'));
  document.getElementById('ec-btn-gps').addEventListener('click', () => CompaciteModule.localiserGPS());
  document.getElementById('ec-btn-resultats').addEventListener('click', () => CompaciteModule.afficherResultats());
  document.getElementById('ec-btn-suspendre').addEventListener('click', () => CompaciteModule.suspendre());
  document.getElementById('ec-btn-next').addEventListener('click', () => CompaciteModule.enregistrerEtSuivant());

  /* ---- Répertoire ---- */
  ['tous', 'incomplet', 'brouillon', 'valide'].forEach(f => {
    const b = document.getElementById('rep-filter-' + f);
    if (b) b.addEventListener('click', () => { document.querySelectorAll('.rep-filter-btn').forEach(x => x.classList.remove('is-active')); b.classList.add('is-active'); RepertoireModule.setFilter(f); });
  });
  ['tous', 'plaque', 'compacite'].forEach(t => { const b = document.getElementById('rep-type-' + t); if (b) b.addEventListener('click', () => RepertoireModule.setType(t)); });

  /* ---- Détail ---- */
  document.getElementById('btn-valider-confirm').addEventListener('click', () => DetailModule.valider());
  document.getElementById('btn-creer-version').addEventListener('click', () => DetailModule.creerVersion());

  /* ---- Share modal ---- */
  document.getElementById('share-modal-close').addEventListener('click', () => { document.getElementById('share-modal').hidden = true; });

  /* ---- Démarrage ---- */
  AuthModule.boot();
  if (AuthModule.isLoggedIn()) await AppMain.onLoggedIn();
});
