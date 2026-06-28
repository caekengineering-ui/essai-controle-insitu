'use strict';
/* ============================================================
   Partage du résumé d'une fiche au bureau (WhatsApp / Email / copie).
   (L'envoi des DONNÉES au serveur se fait à la validation ; ceci est un
    résumé lisible complémentaire.)
   ============================================================ */
const ShareModule = (() => {
  async function share(ref) {
    let c = await CAEKDB.getCampagne(ref);
    if (!c) {
      const token = AuthModule.token();
      if (token) { try { const rows = await ServerModule.listFiches(token, null); const row = (rows || []).find(r => r.ref === ref); if (row) c = { ...(row.payload || {}), ref: row.ref, type: row.type, statut: row.statut, version: row.version }; } catch (_) {} }
    }
    if (!c) return;
    const text = (c.type === 'compacite') ? _msgCompacite(c) : _msgPlaque(c);
    if (navigator.share) {
      try { await navigator.share({ title: `Essai ${c.ref}`, text }); return; }
      catch (err) { if (err.name === 'AbortError') return; }
    }
    try { await navigator.clipboard.writeText(text); } catch (_) {}
    _showModal(text, c.ref);
  }

  function _msgPlaque(c) {
    const C = (typeof PlaqueCalc !== 'undefined') ? PlaqueCalc.fmt : (v) => v;
    const done = (c.essais || []).filter(e => e && (e.done || e.result));
    const cps = c.cps || {};
    const exig = (cps.ev1min || cps.ev2min || cps.kmax)
      ? `Exigences : ${cps.ev1min ? 'EV1≥' + cps.ev1min : ''}${cps.ev2min ? ' EV2≥' + cps.ev2min : ''}${cps.kmax ? ' K≤' + cps.kmax : ''}`.trim()
      : 'Aucune exigence CPS';
    const lignes = done.map(e => { const r = e.result || {}; const cf = e.conforme == null ? '' : (e.conforme ? ' ✓' : ' ✗'); return `  • ${e.point || e.repere || ('Essai ' + e.n)} : EV1=${C(r.ev1, 1)} EV2=${C(r.ev2, 1)} MPa K=${C(r.k, 2)}${cf}`; }).join('\n');
    return [
      `🔬 ESSAI À LA PLAQUE Ø600 — ${c.ref}${c.version > 1 ? ' (v' + c.version + ')' : ''}`,
      _identTxt(c), `Date : ${c.dateValidation || ''}`, exig,
      done.length ? `Résultats :\n${lignes}` : null, '',
      `Statut : ${_statut(c)}  ·  Norme NF P94-117-1`,
      `CAEK Engineering Lab`,
    ].filter(l => l !== null).join('\n');
  }

  function _msgCompacite(c) {
    const fT = (typeof CompaciteCalc !== 'undefined') ? CompaciteCalc.fmtTaux : (v) => v;
    const unit = (c.proctor && c.proctor.unite === 'g/cm3') ? 'g/cm³' : 't/m³';
    const done = (c.essais || []).filter(e => e && (e.done || e.result));
    const lignes = done.map(e => { const r = e.result || {}; const cf = e.conforme == null ? '' : (e.conforme ? ' ✓' : ' ✗'); return `  • ${e.no || ('E' + e.n)}${e.emp ? ' (' + e.emp + ')' : ''} : γd=${_f(r.gd, 3)} ${unit} · taux=${fT(r.taux)} %${cf}`; }).join('\n');
    return [
      `🧱 COMPACITÉ IN SITU — ${c.ref}${c.version > 1 ? ' (v' + c.version + ')' : ''}`,
      _identTxt(c),
      `Méthode : ${c.methode || '—'} (${c.norme || ''})`,
      `OPM : γd max ${(c.proctor && c.proctor.gdOpm) || '—'} ${unit}${c.tauxMin ? ' · exigence ≥ ' + c.tauxMin + ' %' : ''}`,
      done.length ? `Résultats :\n${lignes}` : null, '',
      `Statut : ${_statut(c)}  ·  ${c.norme || 'NF P94-061'}`,
      `CAEK Engineering Lab`,
    ].filter(l => l !== null).join('\n');
  }

  function _identTxt(c) {
    const auto = c.auto === 'Oui';
    return [
      `${auto ? 'Maître d\'ouvrage' : 'Client'} : ${c.client || '—'}`,
      auto && c.entreprise && c.entreprise.nom ? `Entreprise : ${c.entreprise.nom}` : null,
      `Projet : ${c.nomProjet || c.projet || '—'} (${c.codeProjet || c.code || '—'})`,
      `Ouvrage : ${c.ouvrage || '—'}${(c.partieOuvrage || c.partie) ? ' — ' + (c.partieOuvrage || c.partie) : ''}`,
      c.niveau ? `Niveau : ${c.niveau}` : null,
    ].filter(Boolean).join('\n');
  }

  function _statut(c) { return { incomplet: 'Incomplet', brouillon: 'Brouillon achevé', valide: 'Validé' }[c.statut] || c.statut; }
  function _f(v, d) { return (v == null || isNaN(v)) ? '—' : Number(v).toFixed(d); }

  function _showModal(text, ref) {
    const modal = document.getElementById('share-modal');
    document.getElementById('share-text-preview').value = text;
    document.getElementById('share-wa').onclick = () => { window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank'); modal.hidden = true; };
    document.getElementById('share-email').onclick = () => { window.location.href = `mailto:?subject=${encodeURIComponent('Essai — ' + ref)}&body=${encodeURIComponent(text)}`; modal.hidden = true; };
    document.getElementById('share-copy').onclick = async () => { try { await navigator.clipboard.writeText(text); alert('Copié !'); } catch (_) {} };
    modal.hidden = false;
  }

  return { share };
})();
