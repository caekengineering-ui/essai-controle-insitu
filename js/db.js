'use strict';
/* ============================================================
   Cache local (IndexedDB) — saisie hors-ligne + file d'attente de synchro.
   Le serveur Supabase reste la source de vérité ; ce cache permet de
   travailler sans réseau et de re-synchroniser ensuite.
   ============================================================ */
const CAEKDB = (() => {
  const DB_NAME = 'caek-controle';
  const DB_VER  = 2;
  let _db = null;

  function open() {
    if (_db) return Promise.resolve(_db);
    return new Promise((res, rej) => {
      const r = indexedDB.open(DB_NAME, DB_VER);
      r.onupgradeneeded = e => {
        const d = e.target.result;
        if (!d.objectStoreNames.contains('campagnes'))   d.createObjectStore('campagnes',   { keyPath: 'ref' });
        if (!d.objectStoreNames.contains('projets'))     d.createObjectStore('projets',     { keyPath: 'codeProjet' });
        if (!d.objectStoreNames.contains('entreprises')) d.createObjectStore('entreprises', { keyPath: 'cle' });
        if (!d.objectStoreNames.contains('outbox'))      d.createObjectStore('outbox',      { keyPath: 'ref' });
        if (!d.objectStoreNames.contains('compteurs'))   d.createObjectStore('compteurs',   { keyPath: 'key' });
        /* v2 — photos d'essai (arrachement) stockées à part : elles ne doivent
           pas alourdir l'enregistrement de campagne rejoué à chaque synchro. */
        if (!d.objectStoreNames.contains('photos')) {
          d.createObjectStore('photos', { keyPath: 'id' }).createIndex('ref', 'ref', { unique: false });
        }
      };
      r.onsuccess = e => { _db = e.target.result; res(_db); };
      r.onerror   = e => rej(e.target.error);
    });
  }

  async function _get(store, key) {
    const d = await open();
    return new Promise((res, rej) => {
      const r = d.transaction(store, 'readonly').objectStore(store).get(key);
      r.onsuccess = e => res(e.target.result);
      r.onerror   = e => rej(e.target.error);
    });
  }
  async function _put(store, val) {
    const d = await open();
    return new Promise((res, rej) => {
      const r = d.transaction(store, 'readwrite').objectStore(store).put(val);
      r.onsuccess = e => res(e.target.result);
      r.onerror   = e => rej(e.target.error);
    });
  }
  async function _del(store, key) {
    const d = await open();
    return new Promise((res, rej) => {
      const r = d.transaction(store, 'readwrite').objectStore(store).delete(key);
      r.onsuccess = () => res();
      r.onerror   = e => rej(e.target.error);
    });
  }
  async function _all(store) {
    const d = await open();
    return new Promise((res, rej) => {
      const r = d.transaction(store, 'readonly').objectStore(store).getAll();
      r.onsuccess = e => res(e.target.result);
      r.onerror   = e => rej(e.target.error);
    });
  }
  async function _clear(store) {
    const d = await open();
    return new Promise((res, rej) => {
      const r = d.transaction(store, 'readwrite').objectStore(store).clear();
      r.onsuccess = () => res();
      r.onerror   = e => rej(e.target.error);
    });
  }

  /* ---- Compteur de référence par (type, code) ---- */
  async function nextNumero(type, codeProjet) {
    const key = `${type}:${codeProjet}`;
    const cur = await _get('compteurs', key);
    const n = ((cur && cur.n) || 0) + 1;
    await _put('compteurs', { key, n });
    return n;
  }

  /* ---- Campagnes (local) ---- */
  const saveCampagne    = c    => _put('campagnes', c);
  const getCampagne     = ref  => _get('campagnes', ref);
  const getAllCampagnes = ()   => _all('campagnes');
  const deleteCampagne  = ref  => _del('campagnes', ref);

  /* ---- Projets (cache du serveur) ---- */
  const getProjet      = code => _get('projets', code);
  const getAllProjets  = ()   => _all('projets');
  async function cacheProjets(list) {
    await _clear('projets');
    for (const p of (list || [])) await _put('projets', p);
  }

  /* ---- Entreprises (cache du serveur) ---- */
  const getEntreprise     = cle => _get('entreprises', cle);
  const getAllEntreprises = ()  => _all('entreprises');
  async function cacheEntreprises(list) {
    await _clear('entreprises');
    for (const e of (list || [])) await _put('entreprises', e);
  }

  /* ---- Photos d'essai (arrachement) ---- */
  /* { id, ref, essaiN, moment:'avant'|'dispositif'|'apres'|'libre'|'anomalie',
       anomalieId, ts, geo, dataUrl }  — dataUrl = JPEG compressé. */
  const savePhoto   = ph => _put('photos', ph);
  const getPhoto    = id => _get('photos', id);
  const deletePhoto = id => _del('photos', id);
  async function getPhotosOf(ref, essaiN) {
    const d = await open();
    return new Promise((res, rej) => {
      const idx = d.transaction('photos', 'readonly').objectStore('photos').index('ref');
      const r = idx.getAll(ref);
      r.onsuccess = e => {
        const list = e.target.result || [];
        res(essaiN == null ? list : list.filter(p => p.essaiN === essaiN));
      };
      r.onerror = e => rej(e.target.error);
    });
  }
  async function deletePhotosOf(ref) {
    for (const p of await getPhotosOf(ref)) await _del('photos', p.id);
  }

  /* ---- File d'attente de synchro (outbox) ---- */
  const outboxAdd    = item => _put('outbox', item);   // { ref, op:'save'|'valider', type, payload, ts }
  const outboxAll    = ()   => _all('outbox');
  const outboxRemove = ref  => _del('outbox', ref);

  return {
    nextNumero,
    saveCampagne, getCampagne, getAllCampagnes, deleteCampagne,
    getProjet, getAllProjets, cacheProjets,
    getEntreprise, getAllEntreprises, cacheEntreprises,
    savePhoto, getPhoto, deletePhoto, getPhotosOf, deletePhotosOf,
    outboxAdd, outboxAll, outboxRemove,
  };
})();
