# Vận hành: Ingestion corpus pháp lý

Pipeline ingestion chuyển bốn PDF trong `LUATBHXHBHYT2024/` thành các node và chunk pháp lý
đã kiểm chứng. Toàn bộ chạy **thủ công**, cục bộ, không gửi trang PDF ra dịch vụ ngoài.

## 1. Môi trường Python

```powershell
python -m venv .venv
.\.venv\Scripts\python -m pip install --upgrade pip
.\.venv\Scripts\python -m pip install -r ingestion\requirements.txt
```

## 2. OCR cục bộ (Tesseract 5)

Bốn nghị định là PDF quét (image-only), nên bắt buộc OCR cục bộ với `vie+eng`.

```powershell
# Tạo .tools/tesseract không cần quyền admin và kiểm tra vie+eng
./ingestion/scripts/setup_ocr.ps1

# Trỏ runtime OCR tới executable và tessdata cục bộ
$env:TESSERACT_CMD   = "$PWD/.tools/tesseract/Library/bin/tesseract.exe"
$env:TESSDATA_PREFIX = "$PWD/.tools/tesseract/share/tessdata"
```

Ràng buộc OCR: render 300 DPI, `--oem 1 --psm 3`, timeout **60 giây/trang**, ghi
`provenance` (`text`/`ocr`) và `mean_confidence` cho mỗi trang. Ngưỡng
`OCR_MIN_CONFIDENCE` mặc định `75.0`.

## 3. Chạy validate toàn corpus

```powershell
$env:PYTHONPATH = "$PWD"
python -m ingestion.legal_ingestion.cli validate `
  --corpus-dir LUATBHXHBHYT2024 `
  --manifest-dir ingestion/manifests `
  --output-dir data/corpus
```

CLI ghi vào thư mục tạm, validate cả bốn tài liệu, rồi **đổi tên nguyên tử** sang run-id cuối
chỉ khi không có lỗi chặn. Nếu bị chặn, output nằm ở `data/corpus/failed-<run-id>/`.

Mỗi run tạo `validation-report.json` (SHA-256, số trang, đếm cấu trúc, cảnh báo, lỗi, số chunk,
`resolved_cross_references`, `unresolved_cross_references` theo từng document) và `chunks.jsonl`.

## 4. Quality gate (chặn publish)

Một run bị chặn nếu có: tiêu đề Điều không nhận diện, Khoản/Điểm mồ côi, chunk thiếu vị trí
trang, chunk vượt token limit, lỗi Unicode, trang trích xuất rỗng, trang OCR thiếu
confidence/provenance, **hoặc trang OCR quy phạm dưới ngưỡng confidence chưa được duyệt thủ công**.

Cross-reference không giải quyết được là **cảnh báo**, không chặn (chúng thường trỏ tới văn bản ngoài
bốn nghị định). Resolver chỉ gắn target khi cùng `document_id` và `corpus_version`; tham chiếu nêu rõ
Luật/Nghị định/Thông tư khác vẫn được giữ dưới dạng unresolved, không được dùng để mở rộng context.

### Phân loại chunk: normative vs appendix

Mỗi chunk có `chunk_type`:

- `normative` — Điều/Khoản/Điểm mang quy phạm. **Đây là dữ liệu duy nhất được truy hồi và trích dẫn.**
- `appendix` — phụ lục/biểu mẫu (Mẫu số…). Vẫn được lưu để đầy đủ, nhưng **bị loại khỏi mọi truy
  hồi** (exact, keyword, vector) và khỏi mở rộng ngữ cảnh, ở cả memory lẫn Supabase.

Nhờ vậy, ứng dụng không bao giờ vô tình trích một biểu mẫu vào câu trả lời.

### Gate OCR gắn với tính quy phạm

Vì trang phụ lục/biểu mẫu không bao giờ được dùng để trả lời, một trang OCR dưới ngưỡng chỉ
**chặn** khi trang đó chứa nội dung quy phạm. Trang chỉ-phụ-lục dưới ngưỡng được hạ thành cảnh
báo `low_ocr_confidence_appendix`. Đây không phải nới lỏng gate: nó gắn gate với đúng thứ ảnh
hưởng chất lượng câu trả lời.

## 5. Trạng thái hiện tại của corpus

Sau khi sửa các lỗi OCR cấu trúc (tham chiếu "Chương V Luật…", dấu phẩy/ký tự đơn ở đầu Khoản,
số Điều bị OCR sai), cả **bốn tài liệu parse sạch**: 0 Khoản/Điểm mồ côi, 0 chunk trùng ID,
mọi chunk có page range hợp lệ.

Còn lại **4 trang chặn duy nhất** thuộc loại `low_ocr_confidence`:

| Tài liệu           | Trang | Confidence | Loại nội dung           |
| ------------------ | ----- | ---------- | ----------------------- |
| 158/2025/NĐ-CP     | 49    | 72.12      | Phụ lục — danh mục biểu mẫu |
| 188/2025/NĐ-CP     | 95    | 72.70      | Mẫu số 6 (biểu mẫu)     |
| 188/2025/NĐ-CP     | 102   | 67.81      | Mẫu số 10 (biểu mẫu)    |
| 188/2025/NĐ-CP     | 104   | 74.70      | Biểu mẫu / bảng          |

Đây đều là trang **phụ lục/biểu mẫu** (bảng, dòng chấm điền tay) — confidence thấp do bố cục,
không phải do sai lệch điều/khoản quy phạm; parser xác nhận **không có Điều/Khoản** nào nằm trên
các trang này.

Vì tất cả bốn trang đều chỉ-phụ-lục, gate hạ chúng thành cảnh báo `low_ocr_confidence_appendix`
và **corpus validate thành công** (`is_valid: true`). Không cần thao tác thủ công thêm.

### Khi một trang quy phạm dưới ngưỡng

Nếu về sau có một trang **quy phạm** (chứa Điều/Khoản) dưới ngưỡng, nó sẽ chặn publish. Sau khi
một người đối chiếu trang gốc, thêm mục vào `reviewed_low_confidence_pages` của manifest:

```json
{
  "document_sha256": "<SHA-256 khớp manifest>",
  "page_number": 12,
  "observed_confidence": 72.12,
  "reviewer": "<tên người duyệt>",
  "reviewed_at": "2026-07-22T09:00:00+07:00",
  "note": "Đã đối chiếu bản gốc; nội dung quy phạm chính xác."
}
```

`document_sha256` và `observed_confidence` phải khớp chính xác, nếu không CLI coi là
`review_metadata_mismatch` và vẫn chặn.

## 6. Publish corpus lên Supabase

Ba subcommand mới đưa một artifact đã `is_valid: true` lên Supabase. Không lệnh nào sửa PDF hay
nội dung pháp lý; lệnh chỉ đọc artifact, manifest và `.env`, không in secret.

### Điều kiện trước

- Đã áp dụng **cả hai** migration trong `supabase/migrations/` (xem [deployment.md](deployment.md)).
- `.env` có `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` (service role) và bộ `EMBEDDING_*` dùng được
  (`npm run provider:readiness` không còn `403`).
- `CORPUS_VERSION` trong `.env` trùng `corpus_version` của artifact và manifest.

### Thứ tự chạy

```powershell
$env:PYTHONPATH = "$PWD"
$artifact = "data/corpus/task4-consistent"

# 1. Ghi cross_reference_ids đã resolve vào chunks.jsonl (chỉ cần cho artifact tạo trước 2026-09-19;
#    lệnh validate mới đã tự ghi). Chạy lại là no-op; file được thay thế nguyên tử.
python -m ingestion.legal_ingestion.cli link-references --artifact-dir $artifact

# 2. Sinh embedding cho 632 chunk quy phạm (phụ lục không cần). Cache nằm cạnh artifact:
#    embeddings-<model>.jsonl. Lỗi giữa chừng -> chạy lại lệnh, chỉ batch còn thiếu được gọi.
python -m ingestion.legal_ingestion.cli embed --artifact-dir $artifact `
  --manifest-dir ingestion/manifests --env-file .env

# 3. Kiểm tra toàn bộ điều kiện cục bộ, không gọi database.
python -m ingestion.legal_ingestion.cli publish --artifact-dir $artifact `
  --manifest-dir ingestion/manifests --env-file .env --dry-run

# 4. Publish thật.
python -m ingestion.legal_ingestion.cli publish --artifact-dir $artifact `
  --manifest-dir ingestion/manifests --env-file .env
```

`publish` làm theo thứ tự: (a) từ chối sớm nếu thiếu embedding hoặc phiên bản đang `active` có nội dung
khác; (b) chèn document mới ở `staged` (bản ghi đã có giữ nguyên); (c) upsert chunk theo batch **không gửi
cột `status`**, nên chunk mới là `staged` và chunk đang phục vụ không đổi trạng thái; (d) gọi RPC
`activate_legal_corpus`, trong **một transaction** kiểm tra số chunk/embedding, cập nhật metadata văn
bản, bật corpus mới `active`, hạ mọi chunk `active` khác xuống `inactive` và ghi `ingestion_runs`
(kèm `artifact_sha256`). Lỗi ở (b)–(c) để lại hàng `staged` vô hại; lỗi ở (d) rollback toàn bộ.

Cờ tùy chọn:

- `--allow-missing-embeddings`: publish corpus chỉ có keyword (nhánh vector rỗng). Chỉ dùng khi
  provider embedding chưa dùng được và cần chạy thử exact/keyword trên dữ liệu thật.
- `--allow-in-place-update`: ghi đè một phiên bản đang `active` có nội dung khác. Mặc định bị từ chối vì
  upsert trực tiếp sẽ thay nội dung đang phục vụ trước bước activate — nên đổi `CORPUS_VERSION` thay vì dùng cờ này.

Publish lại **đúng artifact đó** là idempotent: không tạo bản ghi trùng, không đổi trạng thái đang phục vụ
(so khớp `artifact_sha256` của lần activate gần nhất).

### Kiểm tra sau publish

```sql
select count(*) from legal_chunks where status = 'active' and chunk_type = 'normative';  -- 632
select chunk_id, page_from from exact_search_legal_chunks('188/2025/NĐ-CP', '7', '1', null, '2025-demo-v1');
select count(*) filter (where vector_rank is not null)
from hybrid_search_legal_chunks('mức đóng bảo hiểm y tế', 'muc dong bao hiem y te',
  (select embedding from legal_chunks where status = 'active' and embedding is not null limit 1),
  10, '2025-demo-v1');  -- > 0
```

Sau đó đổi `.env` sang `LEGAL_REPOSITORY=supabase`, khởi động lại server và chạy `npm run evaluate`.

### Rollback

Publish lại artifact của phiên bản trước (cùng lệnh, với artifact/manifest cũ) sẽ kích hoạt lại phiên bản
đó trong một transaction. Khẩn cấp có thể đổi `LEGAL_REPOSITORY=memory` rồi khởi động lại.

### Giới hạn đã biết

- `legal_documents` dùng khóa `document_id`, nên mỗi văn bản chỉ có một bản ghi metadata: chỉ một phiên
  bản corpus `active` tại một thời điểm, và đổi phiên bản cần đổi `CORPUS_VERSION` của ứng dụng.
- Bảng `legal_cross_references` chưa được ghi; ứng dụng chỉ dùng cột `cross_reference_ids`.
- 634 `parent_id` trỏ tới chunk cấp Điều không tồn tại (Điều đã tách theo Khoản); context builder bỏ qua
  an toàn.

### Kiểm chứng cục bộ ngày 2026-09-19

Chưa có credential Supabase, nên migration và lệnh publish được chạy trên PostgreSQL 16 + pgvector cục bộ
(gói `pgserver`, `unaccent` giả lập bằng `translate()`, bỏ index trigram vì không có `pg_trgm`) với đúng
artifact 649 chunk và embedding giả 1024 chiều:

| Kiểm tra | Kết quả |
| --- | --- |
| Publish lần 1 | 649 chunk `active` (632 quy phạm), 4 văn bản `active`, ≈5,5 giây |
| Publish lần 2 cùng artifact | vẫn 649 hàng, 0 chunk đổi trạng thái |
| Lỗi giả lập ở batch thứ 5 khi publish `v2` | `v1` vẫn 649 `active`; `v2` chỉ có 200 hàng `staged` |
| Chuyển `v2` ↔ `v1` | mỗi lần đúng 649 `active`, phiên bản kia `inactive` |
| Exact search cả bốn nghị định | 157 Đ2 K1, 158 Đ12 K3, 159 Đ5, 188 Đ7 K1 đều trả chunk và trang |
| Nhánh vector của hybrid search | khác rỗng; chunk có embedding trùng query xếp hạng 1 |

Đây là bằng chứng cho SQL và luồng publish, **không** thay cho lần publish thật lên Supabase.
