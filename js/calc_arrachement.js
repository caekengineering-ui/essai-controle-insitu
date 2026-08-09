'use strict';
/* ============================================================
   Calculs ESSAI D'ARRACHEMENT sur clous d'ancrage.
   Réf. NF P94-242-1 (clous en sol) · XP P94-444 (ancrages au rocher)
        NF EN 14490 (clouage du sol).

   EFFORT <-> PRESSION (relation NOMINALE : le frottement interne du vérin,
   qui peut atteindre quelques % de l'effort, est ignoré) :
       P [MPa] = F [kN] x 10 / A [cm²]        (= F [N] / A [mm²])
       P [bar] = 10 x P [MPa] = F [kN] x 100 / A [cm²]
   Contrôle : 40 kN sur RCH-302 -> 40 x 10 / 46,58 = 8,59 MPa = 85,9 bar.
   Si une courbe d'étalonnage de l'EXEMPLAIRE est disponible (F = a.P + b,
   issue du certificat), elle PRIME sur la relation nominale ; le PV indique
   laquelle a été utilisée (champ `source` renvoyé par pression()/effort()).

   DÉPLACEMENTS : l'origine (zéro) est la lecture de FIN du palier de serrage
   Pa. Toute valeur y renvoyée ici est déjà comptée depuis cette origine.

   FLUAGE :  alpha = [y(t2) - y(t1)] / log10(t2/t1)   en mm par décade.
   ============================================================ */
const ArrachementCalc = (() => {

  /* ---------------------------------------------------------------
     CATALOGUE VÉRINS — donnée, pas constante figée : d'autres vérins
     seront ajoutés (cf. ArrachementCalc.verins() / addVerin()).
     Vérins creux simple effet Enerpac RCH, P max d'utilisation 700 bar.
     --------------------------------------------------------------- */
  const PMAX_BAR = 700;

  const VERINS_BASE = [
    { modele: 'RCH-202',  marque: 'Enerpac', surfaceCm2: 30.45,  capaciteKN: 210, courseMm: 50.8, trouMm: 26.9, pmaxBar: PMAX_BAR },
    { modele: 'RCH-302',  marque: 'Enerpac', surfaceCm2: 46.58,  capaciteKN: 321, courseMm: 63.5, trouMm: 33.3, pmaxBar: PMAX_BAR },
    { modele: 'RCH-603',  marque: 'Enerpac', surfaceCm2: 82.13,  capaciteKN: 566, courseMm: 76.2, trouMm: 53.8, pmaxBar: PMAX_BAR },
    { modele: 'RCH-1003', marque: 'Enerpac', surfaceCm2: 133.10, capaciteKN: 918, courseMm: 76.2, trouMm: 79.0, pmaxBar: PMAX_BAR },
  ];
  let _verinsSup = [];                                  // ajouts (Admin / futur référentiel serveur)
  function verins()        { return VERINS_BASE.concat(_verinsSup); }
  function setVerinsSup(l) { _verinsSup = Array.isArray(l) ? l : []; }
  function getVerin(modele) { return verins().find(v => v.modele === modele) || null; }

  /* ---------------------------------------------------------------
     PROGRAMME NORMATIF — fixé par le type d'essai, NON MODIFIABLE sur le
     terrain. Paliers, durées, temps de lecture et seuils d'interprétation
     découlent des référentiels (NF P94-242-1, XP P94-444, NF EN 14490) :
     ils ne sont pas des réglages de campagne.

     Ce qui varie d'une campagne à l'autre, c'est la DONNÉE : tension
     d'épreuve Tmax, matériel, géométrie des clous, découpage en talus.
     Le programme est recopié dans la campagne au moment de sa création,
     et cette copie fait foi pour la fiche : si le programme normatif
     évolue, les essais déjà réalisés restent lisibles tels qu'exécutés.
     --------------------------------------------------------------- */
  const PROGRAMME = {
    prealable: {
      fractionPa: 0.10,
      fractionsCharge: [0.20, 0.40, 0.60, 0.80],
      fractionsDecharge: [0.60, 0.20],
      dureePaMin: 5,       lecturesPa: [0, 1, 2, 5],
      dureePalierMin: 5,   lecturesPalier: [0, 1, 2, 5],
      dureeFinalMin: 15,   lecturesFinal: [0, 1, 2, 5, 10, 15],
      dureeFinalProlongeeMin: 60, lecturesFinalProlongee: [20, 30, 45, 60],
      dureeDechargeMin: 1, lecturesDecharge: [1],
      dureeRetourPaMin: 2, lecturesRetourPa: [0, 1, 2],
      dureeZeroMin: 2,     lecturesZero: [2],
      nbCycles: 1,
      stabilisationActive: false,          // généralement désactivée
      seuilStabMmParMin: 0.05,
      dureeMiniMaintienMin: 2,
      alphaT1Min: 2,
      alphaOk: 0.5, alphaHaut: 1.0,
      ypOk: 3.0, ypHaut: 5.0,
      seuilDeplacementMm: 10,
      seuilEcartComparateursMm: 0.3,
      toleranceEffortPct: 2,
    },
    /* Essai de contrôle — cycle unique, paliers de 0,2 Tmax.
       Pa et paliers intermédiaires de 5 min lus en 0-1-2-5, clôture anticipée
       possible à 2 min sur stabilisation ; palier final de 5 min mené à son
       terme, prolongé seulement s'il n'est pas stabilisé ; déchargement par
       paliers d'une minute ; déchargement complet à lecture différée. */
    controle: {
      fractionPa: 0.10,
      fractionsCharge: [0.20, 0.40, 0.60, 0.80],
      fractionsDecharge: [0.60, 0.20],
      dureePaMin: 5,       lecturesPa: [0, 1, 2, 5],
      dureePalierMin: 5,   lecturesPalier: [0, 1, 2, 5],
      dureeFinalMin: 5,    lecturesFinal: [0, 1, 2, 5],
      dureeFinalProlongeeMin: 20, lecturesFinalProlongee: [10, 15, 20],
      dureeDechargeMin: 1, lecturesDecharge: [1],
      dureeRetourPaMin: 2, lecturesRetourPa: [0, 1, 2],
      dureeZeroMin: 2,     lecturesZero: [2],
      nbCycles: 1,                         // cycle unique
      stabilisationActive: true,           // généralement activée
      seuilStabMmParMin: 0.05,
      dureeMiniMaintienMin: 2,
      /* Le fluage est ancré à 2 min et court jusqu'à la DERNIÈRE lecture du
         palier final : 5 min normalement, 20 min si celui-ci a été prolongé.
         La division par log10(t2/t1) garde alpha en mm par décade dans les
         deux cas, les seuils ci-dessous restent donc comparables. */
      alphaT1Min: 2,
      alphaOk: 0.5, alphaHaut: 1.0,
      ypOk: 3.0, ypHaut: 5.0,              // déplacement en tête sous Pp
      seuilDeplacementMm: 10,              // arrêt immédiat du chargement
      seuilEcartComparateursMm: 0.3,
      toleranceEffortPct: 2,
    },
  };
  /* Copie du programme normatif. Chaque campagne en conserve la sienne :
     c'est elle qui est appliquée et restituée dans la fiche. */
  function programme(typeEssai) {
    const src = PROGRAMME[typeEssai === 'prealable' ? 'prealable' : 'controle'];
    return JSON.parse(JSON.stringify(src));
  }
  const defauts = programme;               // ancien nom, conservé

  /* ---------------------------------------------------------------
     EFFORT <-> PRESSION
     --------------------------------------------------------------- */

  /* Pression à appliquer pour un effort donné.
     etal = { a, b, valide } courbe F = a.P + b (P en bar, F en kN) -> prioritaire.
     Renvoie { bar, mpa, source:'etalonnage'|'nominal', depasse } */
  function pression(effortKN, verin, etal) {
    const F = _num(effortKN);
    if (!verin || !(verin.surfaceCm2 > 0) || isNaN(F)) return { bar: null, mpa: null, source: 'nominal', depasse: false };
    let bar;
    let source = 'nominal';
    if (etal && etal.valide && _num(etal.a) > 0) {
      bar = (F - (_num(etal.b) || 0)) / _num(etal.a);   // inversion de F = a.P + b
      source = 'etalonnage';
    } else {
      bar = F * 100 / verin.surfaceCm2;
    }
    const pmax = verin.pmaxBar || PMAX_BAR;
    return { bar, mpa: bar / 10, source, depasse: bar > pmax };
  }

  /* Effort correspondant à une pression lue (contrôle / redondance manomètre). */
  function effort(pressionBar, verin, etal) {
    const P = _num(pressionBar);
    if (!verin || !(verin.surfaceCm2 > 0) || isNaN(P)) return { kN: null, source: 'nominal' };
    if (etal && etal.valide && _num(etal.a) > 0) {
      return { kN: _num(etal.a) * P + (_num(etal.b) || 0), source: 'etalonnage' };
    }
    return { kN: P * verin.surfaceCm2 / 100, source: 'nominal' };
  }

  /* ---------------------------------------------------------------
     CONTRÔLES DE COMPATIBILITÉ (§14) — renvoie une liste d'avertissements
     { niveau:'bloquant'|'alerte'|'info', texte }
     --------------------------------------------------------------- */
  function controlerMontage(p) {
    // p : { verin, tmax, diamBarre, diamAccessoire, etal, courseUtiliseeMm }
    const out = [];
    const v = p.verin;
    if (!v) return out;
    const tmax = _num(p.tmax);

    /* Passage de la barre ET de ses accessoires de tirage dans le trou central */
    const dBarre = _num(p.diamBarre);
    const dAcc = _num(p.diamAccessoire);
    const dPassant = Math.max(isNaN(dBarre) ? 0 : dBarre, isNaN(dAcc) ? 0 : dAcc);
    if (dPassant > 0) {
      if (dPassant >= v.trouMm) {
        out.push({ niveau: 'bloquant', texte:
          `Ø ${_f(dPassant, 1)} mm (barre + accessoires de tirage) ≥ Ø trou central du ${v.modele} (${_f(v.trouMm, 1)} mm) : le vérin ne peut pas être enfilé. Choisissez un vérin de trou supérieur.` });
      } else if (dPassant > v.trouMm - 2) {
        out.push({ niveau: 'alerte', texte:
          `Jeu très faible dans le trou central du ${v.modele} (Ø ${_f(v.trouMm, 1)} mm pour Ø ${_f(dPassant, 1)} mm) : vérifiez le passage du manchon et de la tige de rallonge avant l'essai.` });
      }
    } else {
      out.push({ niveau: 'info', texte: 'Ø de la barre et des accessoires de tirage non renseignés : la compatibilité avec le trou central du vérin n\'a pas pu être vérifiée.' });
    }

    /* Capacité et pression maximale */
    if (tmax > 0) {
      const pr = pression(tmax, v, p.etal);
      if (tmax > v.capaciteKN) {
        out.push({ niveau: 'bloquant', texte:
          `Tension max ${_f(tmax, 0)} kN supérieure à la capacité du ${v.modele} (${_f(v.capaciteKN, 0)} kN).` });
      }
      if (pr.depasse) {
        out.push({ niveau: 'bloquant', texte:
          `La pression au palier final (${_f(pr.bar, 0)} bar) dépasse la pression maximale d'utilisation (${v.pmaxBar || PMAX_BAR} bar).` });
      }
      /* Surdimensionnement : le point de fonctionnement descend en bas
         d'échelle du manomètre, où l'incertitude de lecture pèse lourd sur
         l'effort. On le signale avec le chiffre, sans l'interdire. */
      const ratio = tmax / v.capaciteKN;
      if (ratio < 0.20) {
        out.push({ niveau: 'alerte', texte:
          `Tension max = ${_f(ratio * 100, 0)} % de la capacité du ${v.modele} (${_f(pr.bar, 0)} bar sur ${v.pmaxBar || PMAX_BAR}) : le manomètre travaille en bas d'échelle, son incertitude pèse d'autant plus sur l'effort. Un vérin de capacité plus proche, ou un capteur de force, améliorerait la mesure.` });
      }
    }

    /* Course disponible */
    const cUtil = _num(p.courseUtiliseeMm);
    if (!isNaN(cUtil) && cUtil > 0 && v.courseMm > 0) {
      const reste = v.courseMm - cUtil;
      if (reste <= 0) out.push({ niveau: 'bloquant', texte: `Course du ${v.modele} épuisée (${_f(v.courseMm, 1)} mm).` });
      else if (reste < 10) out.push({ niveau: 'alerte', texte: `Course restante ${_f(reste, 1)} mm sur ${_f(v.courseMm, 1)} mm : reprise du montage à prévoir avant la fin de l'essai.` });
    }
    return out;
  }

  /* Course restante en cours d'essai : mise en place + déplacement de la tête. */
  function courseRestante(verin, misEnPlaceMm, deplacementMm) {
    if (!verin || !(verin.courseMm > 0)) return null;
    const mep = _num(misEnPlaceMm) || 0, dep = _num(deplacementMm) || 0;
    return verin.courseMm - mep - dep;
  }

  /* ---------------------------------------------------------------
     GÉNÉRATION DU PROGRAMME DE PALIERS (§6.2 / §6.3)
     Le temps d'un palier démarre à l'ATTEINTE de l'effort cible (la montée
     doit se faire en 1 min au plus), pas au début de la montée en pression.
     --------------------------------------------------------------- */
  const PHASES = {
    serrage:     { label: 'Palier de serrage', code: 'Pa' },
    chargement:  { label: 'Chargement',        code: 'C'  },
    final:       { label: 'Palier final',      code: 'F'  },
    dechargement:{ label: 'Déchargement',      code: 'D'  },
    retour:      { label: 'Retour à Pa',       code: 'R'  },
    zero:        { label: 'Déchargement complet', code: 'Z' },
  };

  /* Durées et temps de lecture sont des DONNÉES du programme, jamais des
     constantes : la méthodologie du chantier peut les redéfinir, y compris
     pour le palier de serrage et le déchargement. */
  function _dur(v, dflt) { const x = _num(v); return (x > 0) ? x : dflt; }
  function _lec(v, dflt) {
    const l = (Array.isArray(v) ? v : []).map(_num).filter(x => !isNaN(x) && x >= 0);
    return (l.length ? l : dflt).slice().sort((a, b) => a - b);
  }

  function genererPaliers(tmax, prm, verin, etal) {
    const T = _num(tmax);
    const out = [];
    if (!(T > 0)) return out;
    const cycles = Math.max(1, parseInt(prm.nbCycles) || 1);
    let idx = 0;
    const push = (o) => {
      const pr = pression(o.effort, verin, etal);
      out.push(Object.assign({
        id: 'P' + (++idx),
        pressionBar: pr.bar, pressionSource: pr.source,
        toleranceEffortKN: o.effort * (_num(prm.toleranceEffortPct) || 2) / 100,
        startedAt: null, endedAt: null, motifFin: '', prolonge: false,
        lectures: [], alpha: null,
      }, o));
    };

    /* 1. Palier de serrage — met le montage en place, reprend les jeux,
          vérifie l'axialité. Sa DERNIÈRE lecture est l'origine des déplacements. */
    push({
      code: 'Pa', phase: 'serrage', cycle: 0,
      label: 'Pa — palier de serrage',
      fraction: _num(prm.fractionPa), effort: T * _num(prm.fractionPa),
      dureeMin: _dur(prm.dureePaMin, 5), lecturesMin: _lec(prm.lecturesPa, [0, 1, 2, 5]),
      origine: true, stabilisable: false,
    });

    for (let c = 1; c <= cycles; c++) {
      const plafond = T * c / cycles;                     // capacité recherchée par paliers de cycle
      const isDernier = (c === cycles);
      (prm.fractionsCharge || []).forEach(f => {
        const eff = plafond * f;
        if (eff <= T * _num(prm.fractionPa)) return;      // sous Pa : sans objet
        push({
          code: `C${Math.round(f * 100)}${cycles > 1 ? '/' + c : ''}`, phase: 'chargement', cycle: c,
          label: `${Math.round(f * 100)} % ${cycles > 1 ? '(cycle ' + c + ')' : ''}`.trim(),
          fraction: f, effort: eff,
          dureeMin: _num(prm.dureePalierMin), lecturesMin: (prm.lecturesPalier || []).slice(),
          stabilisable: true,
        });
      });
      push({
        code: isDernier ? 'FINAL' : `MAX/${c}`, phase: isDernier ? 'final' : 'chargement', cycle: c,
        label: isDernier ? `Palier final — Tmax` : `Maximum du cycle ${c}`,
        fraction: c / cycles, effort: plafond,
        dureeMin: isDernier ? _num(prm.dureeFinalMin) : _num(prm.dureePalierMin),
        lecturesMin: (isDernier ? (prm.lecturesFinal || []) : (prm.lecturesPalier || [])).slice(),
        /* Le palier final est EXCLU de la détection de stabilisation : il va
           toujours à son terme, car c'est sur lui que alpha est calculé. */
        stabilisable: !isDernier,
        final: isDernier,
      });
      if (!isDernier) {
        push({
          code: `R/${c}`, phase: 'retour', cycle: c,
          label: `Retour à Pa (fin du cycle ${c})`,
          fraction: _num(prm.fractionPa), effort: T * _num(prm.fractionPa),
          dureeMin: _dur(prm.dureeRetourPaMin, 2), lecturesMin: _lec(prm.lecturesRetourPa, [0, 1, 2]),
          stabilisable: false,
        });
      }
    }

    /* Déchargement final par paliers */
    (prm.fractionsDecharge || []).forEach(f => {
      push({
        code: `D${Math.round(f * 100)}`, phase: 'dechargement', cycle: cycles,
        label: `Déchargement ${Math.round(f * 100)} %`,
        fraction: f, effort: T * f,
        dureeMin: _dur(prm.dureeDechargeMin, 1), lecturesMin: _lec(prm.lecturesDecharge, [1]),
        stabilisable: false,
      });
    });
    push({
      code: 'RPa', phase: 'retour', cycle: cycles,
      label: 'Retour à Pa — déplacement rémanent',
      fraction: _num(prm.fractionPa), effort: T * _num(prm.fractionPa),
      dureeMin: _dur(prm.dureeRetourPaMin, 2), lecturesMin: _lec(prm.lecturesRetourPa, [0, 1, 2]),
      remanent: true, stabilisable: false,
    });
    push({
      code: 'ZERO', phase: 'zero', cycle: cycles,
      label: 'Déchargement complet — lecture différée',
      fraction: 0, effort: 0,
      dureeMin: _dur(prm.dureeZeroMin, 2), lecturesMin: _lec(prm.lecturesZero, [2]),
      remanentFinal: true, stabilisable: false,
    });
    return out;
  }

  /* Recalcule efforts + pressions d'un programme existant (Tmax ou vérin modifié). */
  function recalculerPressions(paliers, verin, etal) {
    (paliers || []).forEach(p => {
      const pr = pression(p.effort, verin, etal);
      p.pressionBar = pr.bar; p.pressionSource = pr.source;
    });
    return paliers;
  }

  /* ---------------------------------------------------------------
     LECTURES ET DÉPLACEMENTS (§6.4)
     Résolution comparateur 0,01 mm. Deux comparateurs -> moyenne retenue,
     l'écart est un indicateur d'AXIALITÉ.
     --------------------------------------------------------------- */
  function lectureBrute(c1, c2) {
    const a = _num(c1), b = _num(c2);
    const hasA = !isNaN(a), hasB = !isNaN(b);
    if (hasA && hasB) return { valeur: (a + b) / 2, ecart: Math.abs(a - b), nb: 2 };
    if (hasA) return { valeur: a, ecart: null, nb: 1 };
    if (hasB) return { valeur: b, ecart: null, nb: 1 };
    return { valeur: null, ecart: null, nb: 0 };
  }

  /* Déplacement compté depuis l'origine (fin du palier de serrage). */
  function depuisOrigine(brut, origine) {
    if (brut == null) return null;
    const o = _num(origine);
    return isNaN(o) ? brut : (brut - o);
  }

  /* Origine = dernière lecture valide du palier de serrage. */
  function origineDe(paliers) {
    const pa = (paliers || []).find(p => p.origine);
    if (!pa) return null;
    for (let i = pa.lectures.length - 1; i >= 0; i--) {
      const l = pa.lectures[i];
      if (l && l.brut != null && !isNaN(l.brut)) return l.brut;
    }
    return null;
  }

  /* Axialité : écart entre comparateurs au palier de serrage. */
  function controleAxialite(palierPa, seuilMm) {
    const s = _num(seuilMm);
    const seuil = isNaN(s) ? 0.3 : s;
    if (!palierPa || !palierPa.lectures.length) return { ok: null, ecart: null, seuil };
    const ecarts = palierPa.lectures.map(l => l && l.ecart).filter(e => e != null && !isNaN(e));
    if (!ecarts.length) return { ok: null, ecart: null, seuil };
    const emax = Math.max(...ecarts);
    return { ok: emax <= seuil, ecart: emax, seuil };
  }

  /* ---------------------------------------------------------------
     FLUAGE
     alpha = [y(t2) - y(t1)] / log10(t2/t1)      mm / décade
     t1 = alphaT1Min (2 min par défaut), t2 = DERNIÈRE lecture du palier :
       - palier final normal  : t2 = 5 min   -> alpha = 1,43 x [y(5) - y(2)]
       - palier final prolongé: t2 = 20 min  -> alpha = y(20) - y(2)
         (2 -> 20 min vaut exactement une décade)
     La normalisation par log10 rend les deux fenêtres comparables : les
     seuils 0,5 et 1,0 mm/décade s'appliquent sans changement. Mesurer sur
     0,4 décade puis rapporter à la décade amplifie en revanche le bruit
     d'un facteur ~2,5 : c'est le prix du palier court.
     --------------------------------------------------------------- */
  /* Temps d'une lecture pour le CALCUL. L'horodatage réel est toujours
     enregistré à part (§13) et prime ici tant qu'il correspond effectivement
     au temps de lecture programmé, soit entre 0,5 et 3 fois celui-ci. Hors de
     cette plage (lecture prise très en avance, saisie différée, reprise
     d'essai), le temps théorique du palier fait foi : alpha se calcule sur un
     RAPPORT de temps et deviendrait sinon aberrant ou incalculable. Les deux
     valeurs restent consignées dans la fiche, le bureau peut recalculer. */
  function tempsLecture(l) {
    if (!l) return NaN;
    const theo = _num(l.tMin), reel = _num(l.tReelMin);
    if (isNaN(reel) || reel <= 0) return theo;
    if (isNaN(theo) || theo <= 0) return reel;
    return (reel >= theo * 0.5 && reel <= theo * 3) ? reel : theo;
  }

  function alpha(lectures, t1, t2) {
    const L = (lectures || []).filter(l => l && l.y != null && !isNaN(l.y) && tempsLecture(l) > 0);
    if (L.length < 2) return null;
    const at = (t) => {
      let best = null;
      L.forEach(l => { if (best === null || Math.abs(tempsLecture(l) - t) < Math.abs(tempsLecture(best) - t)) best = l; });
      return best;
    };
    const T1 = _num(t1) > 0 ? _num(t1) : 1;
    const T2 = _num(t2) > 0 ? _num(t2) : Math.max(...L.map(tempsLecture));
    const l1 = at(T1), l2 = at(T2);
    if (!l1 || !l2) return null;
    const r1 = tempsLecture(l1), r2 = tempsLecture(l2);
    if (!(r1 > 0) || !(r2 > 0) || r2 <= r1) return null;
    return (l2.y - l1.y) / Math.log10(r2 / r1);
  }

  /* Fluage d'un palier, avec l'ancrage de la méthodologie : t1 = alphaT1Min
     (2 min) et t2 = dernière lecture effectivement prise sur ce palier.
     C'est la SEULE forme à utiliser pour classer un essai — alpha(l, 1, ...)
     reste disponible pour un recalcul libre au bureau. */
  function alphaPalier(p, prm) {
    if (!p || !p.lectures || !p.lectures.length) return null;
    const t1 = _num(prm && prm.alphaT1Min);
    return alpha(p.lectures, (t1 > 0 ? t1 : 2), _maxT(p));
  }
  function alphaFinal(essai, prm) { return alphaPalier(palierFinal(essai), prm); }

  /* Interprétation de alpha (§6.5). Seuils paramétrables. */
  function classeFluage(a, prm) {
    if (a == null || isNaN(a)) return { classe: null, label: '—', texte: 'Fluage non calculable.' };
    const ok = _num(prm && prm.alphaOk); const haut = _num(prm && prm.alphaHaut);
    const sOk = isNaN(ok) ? 0.5 : ok, sHaut = isNaN(haut) ? 1.0 : haut;
    if (a <= sOk)   return { classe: 'ok',      label: 'Stabilisé',     texte: `Comportement stabilisé (α ≤ ${_f(sOk, 2)} mm) — satisfaisant.` };
    if (a <= sHaut) return { classe: 'examen',  label: 'À examiner',    texte: `α entre ${_f(sOk, 2)} et ${_f(sHaut, 2)} mm : acceptable, à signaler et examiner.` };
    return             { classe: 'signaler', label: 'Non stabilisé', texte: `α > ${_f(sHaut, 2)} mm : non stabilisé — palier prolongé, essai signalé.` };
  }

  /* Déplacement en tête sous la charge d'épreuve. Échelle de GESTION : elle
     déclenche un examen, elle ne préjuge pas de la capacité du clou. Elle
     porte sur yp — déplacement en fin de palier final — et non sur le maximum
     atteint, qui relève du seuil d'arrêt (seuilDeplacementMm). */
  function classeYp(yp, prm) {
    if (yp == null || isNaN(yp)) return { classe: null, label: '—', texte: 'Déplacement sous Pp non disponible.' };
    const o = _num(prm && prm.ypOk), h = _num(prm && prm.ypHaut);
    const sOk = isNaN(o) ? 3.0 : o, sHaut = isNaN(h) ? 5.0 : h;
    if (yp <= sOk)   return { classe: 'ok',       label: 'Conforme à l\'attendu', texte: `yp ≤ ${_f(sOk, 1)} mm — conforme à l'attendu.` };
    if (yp <= sHaut) return { classe: 'examen',   label: 'À examiner',            texte: `${_f(sOk, 1)} < yp ≤ ${_f(sHaut, 1)} mm : à examiner au regard de la zone.` };
    return                { classe: 'signaler',  label: 'À signaler',            texte: `yp > ${_f(sHaut, 1)} mm : comportement à signaler.` };
  }

  /* Le palier final va toujours à son terme. AU TERME seulement, s'il n'est
     pas stabilisé, l'application PROPOSE de le prolonger — d'abord à
     dureeFinalProlongeeMin, puis à 60 min si alpha dépasse encore le seuil
     haut. Elle ne prolonge jamais d'elle-même : le technicien tranche, comme
     pour la stabilisation des paliers intermédiaires. */
  function suggestionProlongation(palier, prm) {
    const off = { suggere: false, raison: '', dureeMin: null, lectures: [] };
    if (!palier || !palier.final) return off;
    const a = alphaPalier(palier, prm);
    if (a == null) return off;
    const o = _num(prm && prm.alphaOk), h = _num(prm && prm.alphaHaut);
    const sOk = isNaN(o) ? 0.5 : o, sHaut = isNaN(h) ? 1.0 : h;
    const dProl = _dur(prm && prm.dureeFinalProlongeeMin, 20);
    const atteint = _num(palier.dureeMin) || 0;

    if (a > sHaut && atteint >= dProl && atteint < 60) {
      return { suggere: true, dureeMin: 60, lectures: [30, 45, 60], alpha: a,
        raison: `α = ${_f(a, 2)} mm/décade, toujours au-delà du seuil haut (${_f(sHaut, 2)} mm) après ${_f(atteint, 0)} min : poursuivre jusqu'à 60 min pour caractériser l'évolution.` };
    }
    if (a > sOk && atteint < dProl) {
      return { suggere: true, dureeMin: dProl, lectures: _lec(prm && prm.lecturesFinalProlongee, [10, 15, 20]), alpha: a,
        raison: `α = ${_f(a, 2)} mm/décade > ${_f(sOk, 2)} mm : déplacement non stabilisé au terme du palier. Prolonger jusqu'à ${_f(dProl, 0)} min.` };
    }
    return off;
  }

  /* Accélération : incrément du dernier intervalle > incrément d'un intervalle
     antérieur de MÊME durée (anormal, quel que soit alpha). */
  function accelerationDetectee(lectures) {
    const L = (lectures || []).filter(l => l && l.y != null && !isNaN(l.y)).slice().sort((a, b) => tempsLecture(a) - tempsLecture(b));
    if (L.length < 3) return false;
    const inc = [];
    for (let i = 1; i < L.length; i++) {
      inc.push({ d: tempsLecture(L[i]) - tempsLecture(L[i - 1]), v: L[i].y - L[i - 1].y });
    }
    const last = inc[inc.length - 1];
    if (!(last.d > 0)) return false;
    /* « Même durée » au sens du terrain : tolérance de 10 % (min. 6 s) sur des
       intervalles horodatés réellement, jamais exactement égaux. */
    const tol = Math.max(0.1, last.d * 0.10);
    for (let i = 0; i < inc.length - 1; i++) {
      if (Math.abs(inc[i].d - last.d) <= tol && last.v > inc[i].v + 1e-9) return true;
    }
    return false;
  }

  /* ---------------------------------------------------------------
     DÉTECTION DE STABILISATION (§6.6)
     Palier INTERMÉDIAIRE uniquement, jamais le palier final.
     Ne décide jamais : SUGGÈRE. Le technicien confirme ou poursuit.
     --------------------------------------------------------------- */
  function suggestionStabilisation(palier, prm) {
    const off = { suggere: false, raison: '' };
    if (!palier || palier.final || palier.stabilisable === false) return off;
    if (!prm || !prm.stabilisationActive) return off;
    const L = (palier.lectures || []).filter(l => l && l.y != null && !isNaN(l.y));
    const dureeMini = _num(prm.dureeMiniMaintienMin); const dMin = isNaN(dureeMini) ? 2 : dureeMini;
    const seuil = _num(prm.seuilStabMmParMin); const s = isNaN(seuil) ? 0.05 : seuil;
    if (L.length < 3) return { suggere: false, raison: 'Au moins trois lectures sont nécessaires.' };
    const derniere = L[L.length - 1], avant = L[L.length - 2];
    const tDer = tempsLecture(derniere);
    if (tDer < dMin) return { suggere: false, raison: `Durée minimale de maintien non atteinte (${_f(dMin, 0)} min).` };
    const dt = tDer - tempsLecture(avant);
    if (!(dt > 0)) return off;
    const vitesse = Math.abs(derniere.y - avant.y) / dt;      // mm/min
    if (vitesse <= s) {
      return { suggere: true, vitesse, seuil: s,
        raison: `Déplacement stabilisé : ${_f(vitesse, 3)} mm/min ≤ seuil ${_f(s, 3)} mm/min, après ${_f(tDer, 0)} min de maintien.` };
    }
    return { suggere: false, vitesse, seuil: s, raison: `Vitesse ${_f(vitesse, 3)} mm/min > seuil ${_f(s, 3)} mm/min.` };
  }

  /* ---------------------------------------------------------------
     CONDITIONS D'ARRÊT (§7) — alertes calculées après chaque lecture.
     --------------------------------------------------------------- */
  function alertes(essai, palier, prm, verin) {
    const out = [];
    const yMax = deplacementMax(essai);
    const seuilDep = _num(prm && prm.seuilDeplacementMm);
    const sd = isNaN(seuilDep) ? 10 : seuilDep;
    if (yMax != null && yMax > sd) {
      out.push({ niveau: 'bloquant', texte: `Déplacement en tête ${_f(yMax, 2)} mm > seuil d'alerte ${_f(sd, 1)} mm : arrêt du chargement.` });
    }
    if (palier) {
      const a = alphaPalier(palier, prm);
      const cf = classeFluage(a, prm);
      if (cf.classe === 'signaler') out.push({ niveau: 'alerte', texte: `α = ${_f(a, 2)} mm/décade — ${cf.texte}` });
      if (accelerationDetectee(palier.lectures)) {
        out.push({ niveau: 'alerte', texte: 'Accélération du déplacement sous effort constant : l\'incrément du dernier intervalle dépasse celui d\'un intervalle antérieur de même durée.' });
      }
      if (palier.pressionBar != null && verin && palier.pressionBar > (verin.pmaxBar || PMAX_BAR)) {
        out.push({ niveau: 'bloquant', texte: `Pression demandée ${_f(palier.pressionBar, 0)} bar > ${verin.pmaxBar || PMAX_BAR} bar.` });
      }
    }
    if (verin) {
      const reste = courseRestante(verin, essai && essai.courseMiseEnPlaceMm, yMax);
      if (reste != null && reste <= 0) out.push({ niveau: 'bloquant', texte: `Course du vérin épuisée (${_f(verin.courseMm, 1)} mm).` });
      else if (reste != null && reste < 10) out.push({ niveau: 'alerte', texte: `Fin de course proche : ${_f(reste, 1)} mm restants.` });
    }
    return out;
  }

  /* ---------------------------------------------------------------
     RÉSULTATS DE L'ESSAI
     --------------------------------------------------------------- */
  function palierFinal(essai)  { return (essai.paliers || []).find(p => p.final) || null; }
  function palierPa(essai)     { return (essai.paliers || []).find(p => p.origine) || null; }

  function derniereLecture(p) {
    if (!p || !p.lectures || !p.lectures.length) return null;
    for (let i = p.lectures.length - 1; i >= 0; i--) if (p.lectures[i] && p.lectures[i].y != null) return p.lectures[i];
    return null;
  }

  function deplacementMax(essai) {
    let m = null;
    (essai.paliers || []).forEach(p => (p.lectures || []).forEach(l => {
      if (l && l.y != null && !isNaN(l.y) && (m === null || l.y > m)) m = l.y;
    }));
    return m;
  }

  /* Déplacement à Tmax = dernière lecture du palier final. */
  function deplacementTmax(essai) {
    const l = derniereLecture(palierFinal(essai));
    return l ? l.y : null;
  }

  /* Rémanents : au retour à Pa, puis après déchargement complet. */
  function remanents(essai) {
    const pr = (essai.paliers || []).find(p => p.remanent);
    const pz = (essai.paliers || []).find(p => p.remanentFinal);
    const lr = derniereLecture(pr), lz = derniereLecture(pz);
    return { aPa: lr ? lr.y : null, apresDechargement: lz ? lz.y : null };
  }

  /* Points de fin de palier -> courbe effort / déplacement. */
  function courbeEffortDeplacement(essai) {
    const pts = [];
    (essai.paliers || []).forEach(p => {
      const l = derniereLecture(p);
      if (l) pts.push({ effort: p.effort, y: l.y, phase: p.phase, code: p.code, label: p.label });
    });
    return pts;
  }

  function compute(essai, prm) {
    const pf = palierFinal(essai);
    const aFinal = alphaPalier(pf, prm);
    const rem = remanents(essai);
    const yp = deplacementTmax(essai);
    return {
      yTmax: yp,
      yMax: deplacementMax(essai),
      alpha: aFinal,
      alphaT2Min: pf ? _maxT(pf) : null,        // fenêtre réellement utilisée
      fluage: classeFluage(aFinal, prm),
      deplacement: classeYp(yp, prm),
      remanentPa: rem.aPa,
      remanentFinal: rem.apresDechargement,
      acceleration: pf ? accelerationDetectee(pf.lectures) : false,
    };
  }
  function _maxT(p) { return Math.max(...((p && p.lectures) || []).map(l => tempsLecture(l) || 0), 1); }

  /* ---------------------------------------------------------------
     CLASSEMENT DE L'ESSAI (§11) — automatique à la clôture,
     modifiable par le responsable AVEC justification.
     --------------------------------------------------------------- */
  const CLASSES = {
    satisfaisant: { label: 'Recevable et satisfaisant', rang: 0 },
    examiner:     { label: 'Recevable — à examiner',    rang: 1 },
    signaler:     { label: 'Recevable — à signaler',    rang: 2 },
    non_recevable:{ label: 'Non recevable',             rang: 3 },
    non_realise:  { label: 'Non réalisé',               rang: 4 },
  };

  /* Effet des types d'anomalie sur l'essai (§9). */
  const ANOMALIES = [
    { code: 'materiel',   label: 'Anomalie de matériel',        detail: 'Fuite, dérive, comparateur bloqué ou en fin de course', effet: 'Essai non recevable',                     classe: 'non_recevable' },
    { code: 'montage',    label: 'Défaut de montage',           detail: 'Perte d\'axialité, glissement ou tassement d\'appui',    effet: 'Essai non recevable',                     classe: 'non_recevable' },
    { code: 'irrealisable', label: 'Essai non réalisable',      detail: 'Tête inaccessible, filetage endommagé, barre trop courte', effet: 'Essai non réalisé — désigner un clou de substitution', classe: 'non_realise' },
    { code: 'fluage',     label: 'Fluage supérieur au seuil',   detail: 'α au-delà du seuil haut',                                effet: 'Essai poursuivi, signalé',                classe: 'signaler' },
    { code: 'deplacement', label: 'Déplacement excessif',       detail: 'Déplacement en tête au-delà du seuil d\'alerte',         effet: 'Arrêt du chargement',                     classe: 'signaler' },
    { code: 'desordre',   label: 'Désordre sur l\'ouvrage',     detail: 'Déformation de plaque, poinçonnement du parement',       effet: 'Arrêt immédiat, signalement',             classe: 'signaler' },
    { code: 'atypique',   label: 'Valeur atypique',             detail: 'Résultat inattendu au regard de la zone',                effet: 'Essai maintenu, marqué pour examen',      classe: 'examiner' },
  ];
  function anomalieDef(code) { return ANOMALIES.find(a => a.code === code) || null; }

  const GRAVITES = ['mineure', 'majeure', 'critique'];

  function classer(essai, prm) {
    const motifs = [];
    let classe = 'satisfaisant';
    const monte = (c, motif) => {
      if (CLASSES[c] && CLASSES[c].rang > CLASSES[classe].rang) classe = c;
      if (motif) motifs.push(motif);
    };

    /* Anomalies déclarées */
    (essai.anomalies || []).forEach(a => {
      const def = anomalieDef(a.type);
      if (def) monte(def.classe, `${def.label} — ${def.effet}`);
    });

    if (classe === 'non_realise') return { classe, label: CLASSES[classe].label, motifs };

    const r = compute(essai, prm);

    /* Chaîne de mesure / montage */
    if (essai.etalonnagePerime) monte('non_recevable', 'Appareil de mesure hors validité d\'étalonnage.');
    const ax = controleAxialite(palierPa(essai), prm && prm.seuilEcartComparateursMm);
    if (ax.ok === false) monte('non_recevable', `Écart entre comparateurs ${_f(ax.ecart, 2)} mm > ${_f(ax.seuil, 2)} mm au palier de serrage : montage à reprendre (perte d'axialité).`);

    /* Programme respecté ? */
    const pf = palierFinal(essai);
    if (!pf || !pf.endedAt) monte('non_recevable', 'Palier final non mené à son terme : programme non respecté.');
    if (essai.arret && essai.arret.stopped) monte('non_recevable', `Essai interrompu — ${essai.arret.motif || 'motif non précisé'}.`);

    /* Déplacement anormalement faible : comparateur bloqué plutôt que clou parfait */
    if (r.yTmax != null && r.yTmax < 0.20) {
      monte('non_recevable', `Déplacement à Tmax de ${_f(r.yTmax, 2)} mm (< 0,20 mm) : indique un comparateur bloqué plutôt qu'un clou parfait.`);
    }

    /* Fluage (§10.2) */
    if (r.fluage.classe === 'signaler') monte('signaler', `α = ${_f(r.alpha, 2)} mm/décade au-delà du seuil haut.`);
    else if (r.fluage.classe === 'examen') monte('examiner', `α = ${_f(r.alpha, 2)} mm/décade en zone intermédiaire.`);

    /* Déplacement en tête sous Pp (§10.3) : échelle 3 / 5 mm sur yp. */
    if (r.deplacement.classe === 'signaler') monte('signaler', `Déplacement sous Pp yp = ${_f(r.yTmax, 2)} mm — ${r.deplacement.texte}`);
    else if (r.deplacement.classe === 'examen') monte('examiner', `Déplacement sous Pp yp = ${_f(r.yTmax, 2)} mm — ${r.deplacement.texte}`);

    /* Seuil d'arrêt (§9.6) : il porte sur le maximum atteint, à tout moment. */
    const sd = _num(prm && prm.seuilDeplacementMm); const seuilDep = isNaN(sd) ? 10 : sd;
    if (r.yMax != null && r.yMax > seuilDep) monte('signaler', `Déplacement maximal ${_f(r.yMax, 2)} mm > seuil d'arrêt ${_f(seuilDep, 1)} mm.`);
    if (r.acceleration) monte('signaler', 'Accélération du déplacement sous effort constant.');
    if ((essai.paliers || []).some(p => p.prolonge)) monte('examiner', 'Palier prolongé faute de stabilisation.');

    return { classe, label: CLASSES[classe].label, motifs, resultats: r };
  }

  /* ---------------------------------------------------------------
     SYNTHÈSE STATISTIQUE PAR ZONE (§12)
     --------------------------------------------------------------- */
  function stats(values) {
    const v = (values || []).map(_num).filter(x => !isNaN(x));
    const n = v.length;
    if (!n) return { n: 0, min: null, max: null, moyenne: null, ecartType: null, cv: null };
    const min = Math.min(...v), max = Math.max(...v);
    const moyenne = v.reduce((a, b) => a + b, 0) / n;
    const variance = n > 1 ? v.reduce((a, b) => a + (b - moyenne) ** 2, 0) / (n - 1) : 0;
    const ecartType = Math.sqrt(variance);
    const cv = moyenne !== 0 ? (ecartType / Math.abs(moyenne)) * 100 : null;
    return { n, min, max, moyenne, ecartType, cv };
  }

  /* Valeurs s'écartant de la moyenne de leur zone de plus de 2 écarts-types. */
  function syntheseParZone(essais, champ) {
    const zones = new Map();
    (essais || []).forEach(e => {
      const z = ((e.clou && e.clou.zone) || '—').trim() || '—';
      const val = _num(_pick(e, champ));
      if (isNaN(val)) return;
      if (!zones.has(z)) zones.set(z, []);
      zones.get(z).push({ repere: (e.clou && e.clou.repere) || ('E' + e.n), valeur: val });
    });
    const out = [];
    zones.forEach((list, zone) => {
      const s = stats(list.map(x => x.valeur));
      const hors = (s.ecartType > 0)
        ? list.filter(x => Math.abs(x.valeur - s.moyenne) > 2 * s.ecartType)
        : [];
      out.push({ zone, stats: s, valeurs: list, horsPlage: hors });
    });
    return out.sort((a, b) => a.zone.localeCompare(b.zone));
  }
  function _pick(e, champ) {
    const r = e.result || {};
    if (champ === 'alpha') return r.alpha;
    if (champ === 'remanent') return r.remanentFinal != null ? r.remanentFinal : r.remanentPa;
    return r.yTmax;
  }

  /* ---------------------------------------------------------------
     Utilitaires
     --------------------------------------------------------------- */
  function fmt(v, dec = 2) { return (v == null || isNaN(v)) ? '—' : Number(v).toFixed(dec); }
  function _f(v, d) { return fmt(v, d); }
  function _num(v) { if (v === '' || v == null) return NaN; return parseFloat(String(v).replace(',', '.')); }

  /* mm:ss à partir de secondes (compte à rebours des temps de lecture). */
  function mmss(sec) {
    const s = Math.max(0, Math.round(sec));
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }

  return {
    PMAX_BAR, CLASSES, ANOMALIES, GRAVITES, PHASES,
    verins, setVerinsSup, getVerin, programme, defauts,
    pression, effort, controlerMontage, courseRestante,
    genererPaliers, recalculerPressions,
    lectureBrute, depuisOrigine, origineDe, controleAxialite,
    alpha, alphaPalier, alphaFinal, tempsLecture, classeFluage, classeYp,
    accelerationDetectee, suggestionStabilisation, suggestionProlongation, alertes,
    palierFinal, palierPa, derniereLecture, deplacementMax, deplacementTmax, remanents,
    courbeEffortDeplacement, compute, classer, anomalieDef,
    stats, syntheseParZone,
    fmt, mmss,
  };
})();
