-- Legal corpus schema for the BHXH/BHYT assistant.
-- Reproducible: enables extensions, tables, indexes, and hybrid-search RPCs.

create extension if not exists vector;
create extension if not exists pg_trgm;
create extension if not exists unaccent;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists legal_documents (
  document_id      text primary key,
  document_number  text not null,
  document_type    text not null,
  title            text not null,
  issued_date      date not null,
  effective_date   date not null,
  source_file      text not null,
  pdf_url          text not null,
  corpus_version   text not null,
  status           text not null default 'staged'
                   check (status in ('staged', 'active', 'inactive')),
  unique (document_number, corpus_version)
);

create table if not exists legal_nodes (
  node_id        text primary key,
  document_id    text not null references legal_documents (document_id) on delete cascade,
  kind           text not null,
  number         text,
  title          text,
  body_text      text not null,
  page_from      integer not null check (page_from >= 1),
  page_to        integer not null check (page_to >= page_from),
  parent_id      text references legal_nodes (node_id) on delete cascade,
  corpus_version text not null
);

create table if not exists legal_chunks (
  chunk_id                text primary key,
  document_id             text not null references legal_documents (document_id) on delete cascade,
  chapter_number          text,
  section_number          text,
  article_number          text,
  article_title           text,
  clause_number           text,
  point_from              text,
  point_to                text,
  context_header          text not null,
  body_text               text not null,
  search_text             text not null,
  search_text_unaccented  text not null,
  page_from               integer not null check (page_from >= 1),
  page_to                 integer not null check (page_to >= page_from),
  parent_id               text,
  previous_sibling_id     text,
  next_sibling_id         text,
  cross_reference_ids     text[] not null default '{}',
  token_count             integer not null check (token_count >= 1),
  embedding               vector(1024),
  corpus_version          text not null,
  status                  text not null default 'staged'
                          check (status in ('staged', 'active', 'inactive')),
  -- 'normative' = Điều/Khoản/Điểm (retrievable); 'appendix' = phụ lục/biểu mẫu
  -- form templates, which are stored but never returned by search.
  chunk_type              text not null default 'normative'
                          check (chunk_type in ('normative', 'appendix'))
);

create table if not exists legal_cross_references (
  id                 bigint generated always as identity primary key,
  source_chunk_id    text not null references legal_chunks (chunk_id) on delete cascade,
  target_chunk_id    text references legal_chunks (chunk_id) on delete set null,
  matched_text       text not null,
  resolved           boolean not null default false,
  corpus_version     text not null,
  unique (source_chunk_id, matched_text)
);

create table if not exists ingestion_runs (
  run_id          text primary key,
  corpus_version  text not null,
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  is_valid        boolean not null default false,
  report          jsonb not null default '{}'::jsonb
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

create index if not exists legal_chunks_document_idx
  on legal_chunks (document_id, article_number, clause_number);
create index if not exists legal_chunks_status_idx
  on legal_chunks (corpus_version, status);
create index if not exists legal_chunks_search_fts_idx
  on legal_chunks using gin (to_tsvector('simple', search_text));
create index if not exists legal_chunks_search_unaccented_fts_idx
  on legal_chunks using gin (to_tsvector('simple', search_text_unaccented));
create index if not exists legal_chunks_trgm_idx
  on legal_chunks using gin (search_text_unaccented gin_trgm_ops);
create index if not exists legal_chunks_embedding_idx
  on legal_chunks using hnsw (embedding vector_cosine_ops);

-- ---------------------------------------------------------------------------
-- Exact-reference lookup
-- ---------------------------------------------------------------------------

create or replace function exact_search_legal_chunks(
  document_number text,
  article_number  text,
  clause_number   text default null,
  point_number    text default null,
  corpus_version  text default null
)
returns setof legal_chunks
language sql
stable
as $$
  select c.*
  from legal_chunks c
  join legal_documents d on d.document_id = c.document_id
  where regexp_replace(lower(unaccent(d.document_number)), '[^a-z0-9]', '', 'g')
      = regexp_replace(lower(unaccent(exact_search_legal_chunks.document_number)), '[^a-z0-9]', '', 'g')
    and c.article_number = exact_search_legal_chunks.article_number
    and (exact_search_legal_chunks.clause_number is null
         or c.clause_number = exact_search_legal_chunks.clause_number)
    and (exact_search_legal_chunks.point_number is null
         or (c.point_from is not null
             and exact_search_legal_chunks.point_number between c.point_from and coalesce(c.point_to, c.point_from)))
    and c.chunk_type = 'normative'
    and c.status = 'active'
    and (exact_search_legal_chunks.corpus_version is null
         or c.corpus_version = exact_search_legal_chunks.corpus_version)
  order by c.article_number, c.clause_number nulls first, c.point_from nulls first, c.chunk_id;
$$;

-- ---------------------------------------------------------------------------
-- Keyword-only search (used when embeddings are unavailable)
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
  with ranked as (
    select c.*, d.document_number, d.title as document_title,
      ts_rank(to_tsvector('simple', c.search_text_unaccented),
              plainto_tsquery('simple', keyword_search_legal_chunks.query_unaccented)) as rank
    from legal_chunks c
    join legal_documents d on d.document_id = c.document_id
    where c.status = 'active'
      and c.chunk_type = 'normative'
      and c.corpus_version = keyword_search_legal_chunks.corpus_version
      and (to_tsvector('simple', c.search_text_unaccented)
             @@ plainto_tsquery('simple', keyword_search_legal_chunks.query_unaccented)
           or c.search_text_unaccented % keyword_search_legal_chunks.query_unaccented)
    order by rank desc
    limit keyword_search_legal_chunks.match_count
  )
  select chunk_id, document_id, document_number, document_title,
    context_header, body_text, search_text, search_text_unaccented,
    chapter_number, section_number, article_number, article_title,
    clause_number, point_from, point_to, page_from, page_to,
    parent_id, previous_sibling_id, next_sibling_id,
    cross_reference_ids, token_count, corpus_version,
    (row_number() over (order by rank desc))::integer as keyword_rank,
    null::integer as vector_rank,
    rank::double precision as fused_score
  from ranked;
$$;

-- ---------------------------------------------------------------------------
-- Hybrid search using Reciprocal Rank Fusion of full-text and vector rankings
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
  with active as (
    select c.*, d.document_number, d.title as document_title
    from legal_chunks c
    join legal_documents d on d.document_id = c.document_id
    where c.status = 'active'
      and c.chunk_type = 'normative'
      and c.corpus_version = hybrid_search_legal_chunks.corpus_version
  ),
  keyword as (
    select chunk_id,
      row_number() over (
        order by ts_rank(to_tsvector('simple', search_text_unaccented),
                         plainto_tsquery('simple', hybrid_search_legal_chunks.query_unaccented)) desc
      ) as rank
    from active
    where to_tsvector('simple', search_text_unaccented)
            @@ plainto_tsquery('simple', hybrid_search_legal_chunks.query_unaccented)
       or search_text_unaccented % hybrid_search_legal_chunks.query_unaccented
    limit 30
  ),
  vector as (
    select chunk_id,
      row_number() over (order by embedding <=> hybrid_search_legal_chunks.query_embedding) as rank
    from active
    where hybrid_search_legal_chunks.query_embedding is not null
      and embedding is not null
    limit 30
  ),
  fused as (
    select coalesce(k.chunk_id, v.chunk_id) as chunk_id,
      k.rank::integer as keyword_rank,
      v.rank::integer as vector_rank,
      coalesce(1.0 / (60 + k.rank), 0) + coalesce(1.0 / (60 + v.rank), 0) as fused_score
    from keyword k
    full outer join vector v on k.chunk_id = v.chunk_id
  )
  select a.chunk_id, a.document_id, a.document_number, a.document_title,
    a.context_header, a.body_text, a.search_text, a.search_text_unaccented,
    a.chapter_number, a.section_number, a.article_number, a.article_title,
    a.clause_number, a.point_from, a.point_to, a.page_from, a.page_to,
    a.parent_id, a.previous_sibling_id, a.next_sibling_id,
    a.cross_reference_ids, a.token_count, a.corpus_version,
    f.keyword_rank, f.vector_rank, f.fused_score
  from fused f
  join active a on a.chunk_id = f.chunk_id
  order by f.fused_score desc
  limit hybrid_search_legal_chunks.match_count;
$$;

-- ---------------------------------------------------------------------------
-- Privileges: the browser never touches these tables directly.
-- Runtime writes use the service role only.
-- ---------------------------------------------------------------------------

revoke all on legal_documents, legal_nodes, legal_chunks,
  legal_cross_references, ingestion_runs from anon, authenticated;
