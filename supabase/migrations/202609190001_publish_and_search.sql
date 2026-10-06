-- 2026-09-19: corpus publish/activation and index-friendly retrieval.
--
-- * legal_chunk_rows: chunk rows joined with their document number/title and
--   without the 1024-dimension embedding. `legal_chunks` alone lacks the
--   document number the application needs, so reading it directly failed.
-- * search_tsv: stored tsvector + GIN index, so full-text matching and term
--   counting never recompute to_tsvector() per row.
-- * keyword search: OR-query over the question's terms with at least two
--   matching terms (mirrors the memory repository) instead of an AND query
--   that almost never matches a natural-language question.
-- * hybrid search: keyword and vector branches read the base table directly,
--   so the full-text GIN index and the HNSW index can both be used.
-- * activate_legal_corpus: validates a staged upload and flips it to active,
--   deactivating everything else, in one transaction.

-- ---------------------------------------------------------------------------
-- Stored full-text vector
-- ---------------------------------------------------------------------------

alter table legal_chunks
  add column if not exists search_tsv tsvector
  generated always as (to_tsvector('simple', search_text_unaccented)) stored;

create index if not exists legal_chunks_search_tsv_idx
  on legal_chunks using gin (search_tsv);

-- Superseded by legal_chunks_search_tsv_idx; no function uses the expression any more.
drop index if exists legal_chunks_search_unaccented_fts_idx;

-- ---------------------------------------------------------------------------
-- Readable chunk rows
-- ---------------------------------------------------------------------------

create or replace view legal_chunk_rows
with (security_invoker = true) as
select
  c.chunk_id, c.document_id, d.document_number, d.title as document_title,
  c.context_header, c.body_text, c.search_text, c.search_text_unaccented,
  c.chapter_number, c.section_number, c.article_number, c.article_title,
  c.clause_number, c.point_from, c.point_to, c.page_from, c.page_to,
  c.parent_id, c.previous_sibling_id, c.next_sibling_id,
  c.cross_reference_ids, c.token_count, c.corpus_version, c.chunk_type, c.status
from legal_chunks c
join legal_documents d on d.document_id = c.document_id;

revoke all on legal_chunk_rows from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Exact-reference lookup (now returns the document number/title)
-- ---------------------------------------------------------------------------

drop function if exists exact_search_legal_chunks(text, text, text, text, text);

create function exact_search_legal_chunks(
  document_number text,
  article_number  text,
  clause_number   text default null,
  point_number    text default null,
  corpus_version  text default null
)
returns setof legal_chunk_rows
language sql
stable
as $$
  select v.*
  from legal_chunk_rows v
  where regexp_replace(lower(unaccent(v.document_number)), '[^a-z0-9]', '', 'g')
      = regexp_replace(lower(unaccent(exact_search_legal_chunks.document_number)), '[^a-z0-9]', '', 'g')
    and v.article_number = exact_search_legal_chunks.article_number
    and (exact_search_legal_chunks.clause_number is null
         or v.clause_number = exact_search_legal_chunks.clause_number)
    and (exact_search_legal_chunks.point_number is null
         or (v.point_from is not null
             and exact_search_legal_chunks.point_number between v.point_from and coalesce(v.point_to, v.point_from)))
    and v.chunk_type = 'normative'
    and v.status = 'active'
    and (exact_search_legal_chunks.corpus_version is null
         or v.corpus_version = exact_search_legal_chunks.corpus_version)
  order by v.article_number, v.clause_number nulls first, v.point_from nulls first, v.chunk_id;
$$;

-- ---------------------------------------------------------------------------
-- Keyword search: any query term, at least two distinct terms per chunk
-- ---------------------------------------------------------------------------

create or replace function keyword_search_legal_chunks(
  query_text       text,
  query_unaccented text,
  match_count      integer,
  corpus_version   text
)
returns table (
  chunk_id text, document_id text, document_number text, document_title text,
  context_header text, body_text text, search_text text, search_text_unaccented text,
  chapter_number text, section_number text, article_number text, article_title text,
  clause_number text, point_from text, point_to text, page_from integer, page_to integer,
  parent_id text, previous_sibling_id text, next_sibling_id text,
  cross_reference_ids text[], token_count integer, corpus_version text,
  keyword_rank integer, vector_rank integer, fused_score double precision
)
language sql
stable
as $$
  with terms as (
    select coalesce(array_agg(distinct lexeme), '{}'::text[]) as lexemes
    from unnest(tsvector_to_array(
      to_tsvector('simple', keyword_search_legal_chunks.query_unaccented))) as lexeme
    where length(lexeme) >= 2
  ),
  query_terms as (
    select lexemes,
      to_tsquery('simple', array_to_string(
        array(select quote_literal(term) from unnest(lexemes) as term), ' | ')) as tsq,
      least(2, cardinality(lexemes)) as min_terms
    from terms
    where cardinality(lexemes) > 0
  ),
  matched as (
    select c.chunk_id,
      (select count(*)
         from unnest(tsvector_to_array(c.search_tsv)) as lexeme
         where lexeme = any(q.lexemes)) as term_hits,
      ts_rank(c.search_tsv, q.tsq) as rank,
      q.min_terms
    from query_terms q
    join legal_chunks c
      on c.search_tsv @@ q.tsq
    where c.status = 'active'
      and c.chunk_type = 'normative'
      and c.corpus_version = keyword_search_legal_chunks.corpus_version
  ),
  ranked as (
    select m.chunk_id, m.term_hits, m.rank,
      row_number() over (order by m.term_hits desc, m.rank desc, m.chunk_id) as position
    from matched m
    where m.term_hits >= m.min_terms
    order by position
    limit keyword_search_legal_chunks.match_count
  )
  select v.chunk_id, v.document_id, v.document_number, v.document_title,
    v.context_header, v.body_text, v.search_text, v.search_text_unaccented,
    v.chapter_number, v.section_number, v.article_number, v.article_title,
    v.clause_number, v.point_from, v.point_to, v.page_from, v.page_to,
    v.parent_id, v.previous_sibling_id, v.next_sibling_id,
    v.cross_reference_ids, v.token_count, v.corpus_version,
    r.position::integer as keyword_rank,
    null::integer as vector_rank,
    r.rank::double precision as fused_score
  from ranked r
  join legal_chunk_rows v on v.chunk_id = r.chunk_id
  order by r.position;
$$;

-- ---------------------------------------------------------------------------
-- Hybrid search: Reciprocal Rank Fusion of keyword and vector rankings
-- ---------------------------------------------------------------------------

create or replace function hybrid_search_legal_chunks(
  query_text      text,
  query_unaccented text,
  query_embedding vector(1024),
  match_count     integer,
  corpus_version  text
)
returns table (
  chunk_id text, document_id text, document_number text, document_title text,
  context_header text, body_text text, search_text text, search_text_unaccented text,
  chapter_number text, section_number text, article_number text, article_title text,
  clause_number text, point_from text, point_to text, page_from integer, page_to integer,
  parent_id text, previous_sibling_id text, next_sibling_id text,
  cross_reference_ids text[], token_count integer, corpus_version text,
  keyword_rank integer, vector_rank integer, fused_score double precision
)
language sql
stable
as $$
  with keyword as (
    select k.chunk_id, k.keyword_rank as rank
    from keyword_search_legal_chunks(
      hybrid_search_legal_chunks.query_text,
      hybrid_search_legal_chunks.query_unaccented,
      30,
      hybrid_search_legal_chunks.corpus_version) k
  ),
  nearest as (
    -- ORDER BY distance + LIMIT directly on the base table lets pgvector use
    -- the HNSW index; ranks are assigned only after the nearest rows are found.
    select c.chunk_id,
      c.embedding <=> hybrid_search_legal_chunks.query_embedding as distance
    from legal_chunks c
    where hybrid_search_legal_chunks.query_embedding is not null
      and c.embedding is not null
      and c.status = 'active'
      and c.chunk_type = 'normative'
      and c.corpus_version = hybrid_search_legal_chunks.corpus_version
    order by c.embedding <=> hybrid_search_legal_chunks.query_embedding
    limit 30
  ),
  vector as (
    select n.chunk_id, row_number() over (order by n.distance, n.chunk_id) as rank
    from nearest n
  ),
  fused as (
    select coalesce(k.chunk_id, v.chunk_id) as chunk_id,
      k.rank::integer as keyword_rank,
      v.rank::integer as vector_rank,
      coalesce(1.0 / (60 + k.rank), 0) + coalesce(1.0 / (60 + v.rank), 0) as fused_score
    from keyword k
    full outer join vector v on k.chunk_id = v.chunk_id
  )
  select r.chunk_id, r.document_id, r.document_number, r.document_title,
    r.context_header, r.body_text, r.search_text, r.search_text_unaccented,
    r.chapter_number, r.section_number, r.article_number, r.article_title,
    r.clause_number, r.point_from, r.point_to, r.page_from, r.page_to,
    r.parent_id, r.previous_sibling_id, r.next_sibling_id,
    r.cross_reference_ids, r.token_count, r.corpus_version,
    f.keyword_rank, f.vector_rank, f.fused_score::double precision
  from fused f
  join legal_chunk_rows r on r.chunk_id = f.chunk_id
  order by f.fused_score desc, r.chunk_id
  limit hybrid_search_legal_chunks.match_count;
$$;

-- ---------------------------------------------------------------------------
-- Atomic corpus activation (called by `python -m ingestion.legal_ingestion.cli publish`)
-- ---------------------------------------------------------------------------

create or replace function activate_legal_corpus(
  target_corpus_version text,
  expected_chunk_ids    text[],
  documents             jsonb,
  publish_run_id        text,
  publish_report        jsonb default '{}'::jsonb,
  require_embeddings    boolean default true
)
returns jsonb
language plpgsql
as $$
declare
  expected_count      integer := cardinality(expected_chunk_ids);
  document_ids        text[];
  found_chunks        integer;
  missing_embeddings  integer;
  activated_chunks    integer;
  deactivated_chunks  integer;
  active_chunks       integer;
  active_normative    integer;
begin
  -- One publish at a time; everything below commits or rolls back together.
  perform pg_advisory_xact_lock(hashtext('activate_legal_corpus'));

  if expected_count is null or expected_count = 0 then
    raise exception 'activate_legal_corpus: no chunks to activate for %', target_corpus_version;
  end if;

  select array_agg(doc ->> 'document_id') into document_ids
  from jsonb_array_elements(documents) as doc;
  if document_ids is null or cardinality(document_ids) = 0 then
    raise exception 'activate_legal_corpus: no documents supplied for %', target_corpus_version;
  end if;

  select count(*) into found_chunks
  from legal_chunks
  where corpus_version = target_corpus_version
    and chunk_id = any(expected_chunk_ids)
    and document_id = any(document_ids);
  if found_chunks <> expected_count then
    raise exception 'activate_legal_corpus: expected % staged chunks for %, found %',
      expected_count, target_corpus_version, found_chunks;
  end if;

  if require_embeddings then
    select count(*) into missing_embeddings
    from legal_chunks
    where corpus_version = target_corpus_version
      and chunk_id = any(expected_chunk_ids)
      and chunk_type = 'normative'
      and embedding is null;
    if missing_embeddings > 0 then
      raise exception 'activate_legal_corpus: % normative chunks have no embedding', missing_embeddings;
    end if;
  end if;

  -- Document rows are shared across versions (primary key document_id), so
  -- their metadata is switched here, inside the same transaction.
  insert into legal_documents (
    document_id, document_number, document_type, title, issued_date,
    effective_date, source_file, pdf_url, corpus_version, status
  )
  select doc ->> 'document_id', doc ->> 'document_number', doc ->> 'document_type',
    doc ->> 'title', (doc ->> 'issued_date')::date, (doc ->> 'effective_date')::date,
    doc ->> 'source_file', doc ->> 'pdf_url', target_corpus_version, 'active'
  from jsonb_array_elements(documents) as doc
  on conflict (document_id) do update set
    document_number = excluded.document_number,
    document_type   = excluded.document_type,
    title           = excluded.title,
    issued_date     = excluded.issued_date,
    effective_date  = excluded.effective_date,
    source_file     = excluded.source_file,
    pdf_url         = excluded.pdf_url,
    corpus_version  = excluded.corpus_version,
    status          = 'active';

  update legal_documents set status = 'inactive'
  where status = 'active' and not (document_id = any(document_ids));

  update legal_chunks set status = 'active'
  where corpus_version = target_corpus_version
    and chunk_id = any(expected_chunk_ids)
    and status <> 'active';
  get diagnostics activated_chunks = row_count;

  -- Retire every other active chunk: older versions and rows of this version
  -- that are no longer in the artifact.
  update legal_chunks set status = 'inactive'
  where status = 'active'
    and (corpus_version <> target_corpus_version or not (chunk_id = any(expected_chunk_ids)));
  get diagnostics deactivated_chunks = row_count;

  select count(*), count(*) filter (where chunk_type = 'normative')
  into active_chunks, active_normative
  from legal_chunks
  where status = 'active';

  insert into ingestion_runs (run_id, corpus_version, finished_at, is_valid, report)
  values (
    publish_run_id,
    target_corpus_version,
    now(),
    true,
    coalesce(publish_report, '{}'::jsonb) || jsonb_build_object(
      'active_chunks', active_chunks,
      'active_normative_chunks', active_normative
    )
  )
  on conflict (run_id) do update set
    finished_at = excluded.finished_at,
    is_valid    = excluded.is_valid,
    report      = excluded.report;

  return jsonb_build_object(
    'corpus_version', target_corpus_version,
    'activated_chunks', activated_chunks,
    'deactivated_chunks', deactivated_chunks,
    'active_chunks', active_chunks,
    'active_normative_chunks', active_normative,
    'active_documents', cardinality(document_ids)
  );
end;
$$;

revoke all on function activate_legal_corpus(text, text[], jsonb, text, jsonb, boolean)
  from public, anon, authenticated;
