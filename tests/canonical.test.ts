import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalJson, sha256, shortDigest } from '@/lib/canonical';

describe('canonicalJson', () => {
  test('sorts object keys recursively', () => {
    assert.equal(canonicalJson({ b: 1, a: 2 }), '{"a":2,"b":1}');
    assert.equal(
      canonicalJson({ z: { d: 1, c: { b: 1, a: 0 } }, a: 1 }),
      '{"a":1,"z":{"c":{"a":0,"b":1},"d":1}}',
    );
  });

  test('preserves array order, because order is meaningful', () => {
    assert.equal(canonicalJson([3, 1, 2]), '[3,1,2]');
    assert.notEqual(canonicalJson({ a: [1, 2] }), canonicalJson({ a: [2, 1] }));
  });

  test('drops undefined members and renders them as null inside arrays', () => {
    assert.equal(canonicalJson({ a: undefined, b: 1 }), '{"b":1}');
    assert.equal(canonicalJson([1, undefined, 2]), '[1,null,2]');
  });

  test('is insensitive to key insertion order', () => {
    const one: Record<string, unknown> = {};
    one.alpha = 1;
    one.beta = 2;
    const two: Record<string, unknown> = {};
    two.beta = 2;
    two.alpha = 1;
    assert.equal(canonicalJson(one), canonicalJson(two));
  });

  test('renders non-finite numbers as null rather than throwing', () => {
    assert.equal(canonicalJson({ a: Number.NaN, b: Infinity }), '{"a":null,"b":null}');
  });

  test('serialises dates as ISO-8601', () => {
    const date = new Date('2026-01-02T03:04:05.000Z');
    assert.equal(canonicalJson({ at: date }), '{"at":"2026-01-02T03:04:05.000Z"}');
  });

  test('handles primitives and null', () => {
    assert.equal(canonicalJson(null), 'null');
    assert.equal(canonicalJson('x'), '"x"');
    assert.equal(canonicalJson(true), 'true');
    assert.equal(canonicalJson(42), '42');
  });
});

describe('sha256', () => {
  test('matches the published digest of the empty string', () => {
    assert.equal(
      sha256(''),
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  test('matches the published digest of "abc"', () => {
    assert.equal(
      sha256('abc'),
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  test('is stable across runs', () => {
    assert.equal(sha256('orbitgene'), sha256('orbitgene'));
  });
});

describe('shortDigest', () => {
  test('truncates to the requested length', () => {
    assert.equal(shortDigest('0123456789abcdef', 4), '0123');
    assert.equal(shortDigest('0123456789abcdef', 12), '0123456789ab');
  });
});