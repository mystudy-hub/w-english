// @vitest-environment node
import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { contentFingerprint, verifyContentApprovals } from '../scripts/lib/content-audit.mjs';

it('invalidates approval when semantic content or image bytes change, not just on a status flag', () => {
  const word = JSON.parse(readFileSync('data/stage0_words.json', 'utf8'))[0];
  const assets = { [word.illustration.src]: { sha256: 'a'.repeat(64) } };
  const approvals = { words: { [word.wordId]: {
    reviewer: 'Test fixture, not a real teacher approval', reviewedAt: '2026-09-10T00:00:00Z',
    contentSha256: contentFingerprint(word), imageSha256: 'a'.repeat(64),
  } } };
  expect(() => verifyContentApprovals([word], assets, approvals)).not.toThrow();
  const edited = structuredClone(word); edited.definition.zh = 'Different meaning';
  expect(() => verifyContentApprovals([edited], assets, approvals)).toThrow('审批失效');
  expect(() => verifyContentApprovals([word], { [word.illustration.src]: { sha256: 'b'.repeat(64) } }, approvals)).toThrow('审批失效');
  expect(contentFingerprint({ ...word, contentVersion: '2026.10.1' })).toBe(contentFingerprint(word));
});
