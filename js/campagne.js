'use strict';
/* ============================================================
   MODULE PLAQUE — assistant + boucle d'essai (type:'plaque').
   Persistance : local (IndexedDB) + serveur (à chaque enregistrement).
   ============================================================ */
const CampagneModule = (() => {

  const PARAMS_FIXES = [
    ['Norme d\'essai',        'NF P94-117-1'],
    ['Plaque circulaire',     'Ø600 mm'],
    ['Capacité du vérin',     '200 kN'],
    ['Massif de réaction',    '> 8000 daN'],
    ['Méthode de mesure',     'Poutre Benkelman'],
    ['Rapport de levier',     '2:1'],
    ['Lecture comparateurs',  '1/1000 mm'],
  ];
  const CHECKLIST = [
    'Surface de contact préparée', 'Plaque Ø600 mm correctement mise en place',
    'Camion / engin de réaction correctement positionné', 'Massif de réaction suffisant > 8000 daN',
    'Flexible hydraulique vérifié', 'Vérin et pompe vérifiés', 'Comparateurs vérifiés',
    'Poutre Benkelman stable', 'Charge de mise en place 500 daN ± 50 daN (10 à 15 s)',
    'Déchargement initial effectué', 'Zone sécurisée autour du système de chargement',
  ];
  const METEOS = ['Soleil', 'Nuageux', 'Pluie', 'Brumeux', 'Venteux'];

  let _draft = null, _step = 0, _esIdx = 0, _resOk = false, _projMode = 'client';
  const STEPS = ['projet', 'cps', 'ouvrage', 'materiel', 'securite'];

  function nouvelle() {
    _draft = {
      type: 'plaque', ref: '', version: 1,
      codeProjet: '', client: '', entreprise: {}, nomProjet: '', lieu: '', auto: 'Non',
      cps: { ev1min: '', ev2min: '', kmax: '' },
      ouvrage: '', partieOuvrage: '', niveau: '', nbEssais: 3,
      typeReaction: 'camion', reactionPrecision: '', meteo: '', essais: [],
      statut: 'incomplet', createdAt: Date.now(),
    };
    _step = 0; _esIdx = 0; _projMode = 'client';
    _initStaticPanels(); _renderStep();
    AppNav.goto('screen-nouveau');
  }

  function _initStaticPanels() {
    const pf = document.getElementById('nv-params-fixes');
    if (pf) pf.innerHTML = PARAMS_FIXES.map(([k, v]) =>
      `<div class="param-row"><span class="param-label">${k}</span><span class="param-val">${v}</span></div>`).join('');
    const cl = document.getElementById('nv-checklist');
    if (cl) {
      cl.innerHTML = CHECKLIST.map((txt, i) =>
        `<label class="check-item"><input type="checkbox" class="nv-chk" data-i="${i}"><span>${txt}</span></label>`).join('');
      cl.querySelectorAll('.nv-chk').forEach(chk => chk.addEventListener('change', checkSecurite));
    }
  }

  function _allChecked() {
    const chks = document.querySelectorAll('#nv-checklist .nv-chk');
    return chks.length > 0 && [...chks].every(c => c.checked);
  }
  function checkSecurite() {
    const ok = _allChecked();
    const btn = document.getElementById('nv-btn-commencer');
    const msg = document.getElementById('nv-secu-msg');
    btn.disabled = !ok; btn.classList.toggle('is-disabled', !ok);
    if (msg) msg.hidden = ok;
  }

  function _renderStep() {
    STEPS.forEach((s, i) => { const el = document.getElementById('nv-step-' + s); if (el) el.hidden = (i !== _step); });
    document.querySelectorAll('#nv-stepper .step-item').forEach((it, i) => {
      it.classList.toggle('is-active', i === _step); it.classList.toggle('is-done', i < _step);
    });
    document.getElementById('nv-btn-prev').hidden = (_step === 0);
    document.getElementById('nv-btn-next').hidden = (_step === STEPS.length - 1);
    if (_step === 0) _fillProjet();
    if (_step === 1) _fillCps();
    if (_step === 2) _fillOuvrage();
    if (_step === 3) _fillMateriel();
    if (_step === 4) checkSecurite();
  }

  async function nextStep() { if (!await _validateStep()) return; await _collectStep(); if (_step < STEPS.length - 1) { _step++; _renderStep(); } }
  async function prevStep() { await _collectStep(); if (_step > 0) { _step--; _renderStep(); } }

  async function _validateStep() {
    if (_step === 0) {
      const code = _readSelectedCode();
      if (!code) { alert(_projMode === 'client' ? 'Sélectionnez le client puis le projet.' : 'Saisissez le code du projet.'); return false; }
      const p = await Referentiel.getProjet(code);
      if (!p || p.actif === false) { alert('Projet inconnu ou inactif. Ajoutez/activez-le dans Admin → Projets.'); return false; }
    }
    if (_step === 2) {
      if (!document.getElementById('nv-ouvrage').value.trim()) { alert('Indiquez l\'ouvrage testé.'); return false; }
      const nb = _readNbEssais(); if (!nb || nb < 1) { alert('Nombre d\'essais invalide.'); return false; }
    }
    return true;
  }
  async function _collectStep() {
    if (_step === 0) await _collectProjet();
    if (_step === 1) _collectCps();
    if (_step === 2) _collectOuvrage();
    if (_step === 3) _collectMateriel();
  }

  function setProjetMode(mode) {
    _projMode = mode;
    document.getElementById('nv-pmode-client').classList.toggle('is-active', mode === 'client');
    document.getElementById('nv-pmode-code').classList.toggle('is-active', mode === 'code');
    document.getElementById('nv-by-client').hidden = (mode !== 'client');
    document.getElementById('nv-by-code').hidden = (mode !== 'code');
  }

  async function _fillProjet() {
    const dl = document.getElementById('nv-code-list');
    const projets = await Referentiel.getActiveProjets();
    projets.sort((a, b) => (a.codeProjet || '').localeCompare(b.codeProjet || ''));
    dl.innerHTML = projets.map(p => `<option value="${esc(p.codeProjet)}">${esc(p.codeProjet)} — ${esc(p.nomProjet || '')} (${esc(p.client || '')})</option>`).join('');
    document.getElementById('nv-code').value = _draft.codeProjet || '';
    const clients = await Referentiel.getActiveClients();
    const selC = document.getElementById('nv-sel-client');
    selC.innerHTML = '<option value="">— Choisir un client —</option>' + clients.map(c => `<option value="${esc(c.id)}">${esc(c.nom)}</option>`).join('');
    document.getElementById('nv-ref-manuelle').checked = !!_draft.refManuelle;
    document.getElementById('nv-ref-manuelle-wrap').hidden = !_draft.refManuelle;
    document.getElementById('nv-ref-input').value = _draft.refManuelle || '';
    setProjetMode(_projMode);
    if (_draft.codeProjet) {
      const p = await Referentiel.getProjet(_draft.codeProjet);
      if (p) { selC.value = p.clientId || p.client || ''; await onSelClient(); document.getElementById('nv-sel-projet').value = p.codeProjet; _showProjLock(p); _updateRefPreview(p.codeProjet); }
    } else { document.getElementById('nv-proj-info').hidden = true; _updateRefPreview(''); }
  }

  async function onSelClient() {
    const key = document.getElementById('nv-sel-client').value;
    const selP = document.getElementById('nv-sel-projet');
    document.getElementById('nv-proj-info').hidden = true;
    if (!key) { selP.innerHTML = '<option value="">— Choisir un projet —</option>'; selP.disabled = true; return; }
    const projets = await Referentiel.getProjetsOfClient(key);
    selP.disabled = false;
    selP.innerHTML = '<option value="">— Choisir un projet —</option>' + projets.map(p => `<option value="${esc(p.codeProjet)}">${esc(p.nomProjet || p.codeProjet)} — ${esc(p.codeProjet)}</option>`).join('');
  }
  async function onSelProjet() {
    const code = (document.getElementById('nv-sel-projet').value || '').toUpperCase();
    if (!code) { document.getElementById('nv-proj-info').hidden = true; return; }
    const p = await Referentiel.getProjet(code);
    if (p) { _draft.codeProjet = code; _showProjLock(p); _updateRefPreview(code); }
  }
  async function onCodeInput() {
    const code = document.getElementById('nv-code').value.trim().toUpperCase();
    _updateRefPreview(code);
    const p = await Referentiel.getProjet(code);
    if (p && p.actif !== false) { _showProjLock(p); document.getElementById('nv-proj-notfound').hidden = true; }
    else { document.getElementById('nv-proj-info').hidden = true; document.getElementById('nv-proj-notfound').hidden = !code; }
  }
  function _updateRefPreview(code) { const el = document.getElementById('nv-ref-preview'); if (el) el.textContent = code || 'CODE'; }
  function _showProjLock(p) {
    const bloc = document.getElementById('nv-proj-info');
    bloc.innerHTML = `
      <div class="info-locked"><span class="info-label">Client</span><span>${esc(p.client || '—')}</span></div>
      <div class="info-locked"><span class="info-label">Projet</span><span>${esc(p.nomProjet || '—')}</span></div>
      <div class="info-locked"><span class="info-label">Code projet</span><span>${esc(p.codeProjet)}</span></div>
      <div class="info-locked"><span class="info-label">Lieu</span><span>${esc(p.lieu || '—')}</span></div>
      <div class="info-locked"><span class="info-label">Mode</span><span>${p.controle === false ? 'Auto-contrôle' : 'Contrôle'}</span></div>
      ${(p.controle === false && p.maitreOuvrage) ? `<div class="info-locked"><span class="info-label">Client (M. d'ouvrage)</span><span>${esc(p.maitreOuvrage)}</span></div>` : ''}`;
    bloc.hidden = false;
  }
  function _readSelectedCode() {
    return (_projMode === 'client' ? (document.getElementById('nv-sel-projet').value || '') : document.getElementById('nv-code').value).trim().toUpperCase();
  }
  function toggleRefManuelle() {
    const on = document.getElementById('nv-ref-manuelle').checked;
    document.getElementById('nv-ref-manuelle-wrap').hidden = !on;
    if (!on) document.getElementById('nv-ref-input').value = '';
  }

  async function _collectProjet() {
    const code = _readSelectedCode(); _draft.codeProjet = code;
    const man = document.getElementById('nv-ref-manuelle').checked;
    const manVal = document.getElementById('nv-ref-input').value.trim();
    _draft.refManuelle = (man && manVal) ? manVal : '';
    const p = await Referentiel.getProjet(code);
    if (p) {
      _draft.auto = (p.controle === false) ? 'Oui' : 'Non';   // mode défini par le bureau (colonne Contrôle)
      _draft.nomProjet = p.nomProjet || '';
      _draft.lieu = _joinLieu(p.lieu, p.wilaya);
      if (_draft.auto === 'Oui') {            // auto-contrôle : entête entreprise, "Client" = maître d'ouvrage
        _draft.client = p.maitreOuvrage || p.client || '';
        _draft.entreprise = (await Referentiel.getEntrepriseForProjet(p)) || {};
      } else {                                 // contrôle : entête CAEK, "Client" = entreprise
        _draft.client = p.client || '';
        _draft.entreprise = {};
      }
    }
  }
  function _joinLieu(lieu, wilaya) {
    const parts = [lieu, wilaya].map(s => (s || '').trim()).filter(Boolean);
    return parts.filter((v, i) => parts.indexOf(v) === i).join(' — ');   // sans doublon
  }

  function _fillCps() {
    document.getElementById('nv-ev1min').value = _draft.cps.ev1min || '';
    document.getElementById('nv-ev2min').value = _draft.cps.ev2min || '';
    document.getElementById('nv-kmax').value = _draft.cps.kmax || '';
  }
  function _collectCps() {
    _draft.cps = { ev1min: document.getElementById('nv-ev1min').value.trim(), ev2min: document.getElementById('nv-ev2min').value.trim(), kmax: document.getElementById('nv-kmax').value.trim() };
  }

  function _fillOuvrage() {
    document.getElementById('nv-ouvrage').value = _draft.ouvrage || '';
    const hasPartie = !!_draft.partieOuvrage;
    document.getElementById('nv-partie-toggle').checked = hasPartie;
    document.getElementById('nv-partie-wrap').hidden = !hasPartie;
    document.getElementById('nv-partie').value = _draft.partieOuvrage || '';
    document.getElementById('nv-niveau').value = _draft.niveau || '';
    _setNbEssais(_draft.nbEssais || 3);
  }
  function togglePartie() {
    const on = document.getElementById('nv-partie-toggle').checked;
    document.getElementById('nv-partie-wrap').hidden = !on;
    if (!on) document.getElementById('nv-partie').value = '';
  }
  function onNbSelect() { document.getElementById('nv-nbessais-manual-wrap').hidden = (document.getElementById('nv-nbessais').value !== 'autre'); }
  function _readNbEssais() {
    const sel = document.getElementById('nv-nbessais');
    if (sel.value === 'autre') return parseInt(document.getElementById('nv-nbessais-manual').value) || 0;
    return parseInt(sel.value) || 0;
  }
  function _setNbEssais(n) {
    const sel = document.getElementById('nv-nbessais');
    const opt = [...sel.options].find(o => o.value === String(n));
    if (opt) { sel.value = String(n); document.getElementById('nv-nbessais-manual-wrap').hidden = true; }
    else { sel.value = 'autre'; document.getElementById('nv-nbessais-manual-wrap').hidden = false; document.getElementById('nv-nbessais-manual').value = n; }
  }
  function _collectOuvrage() {
    _draft.ouvrage = document.getElementById('nv-ouvrage').value.trim();
    _draft.partieOuvrage = document.getElementById('nv-partie-toggle').checked ? document.getElementById('nv-partie').value.trim() : '';
    _draft.niveau = document.getElementById('nv-niveau').value.trim();
    _draft.nbEssais = _readNbEssais();
  }

  function _fillMateriel() { setReaction(_draft.typeReaction || 'camion'); document.getElementById('nv-reaction-precision').value = _draft.reactionPrecision || ''; }
  function setReaction(type) {
    _draft.typeReaction = type;
    ['camion', 'engin', 'autre'].forEach(t => document.getElementById('nv-reaction-' + t).classList.toggle('is-active', t === type));
    document.getElementById('nv-reaction-precision-wrap').hidden = (type !== 'autre');
  }
  function _collectMateriel() { _draft.reactionPrecision = _draft.typeReaction === 'autre' ? document.getElementById('nv-reaction-precision').value.trim() : ''; }

  async function commencerTest() {
    if (!_allChecked()) { alert('Veuillez valider tous les points de sécurité avant de continuer.'); return; }
    if (_draft.refManuelle) _draft.ref = _draft.refManuelle;   // essai antérieur / numéro précis
    if (!_draft.ref) _draft.ref = await _genererRef('plaque', _draft.codeProjet || 'XXX');
    if (!_draft.essais) _draft.essais = [];
    _draft.statut = 'incomplet';
    await _persist();
    _esIdx = _firstUnfinished(); _renderEssai();
    AppNav.goto('screen-essai');
  }

  /* Référence = N+1 de la dernière fiche du serveur (repli compteur local hors-ligne). */
  async function _genererRef(type, code) {
    const t = AuthModule.token();
    if (t && navigator.onLine) {
      try { const r = await ServerModule.nextRef(t, type, code); if (r && r.ok && r.ref) return r.ref; }
      catch (_) {}
    }
    const n = await CAEKDB.nextNumero(type, code);
    return `QC/P60/${code}${String(n).padStart(2, '0')}`;
  }

  function _firstUnfinished() {
    for (let i = 0; i < _draft.nbEssais; i++) if (!_draft.essais[i] || !_draft.essais[i].done) return i;
    return Math.max(0, _draft.nbEssais - 1);
  }

  function _renderEssai() {
    const n = _esIdx + 1, N = _draft.nbEssais;
    document.getElementById('es-count').textContent = `ESSAI ${n}/${N}`;
    document.getElementById('es-info').innerHTML = `
      <div class="es-info-line"><strong>${esc(_draft.ref)}</strong>${_draft.auto === 'Oui' ? ' · <span class="text-nok">auto-contrôle</span>' : ''}</div>
      <div class="es-info-line">${esc(_draft.client || '—')} · ${esc(_draft.nomProjet || '—')}</div>
      <div class="es-info-line text-muted">${esc(_draft.ouvrage || '')}${_draft.partieOuvrage ? ' — ' + esc(_draft.partieOuvrage) : ''}</div>`;
    const es = _draft.essais[_esIdx] || _blankEssai(n);
    document.getElementById('es-point').value = es.point || '';
    document.getElementById('es-date').value = es.date || _todayDate();
    document.getElementById('es-heure').value = es.heure || _nowTime();
    document.getElementById('es-gps').value = es.gps || '';
    _fillMeteo(es.meteo || _draft.meteo || '');
    document.getElementById('es-e1').value = es.e1 != null ? es.e1 : '';
    document.getElementById('es-z0').value = es.z0 != null ? es.z0 : '';
    document.getElementById('es-z1').value = es.z1 != null ? es.z1 : '';
    document.getElementById('es-z2').value = es.z2 != null ? es.z2 : '';
    setRaz(es.raz || 'oui');
    document.getElementById('es-results').hidden = true;
    document.getElementById('es-btn-next').hidden = true;
    _resOk = false; _renderEssaiDots(); window.scrollTo(0, 0);
  }
  function _renderEssaiDots() {
    const wrap = document.getElementById('es-dots'); if (!wrap) return;
    let html = '';
    for (let i = 0; i < _draft.nbEssais; i++) {
      const done = _draft.essais[i] && _draft.essais[i].done, cur = i === _esIdx;
      html += `<button class="es-dot ${done ? 'is-done' : ''} ${cur ? 'is-current' : ''}" data-i="${i}">${i + 1}</button>`;
    }
    wrap.innerHTML = html;
    wrap.querySelectorAll('.es-dot').forEach(b => b.addEventListener('click', () => _gotoEssai(+b.dataset.i)));
  }
  function _gotoEssai(i) { _collectEssaiInputs(); _esIdx = i; _renderEssai(); }
  function _blankEssai(n) { return { n, point: '', date: '', heure: '', gps: '', meteo: '', raz: 'oui', e1: '', z0: '', z1: '', z2: '', obs: '', done: false }; }
  function _fillMeteo(val) {
    const sel = document.getElementById('es-meteo');
    sel.innerHTML = '<option value="">— Météo —</option>' + METEOS.map(m => `<option value="${m}" ${m === val ? 'selected' : ''}>${m}</option>`).join('');
  }

  function setRaz(val) {
    document.getElementById('es-raz-oui').classList.toggle('is-active', val === 'oui');
    document.getElementById('es-raz-non').classList.toggle('is-active', val === 'non');
    document.getElementById('es-razoui-fields').hidden = (val !== 'oui');
    document.getElementById('es-raznon-fields').hidden = (val !== 'non');
    document.getElementById('es-raz-hint').textContent = val === 'oui'
      ? 'Comparateurs remis à zéro après le 1ᵉʳ cycle : saisir e1 et z2.'
      : 'Sans remise à zéro : saisir e1, z0 et z1. z2 = z1 − z0.';
    document.getElementById('es-results').hidden = true;
    document.getElementById('es-btn-next').hidden = true; _resOk = false;
  }
  function _readEssaiForm() {
    const razOui = document.getElementById('es-raz-oui').classList.contains('is-active');
    return {
      n: _esIdx + 1, point: document.getElementById('es-point').value.trim(),
      date: document.getElementById('es-date').value, heure: document.getElementById('es-heure').value,
      gps: document.getElementById('es-gps').value.trim(), meteo: document.getElementById('es-meteo').value,
      raz: razOui ? 'oui' : 'non', e1: document.getElementById('es-e1').value.trim(),
      z0: document.getElementById('es-z0').value.trim(), z1: document.getElementById('es-z1').value.trim(),
      z2: document.getElementById('es-z2').value.trim(),
    };
  }
  function _collectEssaiInputs() { const f = _readEssaiForm(); _draft.essais[_esIdx] = { ...(_draft.essais[_esIdx] || {}), ...f }; }

  function afficherResultats() {
    const f = _readEssaiForm();
    const v = PlaqueCalc.validate(f);
    if (!v.ok) { alert(v.errors.join('\n')); _resOk = false; document.getElementById('es-results').hidden = true; document.getElementById('es-btn-next').hidden = true; return; }
    const r = v.result, conf = PlaqueCalc.conformite(r, _draft.cps);
    _renderResults(f, r, conf); _resOk = true;
    document.getElementById('es-results').hidden = false;
    document.getElementById('es-btn-next').hidden = false;
    document.getElementById('es-results').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function _renderResults(f, r, conf) {
    const el = document.getElementById('es-results-body'); const C = PlaqueCalc.fmt;
    let confHTML = '';
    if (!conf.hasExig) confHTML = `<div class="conf-none">Aucune exigence CPS renseignée</div>`;
    else {
      const line = (label, ok) => ok === null ? '' : `<div class="conf-line"><span>${label}</span><span class="${ok ? 'badge badge-ok' : 'badge badge-nok'}">${ok ? '✓ Conforme' : '✗ Non conforme'}</span></div>`;
      confHTML = `${conf.global ? '<div class="conf-global conf-global-ok">✓ CONFORME</div>' : '<div class="conf-global conf-global-nok">✗ NON CONFORME</div>'}
        <div class="conf-details">${line('EV1 ≥ ' + (_draft.cps.ev1min || '—') + ' MPa', conf.ev1)}${line('EV2 ≥ ' + (_draft.cps.ev2min || '—') + ' MPa', conf.ev2)}${line('K ≤ ' + (_draft.cps.kmax || '—'), conf.k)}</div>`;
    }
    el.innerHTML = `
      <div class="res-head"><div class="res-head-title">Essai ${f.n}${f.point ? ' — ' + esc(f.point) : ''}</div></div>
      <div class="res-lines">
        <div class="res-line"><span class="res-line-k">EV1 =</span><span class="res-line-v">${C(r.ev1, 1)} <small>MPa</small></span></div>
        <div class="res-line"><span class="res-line-k">EV2 =</span><span class="res-line-v">${C(r.ev2, 1)} <small>MPa</small></span></div>
        <div class="res-line res-line-strong"><span class="res-line-k">K =</span><span class="res-line-v">${C(r.k, 2)}</span></div>
      </div>
      <div class="res-corr">e1 = <strong>${C(r.e1c, 3)} mm</strong> · z2 = <strong>${C(r.z2c, 3)} mm</strong> · RAZ ${f.raz === 'oui' ? 'Oui' : 'Non'}</div>
      ${confHTML}`;
  }

  async function enregistrerEtSuivant() {
    if (!_resOk) { alert('Affichez d\'abord les résultats.'); return; }
    const f = _readEssaiForm(), r = PlaqueCalc.compute(f), conf = PlaqueCalc.conformite(r, _draft.cps);
    _draft.essais[_esIdx] = { ...f, done: true, result: { e1c: r.e1c, z2c: r.z2c, ev1: r.ev1, ev2: r.ev2, k: r.k }, conforme: conf.hasExig ? conf.global : null };
    if (f.meteo && !_draft.meteo) _draft.meteo = f.meteo;
    const allDone = _countDone() >= _draft.nbEssais;
    _draft.statut = allDone ? 'brouillon' : 'incomplet';
    await _persist();
    if (allDone) {
      alert(`Campagne ${_draft.ref} terminée (brouillon).\nValidez-la depuis le Répertoire pour l'envoyer définitivement au bureau.`);
      AppNav.goto('screen-repertoire'); RepertoireModule.load();
    } else { _esIdx = _firstUnfinished(); _renderEssai(); }
  }

  async function suspendre() {
    if (!confirm('Suspendre la campagne ? Les essais saisis sont enregistrés.')) return;
    _collectEssaiInputs();
    _draft.statut = (_countDone() >= _draft.nbEssais) ? 'brouillon' : 'incomplet';
    await _persist();
    AppNav.goto('screen-repertoire'); RepertoireModule.load();
  }
  function _countDone() { return (_draft.essais || []).filter(e => e && e.done).length; }

  /* Enregistre en local + pousse au serveur (vérif opérateur) */
  async function _persist() {
    _draft.updatedAt = Date.now();
    _draft.operateur = AuthModule.currentName();
    await CAEKDB.saveCampagne(_draft);
    const chk = await AuthModule.ensureValid();
    if (!chk.ok) return;
    const payload = FicheModule.buildPlaque(_draft);
    await SyncModule.sendFiche('save', _draft.ref, 'plaque', payload);
  }

  function localiserGPS() { GpsHelper.locate('es-gps', 'es-gps-hint', 'es-btn-gps'); }

  async function reprendre(ref) {
    const c = await CAEKDB.getCampagne(ref);
    if (!c) return;
    if (c.statut === 'valide') { alert('Cette campagne est validée et ne peut plus être modifiée.'); return; }
    _draft = JSON.parse(JSON.stringify(c));
    if (!_draft.essais) _draft.essais = [];
    _esIdx = _firstUnfinished(); _renderEssai();
    AppNav.goto('screen-essai');
  }

  function _todayDate() { return new Date().toISOString().slice(0, 10); }
  function _nowTime() { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  return {
    nouvelle, nextStep, prevStep, setProjetMode, onSelClient, onSelProjet, onCodeInput,
    togglePartie, onNbSelect, setReaction, checkSecurite, commencerTest, toggleRefManuelle,
    setRaz, afficherResultats, enregistrerEtSuivant, suspendre, localiserGPS, reprendre,
    METEOS, PARAMS_FIXES, CHECKLIST,
  };
})();
