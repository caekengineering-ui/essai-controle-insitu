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
      (c.type === 'arrachement' ? _bodyArrachement(c)
        : c.type === 'cfms' ? _bodyCfms(c)
        : c.type === 'compacite' ? _bodyCompacite(c) : _bodyPlaque(c)) + _trace(c);

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
    const interv = 'Client';   // toujours "Client" (sa valeur est déjà l'intervenant du mode)
    return `<div class="recap-section">
      <div class="recap-row"><span class="recap-label">Type</span><span>${{ compacite: 'Compacité in situ', arrachement: 'Arrachement sur clous d\'ancrage', cfms: 'Contrôle photovoltaïque CFMS' }[c.type] || 'Essai à la plaque'}</span></div>
      <div class="recap-row"><span class="recap-label">Mode</span><span>${auto ? 'Auto-contrôle' : 'Contrôle'}</span></div>
      ${auto && ent.nom ? `<div class="recap-row"><span class="recap-label">Entreprise</span><span>${esc(ent.nom)}</span></div>` : ''}
      <div class="recap-row"><span class="recap-label">${interv}</span><span>${esc(c.client || '—')}</span></div>
      <div class="recap-row"><span class="recap-label">Projet</span><span>${esc(c.nomProjet || c.projet || '—')}</span></div>
      <div class="recap-row"><span class="recap-label">Code projet</span><span>${esc(c.codeProjet || c.code || '—')}</span></div>
      ${c.lieu ? `<div class="recap-row"><span class="recap-label">Lieu</span><span>${esc(_dedupeLieu(c.lieu))}</span></div>` : ''}
      <div class="recap-row"><span class="recap-label">Ouvrage</span><span>${esc(c.ouvrage || '—')}${(c.partieOuvrage || c.partie) ? ' — ' + esc(c.partieOuvrage || c.partie) : ''}</span></div>
      ${c.niveau ? `<div class="recap-row"><span class="recap-label">Niveau</span><span>${esc(c.niveau)}</span></div>` : ''}
    </div>`;
  }

  /* ---- Corps PLAQUE ---- */
  function _bodyPlaque(c) {
    const cps = c.cps || {};
    const hasExig = (cps.ev1min || cps.ev2min || cps.kmax);
    const C = (typeof PlaqueCalc !== 'undefined') ? PlaqueCalc.fmt : (v) => v;
    const ess = (c.essais || []).filter(e => e && (e.done || e.result || e.ev1 != null || e.repere || e.point));
    const rows = ess.map((e, i) => {
      const r = e.result || e;   // local (e.result) OU fiche serveur (champs à plat)
      const conf = e.conforme;
      const badge = (conf === null || conf === undefined) ? '' : (conf ? '<span class="badge badge-ok">✓</span>' : '<span class="badge badge-nok">✗</span>');
      return `<div class="essai-detail-card">
        <div class="essai-detail-head"><span class="essai-detail-num">Essai ${e.n || (i + 1)}${(e.point || e.repere) ? ' — ' + esc(e.point || e.repere) : ''}</span>${badge}</div>
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
    const ess = (c.essais || []).filter(e => e && (e.done || e.result || e.taux != null || e.gd != null || e.no || e.emp));
    const rows = ess.map((e, i) => {
      const r = e.result || e;   // local (e.result) OU fiche serveur (champs à plat)
      const taux = (typeof CompaciteCalc !== 'undefined') ? CompaciteCalc.fmtTaux(r.taux) : r.taux;
      const conf = e.conforme;
      const badge = (conf === null || conf === undefined) ? '' : (conf ? '<span class="badge badge-ok">✓</span>' : '<span class="badge badge-nok">✗</span>');
      return `<div class="essai-detail-card">
        <div class="essai-detail-head"><span class="essai-detail-num">${esc(e.no || ('Essai ' + (e.n || (i + 1))))}${e.emp ? ' — ' + esc(e.emp) : ''}</span>${badge}</div>
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

  /* ---- Corps PHOTOVOLTAÏQUE / CFMS ---- */
  function _bodyCfms(c) {
    const x = c.cfms || {};
    const eq = x.equipement || {};
    const PH = { p5: '5 % ELS', d1: 'Décharge P1', p110: '110 % ELS', df: 'Décharge finale' };
    const essais = (c.essais || []).filter(e => e);
    const realises = essais.filter(e => e.done && !e.incomplet).length;
    const prevus = x.essaisPrevus || ((x.nbSc || 0) * ((x.nbL || 0) + (x.nbT || 0)));

    /* Un bloc par essai : le PV doit montrer le déroulé réel, pas un résumé. */
    const blocs = essais.map(e => {
      const r = e.resultat || {};
      const lignes = (e.lectures || []).map(l => `<tr>
        <td>${esc(PH[l.phase] || l.phase)}</td><td class="num">${esc(l.t)}${l.skip ? ' <span title="saisie par skip">⏭</span>' : ''}${(l.corrections && l.corrections.length) ? ` <span title="corrigée — valeur(s) précédente(s) : ${esc((l.corrections || []).map(k => k.dMoy).join(', '))} mm">✎</span>` : ''}</td>
        <td class="num">${l.tReelMin != null ? esc(l.tReelMin) : '—'}</td>
        <td class="num">${esc(l.l1)}</td><td class="num">${esc(l.l2)}</td><td class="num">${l.l3 ? esc(l.l3) : '—'}</td>
        <td class="num"><b>${l.dMoy != null ? esc(l.dMoy) : '—'}</b></td></tr>`).join('');
      const conclusion = e.incomplet
        ? `<span class="text-nok">Non exploitable — ${esc(e.motifIncomplet || '')}</span>`
        : (r.conforme === true ? `<span class="text-ok">Conforme — résiduel ${esc(r.dResiduel)} mm ≤ ${esc(r.critereMm)} mm</span>`
        :  r.conforme === false ? `<span class="text-nok">Non conforme — résiduel ${esc(r.dResiduel)} mm > ${esc(r.critereMm)} mm</span>`
        :  `Déplacement max ${esc(r.dMax != null ? r.dMax : '—')} mm — critère traction à valider par le BET`);
      const mp = e.micropieu || {};
      return `<div class="recap-section">
        <div class="section-title">Essai n° ${esc(e.n)} — ${esc(e.sousChamp)} — ${esc(e.typeEssai)}</div>
        <div class="recap-row"><span class="recap-label">Micropieu</span><span>Ø ${esc(mp.diam || '—')} mm · L ${esc(mp.long || '—')} cm${mp.horsDefaut ? ' <b>(hors standard)</b>' : ''}</span></div>
        ${(mp.table || mp.rangee || mp.position) ? `<div class="recap-row"><span class="recap-label">Repérage</span><span>${esc([mp.table && 'Table ' + mp.table, mp.rangee && 'Rangée ' + mp.rangee, mp.position].filter(Boolean).join(' · '))}</span></div>` : ''}
        ${mp.gps ? `<div class="recap-row"><span class="recap-label">Coordonnées</span><span>${esc(mp.gps)}</span></div>` : ''}
        <div class="recap-row"><span class="recap-label">Date / heure</span><span>${esc(_dateFr(e.date))} ${esc(e.heure || '')}${e.heureFin ? ' → ' + esc(e.heureFin) : ''}</span></div>
        <div class="recap-row"><span class="recap-label">ELS appliqué</span><span>${esc(e.elsKn || '—')} kN</span></div>
        <div class="recap-row"><span class="recap-label">Origine (zéro réel)</span><span>L1 ${esc((e.origine || {}).l1 || '—')} · L2 ${esc((e.origine || {}).l2 || '—')}${(e.origine || {}).l3 ? ' · L3 ' + esc(e.origine.l3) : ''}</span></div>
        <div class="ar-table-wrap"><table class="ar-table"><thead><tr><th>Phase</th><th>t<br>min</th><th>t réel<br>min</th><th>L1</th><th>L2</th><th>L3</th><th>Corrigé<br>mm</th></tr></thead>
        <tbody>${lignes || '<tr><td colspan="7">Aucune lecture.</td></tr>'}</tbody></table></div>
        <div class="recap-row"><span class="recap-label">Conclusion</span><span>${conclusion}</span></div>
      </div>`;
    }).join('');

    return _ident(c) +
      `<div class="recap-section"><div class="section-title">Campagne CFMS</div>
        <div class="recap-row"><span class="recap-label">Protocole</span><span>${esc(x.protocole || '5 % ELS 1 min → décharge → 110 % ELS 5 min → décharge finale')}</span></div>
        <div class="recap-row"><span class="recap-label">ELS latéral</span><span>${esc(x.elsLateralKn || '—')} kN</span></div>
        <div class="recap-row"><span class="recap-label">ELS traction</span><span>${esc(x.elsTractionKn || '—')} kN</span></div>
        ${x.elsAVerifier ? `<div class="recap-row"><span class="recap-label">⚠️ ELS</span><span>Campagne antérieure à la distinction latéral / traction — valeurs à revérifier.</span></div>` : ''}
        <div class="recap-row"><span class="recap-label">Sous-champs</span><span>${esc(x.nbSc || '—')} — ${esc(x.nbL || 0)} latéral(aux) + ${esc(x.nbT || 0)} traction par sous-champ</span></div>
        <div class="recap-row"><span class="recap-label">Avancement</span><span>${realises} / ${prevus} essais réalisés</span></div>
        <div class="recap-row"><span class="recap-label">Micropieu type</span><span>Ø ${esc(x.diamDefaut || '—')} mm · L ${esc(x.longDefaut || '—')} cm</span></div>
        <div class="recap-row"><span class="recap-label">Compression</span><span>Exclue du contrôle CFMS</span></div>
      </div>` +
      `<div class="recap-section"><div class="section-title">Équipement commun</div>
        <div class="recap-row"><span class="recap-label">Vérin</span><span>${esc(eq.verinModele || '—')} — Aeff ${esc(eq.aeffMm2 || '—')} mm²${eq.aeffManuelle ? ' (saisie manuelle)' : ''}</span></div>
        ${eq.capaciteKN ? `<div class="recap-row"><span class="recap-label">Capacité vérin</span><span>${esc(eq.capaciteKN)} kN · ${esc(eq.pmaxBar)} bar max</span></div>` : ''}
        <div class="recap-row"><span class="recap-label">Comparateurs</span><span>${esc(eq.compNb || '—')} × ${esc(eq.compType || '—')} — précision ${esc(eq.precision || '—')}${eq.compModele ? ' — ' + esc(eq.compModele) : ''}</span></div>
        <div class="recap-row"><span class="recap-label">Pompe</span><span>${esc(eq.pompe || '—')}</span></div>
        <div class="recap-row"><span class="recap-label">Manomètre</span><span>${esc(eq.manoMaxBar || '—')} bar${eq.manoModele ? ' — ' + esc(eq.manoModele) : ''}</span></div>
      </div>` +
      `<div class="section-title" style="margin-top:6px">Déroulé des essais</div>` +
      (blocs || '<p class="empty-msg">Aucun essai enregistré.</p>');
  }

  /* ---- Corps ARRACHEMENT ---- */
  function _bodyArrachement(c) {
    const A = (typeof ArrachementCalc !== 'undefined') ? ArrachementCalc : null;
    const prm = c.params || {};
    const m = c.materiel || {};
    const v = (A && m.verin) ? A.getVerin(m.verin) : (c.verin || null);
    const ess = (c.essais || []).filter(e => e && (e.done || e.result || e.paliers || e.repere));

    const rows = ess.map((e, i) => {
      const r = e.result || e;                 // local (e.result) OU fiche serveur (champs à plat)
      const clou = e.clou || {};
      const repere = e.repere || clou.repere || ('Clou ' + (e.n || (i + 1)));
      const classe = r.classe || '';
      const label = (A && A.CLASSES[classe]) ? A.CLASSES[classe].label : (e.classeLabel || '');
      const cls = { satisfaisant: 'badge-ok', examiner: 'badge-incomplet', signaler: 'badge-incomplet',
                    non_recevable: 'badge-nok', non_realise: 'badge-remplacee' }[classe] || '';
      const nbAno = (e.anomalies || []).length, nbPh = (e.photos || []).length;
      return `<div class="essai-detail-card">
        <div class="essai-detail-head"><span class="essai-detail-num">${esc(repere)}${(e.zone || clou.zone) ? ' — ' + esc(e.zone || clou.zone) : ''}</span>${label ? `<span class="badge ${cls}">${esc(label)}</span>` : ''}</div>
        <div class="essai-detail-lines">
          <div class="edl"><span>y à Tmax =</span><b>${_f(_n(r.yTmax), 2)} mm</b></div>
          <div class="edl edl-strong"><span>α =</span><b>${_f(_n(r.alpha), 2)} mm/décade</b></div>
          <div class="edl"><span>y rémanent =</span><b>${_f(_n(r.remanent != null ? r.remanent : r.remanentFinal), 2)} mm</b></div>
        </div>
        <div class="essai-detail-note">${(e.paliers || []).filter(p => p.endedAt).length} palier(s) clôturé(s)${nbAno ? ` · ${nbAno} anomalie(s)` : ''}${nbPh ? ` · ${nbPh} photo(s)` : ''}${e.incomplet ? ' · <span class="text-nok">essai incomplet</span>' : ''}${(e.arret && e.arret.motif) ? ' · interrompu : ' + esc(e.arret.motif) : ''}</div>
        ${(r.motifs || []).length ? `<ul class="ar-motifs">${(r.motifs || []).map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
        ${r.justification ? `<div class="essai-detail-note">Classement modifié — justification : ${esc(r.justification)}</div>` : ''}
      </div>`;
    }).join('') || '<p class="empty-msg">Aucun essai enregistré.</p>';

    /* Récapitulatif de campagne + synthèse par zone */
    const recap = ess.length ? `<div class="ar-table-wrap"><table class="ar-table">
      <thead><tr><th>Repère</th><th>Zone</th><th>Date</th><th>y(Tmax)<br><small>mm</small></th><th>α<br><small>mm/déc.</small></th><th>Rémanent<br><small>mm</small></th><th>Classement</th></tr></thead>
      <tbody>${ess.map((e, i) => { const r = e.result || e; const clou = e.clou || {};
        return `<tr><td>${esc(e.repere || clou.repere || ('Clou ' + (e.n || (i + 1))))}</td><td>${esc(e.zone || clou.zone || '—')}</td><td>${esc(_dateFr(e.date))}</td>
          <td class="num">${_f(_n(r.yTmax), 2)}</td><td class="num">${_f(_n(r.alpha), 2)}</td>
          <td class="num">${_f(_n(r.remanent != null ? r.remanent : r.remanentFinal), 2)}</td>
          <td>${esc((A && A.CLASSES[r.classe]) ? A.CLASSES[r.classe].label : (e.classeLabel || '—'))}</td></tr>`; }).join('')}
      </tbody></table></div>` : '';

    const syn = _syntheseHtml(c, ess, A);

    return _ident(c) +
      `<div class="recap-section"><div class="section-title">Essai et matériel</div>
        <div class="recap-row"><span class="recap-label">Type d'essai</span><span>${c.typeEssai === 'prealable' || c.typeEssaiCode === 'prealable' ? 'Essai préalable' : 'Essai de contrôle'}</span></div>
        <div class="recap-row"><span class="recap-label">Tension max</span><span>${esc(c.tmax || '—')} kN</span></div>
        <div class="recap-row"><span class="recap-label">Vérin</span><span>${esc(m.verin || (v && v.modele) || '—')}${v ? ` · ${_f(v.surfaceCm2, 2)} cm² · trou Ø ${_f(v.trouMm, 1)} mm` : ''}</span></div>
        <div class="recap-row"><span class="recap-label">Effort / pression</span><span>${esc(c.relationEffortPression || (m.etalUtilisee ? 'Courbe d\'étalonnage de l\'exemplaire' : 'Relation nominale'))}</span></div>
        <div class="recap-row"><span class="recap-label">Mesure d'effort</span><span>${m.mesureEffort === 'capteur' ? 'Capteur de force' : 'Manomètre'}${m.serieEffort ? ' · n° ' + esc(m.serieEffort) : ''}</span></div>
        <div class="recap-row"><span class="recap-label">Comparateurs</span><span>${m.nbComparateurs === 1 ? '1' : '2'}${m.serieComp1 ? ' · n° ' + esc(m.serieComp1) : ''}${m.serieComp2 ? ' / ' + esc(m.serieComp2) : ''}</span></div>
        ${c.etalonnagePerime ? `<div class="recap-row"><span class="recap-label">Étalonnage</span><span class="text-nok">Périmé — essais non recevables</span></div>` : ''}
        <div class="recap-row"><span class="recap-label">Norme</span><span>${esc(c.norme || 'NF P94-242-1 · XP P94-444 · NF EN 14490')}</span></div>
      </div>` +
      `<div class="recap-section"><div class="section-title">Programme et seuils</div>
        <div class="recap-row"><span class="recap-label">Palier de serrage</span><span>${Math.round((prm.fractionPa || 0.1) * 100)} % de Tmax</span></div>
        <div class="recap-row"><span class="recap-label">Chargement</span><span>${(prm.fractionsCharge || []).map(f => Math.round(f * 100)).join(' / ')} %</span></div>
        <div class="recap-row"><span class="recap-label">Déchargement</span><span>${(prm.fractionsDecharge || []).map(f => Math.round(f * 100)).join(' / ')} %</span></div>
        <div class="recap-row"><span class="recap-label">Durée palier / final</span><span>${prm.dureePalierMin} / ${prm.dureeFinalMin} min</span></div>
        <div class="recap-row"><span class="recap-label">Détection de stabilisation</span><span>${prm.stabilisationActive ? `activée — ${prm.seuilStabMmParMin} mm/min après ${prm.dureeMiniMaintienMin} min` : 'désactivée'}</span></div>
        <div class="recap-row"><span class="recap-label">Seuils α</span><span>≤ ${prm.alphaOk} mm satisfaisant · > ${prm.alphaHaut} mm signalé</span></div>
        <div class="recap-row"><span class="recap-label">Seuil de déplacement</span><span>${prm.seuilDeplacementMm} mm</span></div>
        ${c.paramsModifies ? `<div class="recap-row"><span class="recap-label">Paramètres</span><span class="text-nok">Ajustés par l'opérateur (écarts aux valeurs par défaut tracés)</span></div>` : ''}
      </div>` +
      `<div class="section-title" style="margin-top:6px">Récapitulatif de campagne</div>${recap}` +
      syn +
      `<div class="section-title" style="margin-top:6px">Résultats par clou</div>${rows}`;
  }

  function _syntheseHtml(c, ess, A) {
    const src = (c.synthese && c.synthese.yTmax) ? c.synthese.yTmax
      : (A ? A.syntheseParZone(ess.map(e => ({ clou: e.clou || { zone: e.zone, repere: e.repere }, n: e.n, result: e.result || e })), 'yTmax') : []);
    if (!src || !src.length) return '';
    return `<div class="section-title" style="margin-top:6px">Synthèse par zone — déplacement à Tmax</div>
      <div class="ar-table-wrap"><table class="ar-table">
      <thead><tr><th>Zone</th><th>n</th><th>min</th><th>max</th><th>moy.</th><th>écart-type</th><th>CV %</th></tr></thead>
      <tbody>${src.map(z => `<tr><td>${esc(z.zone)}</td><td class="num">${z.stats.n}</td>
        <td class="num">${_f(z.stats.min, 2)}</td><td class="num">${_f(z.stats.max, 2)}</td>
        <td class="num">${_f(z.stats.moyenne, 2)}</td><td class="num">${_f(z.stats.ecartType, 2)}</td>
        <td class="num">${_f(z.stats.cv, 1)}</td></tr>
        ${(z.horsPlage || []).length ? `<tr class="ar-row-outlier"><td colspan="7">Écart à la moyenne de zone supérieur à 2 écarts-types : ${z.horsPlage.map(x => esc(x.repere) + ' (' + _f(x.valeur, 2) + ' mm)').join(', ')}</td></tr>` : ''}`).join('')}
      </tbody></table></div>`;
  }
  function _dateFr(d) { if (!d) return '—'; const [y, m, j] = String(d).split('-'); return j ? `${j}/${m}/${y}` : d; }

  function _trace(c) {
    if (c.statut !== 'valide') return '';
    return `<div class="recap-section">
      <div class="recap-row"><span class="recap-label">Validée le</span><span>${esc(c.dateValidation || '—')}</span></div>
      <div class="recap-row"><span class="recap-label">Validée par</span><span>${esc(c.valideePar || c.operateur || '—')}</span></div>
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
    const payload = await _payload(c);
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

  /* Payload de validation. Les photos d'arrachement, gardées à part en local
     pour ne pas alourdir chaque synchro de brouillon, sont jointes ICI : le
     procès-verbal produit au bureau doit les contenir. */
  async function _payload(c) {
    if (c.type !== 'arrachement') return FicheModule.buildPayload(c);
    const images = {};
    try {
      for (const ph of await CAEKDB.getPhotosOf(c.ref)) images[ph.id] = ph.dataUrl;
    } catch (_) {}
    return FicheModule.buildPayload(c, { avecPhotos: true, images });
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
      if (row && row.type === 'arrachement') ArrachementModule.reprendre(newRef);
      else if (row && row.type === 'cfms') CfmsModule.reprendre(newRef);
      else if (row && row.type === 'compacite') CompaciteModule.reprendre(newRef);
      else if (row) CampagneModule.reprendre(newRef);
      else { AppNav.goto('screen-repertoire'); RepertoireModule.load(); }
    } catch (e) { alert('Erreur : ' + e.message); }
  }

  /* Remet un essai du payload serveur en forme locale éditable */
  function _essaiToLocal(e, type, i) {
    if (type === 'arrachement') {
      /* Les paliers et leurs lectures horodatées sont repris tels quels :
         une version corrigée ne réécrit jamais l'historique de mesure. */
      return { n: e.n || (i + 1), clou: e.clou || { repere: e.repere || '', zone: e.zone || '' },
               date: e.date || '', heure: e.heure || '', meteo: e.meteo || '',
               origine: e.origine, paliers: e.paliers || [], pIdx: Math.max(0, (e.paliers || []).length - 1),
               anomalies: e.anomalies || [], photos: e.photos || [],
               arret: e.arret || { stopped: false, motif: '' }, incomplet: !!e.incomplet, done: true,
               result: { yTmax: _n(e.yTmax), yMax: _n(e.yMax), alpha: _n(e.alpha),
                         remanentPa: _n(e.remanentPa), remanentFinal: _n(e.remanent),
                         classe: e.classe || '', classeAuto: e.classeAuto || '',
                         motifs: e.motifs || [], justification: e.justification || '' } };
    }
    if (type === 'compacite') {
      return { n: i + 1, no: e.no || ('E' + (i + 1)), emp: e.emp || '', date: '', heure: '', meteo: '',
               mode: e.gh ? 'calc' : 'direct', gh: e.gh || '', w: e.w || '', gd: e.gd || '', obs: e.obs || '',
               done: true, result: { gd: _n(e.gd), w: _n(e.w), taux: _n(e.taux) } };
    }
    return { n: i + 1, point: e.repere || '', gps: e.coord || '', date: e.date || '', heure: '', meteo: '',
             raz: (String(e.raz).toLowerCase() === 'oui') ? 'oui' : 'non', e1: e.e1 || '', z0: e.z0 || '', z1: e.z1 || '', z2: e.z2 || '',
             obs: e.obs || '', done: true, result: { ev1: _n(e.ev1), ev2: _n(e.ev2), k: _n(e.k) } };
  }

  function _dedupeLieu(s) {
    if (!s) return s;
    const parts = String(s).split(/\s+[—-]\s+/).map(x => x.trim()).filter(Boolean);
    const seen = new Set(), out = [];
    for (const p of parts) { const k = p.toLowerCase(); if (!seen.has(k)) { seen.add(k); out.push(p); } }
    return out.join(' — ');
  }
  function _today() { const d = new Date(); return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`; }
  function _n(v) { const x = parseFloat(String(v).replace(',', '.')); return isNaN(x) ? null : x; }
  function _f(v, d) { return (v == null || isNaN(v)) ? '—' : Number(v).toFixed(d); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  return { show, valider, creerVersion };
})();
