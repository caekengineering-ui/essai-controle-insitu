'use strict';
/* ============================================================
   MODULE COMPACITÉ — assistant + boucle de mesures (type:'compacite').
   Taux de compactage = γd in situ / γd max OPM × 100 (valeur EXACTE).
   ============================================================ */
const CompaciteModule = (() => {

  const CHECKLIST = [
    'Surface d\'essai dégagée et représentative',
    'Appareil de mesure étalonné / vérifié',
    'Référence Proctor (OPM) disponible et correcte',
    'Profondeur / couche testée conforme',
    'Zone de mesure sécurisée',
  ];
  const METEOS = ['Soleil', 'Nuageux', 'Pluie', 'Brumeux', 'Venteux'];

  let _draft = null, _step = 0, _esIdx = 0, _resOk = false, _projMode = 'client', _mode = 'calc';
  const STEPS = ['projet', 'cps', 'ouvrage', 'proctor', 'securite'];

  function nouvelle() {
    _draft = {
      type: 'compacite', ref: '', version: 1,
      codeProjet: '', client: '', entreprise: {}, nomProjet: '', lieu: '', auto: 'Non',
      tauxMin: '', ouvrage: '', partieOuvrage: '', niveau: '', materiau: '', nbEssais: 3,
      methode: '', norme: '',
      proctor: { gdOpm: '', unite: 't/m3', wOpm: '' },
      meteo: '', essais: [], statut: 'incomplet', createdAt: Date.now(),
    };
    _step = 0; _esIdx = 0; _projMode = 'client'; _mode = 'calc';
    _initChecklist(); _renderStep();
    AppNav.goto('screen-co-nouveau');
  }

  function _initChecklist() {
    const cl = document.getElementById('nc-checklist');
    if (cl) {
      cl.innerHTML = CHECKLIST.map((t, i) => `<label class="check-item"><input type="checkbox" class="nc-chk" data-i="${i}"><span>${t}</span></label>`).join('');
      cl.querySelectorAll('.nc-chk').forEach(chk => chk.addEventListener('change', checkSecurite));
    }
  }
  function _allChecked() { const c = document.querySelectorAll('#nc-checklist .nc-chk'); return c.length > 0 && [...c].every(x => x.checked); }
  function checkSecurite() {
    const ok = _allChecked();
    const btn = document.getElementById('nc-btn-commencer'), msg = document.getElementById('nc-secu-msg');
    btn.disabled = !ok; btn.classList.toggle('is-disabled', !ok); if (msg) msg.hidden = ok;
  }

  function _renderStep() {
    STEPS.forEach((s, i) => { const el = document.getElementById('nc-step-' + s); if (el) el.hidden = (i !== _step); });
    document.querySelectorAll('#nc-stepper .step-item').forEach((it, i) => { it.classList.toggle('is-active', i === _step); it.classList.toggle('is-done', i < _step); });
    document.getElementById('nc-btn-prev').hidden = (_step === 0);
    document.getElementById('nc-btn-next').hidden = (_step === STEPS.length - 1);
    if (_step === 0) _fillProjet();
    if (_step === 1) _fillCps();
    if (_step === 2) _fillOuvrage();
    if (_step === 3) _fillProctor();
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
      if (!document.getElementById('nc-ouvrage').value.trim()) { alert('Indiquez l\'ouvrage testé.'); return false; }
      const nb = _readNbEssais(); if (!nb || nb < 1) { alert('Nombre d\'essais invalide.'); return false; }
    }
    if (_step === 3) {
      if (!document.getElementById('nc-methode').value) { alert('Choisissez la méthode de mesure (elle détermine la norme).'); return false; }
      const gd = parseFloat(String(document.getElementById('nc-gdopm').value).replace(',', '.'));
      if (!(gd > 0)) { alert('Densité sèche max OPM obligatoire.'); return false; }
    }
    return true;
  }
  async function _collectStep() {
    if (_step === 0) await _collectProjet();
    if (_step === 1) _collectCps();
    if (_step === 2) _collectOuvrage();
    if (_step === 3) _collectProctor();
  }

  function setProjetMode(mode) {
    _projMode = mode;
    document.getElementById('nc-pmode-client').classList.toggle('is-active', mode === 'client');
    document.getElementById('nc-pmode-code').classList.toggle('is-active', mode === 'code');
    document.getElementById('nc-by-client').hidden = (mode !== 'client');
    document.getElementById('nc-by-code').hidden = (mode !== 'code');
  }
  async function _fillProjet() {
    const dl = document.getElementById('nc-code-list');
    const projets = await Referentiel.getActiveProjets();
    projets.sort((a, b) => (a.codeProjet || '').localeCompare(b.codeProjet || ''));
    dl.innerHTML = projets.map(p => `<option value="${esc(p.codeProjet)}">${esc(p.codeProjet)} — ${esc(p.nomProjet || '')} (${esc(p.client || '')})</option>`).join('');
    document.getElementById('nc-code').value = _draft.codeProjet || '';
    const clients = await Referentiel.getActiveClients();
    const selC = document.getElementById('nc-sel-client');
    selC.innerHTML = '<option value="">— Choisir un client —</option>' + clients.map(c => `<option value="${esc(c.id)}">${esc(c.nom)}</option>`).join('');
    document.getElementById('nc-ref-manuelle').checked = !!_draft.refManuelle;
    document.getElementById('nc-ref-manuelle-wrap').hidden = !_draft.refManuelle;
    document.getElementById('nc-ref-input').value = _draft.refManuelle || '';
    setProjetMode(_projMode);
    if (_draft.codeProjet) {
      const p = await Referentiel.getProjet(_draft.codeProjet);
      if (p) { selC.value = p.clientId || p.client || ''; await onSelClient(); document.getElementById('nc-sel-projet').value = p.codeProjet; _showProjLock(p); _updateRefPreview(p.codeProjet); }
    } else { document.getElementById('nc-proj-info').hidden = true; _updateRefPreview(''); }
  }
  async function onSelClient() {
    const key = document.getElementById('nc-sel-client').value;
    const selP = document.getElementById('nc-sel-projet');
    document.getElementById('nc-proj-info').hidden = true;
    if (!key) { selP.innerHTML = '<option value="">— Choisir un projet —</option>'; selP.disabled = true; return; }
    const projets = await Referentiel.getProjetsOfClient(key);
    selP.disabled = false;
    selP.innerHTML = '<option value="">— Choisir un projet —</option>' + projets.map(p => `<option value="${esc(p.codeProjet)}">${esc(p.nomProjet || p.codeProjet)} — ${esc(p.codeProjet)}</option>`).join('');
  }
  async function onSelProjet() {
    const code = (document.getElementById('nc-sel-projet').value || '').toUpperCase();
    if (!code) { document.getElementById('nc-proj-info').hidden = true; return; }
    const p = await Referentiel.getProjet(code);
    if (p) { _draft.codeProjet = code; _showProjLock(p); _updateRefPreview(code); }
  }
  async function onCodeInput() {
    const code = document.getElementById('nc-code').value.trim().toUpperCase();
    _updateRefPreview(code);
    const p = await Referentiel.getProjet(code);
    if (p && p.actif !== false) { _showProjLock(p); document.getElementById('nc-proj-notfound').hidden = true; }
    else { document.getElementById('nc-proj-info').hidden = true; document.getElementById('nc-proj-notfound').hidden = !code; }
  }
  function _updateRefPreview(code) { const el = document.getElementById('nc-ref-preview'); if (el) el.textContent = code || 'CODE'; }
  function _showProjLock(p) {
    const bloc = document.getElementById('nc-proj-info');
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
    return (_projMode === 'client' ? (document.getElementById('nc-sel-projet').value || '') : document.getElementById('nc-code').value).trim().toUpperCase();
  }
  function toggleRefManuelle() {
    const on = document.getElementById('nc-ref-manuelle').checked;
    document.getElementById('nc-ref-manuelle-wrap').hidden = !on;
    if (!on) document.getElementById('nc-ref-input').value = '';
  }

  async function _collectProjet() {
    const code = _readSelectedCode(); _draft.codeProjet = code;
    const man = document.getElementById('nc-ref-manuelle').checked;
    const manVal = document.getElementById('nc-ref-input').value.trim();
    _draft.refManuelle = (man && manVal) ? manVal : '';
    const p = await Referentiel.getProjet(code);
    if (p) {
      _draft.auto = (p.controle === false) ? 'Oui' : 'Non';   // mode défini par le bureau
      _draft.nomProjet = p.nomProjet || '';
      _draft.lieu = _joinLieu(p.lieu, p.wilaya);
      if (_draft.auto === 'Oui') {
        _draft.client = p.maitreOuvrage || p.client || '';
        _draft.entreprise = (await Referentiel.getEntrepriseForProjet(p)) || {};
      } else {
        _draft.client = p.client || '';
        _draft.entreprise = {};
      }
    }
  }
  function _joinLieu(lieu, wilaya) {
    const parts = [lieu, wilaya].map(s => (s || '').trim()).filter(Boolean);
    return parts.filter((v, i) => parts.indexOf(v) === i).join(' — ');
  }

  function _fillCps() { document.getElementById('nc-tauxmin').value = _draft.tauxMin || ''; }
  function _collectCps() { _draft.tauxMin = document.getElementById('nc-tauxmin').value.trim(); }

  function _fillOuvrage() {
    document.getElementById('nc-ouvrage').value = _draft.ouvrage || '';
    const hasPartie = !!_draft.partieOuvrage;
    document.getElementById('nc-partie-toggle').checked = hasPartie;
    document.getElementById('nc-partie-wrap').hidden = !hasPartie;
    document.getElementById('nc-partie').value = _draft.partieOuvrage || '';
    document.getElementById('nc-niveau').value = _draft.niveau || '';
    document.getElementById('nc-materiau').value = _draft.materiau || '';
    _setNbEssais(_draft.nbEssais || 3);
  }
  function togglePartie() {
    const on = document.getElementById('nc-partie-toggle').checked;
    document.getElementById('nc-partie-wrap').hidden = !on;
    if (!on) document.getElementById('nc-partie').value = '';
  }
  function onNbSelect() { document.getElementById('nc-nbessais-manual-wrap').hidden = (document.getElementById('nc-nbessais').value !== 'autre'); }
  function _readNbEssais() {
    const sel = document.getElementById('nc-nbessais');
    if (sel.value === 'autre') return parseInt(document.getElementById('nc-nbessais-manual').value) || 0;
    return parseInt(sel.value) || 0;
  }
  function _setNbEssais(n) {
    const sel = document.getElementById('nc-nbessais');
    const opt = [...sel.options].find(o => o.value === String(n));
    if (opt) { sel.value = String(n); document.getElementById('nc-nbessais-manual-wrap').hidden = true; }
    else { sel.value = 'autre'; document.getElementById('nc-nbessais-manual-wrap').hidden = false; document.getElementById('nc-nbessais-manual').value = n; }
  }
  function _collectOuvrage() {
    _draft.ouvrage = document.getElementById('nc-ouvrage').value.trim();
    _draft.partieOuvrage = document.getElementById('nc-partie-toggle').checked ? document.getElementById('nc-partie').value.trim() : '';
    _draft.niveau = document.getElementById('nc-niveau').value.trim();
    _draft.materiau = document.getElementById('nc-materiau').value.trim();
    _draft.nbEssais = _readNbEssais();
  }

  function _fillProctor() {
    document.getElementById('nc-methode').value = _draft.methode || '';   // vide = choix forcé
    onMethodeChange();
    document.getElementById('nc-gdopm').value = _draft.proctor.gdOpm || '';
    document.getElementById('nc-wopm').value = _draft.proctor.wOpm || '';
    setUnite(_draft.proctor.unite || 't/m3');
  }
  function onMethodeChange() {
    const m = document.getElementById('nc-methode').value;
    const norme = CompaciteCalc.normeFor(m);
    document.getElementById('nc-norme-hint').textContent = 'Norme : ' + (norme || '—');
  }
  function setUnite(u) {
    _draft.proctor.unite = u;
    document.getElementById('nc-unite-tm3').classList.toggle('is-active', u === 't/m3');
    document.getElementById('nc-unite-gcm3').classList.toggle('is-active', u === 'g/cm3');
  }
  function _collectProctor() {
    _draft.methode = document.getElementById('nc-methode').value;
    _draft.norme = CompaciteCalc.normeFor(_draft.methode);
    _draft.proctor.gdOpm = document.getElementById('nc-gdopm').value.trim();
    _draft.proctor.wOpm = document.getElementById('nc-wopm').value.trim();
  }

  async function commencerTest() {
    if (!_allChecked()) { alert('Veuillez valider tous les points avant de continuer.'); return; }
    if (_draft.refManuelle) _draft.ref = _draft.refManuelle;   // essai antérieur / numéro précis
    if (!_draft.ref) {
      const code = _draft.codeProjet || 'XXX';
      const n = await CAEKDB.nextNumero('compacite', code);
      _draft.ref = `QC/COMP/${code}${n}`;
    }
    if (!_draft.essais) _draft.essais = [];
    _draft.statut = 'incomplet';
    await _persist();
    _esIdx = _firstUnfinished(); _renderEssai();
    AppNav.goto('screen-co-essai');
  }
  function _firstUnfinished() {
    for (let i = 0; i < _draft.nbEssais; i++) if (!_draft.essais[i] || !_draft.essais[i].done) return i;
    return Math.max(0, _draft.nbEssais - 1);
  }

  function _unitLabel() { return _draft.proctor.unite === 'g/cm3' ? 'g/cm³' : 't/m³'; }

  function _renderEssai() {
    const n = _esIdx + 1, N = _draft.nbEssais;
    document.getElementById('ec-count').textContent = `ESSAI ${n}/${N}`;
    document.getElementById('ec-info').innerHTML = `
      <div class="es-info-line"><strong>${esc(_draft.ref)}</strong>${_draft.auto === 'Oui' ? ' · <span class="text-nok">auto-contrôle</span>' : ''}</div>
      <div class="es-info-line">${esc(_draft.client || '—')} · ${esc(_draft.nomProjet || '—')}</div>
      <div class="es-info-line text-muted">${esc(_draft.methode || '')} · OPM ${esc(_draft.proctor.gdOpm || '?')} ${_unitLabel()}</div>`;
    document.getElementById('ec-unit-label').textContent = _unitLabel();
    const es = _draft.essais[_esIdx] || _blankEssai(n);
    document.getElementById('ec-no').value = es.no || ('E' + n);
    document.getElementById('ec-emp').value = es.emp || '';
    document.getElementById('ec-date').value = es.date || _todayDate();
    document.getElementById('ec-heure').value = es.heure || _nowTime();
    _fillMeteo(es.meteo || _draft.meteo || '');
    _mode = es.mode || 'calc'; setMode(_mode);
    document.getElementById('ec-gh').value = es.gh != null ? es.gh : '';
    document.getElementById('ec-w').value = (es.mode !== 'direct' && es.w != null) ? es.w : '';
    document.getElementById('ec-gd').value = es.gd != null ? es.gd : '';
    document.getElementById('ec-w2').value = (es.mode === 'direct' && es.w != null) ? es.w : '';
    document.getElementById('ec-obs').value = es.obs || '';
    document.getElementById('ec-results').hidden = true;
    document.getElementById('ec-btn-next').hidden = true;
    _resOk = false; _renderDots(); window.scrollTo(0, 0);
  }
  function _renderDots() {
    const wrap = document.getElementById('ec-dots'); if (!wrap) return;
    let html = '';
    for (let i = 0; i < _draft.nbEssais; i++) {
      const done = _draft.essais[i] && _draft.essais[i].done, cur = i === _esIdx;
      html += `<button class="es-dot ${done ? 'is-done' : ''} ${cur ? 'is-current' : ''}" data-i="${i}">${i + 1}</button>`;
    }
    wrap.innerHTML = html;
    wrap.querySelectorAll('.es-dot').forEach(b => b.addEventListener('click', () => { _collectInputs(); _esIdx = +b.dataset.i; _renderEssai(); }));
  }
  function _blankEssai(n) { return { n, no: 'E' + n, emp: '', date: '', heure: '', meteo: '', mode: 'calc', gh: '', w: '', gd: '', obs: '', done: false }; }
  function _fillMeteo(val) {
    const sel = document.getElementById('ec-meteo');
    sel.innerHTML = '<option value="">— Météo —</option>' + METEOS.map(m => `<option value="${m}" ${m === val ? 'selected' : ''}>${m}</option>`).join('');
  }

  function setMode(mode) {
    _mode = mode;
    document.getElementById('ec-mode-calc').classList.toggle('is-active', mode === 'calc');
    document.getElementById('ec-mode-direct').classList.toggle('is-active', mode === 'direct');
    document.getElementById('ec-calc-fields').hidden = (mode !== 'calc');
    document.getElementById('ec-direct-fields').hidden = (mode !== 'direct');
    document.getElementById('ec-mode-hint').textContent = mode === 'calc' ? 'γd = γh / (1 + w/100)' : 'Saisir directement la densité sèche in situ.';
    document.getElementById('ec-results').hidden = true; document.getElementById('ec-btn-next').hidden = true; _resOk = false;
  }

  function _readForm() {
    return {
      n: _esIdx + 1, no: document.getElementById('ec-no').value.trim(),
      emp: document.getElementById('ec-emp').value.trim(),
      date: document.getElementById('ec-date').value, heure: document.getElementById('ec-heure').value,
      meteo: document.getElementById('ec-meteo').value, mode: _mode,
      gh: document.getElementById('ec-gh').value.trim(),
      w: _mode === 'direct' ? document.getElementById('ec-w2').value.trim() : document.getElementById('ec-w').value.trim(),
      gd: document.getElementById('ec-gd').value.trim(),
      obs: document.getElementById('ec-obs').value.trim(),
    };
  }
  function _collectInputs() { const f = _readForm(); _draft.essais[_esIdx] = { ...(_draft.essais[_esIdx] || {}), ...f }; }
  function _info() { return { gdOpm: _draft.proctor.gdOpm }; }

  function afficherResultats() {
    const f = _readForm();
    const v = CompaciteCalc.validate(f, _info());
    if (!v.ok) { alert(v.errors.join('\n')); _resOk = false; document.getElementById('ec-results').hidden = true; document.getElementById('ec-btn-next').hidden = true; return; }
    const r = v.result, conf = CompaciteCalc.conformite(r, _draft.tauxMin);
    _renderResults(f, r, conf); _resOk = true;
    document.getElementById('ec-results').hidden = false;
    document.getElementById('ec-btn-next').hidden = false;
    document.getElementById('ec-results').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function _renderResults(f, r, conf) {
    const el = document.getElementById('ec-results-body'); const C = CompaciteCalc.fmt;
    let confHTML = '';
    if (!conf.hasExig) confHTML = `<div class="conf-none">Aucune exigence CPS renseignée</div>`;
    else confHTML = conf.global ? '<div class="conf-global conf-global-ok">✓ CONFORME</div>' : '<div class="conf-global conf-global-nok">✗ NON CONFORME</div>';
    const tauxTxt = CompaciteCalc.fmtTaux(r.taux);
    el.innerHTML = `
      <div class="res-head"><div class="res-head-title">Essai ${f.n}${f.no ? ' — ' + esc(f.no) : ''}</div></div>
      <div class="res-lines">
        <div class="res-line"><span class="res-line-k">γd sèche =</span><span class="res-line-v">${C(r.gd, 3)} <small>${_unitLabel()}</small></span></div>
        ${r.w != null ? `<div class="res-line"><span class="res-line-k">w =</span><span class="res-line-v">${C(r.w, 1)} <small>%</small></span></div>` : ''}
        <div class="res-line res-line-taux"><span class="res-line-k">Taux =</span><span class="res-line-v ${r.taux > 100 ? 'taux-over' : ''}">${tauxTxt} <small>%</small></span></div>
      </div>
      <div class="res-corr">OPM = <strong>${esc(_draft.proctor.gdOpm)} ${_unitLabel()}</strong>${_draft.tauxMin ? ' · exigence ≥ ' + esc(_draft.tauxMin) + ' %' : ''}</div>
      ${confHTML}`;
  }

  async function enregistrerEtSuivant() {
    if (!_resOk) { alert('Affichez d\'abord les résultats.'); return; }
    const f = _readForm(), r = CompaciteCalc.compute(f, _info()), conf = CompaciteCalc.conformite(r, _draft.tauxMin);
    _draft.essais[_esIdx] = { ...f, done: true, result: { gd: r.gd, w: r.w, taux: r.taux }, conforme: conf.hasExig ? conf.global : null };
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
    if (!confirm('Suspendre la campagne ? Les mesures saisies sont enregistrées.')) return;
    _collectInputs();
    _draft.statut = (_countDone() >= _draft.nbEssais) ? 'brouillon' : 'incomplet';
    await _persist();
    AppNav.goto('screen-repertoire'); RepertoireModule.load();
  }
  function _countDone() { return (_draft.essais || []).filter(e => e && e.done).length; }

  async function _persist() {
    _draft.updatedAt = Date.now();
    _draft.operateur = AuthModule.currentName();
    await CAEKDB.saveCampagne(_draft);
    const chk = await AuthModule.ensureValid();
    if (!chk.ok) return;
    const payload = FicheModule.buildCompacite(_draft);
    await SyncModule.sendFiche('save', _draft.ref, 'compacite', payload);
  }

  function localiserGPS() { GpsHelper.locate('ec-emp', 'ec-gps-hint', 'ec-btn-gps'); }

  async function reprendre(ref) {
    const c = await CAEKDB.getCampagne(ref);
    if (!c) return;
    if (c.statut === 'valide') { alert('Cette campagne est validée et ne peut plus être modifiée.'); return; }
    _draft = JSON.parse(JSON.stringify(c));
    if (!_draft.essais) _draft.essais = [];
    if (!_draft.proctor) _draft.proctor = { gdOpm: '', unite: 't/m3', wOpm: '' };
    _esIdx = _firstUnfinished(); _renderEssai();
    AppNav.goto('screen-co-essai');
  }

  function _todayDate() { return new Date().toISOString().slice(0, 10); }
  function _nowTime() { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  return {
    nouvelle, nextStep, prevStep, setProjetMode, onSelClient, onSelProjet, onCodeInput,
    togglePartie, onNbSelect, onMethodeChange, setUnite, checkSecurite, commencerTest, toggleRefManuelle,
    setMode, afficherResultats, enregistrerEtSuivant, suspendre, localiserGPS, reprendre,
    METEOS, CHECKLIST,
  };
})();
