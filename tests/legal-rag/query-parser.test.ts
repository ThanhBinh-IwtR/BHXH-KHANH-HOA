import { describe, expect, it } from 'vitest';

import { parseLegalReference } from '@/features/legal-rag/query-parser';

describe('parseLegalReference', () => {
  it('parses full Vietnamese legal coordinates', () => {
    expect(parseLegalReference('khoản 3 Điều 12 Nghị định 158/2025/NĐ-CP')).toEqual({
      documentNumber: '158/2025/NĐ-CP',
      article: '12',
      clause: '3',
      point: null,
    });
  });

  it('parses a point reference', () => {
    expect(parseLegalReference('điểm a khoản 1 Điều 5 Nghị định 159/2025/NĐ-CP')).toEqual({
      documentNumber: '159/2025/NĐ-CP',
      article: '5',
      clause: '1',
      point: 'a',
    });
  });

  it('normalises spacing and hyphenation in the decree number', () => {
    const ref = parseLegalReference('Điều 7 của Nghị định 188 / 2025 / ND-CP');
    expect(ref?.documentNumber).toBe('188/2025/NĐ-CP');
    expect(ref?.article).toBe('7');
  });

  it('returns null for natural-language questions without a citation', () => {
    expect(parseLegalReference('Mức đóng bảo hiểm xã hội bắt buộc là bao nhiêu?')).toBeNull();
  });

  it('returns null when only a document number is present without an article', () => {
    expect(parseLegalReference('Nghị định 158/2025/NĐ-CP quy định gì?')).toBeNull();
  });
});
