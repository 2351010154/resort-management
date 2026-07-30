# Phụ lục

## A. Danh mục từ viết tắt và thuật ngữ

Bảng này là **quy ước dịch bắt buộc** cho toàn báo cáo. Một thuật ngữ được dịch
khác nhau ở hai chương là lỗi biên soạn, và bảng này tồn tại để ngăn điều đó.

| Thuật ngữ | Tiếng Việt trong báo cáo | Giữ nguyên tiếng Anh? |
|---|---|---|
| PMS (Property Management System) | hệ thống quản lý khách sạn | ✅ giữ khi viết tắt |
| Folio | sổ chi phí phòng / **folio** | ✅ **giữ** — không có từ tiếng Việt gọn tương đương |
| Night audit | chốt sổ đêm / **night audit** | ✅ **giữ** — thuật ngữ nghiệp vụ chuẩn |
| Business date | ngày làm việc | — |
| Rate plan | bảng giá / **rate plan** | ✅ giữ |
| Rate calendar | lịch giá | — |
| ADR (Average Daily Rate) | giá bình quân ngày | ✅ giữ viết tắt |
| RevPAR (Revenue per Available Room) | doanh thu trên mỗi buồng khả dụng | ✅ giữ viết tắt |
| Occupancy | công suất buồng | — |
| Idempotency | tính idempotent | ✅ giữ |
| State machine | máy trạng thái | — |
| Hold | giữ chỗ / **hold** | ✅ giữ khi nói về trạng thái `HELD` |
| No-show | khách không đến / **no-show** | ✅ giữ |
| Out-of-order | buồng đóng / **out-of-order** | ✅ giữ |
| Housekeeping status | trạng thái buồng phòng | — |
| Reversing entry | bút toán đảo | — |
| Oversell | bán vượt buồng | — |
| Exclusion constraint | ràng buộc loại trừ | ✅ giữ `EXCLUDE USING gist` |
| Contract-first | contract-first | ✅ giữ |
| Room | buồng | — |
| Room type | loại buồng | — |
| Booking | đặt phòng / booking | ✅ giữ khi chỉ thực thể |
| Check-in / check-out | nhận phòng / trả phòng | — |
| Walk-in | khách vãng lai | — |
| Shift handover | bàn giao ca | — |
| Cash drawer | két tiền mặt | — |
| Income / expense | thu chi | — |
| HĐĐT | hoá đơn điện tử | — |
| — | hoá đơn điện tử khởi tạo từ máy tính tiền | ✅ giữ nguyên cụm tiếng Việt |
| HSM (Hardware Security Module) | chữ ký số HSM / ký số từ xa | ✅ giữ |
| CCCD | căn cước công dân | — |
| IPN (Instant Payment Notification) | callback thanh toán | ✅ giữ viết tắt |
| RBAC | phân quyền theo vai trò | ✅ giữ viết tắt |
| ERD | sơ đồ thực thể liên kết | ✅ giữ viết tắt |
| TTL (Time To Live) | thời gian sống | ✅ giữ viết tắt |
| CTA / CTD | đóng nhận / đóng trả (closed-to-arrival / closed-to-departure) | ✅ giữ viết tắt |
| Snapshot | ảnh chụp trạng thái / snapshot | ✅ giữ |
| Seed data | dữ liệu mẫu | — |
| Bundle budget | ngân sách bundle | ✅ giữ |

## B. Bảng đối chiếu yêu cầu

Đây là hiện vật quan trọng nhất của phụ lục: nó vừa chứng minh đồ án hoàn thành,
vừa chứng minh không yêu cầu nào bị bỏ sót.

| # | Gạch đầu dòng đề bài | Mốc / epic | Mã issue | Mục báo cáo | Bằng chứng |
|---|---|---|---|---|---|
| 1 | Phân quyền ≥ 3 mức | `P0-AUTH` | | Ch2 §2.4, §2.6; Ch5 | *chưa* |
| 2 | Loại phòng và thuộc tính | `P1-SCH-01` | | Ch5 §5.2 | *chưa* |
| 3 | Tài khoản khách | M7 | | Ch2 §2.1 | *chưa* |
| 4 | Phản hồi sau lưu trú | M7 | | Ch2 §2.1 | *chưa* |
| 5 | Hiển thị phòng trống | `P1-AVL-01` | | Ch5 §5.3 | *chưa* |
| 6 | Tìm kiếm | `P2-SRC` | | Ch2 §2.1 | *chưa* |
| 7 | Báo cáo có biểu đồ | M9 | | Ch5 §5.5.4 | *chưa* |
| 8 | Bàn giao ca | M8 | | Ch2 §2.5 | *chưa* |
| 9 | Nhật ký kiểm toán | M8 | | Ch5 §5.6 | *chưa* |
| 10 | Xuất Excel | M8 | | Ch3 §3.8 | *chưa* |
| 11 | Thu chi | M8 | | Ch5 §5.2 | *chưa* |
| 12 | Thanh toán trực tuyến | `P3-PAY` | | Ch5 §5.5.2, §5.7 | *chưa* |

Cột "Mã issue" và "Bằng chứng" được điền **trong lúc tạo và đóng ticket**, không
phải ở cuối dự án.

## C. Nguồn quyết định

Báo cáo không duy trì một danh mục ADR song song. Bản đồ thẩm quyền tại
[`docs/README.md`](../README.md) chỉ tới tài liệu sở hữu từng quyết định; chương
2–6 chỉ dẫn lại lý do cần cho bài báo cáo. `G1` đã đóng và bằng chứng nằm tại
[`docs/architecture/tech-stack.md`](../architecture/tech-stack.md), không còn là
câu hỏi hay ADR cần sinh.

## D. Hướng dẫn cài đặt

Hướng dẫn chạy toàn workspace thuộc
[`README.md`](../../README.md#getting-started); lệnh và yêu cầu riêng của API
thuộc [`apps/api/README.md`](../../apps/api/README.md#commands). API đã có
package, schema identity/guest-auth và lệnh chạy; admin vẫn là ranh giới dự
kiến. Phụ lục không chép lại chuỗi lệnh vì manifest và README sở hữu chúng sẽ
thay đổi trước bản báo cáo này.

## E. Tài liệu tham khảo

### Văn bản pháp luật

[1] Chính phủ nước CHXHCN Việt Nam, *Nghị định số 70/2025/NĐ-CP* sửa đổi, bổ
sung một số điều của Nghị định số 123/2020/NĐ-CP quy định về hoá đơn, chứng từ.
Hiệu lực 01/06/2025. — **Trạng thái: nội dung đã kiểm chứng; phạm vi áp dụng đối
với pháp nhân vận hành Mariva đang chờ xác nhận của đại lý thuế (`M0-06`).**

[2] Quốc hội nước CHXHCN Việt Nam, *Luật Cư trú* và các văn bản hướng dẫn về
thông báo lưu trú. — **Trạng thái: mức sàn lưu trữ luật định chưa xác minh, chờ
tư vấn pháp lý (`M0-05`).**

[3] Chính phủ nước CHXHCN Việt Nam, *Nghị định số 13/2023/NĐ-CP* về bảo vệ dữ
liệu cá nhân; *Nghị định số 53/2022/NĐ-CP* quy định chi tiết Luật An ninh mạng.
— **Trạng thái: nghĩa vụ về nơi lưu trữ dữ liệu CCCD ở nước ngoài chưa xác minh.**

### Tài liệu kỹ thuật của nhà cung cấp

[4] VNPay, *Tài liệu tích hợp cổng thanh toán*, `sandbox.vnpayment.vn/apis/docs/`.

[5] `lehuygiang28/vnpay`, thư viện Node.js cho VNPay, `vnpay.js.org`.

[6] MoMo, *Tài liệu API thanh toán*, `developers.momo.vn`.

[7] Viettel, *S-Invoice API documentation* và giải pháp ký số HSM.

[8] MISA, *meInvoice Open API documentation*.

[9] Neon, *Documentation — regions, PITR, branching, autosuspend*, `neon.tech/docs`.

[10] Cloudflare, *R2 documentation — lifecycle rules, presigned URLs*, `developers.cloudflare.com/r2`.

[11] Fly.io, *Documentation — regions, Dockerfile deployment*, `fly.io/docs`.

[12] Resend, *Documentation*, `resend.com/docs`.

### Tài liệu kỹ thuật của thư viện và framework

[13] NestJS, *Documentation*, `docs.nestjs.com`.

[14] Drizzle ORM, *Documentation*, `orm.drizzle.team`.

[15] oRPC, *Documentation — contract-first, NestJS integration, OpenAPI*, `orpc.dev`.

[16] PostgreSQL Global Development Group, *PostgreSQL Documentation — Range Types,
Exclusion Constraints, btree_gist*, `postgresql.org/docs`.

[17] pg-boss, *Documentation*, `github.com/timgit/pg-boss`.

[18] Testcontainers, *Node.js documentation*, `node.testcontainers.org`.

[19] fast-check, *Documentation — property based testing*, `fast-check.dev`.

[20] Adobe, *`@internationalized/date` documentation*, `react-spectrum.adobe.com/internationalized/date`.

[21] Vitest, *Documentation*, `vitest.dev`.

[22] Playwright, *Documentation*, `playwright.dev`.

### Tài liệu nội bộ của dự án

[23] `docs/architecture/repository-structure.md` — cấu trúc kho mã và các quy tắc phụ thuộc.

[24] `docs/architecture/rbac-matrix.md` — ma trận năng lực cho năm vai trò nhân
viên và principal `GUEST` ở realm riêng. **Nguồn có thẩm quyền** cho capability
guard; mã mirror và test nằm dưới `apps/api/src/modules/identity/rbac/`.

[25] `docs/architecture/booking-state-machine.md` — bảng chuyển trạng thái. **Nguồn có thẩm quyền** cho máy trạng thái và các test chuyển trạng thái bất hợp lệ.

[26] `plans/backlog.md` — backlog hợp nhất, nguồn cho ticket và trạng thái pha.

[27] `plans/reports/archive/advise-260726-0939-resort-pms.md` — kiến trúc và các pha. Lý lẽ có ghi ngày, **chỉ đọc**.

[28] `plans/reports/archive/advise-260726-1119-stack-selection.md` — lựa chọn công nghệ. **Chỉ đọc**.

[29] `plans/reports/archive/advise-260726-1401-infra-money-rails.md` — hạ tầng và các đường tiền. **Chỉ đọc**.

[30] `docs/README.md` — **bản đồ thẩm quyền**: mỗi miền dữ kiện ứng với đúng một tài liệu, và thứ tự ưu tiên giữa các tài liệu được phát biểu tại đây, đúng một lần.

[31] `docs/architecture/tech-stack.md` — bảng công nghệ đã chốt, chưng cất từ [28].

[32] `docs/architecture/infrastructure.md` — hạ tầng và các đường tiền đã chốt, chưng cất từ [29].

## F. Danh mục hình

| Hình | Tên | Tệp nguồn |
|---|---|---|
| 2.1 | Biểu đồ use case | `hinh/use-case.drawio` |
| 4.1 | Kiến trúc hệ thống | `hinh/kien-truc-he-thong.drawio` |
| 5.1 | ERD (thiết kế đề xuất) | `hinh/erd.drawio` |
| 5.2 | Máy trạng thái đặt phòng | `hinh/state-machine.drawio` |
| 5.3 | Giữ chỗ và xác nhận đặt phòng | `hinh/seq-1-hold-confirm.drawio` |
| 5.4 | Tính idempotent của webhook thanh toán | `hinh/seq-2-ipn.drawio` |
| 5.5 | Nhận phòng và gán buồng | `hinh/seq-3-checkin.drawio` |
| 5.6 | Night audit và chốt ngày làm việc | `hinh/seq-4-night-audit.drawio` |

Mỗi tệp `.drawio` có kèm bản xuất `.png` (rộng 3000 px, dùng để chèn vào tài
liệu) và `.svg` (vector, có nhúng XML nên mở lại được trong draw.io).

## G. Câu hỏi còn mở

Tập hợp lại từ toàn bộ báo cáo, xếp theo mức độ chặn.

| Câu hỏi | Chặn | Ai trả lời |
|---|---|---|
| Thuế suất, thời hạn ưu đãi và VAT có tính trên phí phục vụ không? | Công thức tổng tiền; các giá trị phải là cấu hình | Kế toán, bằng văn bản |
| Khi nào giường phụ bắt buộc; phí giường phụ cộng dồn hay thay thế phí người thêm? | Báo giá cho nhóm vượt occupancy bao gồm | Chủ đầu tư |
| `D8` — UML nghiêm ngặt hay sơ đồ sinh tự động? | Hình trong báo cáo | Giảng viên |
| Giảng viên có chấp nhận ranh giới phạm vi theo pha hay yêu cầu một hệ thống hoàn chỉnh duy nhất? | Cách trình bày phạm vi và kết quả | Giảng viên |
| Ràng buộc định dạng và ngày nộp là gì? | Lắp ráp bản nộp | Giảng viên / sinh viên |
| Nghị định 70/2025 có áp dụng cho pháp nhân và mã ngành này không? | Loại HĐĐT, SKU và luồng phát hành | Đại lý thuế, bằng văn bản |
| `N`, mức sàn lưu trữ bản ghi và việc lưu CCCD ở Singapore có hợp lệ không? | Cấu hình lifecycle và nơi lưu trữ | Luật sư, bằng văn bản |
| VNPay có cấp quyền sandbox hoàn tiền không? | Bằng chứng kiểm thử đường hoàn tiền | VNPay |
