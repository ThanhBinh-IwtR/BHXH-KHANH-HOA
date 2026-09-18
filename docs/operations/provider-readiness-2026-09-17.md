# Provider readiness — 2026-09-17

Kết quả được tạo bằng `npm run provider:readiness`. Báo cáo chỉ lưu model, trạng thái, HTTP status,
latency và lớp lỗi đã phân loại; không lưu API key, prompt, câu hỏi, câu trả lời hoặc nội dung nguồn.

| Provider | Model | Trạng thái | HTTP | Latency |
| --- | --- | --- | ---: | ---: |
| embedding | BAAI/bge-m3 | unavailable — permission_denied | 403 | 383 ms |
| reranker | BAAI/bge-reranker-v2-m3 | unavailable — permission_denied | 403 | 381 ms |
| generation | glm-4.5-flash | ready | — | 23.873 s |

## Kết luận

- Readiness tổng thể: `degraded-keyword-only`.
- Generation đã gọi được bằng provider thật; đường grounded thông thường hiện chỉ cần một lượt LLM.
- Embedding và reranker chưa sẵn sàng vì token Hugging Face hiện tại không có quyền Inference Providers.
  Runtime đã mở circuit theo phiên cho 401/403 và chuyển request sau sang keyword fallback.
- Probe generation mới nhất 23,873 giây đã thấp hơn mục tiêu p95 30 giây nhưng chưa đủ để kết luận latency
  live đạt; grounded route vẫn ghi nhận 504 quanh 40,1 giây khi chạy đầy đủ prompt/context. Cần thêm mẫu
  5+5 và/hoặc đổi model/provider sau khi có credential/quota phù hợp. Không đánh dấu latency gate đạt.

## Việc cần làm trước khi đánh dấu P0-16/P0-17 đạt

1. Thu hồi/đổi token đã từng xuất hiện trong log công cụ và cập nhật secret store cục bộ.
2. Tạo HF fine-grained token có quyền gọi Inference Providers, kiểm tra credits/quota, rồi chạy lại smoke.
3. Chạy lại năm lượt exact và năm lượt natural trên đúng máy/mạng demo; ghi p50/p95 và HTTP status.
4. Chạy hai rehearsal theo runbook sau khi provider và corpus Supabase sẵn sàng.
