# Vận hành: Triển khai & Supabase

## 1. Schema

Áp dụng lần lượt hai migration lên Supabase PostgreSQL:

```
supabase/migrations/202607210001_legal_corpus.sql
supabase/migrations/202609190001_publish_and_search.sql
```

Migration bật `vector`, `pg_trgm`, `unaccent`; tạo năm bảng (`legal_documents`, `legal_nodes`,
`legal_chunks`, `legal_cross_references`, `ingestion_runs`); tạo GIN full-text + trigram và HNSW
cosine `vector(1024)`; định nghĩa RPC `exact_search_legal_chunks`, `keyword_search_legal_chunks`,
`hybrid_search_legal_chunks` (RRF). Quyền ghi trực tiếp bị thu hồi khỏi `anon`/`authenticated` —
runtime chỉ ghi bằng service key phía server.

Migration `202609190001` (bắt buộc cho Supabase):

- View `legal_chunk_rows` nối số hiệu/tiêu đề văn bản và **không** chứa cột `embedding`. Trước đây
  `getSource`, `getRelated` và exact search đọc thẳng `legal_chunks` (không có `document_number`) nên
  đường Supabase không parse được kết quả.
- Cột sinh `search_tsv` + GIN index; keyword search dùng truy vấn OR trên các từ của câu hỏi và yêu cầu ít
  nhất hai từ khớp (giống memory repository). Truy vấn AND cũ trả 0 kết quả cho câu hỏi tự nhiên.
- Hybrid search truy vấn thẳng bảng gốc ở cả hai nhánh để GIN và HNSW dùng được; bỏ điều kiện trigram
  `%` (ngưỡng 0,3 gần như không bao giờ khớp câu hỏi ngắn với chunk dài).
- RPC `activate_legal_corpus` cho lệnh publish (xem [ingestion.md](ingestion.md) mục 6).

## 2. Biến môi trường production

Đặt các biến trong [.env.example](../../.env.example). `LEGAL_REPOSITORY` chỉ nhận `memory` hoặc
`supabase`; giá trị khác làm cấu hình dừng với lỗi `LEGAL_REPOSITORY` thay vì tự rơi về memory.

Khi `LEGAL_REPOSITORY=supabase`, bắt buộc có `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`,
`CORPUS_VERSION`, và bộ `LLM_*` / `EMBEDDING_*` / `RERANKER_*`. Mọi chế độ cần bộ provider,
`AI_TIMEOUT_MS`, `REQUEST_TIMEOUT_MS`, `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_MS` và
`RATE_LIMIT_SALT`; các giá trị số được kiểm tra ngay khi khởi động/request đầu tiên. `REQUEST_TIMEOUT_MS`
được giới hạn an toàn trong khoảng 1–60 giây và do môi trường demo quyết định. Memory mode chỉ dùng sample
corpus, không đại diện cho đủ bốn nghị định;
memory repository không loại bỏ yêu cầu provider nếu muốn gọi `/api/chat` thật.

Với Hugging Face Inference Providers, `EMBEDDING_BASE_URL` và `RERANKER_BASE_URL` là URL gốc của
router (ví dụ `https://router.huggingface.co`); adapter tự thêm route task
`/hf-inference/models/{model}`. Không dùng `/v1/embeddings` cho hai task này.

Tối thiểu cho test/e2e memory (không cần Supabase):

```text
LEGAL_REPOSITORY=memory
CORPUS_VERSION=2025-demo-v1
LLM_BASE_URL=<url>
LLM_API_KEY=<key>
LLM_MODEL=<model>
LLM_MAX_OUTPUT_TOKENS=2048
EMBEDDING_BASE_URL=<url>
EMBEDDING_API_KEY=<key>
EMBEDDING_MODEL=<model>
RERANKER_BASE_URL=<url>
RERANKER_API_KEY=<key>
RERANKER_MODEL=<model>
AI_TIMEOUT_MS=36000
REQUEST_TIMEOUT_MS=60000
RATE_LIMIT_MAX=20
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_SALT=<random-server-secret>
```

Với demo đầy đủ, đổi `LEGAL_REPOSITORY=supabase` và điền thêm hai biến Supabase. Giá trị repository
khác `memory`/`supabase`, URL provider sai, số ngoài giới hạn hoặc credential Supabase thiếu sẽ làm
`getServerEnv()` dừng với lỗi nêu rõ tên trường; không có nhánh fallback im lặng.

Secret chỉ nằm server-side. `getServerEnv()` được đánh dấu `server-only`; kiểm tra bundle:

```powershell
npm run build
# Xác nhận không có key trong client assets
Select-String -Path .next/static/**/*.js -Pattern "SUPABASE_SERVICE_KEY|sk-" -List
```

### Ngân sách thời gian theo stage

`REQUEST_TIMEOUT_MS` là deadline tổng của một câu hỏi và được chia cho từng stage:

| Stage | Ngân sách | Khi không đủ |
| --- | --- | --- |
| Embedding câu hỏi | ≤ 15% deadline tổng | hết giờ → keyword fallback (`embedding_timeout_keyword_fallback`) |
| Rerank | ≤ 15% deadline tổng, và chỉ chạy nếu còn ≥ 50% deadline | bỏ qua, giữ thứ tự RRF (`reranker_skipped_budget` / `reranker_timeout_order_preserved`) |
| Generation | toàn bộ thời gian còn lại, trừ ≤ 1 giây dự phòng cho verification | không còn thời gian → lỗi `provider_timeout` ngay, không gọi provider |

`AI_TIMEOUT_MS` là trần cho **một** lời gọi provider và phải ≤ 60% `REQUEST_TIMEOUT_MS`
(15% + 15% + 60% còn 10% dự phòng); `env.ts` từ chối cấu hình vi phạm ngay khi khởi động. Demo dùng
36000/60000. Embedding/rerank chia ngân sách stage cho hai attempt (attempt đầu tối đa một nửa) để còn
chỗ cho retry; generation không cắt attempt đầu, vì cắt ngắn một lượt sinh chậm không làm lượt retry nhanh hơn.
Mọi lời gọi Supabase cũng nhận `AbortSignal` của request và có trần 10 giây mỗi lời gọi.

Lời gọi provider có tối đa một retry transport có kiểm soát cho 5xx/network/timeout; 429 chỉ retry khi
provider gửi `Retry-After` và còn đủ ngân sách. OpenAI SDK không được phép retry thêm. `REQUEST_TIMEOUT_MS`
là deadline tổng có thể cấu hình từ 1–60 giây; chọn giá trị theo mạng/model demo và không coi 25 giây là
giới hạn business bắt buộc. Khi client hủy hoặc deadline hết, signal được truyền tới provider để abort.
Log server chỉ gồm route/status/latency, số kết quả, scope, metrics vô danh và thời gian từng stage —
không ghi câu hỏi, câu trả lời, nguồn hay IP thô.

Kiểm tra readiness trước rehearsal (không in API key/token):

```
npm run provider:readiness
```

Kết quả có trạng thái `ready`, `degraded-keyword-only` (generation sẵn sàng nhưng embedding/reranker
không dùng được) hoặc `unavailable`. Lỗi 401/403 của semantic provider sẽ mở circuit trong phiên server
và các request sau dùng keyword fallback, không lặp lại HTTP request chắc chắn thất bại.

## 3. Publish corpus mới (atomic + versioned)

Dùng lệnh `link-references` → `embed` → `publish --dry-run` → `publish` của
`ingestion.legal_ingestion.cli`; runbook đầy đủ ở [ingestion.md](ingestion.md) mục 6. Chunk được nạp ở
`staged`, rồi RPC `activate_legal_corpus` bật corpus mới và hạ corpus cũ trong **một transaction** và
ghi `ingestion_runs`. Nếu bất kỳ bước nào lỗi, corpus đang `active` giữ nguyên — người dùng không thấy
trạng thái nửa vời.

## 4. Rollback

Cách ưu tiên: chạy lại `publish` với artifact của phiên bản trước. Thủ công bằng SQL:

```sql
update legal_chunks set status = 'inactive' where corpus_version = '<phiên bản lỗi>';
update legal_chunks set status = 'active'   where corpus_version = '<phiên bản trước>';
update legal_documents set status = 'active' where corpus_version = '<phiên bản trước>';
```

Vì `CORPUS_VERSION` chọn dữ liệu ở tầng ứng dụng, đổi biến môi trường về phiên bản trước và
khởi động lại cũng là một cách rollback an toàn không cần sửa dữ liệu.

## 5. Build & chạy production

```powershell
npm run build
npm run start   # mặc định cổng 3000
```

Ba route API (`/api/chat`, `/api/documents`, `/api/sources/[id]`) chạy trên Node runtime và
chỉ chấp nhận same-origin. `/api/sources/:id` dựng URL PDF từ bản ghi tài liệu tin cậy, không
bao giờ từ tham số người dùng.

- `POST /api/chat` trả JSON như trước; nếu request có `Accept: text/event-stream` (UI luôn gửi), route
  phát các sự kiện `stage` (`retrieval`, `context`, `generation`, `verification`) theo tiến trình thật, rồi
  đúng một sự kiện `result` (cùng body JSON) hoặc `error` (`{ code, message, status }`). Hủy fetch sẽ abort
  pipeline và lời gọi provider. Proxy đứng trước server không được buffer `text/event-stream`.
- `GET /corpus/:filename` stream PDF, hỗ trợ `Range` (`206 Partial Content`, `Accept-Ranges: bytes`,
  `416` khi vượt cuối file) và `HEAD`; không nạp cả file vào RAM.
