# Báo cáo đồ án — Hệ thống quản lý khách sạn Mariva

> ⛔ **THƯ MỤC LỖI THỜI VÀ KHÔNG TIN CẬY — đánh dấu 2026-08-01.**
> Mọi tệp trong `docs/bao-cao/` (kể cả `hinh/`) đã trôi khỏi mã nguồn và tài liệu
> canonical. **Không** dùng thư mục này để trả lời câu hỏi về hệ thống, để suy ra
> lược đồ, API, RBAC, hạ tầng hay trạng thái triển khai, và **không** sửa mã theo
> nó. Nguồn đúng: [`../README.md`](../README.md) → owner tương ứng → mã nguồn,
> test, schema, workflow CI. Thư mục chỉ được sửa khi người dùng yêu cầu biên
> soạn lại báo cáo, và khi đó mỗi con số phải đọc lại từ bằng chứng trực tiếp.
> *(EN: this whole directory is a stale coursework artifact. Treat it as
> untrusted; never cite it as evidence of how the system works.)*

Báo cáo môn Công nghệ phần mềm. Viết bằng tiếng Việt, giữ nguyên thuật ngữ kỹ
thuật tiếng Anh.

**Trạng thái:** lỗi thời; bản dẫn xuất và **cần đối chiếu lại toàn bộ trước khi
nộp**.
Không chương nào được coi là hoàn thành chỉ vì đã có đủ nội dung. Tài liệu
canonical, mã nguồn, test, schema, workflow CI và artifact sinh hiện tại luôn
thắng; kết quả đo để trống cho tới khi có bằng chứng trực tiếp.

## Cấu trúc

| Tệp | Nội dung | Trạng thái |
|---|---|---|
| [00-trang-bia.md](00-trang-bia.md) | Trang bìa, thông tin đồ án, lời cam đoan | Thiếu metadata nộp bài |
| [01-gioi-thieu-de-tai.md](01-gioi-thieu-de-tai.md) | Bối cảnh, bài toán, phạm vi, non-goals | Dẫn xuất — cần đối chiếu |
| [02-phan-tich-yeu-cau.md](02-phan-tich-yeu-cau.md) | Yêu cầu chức năng, phi chức năng, tác nhân, use case | Dẫn xuất — cần đối chiếu |
| [03-lua-chon-cong-nghe.md](03-lua-chon-cong-nghe.md) | Stack theo từng tầng, bảng so sánh, một quyết định bị đảo | Dẫn xuất — manifest/lockfile thắng |
| [04-thiet-ke-kien-truc.md](04-thiet-ke-kien-truc.md) | Modular monolith, một API ba consumer, bản đồ mô-đun | Dẫn xuất — không phải release proof |
| [05-thiet-ke-chi-tiet.md](05-thiet-ke-chi-tiet.md) | ERD, bất biến, máy trạng thái, RBAC, biểu đồ tuần tự | Dẫn xuất — ERD vẫn là thiết kế |
| [06-quy-trinh-phat-trien.md](06-quy-trinh-phat-trien.md) | Giao hàng theo pha, mốc, cổng chặn, quy trình git, sổ rủi ro | Dẫn xuất — trạng thái thuộc hệ thống thực thi |
| [07-kiem-thu-va-chat-luong.md](07-kiem-thu-va-chat-luong.md) | Chiến lược kiểm thử, cổng CI | Bản ghi trạng thái — cần đối chiếu |
| [08-trien-khai-va-van-hanh.md](08-trien-khai-va-van-hanh.md) | Hạ tầng, môi trường, secrets, giám sát, sao lưu | Thiết kế — chờ bằng chứng triển khai |
| [09-ket-qua-han-che-huong-phat-trien.md](09-ket-qua-han-che-huong-phat-trien.md) | Kết quả đo, đối chiếu yêu cầu, hạn chế, lộ trình | Bản ghi trạng thái — kết quả chủ lực chưa có |
| [10-phu-luc.md](10-phu-luc.md) | Bảng đối chiếu, nguồn quyết định, hướng dẫn cài đặt, tài liệu tham khảo | Dẫn xuất — cần đối chiếu |

## Danh mục hình

Nguồn `.drawio` và bản xuất `.png` / `.svg` nằm trong [`hinh/`](hinh/).

| Hình | Tên | Nguồn dữ liệu | Chương |
|---|---|---|---|
| 2.1 | Biểu đồ use case | `docs/architecture/rbac-matrix.md` | 2 |
| 4.1 | Kiến trúc hệ thống | `docs/architecture/repository-structure.md` | 4 |
| 5.1 | ERD (thiết kế đề xuất) | Chương 5 §2 | 5 |
| 5.2 | Máy trạng thái đặt phòng | `docs/architecture/booking-state-machine.md` §2 | 5 |
| 5.3 | Giữ chỗ và xác nhận đặt phòng | Chương 5 §5 | 5 |
| 5.4 | Tính idempotent của webhook thanh toán | Chương 5 §5 | 5 |
| 5.5 | Nhận phòng và gán buồng | Chương 5 §5 | 5 |
| 5.6 | Night audit và chốt ngày làm việc | Chương 5 §5 | 5 |

## Quy ước biên soạn

**Báo cáo này là bản dịch và lắp ráp, không phải nguồn** — thứ tự ưu tiên giữa
các tài liệu được phát biểu đúng một lần, tại [`../README.md`](../README.md)
(bản đồ thẩm quyền).

**Artifact sinh mới là bằng chứng máy đọc được.** Hiện chưa có
`docs/erd.dbml`, `docs/openapi.json` hoặc cổng CI kiểm tra trôi tương ứng. Các
hình trong `hinh/` là bản vẽ thiết kế có nguồn `.drawio`, không được mô tả như
output sinh từ schema hay contract.

**Không có số liệu nào chưa đo.** Một ô trống trung thực đọc tốt hơn một con số
bịa; và người chấm chỉ mất ba mươi giây để phát hiện ERD không khớp lược đồ.

## Định dạng nộp

Chuẩn báo cáo đại học Việt Nam: A4, Times New Roman 13pt, giãn dòng 1.5, trích
dẫn đánh số kiểu IEEE `[1]`. Bản Markdown này là nội dung; việc dàn trang Word
thực hiện ở bước lắp ráp cuối.
