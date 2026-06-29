'use strict';
/* ============================================================
   Client Supabase (RPC via fetch) — aucune dépendance externe.
   Toutes les opérations passent par des fonctions SQL SECURITY DEFINER
   (op_* / admin_*) ; la clé anon seule ne donne aucun accès direct aux tables.
   ============================================================ */
const ServerModule = (() => {

  function configured() {
    return CAEK_CONFIG.SUPABASE_URL &&
           !CAEK_CONFIG.SUPABASE_URL.includes('VOTRE-PROJET') &&
           CAEK_CONFIG.SUPABASE_ANON &&
           !CAEK_CONFIG.SUPABASE_ANON.includes('VOTRE_CLE');
  }

  class NetworkError extends Error { constructor(m){ super(m||'network'); this.name='NetworkError'; } }

  async function _rpc(fn, params) {
    if (!configured()) throw new Error('Serveur non configuré (js/config.js).');
    const url = `${CAEK_CONFIG.SUPABASE_URL}/rest/v1/rpc/${fn}`;
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'apikey': CAEK_CONFIG.SUPABASE_ANON,
          'Authorization': 'Bearer ' + CAEK_CONFIG.SUPABASE_ANON,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(params || {}),
      });
    } catch (e) {
      throw new NetworkError(e.message);   // hors-ligne / DNS / CORS réseau
    }
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.json()).message || ''; } catch (_) {}
      throw new Error(`Serveur (${res.status}) ${detail}`);
    }
    return res.json();
  }

  /* ---- Auth ---- */
  const login      = (identifiant, pin)        => _rpc('op_login',      { p_identifiant: identifiant, p_pin: pin });
  const verify     = (token)                    => _rpc('op_verify',     { p_token: token });
  const changePin  = (token, oldPin, newPin)    => _rpc('op_change_pin', { p_token: token, p_old_pin: oldPin, p_new_pin: newPin });

  /* ---- Fiches ---- */
  const saveFiche    = (token, ref, type, payload) => _rpc('op_save_fiche',    { p_token: token, p_ref: ref, p_type: type, p_payload: payload });
  const validerFiche = (token, ref, type, payload) => _rpc('op_valider_fiche', { p_token: token, p_ref: ref, p_type: type, p_payload: payload });
  const creerVersion = (token, ref, newRef)        => _rpc('op_creer_version', { p_token: token, p_ref: ref, p_new_ref: newRef });
  const listFiches   = (token, type)               => _rpc('op_list_fiches',   { p_token: token, p_type: type || null });
  const deleteFiche  = (token, ref)                => _rpc('op_delete_fiche',  { p_token: token, p_ref: ref });

  /* ---- Référentiels ---- */
  const listProjets     = (token) => _rpc('op_list_projets',     { p_token: token });
  const listEntreprises = (token) => _rpc('op_list_entreprises', { p_token: token });

  /* ---- Admin ---- */
  const adminListOperators = (token) => _rpc('admin_list_operators', { p_token: token });
  const adminUpsertOperator = (token, op) => _rpc('admin_upsert_operator', {
    p_token: token, p_id: op.id || null, p_identifiant: op.identifiant, p_pin: op.pin || '',
    p_nom: op.nom, p_fonction: op.fonction || '', p_is_admin: !!op.is_admin, p_actif: op.actif !== false,
  });
  const adminSetActive    = (token, id, actif) => _rpc('admin_set_operator_active', { p_token: token, p_id: id, p_actif: actif });
  const adminUpsertEntreprise = (token, ent) => _rpc('admin_upsert_entreprise', { p_token: token, p_ent: ent });
  const adminSaveProjet   = (token, projet) => _rpc('admin_save_projet',   { p_token: token, p_projet: projet });
  const adminDeleteProjet = (token, code)   => _rpc('admin_delete_projet', { p_token: token, p_code: code });
  const adminDeleteFiche  = (token, ref)    => _rpc('admin_delete_fiche',  { p_token: token, p_ref: ref });

  return {
    configured, NetworkError,
    login, verify, changePin,
    saveFiche, validerFiche, creerVersion, listFiches, deleteFiche,
    listProjets, listEntreprises,
    adminListOperators, adminUpsertOperator, adminSetActive,
    adminUpsertEntreprise, adminSaveProjet, adminDeleteProjet, adminDeleteFiche,
  };
})();
