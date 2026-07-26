# Chương 6 — Quy trình phát triển

Chương này là phần khác biệt nhất của đồ án so với một báo cáo môn học thông
thường: không phải vì quy trình được mô tả đẹp, mà vì nó tồn tại dưới dạng
**hiện vật kiểm chứng được** — một backlog có thứ tự phụ thuộc, các cổng chặn
tường minh, một sổ đối chiếu ghi lại thứ gì đã bị thay thế và vì sao, và 48 chỉ
tiêu đo lường được dùng làm tiêu chí nghiệm thu.

## 6.1 Nguyên tắc: xây xương sống trước, xây da sau

Mỗi pha kết thúc ở trạng thái **biểu diễn được**. Nếu dừng ở bất kỳ điểm nào, cái
còn lại vẫn là một hệ thống mạch lạc chứ không phải một nửa công trình.

Thứ tự được chọn theo *độ rủi ro giảm dần*, không theo *độ dễ nhìn thấy tăng
dần*. Đó là lý do console quản trị — thứ dễ khoe nhất — không được xây trước.
Xây UI admin đầu tiên là việc dễ thấy nhất và ít thông tin nhất.

## 6.2 Bảng mốc

| Mốc | Pha | Ước lượng | Nội dung |
|---|---|---|---|
| M1 | **P−1** Migration web *(đang chạy)* | 1 tuần | Visual baseline đã commit, gỡ drei, React 19, R3F 9, Next 15 → 16, `packages/tokens`, Biome |
| M2 | **P0** Nền tảng | 2–3 tuần | Monorepo, Postgres, auth + RBAC, contract oRPC, CI có test, pipeline ERD, hello-world API trên production, hạ tầng, VNPay sandbox sau `PaymentGateway` port |
| M3 | **P1** Tồn kho và phòng trống | 3–4 tuần | Loại buồng, buồng, rate plan, mùa vụ, hạn chế lưu trú, **tồn kho hai tầng**, test tương tranh 50 luồng xanh |
| M4 | **P2** Vòng đời booking và quầy lễ tân | 4 tuần | Máy trạng thái, gán buồng, bảng buồng phòng, tìm kiếm, **primitive bàn phím**, màn hình admin đầu tiên |
| M5 | **P2.5** Tối ưu gán buồng | 2–3 tuần | *Tuỳ chọn, không chặn xương sống* |
| M6 | **P3** Folio, thanh toán, hoá đơn | 3–4 tuần | Sổ bút toán, VAT/phí phục vụ, **pg-boss**, VNPay + webhook idempotent, hoàn tiền, HĐĐT khi đóng folio, đối soát |
| M6.5 | **P3.5** MoMo | ~2 tuần | *Có điều kiện* — chỉ khi đo được tỉ lệ bỏ giỏ đáng kể |
| M7 | **P4** Phễu đặt phòng của khách | 3 tuần | `/booking`, tìm → chọn → trả tiền → xác nhận, tài khoản khách, upload giấy tờ, phản hồi. **Cổng `G2` rơi vào đây** |
| M8 | **P5** Vận hành | 2–3 tuần | Bàn giao ca, đối chiếu tiền mặt, thu chi, xem nhật ký kiểm toán, xuất Excel |
| M9 | **P6** Báo cáo | 2–3 tuần | Job night audit, snapshot, dashboard công suất/ADR/RevPAR |
| M9.5 | **P6.5** Overbooking | 1–2 tuần | *Cần dữ liệu no-show thật* |
| M10 | **P7** Gia cố | 2–3 tuần | Kiểm tra bảo mật, load test, runbook dự phòng giấy |
| M11 | **P8** OTA channel manager | — | *Hoãn.* Đánh giá trong M9 |

**Toàn bộ 12 gạch đầu dòng của đề bài đóng lại tại hoặc trước P6.** Sản phẩm đồ
án xuất hiện một cách tự nhiên mà không lúc nào phải tối ưu cho rubric.

### 6.2.1 Một mốc chạy song song với tất cả: M0 — giấy tờ và mua sắm

Không phải mã. Mỗi hạng mục cần một *ngày hết hạn* thay vì một sprint. Đây là
hàng tuần lễ nằm trong quy trình của người khác: chúng không chặn gì cả, cho đến
lúc chúng chặn tất cả.

| Mã | Việc |
|---|---|
| `M0-01` | Hỏi kế toán: đã có nhà cung cấp HĐĐT chưa? có làm việc trên MISA AMIS không? |
| `M0-02` | Mua **chữ ký số HSM / ký số từ xa** — tường minh **không** phải USB token |
| `M0-03` | Mua SKU **hoá đơn điện tử khởi tạo từ máy tính tiền** |
| `M0-04` | Bắt đầu onboarding merchant VNPay — **xin quyền sandbox hoàn tiền trong cùng hồ sơ** |
| `M0-05` | Luật sư: lưu trữ CCCD ở nước ngoài + mức sàn lưu trữ luật định |
| `M0-06` | Đại lý thuế: Nghị định 70/2025 có ràng buộc mã ngành của pháp nhân này không? |
| `M0-07` | Đặt probe đo uptime tại cơ sở ngay ngày đường truyền ISP hoạt động |

`M0-04` đáng nhấn mạnh. Quyền hoàn tiền trong sandbox của VNPay **bị hạn chế mặc
định** và phải liên hệ để xin. Phát hiện điều đó ở P3 tốn mất hai tuần đúng vào
điểm xấu nhất của lịch trình. Xin nó ngay trong hồ sơ onboarding thì mất thêm
một dòng.

## 6.3 Cổng chặn — là issue, không phải story

Ba thứ dưới đây không phải công việc; chúng là **điều kiện merge**.

| Mã | Cổng | Chặn | Chi tiết |
|---|---|---|---|
| `G1` | Spike `@orpc/nest` — nó có cưỡng chế contract ở mức biên dịch không? | `P0-C*` | 30 phút. Kết quả "không đi" sẽ mở lại toàn bộ tầng contract. **Ghi kết quả lại dù đi hay không đi** |
| `G2` | **Cái công tắc** — commit đổi VNPay từ sandbox sang credential production | Mọi thứ sau P4 | Danh sách 6 mục dưới đây. Không gì merge qua khi còn ô chưa tick |
| `G3` | Thời gian chờ giấy tờ | `P3-*` | Hàng tuần trong quy trình của người khác |

### 6.3.1 `G2` — định nghĩa khoảnh khắc hệ thống trở thành thật

> **Cổng = commit chuyển VNPay từ credential sandbox sang credential production.**

Không phải "khi chúng ta khai trương", không phải "khi cảm thấy đã thật". Đó là
một thay đổi cấu hình cố ý mà ta tự tay thực hiện — nên hãy gắn danh sách kiểm
tra vào đúng nó:

- [ ] Neon Free → Launch; xác nhận lịch sử 7 ngày và không tự ngủ khi rảnh
- [ ] Vercel Hobby → Pro (một trang đặt phòng là sử dụng thương mại)
- [ ] Monitor uptime trên `/health` + heartbeat trên night audit, cả hai đều gọi vào điện thoại
- [ ] Job `pg_dump` hằng tuần → R2 đang chạy, **và một lần diễn tập khôi phục đã thực hiện và bấm giờ**
- [ ] Lifecycle rule của bucket ảnh giấy tờ đã kiểm chứng trên một đối tượng thật
- [ ] Release tracking nối với các lần deploy

Nếu còn một ô chưa tick, credential không được đổi. Đó là toàn bộ cơ chế.

Điểm quan trọng về **thứ tự**: các hạng mục này ban đầu được xếp vào P7 (gia cố).
Nhưng P7 nằm **sau** thời điểm hệ thống bắt đầu cầm tiền thật. Một bản sao lưu
chưa từng được khôi phục thì không phải bản sao lưu, và phát hiện điều đó sau
lần đặt phòng thật đầu tiên là sai thứ tự.

## 6.4 Quyết định chặn — resolve trước ticket tiêu thụ chúng

| Mã | Quyết định | Người quyết | Chặn | Trạng thái |
|---|---|---|---|---|
| `D1` | **Dữ kiện cơ sở** — số buồng, cơ cấu loại, số tầng, quy tắc đánh số, giờ nhận/trả phòng, giờ đẩy business date, sức chứa tối đa, quy tắc giường phụ | Chủ đầu tư | `P1-INV-*`, `P1-SEED-*`, `P2`, `P6` | **Mở** |
| `D2` | **Mô hình thuế và phí** — thuế suất VAT, % phí phục vụ, **VAT có tính trên phí phục vụ không**, hiển thị gộp hay tách, quy tắc làm tròn VND, hạng thuế theo dịch vụ | Kế toán | `P3-FOL-*`, mọi tổng tiền | **Mở**. Ưu đãi thuế có tính thời điểm — không hardcode theo trí nhớ |
| `D3` | **Lưới huỷ / no-show** — mốc thời hạn, mức phạt, phí no-show, phí trả sớm | Chủ đầu tư | `P2-CAN-*`, `P3-REF-*`, `P4` | **Mở** |
| `D4` | **Cơ cấu giá lúc khai trương** — số rate plan, lịch mùa, định nghĩa cuối tuần, giá trẻ em/người thêm | Chủ đầu tư | `P1-RAT-*` | **Mở** |
| `D5` | Nội dung ma trận RBAC | — | `P0-AUTH-*` | ✅ **Xong** → `rbac-matrix.md`, 6 dòng ⚑ chờ ký duyệt |
| `D6` | Bảng chuyển trạng thái booking | — | `P2-SM-*` | ✅ **Xong** → `booking-state-machine.md`, 3 dòng ⚑ chờ ký duyệt |
| `D7` | Danh mục dịch vụ — hạng mục, giá, hạng thuế | Chủ đầu tư | `P3-SVC-*`, `P5` | **Mở**. Có thể seed mỏng |
| `D8` | Ký pháp sơ đồ mà giảng viên yêu cầu | Giảng viên | `P0-DOC-*` | **Mở** |

`D1`–`D4` và `D7` là **một** cuộc trò chuyện. Đặt lịch cho nó; đừng chặn P0 vì
nó.

### 6.4.1 Vì sao đây là điểm nghẽn lớn nhất còn lại

Không thể viết "tính hoàn tiền theo chính sách" thành một ticket kiểm thử được
khi không tài liệu nào nói mốc thời hạn và mức phạt là bao nhiêu. Test tính hoàn
tiền không có giá trị kỳ vọng để so.

Đây là khoảng hai giờ ra quyết định, không phải hàng tuần công việc. Nhưng nó là
khác biệt giữa những ticket đóng được và những ticket kẹt lại ở câu hỏi "cái này
đáng ra phải làm gì?" ngay lúc đang hiện thực.

## 6.5 Phân cấp issue và quy tắc độ sâu

```
Mốc      = pha            (P0, P1, P2, P2.5, P3, …)   — đã sắp thứ tự phụ thuộc, có ước lượng
Epic     = một năng lực bên trong pha                  (vd. "Tồn kho hai tầng")
Story    = một dòng checklist
DoD      = chỉ tiêu đo lường tương ứng
```

**48 chỉ tiêu thành công chính là tiêu chí nghiệm thu.** Ánh xạ chúng một cách
tường minh, và hai phép kiểm tra chéo tự rơi ra miễn phí:

- Một chỉ tiêu không có ticket nào sở hữu → công việc sẽ không được làm.
- Một story không có chỉ tiêu nào → có lẽ không cần, hoặc chỉ tiêu đang thiếu.

**Quy tắc độ sâu.** P−1, P0 và P1 được viết tới mức story. P2 trở đi giữ ở mức
epic cho tới khi mốc liền trước đang chạy.

Lý do: ticket chi tiết cho P6 viết hôm nay sẽ bị viết lại trước khi được làm.
MoMo đã có điều kiện phụ thuộc vào dữ liệu phễu chưa tồn tại. Viết 200 ticket
hôm nay cho P6 là tồn kho sẽ bị vứt đi — YAGNI áp dụng cho cả backlog.

## 6.6 Sổ đối chiếu — thứ đã bị thay thế và vì sao

Ba báo cáo tư vấn ban đầu chứa ba checklist chồng chéo và **mâu thuẫn với nhau**.
Chép cả ba vào hệ quản lý issue sẽ tạo ra bản trùng cộng với việc tái sinh những
lỗi đã sửa.

Việc hợp nhất được thực hiện **một lần**, và kết quả được ghi lại để câu hỏi
không bị mở lại:

| Đã bị thay thế | Đúng là | Vì sao quan trọng |
|---|---|---|
| pg-boss ở P6 | **P3** | Phát hành HĐĐT và ACK webhook đều cần hàng đợi ở P3. Xếp nó vào P6 nghĩa là xây nó dưới áp lực, ngay giữa pha tiền bạc |
| Lưu trữ, sao lưu, diễn tập khôi phục, giám sát ở P7 | **Trước cổng `G2`**, rơi vào M7 | P7 nằm sau lúc hệ thống cầm tiền thật |
| MoMo ở P3 cùng VNPay | **M6.5 có điều kiện** | Hai lược đồ chữ ký, hai dạng IPN, hai job đối soát. Gạch đầu dòng đóng bằng một cổng |
| HĐĐT thông thường, phát hành theo lô | **SKU máy tính tiền + HSM, phát hành khi đóng folio** | HĐĐT thường là sai sản phẩm; quyết định lúc mua, nhiều tháng trước mã |
| Service container Postgres trong CI | **Testcontainers** | Hai cơ chế là trôi. Local phải bằng CI |
| `< 3 phút` tới *hoá đơn* | `< 3 phút` tới hoá đơn **đã xếp hàng** | Một bên thứ ba đã tham gia vào đường đi đó |
| Tự xoá "được kiểm chứng bởi job theo lịch" | **Lifecycle rule cưỡng chế, job kiểm chứng** | Cách diễn đạt cũ để một cron trở thành thứ duy nhất ngăn một vụ vi phạm lưu trữ |

**Một nguồn duy nhất, hoặc bạn sẽ hợp nhất chúng lại trong đầu mỗi sprint.**
`plans/backlog.md` là nguồn đó; ba báo cáo tư vấn là lý lẽ có ghi ngày và
**chỉ đọc**.

Việc ghi lại một lần đảo quyết định — thay vì im lặng sửa — cũng chính là điều
chương 3 §6 làm với ts-rest → oRPC. Một danh sách quyết định có ghi cả lần đảo
thì đáng tin hơn một danh sách trông sạch sẽ.

## 6.7 Sổ rủi ro

| Rủi ro | Nguồn | Tác động | Giảm thiểu |
|---|---|---|---|
| **Đặt trùng qua kênh OTA** | Quyết định hoãn P8 | Cao — ràng buộc DB **không** ngăn được vì nó xảy ra ngoài DB | Chặn tồn kho thủ công; bắt đầu đánh giá channel manager ở M9 |
| **Mua nhầm chứng thư số** (USB token) | Quyết định lúc mua | Cao — phá vỡ toàn bộ tiền đề tự động hoá | `M0-02` nêu tường minh HSM/ký số từ xa |
| **Sandbox hoàn tiền của VNPay bị từ chối** | Quy trình của bên thứ ba | Trung bình — đường hoàn tiền chỉ thử được trên tiền thật | Xin ngay trong hồ sơ onboarding (`M0-04`) |
| **`D1`–`D4`, `D7` không được trả lời** | Chủ đầu tư / kế toán | Cao — chặn tiêu chí nghiệm thu của M3 và M6 | Một cuộc trò chuyện; ticket quyết định, không chặn P0 |
| **`@orpc/nest` không cưỡng chế contract** | Chưa xác minh | Trung bình — mở lại tầng contract | Cổng `G1`, spike 30 phút trước khi commit |
| **Một người, không bus factor** | Ràng buộc C1 | Cao nếu kéo dài | Test dồn vào đường tiền và tồn kho; tài liệu viết song song |
| **Node 20 đã hết vòng đời** | Cấu hình trước migration | Thấp nhưng rẻ để sửa | ✅ **Đã đóng** — `.nvmrc`, `engines` và CI cùng ghim Node 24 trong migration P−1 |
| **Nghị định 70/2025 có ràng buộc pháp nhân này không** | Chưa xác minh | Trung bình | `M0-06` với đại lý thuế; báo cáo đánh dấu "đang chờ" |
| **pg-boss vô hiệu hoá scale-to-zero của Neon** | Tương tác giữa hai lựa chọn | Thấp về tiền, cao về bất ngờ | Chương 8 §3: ngân sách compute luôn bật cho production, tắt worker ở staging |
| **exceljs không còn được bảo trì** | Phụ thuộc | Thấp | Đánh giá lại ở P5 |

## 6.8 Chiến lược viết báo cáo: xây trước, viết sau

Báo cáo này **không** được duy trì song song với việc xây dựng theo kiểu viết
dần từng chương ngay khi hệ thống còn đang đổi. Lý do: duy trì một bản tiếng
Việt song song với một hệ thống đang dịch chuyển tạo ra hai tài liệu mâu thuẫn
nhau, và chính sự mâu thuẫn đó là thứ bị phát hiện.

Thay vào đó:

1. Tài liệu tiếng Anh trong `docs/` được viết **trong lúc** xây. Thói quen này đang chạy tốt.
2. Báo cáo là một **lượt dịch và lắp ráp** trên một tập tài liệu luôn cập nhật.
3. Hiện vật được **chụp lại đúng lúc chúng được tạo ra**, không dựng lại sau (§6.9).

### 6.8.1 Điều kiện của chiến lược này

Chiến lược này chỉ đứng vững khi **hạn nộp rơi sau khi mốc P1 hoàn thành** —
khoảng 7 tuần công việc kỹ thuật theo bảng mốc ở §6.2.

**Điều kiện này đã được xác nhận** (2026-07-26): hạn nộp chưa ấn định và còn xa.
Chiến lược xây-trước-viết-sau do đó là chiến lược đang áp dụng.

Việc cần làm khi hạn nộp được ấn định: đối chiếu nó với bảng mốc ở §6.2. Nếu nó
rơi trước khi P1 xong, chiến lược đảo ngược — báo cáo phải viết dựa trên thiết
kế thay vì dựa trên kết quả đo, và ranh giới phạm vi ở chương 1 §1.4 phải thu
hẹp tương ứng.

## 6.9 Chụp hiện vật ngay tại thời điểm sinh ra

Dựng lại bằng chứng sau khi việc đã xong là chế độ thất bại đắt nhất. Mỗi hạng
mục dưới đây gần như miễn phí trong lúc xây và tốn một ngày để tái tạo về sau.

| Khi nào | Chụp lại cái gì | Phục vụ chương |
|---|---|---|
| Kết quả cổng `G1` | Kết luận spike oRPC, viết ra dù đi hay không | 3 |
| Mỗi lần `D1`–`D8` được chốt | Một tệp ADR có ghi ngày — bối cảnh, quyết định, lý do, hệ quả | 3, phụ lục |
| `P0-CI-*` xanh | Ảnh chụp lần chạy CI; thời gian boot ấm của Testcontainers | 7 |
| `P0-DOC-01/02` | `docs/erd.dbml`, `docs/openapi.json` đã commit và có kiểm tra trôi trong CI | 5 |
| `P0-AUTH-04` | Output test: mọi dòng ma trận, cả cho phép lẫn từ chối | 5, 7 |
| **`P1-INV-05`** | **Log đầy đủ: 50 lần đặt song song → 1 thành công, 49 lần 409 sạch** | **9 — kết quả chủ lực** |
| `P1-AVL-03` | Số liệu p95 trên lịch 12 tháng | 9 |
| `P2` hoàn tất | Bản ghi màn hình E2E nhận phòng chỉ bằng bàn phím, 0 sự kiện chuột | 9, demo |
| `P3` hoàn tất | Output khẳng định Σ bút toán = Σ thanh toán + công nợ | 9 |
| Cổng bundle `P4` | Output CI chứng minh 0 byte `three`/`gsap`/`lenis` trong `/booking` | 9 |
| Night audit `P6` | Lịch sử pg-boss chứng minh đúng một lần chạy mỗi business date | 9 |
| Mỗi mốc | Ảnh chụp màn hình **lúc hoàn thành**, không phải lúc cuối dự án | 9, phụ lục |

**Log của `P1-INV-05` là hình mạnh nhất mà báo cáo này có thể chứa.** Phần lớn
báo cáo đồ án trình bày ảnh chụp màn hình; cái này trình bày một bất biến được
cưỡng chế dưới điều kiện tương tranh. Cần chụp cho đúng: câu lệnh, output, và
định nghĩa ràng buộc đã khiến nó trở thành cấu trúc chứ không phải nỗ lực.

## 6.10 Quy trình Git

- **Một biến số cho mỗi commit.** Quy tắc này bắt nguồn từ migration P−1: React 19, R3F 9, Next 15, Next 16 là bốn commit, không phải một commit "nâng cấp mọi thứ".
- **Playwright visual baseline** đã commit trước khi chạm vào bất kỳ dependency nào. Đó là lưới an toàn mà sáu act chưa từng có.
- **Chạy lại ảnh chụp ở mọi bước.** Act nào dịch chuyển thì dừng lại và diff.
- **Biome và `packages/tokens` hạ cánh *sau* khi migration xanh**, không bao giờ nằm trong cùng một diff. Trộn một lần viết lại formatter vào một diff nâng cấp phiên bản là cách làm cho cả hai không review được.
- **lefthook** chạy format + typecheck lúc commit.
- Conventional commit, không tham chiếu tới công cụ AI.
- Không commit secret, tệp dotenv, token, khoá riêng, thông tin đăng nhập database, hay dữ liệu cá nhân.

## 6.11 Chỉ tiêu của riêng giai đoạn lập kế hoạch

| # | Chỉ tiêu | Mục tiêu |
|---|---|---|
| 1 | Số nguồn của backlog | **1** tài liệu hợp nhất; ba báo cáo chỉ đọc |
| 2 | Hạng mục đã bị thay thế mà lại được nhập lại thành ticket | **0** |
| 3 | Story ở P0+P1 có chỉ tiêu đo lường làm DoD | **100%** |
| 4 | Chỉ tiêu (trong 48) không có ticket sở hữu | **0**, hoặc hoãn tường minh kèm lý do |
| 5 | Gạch đầu dòng đề bài đã ánh xạ trong bảng đối chiếu | **12/12** trước commit đầu tiên của P1 |
| 6 | Cổng chặn được mô hình hoá thành issue | **3** |
| 7 | Story chi tiết vượt quá P3 | **0** |
| 8 | Ticket có tiêu chí nghiệm thu ghi "TBD" | **0** |
