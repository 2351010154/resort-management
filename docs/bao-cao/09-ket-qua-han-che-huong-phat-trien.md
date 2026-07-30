# Chương 9 — Kết quả, hạn chế và hướng phát triển

> ⚠ **Đây là chương dẫn xuất và đang cần đối chiếu.** §9.2 và §9.3 chỉ được
> điền bằng bằng chứng trực tiếp; không có ô nào được điền bằng ước lượng.
> Trước khi nộp phải kiểm lại chương này với tài liệu canonical, mã nguồn, test,
> schema, workflow CI và artifact sinh hiện tại.

## 9.1 Trạng thái tại thời điểm biên soạn

Đây là ảnh chụp đối chiếu có thể cũ đi; các đường dẫn ở cột bằng chứng mới là
chủ sở hữu hiện tại.

| Bề mặt | Bằng chứng hiện tại | Kết luận hẹp |
|---|---|---|
| `apps/web` | `apps/web/package.json`, `apps/web/app/`, `apps/web/features/` | Bề mặt marketing, auth và booking đã có mã; trạng thái từng yêu cầu không suy ra từ việc route tồn tại |
| `apps/api` | [`app.module.ts`](../../apps/api/src/app.module.ts), [`package.json`](../../apps/api/package.json) | API nền tảng, health, identity, notification và hai realm auth đã tồn tại |
| Lược đồ API | [`schema/index.ts`](../../apps/api/src/database/schema/index.ts), [`migrations/`](../../apps/api/src/database/migrations/) | Đã có schema/migration identity và guest auth; chưa có schema inventory/booking/folio |
| `packages/shared` | [`src/index.ts`](../../packages/shared/src/index.ts) | Primitive/codec ngày, tiền và contract lịch giá đã tồn tại; router oRPC chưa có |
| `apps/admin`, `packages/api-client` | README/ranh giới dự kiến | Chưa phải bề mặt sản phẩm có thể tuyên bố hoàn thành |
| CI và test | [workflow CI](../../.github/workflows/ci.yml), test cạnh mã trong `apps/api` và `packages/shared` | Test tồn tại và chạy được cục bộ khi có database test; workflow CI hiện chưa chạy bước test |
| Artifact sinh | `docs/erd.dbml`, `docs/openapi.json` | Chưa tồn tại; các hình thiết kế và mô tả contract không phải artifact sinh |

Kiến trúc được phép đi trước mã, nhưng không được đọc như release proof. Trạng
thái công việc thuộc hệ thống thực thi được chỉ ra tại
[`docs/README.md`](../README.md).

## 9.2 Kết quả đo

> ⚠ **Chưa có bằng chứng cho các kết quả chủ lực dưới đây.** Kho mã đã có test
> cho primitive, auth và RBAC, nhưng đó không phải bằng chứng thay thế cho test
> tương tranh inventory, toàn vẹn folio, E2E nhận phòng hoặc ngân sách bundle.

Bốn kết quả dưới đây được xác định là **kết quả chủ lực** của báo cáo — tức là
những con số mà, khi có, sẽ mang phần lớn sức nặng của chương này.

| # | Kết quả chủ lực | Vì sao nó quan trọng | Sinh ra tại | Đo được |
|---|---|---|---|---|
| 1 | **50 lần đặt song song trên buồng cuối cùng → 1 thành công, 49 lần 409 sạch** | Chứng minh mục tiêu G1 dưới điều kiện tương tranh, tại tầng cưỡng chế của database | `P1-INV-05` | *chưa* |
| 2 | **Σ bút toán = Σ thanh toán + công nợ, khẳng định mỗi đêm** | Chứng minh mục tiêu G3 — toàn vẹn tài chính | P3, P6 | *chưa* |
| 3 | **E2E nhận phòng chỉ bằng bàn phím, 0 sự kiện chuột** | Chứng minh "bàn phím là chính" là kiến trúc, không phải khẩu hiệu | P2 | *chưa* |
| 4 | **0 byte `three`/`gsap`/`lenis` trong bundle `/booking`** | Chứng minh sự cô lập route group là ràng buộc cưỡng chế được, không phải quy ước | P4 | *chưa* |

**Kết quả số 1 là hình mạnh nhất mà báo cáo này có thể chứa.** Phần lớn báo cáo
đồ án trình bày ảnh chụp màn hình. Cái này trình bày một **bất biến được cưỡng
chế dưới tương tranh** — cùng với câu lệnh, output đầy đủ, và định nghĩa ràng
buộc `CHECK` đã khiến nó trở thành thuộc tính cấu trúc chứ không phải nỗ lực của
tầng ứng dụng.

Đó là khác biệt giữa "hệ thống của tôi chạy" và "hệ thống của tôi không thể sai
theo cách này".

## 9.3 Đối chiếu 12 yêu cầu của đề bài

> ⚠ Cột "Bằng chứng" được điền khi mốc tương ứng hoàn tất. Chỉ tiêu là **12/12**
> trước khi tuyên bố đồ án hoàn thành.

| # | Gạch đầu dòng | Mốc / epic | Mã issue | Bằng chứng |
|---|---|---|---|---|
| 1 | Phân quyền ≥ 3 mức | `P0-AUTH` | | [`access.guard.spec.ts`](../../apps/api/src/common/auth/access.guard.spec.ts) và [`matrix.spec.ts`](../../apps/api/src/modules/identity/rbac/matrix.spec.ts) |
| 2 | Loại phòng và thuộc tính | `P1-SCH-01` | | *chưa* |
| 3 | Tài khoản khách | M7 | | Auth đã có test; hồ sơ, lịch sử lưu trú và điểm tích luỹ chưa có bằng chứng hoàn thành |
| 4 | Phản hồi sau lưu trú | M7 | | *chưa* |
| 5 | Hiển thị phòng trống | `P1-AVL-01` | | *chưa* |
| 6 | Tìm kiếm | `P2-SRC` | | *chưa* |
| 7 | Báo cáo có biểu đồ | M9 | | *chưa* |
| 8 | Bàn giao ca | M8 | | *chưa* |
| 9 | Nhật ký kiểm toán | M8 | | *chưa* |
| 10 | Xuất Excel | M8 | | *chưa* |
| 11 | Thu chi | M8 | | *chưa* |
| 12 | Thanh toán trực tuyến | `P3-PAY` | | *chưa* — **một** cổng production đóng yêu cầu này |

Mã issue và trạng thái thuộc hệ thống thực thi. Cột bằng chứng chỉ được điền khi
có source/test/schema/artifact chứng minh trọn vẹn yêu cầu, không chỉ khi ticket
được đóng.

## 9.4 Hạn chế

Phần này viết được ngay, vì hạn chế là hệ quả của các quyết định đã đưa ra.

### 9.4.1 Hạn chế do phạm vi

| Hạn chế | Hệ quả |
|---|---|
| **Không có OTA channel manager** | Khu nghỉ dưỡng mới nhận phần lớn đặt phòng năm đầu qua OTA. Tới P8, có người chặn tồn kho thủ công trên Booking.com/Agoda/Traveloka. **Đây là nguồn đặt trùng thật sự duy nhất mà ràng buộc database không ngăn được**, vì nó xảy ra bên ngoài database |
| Không tích hợp khai báo lưu trú / cổng ASM | Khối lượng khai báo thủ công cộng một khoảng trống tuân thủ. Cần xem lại trước khi khai trương |
| Một cơ sở, không đa chi nhánh | Không có lớp trừu tượng tenant. Mở rộng sang cơ sở thứ hai là một dự án, không phải một cấu hình |
| Không có POS ẩm thực độc lập | Dịch vụ chỉ ghi vào folio |
| Không có định giá động | Rate plan nhập tay. Không có revenue management thuật toán |
| Không có ứng dụng di động native | Chỉ web responsive |

### 9.4.2 Hạn chế do năng lực thực hiện

| Hạn chế | Hệ quả | Bù đắp |
|---|---|---|
| **Một người, không bus factor** | Không ai review; nếu người này dừng, dự án dừng | Test dồn vào đường tiền và tồn kho (không phải UI); tài liệu viết song song với mã |
| **Tự xây toàn bộ, không thuê PMS** | Ta sở hữu uptime của một doanh nghiệp mất tiền khi hệ thống chết. Không có nhà cung cấp nào để gọi lúc 23 giờ đêm Ba mươi Tết | Giám sát, cảnh báo, và một **runbook dự phòng giấy** viết như thể nó sẽ được dùng |
| **Lưu ảnh giấy tờ tuỳ thân** | Dữ liệu rủi ro cao nhất trong hệ thống | Lifecycle rule cưỡng chế thời hạn `N`; `N` là cấu hình chỉ được chốt sau tư vấn pháp lý bằng văn bản (chương 5 §5.8) |
| **Một region, một instance** | Sự cố AZ ở Singapore làm sập toàn bộ | Đánh đổi đúng ở quy mô này |

### 9.4.3 Câu hỏi bên ngoài và nghiệp vụ còn mở

Các câu hỏi dưới đây **không** được trình bày như đã kết luận, và đó là chủ ý.

| Câu hỏi | Trạng thái | Ai trả lời |
|---|---|---|
| VAT có tính trên phí phục vụ hay không; thuế suất và thời hạn ưu đãi nào áp dụng? | **Mở.** Tất cả là cấu hình, không phải hằng số | Kế toán |
| Khi nào giường phụ là bắt buộc; phí giường phụ cộng dồn hay thay thế phí người thêm? | **Mở.** Thiết kế hiện chưa được phép suy ra từ sức chứa | Chủ đầu tư |
| Nghị định 70/2025 có ràng buộc **mã ngành của pháp nhân này** không? | **Mở.** Nội dung nghị định đã kiểm chứng; phạm vi áp dụng thì chưa | Đại lý thuế (`M0-06`) |
| Lưu ảnh CCCD ở nước ngoài (Singapore) có hợp lệ không? | **Mở.** Đây là thiết kế tạm thời, không phải rủi ro pháp lý đã được chấp nhận | Luật sư (`M0-05`) |
| `N` và mức sàn lưu trữ luật định cho bản ghi lưu trú là bao nhiêu? | **Mở.** `N` là giá trị **cấu hình**, không phải hằng số | Luật sư (`M0-05`) |

Việc giữ các dòng này ở trạng thái "mở" thay vì điền một câu trả lời nghe hợp lý
là điều báo cáo cố ý làm. Một khung quyết định có ghi rõ điều chưa biết thì sống
sót qua kiểm tra; một con số trần trụi thì không.

## 9.5 Hướng phát triển

### 9.5.1 Đã lên lịch, ngoài phạm vi báo cáo

| Pha | Nội dung | Điều kiện kích hoạt |
|---|---|---|
| **P2.5** Tối ưu gán buồng | Bài toán tô màu đồ thị khoảng / đóng thùng theo thời gian. Gán buồng tối ưu + xáo trộn để nhận thêm booking lẽ ra bị từ chối | Tuỳ chọn, không chặn xương sống |
| **P3.5** MoMo | Chỉ khi đo được tỉ lệ bỏ giỏ ở bước thanh toán chỉ-có-VNPay là đáng kể. Lắp vào sau `PaymentGateway` port đã có, ~2 tuần | Dữ liệu phễu thật |
| **P6.5** Overbooking | Bán vượt 100% dựa trên mô hình tỉ lệ no-show; kéo theo chính sách chuyển khách | Cần dữ liệu no-show thật từ P6 |
| **P8** OTA channel manager | **Khoản hoãn đắt nhất trong dự án.** Ưu tiên dịch vụ channel manager hơn là tích hợp API OTA trực tiếp | Bắt đầu đánh giá trong M9 — thời gian chờ dài |

### 9.5.2 P2.5 là phần thú vị về mặt kỹ thuật

Tầng 1 nói "còn 3 buồng Deluxe trống tối nay". Nhưng một bản đồ gán buồng đóng
gói tệ sẽ **mắc kẹt tồn kho**: ba buồng trống trải trên ba đêm, mà không buồng
nào trống cả ba đêm liền.

Đây là bài toán **tô màu đồ thị khoảng / đóng thùng theo thời gian**. Hai tính
năng:

- **Gán tối ưu** — gán buồng sao cho tối đa hoá số kỳ lưu trú bán được về sau, tôn trọng sở thích khách (tầng cao, hướng biển, buồng liền kề cho gia đình).
- **Xáo trộn để vừa** — khi một booking lẽ ra bị từ chối, tìm cách gán lại các kỳ lưu trú **đã gán nhưng chưa nhận phòng** để giải phóng một buồng liền mạch. Khách sạn làm việc này thủ công hằng ngày; tự động hoá nó biến booking bị từ chối thành doanh thu.

**Ràng buộc cứng: không bao giờ dời một khách đã nhận phòng.**

Kỷ luật khiến phần này an toàn nằm ở chương 7 §7.7: giải thuật ngây thơ ở lại
làm oracle tham chiếu, và mọi đường tối ưu đều được differential test với nó.

### 9.5.3 Không nằm trong lộ trình

Đa cơ sở, ứng dụng native, POS ẩm thực độc lập, định giá động. Danh sách
non-goals ở chương 1 §1.5 làm việc nặng ngang danh sách mục tiêu, và cần được
bảo vệ.

## 9.6 Tự đánh giá

Phần này là bản tự đánh giá dẫn xuất và phải được xem lại cùng bằng chứng trước
khi nộp.

**Điều đã làm đúng, và có bằng chứng ngay bây giờ:**

- Tài liệu kiến trúc có chủ sở hữu rõ và tách ý định khỏi bằng chứng phát hành.
- `G1` đã được đo và đóng với kết quả đi tiếp; bằng chứng nằm ở
  `docs/architecture/tech-stack.md`.
- API nền tảng, auth, schema identity/guest-auth và test tương ứng đều có chủ sở
  hữu thực thi ở các đường dẫn trong §9.1.

**Điều còn là rủi ro:**

- Các câu trả lời về tax base, giường phụ, retention và phạm vi áp dụng HĐĐT
  vẫn chưa có văn bản.
- Test tồn tại nhưng workflow CI chưa chạy chúng; môi trường database test chưa
  hermetic.
- Router oRPC, API client, OpenAPI và ERD sinh tự động chưa có; `G1` chỉ chứng
  minh lựa chọn kỹ thuật khả thi, không chứng minh tầng contract đã được xây.
- Báo cáo từng trôi khỏi mã nguồn; cho tới lượt đối chiếu trước khi nộp, không
  chương nào được coi là nguồn trạng thái.

**Bất đồng được ghi lại và giữ nguyên:** phân tích ban đầu khuyến nghị thuê một
PMS có sẵn và chỉ tự xây phần đặt phòng trực tiếp. Chủ đầu tư chọn tự xây toàn
bộ. Lựa chọn đó đứng vững được với thời gian chạy dài và giá trị học tập, và
báo cáo giữ nguyên cả khuyến nghị lẫn quyết định thay vì xoá dấu vết của lần bất
đồng — vì một danh sách quyết định trông sạch sẽ thì kém tin cậy hơn.
