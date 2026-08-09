'use strict';
/* ============================================================
   MODULE ARRACHEMENT — même parcours que le contrôle photovoltaïque :

     assistant 3 étapes  ->  PLAN DES TALUS  ->  TALUS  ->  ESSAI

   Une campagne = un ouvrage découpé en TALUS, chacun avec sa propre
   quantité de clous prévue : les talus n'ont pas la même taille.
   Un essai = un clou testé, rattaché à son talus par `talusId` (jamais
   par index : réorganiser le plan ne déplace ni les quotas ni l'historique).

   Principes de robustesse repris de CFMS :
   - l'essai en cours vit dans _draft.enCours, donc persisté par CHAQUE
     save() : une fermeture d'appli ne perd jamais un palier ;
   - le temps d'un palier court sur des HORODATAGES ABSOLUS, l'appli peut
     être fermée ou le téléphone verrouillé pendant un palier ;
   - un palier chargé la veille n'est plus sous charge : à la reprise, on
     laisse l'opérateur trancher plutôt que de faire semblant ;
   - le chrono ne touche que le texte du compteur ; le bloc de saisie n'est
     reconstruit que sur changement d'état, sinon les champs seraient
     détruits sous les doigts de l'opérateur.

   Le PROGRAMME (paliers, durées, temps de lecture, seuils) est normatif et
   vit dans ArrachementCalc. Il est recopié dans la campagne à sa création ;
   une case à cocher permet de l'ajuster, et tout écart est tracé.
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
    { code: 'avant',      label: 'Avant essai' },
    { code: 'dispositif', label: 'Dispositif en place' },
    { code: 'apres',      label: 'Après essai' },
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

  const STEPS = ['projet', 'campagne', 'materiel'];
  const TOLERANCE_REPRISE_S = 300;     // au-delà, un palier interrompu n'est plus valable

  let _draft = null, _step = 0, _projMode = 'client';
  let _talusId = null, _organise = false, _selId = null;
  let _tickId = null, _wakeLock = null, _alerted = {};
  let _photoCible = 'essai', _photoMoment = '';

  /* ============================================================
     CRÉATION / REPRISE
     ============================================================ */
  function nouvelle() {
    _draft = {
      type: 'arrachement', ref: '', version: 1,
      codeProjet: '', client: '', entreprise: {}, nomProjet: '', lieu: '', auto: 'Non',
      typeEssai: 'controle', tmax: '', ouvrage: '', meteo: '',
      talus: [],
      clouType: { diamBarre: '', diamForage: '', longueurTotale: '', longueurScellee: '',
                  longueurTete: '', inclinaison: '', nuanceAcier: '', dateInjection: '' },
      materiel: {
        verin: '', diamAccessoire: '', courseMiseEnPlaceMm: '',
        mesureEffort: 'manometre', serieEffort: '', etalonnageEffort: '',
        etalA: '', etalB: '', etalUtilisee: false,
        nbComparateurs: 2, serieComp1: '', serieComp2: '', etalonnageComp: '',
      },
      params: ArrachementCalc.programme('controle'),
      paramsPerso: false,
      checklist: {}, securiteOk: false,
      enCours: null, essais: [],
      statut: 'incomplet', createdAt: Date.now(),
    };
    _step = 0; _projMode = 'client'; _talusId = null; _organise = false; _selId = null;
    _initChecklist(); _renderStep();
    AppNav.goto('screen-ar-nouveau');
  }

  async function reprendre(ref) {
    const c = await CAEKDB.getCampagne(ref);
    if (!c) return;
    if (c.statut === 'valide') { alert('Cette campagne est validée et ne peut plus être modifiée.'); return; }
    _draft = JSON.parse(JSON.stringify(c));
    _draft.talus    = _draft.talus    || [];
    _draft.essais   = _draft.essais   || [];
    _draft.materiel = _draft.materiel || {};
    _draft.clouType = _draft.clouType || {};
    _draft.params   = _draft.params   || ArrachementCalc.programme(_draft.typeEssai);
    _draft.checklist = _draft.checklist || {};
    _organise = false; _selId = null; _alerted = {};
    _initChecklist();

    /* Reprise d'un essai en cours : on ne repasse pas par l'assistant. */
    if (_draft.enCours) {
      _talusId = _draft.enCours.talusId;
      if (!(await _verifierPalierRepris())) return;
      await _renderEssai();
      AppNav.goto('screen-ar-essai');
      return;
    }
    if (_draft.talus.length) { renderPlan(); AppNav.goto('screen-ar-plan'); return; }
    _step = 0; _renderStep(); AppNav.goto('screen-ar-nouveau');
  }

  /* Un palier chargé la veille n'est plus sous charge : il ne peut pas
     simplement « continuer ». On laisse l'opérateur trancher. */
  async function _verifierPalierRepris() {
    const e = _draft.enCours, p = e && e.paliers && e.paliers[e.pIdx];
    if (!p || !p.startedAt || p.endedAt) return true;
    const ecoule = (Date.now() - p.startedAt) / 1000;
    if (ecoule <= _num(p.dureeMin) * 60 + TOLERANCE_REPRISE_S) return true;

    const msg = `Le palier « ${p.label} » a été chargé il y a ${_dureeLisible(ecoule)}.\n\n`
      + 'La charge n\'est plus maintenue : ce palier ne peut pas être poursuivi.\n\n'
      + 'OK      = reprendre CE clou depuis le début (lectures effacées)\n'
      + 'Annuler = marquer l\'essai non exploitable et revenir au plan';
    if (confirm(msg)) {
      e.paliers = ArrachementCalc.genererPaliers(_tmax(), _draft.params, _verin(), _etal());
      e.pIdx = 0; e.origine = null;
      await _persistLocal();
      return true;
    }
    e.arret = { stopped: true, motif: 'Palier interrompu — charge relâchée avant la fin', ts: Date.now(), par: AuthModule.currentName() };
    e.incomplet = true;
    await _cloturerEssai(false);
    renderPlan();
    AppNav.goto('screen-ar-plan');
    return false;
  }
  function _dureeLisible(sec) {
    const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
    return h ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`;
  }

  /* ============================================================
     ASSISTANT — 3 étapes
     ============================================================ */
  function _renderStep() {
    STEPS.forEach((s, i) => { const el = document.getElementById('na-step-' + s); if (el) el.hidden = (i !== _step); });
    document.querySelectorAll('#na-stepper .step-item').forEach((it, i) => {
      it.classList.toggle('is-active', i === _step); it.classList.toggle('is-done', i < _step);
    });
    document.getElementById('na-btn-prev').hidden = (_step === 0);
    document.getElementById('na-btn-next').textContent = (_step === STEPS.length - 1) ? 'Créer la campagne' : 'Suivant →';
    /* Le panneau de programme est un repli de l'étape « Campagne », pas une
       étape : il ne doit apparaître que là, et seulement si la case est cochée. */
    const prog = document.getElementById('na-step-programme');
    if (prog) prog.hidden = !(_step === 1 && _draft.paramsPerso);
    if (_step === 0) _fillProjet();
    if (_step === 1) _fillCampagne();
    if (_step === 2) _fillMateriel();
  }
  async function nextStep() {
    if (!await _validateStep()) return;
    await _collectStep();
    if (_step < STEPS.length - 1) { _step++; _renderStep(); return; }
    await creerCampagne();
  }
  async function prevStep() { await _collectStep(); if (_step > 0) { _step--; _renderStep(); } }

  async function _validateStep() {
    if (_step === 0) {
      const code = _readSelectedCode();
      if (!code) { alert(_projMode === 'client' ? 'Sélectionnez le client puis le projet.' : 'Saisissez le code du projet.'); return false; }
      const p = await Referentiel.getProjet(code);
      if (!p || p.actif === false) { alert('Projet inconnu ou inactif. Ajoutez/activez-le dans Admin → Projets.'); return false; }
    }
    if (_step === 1) {
      if (!(_num(document.getElementById('na-tmax').value) > 0)) { alert('Indiquez la tension d\'épreuve Tmax, en kN.'); return false; }
      if (!document.getElementById('na-ouvrage').value.trim()) { alert('Indiquez l\'ouvrage testé.'); return false; }
      _collectCampagne();
      if (!_draft.talus.length) { alert('Définissez au moins un talus.'); return false; }
      if (_draft.talus.some(t => !(t.nbPrevu >= 1))) { alert('Chaque talus doit prévoir au moins un clou.'); return false; }
      const trop = _draft.talus.find(t => t.nbPrevu < t.nbFait);
      if (trop) { alert(`${trop.id} : ${trop.nbFait} essai(s) déjà réalisé(s), la quantité prévue ne peut pas être réduite en dessous.`); return false; }
    }
    if (_step === 2) {
      if (!document.getElementById('na-verin').value) { alert('Sélectionnez le modèle de vérin : il détermine la pression à appliquer à chaque palier.'); return false; }
      _collectMateriel();
      const bloquants = ArrachementCalc.controlerMontage(_montageParams()).filter(x => x.niveau === 'bloquant');
      if (bloquants.length) { alert('Montage impossible en l\'état :\n\n• ' + bloquants.map(x => x.texte).join('\n• ')); return false; }
      if (_etalonnagePerime() &&
          !confirm('Un appareil de mesure est hors validité d\'étalonnage.\n\nSi vous poursuivez, la campagne sera marquée « étalonnage périmé » et les essais seront classés NON RECEVABLES.\n\nPoursuivre quand même ?')) return false;
    }
    return true;
  }
  async function _collectStep() {
    if (_step === 0) await _collectProjet();
    if (_step === 1) _collectCampagne();
    if (_step === 2) _collectMateriel();
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
     ÉTAPE 2 — CAMPAGNE : tension, talus et quantités, clou type
     ============================================================ */
  function _fillCampagne() {
    setTypeEssai(_draft.typeEssai || 'controle', true);
    document.getElementById('na-tmax').value = _draft.tmax || '';
    document.getElementById('na-ouvrage').value = _draft.ouvrage || '';
    document.getElementById('na-cycles').value = String(_draft.params.nbCycles || 1);
    const c = _draft.clouType;
    _v('na-ct-barre', c.diamBarre); _v('na-ct-forage', c.diamForage);
    _v('na-ct-lt', c.longueurTotale); _v('na-ct-ls', c.longueurScellee);
    _v('na-ct-tete', c.longueurTete); _v('na-ct-incl', c.inclinaison);
    _v('na-ct-nuance', c.nuanceAcier); _v('na-ct-injection', c.dateInjection);
    document.getElementById('na-params-perso').checked = !!_draft.paramsPerso;
    if (!_draft.talus.length) _syncTalus(3);
    document.getElementById('na-nb-talus').value = _draft.talus.length;
    _renderTalusList();
    _fillProgramme();
  }
  function setTypeEssai(t, silencieux) {
    const change = _draft.typeEssai !== t;
    _draft.typeEssai = t;
    document.getElementById('na-type-prealable').classList.toggle('is-active', t === 'prealable');
    document.getElementById('na-type-controle').classList.toggle('is-active', t === 'controle');
    /* Changer de type change de programme normatif : on ne conserve un
       ajustement manuel que s'il a été explicitement demandé. */
    if (change && !silencieux && !_draft.paramsPerso) _draft.params = ArrachementCalc.programme(t);
    document.getElementById('na-cycles-wrap').hidden = (t !== 'prealable');
    if (!silencieux) _fillProgramme();
  }

  /* Complète ou réduit la liste sans jamais toucher à un talus déjà entamé. */
  function _syncTalus(n) {
    const l = _draft.talus;
    for (let i = l.length; i < n; i++) {
      l.push({ id: 'T' + String(i + 1).padStart(2, '0'), nom: '', ordre: i, nbPrevu: 3, nbFait: 0 });
    }
    while (l.length > n) {
      const t = l[l.length - 1];
      if (t.nbFait > 0) { alert(`${t.id} porte déjà ${t.nbFait} essai(s) : il ne peut pas être retiré.`); break; }
      l.pop();
    }
    l.forEach((t, i) => { if (t.ordre === undefined) t.ordre = i; });
  }
  function onNbTalus() {
    const n = Math.min(60, Math.max(1, parseInt(document.getElementById('na-nb-talus').value) || 1));
    _syncTalus(n);
    document.getElementById('na-nb-talus').value = _draft.talus.length;
    _renderTalusList();
  }
  function _renderTalusList() {
    const host = document.getElementById('na-talus-list');
    host.innerHTML = _draft.talus.map(t => `
      <div class="ar-talus-row">
        <span class="ar-talus-id">${esc(t.id)}</span>
        <input class="ar-talus-nom" data-t="${esc(t.id)}" type="text" value="${esc(t.nom || '')}" placeholder="Nom du talus (facultatif)">
        <input class="ar-talus-nb" data-t="${esc(t.id)}" type="number" min="1" max="200" inputmode="numeric" value="${t.nbPrevu || 1}" aria-label="Clous prévus">
        <span class="ar-talus-unit">clous</span>
      </div>`).join('');
    host.querySelectorAll('.ar-talus-nom').forEach(i => i.addEventListener('input', () => {
      const t = _talusById(i.dataset.t); if (t) t.nom = i.value.trim();
    }));
    host.querySelectorAll('.ar-talus-nb').forEach(i => i.addEventListener('input', () => {
      const t = _talusById(i.dataset.t); if (t) t.nbPrevu = parseInt(i.value) || 0;
      _majTotal();
    }));
    _majTotal();
  }
  function _majTotal() {
    const n = _draft.talus.reduce((s, t) => s + (parseInt(t.nbPrevu) || 0), 0);
    document.getElementById('na-talus-total').textContent =
      `${_draft.talus.length} talus · ${n} essai${n > 1 ? 's' : ''} prévu${n > 1 ? 's' : ''} au total.`;
  }
  function _collectCampagne() {
    _draft.tmax = document.getElementById('na-tmax').value.trim();
    _draft.ouvrage = document.getElementById('na-ouvrage').value.trim();
    _draft.params.nbCycles = (_draft.typeEssai === 'prealable') ? (parseInt(document.getElementById('na-cycles').value) || 1) : 1;
    const c = _draft.clouType;
    c.diamBarre = _g('na-ct-barre'); c.diamForage = _g('na-ct-forage');
    c.longueurTotale = _g('na-ct-lt'); c.longueurScellee = _g('na-ct-ls');
    c.longueurTete = _g('na-ct-tete'); c.inclinaison = _g('na-ct-incl');
    c.nuanceAcier = _g('na-ct-nuance'); c.dateInjection = _g('na-ct-injection');
    document.querySelectorAll('#na-talus-list .ar-talus-nom').forEach(i => {
      const t = _talusById(i.dataset.t); if (t) t.nom = i.value.trim();
    });
    document.querySelectorAll('#na-talus-list .ar-talus-nb').forEach(i => {
      const t = _talusById(i.dataset.t); if (t) t.nbPrevu = parseInt(i.value) || 0;
    });
    if (_draft.paramsPerso) _collectProgramme();
  }
  function _talusById(id) { return _draft.talus.find(t => t.id === id) || null; }

  /* ============================================================
     PROGRAMME — repli de l'étape « Campagne », normatif par défaut
     ============================================================ */
  function toggleParamsPerso() {
    _draft.paramsPerso = document.getElementById('na-params-perso').checked;
    if (!_draft.paramsPerso) _draft.params = Object.assign(ArrachementCalc.programme(_draft.typeEssai), { nbCycles: _draft.params.nbCycles });
    document.getElementById('na-step-programme').hidden = !_draft.paramsPerso;
    _fillProgramme();
  }
  function _fillProgramme() {
    const d = _draft.params;
    _v('na-frac-pa', _pct(d.fractionPa));
    _v('na-frac-charge', (d.fractionsCharge || []).map(_pct).join(', '));
    _v('na-frac-decharge', (d.fractionsDecharge || []).map(_pct).join(', '));
    _v('na-duree-palier', d.dureePalierMin); _v('na-duree-final', d.dureeFinalMin);
    _v('na-lectures-palier', (d.lecturesPalier || []).join(', '));
    _v('na-lectures-final', (d.lecturesFinal || []).join(', '));
    document.getElementById('na-stab-active').checked = !!d.stabilisationActive;
    document.getElementById('na-stab-wrap').hidden = !d.stabilisationActive;
    _v('na-stab-seuil', d.seuilStabMmParMin); _v('na-stab-duree', d.dureeMiniMaintienMin);
    _v('na-alpha-ok', d.alphaOk); _v('na-alpha-haut', d.alphaHaut);
    _v('na-seuil-dep', d.seuilDeplacementMm); _v('na-seuil-ecart', d.seuilEcartComparateursMm);
    _v('na-tol-effort', d.toleranceEffortPct);
    onProgrammeChange();
  }
  function toggleStabilisation() {
    document.getElementById('na-stab-wrap').hidden = !document.getElementById('na-stab-active').checked;
    onProgrammeChange();
  }
  function onProgrammeChange() {
    if (_draft.paramsPerso) _collectProgramme();
    const host = document.getElementById('na-paliers-preview');
    if (!host) return;
    const t = _tmax();
    if (!(t > 0)) { host.innerHTML = '<p class="empty-msg">Renseignez Tmax pour voir le programme.</p>'; return; }
    host.innerHTML = `<div class="param-panel-title">Programme appliqué</div>`
      + _tablePaliers(ArrachementCalc.genererPaliers(t, _draft.params, _verin(), _etal()), _verin())
      + `<div class="bar-note">Le temps d'un palier démarre à l'<strong>atteinte de l'effort cible</strong>, pas au début de la montée en pression.</div>`;
    _renderEcarts();
  }
  /* Traçabilité : programme normatif du type d'essai vs programme appliqué. */
  function _renderEcarts() {
    const host = document.getElementById('na-diff-defauts');
    if (!host) return;
    const d = _draft.params, ref = ArrachementCalc.programme(_draft.typeEssai);
    const lignes = [];
    const cmp = (k, lbl, f) => { if (JSON.stringify(ref[k]) !== JSON.stringify(d[k]))
      lignes.push(`<div class="param-row"><span class="param-label">${lbl}</span><span class="param-val">${f(ref[k])} → <strong>${f(d[k])}</strong></span></div>`); };
    const asPct = a => Array.isArray(a) ? a.map(_pct).join(' / ') + ' %' : _pct(a) + ' %';
    cmp('fractionPa', 'Palier de serrage', asPct);
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
    cmp('seuilDeplacementMm', 'Seuil d\'arrêt', v => v + ' mm');
    cmp('seuilEcartComparateursMm', 'Écart comparateurs', v => v + ' mm');
    cmp('nbCycles', 'Nombre de cycles', v => String(v));
    _draft.paramsModifies = lignes.length > 0;
    host.hidden = !lignes.length;
    host.innerHTML = lignes.length ? `<div class="param-panel-title">Écarts au programme normatif (tracés dans le PV)</div>${lignes.join('')}` : '';
  }
  function _collectProgramme() {
    const d = _draft.params;
    d.fractionPa = _fracOf(_g('na-frac-pa'), d.fractionPa);
    d.fractionsCharge = _fracsOf(_g('na-frac-charge'), d.fractionsCharge);
    d.fractionsDecharge = _fracsOf(_g('na-frac-decharge'), d.fractionsDecharge);
    d.dureePalierMin = _numOr(_g('na-duree-palier'), d.dureePalierMin);
    d.dureeFinalMin = _numOr(_g('na-duree-final'), d.dureeFinalMin);
    d.lecturesPalier = _listOf(_g('na-lectures-palier'), d.lecturesPalier);
    d.lecturesFinal = _listOf(_g('na-lectures-final'), d.lecturesFinal);
    d.stabilisationActive = document.getElementById('na-stab-active').checked;
    d.seuilStabMmParMin = _numOr(_g('na-stab-seuil'), d.seuilStabMmParMin);
    d.dureeMiniMaintienMin = _numOr(_g('na-stab-duree'), d.dureeMiniMaintienMin);
    d.alphaOk = _numOr(_g('na-alpha-ok'), d.alphaOk);
    d.alphaHaut = _numOr(_g('na-alpha-haut'), d.alphaHaut);
    d.seuilDeplacementMm = _numOr(_g('na-seuil-dep'), d.seuilDeplacementMm);
    d.seuilEcartComparateursMm = _numOr(_g('na-seuil-ecart'), d.seuilEcartComparateursMm);
    d.toleranceEffortPct = _numOr(_g('na-tol-effort'), d.toleranceEffortPct);
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
     ÉTAPE 3 — MATÉRIEL
     ============================================================ */
  function _fillMateriel() {
    const m = _draft.materiel;
    const sel = document.getElementById('na-verin');
    sel.innerHTML = '<option value="">— Choisir le vérin —</option>' +
      ArrachementCalc.verins().map(v => `<option value="${esc(v.modele)}">${esc(v.modele)} — ${_f(v.surfaceCm2, 2)} cm² · ${_f(v.capaciteKN, 0)} kN · trou Ø ${_f(v.trouMm, 1)} mm</option>`).join('');
    sel.value = m.verin || '';
    _v('na-diam-barre', _draft.clouType.diamBarre);
    _v('na-diam-acc', m.diamAccessoire); _v('na-course-mep', m.courseMiseEnPlaceMm);
    document.getElementById('na-eff-capteur').checked = (m.mesureEffort === 'capteur');
    _v('na-serie-effort', m.serieEffort); _v('na-etal-effort', m.etalonnageEffort);
    document.getElementById('na-etal-utilisee').checked = !!m.etalUtilisee;
    document.getElementById('na-etal-wrap').hidden = !m.etalUtilisee;
    _v('na-etal-a', m.etalA); _v('na-etal-b', m.etalB);
    setNbComparateurs(m.nbComparateurs || 2);
    _v('na-serie-c1', m.serieComp1); _v('na-serie-c2', m.serieComp2); _v('na-etal-comp', m.etalonnageComp);
    toggleCapteur();
  }
  /* Il n'y a pas d'effort à saisir pendant l'essai : c'est celui du palier
     appliqué. Le capteur de force est une option de la chaîne de mesure. */
  function toggleCapteur() {
    const on = document.getElementById('na-eff-capteur').checked;
    _draft.materiel.mesureEffort = on ? 'capteur' : 'manometre';
    const h = document.getElementById('na-eff-hint');
    if (h) h.textContent = on
      ? 'Le capteur mesure l\'effort réellement appliqué ; le manomètre reste en redondance.'
      : 'Sans capteur, l\'effort est celui du palier appliqué, lu au manomètre : rien à saisir pendant l\'essai.';
    onMaterielChange();
  }
  function setNbComparateurs(n) {
    _draft.materiel.nbComparateurs = n;
    document.getElementById('na-comp-1').classList.toggle('is-active', n === 1);
    document.getElementById('na-comp-2').classList.toggle('is-active', n === 2);
    document.getElementById('na-serie-c2-wrap').hidden = (n !== 2);
    const ax = document.getElementById('na-axialite-wrap');
    if (ax) ax.textContent = (n === 2)
      ? 'Avec deux comparateurs, la valeur retenue est leur moyenne et leur écart mesure l\'axialité du montage.'
      : 'Avec un seul comparateur, l\'axialité du montage ne peut pas être contrôlée : les essais le mentionneront.';
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
  function _tmax() { return _num(_draft.tmax); }
  function _montageParams() {
    const m = _draft.materiel;
    return { verin: _verin(), tmax: _draft.tmax, diamBarre: _draft.clouType.diamBarre,
             diamAccessoire: m.diamAccessoire, etal: _etal(), courseUtiliseeMm: m.courseMiseEnPlaceMm };
  }
  function _etalonnagePerime() {
    const m = _draft.materiel, today = new Date().toISOString().slice(0, 10);
    return [m.etalonnageEffort, m.etalonnageComp].some(d => d && d < today);
  }
  function onMaterielChange() {
    _collectMateriel();
    const w = ArrachementCalc.controlerMontage(_montageParams());
    if (_etalonnagePerime()) w.unshift({ niveau: 'bloquant', texte: 'Étalonnage périmé sur au moins un appareil de mesure : l\'essai sera classé NON RECEVABLE.' });
    const wrap = document.getElementById('na-materiel-warn');
    wrap.innerHTML = w.map(x => `<div class="ar-warn ar-warn-${x.niveau}">${x.niveau === 'bloquant' ? '⛔' : x.niveau === 'alerte' ? '⚠️' : 'ℹ️'} ${esc(x.texte)}</div>`).join('');
    wrap.hidden = !w.length;

    const v = _verin(), info = document.getElementById('na-verin-info');
    if (!v) { info.hidden = true; document.getElementById('na-pression-table').innerHTML = ''; return; }
    info.hidden = false;
    info.innerHTML = `
      <div class="param-row"><span class="param-label">Surface effective</span><span class="param-val">${_f(v.surfaceCm2, 2)} cm²</span></div>
      <div class="param-row"><span class="param-label">Capacité à ${v.pmaxBar} bar</span><span class="param-val">${_f(v.capaciteKN, 0)} kN</span></div>
      <div class="param-row"><span class="param-label">Course</span><span class="param-val">${_f(v.courseMm, 1)} mm</span></div>
      <div class="param-row"><span class="param-label">Ø trou central</span><span class="param-val">${_f(v.trouMm, 1)} mm</span></div>`;
    const t = _tmax();
    document.getElementById('na-pression-table').innerHTML = (t > 0)
      ? `<div class="param-panel-title">Efforts et pressions à appliquer</div>` + _tablePaliers(ArrachementCalc.genererPaliers(t, _draft.params, v, _etal()), v)
      : '';
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
    _draft.clouType.diamBarre = _g('na-diam-barre') || _draft.clouType.diamBarre;
    m.diamAccessoire = _g('na-diam-acc');
    m.courseMiseEnPlaceMm = _g('na-course-mep');
    m.serieEffort = _g('na-serie-effort'); m.etalonnageEffort = _g('na-etal-effort');
    m.etalUtilisee = document.getElementById('na-etal-utilisee').checked;
    m.etalA = _g('na-etal-a'); m.etalB = _g('na-etal-b');
    m.serieComp1 = _g('na-serie-c1'); m.serieComp2 = _g('na-serie-c2');
    m.etalonnageComp = _g('na-etal-comp');
  }

  /* ============================================================
     CRÉATION DE LA CAMPAGNE
     ============================================================ */
  async function creerCampagne() {
    if (_draft.refManuelle) _draft.ref = _draft.refManuelle;
    if (!_draft.ref) _draft.ref = await _genererRef('arrachement', _draft.codeProjet || 'XXX');
    _draft.etalonnagePerime = _etalonnagePerime();
    _draft.statut = 'incomplet';
    await _persist();
    renderPlan();
    AppNav.goto('screen-ar-plan');
  }
  async function _genererRef(type, code) {
    const t = AuthModule.token();
    if (t && navigator.onLine) {
      try { const r = await ServerModule.nextRef(t, type, code); if (r && r.ok && r.ref) return r.ref; } catch (_) {}
    }
    const n = await CAEKDB.nextNumero(type, code);
    return `QC/ARR/${code}${String(n).padStart(2, '0')}`;
  }

  /* ============================================================
     PLAN DES TALUS
     ============================================================ */
  function _ordonnes() { return [..._draft.talus].sort((a, b) => a.ordre - b.ordre); }

  function renderPlan() {
    const v = _verin();
    document.getElementById('ap-info').innerHTML =
      `<div class="info-locked"><span class="info-label">${esc(_draft.ref)}</span><span>${esc(_draft.nomProjet || '—')}</span></div>`
      + `<div class="info-locked"><span class="info-label">Ouvrage</span><span>${esc(_draft.ouvrage || '—')}</span></div>`
      + `<div class="info-locked"><span class="info-label">Tmax</span><span>${_f(_tmax(), 0)} kN · ${esc(_draft.materiel.verin || '—')}${v ? ' (' + _f(v.surfaceCm2, 2) + ' cm²)' : ''}</span></div>`;

    const prevus = _draft.talus.reduce((n, t) => n + (t.nbPrevu || 0), 0);
    const faits = _draft.talus.reduce((n, t) => n + (t.nbFait || 0), 0);
    document.getElementById('ap-progress').textContent = `${faits} / ${prevus} essais réalisés`;

    const btn = document.getElementById('ap-organiser');
    btn.textContent = _organise ? '✓ Terminer l\'organisation' : '↕ Organiser le plan';
    btn.classList.toggle('is-active', _organise);
    document.getElementById('ap-hint').textContent = _organise
      ? 'Touchez deux talus pour les permuter, ou faites-les glisser.'
      : 'Touchez un talus pour commencer ou poursuivre un essai.';

    document.getElementById('ap-grid').innerHTML = _ordonnes().map(t => {
      const reste = Math.max(0, (t.nbPrevu || 0) - (t.nbFait || 0));
      const sel = _organise && _selId === t.id;
      return `<button class="cfms-cell${reste ? '' : ' is-done'}${sel ? ' is-selected' : ''}" data-t="${esc(t.id)}">
        <strong>${esc(t.id)}</strong>
        ${t.nom ? `<span class="cfms-cell-nom">${esc(t.nom)}</span>` : ''}
        <span class="cfms-cell-q"><b class="${reste ? '' : 'q-ok'}">${t.nbFait || 0}/${t.nbPrevu || 0}</b></span>
      </button>`;
    }).join('');
    document.getElementById('ap-grid').classList.toggle('is-organise', _organise);
    _brancherCellules();
  }

  /* Réorganisation compatible tactile : les événements HTML5 drag/drop ne se
     déclenchent pas sur mobile. Pointer Events, avec repli « toucher A puis
     toucher B » pour une manipulation avec des gants. */
  function _brancherCellules() {
    document.querySelectorAll('#ap-grid .cfms-cell').forEach(cell => {
      const id = cell.dataset.t;
      if (!_organise) { cell.onclick = () => choisirTalus(id); return; }
      cell.onclick = null;
      let x0 = 0, y0 = 0, bouge = false;
      cell.onpointerdown = ev => { x0 = ev.clientX; y0 = ev.clientY; bouge = false; cell.classList.add('is-drag'); };
      cell.onpointermove = ev => {
        if (!cell.classList.contains('is-drag')) return;
        if (Math.abs(ev.clientX - x0) > 12 || Math.abs(ev.clientY - y0) > 12) bouge = true;
      };
      cell.onpointerup = ev => {
        cell.classList.remove('is-drag');
        if (bouge) {
          const dest = (document.elementFromPoint(ev.clientX, ev.clientY) || {}).closest
            ? document.elementFromPoint(ev.clientX, ev.clientY).closest('.cfms-cell') : null;
          if (dest && dest.dataset.t !== id) _permuter(id, dest.dataset.t);
          return;
        }
        if (_selId && _selId !== id) _permuter(_selId, id);
        else { _selId = (_selId === id) ? null : id; renderPlan(); }
      };
      cell.onpointercancel = () => cell.classList.remove('is-drag');
    });
  }
  /* On échange les positions d'affichage, PAS les objets : les quotas et
     l'historique restent attachés à leur talus. */
  function _permuter(a, b) {
    const ta = _talusById(a), tb = _talusById(b);
    if (!ta || !tb) return;
    const o = ta.ordre; ta.ordre = tb.ordre; tb.ordre = o;
    _selId = null; renderPlan(); _persistLocal();
  }
  function organiser() { _organise = !_organise; _selId = null; renderPlan(); }

  /* ============================================================
     ÉCRAN TALUS
     ============================================================ */
  function choisirTalus(id) {
    const t = _talusById(id); if (!t) return;
    _talusId = id;
    renderTalus();
    AppNav.goto('screen-ar-talus');
  }
  function _talus() { return _talusById(_talusId); }

  async function renderTalus() {
    const t = _talus(); if (!t) return;
    const reste = Math.max(0, (t.nbPrevu || 0) - (t.nbFait || 0));
    document.getElementById('at-title').textContent = t.nom ? `${t.id} — ${t.nom}` : t.id;
    document.getElementById('at-info').innerHTML =
      `<div class="info-locked"><span class="info-label">Essais</span><span>${t.nbFait || 0} réalisé(s) · ${reste} restant(s) sur ${t.nbPrevu || 0}</span></div>`
      + `<div class="info-locked"><span class="info-label">Tmax</span><span>${_f(_tmax(), 0)} kN</span></div>`;

    document.getElementById('at-securite-card').hidden = !!_draft.securiteOk;
    _syncChecklist();
    checkSecurite();
    _renderEssaisDuTalus();
    _renderAnomalies('talus');
    await _renderPhotos('talus');
    window.scrollTo(0, 0);
  }
  function _renderEssaisDuTalus() {
    const zone = document.getElementById('at-essais');
    const list = (_draft.essais || []).filter(e => e.talusId === _talusId);
    if (!list.length) { zone.innerHTML = '<p class="empty-msg">Aucun essai sur ce talus.</p>'; return; }
    zone.innerHTML = list.map(e => {
      const r = e.result || {};
      const lbl = (ArrachementCalc.CLASSES[r.classe] || {}).label || '';
      const cls = { satisfaisant: 'badge-ok', examiner: 'badge-incomplet', signaler: 'badge-incomplet',
                    non_recevable: 'badge-nok', non_realise: 'badge-remplacee' }[r.classe] || '';
      return `<div class="cfms-essai-item">
        <div><b>n° ${e.n} — ${esc((e.clou && e.clou.repere) || '')}</b> ${lbl ? `<span class="badge ${cls}">${esc(lbl)}</span>` : ''}</div>
        <div class="cfms-essai-sub">${esc(_dateFr(e.date))} · yp ${_f(r.yTmax, 2)} mm · α ${_f(r.alpha, 2)} mm/déc.${e.incomplet ? ' · <span class="text-nok">incomplet</span>' : ''}</div>
      </div>`;
    }).join('');
  }

  /* ============================================================
     SÉCURITÉ — une fois pour la campagne
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
  function _syncChecklist() {
    document.querySelectorAll('#na-checklist .na-chk').forEach(chk => {
      chk.checked = !!(_draft.checklist && _draft.checklist[+chk.dataset.i]);
    });
  }
  function checkSecurite() {
    const c = document.querySelectorAll('#na-checklist .na-chk');
    const ok = c.length > 0 && [...c].every(x => x.checked);
    if (ok && !_draft.securiteOk) { _draft.securiteOk = true; _persistLocal(); }
    const btn = document.getElementById('at-btn-start');
    const t = _talus();
    const reste = t ? Math.max(0, (t.nbPrevu || 0) - (t.nbFait || 0)) : 0;
    if (btn) {
      btn.disabled = !(ok || _draft.securiteOk);
      btn.classList.toggle('is-disabled', btn.disabled);
      btn.textContent = reste ? '▶️ DÉMARRER UN ESSAI' : '▶️ ESSAI SUPPLÉMENTAIRE';
    }
    const msg = document.getElementById('na-secu-msg');
    if (msg) msg.hidden = ok;
    const card = document.getElementById('at-securite-card');
    if (card && ok) card.hidden = true;
  }

  /* ============================================================
     DÉMARRAGE D'UN ESSAI
     ============================================================ */
  async function demarrerEssai() {
    const t = _talus(); if (!t) return;
    if (!_draft.securiteOk) { alert('La check-list sécurité doit être validée avant tout chargement.'); return; }
    const reste = (t.nbPrevu || 0) - (t.nbFait || 0);
    if (reste <= 0 && !confirm(`La quantité prévue sur ${t.id} est atteinte.\n\nAjouter un essai supplémentaire ?`)) return;
    _draft.enCours = _blankEssai(_prochainNumero(), t);
    _alerted = {};
    await _persistLocal();
    await _renderEssai();
    AppNav.goto('screen-ar-essai');
  }
  /* Numérotation automatique, continue sur toute la campagne. */
  function _prochainNumero() {
    return (_draft.essais || []).reduce((m, e) => Math.max(m, e.n || 0), 0) + 1;
  }
  /* Le repère est numéroté DANS le talus : sur T02, les clous testés sont
     1, 2, 3… Le numéro d'essai `n`, lui, court sur toute la campagne.
     Le talus n'est pas la zone : T02 est le talus, sa zone peut être PK 223.
     La zone reste donc à saisir, elle n'est jamais déduite du talus. */
  function _prochainRepere(t) {
    return (_draft.essais || [])
      .filter(e => e.talusId === t.id)
      .reduce((m, e) => {
        const v = parseInt((e.clou && e.clou.repere) || '', 10);
        return isNaN(v) ? m : Math.max(m, v);
      }, 0) + 1;
  }
  function _blankEssai(n, t) {
    const c = _draft.clouType;
    return {
      n, talusId: t.id,
      clou: { repere: String(_prochainRepere(t)), zone: '', niveau: '', gps: '',
              diamBarre: c.diamBarre, diamForage: c.diamForage,
              longueurTotale: c.longueurTotale, longueurScellee: c.longueurScellee,
              longueurTete: c.longueurTete, inclinaison: c.inclinaison,
              nuanceAcier: c.nuanceAcier, dateInjection: c.dateInjection, horsDefaut: false },
      date: '', heure: '', meteo: '', temperature: '', temperatureSource: '',
      courseMiseEnPlaceMm: _draft.materiel.courseMiseEnPlaceMm || '',
      paliers: ArrachementCalc.genererPaliers(_tmax(), _draft.params, _verin(), _etal()),
      pIdx: 0, origine: null, lectureInitiale: '',
      anomalies: [], photos: [], arret: { stopped: false, motif: '' }, done: false,
    };
  }
  function _essai() { return _draft.enCours; }
  function _palierCourant() { const e = _essai(); return e ? (e.paliers[e.pIdx] || null) : null; }

  /* ============================================================
     ÉCRAN D'ESSAI
     ============================================================ */
  async function _renderEssai() {
    const e = _essai(); if (!e) return;
    const t = _talusById(e.talusId), v = _verin();
    document.getElementById('ea-count').textContent = `${t ? t.id : ''} — CLOU n° ${e.n}`;
    document.getElementById('ea-info').innerHTML = `
      <div class="es-info-line"><strong>${esc(_draft.ref)}</strong>${_draft.auto === 'Oui' ? ' · <span class="text-nok">auto-contrôle</span>' : ''}</div>
      <div class="es-info-line">${esc(_draft.client || '—')} · ${esc(_draft.nomProjet || '—')}</div>
      <div class="es-info-line text-muted">${_draft.typeEssai === 'prealable' ? 'Essai préalable' : 'Essai de contrôle'} · Tmax ${_f(_tmax(), 0)} kN · ${esc(_draft.materiel.verin || 'vérin ?')}${v ? ' (' + _f(v.surfaceCm2, 2) + ' cm²)' : ''}</div>`;
    const c = e.clou;
    _v('ea-repere', c.repere); _v('ea-zone', c.zone); _v('ea-niveau', c.niveau); _v('ea-gps', c.gps);
    _v('ea-date', e.date || _todayDate()); _v('ea-heure', e.heure || _nowTime());
    _fillMeteo(e.meteo || _draft.meteo || '');
    _v('ea-temp', e.temperature);
    _v('ea-diam-barre', c.diamBarre); _v('ea-long-totale', c.longueurTotale);
    _v('ea-long-scellee', c.longueurScellee); _v('ea-diam-forage', c.diamForage);
    _v('ea-date-scellement', c.dateInjection); _v('ea-nuance', c.nuanceAcier);
    _v('ea-course-mep', e.courseMiseEnPlaceMm);
    document.getElementById('ea-results').hidden = true;
    _renderRunner(); _renderAnomalies('essai');
    await _renderPhotos('essai');
    _autoTemperature();
    _startTicker();
    window.scrollTo(0, 0);
  }
  function _fillMeteo(val) {
    const sel = document.getElementById('ea-meteo');
    sel.innerHTML = '<option value="">— Météo —</option>' + METEOS.map(m => `<option value="${m}" ${m === val ? 'selected' : ''}>${m}</option>`).join('');
  }
  /* Température : relevée depuis la position quand il y a du réseau, sinon
     laissée à la saisie. Jamais écrasée si l'opérateur a saisi une valeur. */
  async function _autoTemperature() {
    const e = _essai(); if (!e || e.temperature !== '') return;
    if (!navigator.onLine || !navigator.geolocation) return;
    const hint = document.getElementById('ea-temp-hint');
    try {
      const pos = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej,
        { enableHighAccuracy: false, timeout: 6000, maximumAge: 300000 }));
      const { latitude, longitude } = pos.coords;
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude.toFixed(3)}&longitude=${longitude.toFixed(3)}&current=temperature_2m`;
      const r = await fetch(url);
      const j = await r.json();
      const tC = j && j.current && j.current.temperature_2m;
      if (tC == null || _essai() !== e) return;
      const champ = document.getElementById('ea-temp');
      if (champ && champ.value === '') {
        champ.value = tC;
        e.temperature = String(tC); e.temperatureSource = 'auto';
        if (hint) hint.textContent = `Relevée automatiquement (${_f(tC, 1)} °C) — modifiable.`;
      }
    } catch (_) {
      if (hint) hint.textContent = 'Relevé automatique indisponible : saisissez la température à la main.';
    }
  }
  function _collectIdent() {
    const e = _essai(); if (!e) return;
    const c = e.clou;
    c.repere = _g('ea-repere'); c.zone = _g('ea-zone'); c.niveau = _g('ea-niveau'); c.gps = _g('ea-gps');
    e.date = _g('ea-date'); e.heure = _g('ea-heure'); e.meteo = _g('ea-meteo');
    const temp = _g('ea-temp');
    if (temp !== e.temperature) { e.temperature = temp; e.temperatureSource = e.temperatureSource === 'auto' && temp === '' ? '' : 'manuelle'; }
    c.diamBarre = _g('ea-diam-barre'); c.longueurTotale = _g('ea-long-totale');
    c.longueurScellee = _g('ea-long-scellee'); c.diamForage = _g('ea-diam-forage');
    c.dateInjection = _g('ea-date-scellement'); c.nuanceAcier = _g('ea-nuance');
    e.courseMiseEnPlaceMm = _g('ea-course-mep');
    /* Un clou qui s'écarte du clou type de la campagne est signalé comme tel. */
    const ct = _draft.clouType;
    c.horsDefaut = ['diamBarre', 'diamForage', 'longueurTotale', 'longueurScellee', 'nuanceAcier']
      .some(k => String(c[k] || '') !== String(ct[k] || ''));
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
    if (!e) return;
    const v = _verin(), prm = _draft.params;
    if (!e.paliers.length) { host.innerHTML = '<p class="empty-msg">Programme non généré : vérifiez Tmax et le vérin.</p>'; return; }

    const frise = `<div class="ar-frise">${e.paliers.map((p, i) => {
      const st = p.endedAt ? 'is-done' : (i === e.pIdx ? 'is-current' : '');
      return `<button class="ar-chip ${st} ar-chip-${p.phase}" data-p="${i}" title="${esc(p.label)}">${esc(p.code)}</button>`;
    }).join('')}</div>`;

    if (e.arret.stopped) {
      host.innerHTML = frise + `<div class="ar-warn ar-warn-bloquant">⛔ Essai interrompu — ${esc(e.arret.motif || 'motif non précisé')}.<br>Toutes les mesures saisies sont conservées ; l'essai est marqué incomplet.</div>`
        + `<button class="btn-secondary" id="ea-btn-reprendre-arret">↩︎ Annuler l'interruption et reprendre</button>`;
      _bindFrise(host);
      const b = document.getElementById('ea-btn-reprendre-arret');
      if (b) b.addEventListener('click', () => { e.arret = { stopped: false, motif: '' }; _persistLocal(); _renderRunner(); });
      return;
    }

    const p = _palierCourant();
    if (!p) { host.innerHTML = frise + '<p class="empty-msg">Programme terminé.</p>'; _bindFrise(host); return; }

    const pr = ArrachementCalc.pression(p.effort, v, _etal());
    const nbC = _draft.materiel.nbComparateurs === 1 ? 1 : 2;

    let html = frise + `<div class="ar-palier ar-palier-${p.phase}${p.final ? ' ar-palier-final' : ''}">
      <div class="ar-palier-head">
        <span class="ar-palier-label">${esc(p.label)}</span>
        ${p.final ? '<span class="badge badge-nok">palier final — va toujours à son terme</span>' : ''}
      </div>
      <div class="ar-cibles">
        <div class="ar-cible"><span class="ar-cible-lbl">Effort cible</span><span class="ar-cible-val">${_f(p.effort, 1)}</span><span class="ar-cible-unit">kN</span></div>
        <div class="ar-cible ar-cible-p"><span class="ar-cible-lbl">Pression à appliquer</span><span class="ar-cible-val">${pr.bar == null ? '—' : _f(pr.bar, 0)}</span><span class="ar-cible-unit">bar</span></div>
      </div>
      <div class="ar-cible-note">± ${_f(p.toleranceEffortKN, 1)} kN${pr.depasse ? ' · <span class="text-nok">⛔ au-delà de la pression maximale d\'utilisation</span>' : ''}</div>`;

    if (!p.startedAt) {
      html += `<div class="bar-note">Montez en pression jusqu'à l'effort cible (en 1 min au plus), puis démarrez le palier : le temps court à partir de l'<strong>atteinte de l'effort</strong>.</div>
        <button class="btn-primary btn-xl" id="ea-btn-start">▶️ EFFORT ATTEINT — DÉMARRER LE PALIER</button>`;
    } else {
      const ecoule = (Date.now() - p.startedAt) / 60000;
      const next = _prochaineLecture(p);
      const dueNext = next && ecoule >= next.tMin - 0.05;
      html += `<div class="ar-chrono-bloc">
          <div class="ar-chrono"><span class="ar-chrono-lbl">Temps de palier</span><span class="ar-chrono-val" id="ea-chrono">${ArrachementCalc.mmss(ecoule * 60)}</span></div>
          <div class="ar-chrono ar-chrono-next"><span class="ar-chrono-lbl">${next ? 'Lecture t = ' + _f(next.tMin, 0) + ' min dans' : 'Toutes les lectures faites'}</span><span class="ar-chrono-val" id="ea-countdown">${next ? ArrachementCalc.mmss(Math.max(0, (next.tMin - ecoule) * 60)) : '—'}</span></div>
        </div>`;
      /* Report d'un relevé déjà noté sur papier : on avance le chrono jusqu'à
         l'échéance suivante. Volontairement discret — un appui par erreur
         fausserait le temps de palier. */
      if (next && !dueNext) {
        html += `<button class="ar-skip" id="ea-btn-skip" type="button" title="Avancer le chrono jusqu'à la prochaine échéance">⏭ passer l'attente</button>`;
      }

      if (next) {
        const due = dueNext;
        html += `<div class="ar-saisie ${due ? 'is-due' : ''}">
          <div class="ar-saisie-titre">Lecture à t = ${_f(next.tMin, 0)} min ${due ? '<span class="ar-due">à relever maintenant</span>' : '<span class="text-muted">(en attente)</span>'}</div>
          <div class="ar-comp-row">
            <div class="field field-key"><label for="ea-c1">Comparateur 1 <small>(mm)</small></label><input id="ea-c1" class="input-key" type="number" step="0.01" inputmode="decimal" placeholder="0.00"></div>
            ${nbC === 2 ? `<div class="field field-key"><label for="ea-c2">Comparateur 2 <small>(mm)</small></label><input id="ea-c2" class="input-key" type="number" step="0.01" inputmode="decimal" placeholder="0.00"></div>` : ''}
          </div>
          <div class="field-hint">Résolution 0,01 mm.${nbC === 2 ? ' Valeur retenue = moyenne des deux ; l\'écart mesure l\'axialité.' : ''}${e.origine != null ? ` Origine : <strong>${_f(e.origine, 2)} mm</strong>.` : (p.origine ? ' La dernière lecture de ce palier fixera l\'origine des déplacements.' : '')}</div>
          <button class="btn-primary btn-xl" id="ea-btn-lecture">✓ ENREGISTRER LA LECTURE</button>
        </div>`;
      }

      if (p.lectures.length) {
        html += `<div class="ar-lectures"><div class="section-title">Lectures</div>${p.lectures.map((l, i) => `
          <div class="ar-lecture">
            <span class="ar-l-t">t = ${_f(l.tMin, 0)} min</span>
            <span class="ar-l-brut">${nbC === 2 ? `${_f(l.c1, 2)} / ${_f(l.c2, 2)}` : _f(l.c1, 2)}</span>
            <span class="ar-l-y">${l.y == null ? '—' : _f(l.y, 2) + ' mm'}</span>
            ${l.ecart != null ? `<span class="ar-l-ec ${l.ecart > _num(prm.seuilEcartComparateursMm) ? 'text-nok' : 'text-muted'}">Δ ${_f(l.ecart, 2)}</span>` : ''}
            <span class="ar-l-ts text-muted">${_hms(l.ts)}${l.skip ? ' · reportée' : ''}</span>
            ${(l.corrections && l.corrections.length) ? `<span class="badge badge-version">corrigée ×${l.corrections.length}</span>` : ''}
            <button class="ar-l-edit" data-corr="${i}" title="Corriger (la valeur d'origine est conservée)">✎</button>
          </div>`).join('')}</div>`;
        const a = ArrachementCalc.alphaPalier(p, prm);
        if (a != null) {
          const cf = ArrachementCalc.classeFluage(a, prm);
          html += `<div class="ar-alpha ar-alpha-${cf.classe}">α = <strong>${_f(a, 2)} mm/décade</strong> — ${esc(cf.label)}</div>`;
        }
      }

      const sug = ArrachementCalc.suggestionStabilisation(p, prm);
      if (sug.suggere) {
        html += `<div class="ar-sugg">💡 ${esc(sug.raison)}<br>Passer au palier suivant ?
          <div class="ar-sugg-actions">
            <button class="btn-primary" id="ea-btn-sugg-ok">Oui, palier suivant</button>
            <button class="btn-secondary" id="ea-btn-sugg-no">Non, poursuivre</button>
          </div></div>`;
      }
      /* Palier final non stabilisé à son terme : on propose la prolongation. */
      const toutesFaites = !next;
      if (p.final && toutesFaites && !p.prolonge) {
        const sp = ArrachementCalc.suggestionProlongation(p, prm);
        if (sp.suggere) {
          html += `<div class="ar-sugg">⏱ ${esc(sp.raison)}
            <div class="ar-sugg-actions">
              <button class="btn-primary" id="ea-btn-prol-ok" data-d="${sp.dureeMin}" data-l="${sp.lectures.join(',')}">Prolonger à ${_f(sp.dureeMin, 0)} min</button>
              <button class="btn-secondary" id="ea-btn-prol-no">Clôturer quand même</button>
            </div></div>`;
        }
      }

      const al = ArrachementCalc.alertes(e, p, prm, v);
      if (al.length) html += al.map(x => `<div class="ar-warn ar-warn-${x.niveau}">${x.niveau === 'bloquant' ? '⛔' : '⚠️'} ${esc(x.texte)}</div>`).join('');

      html += `<div class="ar-actions">
        <button class="btn-primary${toutesFaites ? '' : ' is-disabled'}" id="ea-btn-next-palier" ${toutesFaites ? '' : 'disabled'}>Palier suivant →</button>
      </div>`;
    }
    html += `<button class="btn-secondary ar-btn-stop" id="ea-btn-stop">⛔ ARRÊTER L'ESSAI</button></div>`;
    host.innerHTML = html;

    _bindFrise(host);
    const on = (id, fn) => { const b = document.getElementById(id); if (b) b.addEventListener('click', fn); };
    on('ea-btn-start', _demarrerPalier);
    on('ea-btn-lecture', _enregistrerLecture);
    on('ea-btn-skip', _skipAttente);
    on('ea-btn-next-palier', () => _palierSuivant('echeance'));
    on('ea-btn-sugg-ok', () => _palierSuivant('stabilisation'));
    on('ea-btn-sugg-no', () => { const pp = _palierCourant(); pp.suggestionRefusee = Date.now(); _persistLocal(); _renderRunner(); });
    on('ea-btn-prol-ok', () => {
      const b = document.getElementById('ea-btn-prol-ok');
      _prolonger(_num(b.dataset.d), (b.dataset.l || '').split(',').map(_num).filter(x => !isNaN(x)));
    });
    on('ea-btn-prol-no', () => { const pp = _palierCourant(); pp.prolongationRefusee = Date.now(); _persistLocal(); _renderRunner(); });
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
    await _keepAwake(); await _persistLocal();
    _renderRunner();
  }

  /* Skip : l'opérateur reporte un relevé déjà noté sur papier, ou a oublié de
     lancer le chrono. On avance le chrono jusqu'à l'échéance suivante pour que
     la lecture s'ouvre tout de suite. La lecture est marquée « reportée ». */
  async function _skipAttente() {
    const p = _palierCourant(), next = _prochaineLecture(p);
    if (!p || !p.startedAt || !next) return;
    p.startedAt = Date.now() - next.tMin * 60000;
    p.skipEnCours = true;
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
    if (nbC === 2 && b.nb < 2) { alert('Deux comparateurs sont déclarés : saisissez les deux lectures.'); return; }

    const ts = Date.now();
    p.lectures.push({
      tMin: next.tMin, ts, tReelMin: p.startedAt ? (ts - p.startedAt) / 60000 : null,
      c1: c1 ? _numOrNull(c1.value) : null, c2: c2 ? _numOrNull(c2.value) : null,
      brut: b.valeur, ecart: b.ecart, y: null, corrections: [],
      skip: !!p.skipEnCours, par: AuthModule.currentName(),
    });
    p.skipEnCours = false;

    if (p.origine) {
      const o = ArrachementCalc.origineDe(e.paliers);
      if (o != null) e.origine = o;
      const ax = ArrachementCalc.controleAxialite(p, _draft.params.seuilEcartComparateursMm);
      if (ax.ok === false) {
        alert(`Écart entre comparateurs de ${_f(ax.ecart, 2)} mm au palier de serrage (seuil ${_f(ax.seuil, 2)} mm).\n\nPerte d'axialité probable : reprenez le montage avant de poursuivre.`);
      }
    }
    _recalculerY(e);
    if (c1) c1.value = ''; if (c2) c2.value = '';
    _alerted[p.id + ':' + next.tMin] = true;
    await _persistLocal();
    _renderRunner();
  }
  function _recalculerY(e) {
    (e.paliers || []).forEach(p => (p.lectures || []).forEach(l => {
      l.y = (e.origine == null) ? null : ArrachementCalc.depuisOrigine(l.brut, e.origine);
    }));
  }

  /* Une correction est un ÉVÉNEMENT HORODATÉ qui conserve la valeur d'origine :
     aucune mesure saisie n'est jamais écrasée silencieusement. */
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
    l.corrections = l.corrections || [];
    l.corrections.push({ c1: l.c1, c2: l.c2, brut: l.brut, y: l.y, ecart: l.ecart, ts: Date.now(), par: AuthModule.currentName() });
    l.c1 = _numOrNull(v1); l.c2 = _numOrNull(v2); l.brut = b.valeur; l.ecart = b.ecart;
    if (p.origine) { const o = ArrachementCalc.origineDe(e.paliers); if (o != null) e.origine = o; }
    _recalculerY(e);
    await _persistLocal();
    _renderRunner();
  }

  async function _palierSuivant(motif) {
    const e = _essai(), p = _palierCourant(), prm = _draft.params;
    if (!p.startedAt) { alert('Démarrez d\'abord le palier (à l\'atteinte de l\'effort cible).'); return; }
    if (p.final && motif === 'stabilisation') return;
    if (!p.lectures.length) { alert('Enregistrez au moins une lecture avant de clôturer le palier.'); return; }
    if (p.final && _prochaineLecture(p) &&
        !confirm('Le palier final n\'a pas été mené à son terme : l\'essai sera classé NON RECEVABLE (programme non respecté).\n\nContinuer ?')) return;
    p.endedAt = Date.now();
    p.dureeEffectiveMin = (p.endedAt - p.startedAt) / 60000;
    p.motifFin = { echeance: 'Échéance normale du palier', stabilisation: 'Anticipation sur stabilisation', manuel: 'Arrêt manuel' }[motif] || motif;
    p.alpha = ArrachementCalc.alphaPalier(p, prm);
    if (e.pIdx < e.paliers.length - 1) { e.pIdx++; _alerted = {}; }
    else { await _releaseWake(); }
    await _persistLocal();
    _renderRunner();
    if (e.pIdx === e.paliers.length - 1 && e.paliers[e.pIdx].endedAt) afficherResultats();
  }

  /* Prolongation du palier final : la durée et les temps de lecture viennent
     du programme, l'opérateur ne saisit rien. */
  async function _prolonger(dureeMin, lectures) {
    const p = _palierCourant();
    if (!p || !(dureeMin > 0)) return;
    p.dureeMin = dureeMin;
    (lectures || []).forEach(t => { if (!p.lecturesMin.includes(t)) p.lecturesMin.push(t); });
    p.lecturesMin.sort((a, b) => a - b);
    p.prolonge = true;
    p.motifProlongation = 'Déplacement non stabilisé au terme du palier — essai marqué « à examiner ».';
    await _persistLocal();
    _renderRunner();
  }

  async function arreterEssai() {
    const e = _essai();
    const rep = prompt(`Arrêter l'essai en cours.\n\nMotif :\n${MOTIFS_ARRET.map((m, i) => `${i + 1}. ${m}`).join('\n')}\n\nNuméro du motif :`, '');
    if (rep === null) return;
    let motif = MOTIFS_ARRET[parseInt(rep) - 1] || '';
    if (!motif || motif.startsWith('Autre')) motif = prompt('Précisez le motif de l\'arrêt :', motif.startsWith('Autre') ? '' : rep) || rep;
    if (!motif) return;
    e.arret = { stopped: true, motif, ts: Date.now(), par: AuthModule.currentName() };
    const p = _palierCourant();
    if (p && p.startedAt && !p.endedAt) {
      p.endedAt = Date.now();
      p.dureeEffectiveMin = (p.endedAt - p.startedAt) / 60000;
      p.motifFin = 'Arrêt de l\'essai — ' + motif;
    }
    await _releaseWake(); await _persistLocal();
    _renderRunner();
    alert('Essai interrompu. Toutes les mesures saisies sont conservées ; l\'essai est marqué incomplet avec son motif.');
  }

  /* ---- Compte à rebours : horodatages ABSOLUS, donc insensible à la mise
     en arrière-plan de l'application. ---- */
  function _startTicker() { if (_tickId) clearInterval(_tickId); _tickId = setInterval(_tick, 1000); }
  function _stopTicker() { if (_tickId) { clearInterval(_tickId); _tickId = null; } }
  function _tick() {
    const scr = document.getElementById('screen-ar-essai');
    if (!scr || !scr.classList.contains('is-active')) return;
    const e = _essai(); if (!e) return;
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
      if (!_alerted[key]) { _alerted[key] = true; _alerteLecture(); _renderRunner(); }
    }
  }
  /* Le technicien a les mains occupées : vibration + bip à chaque échéance. */
  function _alerteLecture() {
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
  async function _keepAwake() { try { if ('wakeLock' in navigator && !_wakeLock) _wakeLock = await navigator.wakeLock.request('screen'); } catch (_) {} }
  async function _releaseWake() { try { if (_wakeLock) { await _wakeLock.release(); _wakeLock = null; } } catch (_) {} }

  /* ============================================================
     PHOTOS — appareil ou galerie, sur l'essai comme sur le talus
     ============================================================ */
  /* Un seul bouton. Le champ de fichier n'a PAS l'attribut `capture` : le
     téléphone propose alors lui-même « Appareil photo » ou « Galerie », avec
     l'interface que l'opérateur connaît déjà. Rien à choisir dans l'appli. */
  function prendrePhoto(cible, momentForce) {
    _photoCible = (cible === 'talus') ? 'talus' : 'essai';
    _photoMoment = momentForce || '';
    const input = document.getElementById(_photoCible === 'talus' ? 'at-photo-input' : 'ea-photo-input');
    input.value = '';
    input.click();
  }
  /* Le moment de la photo est DÉDUIT de l'avancement de l'essai plutôt que
     choisi : avant tout chargement, dispositif en place, ou après essai.
     L'opérateur n'a qu'un bouton, la fiche garde quand même l'information. */
  function _momentAuto(e) {
    if (!e) return 'talus';
    const pf = ArrachementCalc.palierFinal(e);
    if ((pf && pf.endedAt) || (e.arret && e.arret.stopped)) return 'apres';
    if (!(e.paliers || []).some(p => p.startedAt)) return 'avant';
    return 'dispositif';
  }
  async function onPhotoSelected(file, cibleForcee) {
    if (!file) return;
    const cible = cibleForcee || _photoCible;
    const e = _essai(), t = _talus();
    const moment = _photoMoment || ((cible === 'talus') ? 'talus' : _momentAuto(e));
    if (cible === 'essai' && !e) return;
    if (cible === 'talus' && !t) return;
    try {
      const dataUrl = await _compresser(file, 1280, 0.62);
      const geo = await _geoRapide();
      const id = `${_draft.ref}#${cible === 'talus' ? t.id : 'E' + e.n}#${Date.now()}#${Math.random().toString(36).slice(2, 7)}`;
      const ph = { id, ref: _draft.ref, essaiN: cible === 'talus' ? null : e.n,
                   talusId: cible === 'talus' ? t.id : (e ? e.talusId : null),
                   moment, ts: Date.now(), geo, dataUrl };
      await CAEKDB.savePhoto(ph);
      const liste = (cible === 'talus') ? (t.photos = t.photos || []) : e.photos;
      liste.push({ id, moment, ts: ph.ts, geo });
      await _persistLocal();
      await _renderPhotos(cible);
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
  async function _renderPhotos(cible) {
    const talus = (cible === 'talus');
    const porteur = talus ? _talus() : _essai();
    const host = document.getElementById(talus ? 'at-photos' : 'ea-photos');
    if (!host || !porteur) return;
    const liste = (talus ? (porteur.photos = porteur.photos || []) : porteur.photos) || [];
    const stored = await CAEKDB.getPhotosOf(_draft.ref);
    const byId = new Map(stored.map(p => [p.id, p]));
    /* Sur un essai, on rappelle seulement ce qui manque vraiment : une photo
       avant et une photo après. Pas de liste de moments à cocher. */
    const manquants = talus ? [] : MOMENTS.filter(m => !liste.some(p => p.moment === m.code));
    host.innerHTML =
      (manquants.length ? `<div class="notice-warn">Photos attendues manquantes : ${manquants.map(m => esc(m.label)).join(', ')}.</div>` : '')
      + (liste.length
        ? `<div class="ar-photos">${liste.map(p => {
            const s = byId.get(p.id);
            const lbl = (MOMENTS.find(m => m.code === p.moment) || {}).label
                        || (p.moment === 'anomalie' ? 'Signalement' : p.moment === 'talus' ? 'Talus' : 'Photo');
            return `<figure class="ar-photo">
              ${s ? `<img src="${s.dataUrl}" alt="${esc(lbl)}" loading="lazy">` : '<div class="ar-photo-missing">image absente</div>'}
              <figcaption>${esc(lbl)}<br><small>${_hms(p.ts)}</small></figcaption>
              <button class="ar-photo-del" data-photo="${esc(p.id)}" data-cible="${talus ? 'talus' : 'essai'}" title="Supprimer">✕</button>
            </figure>`;
          }).join('')}</div>`
        : '<p class="empty-msg">Aucune photo.</p>');
    host.querySelectorAll('[data-photo]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Supprimer cette photo ?')) return;
      const id = b.dataset.photo, c = b.dataset.cible;
      await CAEKDB.deletePhoto(id);
      const p2 = (c === 'talus') ? _talus() : _essai();
      p2.photos = (p2.photos || []).filter(x => x.id !== id);
      await _persistLocal(); await _renderPhotos(c);
    }));
  }

  /* ============================================================
     ANOMALIES — sur l'essai comme sur le talus
     ============================================================ */
  let _anoCible = 'essai';
  function ouvrirAnomalie(cible) {
    _anoCible = cible || 'essai';
    const sel = document.getElementById('ar-ano-type');
    sel.innerHTML = ArrachementCalc.ANOMALIES.map(a => `<option value="${a.code}">${esc(a.label)} — ${esc(a.effet)}</option>`).join('');
    document.getElementById('ar-ano-desc').value = '';
    document.getElementById('ar-ano-gravite').value = 'majeure';
    onAnomalieType();
    document.getElementById('ar-anomalie-modal').hidden = false;
  }
  function fermerAnomalie() { document.getElementById('ar-anomalie-modal').hidden = true; }
  function onAnomalieType() {
    const def = ArrachementCalc.anomalieDef(document.getElementById('ar-ano-type').value);
    document.getElementById('ar-ano-hint').innerHTML = def
      ? `${esc(def.detail)}.<br><strong>Effet sur l'essai :</strong> ${esc(def.effet)}.` : '';
  }
  async function validerAnomalie() {
    const type = document.getElementById('ar-ano-type').value;
    if (!type) return;
    const def = ArrachementCalc.anomalieDef(type);
    const porteur = (_anoCible === 'talus') ? _talus() : _essai();
    if (!porteur) { fermerAnomalie(); return; }
    porteur.anomalies = porteur.anomalies || [];
    const p = (_anoCible === 'essai') ? _palierCourant() : null;
    porteur.anomalies.push({
      id: 'A' + Date.now(), type, gravite: document.getElementById('ar-ano-gravite').value,
      desc: document.getElementById('ar-ano-desc').value.trim(), ts: Date.now(),
      portee: _anoCible, talusId: _talusId,
      palierId: p ? p.id : '', palierCode: p ? p.code : '',
      effet: def ? def.effet : '', par: AuthModule.currentName(), photos: [],
    });
    fermerAnomalie();
    await _persistLocal();
    _renderAnomalies(_anoCible);
    if (def && (def.classe === 'non_recevable' || def.classe === 'non_realise')) {
      alert(`${def.label} enregistrée.\n\n${def.effet}. Toutes les mesures restent enregistrées.`);
    }
  }
  function _renderAnomalies(cible) {
    const talus = (cible === 'talus');
    const porteur = talus ? _talus() : _essai();
    const host = document.getElementById(talus ? 'at-anomalies' : 'ea-anomalies');
    if (!host || !porteur) return;
    const liste = porteur.anomalies || [];
    if (!liste.length) { host.innerHTML = '<p class="empty-msg">Aucun signalement.</p>'; return; }
    host.innerHTML = liste.map(a => {
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
    }).join('');
    host.querySelectorAll('[data-ano-photo]').forEach(b => b.addEventListener('click', () => prendrePhoto(cible, 'anomalie')));
    host.querySelectorAll('[data-ano-del]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Retirer ce signalement ?')) return;
      porteur.anomalies = liste.filter(a => a.id !== b.dataset.anoDel);
      await _persistLocal(); _renderAnomalies(cible);
    }));
  }

  /* ============================================================
     RÉSULTATS / CLÔTURE
     ============================================================ */
  function afficherResultats() {
    _collectIdent();
    const e = _essai(), prm = _draft.params;
    if (!e) return;
    const cl = ArrachementCalc.classer(e, prm);
    const r = cl.resultats || ArrachementCalc.compute(e, prm);
    document.getElementById('ea-results-body').innerHTML = `
      <div class="res-head"><div class="res-head-title">Clou n° ${e.n}${e.clou.repere ? ' — ' + esc(e.clou.repere) : ''}</div>
        <div class="res-head-date">${_draft.typeEssai === 'prealable' ? 'Essai préalable' : 'Essai de contrôle'} · Tmax ${_f(_tmax(), 0)} kN</div></div>
      <div class="res-lines">
        <div class="res-line"><span class="res-line-k">yp à Tmax =</span><span class="res-line-v">${_f(r.yTmax, 2)} <small>mm</small></span></div>
        <div class="res-line res-line-strong"><span class="res-line-k">α =</span><span class="res-line-v">${_f(r.alpha, 2)} <small>mm/décade</small></span></div>
        <div class="res-line"><span class="res-line-k">y rémanent =</span><span class="res-line-v">${_f(r.remanentFinal != null ? r.remanentFinal : r.remanentPa, 2)} <small>mm</small></span></div>
      </div>
      <div class="res-note">${esc(r.fluage.texte)} α mesuré entre ${_f(prm.alphaT1Min, 0)} et ${_f(r.alphaT2Min, 0)} min. ${esc(r.deplacement.texte)}</div>
      <div class="conf-global ${_classeCss(cl.classe)}">${esc(cl.label)}</div>
      ${cl.motifs.length ? `<ul class="ar-motifs">${cl.motifs.map(m => `<li>${esc(m)}</li>`).join('')}</ul>` : ''}
      <div class="curve-host">${_svgEffortDeplacement(e)}</div>
      <div class="curve-caption">Courbe effort — déplacement (points de fin de palier)</div>
      <div class="curve-host">${_svgFluage(e, prm)}</div>
      <div class="curve-caption">Déplacement — temps en échelle logarithmique sur le palier final</div>
      <button class="btn-secondary" id="ea-btn-reclasser">✎ Modifier le classement (avec justification)</button>`;
    document.getElementById('ea-results').hidden = false;
    document.getElementById('ea-btn-next').hidden = false;
    const rb = document.getElementById('ea-btn-reclasser');
    if (rb) rb.addEventListener('click', () => _reclasser(cl));
    e.result = { yTmax: r.yTmax, yMax: r.yMax, alpha: r.alpha, alphaT2Min: r.alphaT2Min,
                 remanentPa: r.remanentPa, remanentFinal: r.remanentFinal,
                 classe: e.classeManuelle || cl.classe, classeAuto: cl.classe,
                 motifs: cl.motifs, justification: e.justificationClasse || '' };
    document.getElementById('ea-results').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function _classeCss(c) {
    return { satisfaisant: 'conf-global-ok', examiner: 'ar-classe-examiner', signaler: 'ar-classe-signaler',
             non_recevable: 'conf-global-nok', non_realise: 'ar-classe-nonrealise' }[c] || '';
  }
  function _reclasser(cl) {
    const e = _essai();
    const codes = Object.keys(ArrachementCalc.CLASSES);
    const rep = prompt(`Classement automatique : ${cl.label}\n\nNouveau classement :\n${codes.map((c, i) => `${i + 1}. ${ArrachementCalc.CLASSES[c].label}`).join('\n')}\n\nNuméro :`, '');
    if (rep === null) return;
    const c = codes[parseInt(rep) - 1];
    if (!c) return;
    const just = prompt('Justification (obligatoire, conservée dans le procès-verbal) :', '');
    if (!just || !just.trim()) { alert('Justification obligatoire : classement inchangé.'); return; }
    e.classeManuelle = c; e.justificationClasse = just.trim();
    e.classePar = AuthModule.currentName(); e.classeLe = Date.now();
    _persistLocal().then(() => afficherResultats());
  }

  /* ---- Courbes ---- */
  function _svgEffortDeplacement(e) {
    const pts = ArrachementCalc.courbeEffortDeplacement(e).filter(p => p.y != null);
    if (pts.length < 2) return '<p class="empty-msg">Courbe disponible dès deux paliers clôturés.</p>';
    const W = 320, H = 220, m = { l: 42, r: 10, t: 12, b: 32 };
    const ys = pts.map(p => p.y), fs = pts.map(p => p.effort);
    const ymin = Math.min(0, ...ys), ymax = Math.max(...ys, 0.01), fmax = Math.max(...fs, 1);
    const X = y => m.l + (y - ymin) / (ymax - ymin || 1) * (W - m.l - m.r);
    const Y = f => H - m.b - (f / fmax) * (H - m.t - m.b);
    const charge = pts.filter(p => ['serrage', 'chargement', 'final'].includes(p.phase));
    const dech = pts.filter(p => ['dechargement', 'retour', 'zero'].includes(p.phase));
    const path = l => l.map((p, i) => `${i ? 'L' : 'M'}${X(p.y).toFixed(1)},${Y(p.effort).toFixed(1)}`).join(' ');
    const dots = (l, c) => l.map(p => `<circle cx="${X(p.y).toFixed(1)}" cy="${Y(p.effort).toFixed(1)}" r="3.2" fill="${c}"/>`).join('');
    const gridY = [0, 0.25, 0.5, 0.75, 1].map(f => {
      const yy = Y(f * fmax);
      return `<line x1="${m.l}" y1="${yy}" x2="${W - m.r}" y2="${yy}" stroke="#eee"/><text x="${m.l - 5}" y="${yy + 4}" text-anchor="end" font-size="9" fill="#888">${(f * fmax).toFixed(0)}</text>`;
    }).join('');
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Courbe effort déplacement">
      ${gridY}
      <line x1="${m.l}" y1="${H - m.b}" x2="${W - m.r}" y2="${H - m.b}" stroke="#bbb"/>
      <line x1="${m.l}" y1="${m.t}" x2="${m.l}" y2="${H - m.b}" stroke="#bbb"/>
      <path d="${path(charge)}" fill="none" stroke="#CC0000" stroke-width="2"/>
      <path d="${path(dech)}" fill="none" stroke="#0b5394" stroke-width="2" stroke-dasharray="4 3"/>
      ${dots(charge, '#CC0000')}${dots(dech, '#0b5394')}
      <text x="${W / 2}" y="${H - 4}" text-anchor="middle" font-size="10" fill="#555">Déplacement y (mm)</text>
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
    const a = ArrachementCalc.alphaPalier(pf, prm);
    let pente = '';
    if (a != null) {
      /* La droite est tracée sur la fenêtre réellement utilisée par le calcul :
         ancrage à alphaT1Min, et non à la première lecture. */
      const tAnc = _num(prm && prm.alphaT1Min) > 0 ? _num(prm.alphaT1Min) : 2;
      const t2 = Math.max(...ts);
      const t1 = Math.max(Math.min(...ts), Math.min(tAnc, t2));
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

  /* Fin d'essai : un simple rappel de remise en état, pas une étape. */
  async function enregistrerEtSuivant() {
    const e = _essai();
    if (!e || !e.result) { alert('Affichez d\'abord les résultats.'); return; }
    _collectIdent();
    const pf = ArrachementCalc.palierFinal(e);
    const complet = !!(pf && pf.endedAt) && !e.arret.stopped;
    const irrealisable = (e.anomalies || []).some(a => a.type === 'irrealisable');
    if (!complet && !irrealisable &&
        !confirm('Le programme n\'a pas été mené à son terme.\nL\'essai sera enregistré comme INCOMPLET, avec toutes ses mesures.\n\nContinuer ?')) return;
    if (!confirm('Avant d\'enregistrer :\n\n• plaque reposée en contact avec le parement\n• écrou resserré\n• dispositif replié\n\nConfirmer ?')) return;
    e.incomplet = !complet && !irrealisable;
    if (e.meteo && !_draft.meteo) _draft.meteo = e.meteo;
    await _cloturerEssai(!e.incomplet || irrealisable);
    renderTalus();
    AppNav.goto('screen-ar-talus');
  }
  /* Clôture commune : pousse l'essai, met à jour le compteur du talus (sauf
     essai non exploitable), recalcule le statut, purge l'essai courant. */
  async function _cloturerEssai(decompter) {
    const e = _essai(); if (!e) return;
    _stopTicker(); await _releaseWake();
    e.done = true;
    if (decompter) {
      const t = _talusById(e.talusId);
      if (t) t.nbFait = (t.nbFait || 0) + 1;
    }
    _draft.essais = _draft.essais || [];
    _draft.essais.push(e);
    _draft.essais.sort((a, b) => a.n - b.n);
    _draft.enCours = null;
    _majStatut();
    _alerted = {};
    await _persist();
  }
  function _majStatut() {
    const complet = _draft.talus.every(t => (t.nbFait || 0) >= (t.nbPrevu || 0));
    _draft.statut = complet ? 'brouillon' : 'incomplet';
  }

  async function suspendre() {
    if (!confirm('Suspendre la campagne ? Toutes les mesures saisies sont enregistrées, y compris le palier en cours.')) return;
    if (_draft.enCours) _collectIdent();
    _stopTicker(); await _releaseWake();
    _majStatut();
    await _persist();
    AppNav.goto('screen-repertoire'); RepertoireModule.load();
  }

  /* Sauvegarde locale silencieuse : un essai en cours ne doit jamais être
     perdu, y compris si l'appli est fermée pendant un palier. */
  function autosave() {
    if (!_draft || !_draft.ref) return;
    try { if (_draft.enCours) _collectIdent(); } catch (_) {}
    _majStatut();
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
    await SyncModule.sendFiche('save', _draft.ref, 'arrachement', FicheModule.buildArrachement(_draft));
  }

  /* ============================================================
     Utilitaires
     ============================================================ */
  function _g(id) { const el = document.getElementById(id); return el ? String(el.value).trim() : ''; }
  function _v(id, val) { const el = document.getElementById(id); if (el) el.value = (val == null ? '' : val); }
  function _todayDate() { return new Date().toISOString().slice(0, 10); }
  function _nowTime() { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }
  function _hms(ts) { if (!ts) return '—'; const d = new Date(ts); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`; }
  function _dateFr(s) { if (!s) return '—'; const p = String(s).split('-'); return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : s; }
  function _num(v) { if (v === '' || v == null) return NaN; return parseFloat(String(v).replace(',', '.')); }
  function _numOrNull(v) { const x = _num(v); return isNaN(x) ? null : x; }
  function _f(v, d) { return ArrachementCalc.fmt(v, d); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  return {
    nouvelle, reprendre, nextStep, prevStep,
    setProjetMode, onSelClient, onSelProjet, onCodeInput, toggleRefManuelle,
    setTypeEssai, onNbTalus, toggleParamsPerso, toggleStabilisation, onProgrammeChange,
    toggleCapteur, setNbComparateurs, toggleEtalonnage, onMaterielChange,
    renderPlan, organiser, choisirTalus, renderTalus, checkSecurite, demarrerEssai,
    toggleClouDetails, localiserGPS, prendrePhoto, onPhotoSelected,
    ouvrirAnomalie, fermerAnomalie, onAnomalieType, validerAnomalie,
    afficherResultats, enregistrerEtSuivant, suspendre, autosave,
  };
})();
