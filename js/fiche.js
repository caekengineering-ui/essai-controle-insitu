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
        no: e.no || '', emp: e.emp || '',
        gh: e.mode === 'direct' ? '' : (e.gh || ''),
        w:  (e.w != null && e.w !== '') ? e.w : (r.w != null ? r.w : ''),
        gd: e.mode === 'direct' ? (e.gd || '') : (r.gd != null ? +r.gd.toFixed(3) : ''),
        taux: r.taux != null ? +r.taux.toFixed(2) : '',   // valeur EXACTE (non plafonnée)
        obs: e.obs || '',
      };
    });
    return p;
  }

  function buildPayload(c) {
    return c.type === 'compacite' ? buildCompacite(c) : buildPlaque(c);
  }

  return { buildPayload, buildPlaque, buildCompacite };
})();
