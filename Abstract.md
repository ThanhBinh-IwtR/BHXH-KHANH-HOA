# Project Abstract — Trợ lý AI tra cứu BHXH/BHYT

> **Trạng thái dự án:** MVP/DEMO cho cuộc thi nội bộ
>
> **Cập nhật context:** 2026-09-19
>
> **Vai trò tài liệu:** nguồn context chung về mục tiêu, phạm vi, kiến trúc, trạng thái và định hướng của dự án

## 1. Cách sử dụng hệ thống tài liệu

Dự án phân tách tài liệu theo vai trò để tránh biến `README.md` thành một đặc tả kỹ thuật quá dài:

| Tài liệu | Vai trò |
| --- | --- |
| `README.md` | Bộ mặt của dự án: giới thiệu ngắn, giá trị nổi bật, kiến trúc rút gọn và hướng dẫn bắt đầu nhanh. |
| `Abstract.md` | Knowledge base trung tâm: lưu context chung, mục tiêu, nguyên tắc, cấu trúc, trạng thái và định hướng. |
| `TODO-MVP-DEMO.md` | Backlog thực thi cho bản dự thi, được sắp theo P0, P1 và Deferred. |
| `TODO-PUSH.md` | Checklist kiểm tra repository, chuẩn bị commit và push mã nguồn lên GitHub. |
| `docs/operations/*.md` | Runbook cho ingestion, deployment và evaluation. |
| Mã nguồn và test | Nguồn xác nhận hành vi thực tế của phiên bản hiện tại. |

Khi tài liệu và hành vi chạy thực tế chưa đồng nhất, mã nguồn cùng test phản ánh **trạng thái hiện tại**;
`Abstract.md` phản ánh **context và định hướng**; `TODO-MVP-DEMO.md` phải ghi nhận khoảng cách cần xử lý.
Mỗi yêu cầu push lên GitHub phải bắt đầu bằng việc đọc lại `Abstract.md` và thực hiện checklist mới theo
`TODO-PUSH.md`.

## 2. Tóm tắt dự án

Trợ lý AI tra cứu BHXH/BHYT là ứng dụng web hỏi đáp pháp lý tiếng Việt trên một corpus đóng gồm
bốn nghị định năm 2025. Người dùng đặt câu hỏi bằng ngôn ngữ tự nhiên; hệ thống tìm các đơn vị pháp
lý liên quan, tạo câu trả lời có cấu trúc, kiểm tra mức độ được nguồn hỗ trợ và cung cấp citation để
người dùng mở lại nguyên văn.

Giá trị cốt lõi của dự án không nằm ở việc để mô hình “biết mọi luật”, mà ở khả năng:

- Tìm nhanh căn cứ trong phạm vi tài liệu đã xác định.
- Tách kết luận có căn cứ khỏi nội dung AI bổ sung.
- Cho phép kiểm tra ngược từ câu trả lời về đúng văn bản và trang nguồn.
- Nhận biết khi thiếu dữ kiện hoặc câu hỏi nằm ngoài corpus.
- Mang lại một trải nghiệm đủ nhanh, rõ ràng và thuyết phục trong bối cảnh trình diễn MVP.

Dự án không thay thế tư vấn của cơ quan có thẩm quyền hoặc chuyên gia pháp lý. Kết quả phải được
hiểu là hỗ trợ tra cứu trên corpus giới hạn, không phải kết luận pháp lý chính thức.

## 3. Bài toán và cách tiếp cận

### 3.1. Bài toán

Văn bản pháp luật dài, có cấu trúc nhiều tầng và thường chứa điều kiện, ngoại lệ hoặc tham chiếu chéo.
Tìm kiếm từ khóa thuần túy có thể bỏ sót cách diễn đạt tự nhiên; trong khi LLM thuần túy có nguy cơ
suy diễn, trộn kiến thức ngoài phạm vi hoặc đưa ra citation không tồn tại.

### 3.2. Cách tiếp cận

Dự án kết hợp:

1. Pipeline ingestion xác định để trích xuất và chia văn bản theo cấu trúc pháp lý.
2. Exact search và hybrid retrieval để tìm cả tham chiếu trực tiếp lẫn câu hỏi diễn đạt tự nhiên.
3. Reranker để sắp xếp lại ứng viên theo mức liên quan.
4. Context builder để phục hồi breadcrumb và ngữ cảnh cần thiết.
5. Structured generation để buộc mô hình trả dữ liệu theo schema.
6. Deterministic validator để kiểm tra claim/citation trước khi hiển thị; không gọi thêm
   semantic verifier LLM trong đường chạy MVP nhằm giảm latency và quota.
7. Giao diện chat kèm source viewer để người dùng kiểm chứng nguồn.

## 4. Mục tiêu của giai đoạn MVP/DEMO

### 4.1. Mục tiêu chính

- Trả lời tốt các câu hỏi tiêu biểu trong phạm vi bốn nghị định.
- Mỗi kết luận pháp lý quan trọng có nguồn hợp lệ và mở được tài liệu gốc.
- Hội thoại một lượt và các tình huống tiếp nối cơ bản hoạt động ổn định.
- Thời gian phản hồi phù hợp với buổi trình diễn và mọi timeout đều kết thúc có kiểm soát.
- Có thể chạy demo với Supabase và provider thật; có memory fallback đã thử nghiệm.
- Có bộ câu hỏi đánh giá và kịch bản diễn tập đủ để chứng minh năng lực chính.

### 4.2. Không phải mục tiêu hiện tại

- Bao phủ toàn bộ hệ thống pháp luật Việt Nam.
- Đưa ra tư vấn hoặc cam kết kết quả pháp lý cho trường hợp thực tế.
- Vận hành multi-tenant, multi-region hoặc đạt SLA cấp doanh nghiệp.
- Xây knowledge graph pháp lý hoàn chỉnh.
- Tự động cập nhật mọi phiên bản văn bản pháp luật.
- Tối ưu ingestion/OCR cho kho hàng nghìn tài liệu.

## 5. Phạm vi dữ liệu pháp lý

Corpus hiện tại gồm bốn PDF trong `LUATBHXHBHYT2024/`:

- Nghị định 157/2025/NĐ-CP.
- Nghị định 158/2025/NĐ-CP.
- Nghị định 159/2025/NĐ-CP.
- Nghị định 188/2025/NĐ-CP.

Mỗi tài liệu có manifest trong `ingestion/manifests/`, bao gồm định danh, số hiệu, tiêu đề, ngày ban
hành/hiệu lực, đường dẫn nguồn, phiên bản corpus và SHA-256. Metadata pháp lý không được suy ra từ
metadata kỹ thuật của PDF.

Artifact `data/corpus/task4-consistent/` gần nhất đã được audit với kết quả:

- Trạng thái validation: hợp lệ.
- 649 chunks, gồm 632 chunks nội dung quy phạm và 17 chunks phụ lục.
- Hash của cả bốn PDF khớp manifest.
- Còn warning về quan hệ cấu trúc/tham chiếu chưa resolve; đây không được xem là dữ liệu quan hệ hoàn chỉnh.

`MemoryLegalRepository` chỉ chứa corpus mẫu phục vụ phát triển và test. Bản demo muốn tra cứu đầy đủ
bốn nghị định phải sử dụng corpus đã publish lên Supabase.

## 6. Nguyên tắc sản phẩm

1. **Grounded first:** chỉ khẳng định điều có thể gắn với bằng chứng trong corpus.
2. **Traceable:** người dùng phải truy ngược được claim tới văn bản nguồn.
3. **Fail safely:** thiếu nguồn, lỗi schema hoặc validation thất bại phải dẫn đến trả lời giới hạn,
   yêu cầu làm rõ hoặc lỗi có kiểm soát; không đoán tiếp.
4. **Legal structure aware:** Điều, Khoản, Điểm, Chương, Mục và trang nguồn là dữ liệu hạng nhất.
5. **Provider independent:** business logic không phụ thuộc cứng vào một model hoặc nhà cung cấp.
6. **Privacy by default:** không lưu nội dung hội thoại dài hạn và không ghi toàn văn câu hỏi/câu trả lời vào log.
7. **MVP discipline:** chỉ đầu tư vào phần làm tăng độ đúng, tốc độ, độ ổn định hoặc giá trị trình diễn.

## 7. Kiến trúc tổng thể

```text
4 PDF pháp luật
    ↓
Python ingestion: extract/OCR → parse cấu trúc → chunk → cross-reference → quality gate
    ↓
Corpus artifact + validation report
    ↓
Supabase PostgreSQL: metadata + full-text/trigram + pgvector
    ↓
Next.js RAG service:
query parser → exact/hybrid retrieval → rank fusion → rerank → context builder
→ structured generation → deterministic validation
    ↓
Next.js UI: chat → answer card → citation chip → source viewer/PDF
```

### 7.1. Công nghệ chính

- Next.js và TypeScript cho UI, API route và runtime RAG.
- Python cho pipeline ingestion chạy thủ công, không nằm trên request path.
- Supabase/PostgreSQL với `pgvector`, `pg_trgm` và `unaccent` cho corpus đầy đủ.
- Vitest cho unit/integration test và Playwright cho E2E.
- Tesseract `vie+eng` cho các trang cần OCR cục bộ.
- LLM, embedding và reranker truy cập qua adapter/provider có thể cấu hình.

### 7.2. Các ranh giới chính

- `src/app/`: UI entry và API routes.
- `src/features/chat/`: phiên chat và các component giao diện.
- `src/features/sources/`: citation và source viewer.
- `src/features/legal-rag/`: parsing câu hỏi, retrieval, context, generation và deterministic validation.
- `src/lib/ai/`: provider adapters, contracts, timeout và lỗi AI.
- `src/lib/db/`: repository contract cùng triển khai memory/Supabase.
- `ingestion/legal_ingestion/`: pipeline xử lý PDF và quality gate.
- `supabase/migrations/`: schema và hàm tìm kiếm dữ liệu.
- `tests/`: ingestion, RAG, database, API, UI, evaluation và E2E.

## 8. Luồng ingestion

1. Đọc manifest và kiểm tra file/hash.
2. Kiểm tra text layer theo trang; trang không đủ text được OCR cục bộ.
3. Chuẩn hóa Unicode NFC và khoảng trắng nhưng không thay đổi nội dung pháp lý.
4. Parser xác định nhận diện Nghị định → Chương → Mục → Điều → Khoản → Điểm.
5. Chunk theo đơn vị pháp lý; không gộp tùy ý hai Điều vào một chunk.
6. Tạo `context_header`, `body_text`, page range, deterministic ID và provenance.
7. Phát hiện quan hệ parent/sibling/cross-reference trong giới hạn parser.
8. Chạy validation/quality report; artifact không đạt gate không được dùng để thay corpus đang hoạt động.
9. Tạo embedding và publish atomically vào Supabase khi triển khai corpus thật.

OCR và ingestion là quy trình offline. Hiệu năng của chúng ít ảnh hưởng đến độ trễ chat trong bản demo,
vì vậy tối ưu song song/cache quy mô lớn được để ngoài scope hiện tại.

## 9. Luồng xử lý một câu hỏi

1. API kiểm tra request body, history và rate limit.
2. Query parser chuẩn hóa câu hỏi, nhận diện số hiệu/Điều/Khoản/Điểm và tạo câu hỏi độc lập nếu cần.
3. Exact path lấy trực tiếp tham chiếu rõ ràng.
4. Hybrid retrieval kết hợp full-text, tìm kiếm không dấu, trigram và vector.
5. Reciprocal Rank Fusion hợp nhất kết quả; reranker sắp lại ứng viên.
6. Context builder thêm breadcrumb và quan hệ hợp lệ trong giới hạn context budget.
7. Generator tạo JSON theo answer schema.
8. Validator kiểm tra schema, source ID, citation và các claim nhạy cảm như số, tỷ lệ, thời hạn.
9. Validator deterministic loại claim có source ID giả, citation thiếu hoặc số liệu không có trong
   chunk được dẫn; khi thiếu căn cứ hệ thống hạ mức độ hoặc dùng safe fallback.
10. Backend chỉ trả output cuối sau bước kiểm tra căn cứ; UI hiển thị câu trả lời, citation/trang
   PDF và cảnh báo người dùng đối chiếu nguồn gốc.

Các fallback dự kiến:

- Reranker lỗi: dùng thứ hạng rank fusion.
- Embedding query lỗi: dùng exact/keyword nếu bằng chứng đủ mạnh.
- Không có nguồn đủ mạnh: yêu cầu làm rõ hoặc trả ngoài phạm vi.
- Output sai schema: parse/validate cục bộ một lần; nếu vẫn không hợp lệ thì fail an toàn.
- Provider timeout: kết thúc request với lỗi có thể thử lại, không retry vô hạn.

## 10. Mô hình câu trả lời

Các trạng thái phạm vi:

- `grounded`: có đủ căn cứ trong corpus.
- `partial`: corpus chỉ hỗ trợ một phần.
- `needs_clarification`: cần thêm dữ kiện để kết luận.
- `out_of_scope`: ngoài phạm vi bốn nghị định hoặc không có nguồn phù hợp.

Output chính gồm:

- `short_answer`: kết luận ngắn để đọc trước.
- `analysis`: danh sách claim và source ID tương ứng.
- `ai_supplement`: giải thích bổ sung, luôn tách khỏi nội dung đã được corpus hỗ trợ.
- `missing_information`: dữ kiện còn thiếu.
- `follow_up_question`: câu hỏi làm rõ khi cần.
- `sources`: dữ liệu phục vụ citation và source viewer.

AI supplement không được dùng để khẳng định mức hưởng, điều kiện, thời hạn hoặc kết quả pháp lý khi
corpus không hỗ trợ.

## 11. Dữ liệu và repository

Repository contract giúp business logic chạy với hai backend:

- **Memory:** nhanh, deterministic, không cần credential; phù hợp unit test và fallback giới hạn.
- **Supabase:** backend dùng cho bản demo đầy đủ, hỗ trợ metadata, hybrid search và vector search.

Các bảng chính theo migration:

- `legal_documents`
- `legal_nodes`
- `legal_chunks`
- `legal_cross_references`
- `ingestion_runs`

Ứng dụng không tạo tài khoản người dùng và không lưu conversations/messages trong database. Phiên chat
chỉ được giữ trong `sessionStorage` của tab hiện tại.

## 12. API và trải nghiệm người dùng

### 12.1. API

- `POST /api/chat`: nhận câu hỏi và history giới hạn; trả structured answer sau deterministic validation.
- `GET /api/documents`: trả danh sách tài liệu thuộc corpus.
- `GET /api/sources/:id`: trả chunk nguồn, breadcrumb, page range và URL PDF.

### 12.2. UI

- Desktop dùng sidebar, vùng hội thoại và source drawer.
- Mobile chuyển về một cột, menu trượt và source bottom sheet.
- Answer card ưu tiên kết luận ngắn, sau đó phân tích và citation inline.
- Trạng thái loading/error phải có chữ, focus rõ và không phụ thuộc riêng vào màu hoặc spinner.
- Citation không hiển thị similarity score; người dùng quan tâm căn cứ, không phải chi tiết ranking nội bộ.

## 13. Provider và cấu hình

Ba vai trò provider được tách biệt:

| Vai trò | Nhóm biến môi trường | Mục đích |
| --- | --- | --- |
| Generation | `LLM_*` | Tạo structured answer; claim/citation được kiểm tra bằng code. |
| Embedding | `EMBEDDING_*` | Biểu diễn câu hỏi/chunk cho vector retrieval. |
| Reranking | `RERANKER_*` | Sắp xếp lại ứng viên sau retrieval. |

Model slug và endpoint là cấu hình triển khai, không phải business rule. Việc đổi model phải được đánh
giá lại trên cùng gold set tiếng Việt trước khi dùng trong demo.

`LEGAL_REPOSITORY=memory` dành cho phát triển/test; `LEGAL_REPOSITORY=supabase` là hướng chính cho demo
đầy đủ. Secret chỉ tồn tại server-side và không được đưa vào client bundle hoặc commit vào repository.

## 14. Bảo mật, riêng tư và độ tin cậy

- Endpoint source/PDF chỉ phục vụ allowlist của corpus, không tải URL tùy ý do người dùng cung cấp.
- Giới hạn kích thước request, số lượt history, context và output.
- Rate limit dùng định danh IP đã hash ngắn hạn, không lưu IP thô.
- Không log câu hỏi, câu trả lời hoặc toàn văn nguồn.
- Nội dung PDF và câu hỏi đều được xem là dữ liệu, không phải system instruction.
- Mọi retry/regeneration loop phải có giới hạn xác định.
- Corpus mới chỉ active sau khi ingestion hoàn tất; lỗi giữa chừng không được làm hỏng corpus đang dùng.
- Citation ID phải tồn tại và phải thuộc context đã cấp cho model.

## 15. Chiến lược kiểm thử

Các lớp kiểm thử hiện có bao gồm:

- Python unit test cho extract, OCR, parser, chunking, quality và validation.
- TypeScript unit/integration test cho provider, repository, retrieval, rank fusion, context và answer safety.
- API test cho chat, documents và source route.
- Component/hook test cho giao diện chat và source viewer.
- Evaluation bằng gold set.
- Playwright E2E cho desktop, mobile và accessibility cơ bản.

Trước khi đóng băng bản dự thi cần chạy đầy đủ ingestion tests, `npm run verify`, evaluation và E2E.
Smoke test với provider thật được chạy riêng khi có credential; test thường xuyên nên deterministic và
không phụ thuộc mạng.

## 16. Trạng thái hiện tại và thế mạnh đã có

Tại thời điểm cập nhật tài liệu này, dự án đã có:

- Ứng dụng Next.js responsive với chat, answer card, citation và source viewer.
- Pipeline ingestion Python có manifest, OCR fallback, parser cấu trúc, chunking và validation.
- Repository abstraction với memory và Supabase implementations.
- Exact/hybrid retrieval, rank fusion, reranker, context builder và provider adapters.
- Structured answer schema và deterministic grounding validator.
- Migration Supabase cho corpus pháp lý và tìm kiếm.
- Hệ thống test trải rộng từ ingestion tới E2E.
- Bộ bốn PDF có hash khớp manifest và một artifact corpus đã vượt validation gate.

Các thế mạnh đáng trình diễn:

- Trả lời dựa trên một phạm vi pháp lý rõ ràng thay vì knowledge mở không kiểm soát.
- Citation cấp đơn vị pháp lý, có thể lần về nguyên văn và trang nguồn.
- Có fallback giữa exact, keyword, vector và rerank thay vì phụ thuộc duy nhất một kỹ thuật.
- Có bước kiểm tra deterministic sau generation và khả năng từ chối khi thiếu căn cứ.
- Provider và repository có thể thay đổi mà không viết lại business logic.

## 17. Khoảng trống đã biết trước bản demo

Audit hiện tại xác định một số việc cần ưu tiên:

- `short_answer` cần được kiểm chứng đầy đủ như các claim trong `analysis`.
- Đường dẫn mở PDF/citation cần được kiểm tra trên môi trường deploy, không chỉ máy local.
- Cấu hình Supabase/provider và quy trình fallback cần fail rõ ràng, dễ diễn tập.
- Câu hỏi đã được viết lại độc lập cần được dùng nhất quán cho retrieval và generation.
- Timeout và retry giữa SDK/lớp bao ngoài cần được giới hạn để tránh độ trễ cộng dồn.
- Dữ liệu parent/cross-reference chưa hoàn chỉnh; context builder chỉ nên dùng quan hệ đã resolve.
- Cần ngưỡng bằng chứng để không ép model trả lời khi top-N yếu.
- Gold set hiện còn nhỏ so với phạm vi tình huống cần trình diễn.

### Cập nhật kiểm chứng ngày 2026-09-15

Các khoảng trống trong mã nguồn đã được xử lý và có regression coverage: `short_answer` đi qua cùng
deterministic grounding validator với các claim trong `analysis`; citation/PDF dùng route allowlist cố định; câu hỏi tiếp nối dùng cùng standalone
question cho retrieval và generation; request có deadline tổng, một tầng transport retry và stage
telemetry không chứa nội dung nhạy cảm; exact reference bỏ qua embedding/reranker; vector-only evidence
không được phép kích hoạt generation; relation expansion lọc theo document/corpus version; evaluator có
required clarification và gold set 27 case, gồm case partial; UI dùng một trạng thái processing, cancel
và retry.

### Cập nhật kiểm chứng ngày 2026-09-16

Runtime smoke qua Next server thật đã xác nhận source API và PDF route trả đúng loại response sau clean
build/restart. UI đã dùng asset cục bộ có provenance cho Quốc huy và logo BHXH, hợp nhất Answer Card,
thêm ngân sách độ dài theo scope, fallback đầy đủ cho partial/clarification/out-of-scope và progress
microcopy luân phiên 4 giây. Regression suite, build, typecheck, lint và Playwright đa viewport có
evidence tương ứng; CLI evaluation đã xử lý export condition `server-only` và nạp `.env` đúng cách.

Credentialed/local browser smoke đã nhận grounded response thật trên memory repository: desktop khoảng
52,7 giây và mobile 390px khoảng 46,2 giây; citation mở được PDF đúng trang 8. Sau khi bỏ lượt verifier,
readiness smoke ngày 2026-09-17 xác nhận generation ready nhưng embedding/reranker vẫn HTTP 403; do đó
semantic retrieval đang ở chế độ keyword fallback và latency còn phụ thuộc provider generation.
Supabase URL/service key đang trống, nên chưa thể xác nhận corpus active trên Supabase hoặc p95 latency
trên mạng thi. Hai lần rehearsal trên đúng máy/mạng dự kiến cũng chưa có. Những cổng này không được suy
ra từ test memory/E2E và phải hoàn thành trước khi đóng Definition of Done.

Live rerun ngày 2026-09-17 sau khi tách cấu hình deterministic/live của Playwright không còn lỗi 405 do
endpoint giả; out-of-scope trả trong 398 ms trên desktop và 456 ms/1,3 giây trên mobile. Grounded route
vẫn có mẫu provider 504 quanh 40,1 giây, nên p95 và cancel khi provider thật vẫn là gate mở.

### Cập nhật kiểm chứng ngày 2026-09-17

Đã loại semantic verifier LLM và mã repair verifier khỏi runtime/dependency graph; grounded response chỉ
dùng một generator call rồi qua validator deterministic đối chiếu source ID, citation, số, ngày, Điều/
Khoản/Điểm, nhóm đối tượng và canonical reference. Claim không đủ căn cứ bị loại hoặc hạ `partial`;
malformed output dùng fallback an toàn. Clarification rõ ràng và out-of-scope hiển nhiên được preflight
không gọi provider. Prompt grounded yêu cầu khoảng 250–450 từ, kết luận 2–4 câu và 3–5 mục phân tích
độc lập; `LLM_MAX_OUTPUT_TOKENS` của demo được nâng lên 1024. Answer Card hiển thị các lớp phân tích bằng
tiêu đề cố định và citation riêng dưới từng mục, không hiển thị supplement chưa kiểm chứng hoặc
chain-of-thought. Retry/cancellation có signal thật, retry 429 tôn trọng `Retry-After`, client có
thông báo riêng cho timeout, rate limit, network/provider unavailable; timeout message không quy lỗi cho
độ dài câu hỏi, retry không tạo bubble trùng, và log provider error có stage timing redacted. Lớp
`answer-depth` bổ sung công thức, cách áp dụng và giới hạn chỉ từ source cho response grounded/partial bị
ngắn; retrieval lọc chunk khác chủ đề trước khi đưa vào generator, vẫn không gọi thêm LLM. Demo dùng
`AI_TIMEOUT_MS=50000` cùng `REQUEST_TIMEOUT_MS=60000` để có thêm headroom cho tail latency mà vẫn có
deadline. Các gate credential, Supabase, p95 live 5+5 và rehearsal vẫn mở theo `TODO-MVP-DEMO.md`; live
citation smoke có mẫu thành công mới nhất sau restart trong 19,976 ms (≈19,98 giây) với một LLM call, short answer 2 câu,
5 mục analysis và một source cho câu hỏi BHYT; một lần thử khác vẫn 504 ở 50,981 ms (≈50,98 giây), nên chưa kết luận p95.

Danh sách chi tiết, mức ưu tiên và tiêu chí hoàn thành nằm trong `TODO-MVP-DEMO.md`.

## 18. Định hướng thực hiện

### P0 — Bắt buộc trước demo

1. Chốt đường chạy Supabase + provider thật và memory fallback.
2. Kiểm chứng câu trả lời cuối cùng.
3. Làm citation/PDF hoạt động end-to-end.
4. Ổn định hội thoại nhiều lượt.
5. Giới hạn độ trễ và retry.
6. Mở rộng evaluation vừa đủ.
7. Diễn tập và đóng băng bản demo.

### P1 — Chỉ làm sau khi P0 đạt

- Ngưỡng bằng chứng cho câu hỏi ngoài phạm vi.
- Xử lý an toàn parent/cross-reference chưa đầy đủ.
- Trạng thái giao diện và khả năng phục hồi sau lỗi.
- Gia cố cấu hình và rate limiter ở mức vừa đủ.

### Deferred

Distributed rate limiting, knowledge graph hoàn chỉnh, pipeline cập nhật nhiều phiên bản, tối ưu OCR
quy mô lớn, multi-provider failover và hạ tầng production không thuộc phạm vi cuộc thi hiện tại.

## 19. Publish và push lên GitHub

Trong tài liệu dự án, **publish corpus** là quy trình nạp và kích hoạt dữ liệu pháp luật trên Supabase;
**publish mã nguồn** là commit và push repository Git lên GitHub. Hai thao tác này có quyền hạn, dữ liệu
và cổng kiểm tra riêng. Yêu cầu thực hiện một thao tác không được hiểu là cho phép thao tác còn lại.

`TODO-PUSH.md` là checklist vận hành cho việc đưa mã nguồn lên GitHub. Mỗi khi nhận yêu cầu push, người
thực hiện phải:

1. Đọc lại `Abstract.md` để nắm phạm vi và trạng thái dự án.
2. Đọc toàn bộ `TODO-PUSH.md` và chạy lại các kiểm tra phù hợp với thay đổi hiện tại.
3. Xác nhận repository, remote, branch, phạm vi commit và cách xác thực với người dùng.
4. Rà soát secret, tệp lớn, `.gitignore`, staged diff và các thay đổi cục bộ không thuộc phạm vi.
5. Chạy kiểm chứng phù hợp và báo rõ bằng chứng, phần chưa kiểm tra hoặc ngoại lệ trước khi push.
6. Chỉ push sau khi các cổng bắt buộc đạt; không tự force-push, viết lại lịch sử hoặc gom toàn bộ dirty
   worktree vào commit.
7. Sau khi push, đối chiếu commit trên remote và báo các thay đổi cục bộ còn lại.
8. Dùng allowlist để chỉ đưa mã nguồn, test, cấu hình chạy, tài liệu vận hành, asset giao diện chính thức
   và đúng bốn PDF pháp luật lên GitHub. Không publish metadata agent, kế hoạch làm việc nội bộ, credential,
   artifact sinh tự động hoặc dữ liệu cục bộ.
9. Khi lịch sử Git cũ chứa email cá nhân hoặc nội dung ngoài allowlist, publish bằng root commit sạch dùng
   địa chỉ GitHub noreply; không đẩy lịch sử cũ lên remote.

Repository GitHub đích là `https://github.com/ThanhBinh-IwtR/BHXH-KHANH-HOA.git`. Credential thật chỉ
được lưu ngoài Git; `.env.example` không được chứa secret. Các thư mục `.agents/`, `.codex/`, `.claude/`,
`.cursor/`, `.superpowers/`, `.tools/` và `docs/superpowers/` là dữ liệu cục bộ hoặc tài liệu agent nội bộ,
không thuộc snapshot publish.

## 20. Quy tắc bắt buộc đối với TODO

`TODO-MVP-DEMO.md` là danh sách công việc cần được theo dõi trong suốt quá trình hoàn thiện bản dự thi.

- Mỗi task phải giữ ô `[ ]` khi chưa hoàn thành hoặc mới hoàn thành một phần.
- Chỉ đổi thành `[x]` sau khi toàn bộ tiêu chí nghiệm thu của task đã đạt.
- Dùng `[-]` khi đã rà soát và xác nhận mục đó chủ động không thuộc scope hoặc không cần cho DoD hiện tại; phải ghi rõ lý do.
- Trước khi tick, phải có bằng chứng phù hợp: test pass, build pass, kiểm tra thủ công hoặc kết quả diễn tập.
- Nếu phạm vi task thay đổi, cập nhật nội dung và tiêu chí trước khi thực hiện; không tick một task có
  tiêu chí đã lỗi thời hoặc chưa được đáp ứng.
- Khi phát hiện lỗi/rủi ro mới ảnh hưởng trực tiếp tới MVP, thêm nó vào đúng nhóm P0 hoặc P1.
- Không tự động kéo task Deferred vào triển khai nếu chưa có quyết định mở rộng scope.
- Khi tick một task lớn, nên ghi ngày hoàn thành và tham chiếu commit hoặc bằng chứng ngay bên dưới task.
- Definition of Done chỉ đạt khi toàn bộ P0 đã được tick hợp lệ và hai lần diễn tập liên tiếp thành công.

Việc đánh dấu checkbox là một xác nhận kỹ thuật, không chỉ là ghi nhận đã dành thời gian xử lý.

## 21. Quy tắc duy trì Abstract

Cập nhật `Abstract.md` khi có một trong các thay đổi sau:

- Mục tiêu, phạm vi hoặc đối tượng người dùng thay đổi.
- Thêm/bớt văn bản pháp luật hoặc đổi corpus active.
- Thay đổi kiến trúc, API contract, answer schema hoặc repository contract.
- Thay đổi nguyên tắc citation, verification, bảo mật hoặc lưu trữ dữ liệu.
- Một khoảng trống quan trọng được giải quyết hoặc xuất hiện rủi ro mới.
- Dự án chuyển khỏi giai đoạn MVP/DEMO.

Không cần dùng Abstract như changelog từng commit. README vẫn phải ngắn và dễ tiếp cận; chi tiết vận hành
tiếp tục nằm trong `docs/operations/`; tiến độ MVP nằm trong `TODO-MVP-DEMO.md`; quy trình kiểm tra và
push mã nguồn nằm trong `TODO-PUSH.md`.

## 22. Thuật ngữ chung

- **Corpus:** tập tài liệu pháp lý mà hệ thống được phép dùng làm căn cứ.
- **Chunk:** đơn vị nội dung pháp lý dùng cho tìm kiếm và citation.
- **Exact path:** truy xuất trực tiếp khi câu hỏi nêu rõ số hiệu, Điều, Khoản hoặc Điểm.
- **Hybrid retrieval:** kết hợp keyword, trigram và vector search.
- **Reranker:** mô hình sắp xếp lại các kết quả retrieval.
- **Grounded claim:** mệnh đề được nguồn trong corpus hỗ trợ.
- **AI supplement:** nội dung giải thích không được xem là căn cứ pháp lý và phải hiển thị tách biệt.
- **Quality gate:** tập điều kiện phải đạt trước khi corpus hoặc bản demo được chấp nhận.
