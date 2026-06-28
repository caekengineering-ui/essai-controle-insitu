'use strict';
/* ============================================================
   Détail d'une fiche (plaque ou compacité) + validation + versionnage.
   ============================================================ */
const DetailModule = (() => {
  let _cur = null;

  function show(c, validationMode = false) {
    _cur = c;
    const locked = c.statut === 'valide';
    const statutLabel = { incomplet: 'Incomplet', brouillon: 'Brouillon achevé', valide: 'Validé' }[c.statut] || c.statut;
    const statutClass = { incomplet: 'badge-incomplet', brouillon: 'badge-brouillon', valide: 'badge-valide' }[c.statut] || '';
    document.getElementById('detail-title').textContent = c.ref + (c.version > 1 ? ' (v' + c.version + ')' : '');
    document.getElementById('detail-statut').textContent = statutLabel;
    document.getElementById('detail-statut').className = 'badge ' + statutClass;

    document.getElementById('detail-body').innerHTML =
      (c.type === 'compacite' ? _bodyCompacite(c) : _bodyPlaque(c)) + _trace(c);

    document.getElementById('detail-btn-share').onclick = () => ShareModule.share(c.ref);

    const vWrap = document.getElementById('detail-btn-valider-wrap');
    vWrap.hidden = !(c.statut === 'brouillon'); vWrap.dataset.ref = c.ref;
    const verWrap = document.getElementById('detail-btn-version-wrap');
    verWrap.hidden = !locked; verWrap.dataset.ref = c.ref;

    AppNav.goto('screen-detail');
    if (validationMode && c.statut === 'brouillon') vWrap.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  /* ---- En-tête commun ---- */
  function _ident(c) {
    const auto = c.auto === 'Oui';
    const ent = c.entreprise || {};
    const interv = auto ? "Maître d'ouvrage" : 'Client';
    return `<div class="recap-section">
      <div class="recap-row"><span class="recap-label">Type</span><span>${c.type === 'compacite' ? 'Compacité in situ' : 'Essai à la plaque'}</span></div>
      <div class="recap-row"><span class="recap-label">Mode</span><span>${auto ? 'Auto-contrôle' : 'Contrôle'}</span></div>
      ${auto && ent.nom ? `<div class="recap-row"><span class="recap-label">Entreprise</span><span>${esc(ent.nom)}</span></div>` : ''}
      <div class="recap-row"><span class="recap-label">${interv}</span><span>${esc(c.client || '—')}</span></div>
      <div class="recap-row"><span class="recap-label">Projet</span><span>${esc(c.nomProjet || c.projet || '—')}</span></div>
      <div class="recap-row"><span class="recap-label">Code projet</span><span>${esc(c.codeProjet || c.code || '—')}</span></div>
      ${c.lieu ? `<div class="recap-row"><span class="recap-label">Lieu</span><span>${esc(c.lieu)}</span></div>` : ''}
      <div class="recap-row"><span class="recap-label">Ouvrage</span><span>${esc(c.ouvrage || '—')}${(c.partieOuvrage || c.partie) ? ' — ' + esc(c.partieOuvrage || c.partie) : ''}</span></div>
      ${c.niveau ? `<div class="recap-row"><span class="recap-label">Niveau</span><span>${esc(c.niveau)}</span></div>` : ''}
    </div>`;
  }

  /* ---- Corps PLAQUE ---- */
  function _bodyPlaque(c) {
    const cps = c.cps || {};
    const hasExig = (cps.ev1min || cps.ev2min || cps.kmax);
    const C = (typeof PlaqueCalc !== 'undefined') ? PlaqueCalc.fmt : (v) => v;
    const ess = (c.essais || []).filter(e => e && (e.done || e.result));
    const rows = ess.map(e => {
      const r = e.result || {};
      const conf = e.conforme;
      const badge = (conf === null || conf === undefined) ? '' : (conf ? '<span class="badge badge-ok">✓</span>' : '<span class="badge badge-nok">✗</span>');
      return `<div class="essai-detail-card">
        <div class="essai-detail-head"><span class="essai-detail-num">Essai ${e.n}${(e.point || e.repere) ? ' — ' + esc(e.point || e.repere) : ''}</span>${badge}</div>
        <div class="essai-detail-lines">
          <div class="edl"><span>EV1 =</span><b>${C(r.ev1, 1)} MPa</b></div>
          <div class="edl"><span>EV2 =</span><b>${C(r.ev2, 1)} MPa</b></div>
          <div class="edl edl-strong"><span>K =</span><b>${C(r.k, 2)}</b></div>
        </div></div>`;
    }).join('') || '<p class="empty-msg">Aucun essai enregistré.</p>';
    return _ident(c) +
      (hasExig ? `<div class="recap-section"><div class="section-title">Exigences CPS</div>
        ${cps.ev1min ? `<div class="recap-row"><span class="recap-label">EV1 min</span><span>${cps.ev1min} MPa</span></div>` : ''}
        ${cps.ev2min ? `<div class="recap-row"><span class="recap-label">EV2 min</span><span>${cps.ev2min} MPa</span></div>` : ''}
        ${cps.kmax ? `<div class="recap-row"><span class="recap-label">K max</span><span>${cps.kmax}</span></div>` : ''}</div>` : '') +
      `<div class="section-title" style="margin-top:6px">Résultats</div>${rows}`;
  }

  /* ---- Corps COMPACITÉ ---- */
  function _bodyCompacite(c) {
    const unit = (c.proctor && c.proctor.unite === 'g/cm3') ? 'g/cm³' : 't/m³';
    const ess = (c.essais || []).filter(e => e && (e.done || e.result));
    const rows = ess.map(e => {
      const r = e.result || {};
      const taux = (typeof CompaciteCalc !== 'undefined') ? CompaciteCalc.fmtTaux(r.taux) : r.taux;
      const conf = e.conforme;
      const badge = (conf === null || conf === undefined) ? '' : (conf ? '<span class="badge badge-ok">✓</span>' : '<span class="badge badge-nok">✗</span>');
      return `<div class="essai-detail-card">
        <div class="essai-detail-head"><span class="essai-detail-num">${esc(e.no || ('Essai ' + e.n))}${e.emp ? ' — ' + esc(e.emp) : ''}</span>${badge}</div>
        <div class="essai-detail-lines">
          <div class="edl"><span>γd =</span><b>${_f(r.gd, 3)} ${unit}</b></div>
          ${r.w != null ? `<div class="edl"><span>w =</span><b>${_f(r.w, 1)} %</b></div>` : ''}
          <div class="edl edl-strong"><span>Taux =</span><b>${taux} %</b></div>
        </div></div>`;
    }).join('') || '<p class="empty-msg">Aucune mesure enregistrée.</p>';
    const pr = c.proctor || {};
    return _ident(c) +
      `<div class="recap-section"><div class="section-title">Méthodologie & Proctor</div>
        <div class="recap-row"><span class="recap-label">Méthode</span><span>${esc(c.methode || '—')}</span></div>
        <div class="recap-row"><span class="recap-label">Norme</span><span>${esc(c.norme || '—')}</span></div>
        ${c.materiau ? `<div class="recap-row"><span class="recap-label">Matériau</span><span>${esc(c.materiau)}</span></div>` : ''}
        <div class="recap-row"><span class="recap-label">Densité max OPM</span><span>${esc(pr.gdOpm || '—')} ${unit}</span></div>
        ${pr.wOpm ? `<div class="recap-row"><span class="recap-label">Teneur eau OPM</span><span>${esc(pr.wOpm)} %</span></div>` : ''}
        ${c.tauxMin ? `<div class="recap-row"><span class="recap-label">Taux min (CPS)</span><span>${esc(c.tauxMin)} %</span></div>` : ''}</div>` +
      `<div class="section-title" style="margin-top:6px">Résultats</div>${rows}`;
  }

  function _trace(c) {
    if (c.statut !== 'valide') return '';
    return `<div class="recap-section">
      <div class="recap-row"><span class="recap-label">Validée le</span><span>${esc(c.dateValidation || '—')}</span></div>
      <div class="recap-row"><span class="recap-label">Par</span><span>${esc(c.valideePar || c.operateur || '—')}</span></div>
      <div class="recap-row"><span class="recap-label">Version</span><span>v${c.version || 1}</span></div>
      ${c.refPrecedente ? `<div class="recap-row"><span class="recap-label">Corrige</span><span>${esc(c.refPrecedente)}</span></div>` : ''}
      ${c.remplaceePar ? `<div class="recap-row"><span class="recap-label">Remplacée par</span><span>${esc(c.remplaceePar)}</span></div>` : ''}
    </div>`;
  }

  /* ---- Validation ---- */
  async function valider() {
    const ref = document.getElementById('detail-btn-valider-wrap').dataset.ref || (_cur && _cur.ref);
    const c = await CAEKDB.getCampagne(ref);
    if (!c) { alert('Fiche introuvable en local.'); return; }
    if (c.statut === 'valide') { alert('Déjà validée.'); return; }
    if (c.statut !== 'brouillon') { alert('Seuls les brouillons achevés peuvent être validés.'); return; }
    if (!confirm('Valider définitivement cette fiche ?\nElle ne sera plus modifiable (une correction créera une nouvelle version).')) return;
    const chk = await AuthModule.ensureValid();
    if (!chk.ok) return;
    c.statut = 'valide';
    c.operateur = AuthModule.currentName();
    const payload = FicheModule.buildPayload(c);
    const r = await SyncModule.sendFiche('valider', c.ref, c.type, payload);
    if (!r.ok) { alert('Échec : ' + (r.error || 'inconnu')); return; }
    if (r.queued) {
      c.valideePar = AuthModule.currentName();
      c.dateValidation = _today();
      await CAEKDB.saveCampagne(c);
      alert(`Fiche ${c.ref} validée localement (hors-ligne). Elle sera envoyée au serveur dès le retour du réseau.`);
    } else {
      c.valideePar = (r.result && r.result.valide_par) || AuthModule.currentName();
      c.dateValidation = (r.result && r.result.date_validation) || _today();
      await CAEKDB.saveCampagne(c);
      alert(`Fiche ${c.ref} validée et envoyée au bureau.`);
    }
    AppNav.goto('screen-repertoire'); RepertoireModule.load();
  }

  /* ---- Créer une version corrigée ---- */
  async function creerVersion() {
    const ref = document.getElementById('detail-btn-version-wrap').dataset.ref || (_cur && _cur.ref);
    if (!navigator.onLine) { alert('La création d\'une version corrigée nécessite une connexion au serveur.'); return; }
    const chk = await AuthModule.ensureValid();
    if (!chk.ok || chk.offline) { alert('Connexion requise pour créer une version corrigée.'); return; }
    const base = (_cur && (_cur.refBase || _cur.ref)) || ref;
    const newVer = ((_cur && _cur.version) || 1) + 1;
    const newRef = `${base}-v${newVer}`;
    if (!confirm(`Créer une version corrigée ?\nNouvelle référence : ${newRef}\nLa version actuelle sera archivée.`)) return;
    try {
      const r = await ServerModule.creerVersion(AuthModule.token(), ref, newRef);
      if (!r || !r.ok) { alert('Échec : ' + ((r && r.error) || 'inconnu')); return; }
      // récupérer la nouvelle fiche depuis le serveur et la rendre modifiable en local
      const rows = await ServerModule.listFiches(AuthModule.token(), null);
      const row = (rows || []).find(x => x.ref === newRef);
      if (row) {
        const local = { ...(row.payload || {}), ref: newRef, type: row.type, statut: 'brouillon',
                        version: row.version, refBase: row.ref_base, refPrecedente: row.ref_precedente,
                        nomProjet: (row.payload || {}).projet, codeProjet: (row.payload || {}).code,
                        partieOuvrage: (row.payload || {}).partie, nbEssais: ((row.payload || {}).essais || []).length };
        // normaliser les essais pour réédition
        local.essais = (local.essais || []).map((e, i) => _essaiToLocal(e, row.type, i));
        await CAEKDB.saveCampagne(local);
      }
      alert(`Version ${newRef} créée. Vous pouvez maintenant la corriger.`);
      if (row && row.type === 'compacite') CompaciteModule.reprendre(newRef);
      else if (row) CampagneModule.reprendre(newRef);
      else { AppNav.goto('screen-repertoire'); RepertoireModule.load(); }
    } catch (e) { alert('Erreur : ' + e.message); }
  }

  /* Remet un essai du payload serveur en forme locale éditable */
  function _essaiToLocal(e, type, i) {
    if (type === 'compacite') {
      return { n: i + 1, no: e.no || ('E' + (i + 1)), emp: e.emp || '', date: '', heure: '', meteo: '',
               mode: e.gh ? 'calc' : 'direct', gh: e.gh || '', w: e.w || '', gd: e.gd || '', obs: e.obs || '',
               done: true, result: { gd: _n(e.gd), w: _n(e.w), taux: _n(e.taux) } };
    }
    return { n: i + 1, point: e.repere || '', gps: e.coord || '', date: e.date || '', heure: '', meteo: '',
             raz: (String(e.raz).toLowerCase() === 'oui') ? 'oui' : 'non', e1: e.e1 || '', z0: e.z0 || '', z1: e.z1 || '', z2: e.z2 || '',
             obs: e.obs || '', done: true, result: { ev1: _n(e.ev1), ev2: _n(e.ev2), k: _n(e.k) } };
  }

  function _today() { const d = new Date(); return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`; }
  function _n(v) { const x = parseFloat(String(v).replace(',', '.')); return isNaN(x) ? null : x; }
  function _f(v, d) { return (v == null || isNaN(v)) ? '—' : Number(v).toFixed(d); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  return { show, valider, creerVersion };
})();
