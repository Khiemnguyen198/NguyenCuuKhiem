import assert from 'node:assert/strict';
import test from 'node:test';
import { brandOf, logoUrl } from '../src/customer-brands.js';

test('recognises the spellings used in the booking, receiving and warehouse files', () => {
  const cases = {
    DEC: 'Decathlon', 'DEC-THÊU': 'Decathlon', 'Decathlon WTI': 'Decathlon', 'DECATHON QT': 'Decathlon', 'Decathlon THÊU': 'Decathlon',
    'ARENA SS27 OW03': 'Arena', LECOQ: 'Le Coq Sportif', DECENTE: 'Descente', DESCENTE: 'Descente',
    SPORTMASTE: 'Sportmaster', 'SPORRT MASTER': 'Sportmaster', 'Sport master': 'Sportmaster', HADDAD: 'Haddad', COOLMATE: 'Coolmate', LACOSTE: 'Lacoste',
    MANMADE: 'Manmade', MANMADEN: 'Manmade', NINUNAPZ: 'Ninunapz', CORELE: 'Corèle V.', POND: 'Pond'
  };
  for (const [name, brand] of Object.entries(cases)) assert.equal(brandOf(name)?.name, brand, name);
});

test('leaves unconfirmed customers without a logo', () => {
  for (const name of ['PHÚ HÒA AN 2', 'BIÊN HÒA', 'DBI', 'PERY', 'PONDS', '']) assert.equal(brandOf(name), null, name);
});

test('builds the favicon address from the brand domain only', () => {
  assert.equal(logoUrl(brandOf('DEC')), 'https://www.google.com/s2/favicons?domain=decathlon.com&sz=64');
});
