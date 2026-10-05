/* HTML Review: durable local workspace sessions backed by IndexedDB. */
(function (global) {
  'use strict';

  const DATABASE_NAME = 'html-review-workspaces';
  const STORE_NAME = 'sessions';
  const DATABASE_VERSION = 1;
  let databasePromise = null;
  let database = null;
  const keyQueues = new Map();
  const observedEpochs = new Map();

  function unavailable() {
    const error = new Error('IndexedDB 不可用。请检查浏览器的本地存储权限后重试。');
    error.name = 'IndexedDBUnavailableError';
    return error;
  }

  function validKey(key) {
    if (typeof key !== 'string' || !key) throw new TypeError('会话键必须是非空字符串。');
    return key;
  }

  function validRecord(record) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      throw new TypeError('会话记录必须是对象。');
    }
    return record;
  }

  function recordEpoch(record) {
    return Number.isSafeInteger(record?.sessionEpoch) && record.sessionEpoch >= 0 ? record.sessionEpoch : 0;
  }

  function staleSessionError() {
    const error = new Error('本机恢复记录已在其他标签页被清除或更新，请先重新读取后再保存。');
    error.name = 'StaleSessionError';
    return error;
  }

  function openDatabase() {
    if (database) return Promise.resolve(database);
    if (databasePromise) return databasePromise;
    if (!global.indexedDB || typeof global.indexedDB.open !== 'function') return Promise.reject(unavailable());

    const opening = new Promise((resolve, reject) => {
      let request;
      try { request = global.indexedDB.open(DATABASE_NAME, DATABASE_VERSION); }
      catch (error) { reject(error); return; }
      request.onupgradeneeded = () => {
        const next = request.result;
        if (!next.objectStoreNames.contains(STORE_NAME)) next.createObjectStore(STORE_NAME, {keyPath: 'key'});
      };
      request.onerror = () => reject(request.error || unavailable());
      request.onblocked = () => reject(new Error('IndexedDB 数据库正在被其他标签页占用。'));
      request.onsuccess = () => {
        const next = request.result;
        next.onversionchange = () => {
          next.close();
          if (database === next) database = null;
        };
        database = next;
        resolve(next);
      };
    });
    databasePromise = opening;
    opening.then(
      () => { if (databasePromise === opening) databasePromise = null; },
      () => { if (databasePromise === opening) databasePromise = null; }
    );
    return opening;
  }

  function transaction(mode, work) {
    return openDatabase().then(db => new Promise((resolve, reject) => {
      let tx;
      try { tx = db.transaction(STORE_NAME, mode); }
      catch (error) { reject(error); return; }
      let result;
      let failure = null;
      const abort = error => {
        failure = error;
        try { tx.abort(); } catch (_) {}
      };
      try { result = work(tx.objectStore(STORE_NAME), tx, abort); }
      catch (error) { abort(error); reject(error); return; }
      // Some request handlers deliberately abort the transaction. Observe their
      // promise so that transaction.onabort remains the single public rejection.
      if (result && typeof result.catch === 'function') result.catch(() => undefined);
      tx.oncomplete = () => failure ? reject(failure) : resolve(result);
      tx.onerror = () => reject(failure || tx.error || new Error('IndexedDB 事务失败。'));
      tx.onabort = () => reject(failure || tx.error || new Error('IndexedDB 事务已取消。'));
    }));
  }

  function queue(key, operation) {
    const previous = keyQueues.get(key) || Promise.resolve();
    const next = previous.catch(() => undefined).then(operation);
    keyQueues.set(key, next);
    next.then(
      () => { if (keyQueues.get(key) === next) keyQueues.delete(key); },
      () => { if (keyQueues.get(key) === next) keyQueues.delete(key); }
    );
    return next;
  }

  function save(key, record) {
    try {
      key = validKey(key);
      record = validRecord(record);
    } catch (error) { return Promise.reject(error); }
    // Capture before this operation enters its per-window queue. A delayed save
    // must not inherit an epoch learned by a later load in the same window.
    const expectedEpoch = observedEpochs.get(key) || 0;
    return queue(key, () => {
      const stored = Object.assign({}, record, {key, savedAt: new Date().toISOString(), sessionEpoch: expectedEpoch, deleted: false});
      return transaction('readwrite', (store, _tx, abort) => new Promise(resolve => {
        const get = store.get(key);
        get.onerror = () => abort(get.error || new Error('读取 IndexedDB 会话失败。'));
        get.onsuccess = () => {
          if (recordEpoch(get.result) !== expectedEpoch) { abort(staleSessionError()); return; }
          let put;
          try { put = store.put(stored); }
          catch (error) { abort(error); return; }
          put.onerror = () => abort(put.error || new Error('写入 IndexedDB 会话失败。'));
          put.onsuccess = () => resolve(stored);
        };
      })).then(saved => {
        observedEpochs.set(key, saved.sessionEpoch);
        return saved;
      });
    });
  }

  function load(key) {
    try { key = validKey(key); } catch (error) { return Promise.reject(error); }
    return queue(key, () => transaction('readonly', (store, _tx, abort) => {
      const request = store.get(key);
      return new Promise(resolve => {
        request.onsuccess = () => {
          const record = request.result || null;
          observedEpochs.set(key, recordEpoch(record));
          resolve(record?.deleted ? null : record);
        };
        request.onerror = () => abort(request.error || new Error('读取 IndexedDB 会话失败。'));
      });
    }).then(result => result));
  }

  function remove(key) {
    try { key = validKey(key); } catch (error) { return Promise.reject(error); }
    return queue(key, () => transaction('readwrite', (store, _tx, abort) => new Promise(resolve => {
      const get = store.get(key);
      get.onerror = () => abort(get.error || new Error('读取 IndexedDB 会话失败。'));
      get.onsuccess = () => {
        const tombstone = {key, sessionEpoch: recordEpoch(get.result) + 1, deleted: true, savedAt: new Date().toISOString()};
        let put;
        try { put = store.put(tombstone); }
        catch (error) { abort(error); return; }
        put.onerror = () => abort(put.error || new Error('清除 IndexedDB 会话失败。'));
        put.onsuccess = () => resolve(tombstone);
      };
    })).then(tombstone => {
      observedEpochs.set(key, tombstone.sessionEpoch);
      return undefined;
    }));
  }

  async function close() {
    const pending = Array.from(keyQueues.values());
    await Promise.allSettled(pending);
    const active = database;
    database = null;
    databasePromise = null;
    if (active) active.close();
  }

  global.HRSession = Object.freeze({save, load, remove, close});
})(window);
