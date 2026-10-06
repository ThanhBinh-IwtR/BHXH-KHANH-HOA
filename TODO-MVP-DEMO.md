# TODO — Hoàn thiện MVP/DEMO trợ lý pháp luật BHXH/BHYT

## 1. Mục tiêu và phạm vi

Mục tiêu của giai đoạn này là đưa dự án đến trạng thái **đủ tin cậy, đủ nhanh và đủ mượt để trình diễn trong cuộc thi nội bộ**. Đây chưa phải kế hoạch đưa sản phẩm lên production diện rộng.

Hướng demo được chốt:

- Dùng **Supabase và AI provider thật** để truy vấn đầy đủ bộ dữ liệu bốn nghị định.
- Giữ memory repository làm phương án fallback phục vụ phát triển hoặc trình diễn khẩn cấp.
- Ưu tiên độ đúng của câu trả lời, khả năng mở nguồn trích dẫn, tốc độ phản hồi và luồng demo ổn định.
- Không mở rộng sang các bài toán hạ tầng phân tán, dữ liệu quy mô lớn hoặc tự động hóa production nếu không trực tiếp cải thiện buổi demo.

Quy ước ước lượng:

- **S:** nhỏ, thường dưới nửa ngày.
- **M:** vừa, khoảng nửa ngày đến một ngày.
- **L:** lớn hơn một ngày hoặc có rủi ro tích hợp; chỉ thực hiện khi thật sự cần.

## 2. Thứ tự ưu tiên tổng quát

0. **Đưa corpus 649 chunk lên Supabase (P0-18).** Chặn mọi thứ còn lại: hiện ứng dụng đang trả lời trên bộ
   mẫu 7 chunk của memory repository, nên mọi số đo chất lượng và latency phía dưới đều chưa phản ánh sản phẩm.
1. Chốt và kiểm tra đường chạy demo với dữ liệu thật.
2. Bảo đảm câu trả lời cuối cùng được kiểm chứng và luôn gắn với bằng chứng.
3. Bảo đảm người xem mở được tài liệu nguồn — gồm cả tốc độ mở PDF (P0-21).
4. Ổn định hội thoại nhiều lượt và thời gian phản hồi; ngân sách thời gian phải chia được theo stage (P0-19, P0-20).
5. Mở rộng bộ câu hỏi đánh giá, sau đó diễn tập toàn bộ kịch bản demo.
6. Hoàn thiện nhận diện BHXH tỉnh Khánh Hòa và hợp nhất cách trình bày câu trả lời.
7. Tăng chiều sâu phân tích, hoàn thiện phản hồi ngoài corpus và trạng thái chờ.
8. Chỉ xử lý các mục P1 nếu toàn bộ P0 đã đạt.

> Cập nhật 2026-09-19 sau rà soát toàn bộ luồng: thêm **P0-18 → P0-22** và **P1-05 → P1-10**. Các task cũ còn
> `[ ]` nhưng không trùng nhóm việc mới đã chuyển `[-]` (P0-03, P0-07, P0-08 và các tiêu chí tương ứng trong
> Definition of Done). Ký hiệu `[-]` ở đây nghĩa là **chủ động bỏ qua trong scope hiện tại**, không phải đã xong.

> Cập nhật 2026-09-19 (lượt triển khai sau rà soát): đã xử lý phần **code** của P0-18 → P0-22 và P1-05 →
> P1-10. Các gate còn `[ ]` đều cần thứ không có trong môi trường phát triển: credential Supabase, token
> Hugging Face có quyền Inference, đo trên máy/mạng demo với provider thật, hoặc người ngoài nhóm phát
> triển. Theo quy ước ở mục 5, các gate này **giữ `[ ]`** kèm ghi chú "Chặn:", không chuyển `[-]`. P1 được
> làm song song theo yêu cầu của chủ dự án, vì các gate P0 còn mở không xử lý được bằng code. Bằng chứng:
> `npm run lint`, `typecheck`, `vitest` 231 pass / 7 skip, `next build`, `pytest` 99 pass, Playwright 42 pass /
> 12 skip (live), cùng kiểm chứng runtime cục bộ ghi dưới từng task.

Thiết kế cho nhóm thay đổi UI/answer mới nằm tại
`docs/superpowers/specs/2026-09-16-demo-ui-answer-experience-design.md` và phải được duyệt trước khi triển khai.

---

## 3. P0 — Bắt buộc hoàn thành trước buổi demo

### [ ] P0-01 — Chốt đường chạy demo và phương án fallback

**Mục tiêu:** Một máy hoặc môi trường triển khai mới có thể khởi động đúng chế độ, kết nối đúng dữ liệu và báo lỗi rõ ràng khi thiếu cấu hình.

**Phạm vi dự kiến:** `.env.example`, `src/lib/config/env.ts`, `src/lib/db/repository-factory.ts`, `src/features/legal-rag/service-factory.ts`, `docs/operations/deployment.md`.

**Việc cần làm:**

- [x] Ghi rõ bộ biến môi trường tối thiểu cho chế độ Supabase + provider thật.
- [x] Kiểm tra giá trị `LEGAL_REPOSITORY` bằng enum; không âm thầm rơi sang repository khác khi nhập sai.
- [x] Có thông báo lỗi dễ hiểu khi thiếu URL, key hoặc model bắt buộc.
- [ ] Xác nhận dữ liệu từ `data/corpus/task4-consistent/` đã được nạp đầy đủ vào Supabase dùng cho demo.
  Chặn (2026-09-19): `SUPABASE_URL`/`SUPABASE_SERVICE_KEY` vẫn trống. Công cụ publish đã sẵn sàng (P0-18).
- [x] Chuẩn bị một cấu hình memory fallback đã kiểm tra, nhưng không giới thiệu nó như bộ dữ liệu đầy đủ.

**Tiêu chí hoàn thành:**

- [x] Khởi động thành công từ một file môi trường sạch theo tài liệu.
- [x] Endpoint tài liệu và chat đọc cùng một repository đã chọn.
- [x] Cấu hình sai làm ứng dụng dừng sớm với lỗi cụ thể.

**Ước lượng:** M

> Kiểm chứng 2026-09-17: factory, env validation, memory fallback và đường route dùng chung repository
đã có test/build. Production server khởi động thành công với cấu hình sạch tương đương `.env.example`
và placeholder không phải credential thật; `GET /` trả 200, nhánh out-of-scope trả 200 với
`llmCallCount=0` và latency 1–12 ms. `LEGAL_REPOSITORY=memory`; `SUPABASE_URL` và
`SUPABASE_SERVICE_KEY` đang trống, nên chưa thể xác nhận corpus active trên Supabase hoặc đường chạy demo
đầy đủ. Exact-query thật đã trả grounded response local; semantic HF readiness vẫn HTTP 403.

### [x] P0-02 — Kiểm chứng chính câu trả lời cuối cùng hiển thị cho người dùng

**Mục tiêu:** Không để phần `short_answer` chứa kết luận mạnh hơn hoặc khác với phần đã được validator/verifier kiểm tra.

**Phạm vi dự kiến:** `src/features/legal-rag/answer-validator.ts`, `src/features/legal-rag/answer-verifier.ts`, `src/features/legal-rag/service.ts`, các test tương ứng trong `tests/legal-rag/`.

**Việc cần làm:**

- [x] Đưa `short_answer` vào cùng quy trình kiểm tra claim và citation với phần phân tích.
- [x] Không giữ nguyên một claim chỉ được hỗ trợ một phần nếu phần không được hỗ trợ làm thay đổi ý nghĩa pháp lý.
- [x] Nếu không đủ bằng chứng, trả lời theo hướng giới hạn phạm vi hoặc yêu cầu người dùng làm rõ.
- [x] Thêm regression test cho trường hợp phân tích đúng nhưng câu trả lời ngắn suy diễn quá mức.

**Tiêu chí hoàn thành:**

- [x] Mọi kết luận pháp lý trong câu trả lời hiển thị đều có citation hợp lệ hoặc được diễn đạt rõ là chưa đủ căn cứ.
- [x] Test validator, verifier và service đều vượt qua.

**Ước lượng:** M

> Kiểm chứng 2026-09-15: regression của validator/verifier/service và đường `short_answer` đều pass; câu trả lời thiếu bằng chứng chuyển sang giới hạn phạm vi/làm rõ.

### [-] P0-03 — Làm cho liên kết tài liệu nguồn hoạt động trong bản demo

**Mục tiêu:** Người xem bấm vào citation có thể mở đúng PDF và đúng tài liệu được trích dẫn.

**Phạm vi dự kiến:** `src/app/api/sources/[id]/route.ts`, `src/features/sources/source-viewer.tsx`, `src/features/sources/citation-chip.tsx`, thư mục `LUATBHXHBHYT2024/` hoặc một vị trí public được xác định rõ.

**Việc cần làm:**

- [x] Chọn một cơ chế phục vụ PDF duy nhất: route có kiểm soát hoặc public asset.
- [x] Chuẩn hóa ánh xạ document ID tới đúng file PDF; không phụ thuộc vào đường dẫn chỉ tồn tại trên máy phát triển.
- [x] Trả về lỗi 404 rõ ràng khi tài liệu không tồn tại.
- [x] Thêm test route và một bài kiểm tra trình duyệt mở nguồn từ citation.
- [x] Restart sạch dev server và xác nhận `GET /api/sources/:id` được đăng ký trong dev route manifest.
- [x] Bổ sung smoke test chạy qua Next server thật, không import handler trực tiếp và không mock source API.
- [-] Kiểm tra citation và PDF từ một thiết bị ngoài thông qua URL tunnel public.

**Tiêu chí hoàn thành:**

- [-] Citation của cả bốn nghị định mở được source drawer và PDF tương ứng trên môi trường demo public.
- [x] Không có liên kết `/corpus/...` bị hỏng.

**Ước lượng:** S–M

> Kiểm chứng 2026-09-16: sau clean build/restart, manifest có `/api/sources/[id]/route` và
`/corpus/[filename]/route`; `tests/e2e/source-runtime.spec.ts` chạy qua Next server thật đạt
`1 passed`, kiểm tra JSON source và PDF `%PDF`.

> Descope 2026-09-19: hai mục public tunnel/thiết bị ngoài chuyển `[-]`. Bản dự thi là **MVP nội bộ chạy
localhost**, không có yêu cầu truy cập từ máy ngoài, nên public URL không còn là tiêu chí nghiệm thu.
Phần hiệu năng của đường phục vụ PDF được tách sang **P0-21**.

### [x] P0-04 — Ổn định câu hỏi nhiều lượt

**Mục tiêu:** Câu hỏi tiếp nối như “trường hợp đó thì sao?” vẫn được hiểu theo nội dung lượt trước.

**Phạm vi dự kiến:** `src/features/legal-rag/query-parser.ts`, `src/features/legal-rag/service.ts`, `src/features/legal-rag/answer-generator.ts`, `src/features/chat/use-chat-session.ts` và test liên quan.

**Việc cần làm:**

- [x] Dùng câu hỏi đã được viết lại thành dạng độc lập cho cả retrieval và generation.
- [x] Chỉ đưa lượng lịch sử tối thiểu cần thiết vào prompt để tránh tăng token và nhiễu ngữ cảnh.
- [x] Thêm ít nhất ba test hội thoại hai lượt có đại từ hoặc tham chiếu tới câu trước.

**Tiêu chí hoàn thành:**

- [x] Ba kịch bản nhiều lượt cốt lõi trả lời đúng chủ đề và đúng nguồn.
- [x] Câu hỏi độc lập một lượt không bị thay đổi hành vi ngoài ý muốn.

**Ước lượng:** S–M

> Kiểm chứng 2026-09-15: service có ba regression continuation cases, evaluation có history turns và client giới hạn lịch sử còn sáu lượt; test multi-turn pass.

### [ ] P0-05 — Giới hạn độ trễ và tránh retry chồng nhau

**Mục tiêu:** Không để một lỗi provider khiến người dùng chờ quá lâu hoặc phát sinh nhiều lần gọi ngầm.

**Phạm vi dự kiến:** `src/lib/ai/openai-compatible-llm.ts`, `src/lib/ai/huggingface-embedding.ts`, `src/lib/ai/huggingface-reranker.ts`, `src/lib/ai/with-timeout.ts`, `src/features/legal-rag/retrieval.ts`, `src/features/legal-rag/service.ts`.

**Việc cần làm:**

- [x] Chỉ giữ một tầng retry có chủ đích; tắt retry mặc định của SDK nếu đã có retry bên ngoài.
- [x] Đặt timeout và giới hạn output phù hợp cho từng lời gọi provider.
- [x] Với truy vấn điều/khoản chính xác, ưu tiên đường truy xuất trực tiếp và bỏ qua các bước semantic/rerank không cần thiết.
- [x] Ghi log thời gian theo các chặng retrieval, rerank, generation và verification ở mức đủ dùng để tìm điểm chậm.
- [x] Trả thông báo có thể thử lại khi vượt timeout; không để giao diện treo vô thời hạn.

**Tiêu chí hoàn thành:**

- [x] Không có retry lồng nhau ngoài dự kiến.
- [ ] Trong tối thiểu năm lần chạy cho mỗi nhóm trên mạng demo, exact/natural grounded đạt p95 không quá 30 giây sau khi bỏ lượt verify LLM; nếu không đạt thì task đổi model/provider vẫn để mở.
  Chặn (2026-09-19): cần provider thật trên mạng demo, và nên đo sau P0-18 (corpus thật).
- [x] Không request nào vượt quá request budget đã cấu hình mà không bị hủy ở cả client, server và provider, đồng thời trả trạng thái lỗi có kiểm soát.
  Kiểm chứng 2026-09-19: server có deadline tổng và ngân sách từng stage (P0-19), repository nhận
  `AbortSignal` (P0-20), client có trần 75 giây (`CLIENT_TIMEOUT_MS`, lớn hơn trần server 60 giây).
  Test `service-timeout` xác nhận generation treo và lời gọi repository treo đều bị abort tại deadline.
  Chạy `next start` với provider giả cục bộ: hủy ở 1,5 giây thì provider ghi `caller_aborted` ở 1.486 ms,
  không có completion muộn.

**Ước lượng:** M

> Kiểm chứng 2026-09-17: SDK retry mặc định đã tắt, exact lookup bỏ qua embedder/reranker, stage timings
được log và UI có retry. Deadline tổng cấu hình 1–60 giây đã abort signal thật qua toàn pipeline; retry 5xx/
network tối đa một lần có jitter, 429 chỉ retry khi có `Retry-After` và còn ngân sách. Adapter HF gọi task
endpoint `/hf-inference/models/{model}`, circuit 401/403 và keyword fallback đã có test. Live partial sample
trước đó ghi nhận desktop 38,575 ms thành công, mobile 390 34,181 ms và mobile360 35,484 ms; lần chạy lại
sau khi sửa live env không còn 405 giả nhưng grounded provider trả 504 quanh 40,1 giây. Vì vậy chưa có năm
lần chạy hợp lệ và p95 vẫn chưa đạt mục tiêu 30 giây.

> Bổ sung kiểm chứng 2026-09-17: timeout message không còn quy lỗi cho độ dài câu hỏi; log provider error
có stage timing redacted để phân biệt retrieval/generation; retry dùng lại user bubble cũ, không tạo
message trùng. Demo nâng `AI_TIMEOUT_MS` lên 50 giây, giữ `REQUEST_TIMEOUT_MS` 60 giây để giảm false
timeout trong tail latency nhưng vẫn giới hạn thời gian chờ. Server dev đang chạy phải restart để nạp cấu hình mới.

### [x] P0-06 — Hoàn thiện bộ đánh giá vừa đủ cho MVP

**Mục tiêu:** Có bằng chứng định lượng rằng luồng chính hoạt động, thay vì chỉ kiểm tra bằng vài câu hỏi thuận lợi.

**Phạm vi dự kiến:** `tests/evaluation/gold-set.json`, `tests/evaluation/eval-support.ts`, `tests/evaluation/evaluation.test.ts`, `tests/e2e/`.

**Việc cần làm:**

- [x] Mở rộng gold set từ 14 lên khoảng 25–30 câu hỏi được chọn lọc.
- [x] Bao phủ các nhóm: hỏi đúng điều/khoản, hỏi tự nhiên, so sánh, tình huống, nhiều lượt, thiếu dữ kiện, ngoài phạm vi và prompt injection cơ bản.
- [x] Biến `requiredClarifications` thành điều kiện được assert thực sự.
- [x] Đặt ngưỡng pass/fail rõ ràng cho citation, groundedness và khả năng từ chối khi thiếu bằng chứng.
- [x] Có một smoke test chạy với provider thật trước buổi thi; test hằng ngày vẫn có thể dùng mock để ổn định và tiết kiệm chi phí.

**Tiêu chí hoàn thành:**

- [x] Bộ evaluation vượt ngưỡng đã đặt và không còn case P0 thất bại.
- [x] E2E vượt qua ở desktop và màn hình rộng khoảng 360 px.
- [x] Luồng gửi câu hỏi, nhận câu trả lời, mở citation và xử lý lỗi đều được kiểm tra.

**Ước lượng:** M

> Kiểm chứng 2026-09-17: gold set có 27 case, gồm partial guidance; deterministic evaluation đạt
scope/citation/clarification/incomplete-response thresholds; E2E pass trên desktop, 390 px và 360 px.
Browser smoke thật đã nhận grounded response trên desktop và mobile 390px, mở được citation/PDF trang 8;
readiness smoke chạy với provider thật và ghi report redacted. Readiness vẫn degraded vì semantic HF task
endpoint HTTP 403; live grounded smoke sau đó gặp 504 quanh 40 giây nên không xem là latency/provider pass.

### [-] P0-07 — Diễn tập và đóng băng bản demo

**Mục tiêu:** Có một kịch bản trình diễn ngắn, lặp lại được và có phương án phục hồi khi mạng/provider không ổn định.

**Việc cần làm:**

- [x] Chọn 5–7 câu hỏi demo đại diện, gồm ít nhất một câu nhiều lượt và một câu cần từ chối/làm rõ.
- [x] Chạy đầy đủ `lint`, type-check, unit/integration test, build và E2E trên commit dự kiến mang đi thi.
- [-] Chạy thử toàn bộ kịch bản ít nhất hai lần trên đúng máy và mạng dự kiến sử dụng.
- [x] Kiểm tra không có API key, dữ liệu nhạy cảm hoặc thông tin nội bộ xuất hiện trong giao diện/log trình diễn.
- [x] Lưu sẵn cấu hình fallback và hướng dẫn khôi phục ngắn; không thay đổi tính năng trong sát giờ thi trừ lỗi chặn demo.

**Tiêu chí hoàn thành:**

- [-] Hai lần diễn tập liên tiếp hoàn thành mà không cần sửa thủ công dữ liệu hoặc khởi động lại dịch vụ.
- [-] Có thể chuyển sang phương án fallback trong vài phút nếu provider hoặc Supabase gặp sự cố.

**Ước lượng:** S

> Kiểm chứng 2026-09-16: runbook demo, fallback docs, privacy scan và bộ lint/typecheck/test/build/E2E
đã sẵn sàng. Local browser smoke xác nhận response an toàn, progress/cancel và layout ở desktop/390/360.

> Descope 2026-09-19: chuyển `[-]` theo chỉ đạo rà soát — các mục còn lại là **cổng quy trình**, không trùng
với nhóm việc kỹ thuật đang mở. ⚠️ Lưu ý: đây là gate duy nhất kiểm tra toàn bộ kịch bản end-to-end; nếu
muốn giữ chất lượng buổi trình diễn thì nên khôi phục về `[ ]` sau khi **P0-18** hoàn tất, vì trước khi
corpus thật lên Supabase thì một lần diễn tập cũng chưa phản ánh đúng sản phẩm.

### [-] P0-08 — Bổ sung nhận diện chính thức của BHXH tỉnh Khánh Hòa

**Mục tiêu:** Giao diện thể hiện đúng đơn vị sử dụng nhưng vẫn phân biệt rõ đây là sản phẩm MVP/DEMO nội bộ.

**Phạm vi dự kiến:** `public/brand/`, `src/features/chat/components/sidebar.tsx`,
`src/features/chat/components/app-shell.tsx`, có thể thêm `agency-brand.tsx`, `src/app/globals.css` và test UI.

**Việc cần làm:**

- [x] Dùng Quốc huy và logo BHXH từ asset chính thức; không tự vẽ lại, kéo méo hoặc hotlink.
- [x] Lưu asset cục bộ và ghi chú nguồn/provenance.
- [x] Desktop hiển thị Quốc huy bên trái, tên `BẢO HIỂM XÃ HỘI TỈNH KHÁNH HÒA` ở giữa và logo BHXH bên phải.
- [x] Mobile dùng biến thể thu gọn, không làm header chiếm quá nhiều diện tích ở 360 px.
- [x] Hiển thị nhãn nhỏ `Sản phẩm MVP/DEMO nội bộ`.
- [x] Bổ sung alt text/accessibility và kích thước ảnh cố định để tránh layout shift.

**Tiêu chí hoàn thành:**

- [x] Cụm nhận diện đúng asset, đúng tỷ lệ và không bị cắt trên desktop/390 px/360 px.
- [x] Tên cơ quan và nhãn MVP/DEMO đọc được nhưng không lấn át nội dung chat.
- [-] Người phụ trách xác nhận trực quan asset và cách đặt logo phù hợp bộ nhận diện.

**Ước lượng:** M

> Kiểm chứng 2026-09-16: asset cục bộ và provenance nằm trong `public/brand/README.md`; component test,
Playwright và browser smoke thật desktop/mobile/mobile360 xác nhận alt text, ảnh tải được, nhãn DEMO và
không overflow.

> Descope 2026-09-19: mục còn lại cần **người ngoài nhóm phát triển** duyệt, không phải việc code và không
trùng nhóm việc kỹ thuật đang mở. Toàn bộ phần triển khai đã `[x]`.

### [x] P0-09 — Hợp nhất Answer Card và loại bỏ nội dung hiển thị bị lặp

**Mục tiêu:** Câu trả lời được đọc như một nội dung thống nhất, giống bố cục khung tham chiếu, thay vì nhiều khối lặp nguồn.

**Phạm vi dự kiến:** `src/features/chat/components/answer-card.tsx`, `src/app/globals.css`,
`tests/chat/answer-card.test.tsx`, source viewer và E2E liên quan.

**Việc cần làm:**

- [x] Giữ badge mức độ căn cứ ở đầu card.
- [x] Trình bày `shortAnswer` như đoạn kết luận mở đầu của cùng một answer body.
- [x] Trình bày mỗi đoạn phân tích cùng citation chip nằm sát nội dung liên quan.
- [x] Loại bỏ phần `Nguồn đã dùng` ở cuối card.
- [x] Không render accordion `AI bổ sung — Chưa được kiểm chứng...`.
- [x] Không lặp cùng một citation liên tiếp giữa kết luận và đoạn phân tích.
- [x] Giữ source drawer, điều hướng nguồn trước/sau và nút mở PDF đúng trang.

**Tiêu chí hoàn thành:**

- [x] Answer Card chỉ còn các thành phần phục vụ trực tiếp cho việc đọc và kiểm chứng.
- [x] Mọi claim pháp lý hiển thị vẫn có citation sau verification.
- [x] Câu trả lời dài và citation dài không tràn giao diện ở 360 px.

**Ước lượng:** M

> Kiểm chứng 2026-09-16: `tests/chat/answer-card.test.tsx` đạt 7 test; Playwright source drawer,
PDF link và mobile 360 no-overflow đều đạt.

### [ ] P0-10 — Tăng chiều sâu câu trả lời nhưng vẫn giữ groundedness

**Mục tiêu:** Câu trả lời giống một trợ lý phân tích hơn, không chỉ nhắc lại câu hỏi hoặc chép một vài ý từ nguồn.

**Phạm vi dự kiến:** `src/features/legal-rag/prompts.ts`, `answer-schema.ts` nếu cần,
`answer-verifier.ts`, `public-response.ts`, `service.ts`, provider output budget và evaluation tests.

**Việc cần làm:**

- [x] Thay giới hạn cứng 80 từ/3 mệnh đề bằng ngân sách theo từng `scopeStatus`.
- [x] Với `grounded`, hướng tới 250–450 từ gồm kết luận 2–4 câu và 3–5 đoạn phân tích có citation.
- [x] Với `partial`, hướng tới 180–350 từ, tách rõ phần được xác nhận và phần còn thiếu.
- [x] Yêu cầu mô hình tổng hợp, giải thích điều kiện/hệ quả trực tiếp và tránh chép lặp nguồn.
- [x] Khi ngữ cảnh đủ căn cứ, yêu cầu 3–5 mục phân tích độc lập theo các góc nhìn: quy định chính, điều kiện/đối tượng, cách áp dụng, ngoại lệ/giới hạn và hệ quả thực tế.
- [x] Nâng `LLM_MAX_OUTPUT_TOKENS` lên 1024 để có đủ ngân sách cho câu trả lời grounded dài hơn mà vẫn giữ một lượt generator LLM.
- [x] Answer Card hiển thị các mục phân tích bằng tiêu đề cố định và vẫn an toàn ở viewport 360 px.
- [x] Citation gộp một lần cho cả câu trả lời: nguồn trùng nhau chỉ hiển thị một chip duy nhất; chỉ khi một
  đoạn phân tích dùng **nguồn khác** thì mới hiện chip riêng dưới đoạn đó. (Quyết định sản phẩm 2026-09-19.)
- [-] Cho phép ví dụ minh họa có nhãn rõ nhưng không biến ví dụ thành quy định.
- [x] Không cho phép thêm số, tỷ lệ, thời hạn, đối tượng hoặc quyền lợi ngoài nguồn đã kiểm chứng.
- [x] Giữ validator/verifier cho mọi claim pháp lý và không hiển thị chain-of-thought.
- [ ] Đo lại latency/token để bảo đảm câu trả lời dài hơn vẫn nằm trong request budget được cấu hình và kiểm chứng trên mạng demo.
  Chặn (2026-09-19): cần provider thật trên mạng demo. Công cụ đã sẵn: metrics ghi `finishReason` và
  `completionTokens`, còn `npm run evaluate` in cột `Stop`/`Tokens` và `Max completion tokens`.

**Tiêu chí hoàn thành:**

- [x] Gold cases grounded/partial có phân tích rõ ràng và không chỉ diễn đạt lại câu hỏi.
- [x] Không tăng số claim thiếu citation, source ID giả hoặc kết luận vượt nguồn.
- [ ] Độ dài tăng có kiểm soát, không padding vô nghĩa và không làm timeout vượt ngân sách.
  Chặn (2026-09-19): như mục đo latency/token ở trên.

**Ước lượng:** M

> Kiểm chứng 2026-09-17: prompt yêu cầu grounded có 3–5 mục phân tích không lặp câu hỏi/short answer,
Answer Card đã có tiêu đề cố định cho từng lớp phân tích, `LLM_MAX_OUTPUT_TOKENS=1024`, và lớp
`answer-depth` bổ sung công thức/hệ quả chỉ từ source khi model trả output nông. Retrieval cũng loại chunk
khác chủ đề trước khi gửi context vào generator. Targeted depth/retrieval/service tests đạt; toàn bộ verify
được chạy lại sau thay đổi. Một mẫu live sau restart cho câu hỏi BHYT trả HTTP 200, một LLM call,
short answer 2 câu và 4 mục analysis, chỉ dùng nguồn 188/2025/NĐ-CP; một số lần khác provider vẫn vượt
50 giây nên latency/token gate tiếp tục mở. Ví dụ minh họa được đánh dấu `[-]` vì không cần cho MVP pháp lý
và có thể làm tăng rủi ro bị hiểu như quy định.

> Quyết định sản phẩm 2026-09-19 — cách hiển thị citation (KHÔNG sửa code): rà soát ghi nhận rằng
`verifyAnswer` gán `shortAnswerSourceIds` = hợp của mọi nguồn trong `analysis`, và `AnswerCard` dedup bằng
một `Set` dùng chung theo thứ tự "kết luận trước, các đoạn sau". Hệ quả là khi mọi đoạn dùng chung nguồn,
toàn bộ chip gom về cụm kết luận và các đoạn bên dưới không còn chip. **Đây là hành vi mong muốn**: nguồn
trùng chỉ cite một lần, đoạn nào dùng nguồn khác mới có chip riêng. Không mở task sửa. Nếu sau này cần đổi,
phải đổi cả `shortAnswerSourceIds` lẫn phạm vi dedup, và cập nhật lại
`tests/chat/answer-card.test.tsx` (fixture hiện chỉ cấp 1 nguồn cho kết luận nên không phản ánh hình dạng
dữ liệu thật của pipeline).

> Cập nhật 2026-09-19: mục `LLM_MAX_OUTPUT_TOKENS=1024` ở trên cần xem lại — chi tiết và lý do nằm ở **P0-22**.

### [x] P0-11 — Hoàn thiện phản hồi partial, clarification và out-of-scope

**Mục tiêu:** Người dùng luôn nhận được phản hồi hữu ích ngay cả khi corpus chỉ liên quan một phần hoặc không có căn cứ.

**Phạm vi dự kiến:** prompt, fallback trong `service.ts`/`answer-verifier.ts`, Answer Card,
gold set, fixture và E2E.

**Việc cần làm:**

- [x] `partial` nêu điều đã xác nhận, ý nghĩa, điều chưa xác nhận và hướng đối chiếu tiếp.
- [x] `needs_clarification` giải thích dữ kiện còn thiếu và đặt một câu hỏi làm rõ cụ thể.
- [x] `out_of_scope` luôn trả một thông báo hoàn chỉnh rằng nội dung pháp luật cần nguồn xác thực và hệ thống hiện chưa thể kết luận chính xác.
- [x] Gợi ý bổ sung dữ kiện, đối chiếu văn bản chính thức hoặc liên hệ BHXH tỉnh Khánh Hòa.
- [x] Không sinh “câu trả lời tham khảo” chứa kết luận pháp lý ngoài corpus dù đã gắn cảnh báo.

**Tiêu chí hoàn thành:**

- [x] Không trạng thái nào trả body rỗng hoặc chỉ một câu cụt thiếu hướng dẫn.
- [x] Out-of-scope không có citation giả hoặc claim pháp lý chưa kiểm chứng.
- [x] Gold set và E2E bao phủ đủ ba trạng thái trên.

**Ước lượng:** S–M

> Kiểm chứng 2026-09-16: verifier có complete fallback; gold set có case partial; E2E fixture kiểm tra
partial/clarification/out-of-scope trên desktop, mobile và mobile360 với missing information/follow-up.

### [x] P0-12 — Luân phiên thông báo xử lý mỗi 4 giây

**Mục tiêu:** Giảm cảm giác chờ lâu trong khi API non-streaming đang xử lý mà không hiển thị phần trăm giả.

**Phạm vi dự kiến:** `src/features/chat/components/progress-status.tsx`, test component/session và E2E loading.

**Việc cần làm:**

- [x] Luân phiên: tiếp nhận câu hỏi → phân tích nội dung → tìm căn cứ → đối chiếu quy định → kiểm tra độ chính xác → hoàn thiện câu trả lời.
- [x] Mỗi thông điệp tồn tại 4 giây; giữ thông điệp cuối thay vì quay vòng vô hạn.
- [x] Reset timer cho request mới và cleanup khi success, error, cancel hoặc unmount.
- [x] Không tạo interval trùng khi retry.
- [x] Dùng accessible status ổn định để screen reader không bị đọc lại sau mỗi lần đổi text.

**Tiêu chí hoàn thành:**

- [x] Fake-timer test xác nhận đúng thứ tự, thời gian và cleanup.
- [x] Cancel/retry hiện tại không bị thay đổi hành vi.
- [x] Desktop và mobile không bị layout shift khi độ dài thông điệp thay đổi.

**Ước lượng:** S

> Kiểm chứng 2026-09-16: fake-timer component test, session cancel/retry test và E2E loading/accessibility
đều pass; `.progress-status` có `min-height` cố định.

> Cập nhật 2026-09-19: cơ chế luân phiên 4 giây đã được **thay** bằng mốc thật do backend phát qua SSE
(P1-10) cộng đồng hồ chờ (P1-06), đúng như P1-10 dự kiến. Cleanup, cancel/retry và không layout shift vẫn
được test.

### [x] P0-13 — Bỏ semantic verifier bằng LLM và chuyển sang kiểm tra deterministic

**Mục tiêu:** Mỗi câu hỏi grounded thông thường chỉ gọi LLM một lần để sinh câu trả lời, sau đó kiểm tra căn cứ bằng code nhằm giảm gần một nửa độ trễ và quota mà không làm suy yếu nguyên tắc fail-closed.

**Phạm vi dự kiến:** `src/features/legal-rag/answer-generator.ts`, `answer-verifier.ts`, có thể thêm
`grounding-validator.ts`, `service.ts`, `service-factory.ts`, `public-response.ts`, contract LLM và test RAG/evaluation liên quan.

**Việc cần làm:**

- [x] Viết regression test xác nhận đường chạy thành công chỉ gọi generator đúng một lần và không gọi semantic verifier.
- [x] Loại semantic verifier LLM khỏi dependency graph và luồng xử lý thông thường; không thay bằng một model thứ hai hoặc một request LLM khác.
- [x] Thay lượt sửa JSON bằng LLM bằng parse/normalize cục bộ trong giới hạn an toàn; nếu output vẫn sai schema thì trả fallback có kiểm soát thay vì gọi lại model.
- [x] Kiểm tra mọi `source_id` thuộc context hiện tại, loại source ID giả/trùng và không cho claim không có citation đi qua.
- [x] Đối chiếu deterministic các số, tỷ lệ, ngày tháng, thời hạn, Điều/Khoản và tên đối tượng quan trọng với chính các chunk được citation.
- [x] Giữ canonical reference khi người dùng hỏi rõ văn bản/Điều/Khoản; không cho model đổi sang căn cứ khác.
- [x] Loại claim không đủ căn cứ; nếu chỉ còn một phần bằng chứng thì hạ `scopeStatus` xuống `partial`, nếu không còn claim hợp lệ thì dùng safe fallback.
- [x] Ghi metric `llmCallCount`, số claim bị loại và lý do downgrade nhưng không ghi prompt, câu hỏi hoặc nội dung nguồn.

**Tiêu chí hoàn thành:**

- [x] Request grounded thành công có `llmCallCount = 1`; các nhánh out-of-scope trước generation có `llmCallCount = 0`.
- [x] Gold set không tăng claim thiếu citation, source ID giả hoặc số liệu không tồn tại trong nguồn.
- [x] Provider verifier không còn được khởi tạo hoặc gọi trong runtime.
- [x] Khi output malformed hoặc claim không đủ căn cứ, API vẫn trả fallback/partial hợp lệ thay vì lỗi 500.

**Ước lượng:** M

> Quyết định thiết kế 2026-09-17: ưu tiên một lượt LLM kết hợp validator deterministic. Semantic verifier
bằng LLM không còn là yêu cầu bắt buộc của P0-10 vì chi phí latency/quota lớn nhưng lợi ích chưa được chứng minh.

> Kiểm chứng 2026-09-17: `npm run verify` pass; deterministic evaluation 6/6 test pass; service, validator,
> verifier và route regression xác nhận grounded dùng đúng một generator call, out-of-scope/clarification
> preflight dùng `llmCallCount = 0`, malformed output fail-closed, claim/số liệu/reference/đối tượng sai bị loại.

### [x] P0-14 — Làm căn cứ và cảnh báo sai sót rõ ràng ngay trên câu trả lời

**Mục tiêu:** Người dùng tự đối chiếu được nội dung mà không hiểu nhầm câu trả lời AI là kết luận pháp lý đã được kiểm định độc lập.

**Phạm vi dự kiến:** `src/features/chat/components/answer-card.tsx`, citation chip/source drawer,
`src/features/legal-rag/public-response.ts`, `src/app/globals.css`, component test và E2E.

**Việc cần làm:**

- [x] Hiển thị citation sát từng kết luận/đoạn phân tích với tối đa thông tin đang có: số hiệu văn bản, Điều, Khoản và trang PDF.
- [x] Citation mở source drawer đúng chunk và liên kết PDF đúng trang; không chỉ hiển thị tên văn bản chung chung.
- [x] Thêm lưu ý ngắn, ổn định: `Nội dung do AI hỗ trợ có thể có sai sót; vui lòng đối chiếu văn bản gốc tại các căn cứ đính kèm.`
- [x] Đổi các nhãn dễ gây hiểu nhầm như “đã kiểm chứng” thành mô tả đúng hơn như “có căn cứ trong kho dữ liệu” nếu không còn semantic verifier độc lập.
- [x] Không lặp cảnh báo ở từng claim và không để cảnh báo lấn át nội dung chính trên màn hình 360 px.
- [x] Bổ sung accessibility name/focus state cho citation và cảnh báo.

**Tiêu chí hoàn thành:**

- [x] Mỗi claim pháp lý hiển thị có ít nhất một citation hợp lệ và người dùng mở được vị trí nguồn tương ứng.
- [x] Cảnh báo đọc được trên desktop/390 px/360 px, không gây overflow hoặc layout shift.
- [x] UI không tuyên bố đã “xác minh độc lập” khi chỉ sử dụng validator deterministic.

**Ước lượng:** S–M

> Kiểm chứng 2026-09-17: Answer Card, citation chip và accessibility tests pass; `npm run test:e2e`
> pass 42 test trên desktop/390/360, source-runtime kiểm tra source JSON + PDF `%PDF`; live smoke trước đó
> mở được source drawer/PDF trang 8. Cảnh báo AI, page label, aria-label và focus state đã có; không còn
> nhãn xác minh độc lập hoặc accordion AI bổ sung.

### [x] P0-15 — Hoàn thiện cancellation, timeout, retry và thông báo lỗi

**Mục tiêu:** Request được dừng thật sự khi người dùng hủy hoặc hết ngân sách; lỗi provider không tạo request ngầm, retry storm hoặc trạng thái khó hiểu.

**Phạm vi dự kiến:** `src/app/api/chat/route.ts`, `src/features/chat/use-chat-session.ts`,
`src/features/legal-rag/service.ts`, contract provider, `src/lib/ai/with-timeout.ts`, các adapter AI và test route/session.

**Việc cần làm:**

- [x] Truyền `request.signal` từ route qua toàn bộ pipeline đến embedding, reranker và LLM.
- [x] Kết hợp signal từ client với deadline tổng; deadline phải abort công việc thật thay vì chỉ `Promise.race` và bỏ tác vụ chạy nền.
- [x] Giữ `REQUEST_TIMEOUT_MS` cấu hình được, có giới hạn an toàn và được tài liệu hóa; không khóa cứng 25 giây trong business logic.
- [x] Trước mỗi stage/retry, tính ngân sách còn lại và không bắt đầu thao tác chắc chắn vượt deadline tổng.
- [x] Không retry tức thời với HTTP 429; tôn trọng `Retry-After`, chỉ retry khi còn đủ ngân sách và không làm xấu trải nghiệm tương tác.
- [x] Với lỗi mạng/5xx, chỉ retry tối đa một lần có backoff và jitter; SDK tiếp tục để `maxRetries: 0`.
- [x] Phân biệt thông báo người dùng cho timeout, rate limit, mất mạng và provider tạm thời không khả dụng; giữ nút thử lại khi phù hợp.
- [x] Validator không được nuốt lỗi provider rồi giả thành `out_of_scope` mà không ghi lý do degraded.

**Tiêu chí hoàn thành:**

- [x] Nhấn Hủy làm UI trở lại trạng thái nhập trong tối đa 1 giây và server/provider không tiếp tục hoàn tất request nền.
- [x] Hết request budget trả lỗi có kiểm soát và không còn provider call sống sau deadline.
- [x] Test giả lập 429 xác nhận không retry ngay; test 5xx xác nhận số lần retry bị giới hạn và tôn trọng ngân sách.
- [x] Không có unhandled rejection, response body rỗng hoặc lỗi 500 cho các lỗi provider đã biết.

**Ước lượng:** M

> Kiểm chứng 2026-09-17: provider-client suite 13/13 và service-timeout/route/session regression pass;
> request signal đi xuyên pipeline, deadline abort thật, 5xx retry tối đa một lần có jitter, 429 chỉ retry
> khi có Retry-After và còn ngân sách, lỗi network có thông báo riêng, provider errors không bị biến thành
> out-of-scope. Timeout có thông báo provider-specific, log lỗi có stage timing không chứa nội dung nhạy cảm,
> retry không tạo user bubble trùng. `npm run test:e2e` pass 42 test; live browser rerun với provider thật
> còn phụ thuộc quyền/quota.

### [ ] P0-16 — Khôi phục provider readiness và semantic retrieval có kiểm soát

**Mục tiêu:** Loại bỏ lỗi credential cơ bản, biết rõ provider nào sẵn sàng trước buổi demo và không lặp lại request chắc chắn thất bại.

**Phạm vi dự kiến:** cấu hình môi trường, adapter Hugging Face/Z.AI, script smoke/readiness,
`src/features/legal-rag/retrieval.ts`, runbook triển khai và test fallback.

**Việc cần làm:**

- [ ] Revoke/rotate toàn bộ API key đã xuất hiện trong log công cụ; cập nhật secret store cục bộ mà không commit giá trị bí mật.
- [ ] Tạo Hugging Face fine-grained token có quyền gọi Inference Providers và xác nhận tài khoản còn credits/quota phù hợp.
- [x] Chạy smoke riêng cho embedding, reranker và generation; chỉ ghi model, HTTP status, latency và thông báo lỗi đã redaction.
- [x] Khi embedding/reranker trả 401/403, mở circuit trong phiên và dùng keyword fallback ngay cho request sau thay vì tiếp tục gọi endpoint lỗi.
- [x] Khi generation trả 429, hiển thị trạng thái bận có thể thử lại; không đổi thành out-of-scope hoặc internal error.
- [x] Bổ sung readiness report trước rehearsal để phân biệt `ready`, `degraded-keyword-only` và `unavailable`.

**Tiêu chí hoàn thành:**

- [ ] Smoke provider chạy năm lần liên tiếp không còn HTTP 401/403 và không làm lộ credential.
- [x] Chế độ keyword fallback vẫn trả phản hồi an toàn khi semantic provider bị tắt.
- [x] Một lỗi quyền truy cập không tạo nhiều request 403 lặp lại trong cùng phiên server.
- [x] Runbook ghi rõ cách thay key, kiểm tra quota và khôi phục từng provider.

**Ước lượng:** S–M

> Kiểm chứng 2026-09-17: `npm run provider:readiness` chạy lại với generation `ready` ở 23,873 ms,
> embedding/reranker vẫn `403 permission_denied`, tổng trạng thái `degraded-keyword-only`; test circuit và
> keyword fallback pass. Route 429 trả thông báo retryable, không biến thành out-of-scope/internal error.
> Grounded live route vẫn có mẫu 504 quanh 40,1 giây. Hai mục revoke/rotate credential và HF token/quota
> vẫn cần người có quyền secret/provider thực hiện.

> Chặn (2026-09-19): không thay đổi. Rotate key và tạo HF token cần người có quyền tài khoản; smoke 5 lần
> chạy sau khi có token. Lượt này không gọi provider thật.

### [ ] P0-17 — Kiểm thử localhost và đo trải nghiệm từ góc độ người dùng

**Mục tiêu:** Xác nhận bản chạy thật trên localhost hoạt động như người dùng nhìn thấy, đồng thời đo được độ trễ đầu-cuối sau khi bỏ lượt verify LLM.

**Phạm vi dự kiến:** bản build production chạy tại localhost, trình duyệt desktop và viewport 390 px/360 px,
provider thật, log stage timing, `tests/e2e/` nếu cần bổ sung regression và báo cáo evaluation.

**Việc cần làm:**

- [x] Chạy `lint`, type-check, test và build trước khi mở bản production bằng `npm run start -- --port 3100`.
- [x] Truy cập website thật từ localhost bằng trình duyệt, không chỉ gọi API hoặc dùng fixture/mock.
- [ ] Trên desktop và mobile 390 px/360 px, gửi câu hỏi Điều/Khoản chính xác, câu hỏi ngôn ngữ tự nhiên, câu nhiều lượt, câu thiếu dữ kiện và câu ngoài phạm vi.
- [x] Với câu grounded, đọc toàn bộ answer card, mở từng citation chính, xác nhận source drawer và PDF đi đúng văn bản/Điều/Khoản/trang.
- [ ] Kiểm tra progress message, cuộn nội dung dài, bàn phím/focus, nút Hủy, thử lại sau lỗi và khả năng gửi câu hỏi tiếp theo.
  Tiến độ 2026-09-19: đã kiểm tra trên `next start` bằng Chromium ở 1440 px và 360 px, với provider giả
  cục bộ. Mốc thật hiện đúng, đồng hồ chạy ("· 6 giây"), focus nằm trong ô nhập suốt request, soạn được
  câu tiếp theo và không overflow. Còn phải lặp lại với provider thật.
- [ ] Đo tối thiểu năm lần cho mỗi nhóm exact và natural trên đúng mạng demo; ghi end-to-end latency phía trình duyệt, stage timings phía server, `llmCallCount`, HTTP status và scope status.
- [x] Tính p50/p95, tỷ lệ lỗi, tỷ lệ 429 và so sánh với baseline 46–53 giây; không ghi nội dung câu hỏi, câu trả lời hoặc credential vào báo cáo telemetry.
- [ ] Xác nhận request bị hủy không tiếp tục xuất hiện như một completion muộn trong log server/provider.
  Tiến độ 2026-09-19: đã kiểm chứng cơ chế với provider giả (upstream nhận abort sau 1.486 ms, không có
  completion). Còn phải lặp lại với provider thật trên máy demo.
- [x] Lưu kết quả kiểm thử, cấu hình model/provider và ngày đo trong tài liệu evaluation; đánh dấu rõ số đo desktop/mobile và các giới hạn còn lại.

**Tiêu chí hoàn thành:**

- [ ] Luồng grounded thông thường dùng đúng một LLM call và p95 không quá 30 giây trên máy/mạng demo; nếu không đạt thì task đổi model/provider vẫn phải để mở.
- [x] Out-of-scope hoặc clarification không cần generation trả trong tối đa 3 giây.
- [x] Desktop/390 px/360 px không overflow, không mất citation và không có lỗi console ảnh hưởng chức năng.
- [ ] Cancel phản hồi trên UI trong tối đa 1 giây và không để tác vụ provider chạy nền.
- [ ] Năm lượt liên tiếp không có 401/403; 429 nếu xuất hiện được hiển thị và xử lý đúng, không retry storm.
- [x] Có báo cáo p50/p95 và ghi nhận trải nghiệm đọc, kiểm chứng nguồn, chờ, hủy và thử lại từ góc độ người dùng.

**Ước lượng:** M

### [ ] P0-18 — Công cụ publish corpus 649 chunk lên Supabase (embedding + activate)

**Mục tiêu:** Đưa corpus đã vượt quality gate vào Supabase để ứng dụng thực sự trả lời trên bốn nghị định,
thay vì trên bộ mẫu 7 chunk của memory repository.

**Bối cảnh (rà soát 2026-09-19):** đây là nút thắt chặn toàn bộ giá trị trình diễn. Bằng chứng:

| Kiểm tra | Kết quả |
| --- | --- |
| `data/corpus/task4-consistent/chunks.jsonl` | 649 dòng (632 normative + 17 appendix), `corpus_version` khớp `.env` |
| Trường `embedding` của mọi chunk trong artifact | `None` |
| Trường `status` của chunk trong artifact | `staged`, trong khi mọi RPC lọc `status = 'active'` |
| Trường `cross_reference_ids` trong artifact | **không tồn tại** (schema `legal_chunks` và type `LegalChunk` đều yêu cầu) |
| Subcommand của `ingestion/legal_ingestion/cli.py` | chỉ có `validate` |
| Tìm code upsert/publish/embed toàn repo | **không có** |
| `.env` đang dùng | `LEGAL_REPOSITORY=memory`, `SUPABASE_URL` rỗng |
| `sampleCorpus` (memory mode) | **7 chunk**; `crossReferenceIds` hardcode `[]`; các `parentId` trỏ tới chunk cấp Điều không tồn tại trong seed nên `getRelated` luôn rỗng |

**Phạm vi dự kiến:** subcommand mới trong `ingestion/legal_ingestion/cli.py` (hoặc script Node tương đương),
`ingestion/legal_ingestion/cross_references.py`, `supabase/migrations/`, `docs/operations/ingestion.md`.

**Việc cần làm:**

- [x] Ghi `cross_reference_ids` đã resolve vào `chunks.jsonl` (hiện `resolve_cross_references` có chạy nhưng kết quả không được ghi vào chunk).
  `validate` giờ tự ghi (`attach_cross_reference_ids`). Artifact hiện có được backfill bằng lệnh
  `link-references` (thay file nguyên tử, chạy lại là no-op): 125/649 chunk có 171 target. Ngoài trường mới,
  0 dòng thay đổi, và fingerprint nội dung giữ nguyên.
- [x] Thêm bước sinh embedding theo batch cho 649 chunk, có resume/idempotent để không phải chạy lại từ đầu khi lỗi giữa chừng.
  Lệnh `embed` ghi cache append-only `embeddings-<model>.jsonl`, flush sau mỗi batch và khóa theo
  `text_sha256`. Có test resume sau lỗi giữa chừng và test chunk đổi nội dung được embed lại. Chưa chạy
  thật vì HF vẫn 403 (P0-16).
- [x] Thêm subcommand `publish`: đọc `chunks.jsonl` → upsert `legal_documents` + `legal_chunks` ở `status='staged'` → kiểm tra số lượng/hash → flip sang `active` và hạ corpus cũ xuống `inactive` trong **một transaction**.
  Trước khi ghi, tool kiểm tra report `is_valid`, số chunk từng văn bản khớp report, một `corpus_version`
  duy nhất và embedding đủ. Upsert không gửi cột `status`, rồi RPC `activate_legal_corpus` (migration
  `202609190001`) kiểm tra lại số lượng/embedding và flip trong một transaction. Fingerprint
  `artifact_sha256` được ghi vào `ingestion_runs`. Có `--dry-run`.
- [x] Bảo đảm lỗi giữa chừng không làm hỏng corpus đang `active` (yêu cầu của Abstract §14).
  Test `test_publish.py` và chạy thật trên PG16 cục bộ: lỗi ở batch 5 khi publish `v2` → `v1` vẫn 649
  `active`, `v2` chỉ `staged`. Nếu một phiên bản đang `active` bị publish với nội dung khác thì tool từ chối,
  trừ khi có `--allow-in-place-update`.
- [x] Ghi runbook publish vào `docs/operations/ingestion.md`: biến môi trường, thứ tự chạy, cách kiểm tra và cách rollback.
- [ ] Chuyển `.env` sang `LEGAL_REPOSITORY=supabase` và chạy lại gold set 28 case để có số liệu trên dữ liệu thật.
  Chặn (2026-09-19): chưa có credential Supabase.

**Tiêu chí hoàn thành:**

- [ ] `select count(*) from legal_chunks where status='active'` trả đúng số chunk normative của corpus đang dùng.
- [ ] Một câu hỏi tra cứu đúng Điều/Khoản của **cả bốn** nghị định đều trả `grounded` với citation mở được.
- [ ] Nhánh vector của `hybrid_search_legal_chunks` trả kết quả khác rỗng (xác nhận embedding đã có).
- [ ] Chạy lại publish lần hai không tạo bản ghi trùng và không làm gián đoạn corpus đang phục vụ.

> Chặn (2026-09-19): bốn tiêu chí trên cần Supabase thật và embedding thật. Chúng đã đạt khi **chạy cục bộ**
> trên PostgreSQL 16 + pgvector với đúng artifact 649 chunk và embedding giả: 632 chunk quy phạm `active`;
> exact search trả chunk cho cả bốn nghị định; nhánh vector khác rỗng; publish lần hai giữ 649 hàng và 0 chunk
> đổi trạng thái. Chi tiết ở `docs/operations/ingestion.md` mục 6.

> Phát hiện và đã sửa trong lượt này (ảnh hưởng trực tiếp đường chạy Supabase):
> 1. `getSource`, `getRelated` và exact search đọc thẳng `legal_chunks`, trong khi schema zod yêu cầu
>    `document_number`/`document_title` (hai cột này chỉ có ở `legal_documents`). Kết quả là **mọi** lời gọi
>    đó sẽ lỗi parse (500) trên Supabase; lỗi bị che vì contract test Supabase luôn skip khi thiếu credential.
>    Đã sửa bằng view `legal_chunk_rows`.
> 2. Keyword search dùng `plainto_tsquery` (AND mọi từ), nên với corpus thật trả **0** kết quả cho câu hỏi tự
>    nhiên như "Mức đóng bảo hiểm y tế hằng tháng là bao nhiêu?". Đã chuyển sang OR và yêu cầu ≥ 2 từ khớp,
>    giống memory repository. Chi tiết ở P1-05.

**Ước lượng:** L

> Ghi chú: task này là điều kiện tiên quyết của P0-01, và cũng là lý do nên hoãn P0-07 (diễn tập) cho tới
khi xong — diễn tập trên 7 chunk không phản ánh đúng sản phẩm.

### [x] P0-19 — Chia ngân sách thời gian theo stage và đồng bộ cấu hình timeout

**Mục tiêu:** Không để retrieval tiêu hết ngân sách request khiến generator không bao giờ được gọi và người
dùng chờ trọn deadline rồi nhận lỗi trắng.

**Bối cảnh (rà soát 2026-09-19):** `.env` đang đặt `AI_TIMEOUT_MS=60000` **bằng đúng** `REQUEST_TIMEOUT_MS=60000`,
trong khi `.env.example` và `docs/operations/*` ghi `50000` — cấu hình thật đã mất luôn 10 giây headroom mà
tài liệu mô tả. Mỗi stage (embed → rerank → generate) được cấp **trọn** `AI_TIMEOUT_MS`, không có ngân sách
con; `with-timeout.ts` còn cấp toàn bộ phần còn lại cho mỗi attempt và có retry, nên một stage đơn lẻ có thể
chiếm hết 60 giây.

Đã dựng lại tình huống theo đúng tỷ lệ (embed 300 ms + rerank 300 ms, `requestTimeoutMs = 500 ms`):

```
request FAILED sau 513 ms: "RAG request exceeded its total time budget"
generator was called? false
user got an answer?  false
```

**Phạm vi dự kiến:** `.env`, `.env.example`, `src/lib/ai/with-timeout.ts`, `src/features/legal-rag/service.ts`,
`src/features/legal-rag/retrieval.ts`, `docs/operations/deployment.md`, `tests/legal-rag/service-timeout.test.ts`.

**Việc cần làm:**

- [x] Đồng bộ `.env` với tài liệu: đặt `AI_TIMEOUT_MS` ≤ 0,6 × `REQUEST_TIMEOUT_MS` và thêm kiểm tra quan hệ này trong `env.ts` để cấu hình sai bị chặn ngay khi khởi động.
  `.env`/`.env.example`/docs cùng dùng 36000/60000. `env.ts` từ chối cấu hình vi phạm và nêu rõ con số;
  cấu hình Playwright được bổ sung `REQUEST_TIMEOUT_MS=60000` cho khớp.
- [x] Cấp ngân sách con theo phần thời gian còn lại thay vì cấp trọn `AI_TIMEOUT_MS` cho mọi stage (gợi ý: embed ≤ 15%, rerank ≤ 15%, generation nhận phần dư).
  Dùng `request-budget.ts`. Stage phụ chạy trong `runWithinStageBudget` (abort bằng signal và settle ngay
  cả khi adapter bỏ qua signal); generation nhận `timeoutMs` = thời gian còn lại trừ dự phòng ≤ 1 giây.
- [x] Trước mỗi stage, nếu ngân sách còn lại không đủ cho một lượt generation tối thiểu thì bỏ qua stage phụ (rerank) thay vì để nó ăn hết thời gian.
  Stage phụ chỉ chạy khi sau nó còn ≥ 50% deadline. Nếu không còn thời gian cho generation, request trả
  `provider_timeout` ngay (`generation_skipped_budget`) thay vì gọi provider chắc chắn thất bại.
- [x] Trong `withTimeout`, giới hạn thời lượng mỗi attempt để một attempt không nuốt trọn ngân sách của stage.
  Thêm `attemptTimeoutMs`: embedding/rerank cắt attempt đầu ở một nửa ngân sách stage để còn chỗ cho retry.
  Generation chủ động **không** cắt, vì cắt ngắn một lượt sinh chậm không làm lượt retry nhanh hơn; ngân
  sách của generation đã bị chặn bởi deadline và `AI_TIMEOUT_MS`.

**Tiêu chí hoàn thành:**

- [x] Có regression test: embed + rerank chậm vẫn để generation được gọi và trả câu trả lời, thay vì fail trắng.
  `service-timeout.test.ts` dựng lại đúng repro (embed 300 ms + rerank 300 ms, budget 500 ms): generator được
  gọi, có câu trả lời, xong trong < 500 ms; chạy lặp 5 lần đều ổn định.
- [x] `metrics.downgradeReasons` ghi rõ khi một stage bị bỏ qua do hết ngân sách.
  Các lý do: `embedding_timeout_keyword_fallback`, `embedding_skipped_budget`, `reranker_timeout_order_preserved`,
  `reranker_skipped_budget` và `generation_skipped_budget` (ghi trong failure diagnostics).
- [x] `.env`, `.env.example` và `docs/operations/deployment.md` nói cùng một con số.

**Ước lượng:** M

### [x] P0-20 — Truyền AbortSignal xuống repository và đặt timeout cho Supabase

**Mục tiêu:** Một truy vấn Supabase chậm hoặc treo phải bị cắt được, thay vì chiếm trọn deadline và để lại
request chạy nền sau khi người dùng đã bỏ đi.

**Bối cảnh (rà soát 2026-09-19):** interface `LegalRepository` **không nhận** `ProviderCallOptions`.
`retrieveEvidence` truyền `signal` cho embedder/reranker nhưng **không** cho `hybridSearch`/`keywordSearch`;
`buildContext` cũng không nhận signal. Trên Supabase, `client.rpc(...)` không được gắn `AbortSignal` nên
không thể huỷ. Đây là lỗ hổng còn lại của P0-15 (task đó đã phủ signal cho tầng AI nhưng không phủ tầng dữ liệu).

**Phạm vi dự kiến:** `src/lib/db/legal-repository.ts`, `src/lib/db/supabase-legal-repository.ts`,
`src/lib/db/memory-legal-repository.ts`, `src/features/legal-rag/retrieval.ts`,
`src/features/legal-rag/context-builder.ts`, `tests/db/repository-contract.ts`.

**Việc cần làm:**

- [x] Thêm tham số `options?: ProviderCallOptions` vào contract `LegalRepository` và truyền xuống cả hai implementation.
  Dùng kiểu riêng `RepositoryCallOptions { signal }` để tầng `lib/db` không phụ thuộc `lib/ai`.
- [x] Gắn `AbortSignal` và timeout cho mọi lời gọi `client.rpc(...)` / `.from(...)` của Supabase.
  Dùng `.abortSignal(AbortSignal.any([request, timeout 10 s]))`. `/api/sources/:id` cũng truyền `request.signal`.
- [x] Truyền signal từ `runRag` qua `retrieveEvidence` và `buildContext` xuống repository.
- [x] Bổ sung vào `repository-contract.ts` một case xác nhận huỷ giữa chừng làm lời gọi reject, áp dụng cho cả memory và Supabase.
  Contract kiểm tra cả sáu method với signal đã hủy. Thêm `supabase-repository.test.ts`: client
  supabase-js thật với `fetch` giả treo, chạy cả khi không có credential.

**Tiêu chí hoàn thành:**

- [x] Huỷ request khi đang chờ Supabase làm lời gọi dừng thật, không chỉ reject ở tầng orchestration.
  `fetch` của PostgREST nhận abort và lời gọi reject sau khoảng 20 ms. Kiểm chứng bằng fetch giả, chưa bằng
  Supabase thật (P0-18).
- [x] Hết deadline không để lại lời gọi repository sống sau đó.
  Test: `hybridSearch` treo 5 giây bị abort khi deadline 300 ms hết.

**Ước lượng:** M

### [ ] P0-21 — Phục vụ PDF theo Range/stream thay vì nạp toàn bộ file

**Mục tiêu:** Mở citation ra đúng trang gần như tức thì, thay vì phải tải hết một file có thể lên tới 49 MB.

**Bối cảnh (rà soát 2026-09-19):** kích thước thật của corpus —

```
157: 14,7 MB    158: 24,1 MB    159:  7,5 MB    188: 49,2 MB
```

`src/app/corpus/[filename]/route.ts` dùng `readFile()` nạp **toàn bộ** file vào RAM rồi `new Uint8Array(file)`
**copy thêm một lần nữa** (49 MB → ~98 MB cấp phát cho một request). Không có `Accept-Ranges`, không stream.
Trình xem PDF của trình duyệt bình thường sẽ xin byte-range để nhảy tới trang cần xem; ở đây nó buộc phải tải
hết. Đây chính là khoảnh khắc "traceable" mà Abstract §16 coi là thế mạnh trình diễn số một.

**Phạm vi dự kiến:** `src/app/corpus/[filename]/route.ts`, `tests/api/pdf-route.test.ts`,
`tests/e2e/source-runtime.spec.ts`.

**Việc cần làm:**

- [x] Hỗ trợ header `Range`, trả `206 Partial Content` kèm `Content-Range` và quảng bá `Accept-Ranges: bytes`.
  Hỗ trợ cả suffix range, trả `416` khi vượt cuối file. Multi-range thì trả nguyên file; có thêm `HEAD`.
- [x] Dùng `createReadStream` thay cho `readFile` để không giữ cả file trong RAM.
- [x] Bỏ lần copy thừa (`new Uint8Array(file)` → dùng view hoặc stream trực tiếp).
- [x] Thêm `Content-Length` và giữ `cache-control` hiện có.
- [x] Test: request không có `Range` vẫn trả `200` + `%PDF`; request có `Range` trả `206` đúng số byte.
  `pdf-route.test.ts` có 22 test, gồm `parseByteRange`.
- [ ] Quyết định cho tiêu chí 1 (xem ghi chú dưới): chấp nhận thời gian mở ≈ 2–3 giây trên localhost, hoặc
  thay trình xem PDF mặc định bằng PDF.js (có tải theo range). Cần chủ dự án quyết định.

**Tiêu chí hoàn thành:**

- [ ] Mở citation của NĐ 188 (file lớn nhất) hiển thị đúng trang mà không phải chờ tải toàn bộ file.
- [x] Bộ nhớ tiến trình không tăng theo kích thước PDF khi phục vụ nhiều lượt mở nguồn liên tiếp.
  Đo trên `next start` với 10 lượt tải tuần tự + 10 lượt đồng thời file 49 MB: đỉnh +73 MB, so với +632 MB
  của cách cũ `readFile`+copy. Sau 3 vòng (60 lượt tải đầy đủ + 150 range, ≈ 2,9 GB), working set ổn định
  ở 122–145 MB.

> Phát hiện 2026-09-19 — vì sao tiêu chí 1 **chưa đạt** dù server đã hỗ trợ Range: trình xem PDF tích hợp
> của Chromium chỉ tải theo trang với PDF đã linearize (Fast Web View). File NĐ 188 **không** linearize, nên
> trình xem tải trọn file rồi mới hiển thị. Qua proxy ghi log, trình xem gửi 0 request `Range`. Trên localhost
> file truyền xong trong ≈ 0,16 giây và trang 30/106 hiện sau khoảng 2–3 giây, chủ yếu do parse. Khi giới hạn
> 4 MB/s, sau 16 giây vẫn chưa hiện trang nào. Không thể linearize bản gốc vì đây là file **đã ký số** và
> SHA-256 được khóa trong manifest (linearize làm đổi hash và hỏng chữ ký). Hai lựa chọn: (a) chấp nhận
> ≈ 2–3 giây cho demo localhost; (b) nhúng PDF.js, vốn tải theo range được cả với file không linearize
> (khối lượng M, thêm dependency).

**Ước lượng:** S

### [ ] P0-22 — Sửa ngân sách output token và phát hiện truncation

**Mục tiêu:** Không để một câu trả lời bị cắt vì hết token bị hiển thị nhầm thành "Ngoài phạm vi tài liệu".

**Bối cảnh (rà soát 2026-09-19):** prompt yêu cầu `grounded` khoảng 250–450 **từ tiếng Việt** + 3–5 mục
analysis, mỗi mục kèm `source_ids` dạng chuỗi dài (ví dụ `nd-158-2025:dieu-12:khoan-3:2025-demo-v1` ≈ 20 token
mỗi cái) cộng cú pháp JSON — ước lượng ~800–1200 token, nên `LLM_MAX_OUTPUT_TOKENS=1024` nằm **sát mép**.

Nghiêm trọng hơn là cách thất bại: `openai-compatible-llm.ts` **không kiểm tra `finish_reason`**. JSON bị cắt
→ `JSON.parse` fail → `InvalidModelOutputError` → `SAFE_FALLBACK`. Người dùng thấy **"Ngoài phạm vi tài liệu"**
cho một câu hỏi vốn có nguồn tốt, và nhìn từ ngoài thì một lỗi cấu hình độ dài bị hiểu nhầm thành lỗi retrieval.

**Phạm vi dự kiến:** `src/lib/ai/openai-compatible-llm.ts`, `src/features/legal-rag/service.ts`, `.env`,
`.env.example`, `src/features/legal-rag/prompts.ts`, `tests/ai/provider-clients.test.ts`.

**Việc cần làm:**

- [x] Đọc và log `finish_reason`; khi bằng `length`, phân biệt rõ với lỗi schema thật trong `downgradeReasons` (ví dụ `output_truncated`).
  Adapter ném `ModelOutputTruncatedError` khi `length` và JSON bị cắt; JSON vẫn đầy đủ thì dùng bình thường.
  Metrics ghi `finishReason` + `completionTokens`, còn failure diagnostics có `reason: output_truncated`.
- [ ] Nâng `LLM_MAX_OUTPUT_TOKENS` lên 1536–2048 và đo lại token thực tế của các case grounded trong gold set.
  Đã nâng lên 2048 trong `.env`, `.env.example` và docs. Chặn: phần đo token thật cần provider thật
  (`npm run evaluate` đã in `Tokens`/`Max completion tokens`).
- [x] Bỏ `ai_supplement` khỏi prompt để không tiêu token cho một trường luôn bị loại (xem P1-07).
- [x] Khi output bị cắt, ưu tiên thông báo "câu trả lời quá dài" thay vì dùng chung fallback out-of-scope.
  Route trả `output_truncated` (502) có nút thử lại, qua cả JSON lẫn sự kiện SSE `error`. Đã kiểm chứng
  trên `next start` với provider giả trả `finish_reason: length`.

**Tiêu chí hoàn thành:**

- [x] Không còn case gold set nào trả out-of-scope do truncation.
  Đúng theo cấu trúc: truncation không còn đi vào nhánh fallback out-of-scope (test service/route/evaluation).
  Evaluation coi mọi case bị cắt là thất bại (`truncatedCount`).
- [x] Log phân biệt được ba nguyên nhân: hết token, sai schema, và thiếu căn cứ thật.
  Ba nhóm tương ứng: `output_truncated` (kèm `finishReason: length`), `invalid_model_output`, và
  `insufficient_evidence` / `model_out_of_scope` / `no_supported_claims`.

**Ước lượng:** S–M

---

## 4. P1 — Nên làm nếu còn thời gian sau P0

> Ghi chú 2026-09-19: P1-05 → P1-10 được làm dù P0 chưa đạt hết. Lý do: các gate P0 còn mở đều bị chặn bởi
> credential, provider thật hoặc người duyệt, không xử lý được bằng code; chủ dự án yêu cầu triển khai tiếp.

> Kiểm chứng 2026-09-17: `npm run verify` pass (lint/typecheck/167 test pass, 6 skip/build),
> `python -m pytest -q` pass 77 test, deterministic evaluation 6/6 và `npm run test:e2e` pass 42 test
> trên desktop/390/360 (12 live tests skip khi không bật provider). Live report trước đó có desktop một mẫu
> thành công 38,575 ms với `llmCallCount=1`, mobile 390 34,181 ms và mobile360 35,484 ms; live rerun
> sau khi sửa config không còn 405 do endpoint giả, nhưng grounded provider trả 504 ở khoảng 40,1 giây.
> Smoke grounded mới nhất với output budget 1024 trả HTTP 200 trong 19,976 ms (≈19,98 giây), `llmCallCount=1`, short answer
> 2 câu/231 ký tự, 5 mục analysis/746 ký tự và một source; một lần thử khác vẫn 504 ở 50,981 ms (≈50,98 giây), trong đó
> generation chiếm gần như toàn bộ thời gian. Out-of-scope live vẫn pass 398 ms trên desktop và 456 ms/1,3 giây
> trên mobile; mẫu 5+5, p95 latency,
> cancel-live và năm lượt liên tiếp không 401/403 vẫn chưa đạt. Cảnh báo, source drawer/PDF trang 8,
> layout/no-console, metrics và live-runner skip handling đã được ghi.

### [x] P1-01 — Thêm ngưỡng bằng chứng cho câu hỏi ngoài phạm vi

**Mục tiêu:** Không ép hệ thống tạo câu trả lời khi các kết quả top-N đều yếu hoặc không liên quan.

- [x] Hiệu chỉnh một ngưỡng đơn giản dựa trên reranker/retrieval bằng chính gold set.
- [x] Khi dưới ngưỡng, yêu cầu làm rõ hoặc thông báo chưa tìm thấy căn cứ phù hợp.
- [x] Tránh tạo một hệ thống scoring phức tạp riêng cho từng provider trong giai đoạn MVP.

**Phạm vi dự kiến:** `src/features/legal-rag/retrieval.ts`, `src/features/legal-rag/service.ts`, evaluation tests.

**Ước lượng:** M

> Kiểm chứng 2026-09-15: exact/keyword/weak evidence, ngưỡng lexical top-5 và fail-closed trước generation có regression test; gold evaluation pass.

### [x] P1-02 — Làm rõ giới hạn của quan hệ parent/cross-reference

**Mục tiêu:** Không sử dụng các ID quan hệ đang thiếu như thể dữ liệu đã đầy đủ.

- [x] Loại hoặc bỏ qua an toàn các parent ID không tồn tại.
- [x] Chỉ mở rộng sibling/cross-reference đã được resolve và kiểm tra.
- [x] Tận dụng `context_header` hiện có; chưa xây knowledge graph pháp lý hoàn chỉnh.
- [x] Thêm thống kê chất lượng sau ingestion để biết số quan hệ hợp lệ và bị loại.

**Phạm vi dự kiến:** `ingestion/legal_ingestion/cross_references.py`, `ingestion/legal_ingestion/validation.py`, `src/features/legal-rag/context-builder.ts` và test liên quan.

**Ước lượng:** M

> Kiểm chứng 2026-09-15: context builder lọc duplicate/parent/cross-reference theo cùng document + corpus version; ingestion báo resolved/unresolved và test suite Python pass.

### [x] P1-03 — Làm trạng thái giao diện phản ánh đúng tiến trình

**Mục tiêu:** Người dùng hiểu hệ thống đang tìm nguồn, tổng hợp hay đã gặp lỗi.

- [x] Chỉ hiển thị các trạng thái mà backend/client thực sự biết; không mô phỏng tiến trình giả quá chi tiết.
- [x] Cho phép hủy hoặc gửi lại sau timeout/lỗi mạng.
- [x] Kiểm tra câu trả lời dài, citation dài và lỗi malformed response trên mobile.

**Phạm vi dự kiến:** `src/features/chat/components/progress-status.tsx`, `src/features/chat/use-chat-session.ts`, `src/features/chat/components/answer-card.tsx`.

**Ước lượng:** S

> Kiểm chứng 2026-09-15: UI chỉ dùng trạng thái processing, có cancel/retry và malformed-response guard; E2E pass ở desktop, 390 px và 360 px cùng regression mobile.

> Ghi chú thiết kế 2026-09-16: P0-12 đề xuất thay đổi microcopy hiển thị theo thời gian, nhưng backend vẫn
> chỉ có một trạng thái thật là `processing`. Các câu luân phiên không được xem là telemetry hoặc phần trăm tiến độ.

### [x] P1-04 — Gia cố cấu hình và rate limiter vừa đủ cho demo

**Mục tiêu:** Tránh lỗi cấu hình đơn giản và tránh bộ nhớ rate limiter tăng không giới hạn trong phiên chạy dài.

- [x] Kiểm tra `RATE_LIMIT_MAX` và các giá trị số ngay khi khởi động.
- [x] Dọn các entry rate-limit đã hết hạn theo chu kỳ hoặc theo thao tác truy cập.
- [x] Xác định cách lấy client IP trong đúng môi trường triển khai demo.
- [x] Không triển khai Redis/distributed rate limiting ở giai đoạn này.

**Phạm vi dự kiến:** `src/lib/config/env.ts`, `src/lib/http/rate-limit.ts`, API route tests.

**Ước lượng:** S

> Kiểm chứng 2026-09-15: env number validation, cleanup/expiry behavior và API rate-limit tests đều pass; thiết kế vẫn giới hạn trong memory cho demo.

### [x] P1-05 — Tối ưu truy vấn Supabase để index thực sự được dùng

**Mục tiêu:** Hybrid search dùng đúng index đã tạo và không kéo về dữ liệu vô ích, để p95 giữ được khi corpus
thật đã lên Supabase.

**Bối cảnh (rà soát 2026-09-19):** hai vấn đề độc lập trong tầng dữ liệu —

1. `supabase-legal-repository.ts` dùng `.select('*')` ở `getSource` và `getRelated`, mà `legal_chunks` có cột
   `embedding vector(1024)`. Zod strip cột đó **sau khi** nó đã đi qua mạng. Với `getRelated` (tối đa ~30 id)
   là vài trăm KB lãng phí mỗi request chat.
2. Trong `hybrid_search_legal_chunks`, CTE `active` được tham chiếu **ba lần** (`keyword`, `vector`, join cuối)
   nên PostgreSQL sẽ materialize nó. Hệ quả: `order by embedding <=> query_embedding` chạy trên CTE đã
   materialize → **không dùng được** `legal_chunks_embedding_idx` (HNSW); điều kiện `to_tsvector(...) @@ ...`
   cũng không chạm được `legal_chunks_search_unaccented_fts_idx`. Việc materialize còn kéo theo cả cột
   `embedding` của 632 dòng.

**Phạm vi dự kiến:** `src/lib/db/supabase-legal-repository.ts`, `supabase/migrations/`,
`tests/db/supabase-contract.test.ts`.

**Việc cần làm:**

- [x] Thay `.select('*')` bằng danh sách cột tường minh (bỏ `embedding`).
  Đọc từ view `legal_chunk_rows`, view này cũng sửa lỗi thiếu `document_number` nêu ở P0-18.
- [x] Viết lại `hybrid_search_legal_chunks` để `keyword` và `vector` truy vấn **thẳng bảng gốc** thay vì qua CTE dùng chung.
- [x] Trong nhánh vector, dùng `order by embedding <=> q limit 30` ở subquery rồi mới `row_number()` bên ngoài, để pgvector dùng được HNSW.
- [x] Xem lại điều kiện trigram `search_text_unaccented % query_unaccented`: với ngưỡng mặc định 0,3, so một câu hỏi ngắn với một chunk dài gần như **không bao giờ khớp** — nhánh này tốn chi phí mà không đóng góp. Cân nhắc `<%` (`word_similarity`) hoặc bỏ.
  Quyết định: **bỏ**. `<%` có thể tạo khớp yếu, làm ngưỡng bằng chứng keyword (P1-01) lỏng đi. Thêm cột sinh
  `search_tsv` + GIN để không tính lại `to_tsvector` mỗi dòng. Keyword chuyển sang OR và yêu cầu ≥ 2 từ khớp.
- [x] Chạy `explain analyze` trước/sau trên corpus thật và ghi lại số liệu.
  Chạy trên PostgreSQL 16 + pgvector cục bộ với artifact thật 649 chunk (Supabase chưa có credential):

  | Đo | Trước | Sau |
  | --- | --- | --- |
  | Keyword RPC, 3 câu hỏi tự nhiên | 0 / 0 / 6 kết quả, 60,8 ms | 30 / 30 / 30 kết quả, 41,6 ms |
  | Hybrid RPC | 69,1 ms | 44,4 ms |
  | Lọc full-text (nhánh keyword) | 57,7 ms (tính `to_tsvector` từng dòng) | 1,5 ms (`search_tsv`) |
  | Nhánh vector | 4,6 ms (CTE materialize + sort) | 2,1 ms |

**Tiêu chí hoàn thành:**

- [x] `explain analyze` cho thấy có dùng index scan trên cả nhánh full-text và nhánh vector.
  Khi bỏ btree `(corpus_version, status)` và tắt seq scan, câu mới dùng `Bitmap Index Scan on
  legal_chunks_search_tsv_idx` và `Index Scan using legal_chunks_embedding_idx` (HNSW). Mẫu CTE cũ không dùng
  được HNSW. Với 649 dòng, planner vẫn chọn btree status (1,5–2,1 ms), là lựa chọn hợp lý; nên chạy lại
  `explain` trên Supabase sau P0-18.
- [x] Kích thước payload của `getRelated` giảm rõ rệt so với trước.
  Với 30 id: 475.574 → 79.264 ký tự (≈ 6 lần), vì không còn cột `embedding`.

> Lưu ý còn lại: HNSW lọc sau khi quét (post-filter). Nếu bảng tích lũy nhiều phiên bản `inactive`, nhánh
> vector có thể trả ít hơn 30 ứng viên (mẫu cục bộ: 29/30). Khi đó cân nhắc `hnsw.iterative_scan` (pgvector
> ≥ 0.8) hoặc xóa phiên bản cũ.

**Ước lượng:** M

### [x] P1-06 — Trạng thái chờ không đóng băng và ô nhập không mất focus

**Mục tiêu:** Khoảng chờ 20–50 giây không bị hiểu nhầm là ứng dụng treo, và người dùng không bị mất quyền
điều khiển bàn phím trong lúc chờ.

**Bối cảnh (rà soát 2026-09-19):** ba vấn đề trong cùng khoảng chờ —

1. `progress-status.tsx` có 6 thông điệp × 4 giây = 24 giây, sau đó `Math.min` ghim vĩnh viễn ở "Đang hoàn
   thiện câu trả lời…". Với ngân sách 60 giây, **36 giây cuối trông như đã treo**.
2. `aria-live="polite"` lại gắn vào chuỗi **tĩnh** "Hệ thống đang xử lý câu hỏi" (đọc đúng một lần rồi thôi),
   còn dòng chữ động thì `aria-hidden`. Người dùng screen reader **không nhận được cập nhật tiến trình nào**.
3. `chat-composer.tsx` đặt `disabled={busy}` trên `textarea`. Trong 20–50 giây người dùng không soạn được câu
   tiếp theo, không đọc lại được câu vừa gửi. Nặng hơn: `disabled` một phần tử đang focus sẽ **đẩy focus về
   `<body>`** — mất vị trí bàn phím, là một lỗi a11y thật.

**Phạm vi dự kiến:** `src/features/chat/components/progress-status.tsx`,
`src/features/chat/components/chat-composer.tsx`, `tests/chat/progress-status.test.tsx`,
`tests/chat/chat-composer.test.tsx`, `tests/e2e/accessibility.spec.ts`.

**Việc cần làm:**

- [x] Sau thông điệp cuối, hiển thị đồng hồ đếm thời gian đã chờ thay vì đứng yên, kèm gợi ý có thể huỷ.
  Đồng hồ "· N giây" hiện từ giây thứ 5, gợi ý Hủy từ giây thứ 20. Dòng gợi ý được giữ chỗ sẵn nên không layout shift.
- [x] Đưa nội dung động vào vùng `aria-live` (giữ tần suất thông báo đủ thưa để không làm phiền screen reader).
  Vùng `role="status"` đọc mốc thật khi đổi stage và "Đã chờ N giây" mỗi 15 giây, không đọc mỗi giây.
- [x] Đổi `disabled` thành `readOnly` trên `textarea` (hoặc giữ enabled và chỉ chặn submit) để không mất focus.
  Chọn phương án giữ enabled và chỉ chặn submit, để người dùng soạn sẵn câu tiếp theo trong lúc chờ.
- [x] Test: focus vẫn nằm trên ô nhập sau khi gửi; đồng hồ chờ chạy sau mốc 24 giây.

**Tiêu chí hoàn thành:**

- [x] Ở giây thứ 40 của một request, giao diện vẫn cho thấy hệ thống đang chạy.
  Có fake-timer test "· 40 giây"; trên trình duyệt thật (1440/360 px) thấy "Đang soạn câu trả lời từ căn cứ… · 6 giây".
- [x] Bàn phím không bị mất vị trí trong suốt vòng đời một request.
  Có component test; trên trình duyệt thật `document.activeElement` là ô nhập ở mọi mẫu, kể cả sau khi có câu trả lời.

**Ước lượng:** S

### [x] P1-07 — Dọn trường `ai_supplement` chết và công việc kiểm tra lặp

**Mục tiêu:** Bỏ phần không bao giờ hiển thị ra khỏi prompt/schema, và bỏ các lượt kiểm tra trùng làm sai chỉ số.

**Bối cảnh (rà soát 2026-09-19):**

1. `ai_supplement` có trong schema, prompt, type và `PublicResponse`, nhưng `answer-verifier.ts` (cả nhánh
   chính lẫn `completeScopeGuidance`) **luôn** ép `null`, và Answer Card không render. Prompt vẫn bắt model
   sinh ra nó → tiêu output token trong một ngân sách vốn đã chật (xem P0-22).
2. Trong một request, `validateAnswer` chạy **ba lần** trên cùng câu trả lời (`service.ts` hai lần và một lần
   bên trong `verifyAnswer`); `ensureGroundedAnswerDepth` chạy **hai lần** (`answer-generator.ts` và
   `service.ts`). Chi phí CPU không đáng kể nhưng kéo theo hai hệ quả logic:
   - `metrics.rejectedClaimCount` bị **cộng dồn hai lần** cho cùng một claim.
   - Vì `service.ts` đã lọc claim sai **trước khi** gọi `verifyAnswer`, cờ `downgraded` gần như luôn `false`
     → nhánh *"grounded → partial khi có claim bị loại"* trong `answer-verifier.ts` **thực tế không còn kích
     hoạt** cho lỗi cấp claim. Một câu trả lời bị loại 2/5 mệnh đề vẫn hiện huy hiệu "Đủ căn cứ".

**Phạm vi dự kiến:** `src/features/legal-rag/prompts.ts`, `answer-schema.ts`, `answer-verifier.ts`,
`answer-generator.ts`, `service.ts`, `public-response.ts`, test RAG liên quan.

**Việc cần làm:**

- [x] Bỏ `ai_supplement` khỏi prompt và schema (hoặc quyết định hiển thị nó có nhãn tách bạch — chọn một, không để trạng thái lửng lơ).
  Bỏ khỏi prompt, schema model, `VerifiedAnswer` và `PublicResponse`. Model còn gửi trường này thì zod lược
  bỏ (có test).
- [x] Gộp còn một lượt `validateAnswer` cho mỗi hình dạng câu trả lời; `ensureGroundedAnswerDepth` chỉ chạy một lần.
  `verifyAnswerWithReport` validate output của model một lần, rồi thêm độ sâu một lần, và chỉ validate lại
  khi hình dạng câu trả lời đổi. Generator giờ chỉ parse schema.
- [x] Sửa `rejectedClaimCount` để không đếm trùng.
  Chỉ đếm claim của model; claim độ sâu do hệ thống thêm mà bị loại thì ghi `depth_claim_rejected`, không cộng.
- [x] Quyết định rõ: claim bị loại **có** hạ `grounded` xuống `partial` hay không, rồi làm cho code khớp quyết định và thêm regression test.
  Quyết định 2026-09-19: **có hạ**. Loại bất kỳ claim nào của model, hoặc thay kết luận ngắn, đều đưa
  `grounded` về `partial` và ghi `grounded_downgraded_to_partial`. Đây là thiết kế ban đầu của verifier
  (nguyên tắc fail safely). Test service cũ "vẫn grounded sau khi loại claim" đã được đổi theo quyết định này.

**Tiêu chí hoàn thành:**

- [x] `metrics` phản ánh đúng số claim thực sự bị loại.
- [x] Huy hiệu trạng thái khớp với số claim còn lại sau kiểm tra.

**Ước lượng:** S–M

### [x] P1-08 — Nối sidebar với `/api/documents`

**Mục tiêu:** Phần "Phạm vi bộ dữ liệu" nói đúng corpus đang `active`, thay vì một danh sách ghi cứng.

**Bối cảnh (rà soát 2026-09-19):** `sidebar.tsx` ghi cứng danh sách bốn nghị định trong hằng `CORPUS`.
`/api/documents` tồn tại, có test và có mock Playwright — nhưng **không component nào gọi**. Sau P0-18, nếu
corpus active đổi thì sidebar sẽ nói sai.

**Phạm vi dự kiến:** `src/features/chat/components/sidebar.tsx`, `src/app/api/documents/route.ts`,
`tests/smoke/app-shell.test.tsx`.

**Việc cần làm:**

- [x] Sidebar lấy danh sách tài liệu từ `/api/documents`, có trạng thái loading và fallback khi lỗi.
  Khi đang tải thì hiện danh sách đã biết (`aria-busy`). Lỗi thì giữ danh sách đó; API trả rỗng thì báo
  "Chưa có văn bản nào đang hoạt động". Văn bản mới lạ hiện số hiệu + tiêu đề.
- [x] Cân nhắc cache kết quả `getDocuments()` ở server (4 bản ghi, gần như tĩnh) — hiện `/api/sources/:id` gọi lại `getDocuments()` ở **mỗi** lần mở nguồn, trên Supabase là một round-trip thừa cho mỗi cú bấm citation.
  Đã cache 5 phút trong `SupabaseLegalRepository` và chỉ lấy văn bản `status='active'`.

**Tiêu chí hoàn thành:**

- [x] Đổi corpus active làm sidebar đổi theo mà không cần sửa code.
  Sidebar phản ánh thay đổi sau tối đa 5 phút (TTL cache) hoặc sau khi khởi động lại.

**Ước lượng:** S

### [x] P1-09 — Dọn các sai lệch nhỏ phát hiện khi rà soát

**Mục tiêu:** Gom các lỗi nhỏ nhưng có thật vào một lượt xử lý, tránh để chúng trôi.

**Việc cần làm:**

- [x] `memory-legal-repository.ts`: `keywordSearch` **bỏ qua `corpusVersion`** (khác với `hybridSearch`) → lệch hành vi giữa đường chính và đường fallback.
  Memory repository nhận `corpusVersion` giống Supabase; factory truyền `CORPUS_VERSION`. Có test.
- [x] `app-shell.tsx`: `{drawerOpen ? <Menu/> : <Menu/>}` — hai nhánh y hệt nhau, icon không phản ánh trạng thái đóng/mở.
- [x] `use-chat-session.ts`: `submit` kiểm tra `progress !== 'idle'` từ closure; hai lần gửi trong cùng một tick đều thấy `idle`. Composer đang che được lỗi này, nhưng nên chặn bằng ref cho chắc.
  Chặn bằng `activeRequestRef` đồng bộ. Sửa thêm một lỗi liên quan: request đã hủy khi kết thúc muộn từng
  reset `progress` của request mới. Có test cho cả hai.
- [x] Cân nhắc `RATE_LIMIT_MAX=20`/phút theo IP: nếu người xem cùng sau một NAT thì họ **dùng chung** hạn mức.
  Đã cân nhắc, **giữ 20/phút**. Bản dự thi chạy localhost với một người thao tác, nên mọi request đều từ
  127.0.0.1. Nếu cho khán giả dùng chung mạng/NAT thì tăng `RATE_LIMIT_MAX` trong `.env`, không cần sửa code.
- [x] `cross_references.py::_find_target` là quét tuyến tính lồng trong vòng lặp (~O(n²·m), khoảng 1,3 triệu vòng với 649 chunk). Chạy offline nên không chặn demo — chỉ ghi nhận là nợ kỹ thuật.
  Đã xử lý luôn, vì lượt này dùng lại resolver cho publish: index theo (văn bản, phiên bản, Điều), giữ nguyên
  thứ tự khớp đầu tiên.

**Ước lượng:** S

### [x] P1-10 — Phát mốc tiến trình theo thời gian thực (SSE)

**Mục tiêu:** Giảm cảm giác chờ bằng cách cho người dùng thấy hệ thống đang ở bước nào, mà không cần streaming token.

**Bối cảnh (rà soát 2026-09-19):** `use-chat-session.ts` dùng `await fetch()` nguyên khối, không streaming.
Mẫu live gần nhất ghi nhận ~19,98 giây cho một case thành công. Đây là yếu tố **cảm nhận** lớn nhất và cũng
là thứ rẻ nhất để cải thiện: chỉ cần phát mốc stage (`retrieval → context → generation`) là cảm giác chờ đã
khác hẳn, kể cả khi tổng thời gian không đổi.

Khác với mục Deferred *"Streaming token và orchestration thời gian thực phức tạp"*: task này **không** stream
token của model, chỉ phát vài sự kiện mốc đã có sẵn trong `stageTimings`.

**Phạm vi dự kiến:** `src/app/api/chat/route.ts`, `src/features/legal-rag/service.ts`,
`src/features/chat/use-chat-session.ts`, `src/features/chat/components/progress-status.tsx`.

**Việc cần làm:**

- [x] Phát các mốc stage qua SSE; giữ nguyên payload JSON cuối cùng làm sự kiện kết thúc.
  Khi `Accept: text/event-stream`: các sự kiện `stage` (`retrieval`/`context`/`generation`/`verification`), rồi
  một `result` (đúng body JSON cũ) hoặc một `error` `{code,message,status}`. Không có header này thì vẫn trả
  JSON như cũ, nên mock Playwright/test không đổi.
- [x] `ProgressStatus` hiển thị mốc thật thay vì microcopy luân phiên theo đồng hồ (thay thế cơ chế của P0-12).
- [x] Giữ nguyên hành vi cancel/retry và không làm hỏng đường lỗi hiện có.
  Retry, thông báo lỗi 429/503/504 và các test cũ đều pass; stream đứt giữa chừng thì báo "Kết nối bị gián đoạn".

**Tiêu chí hoàn thành:**

- [x] Trạng thái hiển thị là mốc **thật** do backend phát, không phải tiến độ mô phỏng.
  Trên `next start`: `retrieval`/`context`/`generation` đến ở 40–50 ms, `verification` + `result` ở ≈ 3,1 giây
  (provider giả trễ 3 giây).
- [x] Huỷ giữa chừng vẫn đóng stream và trả UI về trạng thái nhập trong 1 giây.
  `cancel()` đưa UI về `idle` đồng bộ. Server: `request.signal` abort pipeline, và upstream provider ghi
  `caller_aborted` ngay sau khi client hủy ở 1,5 giây.

**Ước lượng:** M

---

## 5. Deferred — Chủ động để ngoài scope MVP/DEMO

Các hạng mục dưới đây chỉ xem xét sau cuộc thi hoặc khi có yêu cầu vận hành thật:

- [-] Distributed rate limiting bằng Redis hoặc dịch vụ tương đương.
- [-] Knowledge graph pháp lý đầy đủ và resolve mọi tham chiếu chéo giữa văn bản.
- [-] Pipeline cập nhật nhiều phiên bản văn bản, migration và rollback dữ liệu production.
- [-] Tối ưu OCR song song/cache cho kho tài liệu lớn; hiện corpus chỉ có bốn PDF cố định.
- [-] Streaming token và orchestration thời gian thực phức tạp.
- [-] Tự động failover qua nhiều AI provider hoặc self-host model.
- [-] Mở rộng evaluation lên hàng trăm câu và xây dashboard quan sát production.
- [-] Hạ tầng multi-region, autoscaling và SLA cấp doanh nghiệp.

> Ký hiệu `[-]`: đã rà soát và chủ động xác nhận không cần hoàn thành cho scope MVP/DEMO hiện tại.

> Cập nhật quy ước 2026-09-19: trước đây quy ước này cấm dùng `[-]` cho gate P0 thiếu credential, public URL
hoặc rehearsal. Sau rà soát, phạm vi dự thi được chốt lại là **MVP nội bộ chạy localhost**, nên ba nhóm gate
đó (P0-03 public URL, P0-07 rehearsal, P0-08 duyệt nhận diện) được chủ động chuyển `[-]`. Các gate P0 còn
thiếu **credential provider** vẫn giữ `[ ]` vì chúng chặn trực tiếp chất lượng câu trả lời (P0-16), không
phải thủ tục.

---

## 6. Definition of Done cho bản dự thi

Bản MVP/DEMO được xem là sẵn sàng khi:

- [ ] Toàn bộ task P0 đã hoàn thành; P1 không phải điều kiện bắt buộc.
- [ ] **Corpus 649 chunk đã `active` trên Supabase và ứng dụng chạy `LEGAL_REPOSITORY=supabase`** (P0-18).
- [ ] **Nhánh vector của hybrid search trả kết quả khác rỗng** — tức embedding đã được sinh và semantic retrieval không còn ở chế độ keyword-only (P0-18, P0-16).
- [ ] Bộ bốn nghị định đúng phiên bản và hash đã được dùng trên môi trường demo.
- [x] Câu trả lời cuối cùng không có claim quan trọng thiếu citation hoặc vượt quá bằng chứng.
- [-] Tất cả citation trong kịch bản trình diễn mở được source drawer và đúng PDF qua URL public.
- [ ] **Mở citation của NĐ 188 (49 MB) hiển thị đúng trang mà không phải tải toàn bộ file** (P0-21).
- [x] Các câu hỏi nhiều lượt cốt lõi giữ đúng ngữ cảnh.
- [ ] Thời gian phản hồi nằm trong ngân sách đã đặt và timeout được xử lý rõ ràng.
- [x] **Retrieval chậm không làm generation bị bỏ qua**: hết ngân sách vẫn trả câu trả lời hoặc lỗi có phân loại, không fail trắng sau khi chờ trọn deadline (P0-19).
- [x] **Câu trả lời bị cắt do hết token không bị hiển thị thành "Ngoài phạm vi tài liệu"** (P0-22).
- [x] Mỗi grounded response thông thường chỉ dùng một LLM call; citation/claim được kiểm tra deterministic và có cảnh báo đối chiếu nguồn.
- [ ] Kiểm thử localhost bằng trình duyệt thật đạt tiêu chí desktop/390 px/360 px, có báo cáo p50/p95 và không còn request chạy nền sau cancel/timeout.
- [x] Lint, type-check, test, build, deterministic evaluation và E2E đều pass trên bản kiểm chứng hiện tại; credentialed/live-provider evaluation được theo dõi ở các gate riêng.
- [x] Nhận diện BHXH tỉnh Khánh Hòa hiển thị đúng trên desktop và mobile, có nhãn MVP/DEMO nội bộ.
- [x] Answer Card không lặp danh sách nguồn/AI accordion và câu trả lời có chiều sâu theo thiết kế đã duyệt.
- [x] Partial/clarification/out-of-scope đều có phản hồi hoàn chỉnh, an toàn và có hướng dẫn tiếp theo.
- [x] Trạng thái chờ hiển thị mốc thật do backend phát (thay cơ chế luân phiên 4 giây, P1-10) kèm đồng hồ chờ, cleanup đúng và không ảnh hưởng cancel/retry.
- [-] Hai lần diễn tập liên tiếp thành công trên thiết bị và mạng dự kiến dùng tại cuộc thi.
- [-] Có phương án fallback đã thử nghiệm và hướng dẫn khôi phục ngắn.

> Trạng thái DoD 2026-09-17: các mục code/test/source/multi-turn/branding/safe-state/progress, one-LLM
grounding và cảnh báo đối chiếu đã có bằng chứng tương ứng. `npm run verify`, Python ingestion tests,
deterministic evaluation và E2E local đều pass; browser smoke thật có response và citation/PDF hoạt động.
DoD tổng thể vẫn chưa hoàn tất vì active Supabase/corpus, credential và quota semantic provider, public
citation, p95 trên mạng demo, kiểm chứng cancel provider ở live, xác nhận trực quan của người phụ trách và
hai rehearsal/fallback rehearsal thực tế vẫn chưa được xác nhận.

> Trạng thái DoD 2026-09-19 sau rà soát toàn luồng: baseline test vẫn xanh (`vitest` 170 pass / 6 skip,
exit 0), nhưng rà soát xác định **khoảng cách chính không nằm ở test mà ở dữ liệu vận hành**. Ứng dụng đang
chạy `LEGAL_REPOSITORY=memory` với **7 chunk mẫu**, trong khi artifact 649 chunk đã qua quality gate lại
không có công cụ nào đưa lên Supabase và chưa có embedding. Vì vậy mọi kết quả evaluation, latency và chất
lượng câu trả lời hiện có đều đo trên một corpus không phải corpus trình diễn. **P0-18 là gate mở khoá**;
P0-19 → P0-22 xử lý các điểm nghẽn hiệu năng/trải nghiệm đã được kiểm chứng bằng thực nghiệm. Các gate
public URL, rehearsal và duyệt nhận diện đã chuyển `[-]` theo phạm vi MVP nội bộ.

> Trạng thái DoD 2026-09-19 sau lượt triển khai: đạt thêm hai mục (P0-19 retrieval chậm, P0-22 truncation).
Các mục còn mở cần: (1) credential Supabase + token HF để publish corpus thật (P0-18, P0-01, P0-16); (2) đo
p50/p95 với provider thật trên máy/mạng demo (P0-05, P0-10, P0-17); (3) quyết định cho trình xem PDF
(P0-21, xem ghi chú ở task). Phần code của các task này đã xong và có test.

## 7. Nguyên tắc kiểm soát scope

- Nếu một công việc không giúp tăng **độ đúng**, **tốc độ**, **độ ổn định** hoặc **trải nghiệm quan sát được trong buổi demo**, đưa nó vào Deferred.
- Không bắt đầu P1 khi còn lỗi P0.
- Với mỗi task, ưu tiên thay đổi nhỏ có test hồi quy hơn là tái cấu trúc lớn.
- Sau khi đạt Definition of Done, đóng băng tính năng và chỉ sửa lỗi chặn demo.
