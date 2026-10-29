import assert from 'node:assert/strict';
import test from 'node:test';
import { readJson, writeJsonEntries } from '../src/storage.js';

function withStorage(storage, run) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  try { run(); } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete globalThis.localStorage;
  }
}

function quotaStorage(initial, limit) {
  const values = new Map(Object.entries(initial));
  const writes = [];
  return {
    values, writes,
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => values.delete(key),
    setItem(key, value) {
      writes.push(key);
      const next = new Map(values).set(key, String(value));
      if ([...next.values()].reduce((sum, raw) => sum + raw.length, 0) > limit) {
        throw new DOMException('Storage quota exceeded', 'QuotaExceededError');
      }
      values.set(key, String(value));
    }
  };
}

test('related booking rows and history are saved together', () => {
  const storage = quotaStorage({}, 10_000);
  withStorage(storage, () => {
    const rows = { importId: 2, rows: [{ po: 'NEW', quantity: 10 }] };
    const history = [{ id: 2, filename: 'booking.xlsx' }];
    assert.equal(writeJsonEntries([['planner-booking-rows', rows], ['planner-file-history', history]]), true);
    assert.deepEqual(readJson('planner-booking-rows', null), rows);
    assert.deepEqual(readJson('planner-file-history', null), history);
  });
});

test('quota failure on the second write restores the previous booking and history', () => {
  const previous = {
    'planner-booking-rows': JSON.stringify({ importId: 1, rows: [{ po: 'OLD' }] }),
    'planner-file-history': JSON.stringify([{ id: 1, filename: 'old.xlsx' }]),
    unrelated: 'keep-me'
  };
  const originalSize = Object.values(previous).reduce((sum, value) => sum + value.length, 0);
  const storage = quotaStorage(previous, originalSize + 40);
  withStorage(storage, () => {
    assert.equal(writeJsonEntries([
      ['planner-booking-rows', { importId: 2, rows: [{ po: 'NEW-BOOKING-WITH-MORE-DATA' }] }],
      ['planner-file-history', [{ id: 1, filename: 'old.xlsx' }, { id: 2, filename: 'new-booking-with-more-history.xlsx' }]]
    ]), false);
    assert.deepEqual(storage.writes.slice(0, 2), ['planner-booking-rows', 'planner-file-history']);
    assert.deepEqual(Object.fromEntries(storage.values), previous);
    assert.equal(readJson('planner-booking-rows', null).importId, 1);
    assert.equal(readJson('planner-file-history', null)[0].filename, 'old.xlsx');
  });
});

test('rollback removes newly created keys when later writes fail', () => {
  const storage = quotaStorage({ history: '[1]' }, 8);
  withStorage(storage, () => {
    assert.equal(writeJsonEntries([['rows', [2]], ['history', ['too long']]]), false);
    assert.equal(storage.getItem('rows'), null);
    assert.equal(storage.getItem('history'), '[1]');
  });
});

test('a key whose writes stay blocked is never removed during rollback', () => {
  const storage = quotaStorage({ rows: '[1]', history: '[1]' }, 100);
  const write = storage.setItem.bind(storage);
  const removed = [];
  const remove = storage.removeItem.bind(storage);
  storage.setItem = (key, raw) => {
    if (key === 'history') throw new DOMException('History writes blocked', 'QuotaExceededError');
    write(key, raw);
  };
  storage.removeItem = (key) => { removed.push(key); remove(key); };
  withStorage(storage, () => {
    assert.equal(writeJsonEntries([['rows', [2]], ['history', [2]]]), false);
    assert.equal(storage.getItem('rows'), '[1]');
    assert.equal(storage.getItem('history'), '[1]');
    assert.deepEqual(removed, ['rows']);
  });
});

test('all values are serialized before touching storage', () => {
  const storage = quotaStorage({ rows: '[1]', history: '[1]' }, 100);
  const circular = {};
  circular.self = circular;
  withStorage(storage, () => {
    assert.equal(writeJsonEntries([['rows', [2]], ['history', circular]]), false);
    assert.equal(writeJsonEntries([['rows', [2]], ['history', undefined]]), false);
    assert.deepEqual(storage.writes, []);
    assert.equal(storage.getItem('rows'), '[1]');
    assert.equal(storage.getItem('history'), '[1]');
  });
});

test('unavailable storage returns false without throwing', () => {
  withStorage(undefined, () => assert.equal(writeJsonEntries([['rows', []]]), false));
  withStorage({ getItem() { throw new Error('Blocked'); } }, () => assert.equal(writeJsonEntries([['rows', []]]), false));
});
