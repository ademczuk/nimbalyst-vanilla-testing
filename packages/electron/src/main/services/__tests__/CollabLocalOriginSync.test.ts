// @vitest-environment node

import { describe, expect, it } from 'vitest';

import {
  classifyPullState,
  hashCollabFileContent,
} from '../CollabLocalOriginSync';

describe('CollabLocalOriginSync', () => {
  describe('hashCollabFileContent', () => {
    it('hashes the exact bytes for text and binary content', () => {
      expect(hashCollabFileContent('hello')).toBe(
        hashCollabFileContent(new TextEncoder().encode('hello')),
      );
      expect(hashCollabFileContent(new Uint8Array([0xff, 0x00]))).not.toBe(
        hashCollabFileContent('\ufffd\u0000'),
      );
    });
  });

  describe('classifyPullState', () => {
    const baseline = {
      baselineLocalHash: 'local-baseline',
      baselineSharedHash: 'shared-baseline',
      candidateLocalHash: 'candidate-local',
    };

    it('repairs stale baselines when disk already equals the derived shared representation', () => {
      expect(classifyPullState({
        ...baseline,
        currentLocalHash: 'candidate-local',
        currentSharedHash: 'new-shared',
      })).toEqual({ status: 'noop', repairBaselines: true });
    });

    it('returns noop when neither side changed', () => {
      expect(classifyPullState({
        ...baseline,
        currentLocalHash: 'local-baseline',
        currentSharedHash: 'shared-baseline',
      })).toEqual({ status: 'noop', repairBaselines: false });
    });

    it('fast-forwards when only the shared side changed', () => {
      expect(classifyPullState({
        ...baseline,
        currentLocalHash: 'local-baseline',
        currentSharedHash: 'new-shared',
      })).toEqual({ status: 'safe-pull' });
    });

    it('protects local-only changes', () => {
      expect(classifyPullState({
        ...baseline,
        currentLocalHash: 'new-local',
        currentSharedHash: 'shared-baseline',
      })).toEqual({ status: 'conflict', conflictKind: 'local-ahead' });
    });

    it('protects diverged changes', () => {
      expect(classifyPullState({
        ...baseline,
        currentLocalHash: 'new-local',
        currentSharedHash: 'new-shared',
      })).toEqual({ status: 'conflict', conflictKind: 'diverged' });
    });

    it('requires confirmation when either baseline is missing', () => {
      expect(classifyPullState({
        ...baseline,
        baselineLocalHash: null,
        currentLocalHash: 'local',
        currentSharedHash: 'shared',
      })).toEqual({ status: 'conflict', conflictKind: 'missing-baseline' });
      expect(classifyPullState({
        ...baseline,
        baselineSharedHash: null,
        currentLocalHash: 'local',
        currentSharedHash: 'shared',
      })).toEqual({ status: 'conflict', conflictKind: 'missing-baseline' });
    });
  });
});
