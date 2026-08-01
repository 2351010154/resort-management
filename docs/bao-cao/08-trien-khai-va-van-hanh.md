# Chương 8 — Triển khai và vận hành

> ⛔ **OUTDATED / KHÔNG TIN CẬY — đánh dấu 2026-08-01.** Toàn bộ `docs/bao-cao/`
> đã trôi khỏi mã nguồn và tài liệu canonical. Không trích dẫn tệp này làm nguồn,
> không sửa mã hay tài liệu theo nó, không coi nó là bằng chứng đã triển khai.
> Lấy sự thật từ [`docs/README.md`](../README.md) (bản đồ thẩm quyền) rồi tới mã
> nguồn, test, schema và workflow CI. Chỉ viết lại chương này khi đang chủ động
> biên soạn báo cáo, và chỉ bằng bằng chứng đọc trực tiếp.
> *(EN: this coursework report is stale and untrusted — do not use it as a source
> of truth for the codebase.)*

> 🔶 **Trạng thái chương này.** Thiết kế hạ tầng, quy tắc quyết định và danh sách
> kiểm tra đã chốt. **Bằng chứng triển khai chưa có** — chưa có tài nguyên nào
> được cấp phát; các ticket `P0-INF-*` chưa chạy. §8.8 giữ chỗ.

## 8.1 Nguyên tắc: đây là phần nên tiêu tốn ít suy nghĩ nhất

Ở quy mô 40 buồng, hạ tầng gần như là một phi-quyết định: một Postgres, một tiến
trình API, một bucket, một region. Khoảng **0–5 USD/tháng** trước khi có tiền
thật và khoảng **50–55 USD/tháng** sau đó.

Cám dỗ là làm cho nó thú vị. Đừng. Rủi ro thật của dự án này không nằm ở hạ tầng
— nó nằm ở **giấy tờ và thời gian chờ mua sắm** (chương 6 §6.2.1), là những thứ
không thể phát hiện bằng cách viết mã.

## 8.2 Các lựa chọn

Region: **AWS `ap-southeast-1` Singapore** ở mọi nơi chọn được. Đây là region
trưởng thành gần Việt Nam nhất; **không có** region Neon/Fly/Vercel nào đặt tại
Việt Nam.

| Vấn đề | Lựa chọn | Lý do |
|---|---|---|
| Postgres (môi trường triển khai) | **Neon**, `aws-ap-southeast-1` | PITR **bao gồm sẵn** (7 ngày ở gói Launch). Branching cho database ephemeral theo từng PR |
| Postgres (phát triển) | **Docker cục bộ** | Testcontainers đã đòi Docker Desktop. Không đốt compute của Neon cho việc phát triển |
| Host API | **Fly.io**, region `sin` | Docker, VM chạy liên tục. **pg-boss cần một tiến trình sống lâu — điều này loại serverless function ngay từ đầu** |
| Web + admin | **Vercel** | Next 16 không ma sát. ⚠ **Hobby là phi thương mại** — một trang đặt phòng là thương mại. Pro ở cổng `G2` |
| Lưu trữ đối tượng | **Cloudflare R2** | 0,015 USD/GB-tháng, **0 USD egress**, 10 GB miễn phí, presigned URL, SSE, và **object lifecycle rule** |
| Email | **Resend** | 3.000 email/tháng miễn phí (giới hạn 100/ngày), DKIM/SPF/DMARC, React Email |
| Lỗi + uptime | **Better Stack** | Gói miễn phí 100k exception/tháng, kèm uptime và quản lý sự cố |
| Secrets | Fly secrets + biến môi trường Vercel | Không bao giờ commit. Config đã được zod parse lúc boot |
| Sao lưu | Neon PITR **+ `pg_dump` hằng tuần → R2** | §8.4 |

## 8.3 Một tương tác không hiển nhiên: pg-boss vô hiệu hoá scale-to-zero của Neon

Mô hình chi phí của Neon giả định compute tự ngủ khi rảnh (mặc định 5 phút).
**pg-boss poll liên tục.** Mỗi lần poll đặt lại đồng hồ, nên compute không bao
giờ ngủ và ta trả tiền cho nó 24/7 bất kể lưu lượng.

Đây không phải lý do để bỏ một trong hai. Đây là lý do để **ngừng coi Neon là
miễn phí**:

- **Production**: ngân sách một compute luôn bật 0,25 CU ≈ **19 USD/tháng**. Chấp nhận. Nó ổn định và dự đoán được.
- **Staging**: chạy với **worker pg-boss bị tắt**. Khi đó nó thực sự ngủ và tốn gần như không gì.
- **Phát triển**: Postgres Docker cục bộ. Neon chỉ dành cho môi trường đã triển khai.

Sai lầm cần tránh là lập kế hoạch dựa trên gói miễn phí rồi phát hiện pg-boss đã
ăn hết hạn mức compute trong tuần thứ hai.

## 8.4 Sao lưu — PITR không phải là bản sao lưu

Neon PITR nằm **bên trong** Neon. Việc khoá tài khoản, lỗi thanh toán, hoặc một
lần xoá nhầm project sẽ mang theo cả khả năng khôi phục.

Với một hệ thống giữ tiền, cần một bản sao **bên ngoài nhà cung cấp**:

- `pg_dump` hằng tuần từ một job pg-boss theo lịch → bucket R2, mã hoá, lifecycle 8 tuần.
- **Một lần diễn tập khôi phục, đã thực hiện và bấm giờ**, trên một Neon branch tạm.

Chỉ tiêu là *"khôi phục toàn bộ dưới 1 giờ, đã kiểm chứng"*. **Kiểm chứng nghĩa
là bạn đã làm nó**, không phải nhà cung cấp tuyên bố như vậy.

Việc này nằm ở **cổng `G2`**, tức là trước lần đặt phòng thật đầu tiên — không
phải ở P7. Đây là một trong bảy mục trong sổ đối chiếu chương 6 §6.6.

## 8.5 Môi trường

| Môi trường | Database | API | Frontend | pg-boss |
|---|---|---|---|---|
| Phát triển | Docker cục bộ | cục bộ | cục bộ | bật |
| Staging | Neon branch `staging` | Fly | Vercel preview | **tắt** (để compute ngủ được) |
| Production | Neon branch `production` | Fly `sin` | Vercel | bật |

IPN URL của VNPay được cấu hình **trong trang quản trị terminal của merchant**,
không phải trong mã. Staging và production cần **hai terminal riêng**.

## 8.6 Quy tắc quyết định về kết nối mạng tại cơ sở

Cơ sở chưa khai trương và **chưa ký hợp đồng đường truyền ISP**. Vì vậy quyết
định này không được đưa ra bằng trực giác — nó được **đo**.

Phương pháp: đặt một probe Better Stack miễn phí trên một thiết bị tại cơ sở kể
từ ngày lắp đường truyền, và để nó thu thập **60 ngày** dữ liệu. Đánh giá **sau
khi có ISP, trước pha gia cố P7**.

| Điều kiện đo được | Hành động |
|---|---|
| Cáp quang doanh nghiệp **+ tự động chuyển 4G/5G**, sự cố ngoài kế hoạch > 30 phút xảy ra **< 2 lần/năm** | **Không làm gì.** Chỉ dùng cloud, kèm runbook dự phòng giấy ở P7. Đây là kết quả kỳ vọng và nó ổn |
| Một đường truyền duy nhất, không dự phòng, hoặc sự cố xảy ra **hằng tháng** | Thêm **read replica tại chỗ** vào phạm vi P7: mini-PC, Postgres streaming replica, bảng LAN chỉ đọc hiển thị khách đến/đi/tình trạng buồng/số dư folio hôm nay. Khoảng 1 tuần. Việc ghi vẫn dừng |
| Thực sự hẻo lánh — chỉ có mạng di động, không có cáp quang | **Sửa đường truyền, đừng thiết kế vòng quanh nó.** Starlink hay một nhà mạng thứ hai rẻ hơn bất kỳ lời giải phần mềm nào |

### 8.6.1 Không bao giờ xây đường ghi khi mất mạng

Toàn bộ luận đề đúng đắn của hệ thống này là việc đặt trùng buồng được làm cho
**bất khả thi bởi ràng buộc cơ sở dữ liệu** (chương 5 §5.3). Những ràng buộc đó
**không thể** được cưỡng chế trên một database bị phân mảnh.

Một đường nhận phòng hoạt động offline không phải là một tính năng có chi phí —
nó là việc **từ bỏ mục tiêu G1** và xây lại nó thành bài toán giải quyết xung
đột, tức là đúng cái mà các khách sạn hay làm sai trên thực tế.

Cũng đáng ghi nhận: một read replica giúp quầy lễ tân *đọc*. Nó không giúp họ
*bán*. Nếu đường truyền tệ tới mức đáng bận tâm, thì phễu đặt phòng công khai và
webhook thanh toán đã chết rồi — và đó mới là sự cố đắt hơn.

## 8.7 Giám sát

| Thứ được giám sát | Cơ chế | Ngưỡng gọi điện |
|---|---|---|
| API còn sống | Monitor uptime trên `/health` | Ngay |
| Night audit đã chạy | **Heartbeat** mà job check-in vào | **Trong 30 phút** kể từ lúc lẽ ra phải chạy |
| Exception chưa bắt | Better Stack nối vào Nest exception filter | Theo tần suất |
| Chi tiêu Neon | Cảnh báo chi tiêu, đặt từ ngày đầu | Trên 60 USD/tháng |
| Chênh lệch đối soát cổng thanh toán | Job đối soát hằng ngày | Ngay |

Dòng thứ hai là dòng quan trọng nhất. Một job chốt sổ hỏng **mà im lặng** là chế
độ lỗi tệ nhất trong hệ thống: báo cáo hôm sau vẫn hiển thị, chỉ là chúng sai.
Một heartbeat biến "không có gì xảy ra" thành một tín hiệu.

Cảnh báo chi tiêu cũng không phải sự cẩn thận thừa: Neon tính tiền theo mức dùng,
nên một truy vấn chạy loạn hoặc một connection leak hiện ra dưới dạng **tiền**.

## 8.8 Danh sách triển khai và trạng thái

| Mã | Việc | Trạng thái |
|---|---|---|
| `P0-INF-01` | Neon project `aws-ap-southeast-1`; branch production + staging; **cảnh báo chi tiêu** | ❌ chưa |
| `P0-INF-02` | Postgres Docker cục bộ cho phát triển | ❌ chưa |
| `P0-INF-03` | Fly.io app ở `sin`; Dockerfile cho Nest API; secret qua `fly secrets` | ❌ chưa |
| `P0-INF-04` | Vercel project cho `apps/web`, function region `sin1` | ❌ chưa |
| `P0-INF-05` | R2: **hai** bucket — `mariva-assets`, `mariva-id-scans` (private, có lifecycle) | ❌ chưa |
| `P0-INF-06` | Resend xác minh domain: SPF, DKIM, DMARC | ❌ chưa |
| `P0-INF-07` | Better Stack: monitor `/health` + error tracking trong Nest exception filter | ❌ chưa |
| `P0-API-07` | Deploy hello-world API lên production | ❌ chưa |

`P0-API-07` đáng giải thích: triển khai một API rỗng lên production **ở P0, không
phải về sau**, để việc deploy là bài toán đã giải xong trước khi có thứ gì phụ
thuộc vào nó — thay vì là một bất ngờ ở cuối dự án.

## 8.9 Chi phí

| Giai đoạn | Chi phí/tháng | Thành phần |
|---|---|---|
| P0–P2 (chỉ dữ liệu tổng hợp) | **0–5 USD** | Postgres cục bộ, Neon free cho staging, Fly ~3 USD, còn lại gói miễn phí |
| Sau cổng `G2` (đặt phòng thật) | **≈ 50–55 USD** | Neon Launch ~24, Fly ~7, Vercel Pro 20, R2 0, Resend 0, Better Stack 0 |

Gói miễn phí của Resend gần như chắc chắn đủ ở quy mô 40 buồng; giới hạn có thể
cắn là **100 email/ngày** trong một ngày kín phòng, không phải 3.000/tháng.

## 8.10 Đánh đổi

- **Lưu dữ liệu CCCD của công dân Việt Nam ở nước ngoài** *(quyết định của chủ đầu tư)*: câu hỏi pháp lý đang **mở**, không phải đã đóng. Giảm thiểu rẻ và nên làm dù sao: một bucket, một đường mã, một giá trị cấu hình — để việc di dời là một cuộc migration chứ không phải một lần viết lại. Cần câu trả lời của luật sư **trước khi khai trương**, không phải trước khi viết mã.
- **Một region, một instance**: một sự cố availability zone ở Singapore làm sập toàn bộ hệ thống. Đây là đánh đổi đúng ở quy mô này.
- **Thanh toán trực tuyến đầy đủ qua VNPay** *(quyết định của chủ đầu tư)*: 1,1–2,2% mỗi lần đặt phòng, mãi mãi, cộng rủi ro chargeback và quy trình onboarding merchant — trong khi chuyển khoản VietQR chỉ tốn một khoản phí cố định hàng tháng. Đổi lại là tỉ lệ chuyển đổi và một API hoàn tiền thật. Đứng vững được — chỉ cần biết rằng phí đó là một **khoản chi thường xuyên**, không phải chi phí thiết lập.
- **Cloud-first kèm dự phòng giấy** *(đã chốt)*: một ngày nào đó quầy lễ tân sẽ chạy trên giấy vài giờ. Runbook ở P7 do đó là tài liệu **chịu lực**, không phải thủ tục hình thức. Viết nó như thể nó sẽ được dùng, bởi vì nó sẽ được dùng.
- **Neon thay vì một Postgres quản lý giá cố định**: tính tiền theo mức dùng nghĩa là một truy vấn chạy loạn hiện ra thành tiền. Đặt cảnh báo chi tiêu ngay ngày đầu.
- **Vercel Pro + Fly + Neon = ba nhà cung cấp** để giữ credential và hoá đơn, với một người. Phương án thay thế (mọi thứ trên Fly) là một nhà cung cấp và một trải nghiệm Next.js tệ hơn. Ba là con số đúng ở đây, nhưng nó là ba.

## 8.11 Trạng thái xác minh

**Đã kiểm chứng (2026-07-26):** region Neon `aws-ap-southeast-1` khả dụng và
**không có region Việt Nam**; các mức PITR của Neon và cách tính phí lịch sử
thay đổi; việc scale-to-zero của Neon bị đặt lại bởi bất kỳ kết nối nào, và job
nền/polling ngăn nó ngủ; Fly.io có region `sin`; bảng giá và gói miễn phí của
Cloudflare R2, gồm presigned URL, SSE và **object lifecycle expiration** (đã
GA); các mức của Resend; gói miễn phí Better Stack 100k exception/tháng; sandbox
VNPay tại `sandbox.vnpayment.vn`, IPN URL đặt trong trang quản trị terminal,
**IPN có thể được gửi nhiều lần**, và **quyền hoàn tiền trong sandbox bị hạn chế,
phải liên hệ VNPay**; MoMo dùng REST JSON, ký bằng khoá riêng của merchant, và
**IPN phải được trả lời trong 15 giây**; nội dung và hiệu lực của Nghị định
70/2025/NĐ-CP; ký số HSM/từ xa cho phép ký tự động phía máy chủ không cần USB
token.

**Độ tin cậy cao, chưa kiểm chứng ở đây:** điều khoản phi thương mại của Vercel
Hobby (lâu đời, nhưng **hãy đọc điều khoản hiện hành trước khi dựa vào**);
branching của Neon dùng làm cách ly staging/preview; lifecycle rule của R2 áp
dụng đúng theo mẫu hết hạn ảnh giấy tờ như mô tả.

**Chưa kiểm chứng — phải kiểm tra trước khi dựa vào:** danh mục hồ sơ, biểu phí
và thời gian duyệt onboarding của VNPay; VNPay có cấp quyền sandbox hoàn tiền
theo yêu cầu hay không và mất bao lâu; nghĩa vụ về nơi lưu trữ dữ liệu đối với
ảnh CCCD giữ ở nước ngoài; mức sàn lưu trữ luật định cho bản ghi lưu trú; **giá
hiện hành của Neon/Fly/Vercel/Resend tại ngày đăng ký thực tế — những con số này
thay đổi**.
