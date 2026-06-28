'use strict';
/* ============================================================
   Administration (réservé is_admin) : opérateurs, entreprises, projets.
   ============================================================ */
const AdminModule = (() => {
  let _tab = 'op';

  async function load() { showTab('op'); }

  function showTab(t) {
    _tab = t;
    ['op', 'ent', 'proj'].forEach(x => {
      document.getElementById('adm-tab-' + x).classList.toggle('is-active', x === t);
      document.getElementById('adm-pane-' + x).hidden = (x !== t);
    });
    if (t === 'op') loadOperators();
    if (t === 'ent') loadEntreprises();
    if (t === 'proj') loadProjets();
  }

  /* ===================== OPÉRATEURS ===================== */
  async function loadOperators() {
    _hide('adm-op-form');
    const el = document.getElementById('adm-op-list');
    el.innerHTML = '<p class="empty-msg">Chargement…</p>';
    try {
      const r = await ServerModule.adminListOperators(AuthModule.token());
      if (!r || !r.ok) { el.innerHTML = `<p class="empty-msg">Session expirée ou accès refusé.<br>Déconnectez-vous puis reconnectez-vous.</p>`; return; }
      const ops = r.operators || [];
      if (!ops.length) { el.innerHTML = '<p class="empty-msg">Aucun opérateur.</p>'; return; }
      el.innerHTML = ops.map(_opCard).join('');
      el.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => _editOp(ops.find(o => o.id === b.dataset.edit))));
      el.querySelectorAll('[data-toggle]').forEach(b => b.addEventListener('click', () => _toggleOp(b.dataset.toggle, b.dataset.actif === '1')));
    } catch (e) { el.innerHTML = `<p class="empty-msg">Erreur réseau.</p>`; }
  }
  function _opCard(o) {
    return `<div class="op-card ${o.actif ? '' : 'op-inactif'}">
      <div class="op-card-head"><span class="op-id">${esc(o.identifiant)}</span><span class="op-nom">${esc(o.nom)}</span>
        ${o.is_admin ? '<span class="badge badge-version">admin</span>' : ''}${o.actif ? '' : '<span class="badge badge-incomplet">inactif</span>'}</div>
      <div class="text-muted" style="font-size:13px">${esc(o.fonction || '')}</div>
      <div class="op-card-actions">
        <button class="rep-btn" data-edit="${o.id}">✏️ Modifier</button>
        <button class="rep-btn" data-toggle="${o.id}" data-actif="${o.actif ? 1 : 0}">${o.actif ? '🚫 Désactiver' : '☑️ Activer'}</button>
      </div></div>`;
  }
  function showAddOp() {
    _show('adm-op-form'); document.getElementById('adm-op-form-title').textContent = 'Nouvel opérateur';
    _val('adm-op-id', ''); _val('adm-op-identifiant', ''); _val('adm-op-nom', ''); _val('adm-op-fonction', ''); _val('adm-op-pin', '');
    document.getElementById('adm-op-identifiant').readOnly = false;
    document.getElementById('adm-op-admin').checked = false; document.getElementById('adm-op-actif').checked = true;
    document.getElementById('adm-op-pin-hint').textContent = '(obligatoire)';
  }
  function _editOp(o) {
    if (!o) return;
    _show('adm-op-form'); document.getElementById('adm-op-form-title').textContent = 'Modifier l\'opérateur';
    _val('adm-op-id', o.id); _val('adm-op-identifiant', o.identifiant); _val('adm-op-nom', o.nom); _val('adm-op-fonction', o.fonction || ''); _val('adm-op-pin', '');
    document.getElementById('adm-op-identifiant').readOnly = false;
    document.getElementById('adm-op-admin').checked = !!o.is_admin; document.getElementById('adm-op-actif').checked = o.actif !== false;
    document.getElementById('adm-op-pin-hint').textContent = '(laisser vide = inchangé)';
    document.getElementById('adm-op-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  async function saveOp() {
    const op = {
      id: _get('adm-op-id') || null, identifiant: _get('adm-op-identifiant').trim(),
      nom: _get('adm-op-nom').trim(), fonction: _get('adm-op-fonction').trim(),
      pin: _get('adm-op-pin').trim(), is_admin: document.getElementById('adm-op-admin').checked,
      actif: document.getElementById('adm-op-actif').checked,
    };
    if (!op.identifiant || !op.nom) { alert('Identifiant et nom obligatoires.'); return; }
    if (!op.id && !op.pin) { alert('Le code PIN est obligatoire pour un nouvel opérateur.'); return; }
    if (!AuthModule.token()) { alert('Session perdue. Déconnectez-vous puis reconnectez-vous.'); return; }
    try {
      const r = await ServerModule.adminUpsertOperator(AuthModule.token(), op);
      if (!r || !r.ok) { alert(_failMsg(r)); return; }
      _hide('adm-op-form'); loadOperators();
    } catch (e) { alert('Erreur : ' + e.message); }
  }
  async function _toggleOp(id, actif) {
    try { const r = await ServerModule.adminSetActive(AuthModule.token(), id, !actif); if (r && !r.ok) { alert(_failMsg(r)); return; } loadOperators(); }
    catch (e) { alert('Erreur : ' + e.message); }
  }

  /* ===================== ENTREPRISES ===================== */
  async function loadEntreprises() {
    _hide('adm-ent-form');
    const el = document.getElementById('adm-ent-list');
    el.innerHTML = '<p class="empty-msg">Chargement…</p>';
    try {
      const list = await ServerModule.listEntreprises(AuthModule.token());
      if (!Array.isArray(list) || !list.length) { el.innerHTML = '<p class="empty-msg">Aucune entreprise.</p>'; return; }
      el.innerHTML = list.map(e => `<div class="ent-card">
        <div class="op-card-head"><span class="op-id">${esc(e.nom)}</span><span class="op-nom">clé : ${esc(e.cle)}</span></div>
        <div class="text-muted" style="font-size:13px">${esc(e.activite || '')}</div>
        <div class="ent-card-actions"><button class="rep-btn" data-edit="${esc(e.cle)}">✏️ Modifier</button></div></div>`).join('');
      el.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => _editEnt(list.find(x => x.cle === b.dataset.edit))));
    } catch (e) { el.innerHTML = '<p class="empty-msg">Erreur réseau.</p>'; }
  }
  function showAddEnt() {
    _show('adm-ent-form'); document.getElementById('adm-ent-form-title').textContent = 'Nouvelle entreprise';
    ['cle', 'nom', 'activite', 'adresse', 'capital', 'rc', 'logo'].forEach(f => _val('adm-ent-' + f, ''));
    document.getElementById('adm-ent-cle').readOnly = false;
  }
  function _editEnt(e) {
    if (!e) return;
    _show('adm-ent-form'); document.getElementById('adm-ent-form-title').textContent = 'Modifier l\'entreprise';
    _val('adm-ent-cle', e.cle); _val('adm-ent-nom', e.nom); _val('adm-ent-activite', e.activite || '');
    _val('adm-ent-adresse', e.adresse || ''); _val('adm-ent-capital', e.capital || ''); _val('adm-ent-rc', e.rc || '');
    _val('adm-ent-logo', e.logoKey || '');
    document.getElementById('adm-ent-cle').readOnly = true;
    document.getElementById('adm-ent-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  async function saveEnt() {
    const ent = {
      cle: _get('adm-ent-cle').trim().toLowerCase(), nom: _get('adm-ent-nom').trim(),
      activite: _get('adm-ent-activite').trim(), adresse: _get('adm-ent-adresse').trim(),
      capital: _get('adm-ent-capital').trim(), rc: _get('adm-ent-rc').trim(),
      logoKey: _get('adm-ent-logo').trim(), actif: true,
    };
    if (!ent.cle || !ent.nom) { alert('Clé et nom obligatoires.'); return; }
    try {
      const r = await ServerModule.adminUpsertEntreprise(AuthModule.token(), ent);
      if (!r || !r.ok) { alert(_failMsg(r)); return; }
      _hide('adm-ent-form'); await Referentiel.sync(); loadEntreprises();
    } catch (e) { alert('Erreur : ' + e.message); }
  }

  /* ===================== PROJETS ===================== */
  async function loadProjets() {
    _hide('adm-proj-form');
    const el = document.getElementById('adm-proj-list');
    el.innerHTML = '<p class="empty-msg">Chargement…</p>';
    try {
      const list = await ServerModule.listProjets(AuthModule.token());
      if (!Array.isArray(list) || !list.length) { el.innerHTML = '<p class="empty-msg">Aucun projet. Importez client.xlsx ou ajoutez manuellement.</p>'; return; }
      el.innerHTML = list.map(p => {
        const code = p.code_projet || p.codeProjet;
        return `<div class="proj-card">
          <div class="proj-card-header"><span class="proj-code">${esc(code)}</span><span class="proj-client">${esc(p.client || '')}</span></div>
          <div class="proj-card-body"><div class="proj-info">${esc(p.nom_projet || p.nomProjet || '')}</div>
            <div class="proj-info text-muted">${esc([p.lieu, p.wilaya].filter(Boolean).join(' — '))}${p.entreprise_cle ? ' · ent: ' + esc(p.entreprise_cle) : ''}</div></div>
          <div class="proj-card-actions"><button class="btn-action" data-edit="${esc(code)}" title="Modifier">✏️</button>
            <button class="btn-action" data-del="${esc(code)}" title="Supprimer">🗑️</button></div></div>`;
      }).join('');
      el.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => _editProj(list.find(p => (p.code_projet || p.codeProjet) === b.dataset.edit))));
      el.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => _delProj(b.dataset.del)));
    } catch (e) { el.innerHTML = '<p class="empty-msg">Erreur réseau.</p>'; }
  }
  function showAddProj() {
    _show('adm-proj-form'); document.getElementById('adm-proj-form-title').textContent = 'Ajouter un projet';
    ['code', 'client', 'entreprise', 'entcle', 'nom', 'lieu', 'wilaya'].forEach(f => _val('adm-proj-' + f, ''));
    document.getElementById('adm-proj-code').readOnly = false; document.getElementById('adm-proj-actif').checked = true;
  }
  function _editProj(p) {
    if (!p) return;
    _show('adm-proj-form'); document.getElementById('adm-proj-form-title').textContent = 'Modifier le projet';
    _val('adm-proj-code', p.code_projet || p.codeProjet); _val('adm-proj-client', p.client || '');
    _val('adm-proj-entreprise', p.entreprise || ''); _val('adm-proj-entcle', p.entreprise_cle || p.entrepriseCle || '');
    _val('adm-proj-nom', p.nom_projet || p.nomProjet || ''); _val('adm-proj-lieu', p.lieu || ''); _val('adm-proj-wilaya', p.wilaya || '');
    document.getElementById('adm-proj-code').readOnly = true; document.getElementById('adm-proj-actif').checked = p.actif !== false;
    document.getElementById('adm-proj-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  async function saveProj() {
    const projet = {
      codeProjet: _get('adm-proj-code').trim().toUpperCase(), client: _get('adm-proj-client').trim(),
      entreprise: _get('adm-proj-entreprise').trim(), entrepriseCle: _get('adm-proj-entcle').trim().toLowerCase(),
      nomProjet: _get('adm-proj-nom').trim(), lieu: _get('adm-proj-lieu').trim(), wilaya: _get('adm-proj-wilaya').trim(),
      actif: document.getElementById('adm-proj-actif').checked,
    };
    if (!projet.codeProjet) { alert('Code projet obligatoire.'); return; }
    try {
      const r = await ServerModule.adminSaveProjet(AuthModule.token(), projet);
      if (!r || !r.ok) { alert(_failMsg(r)); return; }
      _hide('adm-proj-form'); await Referentiel.sync(); loadProjets();
    } catch (e) { alert('Erreur : ' + e.message); }
  }
  async function _delProj(code) {
    if (!confirm(`Supprimer le projet "${code}" ?`)) return;
    try { const r = await ServerModule.adminDeleteProjet(AuthModule.token(), code); if (r && !r.ok) { alert(_failMsg(r)); return; } await Referentiel.sync(); loadProjets(); }
    catch (e) { alert('Erreur : ' + e.message); }
  }

  /* ---- Import client.xlsx -> serveur ---- */
  async function importExcel(file) {
    let wb;
    try { wb = XLSX.read(await file.arrayBuffer(), { type: 'array' }); }
    catch (e) { alert('Fichier Excel invalide.'); return; }
    const norm = s => (s || '').toString().trim().toLowerCase().replace(/[\s_\-./]+/g, '');
    const sheetByName = name => { const k = Object.keys(wb.Sheets).find(k => norm(k) === norm(name) || norm(k).includes(norm(name))); return k ? wb.Sheets[k] : null; };
    const rowsOf = sh => sh ? XLSX.utils.sheet_to_json(sh, { defval: '' }) : [];
    const finder = (row, keys) => (...pats) => { for (const pat of pats) { const k = keys.find(k => norm(k).includes(norm(pat))); if (k && String(row[k]).trim() !== '') return String(row[k]).trim(); } return ''; };
    const isOui = v => /^(oui|yes|1|vrai|true|o|x)$/i.test(String(v).trim());

    const clients = {};
    for (const row of rowsOf(sheetByName('CLIENTS'))) {
      const keys = Object.keys(row); const f = finder(row, keys);
      const id = f('clientid', 'idclient', 'id'); if (!id) continue;
      clients[id.toUpperCase()] = { nom: f('nomclient', 'raisonsociale', 'client', 'nom'), ville: f('ville', 'wilaya', 'commune'), actif: row[keys.find(k => norm(k).includes('actif'))] === undefined ? true : isOui(f('actif')) };
    }
    let projRows = rowsOf(sheetByName('PROJETS') || sheetByName('PROJET'));
    if (!projRows.length) projRows = rowsOf(wb.Sheets[wb.SheetNames[0]]);
    if (!projRows.length) { alert('Aucun projet trouvé.'); return; }

    let imported = 0, ignored = 0;
    const token = AuthModule.token();
    for (const row of projRows) {
      const keys = Object.keys(row); const f = finder(row, keys);
      const code = (f('codeprojet', 'code', 'codeproj') || '').toUpperCase(); if (!code) { ignored++; continue; }
      const clientId = (f('clientid', 'idclient') || '').toUpperCase(); const cli = clients[clientId] || {};
      const actifProjRaw = keys.find(k => norm(k).includes('actif'));
      const actif = (actifProjRaw ? isOui(row[actifProjRaw]) : true) && (cli.actif !== false);
      if (!actif) { ignored++; continue; }
      try {
        await ServerModule.adminSaveProjet(token, {
          codeProjet: code, clientId, client: cli.nom || f('client'), entreprise: cli.nom || f('entreprise'),
          entrepriseCle: f('entreprisecle', 'clentreprise'), nomProjet: f('nomprojet', 'projet', 'designation'),
          lieu: f('localisation', 'lieu', 'adresse'), wilaya: cli.ville || f('wilaya', 'ville'), actif: true,
        });
        imported++;
      } catch (e) { ignored++; }
    }
    await Referentiel.sync(); loadProjets();
    alert(`Import : ${imported} projet(s) importé(s), ${ignored} ignoré(s).`);
  }

  function _show(id) { document.getElementById(id).hidden = false; }
  function _hide(id) { document.getElementById(id).hidden = true; }
  function _val(id, v) { const el = document.getElementById(id); if (el) el.value = v; }
  function _get(id) { const el = document.getElementById(id); return el ? el.value : ''; }
  function _failMsg(r) {
    const e = r && r.error;
    if (e === 'admin' || e === 'auth') return 'Session expirée ou droits insuffisants.\nDéconnectez-vous puis reconnectez-vous (Profil → Se déconnecter).';
    if (e === 'identifiant_existe') return 'Cet identifiant existe déjà.';
    if (e === 'pin_requis') return 'Le code PIN est obligatoire.';
    return 'Échec' + (e ? ' : ' + e : '') + '.';
  }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  return { load, showTab, showAddOp, saveOp, showAddEnt, saveEnt, showAddProj, saveProj, importExcel };
})();
