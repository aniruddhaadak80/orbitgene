import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { computeSeal, GENESIS, replay, sealNext } from '@/lib/integrity';
import { canonicalJson } from '@/lib/canonical';
import type { AuditEvent } from '@/lib/types';

function event(seq: number, detail: Record<string, unknown> = {}): Omit<AuditEvent, 'seal' | 'prevSeal'> {
  return {
    seq,
    entityId: 'entity-1',
    action: seq === 1 ? 'created' : 'updated',
    at: `2026-01-0${seq}T00:00:00.000Z`,
    actor: 'session',
    detail,
  };
}

describe('seal chain', () => {
  test('uses the documented genesis value', () => {
    assert.equal(GENESIS, 'orbitgene/genesis/v1');
  });

  test('matches an independently computed SHA-384 vector', () => {
    const e = event(1, { gene: 'BRCA1' });
    const expected = createHash('sha384')
      .update(GENESIS, 'utf8')
      .update(canonicalJson({
        seq: 1,
        entityId: 'entity-1',
        action: 'created',
        at: '2026-01-01T00:00:00.000Z',
        actor: 'session',
        detail: { gene: 'BRCA1' },
      }), 'utf8')
      .digest('hex');

    assert.equal(computeSeal(GENESIS, e), expected);
    assert.equal(expected.length, 96);
  });

  test('is insensitive to key order inside detail', () => {
    const a = event(1, { a: 1, b: 2 });
    const b = event(1, { b: 2, a: 1 });
    assert.equal(computeSeal(GENESIS, a), computeSeal(GENESIS, b));
  });

  test('is sensitive to any change in any field', () => {
    const base = computeSeal(GENESIS, event(1, { x: 1 }));
    assert.notEqual(base, computeSeal(GENESIS, event(1, { x: 2 })));
    assert.notEqual(base, computeSeal(GENESIS, { ...event(1, { x: 1 }), at: '2027-01-01T00:00:00.000Z' }));
    assert.notEqual(base, computeSeal(GENESIS, { ...event(1, { x: 1 }), actor: 'agent' }));
    assert.notEqual(base, computeSeal('other-genesis', event(1, { x: 1 })));
  });

  test('chains so the third seal depends on the first two', () => {
    const one = sealNext(GENESIS, event(1));
    const two = sealNext(one.seal, event(2));
    const twoAlt = sealNext(GENESIS, event(2));
    assert.notEqual(two.seal, twoAlt.seal);
    assert.equal(two.prevSeal, one.seal);
  });
});

describe('replay', () => {
  function chain(length: number): AuditEvent[] {
    const events: AuditEvent[] = [];
    let prev = GENESIS;
    for (let seq = 1; seq <= length; seq += 1) {
      const e = event(seq, { step: seq });
      const sealed = sealNext(prev, e);
      events.push({ ...e, prevSeal: sealed.prevSeal, seal: sealed.seal });
      prev = sealed.seal;
    }
    return events;
  }

  test('verifies an intact chain', () => {
    const report = replay('entity-1', chain(5));
    assert.equal(report.ok, true);
    assert.equal(report.length, 5);
    assert.equal(report.brokenAt, null);
    assert.equal(report.head, chain(5)[4].seal);
  });

  test('reports the first broken link, not the last', () => {
    const events = chain(4);
    events[1].detail = { step: 999 };
    const report = replay('entity-1', events);
    assert.equal(report.ok, false);
    assert.equal(report.brokenAt, 2);
    assert.match(report.brokenReason ?? '', /event 2 seal is/);
  });

  test('detects a rewritten prevSeal link', () => {
    const events = chain(4);
    events[2].prevSeal = GENESIS;
    const report = replay('entity-1', events);
    assert.equal(report.ok, false);
    assert.equal(report.brokenAt, 3);
    assert.match(report.brokenReason ?? '', /declares prevSeal/);
  });

  test('sorts events by sequence regardless of arrival order', () => {
    const events = chain(3).reverse();
    assert.equal(replay('entity-1', events).ok, true);
  });

  test('ignores events belonging to another entity', () => {
    const mine = chain(2);
    const theirs: AuditEvent = {
      seq: 1,
      entityId: 'entity-2',
      action: 'created',
      at: '2026-01-01T00:00:00.000Z',
      actor: 'session',
      detail: {},
      prevSeal: GENESIS,
      seal: 'deadbeef',
    };
    const report = replay('entity-1', [...mine, theirs]);
    assert.equal(report.ok, true);
    assert.equal(report.length, 2);
  });

  test('an empty chain is not a passing chain', () => {
    const report = replay('entity-1', []);
    assert.equal(report.ok, false);
    assert.equal(report.length, 0);
  });
});