/**
 * VCStorage — local VC storage: primary download + auxiliary IndexedDB cache.
 *
 * Exposes: window.VCStorage
 *
 * Стратегия хранения:
 *   Основное  → downloadVC()      — сохранение файла через диалог браузера.
 *   Кэш       → saveToIndexedDB() — вспомогательный кэш для UX.
 *   Запрещено → localStorage      — не используется для данных VC.
 *
 * Нет зависимостей кроме стандартных браузерных API.
 *
 * Использование (выпуск):
 *
 *   VCStorage.downloadVC(vc);               // сохранить файл VC студенту
 *   await VCStorage.saveToIndexedDB(vc);    // кэшировать в браузере
 *
 * Использование (верификация):
 *
 *   const vc = await VCStorage.parseVCFile(vcJsonFile); // разобрать загруженный .json
 */
(function (global) {
    'use strict';

    var DB_NAME    = 'DocumentChainVC';
    var STORE_NAME = 'credentials';
    var DB_VERSION = 1;

    // ── IndexedDB internals ───────────────────────────────────────────────────

    function openDB() {
        return new Promise(function (resolve, reject) {
            var req = indexedDB.open(DB_NAME, DB_VERSION);

            req.onupgradeneeded = function (e) {
                var db = e.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    // keyPath = vc.id  (= credentialId bytes32 hex)
                    db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                }
            };

            req.onsuccess = function (e) { resolve(e.target.result); };
            req.onerror   = function (e) { reject(e.target.error); };
        });
    }

    // ── Primary storage: download as file ────────────────────────────────────

    /**
     * Trigger a browser download of the VC as a JSON-LD file.
     * This is the PRIMARY storage mechanism — the student keeps this file.
     *
     * The file is saved with MIME type application/ld+json and a filename
     * derived from the VC id (credentialId) so it is recognizable later.
     *
     * @param {object}  vc          The signed VC object
     * @param {string}  [filename]  Optional override; defaults to credential-<id_prefix>.json
     */
    function downloadVC(vc, filename) {
        var json = JSON.stringify(vc, null, 2);
        var blob = new Blob([json], { type: 'application/ld+json' });
        var url  = URL.createObjectURL(blob);

        var a = document.createElement('a');
        a.href     = url;
        a.download = filename || ('credential-' + String(vc.id || 'vc').slice(0, 18) + '.json');

        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        // Revoke the object URL after a short delay so the download starts.
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    }

    // ── Auxiliary storage: IndexedDB cache ───────────────────────────────────

    /**
     * Save a VC to IndexedDB (auxiliary UX cache).
     * If a VC with the same id already exists it is overwritten.
     *
     * @param {object}  vc
     * @returns {Promise<void>}
     */
    async function saveToIndexedDB(vc) {
        var db = await openDB();
        return new Promise(function (resolve, reject) {
            var tx = db.transaction(STORE_NAME, 'readwrite');
            tx.objectStore(STORE_NAME).put(vc);
            tx.oncomplete = function () { resolve(); };
            tx.onerror    = function (e) { reject(e.target.error); };
        });
    }

    /**
     * Load a VC from IndexedDB by credentialId.
     *
     * @param {string}  credentialId   0x-prefixed bytes32
     * @returns {Promise<object|null>} The VC object, or null if not found.
     */
    async function loadFromIndexedDB(credentialId) {
        var db = await openDB();
        return new Promise(function (resolve, reject) {
            var tx  = db.transaction(STORE_NAME, 'readonly');
            var req = tx.objectStore(STORE_NAME).get(credentialId);
            req.onsuccess = function (e) { resolve(e.target.result || null); };
            req.onerror   = function (e) { reject(e.target.error); };
        });
    }

    /**
     * Load all cached VCs from IndexedDB.
     *
     * @returns {Promise<object[]>}
     */
    async function loadAllFromIndexedDB() {
        var db = await openDB();
        return new Promise(function (resolve, reject) {
            var tx  = db.transaction(STORE_NAME, 'readonly');
            var req = tx.objectStore(STORE_NAME).getAll();
            req.onsuccess = function (e) { resolve(e.target.result || []); };
            req.onerror   = function (e) { reject(e.target.error); };
        });
    }

    /**
     * Delete a VC from the IndexedDB cache.
     *
     * @param {string}  credentialId
     * @returns {Promise<void>}
     */
    async function deleteFromIndexedDB(credentialId) {
        var db = await openDB();
        return new Promise(function (resolve, reject) {
            var tx = db.transaction(STORE_NAME, 'readwrite');
            tx.objectStore(STORE_NAME).delete(credentialId);
            tx.oncomplete = function () { resolve(); };
            tx.onerror    = function (e) { reject(e.target.error); };
        });
    }

    // ── Import from uploaded file ─────────────────────────────────────────────

    /**
     * Parse a VC from a user-uploaded JSON or JSON-LD file.
     *
     * Performs a minimal structural check (id, proof, credentialSubject must
     * be present) and throws a descriptive error on invalid input.
     *
     * @param {File}  file   The .json file selected by the user
     * @returns {Promise<object>}  Parsed VC object
     */
    function parseVCFile(file) {
        return new Promise(function (resolve, reject) {
            var reader = new FileReader();

            reader.onload = function (e) {
                try {
                    var vc = JSON.parse(e.target.result);

                    if (!vc || typeof vc !== 'object') {
                        reject(new Error('Файл не является JSON-объектом'));
                        return;
                    }
                    if (!vc.id) {
                        reject(new Error('Отсутствует поле "id" (credentialId)'));
                        return;
                    }
                    if (!vc.proof || !vc.proof.proofValue) {
                        reject(new Error('Отсутствует поле "proof.proofValue"'));
                        return;
                    }
                    if (!vc.credentialSubject) {
                        reject(new Error('Отсутствует поле "credentialSubject"'));
                        return;
                    }

                    resolve(vc);
                } catch (parseErr) {
                    reject(new Error('Ошибка парсинга JSON: ' + parseErr.message));
                }
            };

            reader.onerror = function () {
                reject(new Error('Не удалось прочитать файл'));
            };

            reader.readAsText(file);
        });
    }

    // ── Export ────────────────────────────────────────────────────────────────

    global.VCStorage = {
        downloadVC,
        saveToIndexedDB,
        loadFromIndexedDB,
        loadAllFromIndexedDB,
        deleteFromIndexedDB,
        parseVCFile,
    };

})(window);
