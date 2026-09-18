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

1. Chốt và kiểm tra đường chạy demo với dữ liệu thật.
2. Bảo đảm câu trả lời cuối cùng được kiểm chứng và luôn gắn với bằng chứng.
3. Bảo đảm người xem mở được tài liệu nguồn.
4. Ổn định hội thoại nhiều lượt và thời gian phản hồi.
5. Mở rộng bộ câu hỏi đánh giá, sau đó diễn tập toàn bộ kịch bản demo.
6. Hoàn thiện nhận diện BHXH tỉnh Khánh Hòa và hợp nhất cách trình bày câu trả lời.
7. Tăng chiều sâu phân tích, hoàn thiện phản hồi ngoài corpus và trạng thái chờ.
8. Chỉ xử lý các mục P1 nếu toàn bộ P0 đã đạt.

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

### [ ] P0-03 — Làm cho liên kết tài liệu nguồn hoạt động trong bản demo

**Mục tiêu:** Người xem bấm vào citation có thể mở đúng PDF và đúng tài liệu được trích dẫn.

**Phạm vi dự kiến:** `src/app/api/sources/[id]/route.ts`, `src/features/sources/source-viewer.tsx`, `src/features/sources/citation-chip.tsx`, thư mục `LUATBHXHBHYT2024/` hoặc một vị trí public được xác định rõ.

**Việc cần làm:**

- [x] Chọn một cơ chế phục vụ PDF duy nhất: route có kiểm soát hoặc public asset.
- [x] Chuẩn hóa ánh xạ document ID tới đúng file PDF; không phụ thuộc vào đường dẫn chỉ tồn tại trên máy phát triển.
- [x] Trả về lỗi 404 rõ ràng khi tài liệu không tồn tại.
- [x] Thêm test route và một bài kiểm tra trình duyệt mở nguồn từ citation.
- [x] Restart sạch dev server và xác nhận `GET /api/sources/:id` được đăng ký trong dev route manifest.
- [x] Bổ sung smoke test chạy qua Next server thật, không import handler trực tiếp và không mock source API.
- [ ] Kiểm tra citation và PDF từ một thiết bị ngoài thông qua URL tunnel public.

**Tiêu chí hoàn thành:**

- [ ] Citation của cả bốn nghị định mở được source drawer và PDF tương ứng trên môi trường demo public.
- [x] Không có liên kết `/corpus/...` bị hỏng.

**Ước lượng:** S–M

> Kiểm chứng 2026-09-16: sau clean build/restart, manifest có `/api/sources/[id]/route` và
`/corpus/[filename]/route`; `tests/e2e/source-runtime.spec.ts` chạy qua Next server thật đạt
`1 passed`, kiểm tra JSON source và PDF `%PDF`. Public tunnel/citation từ thiết bị ngoài vẫn chưa có
bằng chứng nên tiêu chí public còn `[ ]`.

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
- [ ] Không request nào vượt quá request budget đã cấu hình mà không bị hủy ở cả client, server và provider, đồng thời trả trạng thái lỗi có kiểm soát.

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

### [ ] P0-07 — Diễn tập và đóng băng bản demo

**Mục tiêu:** Có một kịch bản trình diễn ngắn, lặp lại được và có phương án phục hồi khi mạng/provider không ổn định.

**Việc cần làm:**

- [x] Chọn 5–7 câu hỏi demo đại diện, gồm ít nhất một câu nhiều lượt và một câu cần từ chối/làm rõ.
- [x] Chạy đầy đủ `lint`, type-check, unit/integration test, build và E2E trên commit dự kiến mang đi thi.
- [ ] Chạy thử toàn bộ kịch bản ít nhất hai lần trên đúng máy và mạng dự kiến sử dụng.
- [x] Kiểm tra không có API key, dữ liệu nhạy cảm hoặc thông tin nội bộ xuất hiện trong giao diện/log trình diễn.
- [x] Lưu sẵn cấu hình fallback và hướng dẫn khôi phục ngắn; không thay đổi tính năng trong sát giờ thi trừ lỗi chặn demo.

**Tiêu chí hoàn thành:**

- [ ] Hai lần diễn tập liên tiếp hoàn thành mà không cần sửa thủ công dữ liệu hoặc khởi động lại dịch vụ.
- [ ] Có thể chuyển sang phương án fallback trong vài phút nếu provider hoặc Supabase gặp sự cố.

**Ước lượng:** S

> Kiểm chứng 2026-09-16: runbook demo, fallback docs, privacy scan và bộ lint/typecheck/test/build/E2E
đã sẵn sàng. Local browser smoke xác nhận response an toàn, progress/cancel và layout ở desktop/390/360;
hai rehearsal đầy đủ trên máy/mạng thi và chuyển fallback thực tế chưa được xác nhận.

### [ ] P0-08 — Bổ sung nhận diện chính thức của BHXH tỉnh Khánh Hòa

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
- [ ] Người phụ trách xác nhận trực quan asset và cách đặt logo phù hợp bộ nhận diện.

**Ước lượng:** M

> Kiểm chứng 2026-09-16: asset cục bộ và provenance nằm trong `public/brand/README.md`; component test,
Playwright và browser smoke thật desktop/mobile/mobile360 xác nhận alt text, ảnh tải được, nhãn DEMO và
không overflow. Mục xác nhận trực quan của người phụ trách vẫn chưa tick.

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
- [x] Answer Card hiển thị các mục phân tích bằng tiêu đề cố định, citation nằm riêng dưới từng mục và vẫn an toàn ở viewport 360 px.
- [-] Cho phép ví dụ minh họa có nhãn rõ nhưng không biến ví dụ thành quy định.
- [x] Không cho phép thêm số, tỷ lệ, thời hạn, đối tượng hoặc quyền lợi ngoài nguồn đã kiểm chứng.
- [x] Giữ validator/verifier cho mọi claim pháp lý và không hiển thị chain-of-thought.
- [ ] Đo lại latency/token để bảo đảm câu trả lời dài hơn vẫn nằm trong request budget được cấu hình và kiểm chứng trên mạng demo.

**Tiêu chí hoàn thành:**

- [x] Gold cases grounded/partial có phân tích rõ ràng và không chỉ diễn đạt lại câu hỏi.
- [x] Không tăng số claim thiếu citation, source ID giả hoặc kết luận vượt nguồn.
- [ ] Độ dài tăng có kiểm soát, không padding vô nghĩa và không làm timeout vượt ngân sách.

**Ước lượng:** M

> Kiểm chứng 2026-09-17: prompt yêu cầu grounded có 3–5 mục phân tích không lặp câu hỏi/short answer,
Answer Card đã có tiêu đề cố định cho từng lớp phân tích, `LLM_MAX_OUTPUT_TOKENS=1024`, và lớp
`answer-depth` bổ sung công thức/hệ quả chỉ từ source khi model trả output nông. Retrieval cũng loại chunk
khác chủ đề trước khi gửi context vào generator. Targeted depth/retrieval/service tests đạt; toàn bộ verify
được chạy lại sau thay đổi. Một mẫu live sau restart cho câu hỏi BHYT trả HTTP 200, một LLM call,
short answer 2 câu và 4 mục analysis, chỉ dùng nguồn 188/2025/NĐ-CP; một số lần khác provider vẫn vượt
50 giây nên latency/token gate tiếp tục mở. Ví dụ minh họa được đánh dấu `[-]` vì không cần cho MVP pháp lý
và có thể làm tăng rủi ro bị hiểu như quy định.

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
- [ ] Đo tối thiểu năm lần cho mỗi nhóm exact và natural trên đúng mạng demo; ghi end-to-end latency phía trình duyệt, stage timings phía server, `llmCallCount`, HTTP status và scope status.
- [x] Tính p50/p95, tỷ lệ lỗi, tỷ lệ 429 và so sánh với baseline 46–53 giây; không ghi nội dung câu hỏi, câu trả lời hoặc credential vào báo cáo telemetry.
- [ ] Xác nhận request bị hủy không tiếp tục xuất hiện như một completion muộn trong log server/provider.
- [x] Lưu kết quả kiểm thử, cấu hình model/provider và ngày đo trong tài liệu evaluation; đánh dấu rõ số đo desktop/mobile và các giới hạn còn lại.

**Tiêu chí hoàn thành:**

- [ ] Luồng grounded thông thường dùng đúng một LLM call và p95 không quá 30 giây trên máy/mạng demo; nếu không đạt thì task đổi model/provider vẫn phải để mở.
- [x] Out-of-scope hoặc clarification không cần generation trả trong tối đa 3 giây.
- [x] Desktop/390 px/360 px không overflow, không mất citation và không có lỗi console ảnh hưởng chức năng.
- [ ] Cancel phản hồi trên UI trong tối đa 1 giây và không để tác vụ provider chạy nền.
- [ ] Năm lượt liên tiếp không có 401/403; 429 nếu xuất hiện được hiển thị và xử lý đúng, không retry storm.
- [x] Có báo cáo p50/p95 và ghi nhận trải nghiệm đọc, kiểm chứng nguồn, chờ, hủy và thử lại từ góc độ người dùng.

**Ước lượng:** M

---

## 4. P1 — Nên làm nếu còn thời gian sau P0

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

> Ký hiệu `[-]`: đã rà soát và chủ động xác nhận không cần hoàn thành cho scope MVP/DEMO hiện tại;
không dùng ký hiệu này cho gate P0 còn cần bằng chứng nhưng đang bị thiếu credential, public URL hoặc
rehearsal.

---

## 6. Definition of Done cho bản dự thi

Bản MVP/DEMO được xem là sẵn sàng khi:

- [ ] Toàn bộ task P0 đã hoàn thành; P1 không phải điều kiện bắt buộc.
- [ ] Bộ bốn nghị định đúng phiên bản và hash đã được dùng trên môi trường demo.
- [x] Câu trả lời cuối cùng không có claim quan trọng thiếu citation hoặc vượt quá bằng chứng.
- [ ] Tất cả citation trong kịch bản trình diễn mở được source drawer và đúng PDF qua URL public.
- [x] Các câu hỏi nhiều lượt cốt lõi giữ đúng ngữ cảnh.
- [ ] Thời gian phản hồi nằm trong ngân sách đã đặt và timeout được xử lý rõ ràng.
- [x] Mỗi grounded response thông thường chỉ dùng một LLM call; citation/claim được kiểm tra deterministic và có cảnh báo đối chiếu nguồn.
- [ ] Kiểm thử localhost bằng trình duyệt thật đạt tiêu chí desktop/390 px/360 px, có báo cáo p50/p95 và không còn request chạy nền sau cancel/timeout.
- [x] Lint, type-check, test, build, deterministic evaluation và E2E đều pass trên bản kiểm chứng hiện tại; credentialed/live-provider evaluation được theo dõi ở các gate riêng.
- [x] Nhận diện BHXH tỉnh Khánh Hòa hiển thị đúng trên desktop và mobile, có nhãn MVP/DEMO nội bộ.
- [x] Answer Card không lặp danh sách nguồn/AI accordion và câu trả lời có chiều sâu theo thiết kế đã duyệt.
- [x] Partial/clarification/out-of-scope đều có phản hồi hoàn chỉnh, an toàn và có hướng dẫn tiếp theo.
- [x] Trạng thái chờ luân phiên 4 giây, cleanup đúng và không ảnh hưởng cancel/retry.
- [ ] Hai lần diễn tập liên tiếp thành công trên thiết bị và mạng dự kiến dùng tại cuộc thi.
- [ ] Có phương án fallback đã thử nghiệm và hướng dẫn khôi phục ngắn.

> Trạng thái DoD 2026-09-17: các mục code/test/source/multi-turn/branding/safe-state/progress, one-LLM
grounding và cảnh báo đối chiếu đã có bằng chứng tương ứng. `npm run verify`, Python ingestion tests,
deterministic evaluation và E2E local đều pass; browser smoke thật có response và citation/PDF hoạt động.
DoD tổng thể vẫn chưa hoàn tất vì active Supabase/corpus, credential và quota semantic provider, public
citation, p95 trên mạng demo, kiểm chứng cancel provider ở live, xác nhận trực quan của người phụ trách và
hai rehearsal/fallback rehearsal thực tế vẫn chưa được xác nhận.

## 7. Nguyên tắc kiểm soát scope

- Nếu một công việc không giúp tăng **độ đúng**, **tốc độ**, **độ ổn định** hoặc **trải nghiệm quan sát được trong buổi demo**, đưa nó vào Deferred.
- Không bắt đầu P1 khi còn lỗi P0.
- Với mỗi task, ưu tiên thay đổi nhỏ có test hồi quy hơn là tái cấu trúc lớn.
- Sau khi đạt Definition of Done, đóng băng tính năng và chỉ sửa lỗi chặn demo.
