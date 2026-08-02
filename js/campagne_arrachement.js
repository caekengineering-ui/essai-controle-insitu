'use strict';
/* ============================================================
   MODULE ARRACHEMENT — assistant + déroulé par paliers (type:'arrachement').
   Un enregistrement = une campagne d'essais d'arrachement ; un « essai » =
   un clou testé, avec son programme de paliers, ses lectures horodatées,
   ses photos et ses anomalies.

   Contraintes de terrain tenues ici (§13) :
   - saisie hors-ligne, essai en cours jamais perdu (persistance à chaque
     lecture, à chaque changement de palier, et sur mise en arrière-plan) ;
   - le temps d'un palier court sur des HORODATAGES ABSOLUS : l'appli peut
     être fermée ou le téléphone verrouillé pendant un palier de 5 min ;
   - compte à rebours + alerte sonore/vibration aux temps de lecture ;
   - une seule valeur réellement saisie par lecture : le déplacement.
   ============================================================ */
const ArrachementModule = (() => {

  const CHECKLIST = [
    'Périmètre de sécurité balisé — personne dans le prolongement de l\'axe de la barre',
    'Écran ou protection en place dans l\'axe du vérin',
    'Harnais antichute relié à un point d\'ancrage indépendant du dispositif d\'essai et du clou testé',
    'Assise du dispositif de réaction stable — appuis hors de la zone d\'influence du clou',
    'Protection du parement interposée sous les appuis',
    'Flexibles, raccords et manomètre vérifiés — limiteur de pression en service',
    'EPI portés (casque, gants, lunettes, chaussures de sécurité)',
    'Conditions météo compatibles avec la mesure et la sécurité',
    'Communication établie entre l\'opérateur du vérin et le lecteur des comparateurs',
  ];
  const METEOS = ['Soleil', 'Nuageux', 'Pluie', 'Brumeux', 'Venteux'];
  const MOMENTS = [
    { code: 'avant',       label: 'Avant essai',       hint: 'État de la tête, du filetage, de la plaque, du parement' },
    { code: 'dispositif',  label: 'Dispositif en place', hint: 'Vérin, appuis, comparateurs, protection' },
    { code: 'apres',       label: 'Après essai',       hint: 'Même cadrage qu\'avant, pour comparaison' },
  ];
  const MOTIFS_ARRET = [
    'Déplacement croissant sans stabilisation sous effort constant',
    'Déplacement en tête au-delà du seuil d\'alerte',
    'Chute de l\'effort alors que le déplacement est bloqué',
    'Pression demandée au-delà de la capacité du vérin',
    'Anomalie du dispositif ou de la chaîne de mesure',
    'Condition de sécurité dégradée',
    'Autre (préciser)',
  ];

  const STEPS = ['projet', 'essai', 'ouvrage', 'materiel', 'programme', 'securite'];

  let _draft = null, _step = 0, _esIdx = 0, _projMode = 'client';
  let _tickId = null, _wakeLock = null, _alerted = {};

  /* ============================================================
     CRÉATION / REPRISE
     ============================================================ */
  function nouvelle() {
    const prm = ArrachementCalc.defauts('controle');
    _draft = {
      type: 'arrachement', ref: '', version: 1,
      codeProjet: '', client: '', entreprise: {}, nomProjet: '', lieu: '', auto: 'Non',
      typeEssai: 'controle', tmax: '', ouvrage: '', partieOuvrage: '', niveau: '',
      nbEssais: 3, meteo: '',
      materiel: {
        verin: '', diamBarre: '', diamAccessoire: '', courseMiseEnPlaceMm: '',
        mesureEffort: 'manometre', serieEffort: '', etalonnageEffort: '',
        etalA: '', etalB: '', etalUtilisee: false,
        nbComparateurs: 2, serieComp1: '', serieComp2: '', etalonnageComp: '',
      },
      params: prm, paramsDefaut: ArrachementCalc.defauts('controle'),
      essais: [], statut: 'incomplet', createdAt: Date.now(),
    };
    _step = 0; _esIdx = 0; _projMode = 'client';
    _initChecklist(); _renderStep();
    AppNav.goto('screen-ar-nouveau');
  }

  async function reprendre(ref) {
    const c = await CAEKDB.getCampagne(ref);
    if (!c) return;
    if (c.statut === 'valide') { alert('Cette campagne est validée et ne peut plus être modifiée.'); return; }
    _draft = JSON.parse(JSON.stringify(c));
    if (!_draft.essais) _draft.essais = [];
    if (!_draft.params) _draft.params = ArrachementCalc.defauts(_draft.typeEssai);
    if (!_draft.materiel) _draft.materiel = {};
    _esIdx = _firstUnfinished();
    await _renderEssai();
    AppNav.goto('screen-ar-essai');
  }

  /* ============================================================
     ASSISTANT — navigation
     ============================================================ */
  function _renderStep() {
    STEPS.forEach((s, i) => { const el = document.getElementById('na-step-' + s); if (el) el.hidden = (i !== _step); });
    document.querySelectorAll('#na-stepper .step-item').forEach((it, i) => {
      it.classList.toggle('is-active', i === _step); it.classList.toggle('is-done', i < _step);
    });
    document.getElementById('na-btn-prev').hidden = (_step === 0);
    document.getElementById('na-btn-next').hidden = (_step === STEPS.length - 1);
    if (_step === 0) _fillProjet();
    if (_step === 1) _fillEssai();
    if (_step === 2) _fillOuvrage();
    if (_step === 3) _fillMateriel();
    if (_step === 4) _fillProgramme();
    if (_step === 5) checkSecurite();
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
    if (_step === 1) {
      const t = _num(document.getElementById('na-tmax').value);
      if (!(t > 0)) { alert('Indiquez la tension max (Tmax) de l\'essai, en kN.'); return false; }
    }
    if (_step === 2) {
      if (!document.getElementById('na-ouvrage').value.trim()) { alert('Indiquez l\'ouvrage testé.'); return false; }
      if (!(_readNbEssais() >= 1)) { alert('Nombre d\'essais invalide.'); return false; }
    }
    if (_step === 3) {
      const mod = document.getElementById('na-verin').value;
      if (!mod) { alert('Sélectionnez le modèle de vérin : il détermine la pression à appliquer à chaque palier.'); return false; }
      _collectMateriel();
      const w = ArrachementCalc.controlerMontage(_montageParams());
      const bloquants = w.filter(x => x.niveau === 'bloquant');
      if (bloquants.length) { alert('Montage impossible en l\'état :\n\n• ' + bloquants.map(x => x.texte).join('\n• ')); return false; }
      if (_etalonnagePerime()) {
        if (!confirm('Un appareil de mesure est hors validité d\'étalonnage.\n\nSi vous poursuivez, la campagne sera marquée « étalonnage périmé » et les essais seront classés NON RECEVABLES.\n\nPoursuivre quand même ?')) return false;
      }
    }
    return true;
  }
  async function _collectStep() {
    if (_step === 0) await _collectProjet();
    if (_step === 1) _collectEssai();
    if (_step === 2) _collectOuvrage();
    if (_step === 3) _collectMateriel();
    if (_step === 4) _collectProgramme();
  }

  /* ============================================================
     ÉTAPE 1 — PROJET
     ============================================================ */
  function setProjetMode(mode) {
    _projMode = mode;
    document.getElementById('na-pmode-client').classList.toggle('is-active', mode === 'client');
    document.getElementById('na-pmode-code').classList.toggle('is-active', mode === 'code');
    document.getElementById('na-by-client').hidden = (mode !== 'client');
    document.getElementById('na-by-code').hidden = (mode !== 'code');
  }
  async function _fillProjet() {
    const dl = document.getElementById('na-code-list');
    const projets = await Referentiel.getActiveProjets();
    projets.sort((a, b) => (a.codeProjet || '').localeCompare(b.codeProjet || ''));
    dl.innerHTML = projets.map(p => `<option value="${esc(p.codeProjet)}">${esc(p.codeProjet)} — ${esc(p.nomProjet || '')} (${esc(p.client || '')})</option>`).join('');
    document.getElementById('na-code').value = _draft.codeProjet || '';
    const clients = await Referentiel.getActiveClients();
    const selC = document.getElementById('na-sel-client');
    selC.innerHTML = '<option value="">— Choisir un client —</option>' + clients.map(c => `<option value="${esc(c.id)}">${esc(c.nom)}</option>`).join('');
    document.getElementById('na-ref-manuelle').checked = !!_draft.refManuelle;
    document.getElementById('na-ref-manuelle-wrap').hidden = !_draft.refManuelle;
    document.getElementById('na-ref-input').value = _draft.refManuelle || '';
    setProjetMode(_projMode);
    if (_draft.codeProjet) {
      const p = await Referentiel.getProjet(_draft.codeProjet);
      if (p) { selC.value = p.clientId || p.client || ''; await onSelClient(); document.getElementById('na-sel-projet').value = p.codeProjet; _showProjLock(p); _updateRefPreview(p.codeProjet); }
    } else { document.getElementById('na-proj-info').hidden = true; _updateRefPreview(''); }
  }
  async function onSelClient() {
    const key = document.getElementById('na-sel-client').value;
    const selP = document.getElementById('na-sel-projet');
    document.getElementById('na-proj-info').hidden = true;
    if (!key) { selP.innerHTML = '<option value="">— Choisir un projet —</option>'; selP.disabled = true; return; }
    const projets = await Referentiel.getProjetsOfClient(key);
    selP.disabled = false;
    selP.innerHTML = '<option value="">— Choisir un projet —</option>' + projets.map(p => `<option value="${esc(p.codeProjet)}">${esc(p.nomProjet || p.codeProjet)} — ${esc(p.codeProjet)}</option>`).join('');
  }
  async function onSelProjet() {
    const code = (document.getElementById('na-sel-projet').value || '').toUpperCase();
    if (!code) { document.getElementById('na-proj-info').hidden = true; return; }
    const p = await Referentiel.getProjet(code);
    if (p) { _draft.codeProjet = code; _showProjLock(p); _updateRefPreview(code); }
  }
  async function onCodeInput() {
    const code = document.getElementById('na-code').value.trim().toUpperCase();
    _updateRefPreview(code);
    const p = await Referentiel.getProjet(code);
    if (p && p.actif !== false) { _showProjLock(p); document.getElementById('na-proj-notfound').hidden = true; }
    else { document.getElementById('na-proj-info').hidden = true; document.getElementById('na-proj-notfound').hidden = !code; }
  }
  function _updateRefPreview(code) { const el = document.getElementById('na-ref-preview'); if (el) el.textContent = code || 'CODE'; }
  function _showProjLock(p) {
    const bloc = document.getElementById('na-proj-info');
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
    return (_projMode === 'client' ? (document.getElementById('na-sel-projet').value || '') : document.getElementById('na-code').value).trim().toUpperCase();
  }
  function toggleRefManuelle() {
    const on = document.getElementById('na-ref-manuelle').checked;
    document.getElementById('na-ref-manuelle-wrap').hidden = !on;
    if (!on) document.getElementById('na-ref-input').value = '';
  }
  async function _collectProjet() {
    const code = _readSelectedCode(); _draft.codeProjet = code;
    const man = document.getElementById('na-ref-manuelle').checked;
    const manVal = document.getElementById('na-ref-input').value.trim();
    _draft.refManuelle = (man && manVal) ? manVal : '';
    const p = await Referentiel.getProjet(code);
    if (p) {
      _draft.auto = (p.controle === false) ? 'Oui' : 'Non';
      _draft.nomProjet = p.nomProjet || '';
      _draft.lieu = _joinLieu(p.lieu, p.wilaya);
      if (_draft.auto === 'Oui') {
        _draft.client = p.maitreOuvrage || p.client || '';
        _draft.entreprise = (await Referentiel.getEntrepriseForProjet(p)) || {};
      } else { _draft.client = p.client || ''; _draft.entreprise = {}; }
    }
  }
  function _joinLieu(lieu, wilaya) {
    const parts = [lieu, wilaya].map(s => (s || '').trim()).filter(Boolean);
    return parts.filter((v, i) => parts.indexOf(v) === i).join(' — ');
  }

  /* ============================================================
     ÉTAPE 2 — TYPE D'ESSAI ET TENSION MAX
     Le type conditionne les valeurs par défaut, il ne les VERROUILLE pas :
     la valeur par défaut et la valeur retenue sont toutes deux conservées.
     ============================================================ */
  function _fillEssai() {
    setTypeEssai(_draft.typeEssai || 'controle', true);
    document.getElementById('na-tmax').value = _draft.tmax || '';
    const sel = document.getElementById('na-cycles');
    sel.value = String(_draft.params.nbCycles || 1);
    _renderTypeInfo();
  }
  function setTypeEssai(t, silencieux) {
    const change = _draft.typeEssai !== t;
    _draft.typeEssai = t;
    document.getElementById('na-type-prealable').classList.toggle('is-active', t === 'prealable');
    document.getElementById('na-type-controle').classList.toggle('is-active', t === 'controle');
    if (change && !silencieux) {
      /* Réapplique les défauts du type SI le technicien n'a rien personnalisé. */
      const neuf = ArrachementCalc.defauts(t);
      if (!_draft.paramsModifies) _draft.params = neuf;
      _draft.paramsDefaut = ArrachementCalc.defauts(t);
      document.getElementById('na-cycles').value = String(_draft.params.nbCycles || 1);
    }
    document.getElementById('na-cycles-wrap').hidden = (t !== 'prealable');
    _renderTypeInfo();
  }
  function _renderTypeInfo() {
    const t = _draft.typeEssai, d = _draft.params;
    const el = document.getElementById('na-type-info');
    const prealable = t === 'prealable';
    el.innerHTML = `
      <div class="param-panel-title">${prealable ? 'Essai préalable' : 'Essai de contrôle'} — valeurs par défaut</div>
      <div class="param-row"><span class="param-label">Support</span><span class="param-val">${prealable ? 'Clou sacrificiel, hors ouvrage' : 'Clou définitif de l\'ouvrage'}</span></div>
      <div class="param-row"><span class="param-label">Objet</span><span class="param-val">${prealable ? 'Vérifier les hypothèses de dimensionnement, chercher la capacité' : 'Contrôler la qualité et la régularité d\'exécution'}</span></div>
      <div class="param-row"><span class="param-label">Cycles</span><span class="param-val">${prealable ? 'Plusieurs cycles possibles' : 'Cycle unique'}</span></div>
      <div class="param-row"><span class="param-label">Palier final</span><span class="param-val">${_f(d.dureeFinalMin, 0)} min</span></div>
      <div class="param-row"><span class="param-label">Détection de stabilisation</span><span class="param-val">${d.stabilisationActive ? 'Activée' : 'Désactivée'}</span></div>
      <div class="param-row"><span class="param-label">Rupture</span><span class="param-val">${prealable ? 'Peut être recherchée' : 'Jamais — essai non destructif'}</span></div>
      <div class="bar-note">${prealable
        ? 'Essai préalable : Tmax peut atteindre une fraction importante de la limite élastique de l\'acier de la barre.'
        : 'Essai de contrôle : Tmax reste modérée, plafonnée par une fraction de la charge de service. La rupture ne doit jamais être recherchée.'}</div>`;
  }
  function _collectEssai() {
    _draft.tmax = document.getElementById('na-tmax').value.trim();
    const n = parseInt(document.getElementById('na-cycles').value) || 1;
    _draft.params.nbCycles = (_draft.typeEssai === 'prealable') ? n : 1;
  }

  /* ============================================================
     ÉTAPE 3 — OUVRAGE
     ============================================================ */
  function _fillOuvrage() {
    document.getElementById('na-ouvrage').value = _draft.ouvrage || '';
    const hasPartie = !!_draft.partieOuvrage;
    document.getElementById('na-partie-toggle').checked = hasPartie;
    document.getElementById('na-partie-wrap').hidden = !hasPartie;
    document.getElementById('na-partie').value = _draft.partieOuvrage || '';
    document.getElementById('na-niveau').value = _draft.niveau || '';
    _setNbEssais(_draft.nbEssais || 3);
  }
  function togglePartie() {
    const on = document.getElementById('na-partie-toggle').checked;
    document.getElementById('na-partie-wrap').hidden = !on;
    if (!on) document.getElementById('na-partie').value = '';
  }
  function onNbSelect() { document.getElementById('na-nbessais-manual-wrap').hidden = (document.getElementById('na-nbessais').value !== 'autre'); }
  function _readNbEssais() {
    const sel = document.getElementById('na-nbessais');
    if (sel.value === 'autre') return parseInt(document.getElementById('na-nbessais-manual').value) || 0;
    return parseInt(sel.value) || 0;
  }
  function _setNbEssais(n) {
    const sel = document.getElementById('na-nbessais');
    const opt = [...sel.options].find(o => o.value === String(n));
    if (opt) { sel.value = String(n); document.getElementById('na-nbessais-manual-wrap').hidden = true; }
    else { sel.value = 'autre'; document.getElementById('na-nbessais-manual-wrap').hidden = false; document.getElementById('na-nbessais-manual').value = n; }
  }
  function _collectOuvrage() {
    _draft.ouvrage = document.getElementById('na-ouvrage').value.trim();
    _draft.partieOuvrage = document.getElementById('na-partie-toggle').checked ? document.getElementById('na-partie').value.trim() : '';
    _draft.niveau = document.getElementById('na-niveau').value.trim();
    _draft.nbEssais = _readNbEssais();
  }

  /* ============================================================
     ÉTAPE 4 — MATÉRIEL
     ============================================================ */
  function _fillMateriel() {
    const m = _draft.materiel;
    const sel = document.getElementById('na-verin');
    sel.innerHTML = '<option value="">— Choisir le vérin —</option>' +
      ArrachementCalc.verins().map(v => `<option value="${esc(v.modele)}">${esc(v.modele)} — ${_f(v.surfaceCm2, 2)} cm² · ${_f(v.capaciteKN, 0)} kN · trou Ø ${_f(v.trouMm, 1)} mm</option>`).join('');
    sel.value = m.verin || '';
    document.getElementById('na-diam-barre').value = m.diamBarre || '';
    document.getElementById('na-diam-acc').value = m.diamAccessoire || '';
    document.getElementById('na-course-mep').value = m.courseMiseEnPlaceMm || '';
    setMesureEffort(m.mesureEffort || 'manometre');
    document.getElementById('na-serie-effort').value = m.serieEffort || '';
    document.getElementById('na-etal-effort').value = m.etalonnageEffort || '';
    document.getElementById('na-etal-utilisee').checked = !!m.etalUtilisee;
    document.getElementById('na-etal-wrap').hidden = !m.etalUtilisee;
    document.getElementById('na-etal-a').value = m.etalA || '';
    document.getElementById('na-etal-b').value = m.etalB || '';
    setNbComparateurs(m.nbComparateurs || 2);
    document.getElementById('na-serie-c1').value = m.serieComp1 || '';
    document.getElementById('na-serie-c2').value = m.serieComp2 || '';
    document.getElementById('na-etal-comp').value = m.etalonnageComp || '';
    onMaterielChange();
  }
  function setMesureEffort(mode) {
    _draft.materiel.mesureEffort = mode;
    document.getElementById('na-eff-capteur').classList.toggle('is-active', mode === 'capteur');
    document.getElementById('na-eff-mano').classList.toggle('is-active', mode === 'manometre');
    onMaterielChange();
  }
  function setNbComparateurs(n) {
    _draft.materiel.nbComparateurs = n;
    document.getElementById('na-comp-1').classList.toggle('is-active', n === 1);
    document.getElementById('na-comp-2').classList.toggle('is-active', n === 2);
    document.getElementById('na-serie-c2-wrap').hidden = (n !== 2);
    document.getElementById('na-axialite-wrap').hidden = (n !== 2);
  }
  function toggleEtalonnage() {
    const on = document.getElementById('na-etal-utilisee').checked;
    _draft.materiel.etalUtilisee = on;
    document.getElementById('na-etal-wrap').hidden = !on;
    onMaterielChange();
  }
  function _etal() {
    const m = _draft.materiel;
    return { a: m.etalA, b: m.etalB, valide: !!m.etalUtilisee && _num(m.etalA) > 0 };
  }
  function _verin() { return ArrachementCalc.getVerin(_draft.materiel.verin); }
  function _montageParams() {
    const m = _draft.materiel;
    return { verin: _verin(), tmax: _draft.tmax, diamBarre: m.diamBarre, diamAccessoire: m.diamAccessoire,
             etal: _etal(), courseUtiliseeMm: m.courseMiseEnPlaceMm };
  }
  /* Un appareil dont l'étalonnage est périmé bloque ou marque explicitement l'essai (§14). */
  function _etalonnagePerime() {
    const m = _draft.materiel;
    const today = new Date().toISOString().slice(0, 10);
    return [m.etalonnageEffort, m.etalonnageComp].some(d => d && d < today);
  }

  function onMaterielChange() {
    _collectMateriel();
    const v = _verin();
    /* Avertissements de compatibilité */
    const w = ArrachementCalc.controlerMontage(_montageParams());
    if (_etalonnagePerime()) {
      w.unshift({ niveau: 'bloquant', texte: 'Étalonnage périmé sur au moins un appareil de mesure : l\'essai sera classé NON RECEVABLE.' });
    }
    const wrap = document.getElementById('na-materiel-warn');
    wrap.innerHTML = w.map(x => `<div class="ar-warn ar-warn-${x.niveau}">${x.niveau === 'bloquant' ? '⛔' : x.niveau === 'alerte' ? '⚠️' : 'ℹ️'} ${esc(x.texte)}</div>`).join('');
    wrap.hidden = !w.length;

    /* Aperçu vérin + tableau effort → pression */
    const info = document.getElementById('na-verin-info');
    if (!v) { info.hidden = true; document.getElementById('na-pression-table').innerHTML = ''; return; }
    info.hidden = false;
    info.innerHTML = `
      <div class="param-row"><span class="param-label">Surface effective</span><span class="param-val">${_f(v.surfaceCm2, 2)} cm²</span></div>
      <div class="param-row"><span class="param-label">Capacité à ${v.pmaxBar} bar</span><span class="param-val">${_f(v.capaciteKN, 0)} kN</span></div>
      <div class="param-row"><span class="param-label">Course</span><span class="param-val">${_f(v.courseMm, 1)} mm</span></div>
      <div class="param-row"><span class="param-label">Ø trou central</span><span class="param-val">${_f(v.trouMm, 1)} mm</span></div>
      <div class="param-row"><span class="param-label">Relation effort/pression</span><span class="param-val">${_etal().valide ? 'Courbe d\'étalonnage de l\'exemplaire' : 'Nominale (frottement ignoré)'}</span></div>`;
    _renderPressionTable();
  }
  function _renderPressionTable() {
    const v = _verin(), t = _num(_draft.tmax);
    const host = document.getElementById('na-pression-table');
    if (!v || !(t > 0)) { host.innerHTML = ''; return; }
    const paliers = ArrachementCalc.genererPaliers(t, _draft.params, v, _etal());
    host.innerHTML = `<div class="param-panel-title">Efforts et pressions à appliquer</div>` + _tablePaliers(paliers, v);
  }
  function _tablePaliers(paliers, v) {
    return `<div class="ar-table-wrap"><table class="ar-table">
      <thead><tr><th>Palier</th><th>Effort<br><small>kN</small></th><th>Pression<br><small>bar</small></th><th>Durée<br><small>min</small></th><th>Lectures<br><small>min</small></th></tr></thead>
      <tbody>${paliers.map(p => `<tr class="ar-row-${p.phase}${p.final ? ' ar-row-final' : ''}">
        <td>${esc(p.label)}</td>
        <td class="num">${_f(p.effort, 1)}</td>
        <td class="num">${p.pressionBar == null ? '—' : _f(p.pressionBar, 0)}${(v && p.pressionBar > (v.pmaxBar || 700)) ? ' ⛔' : ''}</td>
        <td class="num">${_f(p.dureeMin, 0)}</td>
        <td class="num">${(p.lecturesMin || []).join(' · ')}</td>
      </tr>`).join('')}</tbody></table></div>`;
  }
  function _collectMateriel() {
    const m = _draft.materiel;
    m.verin = document.getElementById('na-verin').value;
    m.diamBarre = document.getElementById('na-diam-barre').value.trim();
    m.diamAccessoire = document.getElementById('na-diam-acc').value.trim();
    m.courseMiseEnPlaceMm = document.getElementById('na-course-mep').value.trim();
    m.serieEffort = document.getElementById('na-serie-effort').value.trim();
    m.etalonnageEffort = document.getElementById('na-etal-effort').value;
    m.etalUtilisee = document.getElementById('na-etal-utilisee').checked;
    m.etalA = document.getElementById('na-etal-a').value.trim();
    m.etalB = document.getElementById('na-etal-b').value.trim();
    m.serieComp1 = document.getElementById('na-serie-c1').value.trim();
    m.serieComp2 = document.getElementById('na-serie-c2').value.trim();
    m.etalonnageComp = document.getElementById('na-etal-comp').value;
  }

  /* ============================================================
     ÉTAPE 5 — PROGRAMME DE PALIERS ET SEUILS
     ============================================================ */
  function _fillProgramme() {
    const d = _draft.params;
    document.getElementById('na-frac-pa').value = _pct(d.fractionPa);
    document.getElementById('na-frac-charge').value = (d.fractionsCharge || []).map(_pct).join(', ');
    document.getElementById('na-frac-decharge').value = (d.fractionsDecharge || []).map(_pct).join(', ');
    document.getElementById('na-duree-palier').value = d.dureePalierMin;
    document.getElementById('na-duree-final').value = d.dureeFinalMin;
    document.getElementById('na-lectures-palier').value = (d.lecturesPalier || []).join(', ');
    document.getElementById('na-lectures-final').value = (d.lecturesFinal || []).join(', ');
    document.getElementById('na-stab-active').checked = !!d.stabilisationActive;
    document.getElementById('na-stab-wrap').hidden = !d.stabilisationActive;
    document.getElementById('na-stab-seuil').value = d.seuilStabMmParMin;
    document.getElementById('na-stab-duree').value = d.dureeMiniMaintienMin;
    document.getElementById('na-alpha-ok').value = d.alphaOk;
    document.getElementById('na-alpha-haut').value = d.alphaHaut;
    document.getElementById('na-seuil-dep').value = d.seuilDeplacementMm;
    document.getElementById('na-seuil-ecart').value = d.seuilEcartComparateursMm;
    document.getElementById('na-tol-effort').value = d.toleranceEffortPct;
    onProgrammeChange();
  }
  function toggleStabilisation() {
    const on = document.getElementById('na-stab-active').checked;
    document.getElementById('na-stab-wrap').hidden = !on;
    onProgrammeChange();
  }
  function onProgrammeChange() {
    _collectProgramme();
    const host = document.getElementById('na-paliers-preview');
    const v = _verin(), t = _num(_draft.tmax);
    if (!(t > 0)) { host.innerHTML = '<p class="empty-msg">Renseignez Tmax à l\'étape « Essai ».</p>'; return; }
    const paliers = ArrachementCalc.genererPaliers(t, _draft.params, v, _etal());
    host.innerHTML = _tablePaliers(paliers, v) +
      `<div class="bar-note">Le temps d'un palier démarre à l'<strong>atteinte de l'effort cible</strong>, pas au début de la montée en pression — laquelle doit se faire en 1 min au plus.${
        _draft.params.stabilisationActive ? ' La détection de stabilisation ne s\'applique <strong>jamais au palier final</strong> : il va toujours à son terme, car c\'est sur lui que α est calculé.' : ''}</div>`;
    _renderDiffDefauts();
  }
  /* Traçabilité : valeur par défaut du type d'essai vs valeur retenue. */
  function _renderDiffDefauts() {
    const host = document.getElementById('na-diff-defauts');
    const d = _draft.params, ref = _draft.paramsDefaut || {};
    const lignes = [];
    const cmp = (k, lbl, fmtv) => {
      const a = JSON.stringify(ref[k]), b = JSON.stringify(d[k]);
      if (a !== undefined && a !== b) lignes.push(`<div class="param-row"><span class="param-label">${lbl}</span><span class="param-val">${fmtv(ref[k])} → <strong>${fmtv(d[k])}</strong></span></div>`);
    };
    const asPct = a => (a || []).map ? (Array.isArray(a) ? a.map(_pct).join(' / ') + ' %' : _pct(a) + ' %') : String(a);
    cmp('fractionPa', 'Palier de serrage', v => _pct(v) + ' %');
    cmp('fractionsCharge', 'Paliers de chargement', asPct);
    cmp('fractionsDecharge', 'Paliers de déchargement', asPct);
    cmp('dureePalierMin', 'Durée palier', v => v + ' min');
    cmp('dureeFinalMin', 'Durée palier final', v => v + ' min');
    cmp('lecturesPalier', 'Temps de lecture', v => (v || []).join(' · ') + ' min');
    cmp('lecturesFinal', 'Temps de lecture (final)', v => (v || []).join(' · ') + ' min');
    cmp('stabilisationActive', 'Détection de stabilisation', v => v ? 'activée' : 'désactivée');
    cmp('seuilStabMmParMin', 'Seuil de stabilisation', v => v + ' mm/min');
    cmp('dureeMiniMaintienMin', 'Durée mini de maintien', v => v + ' min');
    cmp('alphaOk', 'Seuil α satisfaisant', v => v + ' mm');
    cmp('alphaHaut', 'Seuil α haut', v => v + ' mm');
    cmp('seuilDeplacementMm', 'Seuil de déplacement', v => v + ' mm');
    cmp('seuilEcartComparateursMm', 'Écart comparateurs', v => v + ' mm');
    cmp('nbCycles', 'Nombre de cycles', v => String(v));
    _draft.paramsModifies = lignes.length > 0;
    host.hidden = !lignes.length;
    host.innerHTML = lignes.length
      ? `<div class="param-panel-title">Écarts aux valeurs par défaut (tracés dans le PV)</div>${lignes.join('')}` : '';
  }
  function _collectProgramme() {
    const d = _draft.params;
    d.fractionPa = _fracOf(document.getElementById('na-frac-pa').value, d.fractionPa);
    d.fractionsCharge = _fracsOf(document.getElementById('na-frac-charge').value, d.fractionsCharge);
    d.fractionsDecharge = _fracsOf(document.getElementById('na-frac-decharge').value, d.fractionsDecharge);
    d.dureePalierMin = _numOr(document.getElementById('na-duree-palier').value, d.dureePalierMin);
    d.dureeFinalMin = _numOr(document.getElementById('na-duree-final').value, d.dureeFinalMin);
    d.lecturesPalier = _listOf(document.getElementById('na-lectures-palier').value, d.lecturesPalier);
    d.lecturesFinal = _listOf(document.getElementById('na-lectures-final').value, d.lecturesFinal);
    d.stabilisationActive = document.getElementById('na-stab-active').checked;
    d.seuilStabMmParMin = _numOr(document.getElementById('na-stab-seuil').value, d.seuilStabMmParMin);
    d.dureeMiniMaintienMin = _numOr(document.getElementById('na-stab-duree').value, d.dureeMiniMaintienMin);
    d.alphaOk = _numOr(document.getElementById('na-alpha-ok').value, d.alphaOk);
    d.alphaHaut = _numOr(document.getElementById('na-alpha-haut').value, d.alphaHaut);
    d.seuilDeplacementMm = _numOr(document.getElementById('na-seuil-dep').value, d.seuilDeplacementMm);
    d.seuilEcartComparateursMm = _numOr(document.getElementById('na-seuil-ecart').value, d.seuilEcartComparateursMm);
    d.toleranceEffortPct = _numOr(document.getElementById('na-tol-effort').value, d.toleranceEffortPct);
  }
  function _pct(f) { return Math.round(_num(f) * 100); }
  function _fracOf(txt, dflt) { const v = _num(txt); return (v > 0 && v <= 100) ? v / 100 : dflt; }
  function _fracsOf(txt, dflt) {
    const l = String(txt || '').split(/[;,\s]+/).map(_num).filter(v => v > 0 && v <= 100).map(v => v / 100);
    return l.length ? l : dflt;
  }
  function _listOf(txt, dflt) {
    const l = String(txt || '').split(/[;,\s]+/).map(_num).filter(v => !isNaN(v) && v >= 0).sort((a, b) => a - b);
    return l.length ? l : dflt;
  }
  function _numOr(v, dflt) { const x = _num(v); return isNaN(x) ? dflt : x; }

  /* ============================================================
     ÉTAPE 6 — SÉCURITÉ (bloquante, chaque point horodaté)
     ============================================================ */
  function _initChecklist() {
    const cl = document.getElementById('na-checklist');
    if (!cl) return;
    cl.innerHTML = CHECKLIST.map((t, i) => `<label class="check-item"><input type="checkbox" class="na-chk" data-i="${i}"><span>${esc(t)}</span></label>`).join('');
    cl.querySelectorAll('.na-chk').forEach(chk => chk.addEventListener('change', () => {
      const i = +chk.dataset.i;
      _draft.checklist = _draft.checklist || {};
      if (chk.checked) _draft.checklist[i] = { texte: CHECKLIST[i], ts: Date.now(), par: AuthModule.currentName() };
      else delete _draft.checklist[i];
      checkSecurite();
    }));
  }
  function _allChecked() { const c = document.querySelectorAll('#na-checklist .na-chk'); return c.length > 0 && [...c].every(x => x.checked); }
  function checkSecurite() {
    const ok = _allChecked();
    const btn = document.getElementById('na-btn-commencer'), msg = document.getElementById('na-secu-msg');
    btn.disabled = !ok; btn.classList.toggle('is-disabled', !ok); if (msg) msg.hidden = ok;
  }

  /* ============================================================
     DÉMARRAGE DE LA CAMPAGNE
     ============================================================ */
  async function commencerTest() {
    if (!_allChecked()) { alert('La check-list sécurité doit être intégralement validée avant tout chargement.'); return; }
    if (_draft.refManuelle) _draft.ref = _draft.refManuelle;
    if (!_draft.ref) _draft.ref = await _genererRef('arrachement', _draft.codeProjet || 'XXX');
    if (!_draft.essais) _draft.essais = [];
    _draft.etalonnagePerime = _etalonnagePerime();
    _draft.statut = 'incomplet';
    await _persist();
    _esIdx = _firstUnfinished();
    await _renderEssai();
    AppNav.goto('screen-ar-essai');
  }
  async function _genererRef(type, code) {
    const t = AuthModule.token();
    if (t && navigator.onLine) {
      try { const r = await ServerModule.nextRef(t, type, code); if (r && r.ok && r.ref) return r.ref; }
      catch (_) {}
    }
    const n = await CAEKDB.nextNumero(type, code);
    return `QC/ARR/${code}${String(n).padStart(2, '0')}`;
  }
  function _firstUnfinished() {
    for (let i = 0; i < _draft.nbEssais; i++) if (!_draft.essais[i] || !_draft.essais[i].done) return i;
    return Math.max(0, _draft.nbEssais - 1);
  }

  /* ============================================================
     ÉCRAN D'ESSAI — un clou
     ============================================================ */
  function _blankEssai(n) {
    return {
      n, clou: { repere: 'C' + n, zone: '', niveau: _draft.niveau || '', gps: '',
                 diamBarre: _draft.materiel.diamBarre || '', longueurTotale: '', longueurScellee: '',
                 diamForage: '', dateScellement: '', nuanceAcier: '' },
      date: '', heure: '', meteo: '',
      courseMiseEnPlaceMm: _draft.materiel.courseMiseEnPlaceMm || '',
      paliers: ArrachementCalc.genererPaliers(_num(_draft.tmax), _draft.params, _verin(), _etal()),
      pIdx: 0, origine: null,
      anomalies: [], photos: [],
      arret: { stopped: false, motif: '' },
      done: false,
    };
  }
  function _essai() {
    if (!_draft.essais[_esIdx]) _draft.essais[_esIdx] = _blankEssai(_esIdx + 1);
    const e = _draft.essais[_esIdx];
    if (!e.paliers || !e.paliers.length) e.paliers = ArrachementCalc.genererPaliers(_num(_draft.tmax), _draft.params, _verin(), _etal());
    if (!e.anomalies) e.anomalies = [];
    if (!e.photos) e.photos = [];
    if (!e.arret) e.arret = { stopped: false, motif: '' };
    return e;
  }
  function _palierCourant() { const e = _essai(); return e.paliers[e.pIdx] || null; }

  async function _renderEssai() {
    const e = _essai(), n = _esIdx + 1, N = _draft.nbEssais, v = _verin();
    document.getElementById('ea-count').textContent = `CLOU ${n}/${N}`;
    document.getElementById('ea-info').innerHTML = `
      <div class="es-info-line"><strong>${esc(_draft.ref)}</strong>${_draft.auto === 'Oui' ? ' · <span class="text-nok">auto-contrôle</span>' : ''}</div>
      <div class="es-info-line">${esc(_draft.client || '—')} · ${esc(_draft.nomProjet || '—')}</div>
      <div class="es-info-line text-muted">${_draft.typeEssai === 'prealable' ? 'Essai préalable' : 'Essai de contrôle'} · Tmax ${_f(_num(_draft.tmax), 0)} kN · ${esc(_draft.materiel.verin || 'vérin ?')}${v ? ' (' + _f(v.surfaceCm2, 2) + ' cm²)' : ''}</div>`;
    const c = e.clou;
    document.getElementById('ea-repere').value = c.repere || ('C' + n);
    document.getElementById('ea-zone').value = c.zone || '';
    document.getElementById('ea-niveau').value = c.niveau || '';
    document.getElementById('ea-gps').value = c.gps || '';
    document.getElementById('ea-date').value = e.date || _todayDate();
    document.getElementById('ea-heure').value = e.heure || _nowTime();
    _fillMeteo(e.meteo || _draft.meteo || '');
    document.getElementById('ea-diam-barre').value = c.diamBarre || '';
    document.getElementById('ea-long-totale').value = c.longueurTotale || '';
    document.getElementById('ea-long-scellee').value = c.longueurScellee || '';
    document.getElementById('ea-diam-forage').value = c.diamForage || '';
    document.getElementById('ea-date-scellement').value = c.dateScellement || '';
    document.getElementById('ea-nuance').value = c.nuanceAcier || '';
    document.getElementById('ea-course-mep').value = e.courseMiseEnPlaceMm || '';
    document.getElementById('ea-results').hidden = true;
    _renderDots(); _renderRunner(); _renderAnomalies();
    await _renderPhotos();
    _startTicker();
    window.scrollTo(0, 0);
  }
  function _renderDots() {
    const wrap = document.getElementById('ea-dots'); if (!wrap) return;
    let html = '';
    for (let i = 0; i < _draft.nbEssais; i++) {
      const es = _draft.essais[i];
      const done = es && es.done, cur = i === _esIdx;
      const cls = done ? (es.result && es.result.classe === 'non_recevable' ? 'is-nok' : 'is-done') : '';
      html += `<button class="es-dot ${cls} ${cur ? 'is-current' : ''}" data-i="${i}">${i + 1}</button>`;
    }
    wrap.innerHTML = html;
    wrap.querySelectorAll('.es-dot').forEach(b => b.addEventListener('click', async () => {
      _collectIdent(); await _persistLocal();
      _esIdx = +b.dataset.i; await _renderEssai();
    }));
  }
  function _fillMeteo(val) {
    const sel = document.getElementById('ea-meteo');
    sel.innerHTML = '<option value="">— Météo —</option>' + METEOS.map(m => `<option value="${m}" ${m === val ? 'selected' : ''}>${m}</option>`).join('');
  }
  function _collectIdent() {
    const e = _essai();
    e.clou.repere = document.getElementById('ea-repere').value.trim();
    e.clou.zone = document.getElementById('ea-zone').value.trim();
    e.clou.niveau = document.getElementById('ea-niveau').value.trim();
    e.clou.gps = document.getElementById('ea-gps').value.trim();
    e.date = document.getElementById('ea-date').value;
    e.heure = document.getElementById('ea-heure').value;
    e.meteo = document.getElementById('ea-meteo').value;
    e.clou.diamBarre = document.getElementById('ea-diam-barre').value.trim();
    e.clou.longueurTotale = document.getElementById('ea-long-totale').value.trim();
    e.clou.longueurScellee = document.getElementById('ea-long-scellee').value.trim();
    e.clou.diamForage = document.getElementById('ea-diam-forage').value.trim();
    e.clou.dateScellement = document.getElementById('ea-date-scellement').value;
    e.clou.nuanceAcier = document.getElementById('ea-nuance').value.trim();
    e.courseMiseEnPlaceMm = document.getElementById('ea-course-mep').value.trim();
  }
  function toggleClouDetails() {
    const w = document.getElementById('ea-clou-details');
    w.hidden = !w.hidden;
    document.getElementById('ea-clou-toggle').textContent = w.hidden ? '▸ Caractéristiques du clou' : '▾ Caractéristiques du clou';
  }
  function localiserGPS() { GpsHelper.locate('ea-gps', 'ea-gps-hint', 'ea-btn-gps'); }

  /* ============================================================
     DÉROULÉ PAR PALIERS
     ============================================================ */
  function _renderRunner() {
    const e = _essai(), host = document.getElementById('ea-runner');
    const v = _verin(), prm = _draft.params;
    if (!e.paliers.length) { host.innerHTML = '<p class="empty-msg">Programme de paliers non généré : vérifiez Tmax et le vérin.</p>'; return; }

    /* Frise des paliers */
    const frise = `<div class="ar-frise">${e.paliers.map((p, i) => {
      const st = p.endedAt ? 'is-done' : (i === e.pIdx ? 'is-current' : '');
      return `<button class="ar-chip ${st} ar-chip-${p.phase}" data-p="${i}" title="${esc(p.label)}">${esc(p.code)}</button>`;
    }).join('')}</div>`;

    if (e.arret.stopped) {
      host.innerHTML = frise + `<div class="ar-warn ar-warn-bloquant">⛔ Essai interrompu — ${esc(e.arret.motif || 'motif non précisé')}.<br>Toutes les mesures saisies sont conservées ; l'essai est marqué incomplet.</div>` +
        `<button class="btn-secondary" id="ea-btn-reprendre-arret">↩︎ Annuler l'interruption et reprendre</button>`;
      _bindFrise(host);
      const b = document.getElementById('ea-btn-reprendre-arret');
      if (b) b.addEventListener('click', () => { e.arret = { stopped: false, motif: '' }; _persistLocal(); _renderRunner(); });
      return;
    }

    const p = _palierCourant();
    if (!p) { host.innerHTML = frise + '<p class="empty-msg">Programme terminé.</p>'; _bindFrise(host); return; }

    const origine = e.origine;
    const pr = ArrachementCalc.pression(p.effort, v, _etal());
    const nbC = _draft.materiel.nbComparateurs === 1 ? 1 : 2;

    /* Consigne du palier */
    let html = frise + `<div class="ar-palier ar-palier-${p.phase}${p.final ? ' ar-palier-final' : ''}">
      <div class="ar-palier-head">
        <span class="ar-palier-label">${esc(p.label)}</span>
        ${p.final ? '<span class="badge badge-nok">palier final — va toujours à son terme</span>' : ''}
      </div>
      <div class="ar-cibles">
        <div class="ar-cible"><span class="ar-cible-lbl">Effort cible</span><span class="ar-cible-val">${_f(p.effort, 1)}</span><span class="ar-cible-unit">kN</span></div>
        <div class="ar-cible ar-cible-p"><span class="ar-cible-lbl">Pression à appliquer</span><span class="ar-cible-val">${pr.bar == null ? '—' : _f(pr.bar, 0)}</span><span class="ar-cible-unit">bar</span></div>
      </div>
      <div class="ar-cible-note">± ${_f(p.toleranceEffortKN, 1)} kN · ${_f(pr.mpa, 2)} MPa · relation ${pr.source === 'etalonnage' ? 'issue de la courbe d\'étalonnage de l\'exemplaire' : 'nominale'}${pr.depasse ? ' · <span class="text-nok">⛔ au-delà de la pression maximale d\'utilisation</span>' : ''}</div>`;

    if (!p.startedAt) {
      html += `<div class="bar-note">Montez en pression jusqu'à l'effort cible (en 1 min au plus), puis démarrez le palier : le temps court à partir de l'<strong>atteinte de l'effort</strong>.</div>
        <button class="btn-primary btn-xl" id="ea-btn-start">▶️ EFFORT ATTEINT — DÉMARRER LE PALIER</button>`;
    } else {
      const ecoule = (Date.now() - p.startedAt) / 60000;
      const next = _prochaineLecture(p);
      html += `<div class="ar-chrono-bloc">
          <div class="ar-chrono"><span class="ar-chrono-lbl">Temps de palier</span><span class="ar-chrono-val" id="ea-chrono">${ArrachementCalc.mmss(ecoule * 60)}</span></div>
          <div class="ar-chrono ar-chrono-next"><span class="ar-chrono-lbl">${next ? 'Lecture t = ' + _f(next.tMin, 0) + ' min dans' : 'Toutes les lectures faites'}</span><span class="ar-chrono-val" id="ea-countdown">${next ? ArrachementCalc.mmss((next.tMin - ecoule) * 60) : '—'}</span></div>
        </div>`;

      /* Saisie de la prochaine lecture — une seule valeur réellement saisie */
      if (next) {
        const due = ecoule >= next.tMin - 0.05;
        html += `<div class="ar-saisie ${due ? 'is-due' : ''}">
          <div class="ar-saisie-titre">Lecture à t = ${_f(next.tMin, 0)} min ${due ? '<span class="ar-due">à relever maintenant</span>' : '<span class="text-muted">(en attente)</span>'}</div>
          <div class="ar-comp-row">
            <div class="field field-key"><label for="ea-c1">Comparateur 1 <small>(mm)</small></label><input id="ea-c1" class="input-key" type="number" step="0.01" inputmode="decimal" placeholder="0.00"></div>
            ${nbC === 2 ? `<div class="field field-key"><label for="ea-c2">Comparateur 2 <small>(mm)</small></label><input id="ea-c2" class="input-key" type="number" step="0.01" inputmode="decimal" placeholder="0.00"></div>` : ''}
          </div>
          <div class="field-hint">Résolution 0,01 mm.${nbC === 2 ? ' Valeur retenue = moyenne des deux ; l\'écart mesure l\'axialité du montage.' : ''}${origine != null ? ` Origine (fin du palier de serrage) : <strong>${_f(origine, 2)} mm</strong> — les déplacements affichés en sont déduits.` : (p.origine ? ' La dernière lecture de ce palier fixera l\'origine (zéro) de tous les déplacements de l\'essai.' : '')}</div>
          <button class="btn-primary btn-xl" id="ea-btn-lecture">✓ ENREGISTRER LA LECTURE</button>
        </div>`;
      }

      /* Lectures déjà faites */
      if (p.lectures.length) {
        html += `<div class="ar-lectures"><div class="section-title">Lectures</div>${p.lectures.map((l, i) => `
          <div class="ar-lecture">
            <span class="ar-l-t">t = ${_f(l.tMin, 0)} min</span>
            <span class="ar-l-brut">${nbC === 2 ? `${_f(l.c1, 2)} / ${_f(l.c2, 2)}` : _f(l.c1, 2)}</span>
            <span class="ar-l-y">${l.y == null ? '—' : _f(l.y, 2) + ' mm'}</span>
            ${l.ecart != null ? `<span class="ar-l-ec ${l.ecart > _num(prm.seuilEcartComparateursMm) ? 'text-nok' : 'text-muted'}">Δ ${_f(l.ecart, 2)}</span>` : ''}
            <span class="ar-l-ts text-muted">${_hms(l.ts)}${l.tReelMin != null ? ` (${_f(l.tReelMin, 1)} min réelles)` : ''}</span>
            ${(l.corrections && l.corrections.length) ? `<span class="badge badge-version" title="${esc(l.corrections.map(c => _hms(c.ts) + ' : ' + _f(c.y, 2) + ' mm').join(' · '))}">corrigée ×${l.corrections.length}</span>` : ''}
            <button class="ar-l-edit" data-corr="${i}" title="Corriger (la valeur d'origine est conservée)">✎</button>
          </div>`).join('')}</div>`;
        const a = ArrachementCalc.alpha(p.lectures, 1, Math.max(...p.lectures.map(ArrachementCalc.tempsLecture), 1));
        if (a != null) {
          const cf = ArrachementCalc.classeFluage(a, prm);
          html += `<div class="ar-alpha ar-alpha-${cf.classe}">α = <strong>${_f(a, 2)} mm/décade</strong> — ${esc(cf.label)}</div>`;
        }
      }

      /* Suggestion de stabilisation — jamais automatique */
      const sug = ArrachementCalc.suggestionStabilisation(p, prm);
      if (sug.suggere) {
        html += `<div class="ar-sugg">💡 ${esc(sug.raison)}<br>Passer au palier suivant ?
          <div class="ar-sugg-actions">
            <button class="btn-primary" id="ea-btn-sugg-ok">Oui, palier suivant</button>
            <button class="btn-secondary" id="ea-btn-sugg-no">Non, poursuivre le palier</button>
          </div></div>`;
      }

      /* Alertes (§7) */
      const al = ArrachementCalc.alertes(e, p, prm, v);
      if (al.length) html += al.map(x => `<div class="ar-warn ar-warn-${x.niveau}">${x.niveau === 'bloquant' ? '⛔' : '⚠️'} ${esc(x.texte)}</div>`).join('');

      const toutesFaites = !next;
      const echeance = ecoule >= p.dureeMin;
      html += `<div class="ar-actions">
        <button class="btn-primary${toutesFaites ? '' : ' is-disabled'}" id="ea-btn-next-palier" ${toutesFaites ? '' : 'disabled'}>Palier suivant →</button>
        <button class="btn-secondary" id="ea-btn-prolonger">⏱ Prolonger le palier</button>
      </div>`;
      if (echeance && !toutesFaites) {
        html += `<div class="notice-warn">Échéance normale du palier atteinte alors que toutes les lectures ne sont pas faites : prolongez le palier (l'essai sera marqué « à examiner ») ou passez à la suite en le clôturant manuellement.</div>
          <button class="btn-secondary" id="ea-btn-cloturer">Clôturer ce palier maintenant</button>`;
      }
    }
    html += `<button class="btn-secondary ar-btn-stop" id="ea-btn-stop">⛔ ARRÊTER L'ESSAI</button>`;
    html += `</div>`;
    host.innerHTML = html;

    _bindFrise(host);
    const on = (id, fn) => { const b = document.getElementById(id); if (b) b.addEventListener('click', fn); };
    on('ea-btn-start', _demarrerPalier);
    on('ea-btn-lecture', _enregistrerLecture);
    on('ea-btn-next-palier', () => _palierSuivant('echeance'));
    on('ea-btn-sugg-ok', () => _palierSuivant('stabilisation'));
    on('ea-btn-sugg-no', () => { const pp = _palierCourant(); pp.suggestionRefusee = Date.now(); _persistLocal(); _renderRunner(); });
    on('ea-btn-prolonger', _prolongerPalier);
    on('ea-btn-cloturer', () => _palierSuivant('manuel'));
    on('ea-btn-stop', arreterEssai);
    host.querySelectorAll('[data-corr]').forEach(b => b.addEventListener('click', () => _corrigerLecture(+b.dataset.corr)));
    const c1 = document.getElementById('ea-c1');
    if (c1) c1.addEventListener('keydown', ev => { if (ev.key === 'Enter') _enregistrerLecture(); });
  }
  function _bindFrise(host) {
    host.querySelectorAll('[data-p]').forEach(b => b.addEventListener('click', () => {
      const e = _essai(), i = +b.dataset.p;
      if (i > e.pIdx && !e.paliers[i - 1].endedAt) { alert('Les paliers se déroulent dans l\'ordre : clôturez le palier en cours avant de passer au suivant.'); return; }
      e.pIdx = i; _persistLocal(); _renderRunner();
    }));
  }

  function _prochaineLecture(p) {
    const faites = new Set(p.lectures.map(l => l.tMin));
    for (const t of (p.lecturesMin || [])) if (!faites.has(t)) return { tMin: t };
    return null;
  }

  async function _demarrerPalier() {
    const p = _palierCourant();
    p.startedAt = Date.now();
    _alerted = {};
    await _keepAwake();
    await _persistLocal();
    _renderRunner();
  }

  async function _enregistrerLecture() {
    const e = _essai(), p = _palierCourant();
    const next = _prochaineLecture(p);
    if (!next) return;
    const c1 = document.getElementById('ea-c1'), c2 = document.getElementById('ea-c2');
    const b = ArrachementCalc.lectureBrute(c1 ? c1.value : '', c2 ? c2.value : '');
    if (b.valeur == null) { alert('Saisissez la lecture du comparateur (mm).'); return; }
    const nbC = _draft.materiel.nbComparateurs === 1 ? 1 : 2;
    if (nbC === 2 && b.nb < 2) { alert('Deux comparateurs sont déclarés : saisissez les deux lectures (leur écart mesure l\'axialité).'); return; }

    const ts = Date.now();
    const tReelMin = p.startedAt ? (ts - p.startedAt) / 60000 : null;
    const lecture = {
      tMin: next.tMin, ts, tReelMin,
      c1: c1 ? _numOrNull(c1.value) : null, c2: c2 ? _numOrNull(c2.value) : null,
      brut: b.valeur, ecart: b.ecart, y: null, corrections: [],
      par: AuthModule.currentName(),
    };
    p.lectures.push(lecture);

    /* Le palier de serrage fixe l'origine : sa DERNIÈRE lecture est le zéro. */
    if (p.origine) {
      const o = ArrachementCalc.origineDe(e.paliers);
      if (o != null) { e.origine = o; _recalculerY(e); }
      /* Axialité contrôlée dès le palier de serrage */
      const ax = ArrachementCalc.controleAxialite(p, _draft.params.seuilEcartComparateursMm);
      if (ax.ok === false) {
        alert(`Écart entre comparateurs de ${_f(ax.ecart, 2)} mm au palier de serrage (seuil ${_f(ax.seuil, 2)} mm).\n\nPerte d'axialité probable : reprenez le montage avant de poursuivre.`);
      }
    } else {
      lecture.y = ArrachementCalc.depuisOrigine(b.valeur, e.origine);
    }
    _recalculerY(e);

    if (c1) c1.value = ''; if (c2) c2.value = '';
    _alerted[p.id + ':' + next.tMin] = true;
    await _persistLocal();
    _renderRunner();
  }
  /* Tous les déplacements sont comptés depuis le zéro pris en fin de palier de
     serrage : un changement d'origine recalcule l'ensemble des lectures. */
  function _recalculerY(e) {
    (e.paliers || []).forEach(p => (p.lectures || []).forEach(l => {
      l.y = (e.origine == null) ? null : ArrachementCalc.depuisOrigine(l.brut, e.origine);
    }));
  }

  /* Une correction est un ÉVÉNEMENT HORODATÉ qui conserve la valeur d'origine :
     aucune mesure saisie n'est jamais écrasée silencieusement (§14). */
  async function _corrigerLecture(i) {
    const e = _essai(), p = _palierCourant(), l = p.lectures[i];
    if (!l) return;
    const nbC = _draft.materiel.nbComparateurs === 1 ? 1 : 2;
    const v1 = prompt(`Correction de la lecture t = ${_f(l.tMin, 0)} min.\nComparateur 1 (mm) — valeur actuelle ${_f(l.c1, 2)} :`, l.c1 != null ? String(l.c1) : '');
    if (v1 === null) return;
    let v2 = null;
    if (nbC === 2) {
      v2 = prompt(`Comparateur 2 (mm) — valeur actuelle ${_f(l.c2, 2)} :`, l.c2 != null ? String(l.c2) : '');
      if (v2 === null) return;
    }
    const b = ArrachementCalc.lectureBrute(v1, v2);
    if (b.valeur == null) { alert('Valeur invalide : correction abandonnée.'); return; }
    const motif = prompt('Motif de la correction (conservé dans le procès-verbal) :', '') || '';
    l.corrections = l.corrections || [];
    l.corrections.push({ c1: l.c1, c2: l.c2, brut: l.brut, y: l.y, ecart: l.ecart, ts: Date.now(), remplaceeLe: Date.now(), motif, par: AuthModule.currentName() });
    l.c1 = _numOrNull(v1); l.c2 = _numOrNull(v2); l.brut = b.valeur; l.ecart = b.ecart;
    if (p.origine) { const o = ArrachementCalc.origineDe(e.paliers); if (o != null) e.origine = o; }
    _recalculerY(e);
    await _persistLocal();
    _renderRunner();
  }

  async function _palierSuivant(motif) {
    const e = _essai(), p = _palierCourant(), prm = _draft.params;
    if (!p.startedAt) { alert('Démarrez d\'abord le palier (à l\'atteinte de l\'effort cible).'); return; }
    if (p.final && motif === 'stabilisation') return;                 // exclu par construction
    if (!p.lectures.length) { alert('Enregistrez au moins une lecture avant de clôturer le palier.'); return; }
    if (p.final && _prochaineLecture(p)) {
      if (!confirm('Le palier final n\'a pas été mené à son terme : l\'essai sera classé NON RECEVABLE (programme non respecté).\n\nContinuer ?')) return;
    }
    p.endedAt = Date.now();
    p.dureeEffectiveMin = (p.endedAt - p.startedAt) / 60000;
    p.motifFin = { echeance: 'Échéance normale du palier', stabilisation: 'Anticipation sur stabilisation', prolongation: 'Fin de prolongation', manuel: 'Arrêt manuel' }[motif] || motif;
    p.seuilApplique = prm.stabilisationActive ? prm.seuilStabMmParMin : null;
    p.alpha = ArrachementCalc.alpha(p.lectures, 1, Math.max(...p.lectures.map(ArrachementCalc.tempsLecture), 1));
    if (e.pIdx < e.paliers.length - 1) { e.pIdx++; _alerted = {}; }
    else { await _releaseWake(); }
    await _persistLocal();
    _renderRunner();
    if (e.pIdx === e.paliers.length - 1 && e.paliers[e.pIdx].endedAt) afficherResultats();
  }

  async function _prolongerPalier() {
    const p = _palierCourant();
    const sup = parseFloat(prompt('Prolonger le palier de combien de minutes ?', '5'));
    if (!(sup > 0)) return;
    p.dureeMin = _num(p.dureeMin) + sup;
    const dernier = Math.max(...(p.lecturesMin || [0]));
    for (let t = dernier + 1; t <= p.dureeMin; t++) if (!p.lecturesMin.includes(t)) p.lecturesMin.push(t);
    p.lecturesMin.sort((a, b) => a - b);
    p.prolonge = true;
    p.motifProlongation = 'Critère de stabilisation non atteint à l\'échéance normale — essai marqué « à examiner ».';
    await _persistLocal();
    _renderRunner();
  }

  async function arreterEssai() {
    const e = _essai();
    const liste = MOTIFS_ARRET.map((m, i) => `${i + 1}. ${m}`).join('\n');
    const rep = prompt(`Arrêter l'essai en cours.\n\nMotif :\n${liste}\n\nNuméro du motif :`, '');
    if (rep === null) return;
    let motif = MOTIFS_ARRET[parseInt(rep) - 1] || '';
    if (!motif || motif.startsWith('Autre')) {
      motif = prompt('Précisez le motif de l\'arrêt :', motif.startsWith('Autre') ? '' : rep) || rep;
    }
    if (!motif) return;
    e.arret = { stopped: true, motif, ts: Date.now(), par: AuthModule.currentName() };
    const p = _palierCourant();
    if (p && p.startedAt && !p.endedAt) {
      p.endedAt = Date.now();
      p.dureeEffectiveMin = (p.endedAt - p.startedAt) / 60000;
      p.motifFin = 'Arrêt de l\'essai — ' + motif;
    }
    await _releaseWake();
    await _persistLocal();
    _renderRunner();
    alert('Essai interrompu. Toutes les mesures saisies sont conservées ; l\'essai est marqué incomplet avec son motif. Il n\'est jamais supprimé.');
  }

  /* ---- Compte à rebours : recalculé depuis des horodatages ABSOLUS, donc
     insensible à la mise en arrière-plan de l'application. ---- */
  function _startTicker() {
    if (_tickId) clearInterval(_tickId);
    _tickId = setInterval(_tick, 1000);
  }
  function _stopTicker() { if (_tickId) { clearInterval(_tickId); _tickId = null; } }
  function _tick() {
    const scr = document.getElementById('screen-ar-essai');
    if (!scr || !scr.classList.contains('is-active')) return;
    if (!_draft || !_draft.essais) return;
    const e = _draft.essais[_esIdx]; if (!e) return;
    const p = e.paliers && e.paliers[e.pIdx];
    if (!p || !p.startedAt || p.endedAt) return;
    const ecoule = (Date.now() - p.startedAt) / 60000;
    const chrono = document.getElementById('ea-chrono');
    if (chrono) chrono.textContent = ArrachementCalc.mmss(ecoule * 60);
    const next = _prochaineLecture(p);
    const cd = document.getElementById('ea-countdown');
    if (cd) cd.textContent = next ? ArrachementCalc.mmss(Math.max(0, (next.tMin - ecoule) * 60)) : '—';
    if (next && ecoule >= next.tMin) {
      const key = p.id + ':' + next.tMin;
      if (!_alerted[key]) { _alerted[key] = true; _alerteLecture(next.tMin); _renderRunner(); }
    }
  }
  /* Le technicien a les mains occupées : vibration + bip à chaque temps de lecture. */
  function _alerteLecture(t) {
    try { if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 400]); } catch (_) {}
    try {
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      const o = ac.createOscillator(), g = ac.createGain();
      o.frequency.value = 880; o.connect(g); g.connect(ac.destination);
      g.gain.setValueAtTime(0.2, ac.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.8);
      o.start(); o.stop(ac.currentTime + 0.8);
    } catch (_) {}
  }
  async function _keepAwake() {
    try { if ('wakeLock' in navigator && !_wakeLock) _wakeLock = await navigator.wakeLock.request('screen'); } catch (_) {}
  }
  async function _releaseWake() { try { if (_wakeLock) { await _wakeLock.release(); _wakeLock = null; } } catch (_) {} }

  /* ============================================================
     PHOTOS (§10)
     ============================================================ */
  async function prendrePhoto(moment) {
    const input = document.getElementById('ea-photo-input');
    input.dataset.moment = moment;
    input.value = '';
    input.click();
  }
  async function onPhotoSelected(file, moment) {
    if (!file) return;
    const e = _essai();
    try {
      const dataUrl = await _compresser(file, 1280, 0.62);
      const geo = await _geoRapide();
      const id = `${_draft.ref}#${e.n}#${Date.now()}`;
      const ph = { id, ref: _draft.ref, essaiN: e.n, moment, ts: Date.now(), geo, dataUrl };
      await CAEKDB.savePhoto(ph);
      e.photos.push({ id, moment, ts: ph.ts, geo });
      await _persistLocal();
      await _renderPhotos();
    } catch (err) { alert('Photo non enregistrée : ' + err.message); }
  }
  function _compresser(file, maxPx, q) {
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onerror = () => rej(new Error('lecture impossible'));
      fr.onload = () => {
        const img = new Image();
        img.onerror = () => rej(new Error('image illisible'));
        img.onload = () => {
          const r = Math.min(1, maxPx / Math.max(img.width, img.height));
          const cv = document.createElement('canvas');
          cv.width = Math.round(img.width * r); cv.height = Math.round(img.height * r);
          cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
          res(cv.toDataURL('image/jpeg', q));
        };
        img.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  }
  function _geoRapide() {
    return new Promise(res => {
      if (!navigator.geolocation) return res('');
      navigator.geolocation.getCurrentPosition(
        p => res(`${p.coords.latitude.toFixed(6)}, ${p.coords.longitude.toFixed(6)}`),
        () => res(''), { enableHighAccuracy: false, timeout: 5000, maximumAge: 60000 });
    });
  }
  async function _renderPhotos() {
    const e = _essai(), host = document.getElementById('ea-photos');
    const stored = await CAEKDB.getPhotosOf(_draft.ref, e.n);
    const byId = new Map(stored.map(p => [p.id, p]));
    const manquants = MOMENTS.filter(m => !e.photos.some(p => p.moment === m.code));
    host.innerHTML =
      (manquants.length ? `<div class="notice-warn">Photos attendues manquantes : ${manquants.map(m => esc(m.label)).join(', ')}.</div>` : '') +
      (e.photos.length
        ? `<div class="ar-photos">${e.photos.map(p => {
            const s = byId.get(p.id);
            const lbl = (MOMENTS.find(m => m.code === p.moment) || {}).label || (p.moment === 'anomalie' ? 'Anomalie' : 'Libre');
            return `<figure class="ar-photo">
              ${s ? `<img src="${s.dataUrl}" alt="${esc(lbl)}" loading="lazy">` : '<div class="ar-photo-missing">image absente</div>'}
              <figcaption>${esc(lbl)}<br><small>${_hms(p.ts)}${p.geo ? ' · ' + esc(p.geo) : ''}</small></figcaption>
              <button class="ar-photo-del" data-photo="${esc(p.id)}" title="Supprimer">✕</button>
            </figure>`;
          }).join('')}</div>`
        : '<p class="empty-msg">Aucune photo.</p>');
    host.querySelectorAll('[data-photo]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Supprimer cette photo ?')) return;
      const id = b.dataset.photo;
      await CAEKDB.deletePhoto(id);
      e.photos = e.photos.filter(p => p.id !== id);
      await _persistLocal(); await _renderPhotos();
    }));
  }

  /* ============================================================
     ANOMALIES (§9) — signalables à tout moment, sans quitter l'essai
     ============================================================ */
  function ouvrirAnomalie() {
    const m = document.getElementById('ar-anomalie-modal');
    const sel = document.getElementById('ar-ano-type');
    sel.innerHTML = ArrachementCalc.ANOMALIES.map(a => `<option value="${a.code}">${esc(a.label)} — ${esc(a.effet)}</option>`).join('');
    document.getElementById('ar-ano-desc').value = '';
    document.getElementById('ar-ano-gravite').value = 'majeure';
    onAnomalieType();
    m.hidden = false;
  }
  function fermerAnomalie() { document.getElementById('ar-anomalie-modal').hidden = true; }
  function onAnomalieType() {
    const def = ArrachementCalc.anomalieDef(document.getElementById('ar-ano-type').value);
    document.getElementById('ar-ano-hint').innerHTML = def
      ? `${esc(def.detail)}.<br><strong>Effet sur l'essai :</strong> ${esc(def.effet)}.` : '';
  }
  async function validerAnomalie() {
    const e = _essai(), p = _palierCourant();
    const type = document.getElementById('ar-ano-type').value;
    const desc = document.getElementById('ar-ano-desc').value.trim();
    const gravite = document.getElementById('ar-ano-gravite').value;
    if (!type) return;
    const def = ArrachementCalc.anomalieDef(type);
    e.anomalies.push({
      id: 'A' + Date.now(), type, gravite, desc, ts: Date.now(),
      palierId: p ? p.id : '', palierCode: p ? p.code : '',
      effet: def ? def.effet : '', par: AuthModule.currentName(), photos: [],
    });
    fermerAnomalie();
    await _persistLocal();
    _renderAnomalies();
    if (def && (def.classe === 'non_recevable' || def.classe === 'non_realise')) {
      alert(`${def.label} enregistrée.\n\n${def.effet}. L'essai reste enregistré avec toutes ses mesures ; il sera classé « ${ArrachementCalc.CLASSES[def.classe].label} » à la clôture.`);
    }
    if (type === 'irrealisable') {
      const sub = prompt('Clou de substitution à désigner (repère) :', '');
      if (sub) { e.clouSubstitution = sub.trim(); await _persistLocal(); _renderAnomalies(); }
    }
  }
  function _renderAnomalies() {
    const e = _essai(), host = document.getElementById('ea-anomalies');
    if (!e.anomalies.length) { host.innerHTML = '<p class="empty-msg">Aucune anomalie signalée.</p>'; return; }
    host.innerHTML = e.anomalies.map(a => {
      const def = ArrachementCalc.anomalieDef(a.type);
      return `<div class="ar-ano ar-ano-${a.gravite}">
        <div class="ar-ano-head"><strong>${esc(def ? def.label : a.type)}</strong><span class="badge">${esc(a.gravite)}</span></div>
        <div class="ar-ano-meta text-muted">${_hms(a.ts)}${a.palierCode ? ' · palier ' + esc(a.palierCode) : ''} · ${esc(a.par || '')}</div>
        ${a.desc ? `<div class="ar-ano-desc">${esc(a.desc)}</div>` : ''}
        <div class="ar-ano-effet">${esc(a.effet || '')}</div>
        <div class="ar-ano-actions">
          <button class="rep-btn" data-ano-photo="${esc(a.id)}">📷 Photo</button>
          <button class="rep-btn rep-btn-del" data-ano-del="${esc(a.id)}">🗑️</button>
        </div>
      </div>`;
    }).join('') + (e.clouSubstitution ? `<div class="notice-warn">Clou de substitution désigné : <strong>${esc(e.clouSubstitution)}</strong>.</div>` : '');
    host.querySelectorAll('[data-ano-photo]').forEach(b => b.addEventListener('click', () => {
      const input = document.getElementById('ea-photo-input');
      input.dataset.moment = 'anomalie'; input.dataset.anomalie = b.dataset.anoPhoto; input.value = ''; input.click();
    }));
    host.querySelectorAll('[data-ano-del]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Retirer cette anomalie ?')) return;
      e.anomalies = e.anomalies.filter(a => a.id !== b.dataset.anoDel);
      await _persistLocal(); _renderAnomalies();
    }));
  }

  /* ============================================================
     RÉSULTATS / CLÔTURE
     ============================================================ */
  function afficherResultats() {
    _collectIdent();
    const e = _essai(), prm = _draft.params;
    const cl = ArrachementCalc.classer(e, prm);
    const r = cl.resultats || ArrachementCalc.compute(e, prm);
    const box = document.getElementById('ea-results');
    document.getElementById('ea-results-body').innerHTML = `
      <div class="res-head"><div class="res-head-title">Clou ${esc(e.clou.repere || e.n)}${e.clou.zone ? ' — ' + esc(e.clou.zone) : ''}</div>
        <div class="res-head-date">${_draft.typeEssai === 'prealable' ? 'Essai préalable' : 'Essai de contrôle'} · Tmax ${_f(_num(_draft.tmax), 0)} kN</div></div>
      <div class="res-lines">
        <div class="res-line"><span class="res-line-k">y à Tmax =</span><span class="res-line-v">${_f(r.yTmax, 2)} <small>mm</small></span></div>
        <div class="res-line res-line-strong"><span class="res-line-k">α =</span><span class="res-line-v">${_f(r.alpha, 2)} <small>mm/décade</small></span></div>
        <div class="res-line"><span class="res-line-k">y rémanent =</span><span class="res-line-v">${_f(r.remanentFinal != null ? r.remanentFinal : r.remanentPa, 2)} <small>mm</small></span></div>
      </div>
      <div class="res-note">${esc(r.fluage.texte)} Origine des déplacements : fin du palier de serrage (${_f(e.origine, 2)} mm brut).</div>
      <div class="conf-global ${_classeCss(cl.classe)}">${esc(cl.label)}</div>
      ${cl.motifs.length ? `<ul class="ar-motifs">${cl.motifs.map(m => `<li>${esc(m)}</li>`).join('')}</ul>` : ''}
      <div class="curve-host">${_svgEffortDeplacement(e)}</div>
      <div class="curve-caption">Courbe effort — déplacement (points de fin de palier ; chargement et déchargement)</div>
      <div class="curve-host">${_svgFluage(e, prm)}</div>
      <div class="curve-caption">Déplacement — temps en échelle logarithmique sur le palier final, avec la pente de fluage α</div>
      <button class="btn-secondary" id="ea-btn-reclasser">✎ Modifier le classement (avec justification)</button>`;
    box.hidden = false;
    document.getElementById('ea-btn-next').hidden = false;
    const rb = document.getElementById('ea-btn-reclasser');
    if (rb) rb.addEventListener('click', () => _reclasser(cl));
    e.result = { yTmax: r.yTmax, yMax: r.yMax, alpha: r.alpha, remanentPa: r.remanentPa,
                 remanentFinal: r.remanentFinal, classe: e.classeManuelle || cl.classe,
                 classeAuto: cl.classe, motifs: cl.motifs, justification: e.justificationClasse || '' };
    box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function _classeCss(c) {
    return { satisfaisant: 'conf-global-ok', examiner: 'ar-classe-examiner', signaler: 'ar-classe-signaler',
             non_recevable: 'conf-global-nok', non_realise: 'ar-classe-nonrealise' }[c] || '';
  }
  function _reclasser(cl) {
    const e = _essai();
    const codes = Object.keys(ArrachementCalc.CLASSES);
    const liste = codes.map((c, i) => `${i + 1}. ${ArrachementCalc.CLASSES[c].label}`).join('\n');
    const rep = prompt(`Classement automatique : ${cl.label}\n\nNouveau classement :\n${liste}\n\nNuméro :`, '');
    if (rep === null) return;
    const c = codes[parseInt(rep) - 1];
    if (!c) return;
    const just = prompt('Justification (obligatoire, conservée dans le procès-verbal) :', '');
    if (!just || !just.trim()) { alert('Justification obligatoire : classement inchangé.'); return; }
    e.classeManuelle = c; e.justificationClasse = just.trim();
    e.classeParar = AuthModule.currentName(); e.classeLe = Date.now();
    _persistLocal().then(() => afficherResultats());
  }

  /* ---- Courbes ---- */
  function _svgEffortDeplacement(e) {
    const pts = ArrachementCalc.courbeEffortDeplacement(e).filter(p => p.y != null);
    if (pts.length < 2) return '<p class="empty-msg">Courbe disponible dès deux paliers clôturés.</p>';
    const W = 320, H = 220, m = { l: 42, r: 10, t: 12, b: 32 };
    const ys = pts.map(p => p.y), fs = pts.map(p => p.effort);
    const ymin = Math.min(0, ...ys), ymax = Math.max(...ys, 0.01);
    const fmax = Math.max(...fs, 1);
    const X = y => m.l + (y - ymin) / (ymax - ymin || 1) * (W - m.l - m.r);
    const Y = f => H - m.b - (f / fmax) * (H - m.t - m.b);
    const charge = pts.filter(p => p.phase === 'serrage' || p.phase === 'chargement' || p.phase === 'final');
    const dech = pts.filter(p => p.phase === 'dechargement' || p.phase === 'retour' || p.phase === 'zero');
    const path = l => l.map((p, i) => `${i ? 'L' : 'M'}${X(p.y).toFixed(1)},${Y(p.effort).toFixed(1)}`).join(' ');
    const dots = (l, c) => l.map(p => `<circle cx="${X(p.y).toFixed(1)}" cy="${Y(p.effort).toFixed(1)}" r="3.2" fill="${c}"/>`).join('');
    const gridY = [0, 0.25, 0.5, 0.75, 1].map(f => {
      const yy = Y(f * fmax);
      return `<line x1="${m.l}" y1="${yy}" x2="${W - m.r}" y2="${yy}" stroke="#eee"/><text x="${m.l - 5}" y="${yy + 4}" text-anchor="end" font-size="9" fill="#888">${(f * fmax).toFixed(0)}</text>`;
    }).join('');
    const gridX = [0, 0.5, 1].map(f => {
      const yv = ymin + f * (ymax - ymin), xx = X(yv);
      return `<line x1="${xx}" y1="${m.t}" x2="${xx}" y2="${H - m.b}" stroke="#eee"/><text x="${xx}" y="${H - m.b + 13}" text-anchor="middle" font-size="9" fill="#888">${yv.toFixed(1)}</text>`;
    }).join('');
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Courbe effort déplacement">
      ${gridY}${gridX}
      <line x1="${m.l}" y1="${H - m.b}" x2="${W - m.r}" y2="${H - m.b}" stroke="#bbb"/>
      <line x1="${m.l}" y1="${m.t}" x2="${m.l}" y2="${H - m.b}" stroke="#bbb"/>
      <path d="${path(charge)}" fill="none" stroke="#CC0000" stroke-width="2"/>
      <path d="${path(dech)}" fill="none" stroke="#0b5394" stroke-width="2" stroke-dasharray="4 3"/>
      ${dots(charge, '#CC0000')}${dots(dech, '#0b5394')}
      <text x="${(W) / 2}" y="${H - 4}" text-anchor="middle" font-size="10" fill="#555">Déplacement y (mm)</text>
      <text x="10" y="${(H - m.b) / 2}" font-size="10" fill="#555" transform="rotate(-90 10 ${(H - m.b) / 2})" text-anchor="middle">Effort (kN)</text>
    </svg>`;
  }
  function _svgFluage(e, prm) {
    const pf = ArrachementCalc.palierFinal(e);
    const L = ((pf && pf.lectures) || []).filter(l => l.y != null && ArrachementCalc.tempsLecture(l) > 0);
    if (L.length < 2) return '<p class="empty-msg">Courbe de fluage disponible après le palier final.</p>';
    const W = 320, H = 200, m = { l: 42, r: 10, t: 12, b: 32 };
    const ts = L.map(ArrachementCalc.tempsLecture), ys = L.map(l => l.y);
    const lmin = Math.log10(Math.min(...ts)), lmax = Math.log10(Math.max(...ts));
    const ymin = Math.min(...ys), ymax = Math.max(...ys);
    const X = t => m.l + (Math.log10(t) - lmin) / ((lmax - lmin) || 1) * (W - m.l - m.r);
    const Y = y => H - m.b - (y - ymin) / ((ymax - ymin) || 1) * (H - m.t - m.b);
    const path = L.map((l, i) => `${i ? 'L' : 'M'}${X(ArrachementCalc.tempsLecture(l)).toFixed(1)},${Y(l.y).toFixed(1)}`).join(' ');
    const dots = L.map(l => `<circle cx="${X(ArrachementCalc.tempsLecture(l)).toFixed(1)}" cy="${Y(l.y).toFixed(1)}" r="3.2" fill="#CC0000"/>`).join('');
    const a = ArrachementCalc.alpha(pf.lectures, 1, Math.max(...ts));
    let pente = '';
    if (a != null) {
      const t1 = Math.min(...ts), t2 = Math.max(...ts);
      const l1 = L.reduce((b, l) => Math.abs(ArrachementCalc.tempsLecture(l) - t1) < Math.abs(ArrachementCalc.tempsLecture(b) - t1) ? l : b, L[0]);
      const y2 = l1.y + a * Math.log10(t2 / t1);
      pente = `<line x1="${X(t1).toFixed(1)}" y1="${Y(l1.y).toFixed(1)}" x2="${X(t2).toFixed(1)}" y2="${Y(y2).toFixed(1)}" stroke="#0b5394" stroke-width="1.5" stroke-dasharray="5 3"/>
        <text x="${W - m.r - 4}" y="${m.t + 12}" text-anchor="end" font-size="10" fill="#0b5394">α = ${_f(a, 2)} mm/décade</text>`;
    }
    const ticks = ts.filter((t, i, arr) => arr.indexOf(t) === i).map(t =>
      `<text x="${X(t).toFixed(1)}" y="${H - m.b + 13}" text-anchor="middle" font-size="9" fill="#888">${t < 1 ? t.toFixed(1) : t.toFixed(0)}</text>`).join('');
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Courbe de fluage">
      <line x1="${m.l}" y1="${H - m.b}" x2="${W - m.r}" y2="${H - m.b}" stroke="#bbb"/>
      <line x1="${m.l}" y1="${m.t}" x2="${m.l}" y2="${H - m.b}" stroke="#bbb"/>
      <text x="${m.l - 5}" y="${Y(ymax) + 4}" text-anchor="end" font-size="9" fill="#888">${ymax.toFixed(2)}</text>
      <text x="${m.l - 5}" y="${Y(ymin) + 4}" text-anchor="end" font-size="9" fill="#888">${ymin.toFixed(2)}</text>
      ${pente}<path d="${path}" fill="none" stroke="#CC0000" stroke-width="2"/>${dots}${ticks}
      <text x="${W / 2}" y="${H - 4}" text-anchor="middle" font-size="10" fill="#555">Temps (min, échelle log)</text>
    </svg>`;
  }

  async function enregistrerEtSuivant() {
    const e = _essai();
    if (!e.result) { alert('Affichez d\'abord les résultats.'); return; }
    _collectIdent();
    const pf = ArrachementCalc.palierFinal(e);
    const complet = !!(pf && pf.endedAt) && !e.arret.stopped;
    const irrealisable = e.anomalies.some(a => a.type === 'irrealisable');
    if (!complet && !irrealisable) {
      if (!confirm('Le programme n\'a pas été mené à son terme.\nL\'essai sera enregistré comme INCOMPLET, avec toutes ses mesures.\n\nContinuer ?')) return;
    }
    e.done = true;
    e.incomplet = !complet && !irrealisable;
    if (e.meteo && !_draft.meteo) _draft.meteo = e.meteo;
    await _releaseWake();
    const allDone = _countDone() >= _draft.nbEssais;
    _draft.statut = allDone ? 'brouillon' : 'incomplet';
    await _persist();
    if (allDone) {
      _stopTicker();
      alert(`Campagne ${_draft.ref} terminée (brouillon).\nValidez-la depuis le Répertoire pour l'envoyer définitivement au bureau.`);
      AppNav.goto('screen-repertoire'); RepertoireModule.load();
    } else {
      _esIdx = _firstUnfinished();
      await _renderEssai();
    }
  }
  function _countDone() { return (_draft.essais || []).filter(e => e && e.done).length; }

  async function suspendre() {
    if (!confirm('Suspendre la campagne ? Toutes les mesures saisies sont enregistrées, y compris le palier en cours.')) return;
    _collectIdent();
    _stopTicker(); await _releaseWake();
    _draft.statut = (_countDone() >= _draft.nbEssais) ? 'brouillon' : 'incomplet';
    await _persist();
    AppNav.goto('screen-repertoire'); RepertoireModule.load();
  }

  /* Sauvegarde locale silencieuse : un essai en cours ne doit jamais être perdu,
     y compris si l'appli est fermée ou le téléphone verrouillé pendant un palier. */
  function autosave() {
    if (!_draft || !_draft.ref) return;
    try { _collectIdent(); } catch (_) {}
    _draft.statut = (_countDone() >= _draft.nbEssais) ? 'brouillon' : 'incomplet';
    _draft.updatedAt = Date.now();
    _draft.operateur = AuthModule.currentName();
    try { CAEKDB.saveCampagne(_draft); } catch (_) {}
  }

  async function _persistLocal() {
    if (!_draft || !_draft.ref) return;
    _draft.updatedAt = Date.now();
    _draft.operateur = AuthModule.currentName();
    await CAEKDB.saveCampagne(_draft);
  }
  async function _persist() {
    await _persistLocal();
    const chk = await AuthModule.ensureValid();
    if (!chk.ok) return;
    const payload = FicheModule.buildArrachement(_draft);
    await SyncModule.sendFiche('save', _draft.ref, 'arrachement', payload);
  }

  /* ============================================================
     Utilitaires
     ============================================================ */
  function _todayDate() { return new Date().toISOString().slice(0, 10); }
  function _nowTime() { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }
  function _hms(ts) { if (!ts) return '—'; const d = new Date(ts); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`; }
  function _num(v) { if (v === '' || v == null) return NaN; return parseFloat(String(v).replace(',', '.')); }
  function _numOrNull(v) { const x = _num(v); return isNaN(x) ? null : x; }
  function _f(v, d) { return ArrachementCalc.fmt(v, d); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  return {
    nouvelle, reprendre, nextStep, prevStep,
    setProjetMode, onSelClient, onSelProjet, onCodeInput, toggleRefManuelle,
    setTypeEssai, togglePartie, onNbSelect,
    setMesureEffort, setNbComparateurs, toggleEtalonnage, onMaterielChange,
    toggleStabilisation, onProgrammeChange,
    checkSecurite, commencerTest,
    toggleClouDetails, localiserGPS, prendrePhoto, onPhotoSelected,
    ouvrirAnomalie, fermerAnomalie, onAnomalieType, validerAnomalie,
    afficherResultats, enregistrerEtSuivant, suspendre, autosave, arreterEssai,
    CHECKLIST, METEOS, MOMENTS,
  };
})();
