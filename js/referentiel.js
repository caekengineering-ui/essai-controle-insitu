'use strict';
/* ============================================================
   Référentiel partagé : projets, clients, entreprises (auto-contrôle).
   Synchronisé depuis le serveur puis mis en cache local (offline).
   Les deux assistants (plaque + compacité) s'en servent.
   ============================================================ */
const Referentiel = (() => {

  function _mapProjet(row) {
    return {
      codeProjet: row.code_projet || row.codeProjet || '',
      client:     row.client || '',
      entreprise: row.entreprise || '',
      nomProjet:  row.nom_projet || row.nomProjet || '',
      lieu:       row.lieu || '',
      wilaya:     row.wilaya || '',
      clientId:   row.client_id || row.clientId || '',
      entrepriseCle: row.entreprise_cle || row.entrepriseCle || '',
      actif:      row.actif !== false,
    };
  }
  function _mapEntreprise(row) {
    return {
      cle: row.cle || '', nom: row.nom || '', activite: row.activite || '',
      adresse: row.adresse || '', capital: row.capital || '', rc: row.rc || '',
      logoKey: row.logo_key || row.logoKey || '', actif: row.actif !== false,
    };
  }

  /* Récupère projets + entreprises du serveur et met en cache (silencieux si hors-ligne). */
  async function sync() {
    const token = AuthModule.token();
    if (!token || !ServerModule.configured()) return;
    try {
      const [projets, entreprises] = await Promise.all([
        ServerModule.listProjets(token),
        ServerModule.listEntreprises(token),
      ]);
      if (Array.isArray(projets))     await CAEKDB.cacheProjets(projets.map(_mapProjet));
      if (Array.isArray(entreprises)) await CAEKDB.cacheEntreprises(entreprises.map(_mapEntreprise));
    } catch (_) { /* hors-ligne : on garde le cache */ }
  }

  async function getActiveProjets() {
    return (await CAEKDB.getAllProjets()).filter(p => p.actif !== false);
  }
  const getProjet = code => CAEKDB.getProjet((code || '').toUpperCase());

  async function getActiveClients() {
    const projets = await getActiveProjets();
    const map = new Map();
    for (const p of projets) {
      const key = p.clientId || p.client || '—';
      if (!map.has(key)) map.set(key, { id: key, nom: p.client || key });
    }
    return [...map.values()].sort((a, b) => (a.nom || '').localeCompare(b.nom || ''));
  }
  async function getProjetsOfClient(key) {
    return (await getActiveProjets())
      .filter(p => (p.clientId || p.client || '—') === key)
      .sort((a, b) => (a.codeProjet || '').localeCompare(b.codeProjet || ''));
  }

  /* Identité entreprise (auto-contrôle) liée au projet, ou null. */
  async function getEntrepriseForProjet(p) {
    if (!p) return null;
    if (p.entrepriseCle) {
      const e = await CAEKDB.getEntreprise(p.entrepriseCle);
      if (e) return e;
    }
    // repli : entreprise par nom (clé = nom normalisé)
    if (p.entreprise) {
      const all = await CAEKDB.getAllEntreprises();
      const found = all.find(e => (e.nom || '').toLowerCase() === p.entreprise.toLowerCase());
      if (found) return found;
      return { cle: '', nom: p.entreprise, activite: '', adresse: '', capital: '', rc: '', logoKey: '' };
    }
    return null;
  }

  return { sync, getActiveProjets, getProjet, getActiveClients, getProjetsOfClient, getEntrepriseForProjet };
})();
