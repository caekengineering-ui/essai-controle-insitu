'use strict';
/* ============================================================
   Contrôle photovoltaïque CFMS — moteur de campagne.

   Protocole guidé : 5 % ELS pendant 1 min -> décharge -> 110 % ELS
   pendant 5 min -> décharge finale. La compression est exclue.

   Principes de robustesse (repris du module arrachement) :
   - L'essai en cours vit dans _d.cfms.enCours : il est donc persisté par
     CHAQUE save(), et une fermeture d'appli ne perd jamais un palier.
   - Le chrono ne touche QUE le textContent de #cfms-chrono. Le bloc
     #cfms-runner n'est reconstruit que sur changement d'état, sinon les
     champs de saisie seraient détruits sous les doigts de l'opérateur.
   - L'état d'une phase est DÉRIVÉ (etatPhase), jamais stocké en double.
   - Les sous-champs sont référencés par id, jamais par index : réorganiser
     le plan ne doit pas déplacer les quotas ni l'historique.
   ============================================================ */
const CfmsModule = (() => {

  /* ---- Protocole (une seule table, décharges comprises) ----
     Une décharge est simplement une phase de durée nulle avec une lecture
     à t = 0 : aucun cas particulier, donc aucune impasse possible. */
  const PHASES = [
    { id: 'p5',   label: '5 % ELS',          ratio: 0.05, dureeMin: 1, lectures: [0, 1] },
    { id: 'd1',   label: 'Décharge P1',      ratio: 0,    dureeMin: 0, lectures: [0] },
    { id: 'p110', label: '110 % ELS',        ratio: 1.10, dureeMin: 5, lectures: [0, 1, 2, 3, 4, 5] },
    { id: 'df',   label: 'Décharge finale',  ratio: 0,    dureeMin: 0, lectures: [0] },
  ];
  const CRITERE_LATERAL_MM = 5;      // CFMS : déplacement résiduel admissible
  const TOLERANCE_REPRISE_S = 300;   // au-delà, un palier interrompu n'est plus valable

  let _d = null;            // campagne courante
  let _step = 0;            // étape de l'assistant (0..2)
  let _scId = null;         // id du sous-champ sélectionné
  let _tickId = null;
  let _wakeLock = null;
  let _cleRendu = null;     // clé d'état du dernier rendu du runner
  let _alertees = {};       // lectures déjà signalées (bip/vibration)
  let _organise = false;
  let _selId = null;        // sous-champ sélectionné en mode organisation

  /* ============================================================
     CRÉATION / REPRISE
     ============================================================ */
  function nouvelle() {
    _d = {
      type: 'cfms', ref: '', version: 1, statut: 'incomplet',
      codeProjet: '', client: '', nomProjet: '', lieu: '', entreprise: {}, auto: 'Non',
      createdAt: Date.now(),
      cfms: {
        nbSc: 26, nbL: 2, nbT: 2,
        elsKn: '', diamDefaut: '', longDefaut: '',
        equipement: {
          verinModele: '', aeffMm2: '', capaciteKN: '', pmaxBar: '', aeffManuelle: false,
          compType: 'Numérique', compNb: 2, precision: '1/100 mm', compModele: '',
          pompe: 'Manuelle', manoMaxBar: 700, manoModele: '',
        },
        sousChamps: [], enCours: null, complete: false,
      },
      essais: [],
    };
    _step = 0; _scId = null; _organise = false; _selId = null;
    renderSetup();
    AppNav.goto('screen-cfms');
  }

  async function reprendre(ref) {
    const c = await CAEKDB.getCampagne(ref);
    if (!c) return;
    if (c.statut === 'valide') { alert('Cette campagne est validée et ne peut plus être modifiée.'); return; }
    _d = JSON.parse(JSON.stringify(c));
    _d.cfms = _d.cfms || {};
    _d.cfms.sousChamps = _d.cfms.sousChamps || [];
    _d.cfms.equipement = _d.cfms.equipement || {};
    _d.essais = _d.essais || [];
    _organise = false; _selId = null; _cleRendu = null; _alertees = {};

    /* Reprise d'un essai en cours : on ne repasse pas par l'assistant. */
    const e = _d.cfms.enCours;
    if (e) {
      _scId = e.sousChampId;
      if (!(await _verifierPalierRepris(e))) return;
      renderTest();
      AppNav.goto('screen-cfms-essai');
      return;
    }
    if (_d.cfms.sousChamps.length) { renderPlan(); AppNav.goto('screen-cfms-plan'); return; }
    _step = 0; renderSetup(); AppNav.goto('screen-cfms');
  }

  /* Un palier chargé la veille n'est plus sous charge : il ne peut pas
     simplement « continuer ». On laisse l'opérateur trancher. */
  async function _verifierPalierRepris(e) {
    const p = PHASES[e.phase];
    if (!e.phaseStartedAt || !p) return true;
    const ecoule = (Date.now() - e.phaseStartedAt) / 1000;
    if (ecoule <= p.dureeMin * 60 + TOLERANCE_REPRISE_S) return true;

    const msg = `Le palier « ${p.label} » a été chargé il y a ${_dureeLisible(ecoule)}.\n\n`
      + 'La charge n\'est plus maintenue : ce palier ne peut pas être poursuivi.\n\n'
      + 'OK  = reprendre CE micropieu depuis le début (lectures effacées)\n'
      + 'Annuler = marquer l\'essai non exploitable et revenir au plan';
    if (confirm(msg)) {
      e.phase = 0; e.phaseStartedAt = null; e.lectures = [];
      _cleRendu = null; _alertees = {};
      await save();
      return true;
    }
    e.incomplet = true;
    e.motifIncomplet = 'Palier interrompu — charge relâchée avant la fin';
    await _cloturer(e, false);          // sans décrémenter le quota
    renderPlan();
    AppNav.goto('screen-cfms-plan');
    return false;
  }

  /* ============================================================
     ASSISTANT — étapes 1 à 3
     ============================================================ */
  async function renderSetup() {
    const ps = await Referentiel.getActiveProjets();
    const cs = await Referentiel.getActiveClients();
    _setOpts('cfms-client', cs.map(x => [x.id, x.nom]), '— Choisir un client —');
    _setOpts('cfms-code-list', ps.map(x => [x.codeProjet, `${x.codeProjet} — ${x.nomProjet || ''}`]), '', true);
    _remplirVerins();

    const c = _d.cfms, e = c.equipement;
    _val('cfms-code', _d.codeProjet);
    _val('cfms-nb-sc', c.nbSc); _val('cfms-nb-l', c.nbL); _val('cfms-nb-t', c.nbT);
    _val('cfms-els', c.elsKn); _val('cfms-diam-defaut', c.diamDefaut); _val('cfms-long-defaut', c.longDefaut);
    _val('cfms-verin', e.verinModele); _val('cfms-aeff', e.aeffMm2);
    _val('cfms-comp-type', e.compType); _val('cfms-comp-nb', e.compNb);
    _val('cfms-comp-precision', e.precision); _val('cfms-comp-modele', e.compModele);
    _val('cfms-pompe', e.pompe); _val('cfms-mano-max', e.manoMaxBar); _val('cfms-mano-modele', e.manoModele);
    onVerin();
    _showStep();
    if (_d.codeProjet) await _setProject(_d.codeProjet);
  }

  /* La base vérins est celle du module arrachement : un seul référentiel
     matériel pour toute l'application. */
  function _remplirVerins() {
    const list = (typeof ArrachementCalc !== 'undefined') ? ArrachementCalc.verins() : [];
    const opts = list.map(v => [v.modele, `${v.marque} ${v.modele} — ${v.surfaceCm2} cm² — ${v.capaciteKN} kN`]);
    opts.push(['AUTRE', 'Autre modèle (saisie manuelle)']);
    _setOpts('cfms-verin', opts, '— Choisir —');
  }

  /* Sélection d'un vérin connu -> Aeff déduite et VERROUILLÉE.
     « Autre » -> champ déverrouillé, saisie manuelle obligatoire.
     Évite l'erreur de reprendre la surface d'un autre modèle. */
  function onVerin() {
    const modele = _val('cfms-verin');
    const champ = document.getElementById('cfms-aeff');
    const hint = document.getElementById('cfms-aeff-hint');
    const v = (modele && modele !== 'AUTRE' && typeof ArrachementCalc !== 'undefined')
      ? ArrachementCalc.getVerin(modele) : null;

    if (v) {
      const mm2 = Math.round(v.surfaceCm2 * 100);
      champ.value = String(mm2);
      champ.readOnly = true; champ.classList.add('is-locked');
      if (hint) hint.textContent = `Déduit du ${v.marque} ${v.modele} : ${v.surfaceCm2} cm² · capacité ${v.capaciteKN} kN · ${v.pmaxBar} bar max.`;
      _d.cfms.equipement.aeffManuelle = false;
      _d.cfms.equipement.capaciteKN = v.capaciteKN;
      _d.cfms.equipement.pmaxBar = v.pmaxBar;
    } else {
      champ.readOnly = false; champ.classList.remove('is-locked');
      if (hint) hint.textContent = modele === 'AUTRE'
        ? 'Modèle non répertorié : saisissez la surface effective du vérin.'
        : 'Choisissez un vérin pour renseigner automatiquement la surface.';
      _d.cfms.equipement.aeffManuelle = true;
      _d.cfms.equipement.capaciteKN = ''; _d.cfms.equipement.pmaxBar = '';
    }
  }

  function _showStep() {
    ['projet', 'campagne', 'equipement'].forEach((x, i) => {
      const el = document.getElementById('cfms-step-' + x); if (el) el.hidden = (i !== _step);
    });
    document.querySelectorAll('#cfms-stepper .step-item').forEach((x, i) => {
      x.classList.toggle('is-active', i === _step); x.classList.toggle('is-done', i < _step);
    });
    document.getElementById('cfms-prev').hidden = !_step;
    document.getElementById('cfms-next').textContent = _step === 2 ? 'Créer la campagne' : 'Suivant';
  }

  async function onClient() {
    const id = _val('cfms-client');
    const ps = id ? await Referentiel.getProjetsOfClient(id) : [];
    _setOpts('cfms-projet', ps.map(x => [x.codeProjet, `${x.nomProjet || x.codeProjet} — ${x.codeProjet}`]), '— Choisir un projet —');
    document.getElementById('cfms-projet').disabled = !id;
  }
  async function onProjet() { await _setProject(_val('cfms-projet')); }
  async function onCode()   { await _setProject(_val('cfms-code').toUpperCase()); }

  /* Un code inconnu doit VIDER le projet courant : sinon l'ancien code reste
     en place et la campagne part sur le mauvais projet sans rien signaler. */
  async function _setProject(code) {
    const bloc = document.getElementById('cfms-proj-info');
    const p = code ? await Referentiel.getProjet(code) : null;
    if (!p || p.actif === false) {
      _d.codeProjet = ''; _d.client = ''; _d.nomProjet = ''; _d.lieu = ''; _d.entreprise = {};
      bloc.hidden = true;
      if (code) bloc.parentNode && _hint('cfms-proj-hint', 'Projet inconnu ou inactif. Ajoutez-le dans Admin → Projets.', true);
      return;
    }
    _hint('cfms-proj-hint', '', false);
    _d.codeProjet = p.codeProjet;
    _d.client = p.client || '';
    _d.nomProjet = p.nomProjet || '';
    _d.lieu = [p.lieu, p.wilaya].filter(Boolean).join(' — ');
    _d.auto = p.controle === false ? 'Oui' : 'Non';
    _d.entreprise = _d.auto === 'Oui' ? ((await Referentiel.getEntrepriseForProjet(p)) || {}) : {};
    _val('cfms-code', _d.codeProjet);
    _val('cfms-client', p.clientId || p.client);
    await onClient();
    _val('cfms-projet', _d.codeProjet);
    bloc.hidden = false;
    bloc.innerHTML =
      `<div class="info-locked"><span class="info-label">Client</span><span>${_esc(_d.client)}</span></div>` +
      `<div class="info-locked"><span class="info-label">Projet</span><span>${_esc(_d.nomProjet)}</span></div>` +
      `<div class="info-locked"><span class="info-label">Lieu</span><span>${_esc(_d.lieu || '—')}</span></div>` +
      `<div class="info-locked"><span class="info-label">Code</span><span>${_esc(_d.codeProjet)}</span></div>`;
  }

  async function next() {
    if (_step === 0) {
      if (!_d.codeProjet) { alert('Choisissez un client puis un projet, ou introduisez le code projet.'); return; }
    }
    if (_step === 1) {
      const c = _d.cfms;
      c.nbSc = +_val('cfms-nb-sc'); c.nbL = +_val('cfms-nb-l'); c.nbT = +_val('cfms-nb-t');
      c.elsKn = +_val('cfms-els');
      c.diamDefaut = _val('cfms-diam-defaut'); c.longDefaut = _val('cfms-long-defaut');
      if (!c.nbSc || (!c.nbL && !c.nbT)) { alert('Définissez les sous-champs et au moins un essai.'); return; }
      if (!(c.elsKn > 0)) { alert('Indiquez l\'ELS caractéristique de la campagne (kN).'); return; }
      if (_d.essais.length && c.nbSc < _d.cfms.sousChamps.length) {
        alert('Des essais sont déjà réalisés : le nombre de sous-champs ne peut plus être réduit.'); return;
      }
    }
    if (_step === 2) {
      const e = _d.cfms.equipement;
      e.verinModele = _val('cfms-verin');
      e.aeffMm2 = +_val('cfms-aeff');
      e.compType = _val('cfms-comp-type'); e.compNb = +_val('cfms-comp-nb');
      e.precision = _val('cfms-comp-precision'); e.compModele = _val('cfms-comp-modele');
      e.pompe = _val('cfms-pompe'); e.manoMaxBar = +_val('cfms-mano-max'); e.manoModele = _val('cfms-mano-modele');
      if (!e.verinModele || !(e.aeffMm2 > 0) || !(e.manoMaxBar > 0)) {
        alert('Complétez le vérin, sa surface effective et le manomètre.'); return;
      }
      const ctrl = _controlePression();
      if (ctrl && !confirm(ctrl + '\n\nCréer la campagne malgré tout ?')) return;
      _majSousChamps();
      await save();
      renderPlan();
      AppNav.goto('screen-cfms-plan');
      return;
    }
    _step++; _showStep();
  }
  function prev() { if (_step) { _step--; _showStep(); } }

  /* Vérifie que le palier le plus haut (110 % ELS) reste dans les capacités
     du matériel : au-delà, l'essai est infaisable, voire dangereux. */
  function _controlePression() {
    const c = _d.cfms, e = c.equipement;
    const fMax = c.elsKn * 1.10;
    const barMax = _bar(fMax, e.aeffMm2);
    const msgs = [];
    if (e.manoMaxBar && barMax > e.manoMaxBar) {
      msgs.push(`Pression à 110 % ELS : ${barMax.toFixed(0)} bar > manomètre ${e.manoMaxBar} bar.`);
    }
    if (e.pmaxBar && barMax > e.pmaxBar) {
      msgs.push(`Pression à 110 % ELS : ${barMax.toFixed(0)} bar > pression max vérin ${e.pmaxBar} bar.`);
    }
    if (e.capaciteKN && fMax > e.capaciteKN) {
      msgs.push(`Effort à 110 % ELS : ${fMax.toFixed(1)} kN > capacité vérin ${e.capaciteKN} kN.`);
    }
    return msgs.length ? '⚠️ ' + msgs.join('\n') : '';
  }

  /* Complète la grille sans jamais écraser un sous-champ déjà entamé. */
  function _majSousChamps() {
    const c = _d.cfms;
    for (let i = c.sousChamps.length; i < c.nbSc; i++) {
      c.sousChamps.push({
        id: 'SC' + String(i + 1).padStart(2, '0'), ordre: i,
        lRest: c.nbL, tRest: c.nbT, lFait: 0, tFait: 0,
      });
    }
    c.sousChamps.forEach(s => {
      if (!s.lFait && !s.tFait) { s.lRest = c.nbL; s.tRest = c.nbT; }
      if (s.ordre === undefined) s.ordre = c.sousChamps.indexOf(s);
    });
  }

  /* ============================================================
     PLAN DE MASSE
     ============================================================ */
  function _ordonnes() { return [..._d.cfms.sousChamps].sort((a, b) => a.ordre - b.ordre); }

  function renderPlan() {
    const c = _d.cfms;
    document.getElementById('cfms-plan-info').innerHTML =
      `<div class="info-locked"><span class="info-label">${_esc(_d.codeProjet)}</span><span>${_esc(_d.nomProjet)}</span></div>` +
      `<div class="info-locked"><span class="info-label">ELS</span><span>${_esc(c.elsKn)} kN</span></div>` +
      `<div class="info-locked"><span class="info-label">Vérin</span><span>${_esc(c.equipement.verinModele)} — ${_esc(c.equipement.aeffMm2)} mm²</span></div>`;

    const restants = c.sousChamps.reduce((n, s) => n + s.lRest + s.tRest, 0);
    const total = c.nbSc * (c.nbL + c.nbT);
    document.getElementById('cfms-plan-progress').textContent =
      `${total - restants} / ${total} essais réalisés`;

    const btn = document.getElementById('cfms-organiser');
    btn.textContent = _organise ? '✓ Terminer l\'organisation' : '↕ Organiser le plan';
    btn.classList.toggle('is-active', _organise);
    document.getElementById('cfms-plan-hint').textContent = _organise
      ? 'Touchez deux sous-champs pour les permuter, ou faites-les glisser.'
      : 'Touchez un sous-champ pour commencer ou poursuivre un essai.';

    document.getElementById('cfms-grid').innerHTML = _ordonnes().map(s => {
      const fini = !(s.lRest + s.tRest);
      const sel = _organise && _selId === s.id;
      return `<button class="cfms-cell${fini ? ' is-done' : ''}${sel ? ' is-selected' : ''}" data-sc="${_esc(s.id)}">`
        + `<strong>${_esc(s.id)}</strong>`
        + `<span class="cfms-cell-q"><b class="${s.lRest ? '' : 'q-ok'}">L ${s.lRest}</b> · <b class="${s.tRest ? '' : 'q-ok'}">T ${s.tRest}</b></span>`
        + `</button>`;
    }).join('');

    document.getElementById('cfms-grid').classList.toggle('is-organise', _organise);
    _brancherCellules();
  }

  /* Réorganisation compatible tactile : les événements HTML5 drag/drop ne se
     déclenchent pas sur mobile. On utilise les Pointer Events, avec repli
     « toucher A puis toucher B » pour une manipulation avec des gants. */
  function _brancherCellules() {
    document.querySelectorAll('.cfms-cell').forEach(cell => {
      const id = cell.dataset.sc;
      if (!_organise) { cell.onclick = () => choose(id); return; }
      cell.onclick = null;
      let x0 = 0, y0 = 0, bouge = false;
      cell.onpointerdown = ev => {
        x0 = ev.clientX; y0 = ev.clientY; bouge = false;
        cell.classList.add('is-drag');
      };
      cell.onpointermove = ev => {
        if (!cell.classList.contains('is-drag')) return;
        if (Math.abs(ev.clientX - x0) > 12 || Math.abs(ev.clientY - y0) > 12) bouge = true;
      };
      cell.onpointerup = ev => {
        cell.classList.remove('is-drag');
        if (bouge) {
          const cible = document.elementFromPoint(ev.clientX, ev.clientY);
          const dest = cible && cible.closest('.cfms-cell');
          if (dest && dest.dataset.sc !== id) { _permuter(id, dest.dataset.sc); return; }
          return;
        }
        if (_selId && _selId !== id) _permuter(_selId, id);
        else { _selId = (_selId === id) ? null : id; renderPlan(); }
      };
      cell.onpointercancel = () => cell.classList.remove('is-drag');
    });
  }

  /* On échange les positions d'affichage, PAS les objets : les quotas et
     l'historique restent attachés à leur sous-champ. */
  function _permuter(idA, idB) {
    const a = _d.cfms.sousChamps.find(s => s.id === idA);
    const b = _d.cfms.sousChamps.find(s => s.id === idB);
    if (!a || !b) return;
    const t = a.ordre; a.ordre = b.ordre; b.ordre = t;
    _selId = null;
    renderPlan();
    save();
  }

  function organiser() { _organise = !_organise; _selId = null; renderPlan(); }

  function choose(id) {
    const s = _d.cfms.sousChamps.find(x => x.id === id);
    if (!s) return;
    _scId = id;
    document.getElementById('cfms-choix-title').textContent = s.id;
    document.getElementById('cfms-choix-info').innerHTML =
      `<div class="info-locked"><span class="info-label">Essais restants</span>`
      + `<span>Latéral : ${s.lRest} · Traction : ${s.tRest}</span></div>`;
    const bl = document.getElementById('cfms-start-l'), bt = document.getElementById('cfms-start-t');
    bl.disabled = !s.lRest; bt.disabled = !s.tRest;
    _renderEssaisDuSc(id);
    AppNav.goto('screen-cfms-choix');
  }

  /* Essais déjà réalisés sur ce sous-champ : un brouillon se rouvre, un essai
     validé est verrouillé jusqu'à un renvoi du responsable. */
  function _renderEssaisDuSc(id) {
    const zone = document.getElementById('cfms-choix-essais'); if (!zone) return;
    const list = (_d.essais || []).filter(e => e.sousChampId === id);
    if (!list.length) { zone.innerHTML = ''; return; }
    zone.innerHTML = `<p class="cfms-recap-titre">Essais réalisés sur ce sous-champ</p>`
      + list.map(e => {
        const r = e.resultat || {};
        const renvoi = (e.renvois || []).slice(-1)[0];
        const badge = e.incomplet ? `<span class="badge badge-incomplet">Non exploitable</span>`
          : e.statut === 'valide' ? `<span class="badge badge-valide">Validé 🔒</span>`
          : `<span class="badge badge-brouillon">Brouillon</span>`;
        const val = r.dResiduel != null ? `${r.dResiduel} mm` : (r.dMax != null ? `${r.dMax} mm` : '—');
        const admin = (typeof AuthModule !== 'undefined') && AuthModule.isAdmin();
        return `<button class="cfms-essai-item" data-n="${e.n}"${e.statut === 'valide' || e.incomplet ? ' disabled' : ''}>`
          + `<div><b>n° ${e.n} — ${_esc(e.typeEssai)}</b> ${badge}</div>`
          + `<div class="cfms-essai-sub">${_esc(e.date)} · résiduel ${val}`
          + (renvoi ? ` · <span class="cfms-renvoi">↩ ${_esc(renvoi.commentaire)}</span>` : '')
          + `</div></button>`
          /* Renvoi : réservé au responsable, seul moyen de rouvrir un essai validé. */
          + ((admin && e.statut === 'valide') ? `<div class="cfms-renvoi-bloc">`
              + `<button class="btn-ghost cfms-renvoi-open" data-n="${e.n}">↩ Renvoyer à l'opérateur</button>`
              + `<div class="cfms-renvoi-form" id="cfms-renvoi-form-${e.n}" hidden>`
              + `<input id="cfms-renvoi-txt-${e.n}" placeholder="Motif du renvoi (obligatoire)">`
              + `<button class="btn-secondary cfms-renvoi-go" data-n="${e.n}">Confirmer le renvoi</button>`
              + `</div></div>` : '');
      }).join('');
    zone.querySelectorAll('.cfms-essai-item').forEach(b => {
      b.onclick = () => reviser(+b.dataset.n);
    });
    zone.querySelectorAll('.cfms-renvoi-open').forEach(b => {
      b.onclick = () => { const f = document.getElementById('cfms-renvoi-form-' + b.dataset.n); f.hidden = !f.hidden; };
    });
    zone.querySelectorAll('.cfms-renvoi-go').forEach(b => {
      b.onclick = () => renvoyer(+b.dataset.n, _val('cfms-renvoi-txt-' + b.dataset.n));
    });
  }

  /* Le responsable renvoie un essai validé : il redevient un brouillon
     modifiable, avec le motif attaché. */
  async function renvoyer(n, commentaire) {
    if (!AuthModule.isAdmin()) return;
    if (!commentaire) { alert('Indiquez le motif du renvoi.'); return; }
    const e = (_d.essais || []).find(x => x.n === n);
    if (!e || e.statut !== 'valide') return;
    e.statut = 'brouillon';
    e.renvois = e.renvois || [];
    e.renvois.push({ par: AuthModule.currentName(), commentaire, ts: Date.now() });
    e.valideLe = null; e.validePar = '';
    _majStatutCampagne();
    await save();
    _renderEssaisDuSc(_scId);
    alert('Essai renvoyé à l\'opérateur. Il est de nouveau modifiable.');
  }

  /* Rouvre un essai en brouillon pour correction complète. */
  function reviser(n) {
    const e = (_d.essais || []).find(x => x.n === n);
    if (!e) return;
    if (e.statut === 'valide') { alert('Essai validé : il ne peut plus être modifié sans un renvoi du responsable.'); return; }
    _d.essais = _d.essais.filter(x => x.n !== n);
    e.revision = true;
    _d.cfms.enCours = e;
    _scId = e.sousChampId;
    _cleRendu = null; _alertees = {};
    save();                       // la révision doit survivre à une fermeture
    renderTest();
    AppNav.goto('screen-cfms-essai');
  }

  /* ============================================================
     ESSAI
     ============================================================ */
  function start(kind) {
    const s = _d.cfms.sousChamps.find(x => x.id === _scId);
    if (!s) return;
    if (kind === 'l' && !s.lRest) { alert('Quota d\'essais latéraux atteint sur ce sous-champ.'); return; }
    if (kind === 't' && !s.tRest) { alert('Quota d\'essais de traction atteint sur ce sous-champ.'); return; }

    _d.cfms.enCours = {
      n: (_d.essais || []).length + 1,
      typeEssai: kind === 'l' ? 'Horizontal' : 'Traction verticale',
      sousChampId: s.id,
      date: _date(), heure: _heure(), heureFin: '',
      micropieu: { diam: _d.cfms.diamDefaut || '', long: _d.cfms.longDefaut || '',
                   table: '', rangee: '', position: '', gps: '', horsDefaut: false },
      origine: { l1: '', l2: '', l3: '' },
      elsKn: _d.cfms.elsKn,           // figé : modifier la campagne ensuite ne réécrit pas cet essai
      phase: 0, phaseStartedAt: null, lectures: [],
      incomplet: false, motifIncomplet: '', done: false,
    };
    _cleRendu = null; _alertees = {};
    renderTest();
    AppNav.goto('screen-cfms-essai');
  }

  function renderTest() {
    const e = _d.cfms.enCours; if (!e) return;
    const eq = _d.cfms.equipement;
    document.getElementById('cfms-essai-title').textContent = `${e.sousChampId} — ${e.typeEssai}`;
    document.getElementById('cfms-essai-info').textContent =
      `${_d.codeProjet} · ELS ${e.elsKn} kN · ${eq.verinModele} · ${eq.compNb} comparateur(s)`;

    ['diam', 'long', 'table', 'rangee', 'position', 'gps'].forEach(k => _val('cfms-' + k, e.micropieu[k]));
    _val('cfms-date', e.date); _val('cfms-heure', e.heure);

    /* Les lectures d'origine sont TOUJOURS repositionnées depuis l'essai :
       sans cela, celles du micropieu précédent seraient réutilisées. */
    _val('cfms-zero-l1', e.origine.l1); _val('cfms-zero-l2', e.origine.l2); _val('cfms-zero-l3', e.origine.l3);
    document.getElementById('cfms-zero-l3-wrap').hidden = eq.compNb < 3;

    /* En révision, l'identification et l'origine restent ouvertes : c'est le
       seul moyen de rattraper un zéro mal saisi. */
    const demarre = !!e.phaseStartedAt || e.lectures.length > 0 || e.origine.l1 !== '';
    document.getElementById('cfms-test-ident').classList.toggle('is-collapsed', demarre && !e.revision);
    document.getElementById('cfms-start-test').textContent = e.revision
      ? '↻ Appliquer l\'origine corrigée' : '▶ Enregistrer l\'origine et commencer';
    document.getElementById('cfms-runner').hidden = !demarre;
    if (demarre) { _render(); if (!e.revision) _startTicker(); else _stopTicker(); }
  }

  function _collect() {
    const e = _d.cfms.enCours; if (!e) return;
    ['diam', 'long', 'table', 'rangee', 'position', 'gps'].forEach(k => e.micropieu[k] = _val('cfms-' + k));
    e.micropieu.horsDefaut = (String(e.micropieu.diam) !== String(_d.cfms.diamDefaut))
                          || (String(e.micropieu.long) !== String(_d.cfms.longDefaut));
    e.date = _val('cfms-date'); e.heure = _val('cfms-heure');
  }

  async function begin() {
    const e = _d.cfms.enCours; if (!e) { alert('Aucun essai en cours.'); return; }
    _collect();
    if (!e.micropieu.diam || !e.micropieu.long) { alert('Indiquez le diamètre et la longueur du micropieu.'); return; }
    const l1 = _val('cfms-zero-l1'), l2 = _val('cfms-zero-l2'), l3 = _val('cfms-zero-l3');
    if (l1 === '' || l2 === '') { alert('Saisissez les lectures initiales L1 et L2.'); return; }
    if (_d.cfms.equipement.compNb >= 3 && l3 === '') { alert('Saisissez aussi la lecture initiale L3.'); return; }
    e.origine = { l1, l2, l3 };
    /* En révision : on ne relance pas l'essai, on recalcule sur la nouvelle
       origine et on reste dans la liste des lectures. */
    if (e.revision) {
      _recalculer(e);
      _cleRendu = null;
      await save();
      _render();
      alert('Origine appliquée. Les déplacements corrigés ont été recalculés.');
      return;
    }
    e.phase = 0; e.phaseStartedAt = null;
    _cleRendu = null; _alertees = {};
    document.getElementById('cfms-test-ident').classList.add('is-collapsed');
    document.getElementById('cfms-runner').hidden = false;
    await save();
    await _keepAwake();
    _render();
    _startTicker();
  }

  /* ---- État dérivé d'une phase (aucune impasse : les décharges suivent
         exactement le même chemin que les paliers) ---- */
  function _etatPhase(p, e) {
    const faites = new Set(e.lectures.filter(x => x.phase === p.id).map(x => x.t));
    if (p.dureeMin > 0 && !e.phaseStartedAt) return { etat: 'ARMEMENT', sec: 0 };
    const sec = e.phaseStartedAt ? (Date.now() - e.phaseStartedAt) / 1000 : 0;
    const t = p.lectures.find(x => !faites.has(x) && x * 60 <= sec);
    if (t !== undefined) return { etat: 'LECTURE_DUE', t, sec };
    if (faites.size < p.lectures.length) return { etat: 'ATTENTE', sec };
    return { etat: 'TERMINEE', sec };
  }

  function _bar(forceKn, aeffMm2) { return (aeffMm2 > 0) ? forceKn * 1e4 / aeffMm2 : 0; }

  /* ---- Ticker : ne touche QUE le chrono. Le runner n'est reconstruit
         que lorsque l'état change (sinon la saisie serait détruite). ---- */
  function _startTicker() { if (_tickId) clearInterval(_tickId); _tickId = setInterval(_tick, 1000); }
  function _stopTicker()  { if (_tickId) { clearInterval(_tickId); _tickId = null; } }

  function _tick() {
    const scr = document.getElementById('screen-cfms-essai');
    if (!scr || !scr.classList.contains('is-active')) return;
    const e = _d && _d.cfms.enCours; if (!e) { _stopTicker(); return; }
    const p = PHASES[e.phase]; if (!p) return;
    const st = _etatPhase(p, e);

    const chrono = document.getElementById('cfms-chrono');
    if (chrono) {
      chrono.textContent = p.dureeMin ? `${_mmss(st.sec)} / ${p.dureeMin}:00` : '—';
      chrono.classList.toggle('is-over', p.dureeMin > 0 && st.sec >= p.dureeMin * 60);
    }
    const cd = document.getElementById('cfms-countdown');
    if (cd) {
      const prochaine = p.lectures.find(x => !e.lectures.some(l => l.phase === p.id && l.t === x));
      cd.textContent = (prochaine === undefined || !e.phaseStartedAt)
        ? '' : `Prochaine lecture (t = ${prochaine} min) dans ${_mmss(Math.max(0, prochaine * 60 - st.sec))}`;
    }

    const cle = _cle(p, st, e);
    if (cle !== _cleRendu) {
      _render();
      if (st.etat === 'LECTURE_DUE' && !_alertees[cle]) { _alertees[cle] = true; _alerte(); }
    }
  }

  /* Le mode correction fait partie de la clé : sans cela le ticker
     reconstruirait le bloc et effacerait la saisie en cours. */
  function _cle(p, st, e) {
    const ed = e.editRef ? `ed${e.editRef.phase}${e.editRef.t}` : '';
    return `${p.id}:${st.etat}:${st.t === undefined ? '' : st.t}:${ed}${e.revision ? ':rev' : ''}`;
  }

  function _render() {
    const e = _d.cfms.enCours; if (!e) return;
    if (e.revision) { _renderRevision(e); return; }
    const p = PHASES[e.phase];
    if (!p) { finish(); return; }
    const eq = _d.cfms.equipement;
    const st = _etatPhase(p, e);
    _cleRendu = _cle(p, st, e);

    const force = e.elsKn * p.ratio;
    const bar = _bar(force, eq.aeffMm2);
    const depasse = (eq.manoMaxBar && bar > eq.manoMaxBar) || (eq.pmaxBar && bar > eq.pmaxBar);

    let h = `<div class="cfms-phase-bar">${PHASES.map((x, i) =>
      `<span class="cfms-phase-dot${i === e.phase ? ' is-active' : ''}${i < e.phase ? ' is-done' : ''}">${x.label}</span>`).join('')}</div>`;

    h += `<div class="cfms-target${p.ratio ? '' : ' is-decharge'}">`
      + `<strong>${p.ratio ? `${force.toFixed(2)} kN · ${bar.toFixed(0)} bar` : 'DÉCHARGE — relâcher la pression'}</strong>`
      + `<span id="cfms-chrono">${p.dureeMin ? `${_mmss(st.sec)} / ${p.dureeMin}:00` : '—'}</span></div>`;
    if (depasse) h += `<div class="cfms-danger">⚠️ Pression cible ${bar.toFixed(0)} bar supérieure à la capacité du matériel. Ne pas charger.</div>`;
    h += `<p class="field-hint" id="cfms-countdown"></p>`;

    const edition = e.editRef ? e.lectures.find(l => l.phase === e.editRef.phase && l.t === e.editRef.t) : null;

    if (edition) {
      h += _boiteLecture(p, e.editRef.t, e, edition);
    } else if (st.etat === 'ARMEMENT') {
      h += `<button class="btn-primary btn-xl" id="cfms-palier">✓ PALIER ATTEINT — démarrer le chrono</button>`;
    } else if (st.etat === 'LECTURE_DUE') {
      h += _boiteLecture(p, st.t, e, null);
    } else if (st.etat === 'ATTENTE') {
      const suiv = p.lectures.find(x => !e.lectures.some(l => l.phase === p.id && l.t === x));
      h += `<p class="cfms-attente">⏳ Palier en cours — maintenir la charge</p>`;
      if (suiv !== undefined) {
        h += `<button class="btn-secondary cfms-skip" id="cfms-skip">⏭ passer à t = ${suiv} min</button>`;
      }
    } else {
      h += `<button class="btn-primary btn-xl" id="cfms-next-phase">${e.phase >= PHASES.length - 1 ? '✓ Terminer l\'essai' : 'Phase suivante →'}</button>`;
    }
    if (!edition) h += _recapLectures(p, e);
    h += `<button class="btn-secondary" id="cfms-abandon">Interrompre cet essai</button>`;
    document.getElementById('cfms-runner').innerHTML = h;
    _brancherRunner(p, st);
  }

  /* Lectures déjà prises dans la phase : l'opérateur doit pouvoir revenir sur
     une valeur mal tapée, comme il raturerait une feuille. */
  function _recapLectures(p, e) {
    const faites = e.lectures.filter(l => l.phase === p.id).sort((a, b) => a.t - b.t);
    if (!faites.length) return '';
    return `<div class="cfms-recap"><p class="cfms-recap-titre">Lectures de cette phase — touchez pour corriger</p>`
      + faites.map(l => _ligneRecap(p, l)).join('')
      + `</div>`;
  }

  function _ligneRecap(p, l) {
    return `<button class="cfms-recap-item" data-phase="${p.id}" data-t="${l.t}">`
      + `<span>t = ${l.t} min</span>`
      + `<b>${l.dMoy} mm</b>`
      + `<span class="cfms-recap-edit">${(l.corrections && l.corrections.length) ? '✎ corrigée' : '✎'}</span>`
      + `</button>`;
  }

  /* Reprise d'une lecture mal saisie (mode normal comme mode révision). */
  function _brancherRecap(e) {
    document.querySelectorAll('.cfms-recap-item').forEach(b => {
      b.onclick = () => { e.editRef = { phase: b.dataset.phase, t: +b.dataset.t }; _cleRendu = null; _render(); };
    });
    const bx = document.getElementById('cfms-annul-edit');
    if (bx) bx.onclick = () => { e.editRef = null; _cleRendu = null; _render(); };
  }

  /* ---- Mode révision : essai terminé, encore en brouillon ----
     Toutes les phases sont ouvertes à la correction, ainsi que l'origine et
     l'identification du micropieu. */
  function _renderRevision(e) {
    const ed = e.editRef ? e.lectures.find(l => l.phase === e.editRef.phase && l.t === e.editRef.t) : null;
    _cleRendu = _cle(PHASES[0], { etat: 'REVISION', t: undefined }, e);
    let h = `<div class="cfms-revision-tag">✎ Révision de l'essai n° ${e.n} — ${_esc(e.sousChampId)} · ${_esc(e.typeEssai)}</div>`;
    if (ed) {
      h += _boiteLecture(PHASES.find(p => p.id === e.editRef.phase), e.editRef.t, e, ed);
    } else {
      h += PHASES.map(p => {
        const faites = e.lectures.filter(l => l.phase === p.id).sort((a, b) => a.t - b.t);
        if (!faites.length) return '';
        return `<div class="cfms-recap"><p class="cfms-recap-titre">${p.label}</p>`
          + faites.map(l => _ligneRecap(p, l)).join('') + `</div>`;
      }).join('');
      const r = e.resultat || {};
      h += `<div class="cfms-target"><strong>Résiduel ${r.dResiduel != null ? r.dResiduel : '—'} mm</strong>`
        + `<span>${r.conforme === true ? 'Conforme' : r.conforme === false ? 'Non conforme' : '—'}</span></div>`;
      h += `<button class="btn-primary btn-xl" id="cfms-valider-essai">✓ Valider cet essai</button>`;
      h += `<p class="field-hint">Une fois validé, l'essai est verrouillé. Seul un renvoi du responsable permettra de le rouvrir.</p>`;
      h += `<button class="btn-secondary" id="cfms-fermer-revision">Enregistrer et fermer</button>`;
    }
    document.getElementById('cfms-runner').innerHTML = h;
    _brancherRecap(e);
    if (ed) _brancherLecture(PHASES.find(p => p.id === e.editRef.phase), { t: e.editRef.t }, e);

    const bv = document.getElementById('cfms-valider-essai');
    if (bv) bv.onclick = () => validerEssai();
    const bf = document.getElementById('cfms-fermer-revision');
    if (bf) bf.onclick = () => _sortirRevision(false);
  }

  /* L'origine a pu être corrigée : toutes les valeurs corrigées en dépendent. */
  function _recalculer(e) {
    const n = _d.cfms.equipement.compNb;
    const o = e.origine;
    e.lectures.forEach(l => {
      const d1 = _num(l.l1) - _num(o.l1), d2 = _num(l.l2) - _num(o.l2);
      const d3 = (n >= 3) ? _num(l.l3) - _num(o.l3) : null;
      l.d1 = +d1.toFixed(3); l.d2 = +d2.toFixed(3);
      l.d3 = d3 === null ? null : +d3.toFixed(3);
      l.dMoy = +((d3 === null ? (d1 + d2) / 2 : (d1 + d2 + d3) / 3)).toFixed(3);
    });
    e.resultat = _resultat(e);
  }

  async function validerEssai() {
    const e = _d.cfms.enCours; if (!e) return;
    if (!confirm('Valider cet essai ?\n\nIl sera verrouillé et ne pourra plus être modifié sans un renvoi du responsable.')) return;
    e.statut = 'valide';
    e.valideLe = Date.now();
    e.validePar = AuthModule.currentName();
    await _sortirRevision(true);
  }

  async function _sortirRevision(valide) {
    const e = _d.cfms.enCours; if (!e) return;
    _collect();
    if (!valide) e.statut = 'brouillon';
    e.revision = false; e.editRef = null;
    _d.essais.push(e);
    _d.essais.sort((a, b) => a.n - b.n);
    _d.cfms.enCours = null;
    _majStatutCampagne();
    await save();
    renderPlan();
    AppNav.goto('screen-cfms-plan');
  }

  function _boiteLecture(p, t, e, edition) {
    const n = _d.cfms.equipement.compNb;
    const v = edition || { l1: '', l2: '', l3: '' };
    return `<div class="cfms-reading ${edition ? 'is-edition' : 'is-alert'}">`
      + `<strong>${edition ? '✎ Corriger la lecture' : '📏 Lecture'} à t = ${t} min</strong>`
      + `<div class="field-row"><div class="field"><label>L1</label><input id="cfms-r-l1" inputmode="decimal" autocomplete="off" value="${_esc(v.l1)}"></div>`
      + `<div class="field"><label>L2</label><input id="cfms-r-l2" inputmode="decimal" autocomplete="off" value="${_esc(v.l2)}"></div></div>`
      + (n >= 3 ? `<div class="field"><label>L3</label><input id="cfms-r-l3" inputmode="decimal" autocomplete="off" value="${_esc(v.l3)}"></div>` : '')
      + `<p class="field-hint">Origine : L1 ${_esc(e.origine.l1)} · L2 ${_esc(e.origine.l2)}${n >= 3 ? ' · L3 ' + _esc(e.origine.l3) : ''}</p>`
      + `<button class="btn-primary btn-xl" id="cfms-save-reading">${edition ? 'Valider la correction' : 'Enregistrer la lecture'}</button>`
      + (edition ? `<button class="btn-secondary" id="cfms-annul-edit">Annuler</button>` : '')
      + `</div>`;
  }

  function _brancherRunner(p, st) {
    const e = _d.cfms.enCours;
    const bp = document.getElementById('cfms-palier');
    if (bp) bp.onclick = async () => { e.phaseStartedAt = Date.now(); _cleRendu = null; await save(); _render(); _startTicker(); };

    _brancherLecture(p, st, e);

    /* Skip : l'opérateur saisit un relevé déjà noté sur papier, ou a oublié
       de lancer le chrono. On avance le chrono jusqu'à l'échéance suivante
       pour que la lecture s'ouvre tout de suite. */
    const bs = document.getElementById('cfms-skip');
    if (bs) bs.onclick = async () => {
      const suiv = p.lectures.find(x => !e.lectures.some(l => l.phase === p.id && l.t === x));
      if (suiv === undefined) return;
      e.phaseStartedAt = Date.now() - suiv * 60000;
      e.skipEnCours = true;
      _cleRendu = null;
      await save();
      _render();
    };

    _brancherActions(p, e);
    _brancherRecap(e);
  }

  /* Enregistrement d'une lecture — partagé par le parcours guidé et le mode
     révision, sans quoi le bouton reste mort quand on corrige un essai. */
  function _brancherLecture(p, st, e) {
    const br = document.getElementById('cfms-save-reading');
    if (br) br.onclick = async () => {
      const l1 = _val('cfms-r-l1'), l2 = _val('cfms-r-l2'), l3 = _val('cfms-r-l3');
      if (l1 === '' || l2 === '') { alert('L1 et L2 sont requis.'); return; }
      if (_d.cfms.equipement.compNb >= 3 && l3 === '') { alert('L3 est requis.'); return; }
      const o = e.origine;
      const d1 = _num(l1) - _num(o.l1), d2 = _num(l2) - _num(o.l2);
      const d3 = (_d.cfms.equipement.compNb >= 3) ? _num(l3) - _num(o.l3) : null;
      const dMoy = (d3 === null) ? (d1 + d2) / 2 : (d1 + d2 + d3) / 3;
      const chiffres = { l1, l2, l3, d1: +d1.toFixed(3), d2: +d2.toFixed(3),
                         d3: d3 === null ? null : +d3.toFixed(3), dMoy: +dMoy.toFixed(3) };

      /* Correction d'une lecture déjà enregistrée : on remplace la valeur
         affichée mais on garde la précédente — équivalent d'une rature sur
         la feuille, la valeur d'origine reste lisible par le responsable. */
      if (e.editRef) {
        const anc = e.lectures.find(l => l.phase === e.editRef.phase && l.t === e.editRef.t);
        if (anc) {
          anc.corrections = anc.corrections || [];
          anc.corrections.push({ l1: anc.l1, l2: anc.l2, l3: anc.l3, dMoy: anc.dMoy, ts: anc.ts });
          Object.assign(anc, chiffres, { ts: Date.now() });
        }
        e.editRef = null;
        _cleRendu = null;
        await save();
        _render();
        return;
      }

      e.lectures.push({
        phase: p.id, t: st.t,
        tReelMin: e.phaseStartedAt ? +((Date.now() - e.phaseStartedAt) / 60000).toFixed(3) : 0,
        skip: !!e.skipEnCours,          // interne : consultable par le responsable
        ts: Date.now(), ...chiffres,
      });
      e.skipEnCours = false;
      _cleRendu = null;
      await save();
      _render();
    };
  }

  function _brancherActions(p, e) {
    const bn = document.getElementById('cfms-next-phase');
    if (bn) bn.onclick = async () => {
      e.phase++; e.phaseStartedAt = null; e.skipEnCours = false; _cleRendu = null; _alertees = {};
      if (e.phase >= PHASES.length) { await finish(); return; }
      await save();
      _render();
    };

    const ba = document.getElementById('cfms-abandon');
    if (ba) ba.onclick = async () => {
      if (!confirm('Interrompre cet essai ?\n\nLes lectures déjà prises sont conservées et l\'essai sera marqué non exploitable. Le quota du sous-champ ne sera pas décompté.')) return;
      e.incomplet = true; e.motifIncomplet = 'Interrompu par l\'opérateur';
      await _cloturer(e, false);
      renderPlan(); AppNav.goto('screen-cfms-plan');
    };
  }

  /* ---- Fin d'essai ---- */
  async function finish() {
    const e = _d.cfms.enCours; if (!e || e.done) return;
    e.resultat = _resultat(e);
    await _cloturer(e, true);
    const r = e.resultat;
    const verdict = (e.typeEssai === 'Horizontal')
      ? (r.conforme ? `CONFORME — résiduel ${r.dResiduel} mm ≤ ${CRITERE_LATERAL_MM} mm`
                    : `NON CONFORME — résiduel ${r.dResiduel} mm > ${CRITERE_LATERAL_MM} mm`)
      : `Déplacement max ${r.dMax} mm — critère à valider par le BET.`;
    alert(`Essai ${e.sousChampId} enregistré.\n\n${verdict}`);
    renderPlan();
    AppNav.goto('screen-cfms-plan');
  }

  /* Clôture commune : pousse l'essai, met à jour les quotas (sauf essai non
     exploitable), recalcule le statut de la campagne, purge l'essai courant. */
  async function _cloturer(e, decompter) {
    _stopTicker(); await _releaseWake();
    e.done = true;
    e.heureFin = _heure();
    if (decompter) {
      const s = _d.cfms.sousChamps.find(x => x.id === e.sousChampId);
      if (s) {
        if (e.typeEssai === 'Horizontal') { s.lRest = Math.max(0, s.lRest - 1); s.lFait = (s.lFait || 0) + 1; }
        else                              { s.tRest = Math.max(0, s.tRest - 1); s.tFait = (s.tFait || 0) + 1; }
      }
    }
    /* Un essai terminé reste un BROUILLON : modifiable tant que l'opérateur
       ne l'a pas validé. */
    e.statut = 'brouillon';
    _d.essais = _d.essais || [];
    _d.essais.push(e);
    _d.cfms.enCours = null;
    _majStatutCampagne();
    _cleRendu = null; _alertees = {};
    try { await save(); } catch (_) { /* état mémoire cohérent : la synchro rejouera */ }
  }

  /* La campagne n'est prête à être validée que si tous les essais sont faits
     ET validés un par un par l'opérateur. */
  function _majStatutCampagne() {
    const c = _d.cfms;
    c.complete = c.sousChamps.every(s => !s.lRest && !s.tRest);
    const tousValides = (_d.essais || []).every(e => e.incomplet || e.statut === 'valide');
    _d.statut = (c.complete && tousValides) ? 'brouillon' : 'incomplet';
  }

  function _resultat(e) {
    const ds = e.lectures.map(l => l.dMoy).filter(x => typeof x === 'number');
    const fin = e.lectures.filter(l => l.phase === 'df').slice(-1)[0];
    const p110 = e.lectures.filter(l => l.phase === 'p110').slice(-1)[0];
    const dMax = ds.length ? +Math.max(...ds.map(Math.abs)).toFixed(2) : null;
    const dResiduel = fin ? +Math.abs(fin.dMoy).toFixed(2) : null;
    return {
      dMax, dResiduel,
      dSous110: p110 ? +Math.abs(p110.dMoy).toFixed(2) : null,
      critereMm: e.typeEssai === 'Horizontal' ? CRITERE_LATERAL_MM : null,
      conforme: e.typeEssai === 'Horizontal' ? (dResiduel !== null && dResiduel <= CRITERE_LATERAL_MM) : null,
    };
  }

  /* ---- Suspension volontaire ---- */
  async function suspendre() {
    if (!confirm('Suspendre la campagne ?\n\nToutes les mesures saisies sont enregistrées, y compris l\'essai en cours, qui pourra être repris.')) return;
    if (_d && _d.cfms.enCours) _collect();
    _stopTicker(); await _releaseWake();
    await save();
    AppNav.goto('screen-repertoire');
    if (typeof RepertoireModule !== 'undefined') RepertoireModule.load();
  }

  /* Sauvegarde silencieuse : appelée quand l'appli passe en arrière-plan. */
  function autosave() {
    if (!_d) return;
    try { if (_d.cfms.enCours) _collect(); } catch (_) {}
    if (!_d.ref) return;                         // pas encore de référence : rien à écrire
    _d.updatedAt = Date.now();
    _d.operateur = AuthModule.currentName();
    try { CAEKDB.saveCampagne(_d); } catch (_) {}
  }

  /* ============================================================
     PERSISTANCE
     ============================================================ */
  async function save() {
    if (!_d.ref) _d.ref = await _nouvelleRef();
    _d.updatedAt = Date.now();
    _d.operateur = AuthModule.currentName();
    await CAEKDB.saveCampagne(_d);
    try {
      const c = await AuthModule.ensureValid();
      if (c.ok) await SyncModule.sendFiche('save', _d.ref, 'cfms', FicheModule.buildPayload(_d));
    } catch (_) { /* hors-ligne : l'outbox rejouera */ }
  }

  async function _nouvelleRef() {
    try {
      const r = await ServerModule.nextRef(AuthModule.token(), 'cfms', _d.codeProjet);
      if (r && r.ref) return r.ref;
    } catch (_) {}
    const n = await CAEKDB.nextNumero('cfms', _d.codeProjet);
    return `QC/CFMS/${_d.codeProjet}${String(n).padStart(2, '0')}`;
  }

  /* ============================================================
     TERRAIN — écran allumé, alerte sonore et haptique
     ============================================================ */
  async function _keepAwake() {
    try { if ('wakeLock' in navigator && !_wakeLock) _wakeLock = await navigator.wakeLock.request('screen'); } catch (_) {}
  }
  async function _releaseWake() {
    try { if (_wakeLock) { await _wakeLock.release(); _wakeLock = null; } } catch (_) {}
  }
  /* L'opérateur a les mains occupées et regarde le comparateur, pas l'écran. */
  function _alerte() {
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

  function gps() { GpsHelper.locate('cfms-gps', 'cfms-gps-hint', 'cfms-gps-btn'); }

  /* ============================================================
     OUTILS
     ============================================================ */
  function _val(id, v) {
    const x = document.getElementById(id);
    if (!x) return '';
    if (v !== undefined) x.value = (v === null || v === undefined) ? '' : v;
    return (x.value || '').trim();
  }
  function _setOpts(id, a, empty, list) {
    const x = document.getElementById(id); if (!x) return;
    const opts = a.map(z => `<option value="${_esc(z[0])}">${_esc(z[1])}</option>`).join('');
    x.innerHTML = list ? opts : `<option value="">${_esc(empty)}</option>` + opts;
  }
  function _hint(id, txt, err) {
    const x = document.getElementById(id); if (!x) return;
    x.textContent = txt || ''; x.hidden = !txt; x.classList.toggle('hint-error', !!err);
  }
  function _num(v) { const n = parseFloat(String(v).replace(',', '.')); return isNaN(n) ? 0 : n; }
  function _date() { return new Date().toISOString().slice(0, 10); }
  function _heure() { const x = new Date(); return String(x.getHours()).padStart(2, '0') + ':' + String(x.getMinutes()).padStart(2, '0'); }
  function _mmss(s) { s = Math.max(0, Math.floor(s)); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); }
  function _dureeLisible(s) {
    const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
    return h ? `${h} h ${m} min` : `${m} min`;
  }
  function _esc(x) {
    return String(x === null || x === undefined ? '' : x)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  return {
    nouvelle, reprendre, onClient, onProjet, onCode, onVerin,
    next, prev, renderPlan, organiser, choose, start, begin,
    suspendre, autosave, gps,
  };
})();
