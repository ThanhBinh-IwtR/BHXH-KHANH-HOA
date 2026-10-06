// @vitest-environment node

import { createClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import { RepositoryUnavailableError } from '@/lib/db/legal-repository';
import { SupabaseLegalRepository } from '@/lib/db/supabase-legal-repository';

const CHUNK_ROW = {
  chunk_id: 'nd-158-2025:dieu-12:khoan-3:2025-demo-v1',
  document_id: 'nd-158-2025',
  document_number: '158/2025/NĐ-CP',
  document_title: 'Nghị định 158',
  context_header: '158/2025/NĐ-CP > Điều 12 > Khoản 3',
  body_text: 'Người sử dụng lao động đóng 17%.',
  search_text: '158/2025/NĐ-CP > Điều 12 > Khoản 3\nNgười sử dụng lao động đóng 17%.',
  search_text_unaccented: 'nguoi su dung lao dong dong 17%.',
  chapter_number: 'II',
  section_number: null,
  article_number: '12',
  article_title: 'Mức đóng',
  clause_number: '3',
  point_from: null,
  point_to: null,
  page_from: 8,
  page_to: 8,
  parent_id: null,
  previous_sibling_id: null,
  next_sibling_id: null,
  cross_reference_ids: ['nd-158-2025:dieu-12:khoan-1:2025-demo-v1'],
  token_count: 6,
  corpus_version: '2025-demo-v1',
  chunk_type: 'normative',
};

type FetchHandler = (url: URL, init?: RequestInit) => Promise<Response>;

function repositoryWith(handler: FetchHandler, options: { queryTimeoutMs?: number } = {}) {
  const fetchImpl = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    handler(new URL(String(input instanceof Request ? input.url : input)), init),
  );
  const client = createClient('https://example.supabase.co', 'service-key', {
    auth: { persistSession: false },
    global: { fetch: fetchImpl as unknown as typeof fetch },
  });
  const repository = new SupabaseLegalRepository({
    url: 'https://example.supabase.co',
    serviceKey: 'service-key',
    corpusVersion: '2025-demo-v1',
    client,
    ...options,
  });
  return { repository, fetchImpl };
}

function json(body: unknown): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

function hangUntilAborted(_url: URL, init?: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) => {
    init?.signal?.addEventListener(
      'abort',
      () => reject(init.signal?.reason ?? new DOMException('Aborted', 'AbortError')),
      { once: true },
    );
  });
}

describe('SupabaseLegalRepository (PostgREST contract)', () => {
  it('reads sources from the joined view without the embedding column', async () => {
    let requested: URL | undefined;
    const { repository } = repositoryWith((url) => {
      requested = url;
      return json([CHUNK_ROW]);
    });

    const related = await repository.getRelated([CHUNK_ROW.chunk_id]);

    expect(related[0]).toMatchObject({
      documentNumber: '158/2025/NĐ-CP',
      documentTitle: 'Nghị định 158',
      crossReferenceIds: ['nd-158-2025:dieu-12:khoan-1:2025-demo-v1'],
    });
    expect(requested?.pathname).toBe('/rest/v1/legal_chunk_rows');
    const select = requested?.searchParams.get('select') ?? '';
    expect(select).toContain('document_number');
    expect(select).not.toContain('embedding');
    expect(select).not.toBe('*');
  });

  it('stops an in-flight PostgREST call when the request is cancelled', async () => {
    let sawAbort = false;
    const { repository } = repositoryWith((url, init) => {
      init?.signal?.addEventListener('abort', () => (sawAbort = true), { once: true });
      return hangUntilAborted(url, init);
    });
    const controller = new AbortController();
    const started = Date.now();

    const call = repository.hybridSearch(
      {
        queryText: 'mức đóng',
        queryUnaccented: 'muc dong',
        queryVector: null,
        matchCount: 5,
        corpusVersion: '2025-demo-v1',
      },
      { signal: controller.signal },
    );
    setTimeout(() => controller.abort(), 20);

    await expect(call).rejects.toBeInstanceOf(RepositoryUnavailableError);
    expect(sawAbort).toBe(true);
    expect(Date.now() - started).toBeLessThan(500);
  });

  it('bounds a hung query even when the caller passes no signal', async () => {
    const { repository } = repositoryWith(hangUntilAborted, { queryTimeoutMs: 50 });
    const started = Date.now();

    await expect(
      repository.exactSearch({ documentNumber: '158/2025/NĐ-CP', article: '12' }),
    ).rejects.toThrow(/cancelled or timed out/);
    expect(Date.now() - started).toBeLessThan(500);
  });

  it('serves the active documents from a short-lived cache', async () => {
    const { repository, fetchImpl } = repositoryWith((url) => {
      expect(url.pathname).toBe('/rest/v1/legal_documents');
      expect(url.searchParams.get('status')).toBe('eq.active');
      return json([
        {
          document_id: 'nd-158-2025',
          document_number: '158/2025/NĐ-CP',
          document_type: 'Nghị định',
          title: 'Nghị định 158',
          issued_date: '2025-06-25',
          effective_date: '2025-07-01',
          corpus_version: '2025-demo-v1',
          pdf_url: '/corpus/158_2025_ND-CP_25062025-signed.pdf',
        },
      ]);
    });

    await repository.getDocuments();
    const documents = await repository.getDocuments();

    expect(documents).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
