import type { WordEntry } from '../../src/data/content-schema.ts';

export interface WordApproval { reviewer: string; reviewedAt: string; contentSha256: string; imageSha256: string }
export interface ClipApproval { ref: string; reviewer: string; reviewedAt: string; spriteSha256: string; sourceSha256: string; promptSha256: string;
  clip: [number, number]; creator: string; license: string; permissionEvidence: string; calibrationApproved: boolean }
export interface ReviewData {
  schemaVersion: 1; stage: 0 | 1 | 2; contentVersion: string; datasetSha256: string; wordSource: string;
  words: Array<{ entry: WordEntry; contentSha256: string; imageSha256: string; image: string;
    imageLicense: { source: string; creator: string; license: string; permissionEvidence: string } }>;
  clips: Array<{ ref: string; kind: string; text?: string; phonemes?: string[]; input?: string; derivedFrom?: string;
    available: boolean; spriteId: string; interval?: [number, number]; spriteSha256?: string; sourceSha256?: string; promptSha256: string;
    calibrationRequired: boolean; wordIds: string[] }>;
  audio: Record<string, string>; assets: Record<string, { sha256: string }>; production: unknown;
  existing: { words: Record<string, WordApproval>; clips: Record<string, ClipApproval> };
  approved: { words: Record<string, WordApproval>; clips: Record<string, ClipApproval> };
}
export function loadReviewData(): Promise<ReviewData>;
export function reviewIdentity(data: ReviewData): string;
export function prepareReviewImport(data: ReviewData, input: unknown): {
  contentApprovals: { schemaVersion: 1; words: Record<string, WordApproval> };
  audioApprovals: { schemaVersion: 1; clips: Record<string, ClipApproval> }; words: WordEntry[];
  summary: { importedWords: number; importedClips: number; textApproved: number; audioApproved: number };
  notes: Record<string, string>; rejections: Record<string, { reviewer: string; reviewedAt: string; note: string }>;
};
