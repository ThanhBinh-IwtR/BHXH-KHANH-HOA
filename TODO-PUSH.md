# TODO — Kiểm tra và push mã nguồn lên GitHub

## 1. Mục đích

Tài liệu này là checklist bắt buộc mỗi khi có yêu cầu đưa mã nguồn của dự án lên GitHub. Mỗi lần push
phải kiểm tra lại từ đầu; kết quả của lần trước không thay thế cho bằng chứng mới.

Trong dự án này, hai thao tác sau là độc lập:

- **Publish corpus**: nạp và kích hoạt dữ liệu pháp luật trên Supabase theo quy trình ingestion.
- **Publish mã nguồn**: commit và push repository Git lên GitHub.

Yêu cầu push mã nguồn không tự động cho phép publish corpus, dùng credential chưa được cung cấp, tạo
repository mới hoặc thay đổi phạm vi dữ liệu pháp luật.

## 2. Thông tin cần có trước lần push đầu tiên

- [ ] URL repository GitHub hoặc tên tài khoản/tổ chức và tên repository cần tạo.
- [ ] Repository đã tồn tại hay cần tạo mới.
- [ ] Chế độ hiển thị nếu cần tạo mới: public hoặc private.
- [ ] Remote cần dùng, mặc định là `origin` nếu người dùng không chỉ định tên khác.
- [ ] Nhánh đích và cách xử lý nhánh hiện tại.
- [ ] Phạm vi thay đổi cần commit; không mặc định gom toàn bộ dirty worktree.
- [ ] Commit message hoặc quyền để soạn commit message từ nội dung thay đổi.
- [ ] Cách xác thực GitHub đã sẵn sàng mà không đưa token, mật khẩu hoặc private key vào repository.
- [ ] Địa chỉ GitHub noreply dùng cho author/committer của snapshot publish sạch.

Nếu một lựa chọn có thể làm thay đổi lịch sử Git, ghi đè nhánh từ xa, công khai dữ liệu hoặc mở rộng
phạm vi commit, phải dừng và hỏi người dùng trước.

## 3. Checklist bắt buộc cho mỗi yêu cầu push

Các ô dưới đây được hiểu là checklist mới cho từng lần push. Không được suy ra trạng thái `[x]` từ
một lần chạy cũ. Kết quả thực tế được báo lại cho người dùng trước và sau khi push.

### A. Nắm context và phạm vi

- [ ] Đọc `Abstract.md` để nắm mục tiêu, kiến trúc, dữ liệu và ràng buộc hiện tại.
- [ ] Đọc toàn bộ `TODO-PUSH.md` trước khi chạy lệnh thay đổi trạng thái Git hoặc GitHub.
- [ ] Đọc `README.md` và tài liệu vận hành có liên quan nếu thay đổi chạm tới cách cài đặt, deploy,
      ingestion, evaluation hoặc provider.
- [ ] Chạy `git status --short --branch` và xác nhận branch hiện tại không ở detached HEAD.
- [ ] Chạy `git remote -v`; đối chiếu remote và repository đích với thông tin người dùng cung cấp.
- [ ] Xác định rõ tệp nào thuộc lần push này, tệp nào là thay đổi đang làm dở cần giữ nguyên.

### B. Rà soát nội dung sẽ đưa lên GitHub

- [ ] Xem danh sách tệp tracked, modified, deleted và untracked trong phạm vi commit.
- [ ] Đọc diff đầy đủ của các tệp dự kiến commit, kể cả staged diff nếu đã có nội dung trong index.
- [ ] Kiểm tra `.gitignore` bằng `git check-ignore -v` đối với secret, dependency, build output, cache,
      corpus sinh tự động, coverage, log, báo cáo kiểm thử và thư mục tạm.
- [ ] Tìm credential hoặc dữ liệu nhạy cảm trong nội dung dự kiến commit. Không in giá trị secret ra log
      hoặc báo cáo; chỉ nêu tên tệp và loại vấn đề nếu phát hiện.
- [ ] Kiểm tra tệp lớn. GitHub chặn tệp lớn hơn 100 MiB; tệp nhị phân cần thiết phải được xác nhận về
      mục đích, nguồn gốc và quyền phân phối.
- [ ] Xác nhận bốn PDF trong `LUATBHXHBHYT2024/` là corpus nguồn cần theo dõi. Không xóa hoặc chuyển
      sang Git LFS nếu chưa có quyết định riêng.
- [ ] Xác nhận `.env.example` chỉ chứa tên biến hoặc giá trị mẫu an toàn; mọi `.env` thực phải bị ignore.
- [ ] Dùng allowlist publish sau; mọi đường dẫn không có trong danh sách phải để ngoài commit:
  - Tệp cấu hình gốc cần để cài đặt, build, lint, test và chạy Next.js/Python.
  - `src/`, `ingestion/`, `supabase/migrations/`, `scripts/` và `tests/`.
  - `public/brand/` với asset chính thức cùng thông tin nguồn gốc.
  - `README.md`, `Abstract.md`, `TODO-MVP-DEMO.md`, `TODO-PUSH.md` và `docs/operations/`.
  - Đúng bốn PDF trong `LUATBHXHBHYT2024/`, đối chiếu SHA-256 với manifest trước mỗi lần publish.
- [ ] Không publish `.agents/`, `.codex/`, `.claude/`, `.cursor/`, `.continue/`, `.history/`,
      `.superpowers/`, `.tools/`, `docs/superpowers/`, corpus sinh tự động, cache, log hoặc báo cáo test.
- [ ] Kiểm tra metadata commit. Nếu lịch sử cũ chứa email không phải GitHub noreply, không push lịch sử
      đó; tạo root commit sạch từ allowlist và giữ nguyên branch làm việc cục bộ.

Nếu secret từng được commit, chỉ thêm nó vào `.gitignore` là chưa đủ. Phải dừng push, báo người dùng và
lập phương án thu hồi credential cùng xử lý lịch sử Git trước khi tiếp tục.

### C. Chọn và chạy kiểm chứng

- [ ] Chọn lệnh kiểm chứng theo phạm vi thay đổi; không dùng kết quả cũ để kết luận lần push hiện tại.
- [ ] Với thay đổi TypeScript/Next.js thông thường, chạy `npm run verify`.
- [ ] Với thay đổi ingestion Python, chạy tối thiểu `python -m pytest tests/ingestion -q`; chạy thêm quality
      gate hoặc ingestion smoke nếu hành vi tạo corpus thay đổi.
- [ ] Với thay đổi UI hoặc source/PDF runtime, chạy Playwright phù hợp sau khi unit test và build đạt.
- [ ] Với thay đổi retrieval, answer schema, provider hoặc cấu hình demo, chạy evaluation/smoke tương ứng
      khi có đủ credential và khi người dùng đã cho phép gọi dịch vụ ngoài.
- [ ] Với thay đổi chỉ gồm tài liệu hoặc `.gitignore`, kiểm tra diff, liên kết/đường dẫn và ignore rules;
      không bắt buộc chạy toàn bộ test nếu mã thực thi không đổi.
- [ ] Ghi rõ lệnh nào đã chạy, kết quả, lệnh nào chưa chạy và lý do.

Test pass không thay thế cho việc đọc diff. Ngược lại, diff sạch cũng không chứng minh mã nguồn build hoặc
chạy đúng.

### D. Chuẩn bị commit

- [ ] Chỉ stage đúng phạm vi đã thống nhất, dùng đường dẫn cụ thể thay vì `git add .` khi worktree có thay
      đổi không liên quan.
- [ ] Với snapshot publish sạch, dùng index tạm hoặc worktree riêng để branch/index đang làm việc không
      bị thay đổi; index mới phải bắt đầu từ cây rỗng và chỉ nhận đường dẫn trong allowlist.
- [ ] Chạy `git diff --cached --check` để phát hiện lỗi whitespace và conflict marker cơ bản.
- [ ] Đọc lại `git diff --cached --stat` và `git diff --cached` trước khi commit.
- [ ] Soạn commit message ngắn, nêu đúng mục đích thay đổi.
- [ ] Tạo commit mà không sửa, bỏ hoặc ghi đè thay đổi ngoài phạm vi.
- [ ] Xác nhận commit vừa tạo bằng `git show --stat --oneline --decorate HEAD`.

Không amend, rebase, reset, force-push hoặc xóa branch làm việc nếu người dùng chưa yêu cầu rõ.

### E. Kiểm tra đích GitHub

- [ ] Xác nhận remote URL, tên repository, tài khoản/tổ chức và branch đích lần cuối.
- [ ] Kiểm tra nhánh từ xa trước khi push để tránh ghi đè commit mới của người khác.
- [ ] Nếu repository chưa tồn tại, xin xác nhận trước khi tạo vì đây là thay đổi trạng thái bên ngoài.
- [ ] Nếu nhánh chưa có upstream, chuẩn bị lệnh `git push -u <remote> <branch>`.
- [ ] Nếu Git báo non-fast-forward hoặc lịch sử khác nhau, dừng lại và báo cáo; không tự force-push.

### F. Push và kiểm tra kết quả

- [ ] Chạy lại kiểm tra ngắn về branch, commit và working tree ngay trước khi push.
- [ ] Push đúng remote và branch đã xác nhận.
- [ ] Kiểm tra exit code và output của lệnh push.
- [ ] Đối chiếu commit trên remote với `HEAD` cục bộ.
- [ ] Báo URL repository/branch, commit hash, phạm vi đã push và trạng thái kiểm chứng.
- [ ] Liệt kê các thay đổi cục bộ còn lại chưa được push, nếu có.

## 4. Điều kiện phải dừng

Không push khi gặp một trong các trường hợp sau:

- Thiếu repository đích, branch đích hoặc phạm vi commit.
- Phát hiện secret, credential thật, dữ liệu cá nhân hoặc tệp không rõ quyền phân phối.
- Có tệp trên 100 MiB chưa có phương án được duyệt.
- Test hoặc build bắt buộc thất bại và người dùng chưa chấp nhận ngoại lệ sau khi được báo đầy đủ.
- Remote có commit mới tạo xung đột với lịch sử cục bộ.
- Thao tác cần force-push, viết lại lịch sử hoặc ghi đè nội dung ngoài phạm vi đã thống nhất.
- GitHub yêu cầu đăng nhập hoặc quyền mà môi trường hiện tại chưa có.

Khi dừng, báo chính xác bước nào chưa đạt, bằng chứng hiện có và thông tin cần người dùng cung cấp.

## 5. Mẫu báo cáo trước khi push

```text
Repository/remote:
Branch cục bộ -> branch đích:
Commit dự kiến:
Tệp trong phạm vi:
Kiểm tra secret và tệp lớn:
Lệnh kiểm chứng đã chạy:
Các thay đổi không thuộc phạm vi còn giữ lại:
Rủi ro hoặc ngoại lệ:
Trạng thái: sẵn sàng push / chưa sẵn sàng
```

## 6. Mẫu báo cáo sau khi push

```text
Repository/branch:
Commit đã push:
Kết quả lệnh push:
Kiểm tra commit trên remote:
Thay đổi cục bộ chưa push:
Việc còn lại:
```
