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

## C. Danh mục ADR

Các quyết định kiến trúc được ghi thành tệp `docs/adr/NNNN-slug.md` với bốn mục:
**bối cảnh, quyết định, lý do, hệ quả**, kèm ngày.

> 🔶 Thư mục `docs/adr/` chưa được tạo. Bảng dưới đây liệt kê những quyết định
> **đã chốt** cần backfill, cùng những quyết định sẽ sinh ADR khi được chốt.

### Cần backfill — đã quyết định

| # | Quyết định | Ghi ở |
|---|---|---|
| 1 | Monorepo pnpm + Turborepo, một API ba consumer | Ch4 §4.2 |
| 2 | Modular monolith thay vì microservice | Ch4 §4.1 |
| 3 | NestJS 11 + Express 5 | Ch3 §3.3 |
| 4 | Postgres, với bất biến cưỡng chế bởi ràng buộc | Ch5 §5.3 |
| 5 | **Drizzle thay vì Prisma** | Ch3 §3.4.1 |
| 6 | **oRPC thay vì ts-rest — một lần đảo quyết định** | Ch3 §3.6 |
| 7 | **pg-boss thay vì Redis/BullMQ**, và đặt ở P3 chứ không P6 | Ch3 §3.4.2; Ch6 §6.6 |
| 8 | Tồn kho hai tầng | Ch5 §5.3 |
| 9 | `bigint` VND, không dùng thư viện tiền tệ | Ch3 §3.5 |
| 10 | `@internationalized/date` — bất biến ngày thành lỗi biên dịch | Ch3 §3.5 |
| 11 | Hai realm xác thực tách biệt | Ch2 §2.4 |
| 12 | Neon / Fly.io / Vercel / R2 / Resend / Better Stack, region Singapore | Ch8 §8.2 |
| 13 | VNPay trước, MoMo có điều kiện | Ch6 §6.2 |
| 14 | Ảnh giấy tờ: 30 ngày, cưỡng chế bởi lifecycle rule | Ch5 §5.8 |
| 15 | SKU hoá đơn từ máy tính tiền + chứng thư HSM | Ch5 §5.7 |
| 16 | Không bao giờ xây đường ghi offline | Ch8 §8.6.1 |
| 17 | Tailwind 4 cho admin, CSS Modules giữ nguyên cho web | Ch3 §3.7 |
| 18 | Testcontainers thay vì service container của CI | Ch7 §7.2.1 |

### Sẽ sinh ADR khi được chốt

`D1` dữ kiện cơ sở · `D2` mô hình thuế · `D3` lưới huỷ · `D4` cơ cấu giá ·
`D7` danh mục dịch vụ · `D8` ký pháp sơ đồ · `G1` kết quả spike oRPC.

## D. Hướng dẫn cài đặt

> 🔶 Chỉ phần `apps/web` chạy được ở thời điểm này. Phần API và admin sẽ bổ sung
> khi `P0-API-01` và `P2-UI` hoàn tất.

### Yêu cầu

- Node.js — dòng LTS chẵn (xem `.nvmrc`)
- pnpm 11.1.2
- Docker Desktop — **bắt buộc** cho Testcontainers và Postgres cục bộ

### Các bước

```bash
pnpm install
pnpm dev        # chạy toàn workspace qua Turborepo
pnpm build
pnpm lint
pnpm typecheck
pnpm test       # sẽ chạy khi P0-CI-04 hoàn tất
```

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

[24] `docs/architecture/rbac-matrix.md` — ma trận phân quyền sáu vai trò. **Nguồn có thẩm quyền** cho guard `@Roles()` và test của nó.

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

| # | Câu hỏi | Chặn | Ai trả lời |
|---|---|---|---|
| 1 | `D1`–`D4`, `D7` — dữ kiện cơ sở, mô hình thuế, lưới huỷ, cơ cấu giá, danh mục dịch vụ | Tiêu chí nghiệm thu M3 và M6, và quy tắc nghiệp vụ ở Ch2. **Điểm nghẽn lớn nhất** | Chủ đầu tư + kế toán |
| 2 | `G1` — `@orpc/nest` có cưỡng chế contract ở mức biên dịch không? | Toàn bộ tầng contract (Ch3 §3.6) | Spike 30 phút |
| 3 | `D8` — ký pháp sơ đồ: UML nghiêm ngặt hay sơ đồ sinh tự động | Ch2, Ch4, Ch5 | Giảng viên |
| 4 | Giảng viên có chấp nhận ranh giới phạm vi theo pha (Ch1 §1.4) hay yêu cầu một hệ thống hoàn chỉnh duy nhất? | Cách trình bày Ch1 và Ch9 | Giảng viên |
| 5 | Ràng buộc định dạng — số trang, kiểu trích dẫn, phương thức nộp | Mật độ bảng ở Ch3, số lượng hình | Giảng viên |
| 6 | Ngày tháng nộp | Ch0 trang bìa | Sinh viên — phụ thuộc hạn nộp |
| 7 | Nghị định 70/2025 có ràng buộc mã ngành của pháp nhân này không? | Việc mua SKU HĐĐT, không chặn mã | Đại lý thuế |
| 8 | Lưu trữ CCCD ở nước ngoài và mức sàn lưu trữ luật định | Giá trị `N` trong cấu hình | Luật sư |
| 9 | VNPay có cấp quyền sandbox hoàn tiền không? | Chiến lược kiểm thử đường hoàn tiền ở P3 | VNPay |

**Đã đóng:** hạn nộp đồ án — chưa ấn định và còn xa (xác nhận 2026-07-26). Điều
này hợp thức hoá chiến lược xây-trước-viết-sau ở Ch6 §6.8. Đối chiếu lại với
bảng mốc khi hạn nộp được ấn định.
