'use strict';
/* ============================================================
   Répertoire commun (plaque + compacité).
   Fusionne les enregistrements LOCAUX (brouillons/incomplets) et les fiches
   du SERVEUR (validées / partagées). Filtres : type + statut.
   ============================================================ */
const RepertoireModule = (() => {
  let _statut = 'tous', _type = 'tous', _items = [];

  async function load() {
    const local = await CAEKDB.getAllCampagnes();
    const map = new Map();
    for (const c of local) map.set(c.ref, _viewLocal(c));

    // Serveur (si dispo)
    const token = AuthModule.token();
    if (token && ServerModule.configured() && navigator.onLine) {
      try {
        const rows = await ServerModule.listFiches(token, null);
        if (Array.isArray(rows)) for (const row of rows) {
          const v = _viewServer(row);
          const ex = map.get(v.ref);
          // Une fiche non validée (incomplet/brouillon) appartient à l'appareil qui la
          // détient en local : on GARDE la copie locale (éditable → bouton « Reprendre »),
          // car le serveur ré-enregistre toujours un updated_at plus récent lors de la
          // synchro et ferait sinon disparaître la reprise. Le serveur ne l'emporte que
          // s'il n'existe aucune copie locale, ou si la fiche est validée (verrouillée).
          if (!ex || v.statut === 'valide') {
            map.set(v.ref, v);
          }
        }
      } catch (_) { /* hors-ligne : on garde le local */ }
    }
    _items = [...map.values()].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    _renderFilters(); _renderList();
  }

  function _viewLocal(c) {
    const done = (c.essais || []).filter(e => e && e.done && !e.incomplet).length;
    return {
      ref: c.ref, type: c.type || 'plaque', statut: c.statut || 'incomplet',
      client: c.client || '', projet: c.nomProjet || '', code: c.codeProjet || '',
      ouvrage: c.ouvrage || '', partie: c.partieOuvrage || '',
      nb: c.type === 'cfms' ? _cfmsPrevus(c.cfms) : (c.nbEssais || done), done, date: _campaignDate(c),
      version: c.version || 1, remplaceePar: c.remplaceePar || '',
      valideePar: c.valideePar || '',
      updatedAt: c.updatedAt || c.createdAt || 0, source: 'local',
    };
  }
  function _viewServer(row) {
    const p = row.payload || {};
    const done = row.type === 'cfms'
      ? (p.essais || []).filter(e => e && e.done && !e.incomplet).length
      : (p.essais || []).length;
    return {
      ref: row.ref, type: row.type || 'plaque', statut: row.statut || 'valide',
      client: p.client || '', projet: p.projet || '', code: p.code || '',
      ouvrage: p.ouvrage || '', partie: p.partie || '',
      nb: row.type === 'cfms' ? _cfmsPrevus(p.cfms) : done, done, date: p.dateValidation || _payloadDate(p),
      version: row.version || 1, remplaceePar: row.remplacee_par || '',
      valideePar: row.valide_par || (p.valideePar || ''), pvGenere: !!row.pv_genere,
      updatedAt: row.updated_at ? Date.parse(row.updated_at) : 0, source: 'server',
    };
  }

  function _renderFilters() {
    const counts = { tous: 0, incomplet: 0, brouillon: 0, valide: 0 };
    _items.filter(_typeMatch).forEach(c => { counts.tous++; if (counts[c.statut] !== undefined) counts[c.statut]++; });
    [['tous', 'Toutes'], ['incomplet', 'Incomplètes'], ['brouillon', 'Brouillons'], ['valide', 'Validées']].forEach(([f, lbl]) => {
      const b = document.getElementById('rep-filter-' + f);
      if (b) b.textContent = lbl + (counts[f] ? ` (${counts[f]})` : '');
    });
    ['tous', 'plaque', 'compacite', 'arrachement', 'cfms'].forEach(t => {
      const b = document.getElementById('rep-type-' + t);
      if (b) b.classList.toggle('is-active', _type === t);
    });
  }
  function _typeMatch(c) { return _type === 'tous' || c.type === _type; }

  function _renderList() {
    let list = _items.filter(_typeMatch);
    if (_statut !== 'tous') list = list.filter(c => c.statut === _statut);
    const el = document.getElementById('rep-list');
    if (!list.length) { el.innerHTML = `<p class="empty-msg">Aucune fiche dans cette catégorie.</p>`; return; }
    el.innerHTML = list.map(_card).join('');
    el.querySelectorAll('[data-action]').forEach(b => b.addEventListener('click', () => _dispatch(b.dataset.action, b.dataset.ref)));
  }

  function _card(c) {
    const locked = c.statut === 'valide';
    const statutClass = { incomplet: 'badge-incomplet', brouillon: 'badge-brouillon', valide: 'badge-valide' }[c.statut] || '';
    const statutLabel = { incomplet: 'Incomplet', brouillon: 'Brouillon achevé', valide: 'Validé' }[c.statut] || c.statut;
    const typeClass = { compacite: 'badge-type-compacite', arrachement: 'badge-type-arrachement', cfms: 'badge-type-cfms' }[c.type] || 'badge-type-plaque';
    const typeLabel = { compacite: 'Compacité', arrachement: 'Arrachement', cfms: 'Photovoltaïque CFMS' }[c.type] || 'Plaque';
    const editable = !locked && c.source === 'local';
    return `<div class="rep-card">
      <div class="rep-card-header">
        <div>
          <span class="rep-ref">${esc(c.ref)}</span>
          <span class="badge ${typeClass}">${typeLabel}</span>
          <span class="badge ${statutClass}">${statutLabel}</span>
          ${c.version > 1 ? `<span class="badge badge-version">v${c.version}</span>` : ''}
          ${c.remplaceePar ? `<span class="badge badge-remplacee">remplacée</span>` : ''}
        </div>
        <div class="rep-date">${esc(c.date)}</div>
      </div>
      <div class="rep-card-info"><span>${esc(c.code || '—')}</span> · <span>${esc(c.client || '—')}</span></div>
      <div class="rep-card-info">${esc(c.projet || '')}</div>
      <div class="rep-card-info text-muted">${esc(c.ouvrage || '')}${c.partie ? ' — ' + esc(c.partie) : ''}</div>
      <div class="rep-card-stats"><span>🧪 ${c.done}${c.nb ? '/' + c.nb : ''} ${c.type === 'arrachement' ? 'clou(s)' : 'essai(s)'}</span>${c.source === 'server' ? '<span>☁️ serveur</span>' : ''}${c.pvGenere ? '<span>📄 PV généré</span>' : ''}${(c.statut === 'valide' && c.valideePar) ? '<span>✅ validé par ' + esc(c.valideePar) + '</span>' : ''}</div>
      <div class="rep-card-actions">
        <button class="rep-btn" data-action="consult" data-ref="${esc(c.ref)}">👁 Consulter</button>
        ${editable ? `<button class="rep-btn" data-action="reprendre" data-ref="${esc(c.ref)}">✏️ ${c.statut === 'incomplet' ? 'Reprendre' : 'Modifier'}</button>` : ''}
        ${c.statut === 'brouillon' ? `<button class="rep-btn rep-btn-valider" data-action="valider" data-ref="${esc(c.ref)}">✅ Valider</button>` : ''}
        <button class="rep-btn" data-action="share" data-ref="${esc(c.ref)}">📤 Envoyer</button>
        ${AuthModule.isAdmin()
          ? `<button class="rep-btn rep-btn-del" data-action="admin-delete" data-ref="${esc(c.ref)}">🗑️ Supprimer</button>`
          : (editable ? `<button class="rep-btn rep-btn-del" data-action="delete" data-ref="${esc(c.ref)}">🗑️</button>` : '')}
      </div>
    </div>`;
  }

  async function _dispatch(action, ref) {
    if (action === 'consult') return _consult(ref);
    if (action === 'reprendre') return _reprendre(ref);
    if (action === 'valider') return _valider(ref);
    if (action === 'share') return ShareModule.share(ref);
    if (action === 'delete') return _delete(ref);
    if (action === 'admin-delete') return _adminDelete(ref);
  }

  async function _adminDelete(ref) {
    if (!AuthModule.isAdmin()) return;
    if (!confirm(`Supprimer DÉFINITIVEMENT la fiche « ${ref} » ?\n\nAction administrateur — fonctionne même sur une fiche validée. Irréversible.`)) return;
    try {
      const r = await ServerModule.adminDeleteFiche(AuthModule.token(), ref);
      if (r && !r.ok) { alert(r.error === 'admin' ? 'Réservé à l\'administrateur (reconnectez-vous).' : 'Échec : ' + (r.error || '')); return; }
    } catch (e) { alert('Erreur : ' + e.message); return; }
    try { await CAEKDB.deleteCampagne(ref); await CAEKDB.deletePhotosOf(ref); } catch (_) {}
    await load();
  }

  async function _getFull(ref) {
    let c = await CAEKDB.getCampagne(ref);
    if (c) return c;
    // sinon, reconstruire depuis le serveur (payload)
    const token = AuthModule.token();
    if (token) {
      try {
        const rows = await ServerModule.listFiches(token, null);
        const row = (rows || []).find(r => r.ref === ref);
        if (row) return _fromServer(row);
      } catch (_) {}
    }
    return null;
  }
  function _fromServer(row) {
    const p = row.payload || {};
    return { ...p, ref: row.ref, type: row.type, statut: row.statut, version: row.version,
             valideePar: row.valide_par, dateValidation: row.date_validation,
             remplaceePar: row.remplacee_par, refPrecedente: row.ref_precedente, refBase: row.ref_base,
             nbEssais: (p.essais || []).length, _server: true,
             // remettre la forme locale pour l'affichage détail
             nomProjet: p.projet, codeProjet: p.code, partieOuvrage: p.partie, cfms: p.cfms };
  }
  async function _consult(ref) { const c = await _getFull(ref); if (c) DetailModule.show(c); }
  async function _reprendre(ref) {
    const c = await CAEKDB.getCampagne(ref);
    if (!c) { alert('Fiche disponible uniquement sur le serveur (déjà envoyée).'); return; }
    if (c.type === 'arrachement') ArrachementModule.reprendre(ref);
    else if (c.type === 'cfms') CfmsModule.reprendre(ref);
    else if (c.type === 'compacite') CompaciteModule.reprendre(ref);
    else CampagneModule.reprendre(ref);
  }
  async function _valider(ref) { const c = await _getFull(ref); if (c) DetailModule.show(c, true); }
  async function _delete(ref) {
    const c = await CAEKDB.getCampagne(ref);
    if (!c) return;
    if (c.statut === 'valide') { alert('Fiche validée : suppression impossible.'); return; }
    if (!confirm(`Supprimer la fiche "${ref}" ? Action irréversible.`)) return;
    await CAEKDB.deleteCampagne(ref);
    try { await CAEKDB.deletePhotosOf(ref); } catch (_) {}
    const token = AuthModule.token();
    if (token) { try { await ServerModule.deleteFiche(token, ref); } catch (_) {} }
    await load();
  }

  function setFilter(f) { _statut = f; _renderList(); }
  function setType(t) { _type = t; _renderFilters(); _renderList(); }

  function _campaignDate(c) {
    const e = (c.essais || []).find(x => x && x.date);
    if (e && e.date) { const [y, m, j] = e.date.split('-'); return `${j}/${m}/${y}`; }
    const d = new Date(c.createdAt || Date.now());
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  }
  function _payloadDate(p) {
    const e = (p.essais || []).find(x => x && x.date);
    if (e && e.date) { const [y, m, j] = e.date.split('-'); return `${j}/${m}/${y}`; }
    return '';
  }
  function _dateFr(d) { if (!d) return ''; const a = String(d).split('-'); return a.length === 3 ? `${a[2]}/${a[1]}/${a[0]}` : d; }
  /* CFMS : le total prévu est nbSc × (latéraux + tractions) par sous-champ. */
  function _cfmsPrevus(x) {
    if (!x) return 0;
    if (x.essaisPrevus) return x.essaisPrevus;
    return (x.nbSc || 0) * ((x.nbL || 0) + (x.nbT || 0));
  }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  return { load, setFilter, setType };
})();
