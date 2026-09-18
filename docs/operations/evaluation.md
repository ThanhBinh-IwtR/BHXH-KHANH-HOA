# Vận hành: Đánh giá (gold set)

## 1. Định dạng gold set

`tests/evaluation/gold-set.json` — mỗi dòng:

```json
{
  "id": "exact-158-article-12-clause-3",
  "question": "khoản 3 Điều 12 Nghị định 158/2025/NĐ-CP quy định gì?",
  "expectedScope": "grounded",
  "requiredSourceIds": ["nd-158-2025:dieu-12:khoan-3:2025-demo-v1"],
  "forbiddenClaims": [],
  "requiredClarifications": []
}
```

Bộ hiện tại có 27 case, phủ các nhóm: tra cứu trực tiếp, diễn đạt tự nhiên, số/tỷ lệ, sai chính
tả/bỏ dấu, so sánh, tình huống, continuation nhiều lượt, thiếu dữ kiện, prompt injection và ngoài
phạm vi; đã bổ sung một case `partial` để kiểm tra hướng dẫn phần còn thiếu. Case nhiều lượt có thể
thêm `history`; runner viết lại câu hỏi độc lập trước cả retrieval và generation. Câu hỏi và
`requiredSourceIds` bám theo dữ liệu đã parse.

> Bộ demo bám `sampleCorpus` (chạy được ở chế độ `memory` không cần credential). Khi corpus đầy
> đã publish lên Supabase kèm embedding, mở rộng bộ này lên 60–100 dòng sinh **từ** các chunk
> thật và chạy `npm run evaluate`.

## 2. Chạy đánh giá

```powershell
# Deterministic, memory mode — chạy như một test, không gọi model thật
npm run test -- tests/evaluation

# Bản credential: dùng repository + provider thật, ghi tmp/evaluation/*.json|md
npm run evaluate

# Browser live: chỉ bật khi muốn gửi câu hỏi/context tới provider trong .env
$env:RUN_LIVE_E2E = "1"
npx playwright test tests/e2e/live-localhost.spec.ts
```

`npm run test:e2e` mặc định giữ provider giả deterministic. Khi `RUN_LIVE_E2E=1`, Playwright không
ghi đè endpoint/model trong `.env`; các status provider đã biết (401/403/429/504) được ghi report và
skip phần đo bị chặn thay vì làm hỏng toàn bộ suite.

Runner (`tests/evaluation/run-evaluation.ts`) xuất per-case: scope kỳ vọng/thực tế, recall,
thứ hạng truy hồi, số citation ID bịa, số claim thiếu nguồn, clarification bắt buộc bị thiếu, phản hồi
non-grounded chưa đủ hướng dẫn, độ trễ; kèm tổng hợp. Không ghi API key hay dữ liệu người dùng.

CLI dùng `node --conditions=react-server --import tsx` để nạp đúng export condition của package
`server-only`, đồng thời gọi `loadEnvConfig(process.cwd())` để nạp `.env` như Next runtime; điều
này không thay đổi import graph của bản Next.js.

Kiểm chứng credentialed/local browser ngày 2026-09-17: sau khi bỏ semantic verifier, grounded exact nhận
một LLM call; mẫu trước đó ghi nhận desktop 38,575 ms, mobile 390px 34,181 ms và mobile360 35,484 ms.
Sau khi sửa config live để không dùng endpoint giả, grounded route thật trả HTTP 504 quanh 40,1 giây;
out-of-scope vẫn trả 398 ms trên desktop và 456 ms/1,3 giây trên mobile. Mẫu 5 exact + 5 natural chưa
hoàn tất. Readiness mới nhất ghi generation ready 23,873 ms và embedding/reranker HTTP 403, nên đường
semantic đang ở keyword fallback. Các số đo partial được lưu trong `tmp/evaluation/live-localhost-*.json`;
không ghi nhận đây là evaluation pass và latency p95 gate vẫn mở.

## 3. Ngưỡng nghiệm thu

`npm run evaluate` trả mã lỗi khác 0 nếu bất kỳ ngưỡng nào sai:

- Exact lookup = **100%**.
- Recall@10 ≥ **95%**.
- Số citation ID bịa = **0**.
- Số claim pháp lý thiếu nguồn = **0**.
- Vi phạm `forbiddenClaims` (gồm prompt injection) = **0**.
- Số `requiredClarifications` bị thiếu = **0**.
- Phản hồi partial/clarification/out-of-scope chưa đủ hướng dẫn = **0**.
- Scope accuracy ≥ **90%**.

## 4. So sánh hai cấu hình model trên cùng gold set

Model là cấu hình thay thế được; prompt contract, retrieval và UI không đổi:

```powershell
# Cấu hình A
$env:LLM_MODEL = "google/gemma-4-31b-it:free"; npm run evaluate
Move-Item tmp/evaluation/evaluation.json tmp/evaluation/A.json

# Cấu hình B
$env:LLM_MODEL = "openai/gpt-oss-120b"; npm run evaluate
Move-Item tmp/evaluation/evaluation.json tmp/evaluation/B.json
```

So sánh `A.json` và `B.json` theo `exactLookupAccuracy`, `recallAt10`, `scopeAccuracy`,
`unknownCitationCount` và độ trễ trung bình để chọn model cho demo.

## 5. Ngân sách câu trả lời dài

Demo hiện đặt `LLM_MAX_OUTPUT_TOKENS=1024` trong `.env` và có cấu hình gợi ý tương ứng trong `.env.example`.
Prompt yêu cầu câu trả lời
grounded khoảng 250–450 từ, kết luận 2–4 câu và tối đa 3–5 mục phân tích độc lập khi ngữ cảnh đủ căn cứ;
mọi claim vẫn phải có `source_ids` hợp lệ và đi qua validator/verifier deterministic. Không có lượt semantic
verifier LLM thứ hai.

Timeout provider của demo là 50 giây (`AI_TIMEOUT_MS`), còn deadline toàn pipeline là 60 giây
(`REQUEST_TIMEOUT_MS`). Đây là headroom tạm thời cho tail latency của provider, không phải bằng chứng rằng
provider đã đạt p95 mục tiêu; cần restart dev server sau khi đổi `.env`. Lỗi timeout trả thông báo rằng AI
provider chưa phản hồi và log server ghi stage timing đã loại bỏ nội dung câu hỏi/câu trả lời. Retry phía UI
dùng lại user bubble hiện tại để không tạo message trùng hoặc gọi nhầm nhiều lượt ngoài chủ ý.

Sau thay đổi này, focused legal-rag/API/UI test đạt 44/44; full `npm run verify` đạt 167 test pass và
6 skip. Live citation smoke ngày 2026-09-17 có một mẫu provider unavailable nên chưa đủ dữ liệu để kết luận
p95 latency mới; không ghi nhận đây là pass về hiệu năng.

Bổ sung kiểm chứng sau khi sửa: lớp `answer-depth` model-free xử lý response grounded/partial bị thiếu
chiều sâu bằng cách chỉ thêm công thức và hệ quả trực tiếp có thể đối chiếu từ source; retrieval lọc chunk
khác chủ đề trước khi gửi vào generator. Không có lượt LLM bổ sung. Mẫu live mới nhất trả HTTP 200 trong
19,976 ms (≈19,98 giây), một generator call, short answer 2 câu/231 ký tự và 5 mục analysis/746 ký tự cho câu hỏi BHYT,
chỉ dùng một source. Một lần thử khác vẫn 504 ở 50,981 ms (≈50,98 giây); vì provider còn dao động, p95/live quota gate
vẫn mở.
