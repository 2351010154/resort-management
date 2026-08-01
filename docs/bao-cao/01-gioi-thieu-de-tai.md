# Chương 1 — Giới thiệu đề tài

> ⛔ **OUTDATED / KHÔNG TIN CẬY — đánh dấu 2026-08-01.** Toàn bộ `docs/bao-cao/`
> đã trôi khỏi mã nguồn và tài liệu canonical. Không trích dẫn tệp này làm nguồn,
> không sửa mã hay tài liệu theo nó, không coi nó là bằng chứng đã triển khai.
> Lấy sự thật từ [`docs/README.md`](../README.md) (bản đồ thẩm quyền) rồi tới mã
> nguồn, test, schema và workflow CI. Chỉ viết lại chương này khi đang chủ động
> biên soạn báo cáo, và chỉ bằng bằng chứng đọc trực tiếp.
> *(EN: this coursework report is stale and untrusted — do not use it as a source
> of truth for the codebase.)*

## 1.1 Bối cảnh

Mariva là một khu nghỉ dưỡng **chưa khai trương**. Phần mềm được xây dựng trước
khi có khách đầu tiên, cho một cơ sở có thật sẽ dùng nó để vận hành và để thu
tiền thật.

Điều đó nghe như một chi tiết hành chính nhưng nó quyết định mọi lựa chọn kỹ
thuật trong báo cáo này. Một đồ án viết cho điểm số có thể trình diễn đẹp và đặt
trùng phòng trong tuần đầu vận hành mà không ai biết. Một hệ thống mà lễ tân sẽ
mở ra lúc bảy giờ sáng thì không có chỗ cho lỗi đó.

Điểm khởi đầu có sẵn: `apps/web` — một trang marketing scrollytelling sáu "act"
dựng bằng Three.js, GSAP và Lenis. Nó đẹp, nó chạy, và nó **không có backend
nào**: không API route, không cơ sở dữ liệu, không xác thực, không ORM. Kho mã
và đề bài của môn học ban đầu chỉ chung nhau đúng một từ: "khách sạn".

## 1.2 Bài toán

Đề bài môn học là một danh sách 12 gạch đầu dòng: phân quyền, loại phòng, tài
khoản khách, phản hồi, hiển thị phòng trống, tìm kiếm, báo cáo có biểu đồ, bàn
giao ca, nhật ký kiểm toán, xuất Excel, thu chi, thanh toán trực tuyến.

Đọc kỹ thì đó là **một bài tập cơ sở dữ liệu khoác áo khách sạn**. Mỗi gạch đầu
dòng là một bảng và một báo cáo. Danh sách ấy bỏ sót đúng cái phần chịu lực:

> Bán một loại hàng tồn kho **hữu hạn, dễ hỏng theo thời gian, đánh chỉ mục theo
> ngày** mà không bao giờ bán trùng nó hai lần.

Một buồng trống đêm 14 tháng 8 không giống buồng trống đêm 15. Nó không thể lưu
kho. Nếu không bán được, giá trị của nó bằng không vĩnh viễn. Và nếu bán hai
lần, khách thứ hai đứng ở quầy lúc 22 giờ với một email xác nhận hợp lệ trong
tay.

Đề bài không có chỗ nào nói tới điều này. Nhưng nếu hệ thống làm sai chuyện đó,
mười hai gạch đầu dòng kia đều vô nghĩa.

**"Hệ thống hoàn chỉnh" trong đồ án này** = 12 gạch đầu dòng của đề bài **cộng**
phần lõi vận hành khiến nó sống được ở một cơ sở đang cầm tiền thật.

## 1.3 Mục tiêu

Mục tiêu được phát biểu ở dạng đo được, không ở dạng tính từ. Chương 9 sẽ đối
chiếu lại từng mục.

| Mã | Mục tiêu | Cách chứng minh |
|---|---|---|
| **G1** | Không bao giờ đặt trùng buồng dưới tình huống tương tranh | N yêu cầu song song trên buồng cuối cùng → **đúng 1** thành công |
| **G2** | Khách vãng lai → nhận phòng → ghi dịch vụ → trả phòng → hoá đơn *đã đưa vào hàng đợi* dưới **3 phút**, chỉ dùng bàn phím | Bấm giờ bởi người không phải tác giả |
| **G3** | Toàn vẹn tài chính: Σ bút toán = Σ thanh toán + công nợ | Khẳng định mỗi đêm, sai lệch thì gọi điện |
| **G4** | Mọi hành động thay đổi trạng thái đều dựng lại được từ nhật ký kiểm toán | Test khẳng định độ phủ 100% endpoint |
| **G5** | Luồng đặt phòng công khai chạy end-to-end với cổng thanh toán | Sandbox xanh trong CI, rồi 1 giao dịch production thật |
| **G6** | Cả 12 gạch đầu dòng đều ánh xạ tới một màn hình hoặc endpoint biểu diễn được | Bảng đối chiếu 12/12 |

Một chi tiết trong **G2** đáng dừng lại. Đồng hồ dừng khi folio đóng và job phát
hành hoá đơn *được đưa vào hàng đợi* — **không phải** khi nhà cung cấp hoá đơn
điện tử trả lời. Có một bên thứ ba nằm trên đường đi đó (xem §1.5 và chương 8),
và quầy lễ tân không bao giờ được phép chờ họ. Nếu để nguyên chỉ tiêu là "tới
lúc có hoá đơn", nó hoặc sẽ hỏng vì lý do ngoài tầm kiểm soát, hoặc sẽ ép ta gọi
đồng bộ tới nhà cung cấp ngay trong lúc khách đứng đợi — đúng cái sai cần tránh.

## 1.4 Phạm vi

Đây là chỗ báo cáo tách bạch hai thứ thường bị lẫn.

| | Phạm vi | Nội dung |
|---|---|---|
| **Phạm vi báo cáo** | **P0 → P6** | Nền tảng, tồn kho, vòng đời đặt phòng, folio và thanh toán, phễu đặt phòng của khách, vận hành, báo cáo. Bao phủ **toàn bộ 12** gạch đầu dòng của đề bài. **Đây là phần được chấm.** |
| **Phạm vi hệ thống** | **P0 → P8** | Thêm MoMo, chính sách overbooking, và OTA channel manager. Hoãn có lý do, ghi ở §1.5. |

Mariva là một công trình 6–12 tháng cho một cơ sở thật. Một đồ án được chấm như
một sản phẩm có biên. Nếu không nói rõ biên đó ở đây, báo cáo sẽ đọc như một hệ
thống làm dở, trong khi thực tế nó là một hệ thống **được chia pha có chủ đích**
mà phần được chấm đã đóng đủ mọi yêu cầu.

Ranh giới này là dữ kiện chứ không phải sự tiện lợi: bảng đối chiếu ở phụ lục
chứng minh cả 12 gạch đầu dòng đều đóng tại hoặc trước P6.

## 1.5 Non-goals — những thứ cố tình không làm

Danh sách này làm việc nặng ngang danh sách mục tiêu. Ở một dự án một người
trong nhiều tháng, thứ giết chết tiến độ không phải là việc khó, mà là việc
không cần thiết.

| Không làm | Lý do |
|---|---|
| Đa cơ sở / chuỗi khách sạn | Một khu nghỉ dưỡng. Không có lớp trừu tượng tenant nào cả. |
| **OTA channel manager** | Hoãn tới P8. Xem cảnh báo bên dưới — đây là quyết định đắt nhất trong dự án. |
| Khai báo lưu trú / cổng ASM của công an | Làm thủ công trước mắt. Cần xem lại trước khi khai trương. |
| Ứng dụng di động native | Web responsive là đủ. |
| POS ẩm thực độc lập | Dịch vụ chỉ ghi vào folio. |
| Thuật toán định giá động / revenue management | Rate plan nhập tay. |
| Đường ghi dữ liệu khi mất mạng (offline write) | Xem chương 8 §4. Đây là điều **không bao giờ** làm, không phải hoãn. |

**Về việc hoãn OTA.** Khu nghỉ dưỡng mới nhận phần lớn lượng đặt phòng năm đầu
qua Booking.com, Agoda, Traveloka. Cho tới P8, sẽ có người chặn tồn kho thủ công
trên các kênh đó. Đây chính là nguồn đặt trùng thật sự duy nhất mà các ràng buộc
cơ sở dữ liệu ở chương 5 **không thể** ngăn — bởi vì nó xảy ra bên ngoài cơ sở
dữ liệu. Báo cáo ghi nhận điều này ngay từ chương 1 thay vì để nó xuất hiện như
một bất ngờ ở chương 9.

## 1.6 Ràng buộc

| Mã | Ràng buộc |
|---|---|
| **C1** | Một lập trình viên, thời gian dài. Ngày khai trương khu nghỉ dưỡng là hạn chót thật. |
| **C2** | API NestJS + Postgres + frontend Next.js, monorepo, kiểu TypeScript dùng chung |
| **C3** | `apps/web` hiện có (Three.js/GSAP) phải tiếp tục chạy — được bảo vệ bằng Playwright visual baseline đã commit |
| **C4** | Tự xây toàn bộ, không thuê PMS có sẵn |
| **C5** | VNPay thật, pháp nhân đã tồn tại |
| **C6** | Ảnh chụp giấy tờ tuỳ thân được lưu, mã hoá, và tự hết hạn |
| **C7** | Đề bài của môn học phải là một tập con được thoả mãn |

## 1.7 Một bất đồng được ghi lại rồi khép lại

Trong quá trình phân tích ban đầu, phương án được khuyến nghị là **thuê một PMS
có sẵn và chỉ tự xây phần đặt phòng trực tiếp**. Chủ đầu tư chọn tự xây toàn bộ.

Lựa chọn đó đứng vững được: thời gian chạy dài, một người ra quyết định, và giá
trị học thuật của việc tự xây là thật. Nhưng cái giá cũng thật và được ghi ở
chương 9 §3 — không có nhà cung cấp nào để gọi lúc 23 giờ đêm Ba mươi Tết.

Báo cáo ghi lại bất đồng này vì một danh sách quyết định trông sạch sẽ thì kém
tin cậy hơn một danh sách có ghi cả những lần đổi ý và những lần bị bác. Chương
3 §6 ghi một lần đảo quyết định kỹ thuật theo đúng tinh thần đó.

## 1.8 Bố cục báo cáo

| Chương | Nội dung |
|---|---|
| 2 | Phân tích yêu cầu — 12 yêu cầu từ đề bài, 11 yêu cầu bổ sung, tác nhân, use case |
| 3 | Lựa chọn công nghệ — stack từng tầng, bảng so sánh, một quyết định bị đảo |
| 4 | Thiết kế kiến trúc — modular monolith, một API ba consumer, quy tắc phụ thuộc |
| 5 | Thiết kế chi tiết — ERD, bất biến ở tầng cơ sở dữ liệu, máy trạng thái, RBAC, biểu đồ tuần tự |
| 6 | Quy trình phát triển — giao hàng theo pha, cổng chặn, sổ rủi ro |
| 7 | Kiểm thử và đảm bảo chất lượng |
| 8 | Triển khai và vận hành |
| 9 | Kết quả, hạn chế, hướng phát triển |
