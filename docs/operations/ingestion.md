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
