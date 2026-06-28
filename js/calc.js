'use strict';
/* ============================================================
   Calculs essai à la plaque Ø600 — Poutre Benkelman 2:1
   Lectures en 1/1000 mm. Rapport de levier = 2.
   e1_corrigé = (e1/1000) × 2
   RAZ=Oui : z2_corrigé = (z2/1000) × 2
   RAZ=Non : z2 = z1 - z0 ; z2_corrigé = ((z1/1000)-(z0/1000)) × 2
   EV1 = 112.5 / e1_corrigé   (MPa)
   EV2 = 90.0  / z2_corrigé   (MPa)
   K   = EV2 / EV1
   ============================================================ */
const PlaqueCalc = (() => {
  const LEVIER = 2;

  /* Valide les saisies brutes. Renvoie { ok, errors:[] } */
  function validate(es) {
    const errors = [];
    const e1 = _num(es.e1);
    if (es.e1 === '' || es.e1 == null || isNaN(e1)) errors.push('e1 manquant');

    if (es.raz === 'oui') {
      const z2 = _num(es.z2);
      if (es.z2 === '' || es.z2 == null || isNaN(z2)) errors.push('z2 manquant');
    } else {
      const z0 = _num(es.z0), z1 = _num(es.z1);
      if (es.z0 === '' || es.z0 == null || isNaN(z0)) errors.push('z0 ou z1 manquant');
      if (es.z1 === '' || es.z1 == null || isNaN(z1)) {
        if (!errors.includes('z0 ou z1 manquant')) errors.push('z0 ou z1 manquant');
      }
    }
    if (errors.length) return { ok: false, errors };

    const r = compute(es);
    if (!(r.e1c > 0)) errors.push('e1 corrigé invalide');
    if (!(r.z2c > 0)) errors.push('z2 corrigé invalide');
    return { ok: errors.length === 0, errors, result: errors.length === 0 ? r : null };
  }

  /* Calcule les valeurs corrigées et EV1/EV2/K (suppose saisies valides) */
  function compute(es) {
    const e1  = _num(es.e1);
    const e1c = (e1 / 1000) * LEVIER;
    let z2c;
    if (es.raz === 'oui') {
      const z2 = _num(es.z2);
      z2c = (z2 / 1000) * LEVIER;
    } else {
      const z0 = _num(es.z0), z1 = _num(es.z1);
      z2c = ((z1 / 1000) - (z0 / 1000)) * LEVIER;
    }
    const ev1 = e1c > 0 ? 112.5 / e1c : null;
    const ev2 = z2c > 0 ? 90.0  / z2c : null;
    const k   = (ev1 && ev2) ? ev2 / ev1 : null;
    return { e1c, z2c, ev1, ev2, k };
  }

  /* Conformité CPS. cps = { ev1min, ev2min, kmax } (champs facultatifs).
     Renvoie { hasExig, ev1:bool|null, ev2:bool|null, k:bool|null, global:bool|null } */
  function conformite(res, cps) {
    cps = cps || {};
    const ev1min = _num(cps.ev1min), ev2min = _num(cps.ev2min), kmax = _num(cps.kmax);
    const hasEv1 = cps.ev1min !== '' && cps.ev1min != null && !isNaN(ev1min);
    const hasEv2 = cps.ev2min !== '' && cps.ev2min != null && !isNaN(ev2min);
    const hasK   = cps.kmax   !== '' && cps.kmax   != null && !isNaN(kmax);
    const hasExig = hasEv1 || hasEv2 || hasK;
    if (!hasExig) return { hasExig: false, ev1: null, ev2: null, k: null, global: null };

    const okEv1 = hasEv1 ? (res.ev1 != null && res.ev1 >= ev1min) : null;
    const okEv2 = hasEv2 ? (res.ev2 != null && res.ev2 >= ev2min) : null;
    const okK   = hasK   ? (res.k   != null && res.k   <= kmax)   : null;
    const checks = [okEv1, okEv2, okK].filter(v => v !== null);
    const global = checks.length ? checks.every(Boolean) : null;
    return { hasExig: true, ev1: okEv1, ev2: okEv2, k: okK, global };
  }

  function _num(v) {
    if (v === '' || v == null) return NaN;
    return parseFloat(String(v).replace(',', '.'));
  }

  function fmt(v, dec = 1) { return (v == null || isNaN(v)) ? '—' : Number(v).toFixed(dec); }

  return { validate, compute, conformite, fmt, LEVIER };
})();
