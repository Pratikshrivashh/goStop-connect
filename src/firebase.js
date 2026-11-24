const admin = require('firebase-admin');

let db = null;
let isMock = false;

// In-Memory Firestore Implementation for local testing without cloud credentials
class MockTimestamp {
  constructor(date = new Date()) {
    this._date = new Date(date);
  }

  toDate() {
    return new Date(this._date);
  }

  toMillis() {
    return this._date.getTime();
  }

  static now() {
    return new MockTimestamp();
  }

  static fromDate(date) {
    return new MockTimestamp(date);
  }
}

class MockFieldValue {
  constructor(type, value) {
    this.type = type;
    this.value = value;
  }

  static serverTimestamp() {
    return new MockFieldValue('SERVER_TIMESTAMP');
  }

  static arrayUnion(...elements) {
    return new MockFieldValue('ARRAY_UNION', elements);
  }

  static increment(n) {
    return new MockFieldValue('INCREMENT', n);
  }
}

class MockDocumentReference {
  constructor(collection, id) {
    this.collection = collection;
    this.id = id;
  }

  async get() {
    return this.collection._getDoc(this.id);
  }

  async set(data, options = {}) {
    return this.collection._setDoc(this.id, data, options);
  }

  async update(data) {
    return this.collection._updateDoc(this.id, data);
  }
}

class MockDocumentSnapshot {
  constructor(id, data, exists) {
    this.id = id;
    this._data = data;
    this.exists = exists;
  }

  data() {
    if (!this.exists) return undefined;
    // Return deep clone
    return JSON.parse(JSON.stringify(this._data), (key, value) => {
      if (value && typeof value === 'object' && value._isMockTimestamp) {
        return new MockTimestamp(value._date);
      }
      return value;
    });
  }
}

class MockQuery {
  constructor(collection, filters = [], limitCount = null) {
    this.collection = collection;
    this.filters = filters;
    this.limitCount = limitCount;
  }

  where(field, op, value) {
    return new MockQuery(
      this.collection,
      [...this.filters, { field, op, value }],
      this.limitCount
    );
  }

  limit(count) {
    return new MockQuery(this.collection, this.filters, count);
  }

  async get() {
    let docs = [];
    for (const [id, data] of this.collection.store.entries()) {
      let matches = true;
      for (const filter of this.filters) {
        const docVal = data[filter.field];
        let compareVal = docVal;
        let targetVal = filter.value;

        if (compareVal && typeof compareVal.toMillis === 'function') {
          compareVal = compareVal.toMillis();
        } else if (compareVal instanceof Date) {
          compareVal = compareVal.getTime();
        }

        if (targetVal && typeof targetVal.toMillis === 'function') {
          targetVal = targetVal.toMillis();
        } else if (targetVal instanceof Date) {
          targetVal = targetVal.getTime();
        }

        if (filter.op === '>=') {
          if (!(compareVal >= targetVal)) matches = false;
        } else if (filter.op === '==') {
          if (compareVal !== targetVal) matches = false;
        } else if (filter.op === '<=') {
          if (!(compareVal <= targetVal)) matches = false;
        }
      }
      if (matches) {
        docs.push(new MockDocumentSnapshot(id, data, true));
      }
    }

    if (this.limitCount !== null) {
      docs = docs.slice(0, this.limitCount);
    }

    return {
      docs,
      empty: docs.length === 0,
      size: docs.length
    };
  }
}

class MockCollectionReference {
  constructor(name) {
    this.name = name;
    this.store = new Map();
  }

  doc(id) {
    const docId = id || Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    return new MockDocumentReference(this, docId);
  }

  where(field, op, value) {
    return new MockQuery(this, [{ field, op, value }]);
  }

  limit(count) {
    return new MockQuery(this, [], count);
  }

  async get() {
    return new MockQuery(this).get();
  }

  _resolveValue(val, currentVal) {
    if (val instanceof MockFieldValue) {
      if (val.type === 'SERVER_TIMESTAMP') {
        const ts = MockTimestamp.now();
        ts._isMockTimestamp = true;
        return ts;
      }
      if (val.type === 'ARRAY_UNION') {
        const arr = Array.isArray(currentVal) ? [...currentVal] : [];
        for (const item of val.value) {
          if (!arr.includes(item)) arr.push(item);
        }
        return arr;
      }
      if (val.type === 'INCREMENT') {
        const num = typeof currentVal === 'number' ? currentVal : 0;
        return num + val.value;
      }
    }
    if (val instanceof Date) {
      const ts = MockTimestamp.fromDate(val);
      ts._isMockTimestamp = true;
      return ts;
    }
    return val;
  }

  _getDoc(id) {
    const exists = this.store.has(id);
    const data = exists ? this.store.get(id) : undefined;
    return new MockDocumentSnapshot(id, data, exists);
  }

  _setDoc(id, data, options = {}) {
    let current = options.merge && this.store.has(id) ? { ...this.store.get(id) } : {};
    for (const [key, val] of Object.entries(data)) {
      current[key] = this._resolveValue(val, current[key]);
    }
    this.store.set(id, current);
    return { writeTime: new MockTimestamp() };
  }

  _updateDoc(id, data) {
    if (!this.store.has(id)) {
      throw new Error(`NOT_FOUND: No document to update: ${this.name}/${id}`);
    }
    let current = { ...this.store.get(id) };
    for (const [key, val] of Object.entries(data)) {
      current[key] = this._resolveValue(val, current[key]);
    }
    this.store.set(id, current);
    return { writeTime: new MockTimestamp() };
  }
}

class MockFirestore {
  constructor() {
    this.collections = new Map();
  }

  collection(name) {
    if (!this.collections.has(name)) {
      this.collections.set(name, new MockCollectionReference(name));
    }
    return this.collections.get(name);
  }

  async runTransaction(updateFunction) {
    const transaction = {
      get: async (ref) => ref.get(),
      set: (ref, data, options) => ref.set(data, options),
      update: (ref, data) => ref.update(data),
      delete: (ref) => ref.collection.store.delete(ref.id)
    };
    return updateFunction(transaction);
  }

  clear() {
    this.collections.clear();
  }
}

function initializeFirebase() {
  if (db) return { db, admin, isMock };

  const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT;
  const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;

  if (serviceAccountKey || emulatorHost) {
    try {
      if (admin.apps.length === 0) {
        if (serviceAccountKey) {
          const serviceAccount = JSON.parse(serviceAccountKey);
          admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            projectId: serviceAccount.project_id || 'gostops-connect'
          });
        } else {
          admin.initializeApp({
            projectId: 'gostops-connect'
          });
        }
      }
      db = admin.firestore();
      isMock = false;
      return { db, admin, isMock };
    } catch (err) {
      console.warn('Failed to initialize live Firebase Admin SDK, falling back to MockFirestore:', err.message);
    }
  }

  // Fallback to MockFirestore
  db = new MockFirestore();
  isMock = true;
  return { db, admin, isMock };
}

function getDb() {
  if (!db) {
    initializeFirebase();
  }
  return db;
}

function getFieldValue() {
  if (isMock) {
    return MockFieldValue;
  }
  return admin.firestore.FieldValue;
}

function getTimestamp() {
  if (isMock) {
    return MockTimestamp;
  }
  return admin.firestore.Timestamp;
}

function resetMockDb() {
  if (db && isMock) {
    db.clear();
  }
}

module.exports = {
  initializeFirebase,
  getDb,
  getFieldValue,
  getTimestamp,
  resetMockDb,
  isMock: () => isMock
};
