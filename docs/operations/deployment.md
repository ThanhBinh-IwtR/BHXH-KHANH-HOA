# Vận hành: Triển khai & Supabase

## 1. Schema

Áp dụng migration một lần lên Supabase PostgreSQL:

```
supabase/migrations/202607210001_legal_corpus.sql
```

Migration bật `vector`, `pg_trgm`, `unaccent`; tạo năm bảng (`legal_documents`, `legal_nodes`,
`legal_chunks`, `legal_cross_references`, `ingestion_runs`); tạo GIN full-text + trigram và HNSW
cosine `vector(1024)`; định nghĩa RPC `exact_search_legal_chunks`, `keyword_search_legal_chunks`,
`hybrid_search_legal_chunks` (RRF). Quyền ghi trực tiếp bị thu hồi khỏi `anon`/`authenticated` —
runtime chỉ ghi bằng service key phía server.

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
LLM_MAX_OUTPUT_TOKENS=1024
EMBEDDING_BASE_URL=<url>
EMBEDDING_API_KEY=<key>
EMBEDDING_MODEL=<model>
RERANKER_BASE_URL=<url>
RERANKER_API_KEY=<key>
RERANKER_MODEL=<model>
AI_TIMEOUT_MS=50000
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

1. Chạy ingestion (xem [ingestion.md](ingestion.md)) tới khi report `is_valid: true`.
2. Nạp `chunks.jsonl` vào `legal_chunks` với `status = 'staged'` và `corpus_version` mới.
3. Sinh embedding cho các chunk staged; nếu embedding lỗi giữa chừng, **không** publish.
4. Trong một transaction: đặt corpus mới `status = 'active'`, corpus cũ `status = 'inactive'`.
5. Ghi một dòng `ingestion_runs` với report.

Nếu bất kỳ bước nào lỗi, corpus đang `active` giữ nguyên — người dùng không thấy trạng thái nửa vời.

## 4. Rollback

Để quay lại phiên bản corpus trước:

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
