'use strict';
/* ============================================================
   Construction du PAYLOAD de fiche (schéma unique lu ensuite par Python).
   Mappe un enregistrement local (campagne) vers le JSON envoyé au serveur.
   IMPORTANT : les noms de champs des essais correspondent exactement à ce
   qu'attendent pv_plaque.py / pv_compacite.py (info_essais_from_payload).
   ============================================================ */
const FicheModule = (() => {

  function _common(c) {
    const ent = c.entreprise || {};
    return {
      ref: c.ref, type: c.type, statut: c.statut || 'brouillon',
      version: c.version || 1, refBase: c.refBase || c.ref, refPrecedente: c.refPrecedente || '',
      operateur: c.operateur || (AuthModule.session() ? AuthModule.session().nom : ''),
      valideePar: c.valideePar || '', dateValidation: c.dateValidation || '',
      auto: c.auto || 'Non',
      entreprise: {
        nom: ent.nom || '', activite: ent.activite || '', adresse: ent.adresse || '',
        capital: ent.capital || '', rc: ent.rc || '', logoKey: ent.logoKey || '',
      },
      client: c.client || '', projet: c.nomProjet || c.projet || '', code: c.codeProjet || c.code || '',
      lieu: c.lieu || '', ouvrage: c.ouvrage || '', partie: c.partieOuvrage || c.partie || '',
      niveau: c.niveau || '', meteo: c.meteo || '',
      chargeEssai: c.chargeEssai || '', chefProjet: c.chefProjet || '',
    };
  }

  function buildPlaque(c) {
    const p = _common(c);
    p.norme = 'NF P94-117-1'; p.plaque = 'Ø600 mm'; p.levier = '2:1';
    p.reaction = c.typeReaction === 'autre' && c.reactionPrecision
      ? c.reactionPrecision
      : ({ camion: 'Camion', engin: 'Engin' }[c.typeReaction] || c.reactionPrecision || '');
    p.cps = {
      ev1min: (c.cps && c.cps.ev1min) || '', ev2min: (c.cps && c.cps.ev2min) || '',
      kmax: (c.cps && c.cps.kmax) || '',
    };
    p.essais = (c.essais || []).filter(e => e && e.done).map(e => {
      const r = e.result || {};
      return {
        repere: e.point || '', coord: e.gps || '', date: e.date || '',
        e1: e.e1 || '', raz: e.raz === 'oui' ? 'Oui' : 'Non',
        z0: e.z0 || '', z1: e.z1 || '', z2: e.z2 || '',
        ev1: r.ev1 != null ? +r.ev1.toFixed(2) : '', ev2: r.ev2 != null ? +r.ev2.toFixed(2) : '',
        k: r.k != null ? +r.k.toFixed(3) : '', obs: e.obs || '',
      };
    });
    return p;
  }

  function buildCompacite(c) {
    const p = _common(c);
    p.materiau = c.materiau || '';
    p.methode  = c.methode || '';
    p.norme    = c.norme || CompaciteCalc.normeFor(c.methode);
    p.proctor  = { gdOpm: (c.proctor && c.proctor.gdOpm) || '', unite: (c.proctor && c.proctor.unite) || 't/m3',
                   wOpm: (c.proctor && c.proctor.wOpm) || '' };
    p.tauxMin  = c.tauxMin || '';
    p.essais = (c.essais || []).filter(e => e && e.done).map(e => {
      const r = e.result || {};
      return {
        no: e.no || '', emp: e.emp || '', date: e.date || '',
        gh: e.mode === 'direct' ? '' : (e.gh || ''),
        w:  (e.w != null && e.w !== '') ? e.w : (r.w != null ? r.w : ''),
        gd: e.mode === 'direct' ? (e.gd || '') : (r.gd != null ? +r.gd.toFixed(3) : ''),
        taux: r.taux != null ? +r.taux.toFixed(2) : '',   // valeur EXACTE (non plafonnée)
        obs: e.obs || '',
      };
    });
    return p;
  }

  /* ---- ARRACHEMENT sur clous d'ancrage ----
     Le PV doit pouvoir être produit en justice ou en expertise : on exporte
     le programme de paliers, TOUTES les lectures horodatées avec leurs
     corrections, les anomalies, la check-list sécurité et le classement.
     Les photos (base64) ne partent qu'à la VALIDATION : à chaque
     enregistrement de brouillon, seules leurs métadonnées sont envoyées,
     pour ne pas saturer une liaison de chantier. */
  function buildArrachement(c, options) {
    const opt = options || {};
    const p = _common(c);
    p.norme = 'NF P94-242-1 · XP P94-444 · NF EN 14490';
    p.typeEssai = c.typeEssai === 'prealable' ? 'Essai préalable' : 'Essai de contrôle';
    p.typeEssaiCode = c.typeEssai || 'controle';
    p.tmax = c.tmax || '';
    p.materiel = Object.assign({}, c.materiel || {});
    const v = (typeof ArrachementCalc !== 'undefined') ? ArrachementCalc.getVerin(p.materiel.verin) : null;
    p.verin = v ? { modele: v.modele, marque: v.marque, surfaceCm2: v.surfaceCm2,
                    capaciteKN: v.capaciteKN, courseMm: v.courseMm, trouMm: v.trouMm, pmaxBar: v.pmaxBar } : null;
    p.relationEffortPression = (c.materiel && c.materiel.etalUtilisee)
      ? 'Courbe d\'étalonnage de l\'exemplaire' : 'Relation nominale (frottement du vérin ignoré)';
    p.params = c.params || {};
    p.paramsDefaut = c.paramsDefaut || {};
    p.paramsModifies = !!c.paramsModifies;
    p.etalonnagePerime = !!c.etalonnagePerime;
    p.checklist = Object.values(c.checklist || {});

    p.essais = (c.essais || []).filter(e => e && e.done).map(e => {
      const r = e.result || {};
      return {
        n: e.n, repere: (e.clou && e.clou.repere) || '', zone: (e.clou && e.clou.zone) || '',
        niveau: (e.clou && e.clou.niveau) || '', coord: (e.clou && e.clou.gps) || '',
        clou: e.clou || {}, date: e.date || '', heure: e.heure || '', meteo: e.meteo || '',
        origine: e.origine, incomplet: !!e.incomplet,
        arret: e.arret && e.arret.stopped ? e.arret : null,
        clouSubstitution: e.clouSubstitution || '',
        paliers: (e.paliers || []).map(pl => ({
          id: pl.id, code: pl.code, label: pl.label, phase: pl.phase, cycle: pl.cycle,
          fraction: pl.fraction, effort: _r(pl.effort, 2), pressionBar: _r(pl.pressionBar, 1),
          pressionSource: pl.pressionSource, dureeMin: pl.dureeMin, dureeEffectiveMin: _r(pl.dureeEffectiveMin, 2),
          lecturesMin: pl.lecturesMin || [], startedAt: pl.startedAt, endedAt: pl.endedAt,
          motifFin: pl.motifFin || '', prolonge: !!pl.prolonge, seuilApplique: pl.seuilApplique,
          alpha: _r(pl.alpha, 3),
          lectures: (pl.lectures || []).map(l => ({
            tMin: l.tMin, tReelMin: _r(l.tReelMin, 3), ts: l.ts, horodatage: _iso(l.ts),
            c1: l.c1, c2: l.c2, brut: _r(l.brut, 3), ecart: _r(l.ecart, 3), y: _r(l.y, 3),
            par: l.par || '', corrections: l.corrections || [],
          })),
        })),
        anomalies: e.anomalies || [],
        photos: (e.photos || []).map(ph => ({ id: ph.id, moment: ph.moment, ts: ph.ts,
                                              horodatage: _iso(ph.ts), geo: ph.geo || '',
                                              dataUrl: opt.avecPhotos ? (opt.images && opt.images[ph.id]) || '' : '' })),
        yTmax: _r(r.yTmax, 2), yMax: _r(r.yMax, 2), alpha: _r(r.alpha, 3),
        remanentPa: _r(r.remanentPa, 2), remanent: _r(r.remanentFinal != null ? r.remanentFinal : r.remanentPa, 2),
        classe: r.classe || '', classeAuto: r.classeAuto || '',
        classeLabel: (typeof ArrachementCalc !== 'undefined' && ArrachementCalc.CLASSES[r.classe]) ? ArrachementCalc.CLASSES[r.classe].label : '',
        motifs: r.motifs || [], justification: r.justification || '',
      };
    });

    /* Synthèse statistique par zone (§12) */
    if (typeof ArrachementCalc !== 'undefined') {
      const src = (c.essais || []).filter(e => e && e.done);
      p.synthese = {
        yTmax: ArrachementCalc.syntheseParZone(src, 'yTmax'),
        alpha: ArrachementCalc.syntheseParZone(src, 'alpha'),
        remanent: ArrachementCalc.syntheseParZone(src, 'remanent'),
      };
    }
    return p;
  }

  /* ---- CONTRÔLE PHOTOVOLTAÏQUE CFMS ----
     Le protocole et toutes les lectures sont transmis au bureau sous une
     forme explicite, sans dépendre d'un état d'écran mobile. */
  function buildCfms(c) {
    const p = _common(c);
    const x = c.cfms || {};
    const eq = x.equipement || {};
    const _essai = e => ({
      n: e.n, typeEssai: e.typeEssai, sousChamp: e.sousChampId || e.sousChamp || '',
      date: e.date || '', heure: e.heure || '', heureFin: e.heureFin || '',
      micropieu: e.micropieu || {}, origine: e.origine || {}, elsKn: e.elsKn || '',
      incomplet: !!e.incomplet, motifIncomplet: e.motifIncomplet || '',
      resultat: e.resultat || {}, done: !!e.done,
      /* Cycle de vie de l'essai : brouillon tant que l'opérateur ne l'a pas
         validé, verrouillé ensuite, rouvrable seulement par un renvoi. */
      statut: e.statut || (e.done ? 'brouillon' : 'en_cours'),
      valideLe: e.valideLe ? _iso(e.valideLe) : '', validePar: e.validePar || '',
      renvois: (e.renvois || []).map(r => ({ par: r.par || '', commentaire: r.commentaire || '',
                                             horodatage: _iso(r.ts) })),
      phaseEnCours: e.done ? null : e.phase,
      lectures: (e.lectures || []).map(l => ({
        phase: l.phase, t: l.t, tReelMin: l.tReelMin,
        horodatage: _iso(l.ts),
        skip: !!l.skip,                 // interne : consultable par le responsable
        l1: l.l1, l2: l.l2, l3: l.l3,
        d1: l.d1, d2: l.d2, d3: l.d3, dMoy: l.dMoy,
        /* Valeurs précédentes si la lecture a été reprise (rature). */
        corrections: (l.corrections || []).map(k => ({ l1: k.l1, l2: k.l2, l3: k.l3,
                                                       dMoy: k.dMoy, horodatage: _iso(k.ts) })),
      })),
    });
    p.norme = 'Recommandations CFMS — contrôle photovoltaïque';
    p.cfms = {
      protocole: '5 % ELS pendant 1 min → décharge → 110 % ELS pendant 5 min → décharge finale',
      compression: 'Exclue du contrôle CFMS',
      /* Deux efforts de service distincts, propres à la campagne. */
      elsLateralKn: x.elsLateralKn || '', elsTractionKn: x.elsTractionKn || '',
      elsAVerifier: !!x.elsAVerifier,
      diamDefaut: x.diamDefaut || '', longDefaut: x.longDefaut || '',
      nbSc: x.nbSc || 0, nbL: x.nbL || 0, nbT: x.nbT || 0,
      critereLateralMm: 5,
      /* Traçabilité du matériel : indispensable au PV, il ne doit jamais
         être reconstruit de mémoire au bureau. */
      equipement: {
        verinModele: eq.verinModele || '', aeffMm2: eq.aeffMm2 || '',
        aeffManuelle: !!eq.aeffManuelle, capaciteKN: eq.capaciteKN || '', pmaxBar: eq.pmaxBar || '',
        compType: eq.compType || '', compNb: eq.compNb || '', precision: eq.precision || '',
        compModele: eq.compModele || '', pompe: eq.pompe || '',
        manoMaxBar: eq.manoMaxBar || '', manoModele: eq.manoModele || '',
      },
      sousChamps: (x.sousChamps || []).map(s => ({
        id: s.id, ordre: s.ordre, lRest: s.lRest, tRest: s.tRest,
        lFait: s.lFait || 0, tFait: s.tFait || 0,
      })),
      complete: !!x.complete,
      essaisRealises: (c.essais || []).filter(e => e && e.done && !e.incomplet).length,
      essaisPrevus: (x.nbSc || 0) * ((x.nbL || 0) + (x.nbT || 0)),
      /* L'essai en cours part AUSSI au serveur : si l'appareil est perdu ou
         cassé en cours de campagne, le palier déjà relevé n'est pas perdu. */
      essaiEnCours: x.enCours ? _essai(x.enCours) : null,
    };
    p.essais = (c.essais || []).map(_essai);
    return p;
  }

  function buildPayload(c, options) {
    if (c.type === 'arrachement') return buildArrachement(c, options);
    if (c.type === 'cfms') return buildCfms(c);
    return c.type === 'compacite' ? buildCompacite(c) : buildPlaque(c);
  }

  function _r(v, d) { const x = parseFloat(v); return isNaN(x) ? null : +x.toFixed(d); }
  function _iso(ts) { return ts ? new Date(ts).toISOString() : ''; }

  return { buildPayload, buildPlaque, buildCompacite, buildArrachement, buildCfms };
})();
