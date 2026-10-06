# Trợ lý AI tra cứu BHXH/BHYT

Ứng dụng web responsive giúp tra cứu và phân tích quy định bảo hiểm xã hội và bảo hiểm y tế
từ một corpus pháp lý cố định gồm **bốn nghị định** (157, 158, 159, 188 / 2025 / NĐ-CP).
Hệ thống trả lời ngắn gọn trước, phân tích kèm **căn cứ có thể mở và kiểm tra lại**, chỉ hiển thị
những mệnh đề đối chiếu được với nguồn, và từ chối kết luận khi dữ liệu không đủ.

> **Trạng thái:** MVP/DEMO phục vụ cuộc thi nội bộ. Dự án ưu tiên trải nghiệm trình diễn,
> độ tin cậy và hiệu năng hợp lý; chưa được định vị là hệ thống tư vấn pháp lý production.

## Dự án giải quyết vấn đề gì?

- Rút ngắn thời gian tìm Điều, Khoản và Điểm trong bốn nghị định BHXH/BHYT thuộc phạm vi dự án.
- Biến câu hỏi tự nhiên thành câu trả lời có cấu trúc, có nguồn và có thể kiểm tra lại.
- Giảm nguy cơ AI trả lời quá phạm vi bằng validator deterministic và trạng thái thiếu căn cứ.
- Giữ trải nghiệm tra cứu đơn giản trên cả desktop và mobile.

## Điểm nổi bật

- **Legal RAG có kiểm chứng:** hybrid retrieval, reranking, context pháp lý và validator deterministic cho claim/citation.
- **Citation truy vết được:** mỗi claim được gắn với nguồn, breadcrumb và trang PDF tương ứng.
- **Corpus được kiểm soát:** ingestion có manifest, hash, provenance, parser cấu trúc và quality gate.
- **Provider có thể thay thế:** LLM, embedding và reranker được cấu hình qua biến môi trường.
- **Thiết kế phù hợp MVP:** memory repository phục vụ phát triển/test; Supabase phục vụ demo với corpus đầy đủ.

## Kiến trúc

```
4 PDF pháp luật → Pipeline ingestion (Python) → chunks + validation report
                                                       │
                                     Supabase PostgreSQL (pgvector, pg_trgm, unaccent)
                                                       │
Next.js API: query parser → hybrid retrieval → rerank → context builder
           → LLM structured answer → deterministic grounding validator
                                                       │
                          Next.js UI: answer + inline citations + source drawer
```

- **Python** chỉ chạy trong ingestion thủ công, không phục vụ request runtime.
- **Repository interface** cho phép chạy toàn bộ test bằng `MemoryLegalRepository` — không cần
  Docker, credential hay mạng. Supabase là backend production, thay bằng biến môi trường.
- **Provider** (LLM, embedding, reranker) đều thay được qua `.env`, không ảnh hưởng business logic.

## Yêu cầu

- Node.js 20.9+ (khuyến nghị 24.13), npm.
- Python 3.10+ (cho ingestion).
- Tesseract 5 với `vie+eng` (chỉ cho ingestion OCR cục bộ) — xem [docs/operations/ingestion.md](docs/operations/ingestion.md).

## Cài đặt

```powershell
npm install
Copy-Item .env.example .env   # điền secret nếu chạy chế độ supabase / gọi provider thật
```

Cấu hình mặc định (`LEGAL_REPOSITORY=memory`) chọn bộ dữ liệu mẫu; để gọi chat thật vẫn cần cấu hình
provider trong `.env`. Unit/evaluation/E2E dùng fake provider deterministic nên không cần credential.

## Chạy dev

```powershell
npm run dev
# http://localhost:3000
```

Ở chế độ `memory`, các câu hỏi được phục vụ từ `sampleCorpus` khi provider đã cấu hình. Để trả lời
trên toàn corpus thật, chạy ingestion + Supabase (xem docs/operations) và đặt
`LEGAL_REPOSITORY=supabase`.

## Kiểm thử

```powershell
# Ingestion (Python) — cần venv, xem docs/operations/ingestion.md
python -m pytest tests/ingestion -q --cov=ingestion/legal_ingestion

# TypeScript unit/integration (memory mode, không cần credential)
npm run test

# Lint + typecheck + test + build
npm run verify

# End-to-end (Playwright, backend được mock deterministic)
npx playwright install chromium
npm run test:e2e

# Đánh giá gold set (memory mode chạy trong test; bản credential dùng `npm run evaluate`)
npm run test -- tests/evaluation
```

Test tích hợp Supabase (`tests/db/supabase-contract.test.ts`) chỉ chạy khi có **cả**
`SUPABASE_TEST_URL` và `SUPABASE_TEST_SERVICE_KEY`; nếu không, nó tự bỏ qua.

## Xác thực đầy đủ (local)

```powershell
python -m pytest tests/ingestion -q --cov=ingestion/legal_ingestion
npm run verify
npm run test:e2e
```

## Cấu hình provider

Đổi model chỉ cần đổi biến môi trường, không sửa code:

| Vai trò    | Biến                                             | Mặc định demo               |
| ---------- | ------------------------------------------------ | --------------------------- |
| Generation | `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`       | `google/gemma-4-31b-it`     |
| Embedding  | `EMBEDDING_*`                                     | `BAAI/bge-m3` (1024 chiều)  |
| Reranker   | `RERANKER_*`                                      | `BAAI/bge-reranker-v2-m3`   |

## Bản đồ tài liệu

- [Abstract.md](Abstract.md) — knowledge base trung tâm: mục tiêu, phạm vi, kiến trúc, trạng thái và định hướng dự án.
- [TODO-MVP-DEMO.md](TODO-MVP-DEMO.md) — backlog cần theo dõi và hoàn thành cho bản dự thi.
- [docs/operations/ingestion.md](docs/operations/ingestion.md) — OCR cục bộ, chạy pipeline, quality gate và publish corpus lên Supabase.
- [docs/operations/deployment.md](docs/operations/deployment.md) — Supabase, publish corpus và rollback.
- [docs/operations/evaluation.md](docs/operations/evaluation.md) — gold set, chạy đánh giá và so sánh model.
- [Thiết kế kỹ thuật gốc](docs/superpowers/specs/2026-07-21-legal-insurance-rag-design.md) — đặc tả chi tiết dùng làm tài liệu tham chiếu.

## Bảo mật & riêng tư

- Mọi secret chỉ nằm ở server-side (`getServerEnv` được `server-only`, không lộ xuống client bundle).
- Không log câu hỏi, câu trả lời, hay toàn văn nguồn; rate limit dùng hash IP ngắn hạn + salt.
- Endpoint PDF/source chỉ phục vụ allowlist bốn tài liệu; không tải URL do người dùng cung cấp.
- Câu trả lời chỉ được trả về sau khi qua **deterministic grounding validator**; giao diện luôn
  nhắc người dùng đối chiếu văn bản gốc vì đây không phải một chứng nhận pháp lý độc lập.
