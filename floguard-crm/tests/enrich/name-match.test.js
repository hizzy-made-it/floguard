import test from 'node:test';
import assert from 'node:assert/strict';
import { matchOwnerName } from '../../server/lib/contact-enrich.js';

const smith = [{ name: 'John A Smith', firstname: 'John', lastname: 'Smith' }];

test('tax-roll "LAST FIRST MIDDLE" matches "First Last"', () => {
  assert.equal(matchOwnerName('SMITH JOHN A', smith).result, 'match');
});
test('comma form and natural order match too', () => {
  assert.equal(matchOwnerName('SMITH, JOHN', smith).result, 'match');
  assert.equal(matchOwnerName('John Smith', smith).result, 'match');
  assert.equal(matchOwnerName('JOHN SMITH', smith).result, 'match');
});
test('joint owners: either spouse matches', () => {
  const mary = [{ name: 'Mary B Smith', firstname: 'Mary', lastname: 'Smith' }];
  assert.equal(matchOwnerName('SMITH JOHN A & MARY B', mary).result, 'match');
});
test('middle initial is not mistaken for a first name', () => {
  const alice = [{ name: 'Alice Smith', firstname: 'Alice', lastname: 'Smith' }];
  assert.equal(matchOwnerName('SMITH JOHN A', alice).result, 'partial');
});
test('different surname is a mismatch', () => {
  const jones = [{ name: 'Maria Jones', firstname: 'Maria', lastname: 'Jones' }];
  assert.equal(matchOwnerName('SMITH JOHN A', jones).result, 'mismatch');
});
test('trust reduces to the person name', () => {
  assert.equal(matchOwnerName('SMITH JOHN A REV LIVING TRUST', smith).result, 'match');
  assert.equal(matchOwnerName('SMITH FAMILY TRUST', smith).result, 'partial');
});
test('LLC is never mismatched against a person', () => {
  assert.equal(matchOwnerName('PALM HOLDINGS LLC', smith).result, 'unknown');
});
test('no candidates or no name is unknown, not a mismatch', () => {
  assert.equal(matchOwnerName('SMITH JOHN', []).result, 'unknown');
  assert.equal(matchOwnerName('', smith).result, 'unknown');
});
