# Chương 9 — Kết quả, hạn chế và hướng phát triển

> ⚠ **Chương này chờ kết quả xây dựng.** §9.2 và §9.3 chỉ được điền bằng số liệu
> **đo trực tiếp**, theo lịch chụp hiện vật ở chương 6 §6.9. Không có ô nào được
> điền bằng ước lượng. §9.4 trở đi đã viết được ngay, vì hạn chế và lộ trình là
> hệ quả của các quyết định đã đưa ra chứ không phải của kết quả chưa có.

## 9.1 Trạng thái tại thời điểm biên soạn

Ghi trung thực, để chương này có mốc so sánh khi được cập nhật.

| Bề mặt | Trạng thái |
|---|---|
| `apps/web` | **Mã chạy thật.** Trang marketing scrollytelling sáu act. Đang migrate React 18.3 → 19 và Next 14.2 → 16, phía sau một Playwright visual baseline đã commit (`b80e902`) |
| `apps/api` | Ranh giới đã đặt chỗ. Chưa có `package.json`, chưa có lược đồ |
| `apps/admin` | Ranh giới đã đặt chỗ |
| `packages/shared` | Chỉ `zod ^4.4.3` |
| `packages/api-client` | `src/` rỗng |
| CI | Lint + typecheck + build. **Chưa có test** |
| Tài liệu kiến trúc | 3 tài liệu viết **trước** mã: cấu trúc kho mã, ma trận RBAC, máy trạng thái booking |
| Backlog | Hợp nhất, 11 mốc, có thứ tự phụ thuộc, 48 chỉ tiêu làm DoD |

Điều đáng nói ở bảng này: **tài liệu kiến trúc được viết trước mã**, theo đúng
quy tắc "đổi tài liệu trước, rồi mới đổi mã". Ma trận RBAC và bảng chuyển trạng
thái tồn tại đầy đủ và có thẩm quyền, dù chưa một dòng nào cưỡng chế chúng.

## 9.2 Kết quả đo

> ⚠ **Chưa có kết quả nào.** Bảng đầy đủ 20 chỉ tiêu kèm mốc sinh ra chúng nằm ở
> chương 7 §7.8.

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
| 1 | Phân quyền ≥ 3 mức | `P0-AUTH` | | *chưa* |
| 2 | Loại phòng và thuộc tính | `P1-SCH-01` | | *chưa* |
| 3 | Tài khoản khách | M7 | | *chưa* |
| 4 | Phản hồi sau lưu trú | M7 | | *chưa* |
| 5 | Hiển thị phòng trống | `P1-AVL-01` | | *chưa* |
| 6 | Tìm kiếm | `P2-SRC` | | *chưa* |
| 7 | Báo cáo có biểu đồ | M9 | | *chưa* |
| 8 | Bàn giao ca | M8 | | *chưa* |
| 9 | Nhật ký kiểm toán | M8 | | *chưa* |
| 10 | Xuất Excel | M8 | | *chưa* |
| 11 | Thu chi | M8 | | *chưa* |
| 12 | Thanh toán trực tuyến | `P3-PAY` | | *chưa* — **một** cổng production đóng yêu cầu này |

Cột "Mã issue" được điền **trong lúc tạo ticket**, không phải sau. Khi đó phụ lục
"đối chiếu yêu cầu" tự lắp ráp, và cùng một bảng vừa chứng minh đồ án hoàn thành
vừa chứng minh không có yêu cầu nào bị bỏ sót.

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
| **Lưu ảnh giấy tờ tuỳ thân** | Dữ liệu rủi ro cao nhất trong hệ thống | Giảm thiểu rẻ nhất là lưu trữ ngắn hạn quyết liệt: 30 ngày, cưỡng chế bởi lifecycle rule của bucket (chương 5 §5.8) |
| **Một region, một instance** | Sự cố AZ ở Singapore làm sập toàn bộ | Đánh đổi đúng ở quy mô này |

### 9.4.3 Câu hỏi pháp lý còn mở

Ba câu hỏi dưới đây **không** được trình bày như đã kết luận, và đó là chủ ý.

| Câu hỏi | Trạng thái | Ai trả lời |
|---|---|---|
| Nghị định 70/2025 có ràng buộc **mã ngành của pháp nhân này** không? | **Mở.** Nội dung nghị định đã kiểm chứng; phạm vi áp dụng thì chưa | Đại lý thuế (`M0-06`) |
| Lưu ảnh CCCD ở nước ngoài (Singapore) có hợp lệ không? | **Mở.** Rủi ro pháp lý đã được chấp nhận có ý thức, chờ đóng lại trước khi khai trương | Luật sư (`M0-05`) |
| Mức sàn lưu trữ luật định cho bản ghi lưu trú là bao nhiêu? | **Mở.** Vì vậy N là giá trị **cấu hình**, không phải hằng số | Luật sư (`M0-05`) |

Việc giữ ba dòng này ở trạng thái "mở" thay vì điền một câu trả lời nghe hợp lý
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

Phần này được viết trước khi có kết quả, và sẽ được xem lại sau.

**Điều đã làm đúng, và có bằng chứng ngay bây giờ:**

- Tài liệu kiến trúc được viết **trước** mã, có thẩm quyền, và có quy tắc "đổi tài liệu trước".
- Một backlog hợp nhất duy nhất, với **sổ đối chiếu ghi lại bảy thứ đã bị thay thế và vì sao** (chương 6 §6.6). Việc này ngăn cùng một lỗi được sửa hai lần.
- Ba cổng chặn được mô hình hoá thành issue thay vì thành ý định tốt.
- Một quyết định kỹ thuật bị **đảo có ghi chép** (ts-rest → oRPC, chương 3 §3.6), kèm bằng chứng đã dẫn tới việc đảo.
- Visual baseline được commit **trước** khi chạm vào dependency đầu tiên — lưới an toàn mà sáu act chưa từng có.

**Điều còn là rủi ro:**

- **`D1`–`D4` và `D7` vẫn mở.** Khoảng hai giờ ra quyết định đang chặn tiêu chí nghiệm thu của hai mốc. Đây hiện là điểm nghẽn lớn nhất còn lại.
- **Chưa có test nào.** CI hiện chỉ chứng minh hệ thống biên dịch được, không chứng minh nó đúng.
- Cổng `G1` chưa chạy, nên toàn bộ tầng contract vẫn là tạm thời.

**Bất đồng được ghi lại và giữ nguyên:** phân tích ban đầu khuyến nghị thuê một
PMS có sẵn và chỉ tự xây phần đặt phòng trực tiếp. Chủ đầu tư chọn tự xây toàn
bộ. Lựa chọn đó đứng vững được với thời gian chạy dài và giá trị học tập, và
báo cáo giữ nguyên cả khuyến nghị lẫn quyết định thay vì xoá dấu vết của lần bất
đồng — vì một danh sách quyết định trông sạch sẽ thì kém tin cậy hơn.
