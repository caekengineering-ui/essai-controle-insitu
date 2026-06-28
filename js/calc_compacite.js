'use strict';
/* ============================================================
   Calculs essai de COMPACITÉ in situ (taux de compactage).
   Réf. Proctor OPM. Norme NF P94-061 (partie selon la méthode).
   γd in situ = saisie directe OU γh / (1 + w/100)
   Taux de compactage = γd in situ / γd max OPM × 100   (VALEUR EXACTE, non plafonnée)
   Conformité : taux ≥ taux min (CPS)
   NB : le plafonnement « > 100 % » est un AFFICHAGE (PV), pas la donnée.
   ============================================================ */
const CompaciteCalc = (() => {

  /* Méthode de mesure -> norme NF P94-061 */
  const METHODES = {
    'gammadensimetre':      'NF P94-061-1',
    'densitometreamembrane':'NF P94-061-2',
    'conedesable':          'NF P94-061-3',
  };
  function normeFor(methode) {
    const n = _norm(methode);
    if (n.includes('gamma')) return 'NF P94-061-1';
    if (n.includes('membrane') || n.includes('densitometre')) return 'NF P94-061-2';
    if (n.includes('sable') || n.includes('cone')) return 'NF P94-061-3';
    return '';
  }

  /* Valide une saisie de point. mode : 'calc' (γh+w) | 'direct' (γd) */
  function validate(es, info) {
    const errors = [];
    const gdOpm = _num(info && info.gdOpm);
    if (!(gdOpm > 0)) errors.push('Densité sèche max OPM manquante.');
    let gd = null;
    if (es.mode === 'direct') {
      gd = _num(es.gd);
      if (es.gd === '' || es.gd == null || isNaN(gd)) errors.push('Densité sèche in situ manquante.');
    } else {
      const gh = _num(es.gh), w = _num(es.w);
      if (es.gh === '' || es.gh == null || isNaN(gh)) errors.push('Densité humide manquante.');
      if (es.w === '' || es.w == null || isNaN(w))    errors.push('Teneur en eau manquante.');
      if (!errors.length) gd = gh / (1 + w / 100);
    }
    if (errors.length) return { ok: false, errors };
    const taux = gd / gdOpm * 100;
    if (!(gd > 0) || !isFinite(taux)) { errors.push('Valeurs invalides.'); return { ok: false, errors }; }
    return { ok: true, errors: [], result: compute(es, info) };
  }

  /* Calcule γd (exact) et le taux (exact, NON plafonné) */
  function compute(es, info) {
    const gdOpm = _num(info && info.gdOpm);
    let gd;
    if (es.mode === 'direct') {
      gd = _num(es.gd);
    } else {
      const gh = _num(es.gh), w = _num(es.w);
      gd = gh / (1 + w / 100);
    }
    const w = es.mode === 'direct' ? _num(es.w) : _num(es.w);  // w affichée
    const taux = (gdOpm > 0 && gd > 0) ? (gd / gdOpm * 100) : null;
    return { gd, w: isNaN(w) ? null : w, taux };
  }

  /* Conformité : taux ≥ taux min (si défini). { hasExig, global } */
  function conformite(res, tauxMin) {
    const tm = _num(tauxMin);
    const has = tauxMin !== '' && tauxMin != null && !isNaN(tm);
    if (!has) return { hasExig: false, global: null };
    const ok = res.taux != null && res.taux >= tm;
    return { hasExig: true, global: ok };
  }

  /* Format affichage taux : > 100 % plafonné À L'AFFICHAGE seulement */
  function fmtTaux(taux) {
    if (taux == null || isNaN(taux)) return '—';
    if (taux > 100) return '> 100';
    return Number(taux).toFixed(1);
  }

  function fmt(v, dec = 3) { return (v == null || isNaN(v)) ? '—' : Number(v).toFixed(dec); }
  function _num(v) { if (v === '' || v == null) return NaN; return parseFloat(String(v).replace(',', '.')); }
  const _DIACRITICS = new RegExp('[\\u0300-\\u036f]', 'g');
  function _norm(s) {
    return (s || '').toString().normalize('NFD').replace(_DIACRITICS, '')
      .toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  return { validate, compute, conformite, fmt, fmtTaux, normeFor, METHODES };
})();
