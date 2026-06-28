'use strict';
/* ============================================================
   Synchronisation serveur + file d'attente hors-ligne.
   - sendFiche : pousse une fiche (save ou valider) ; si réseau KO -> outbox.
   - flushOutbox : rejoue la file d'attente quand le réseau revient.
   - bandeau réseau (net-bar) : online / offline / syncing.
   ============================================================ */
const SyncModule = (() => {

  function _bar(state, msg) {
    const bar = document.getElementById('net-bar');
    if (!bar) return;
    bar.className = 'net-bar is-' + state;
    bar.textContent = msg;
    bar.hidden = !msg;
  }

  function setOnlineState() {
    if (navigator.onLine) _bar('online', '');           // caché si tout va bien
    else _bar('offline', '📴 Hors-ligne — les fiches seront synchronisées au retour du réseau');
  }

  /* Envoie une fiche au serveur. op : 'save' | 'valider'.
     Renvoie { ok, queued, error }.
     - queued:true  => mise en file d'attente (hors-ligne) ; enregistrement local conservé. */
  async function sendFiche(op, ref, type, payload) {
    const token = AuthModule.token();
    if (!token) return { ok: false, error: 'auth' };
    try {
      const r = (op === 'valider')
        ? await ServerModule.validerFiche(token, ref, type, payload)
        : await ServerModule.saveFiche(token, ref, type, payload);
      if (r && r.ok) return { ok: true, queued: false, result: r };
      return { ok: false, error: (r && r.error) || 'serveur' };
    } catch (e) {
      if (e instanceof ServerModule.NetworkError) {
        await CAEKDB.outboxAdd({ ref, op, type, payload, ts: Date.now() });
        setOnlineState();
        return { ok: true, queued: true };
      }
      return { ok: false, error: e.message };
    }
  }

  /* Rejoue la file d'attente. Renvoie le nombre de fiches synchronisées. */
  let _flushing = false;
  async function flushOutbox() {
    if (_flushing || !navigator.onLine || !ServerModule.configured()) return 0;
    const token = AuthModule.token();
    if (!token) return 0;
    const items = await CAEKDB.outboxAll();
    if (!items.length) return 0;
    _flushing = true;
    _bar('syncing', `🔄 Synchronisation… (${items.length})`);
    let done = 0;
    for (const it of items) {
      try {
        const r = (it.op === 'valider')
          ? await ServerModule.validerFiche(token, it.ref, it.type, it.payload)
          : await ServerModule.saveFiche(token, it.ref, it.type, it.payload);
        if (r && (r.ok || r.error === 'deja_validee' || r.error === 'verrouillee')) {
          await CAEKDB.outboxRemove(it.ref); done++;
        }
      } catch (e) {
        if (e instanceof ServerModule.NetworkError) break;  // toujours hors-ligne : on s'arrête
        await CAEKDB.outboxRemove(it.ref);                  // erreur définitive : on retire
      }
    }
    _flushing = false;
    setOnlineState();
    if (done && typeof RepertoireModule !== 'undefined') {
      try { RepertoireModule.load(); } catch (_) {}
    }
    return done;
  }

  async function pendingCount() {
    try { return (await CAEKDB.outboxAll()).length; } catch (_) { return 0; }
  }

  function init() {
    window.addEventListener('online',  () => { setOnlineState(); flushOutbox(); });
    window.addEventListener('offline', setOnlineState);
    setOnlineState();
  }

  return { init, sendFiche, flushOutbox, pendingCount, setOnlineState };
})();
