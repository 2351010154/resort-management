# Chương 7 — Kiểm thử và đảm bảo chất lượng

> 🔶 **Trạng thái chương này.** Chiến lược, công cụ và chỉ tiêu đã chốt và trình
> bày đầy đủ dưới đây. **Kết quả đo chưa có** — CI hiện chỉ chạy lint, typecheck
> và build; chưa có test nào. §7.8 giữ chỗ cho kết quả và ghi rõ mốc nào sinh ra
> chúng.

## 7.1 Nguyên tắc: kiểm thử nơi lỗi tốn tiền

Ngân sách kiểm thử của một dự án một người là hữu hạn. Nó được dồn vào ba mô-đun
`inventory`, `folio`, `pricing` với chỉ tiêu độ phủ **≥ 85%**, và **độ phủ UI
không phải là chỉ tiêu**.

Đây là lựa chọn có chủ ý, không phải sự lười. Một lỗi CSS sẽ bị phát hiện trong
ngày đầu vận hành. Một lỗi tương tranh trong đường đặt phòng sẽ bị phát hiện khi
khách thứ hai đứng ở quầy lúc 22 giờ với email xác nhận hợp lệ trong tay.

## 7.2 Bộ công cụ

| Vấn đề | Công cụ | Phiên bản | Ghi chú |
|---|---|---|---|
| Test runner | Vitest | 4.1.x | **Một** runner cho toàn kho mã |
| Postgres thật | `@testcontainers/postgresql` | 12.0.x | `.withReuse()`; boot ấm **< 5 s** trên Windows |
| Property-based | fast-check | 4.9.x | Bất biến, không phải ví dụ |
| Dữ liệu mẫu | `@faker-js/faker` | 10.5.x | Locale `vi` |
| E2E | Playwright | 1.61.x | Đã có sẵn trong devDependencies |
| Lint + format | Biome | 2.5.x | Một tệp cấu hình |

### 7.2.1 Vì sao Testcontainers, không phải service container của CI

Bộ test tự mang Postgres của nó lên. Database được định nghĩa **một lần** trong
test setup, và CI chạy đúng thứ mà lập trình viên chạy trên máy.

Một service container trong workflow CI sẽ là **cơ chế thứ hai** phải giữ đồng
bộ với cơ chế thứ nhất — và hai cơ chế nghĩa là trôi. Đây là một trong bảy mục
trong sổ đối chiếu ở chương 6 §6: bản kế hoạch đầu tiên viết service container,
và nó đã được sửa.

Cái giá: **bắt buộc có Docker Desktop** trên máy Windows. Không thương lượng,
bởi vì test tương tranh phải chạy trên Postgres thật — chứ không phải trên một
bản giả lập không có khoá dòng.

## 7.3 Năm tầng kiểm thử

### 7.3.1 Test tương tranh — quan trọng nhất

```
P1-INV-05:  50 yêu cầu đặt phòng song song trên buồng cuối cùng
            → đúng 1 thành công
            → 49 lần trả 409 sạch sẽ
            → 0 lần bán vượt
```

Test này được viết **trước** giao diện đặt phòng. Nó chạy trong CI trên Postgres
thật.

Nó không kiểm thử mã của tầng service; nó kiểm thử rằng **ràng buộc
`CHECK (sold_rooms <= total_rooms)` thực sự tồn tại và thực sự tuần tự hoá được
các ghi đồng thời**. Đó là một mệnh đề về lược đồ, và nó là mệnh đề mà toàn bộ
mục tiêu G1 đứng lên.

### 7.3.2 Property-based test

Với fast-check, một số bất biến được phát biểu ở dạng phổ quát thay vì ở dạng ví
dụ:

- **Không bản đồ gán buồng nào từng chứa chồng lấn** — với mọi trạng thái tồn kho sinh ngẫu nhiên.
- **Đầu ra của bộ tối ưu không bao giờ tệ hơn giải thuật tham lam** (P2.5).
- Tổng của một folio bằng tổng các dòng bút toán của nó, với mọi chuỗi ghi phí / thanh toán / đảo bút toán.

Ví dụ bắt được lỗi bạn nghĩ tới. Property bắt được lỗi bạn không nghĩ tới.

### 7.3.3 Test RBAC dữ liệu hoá

`P0-AUTH-04` giao một test mà với **mọi dòng** của
[`rbac-matrix.md`](../architecture/rbac-matrix.md), khẳng định:

- các vai trò được phép đi qua, **và**
- **ít nhất một vai trò bị từ chối nhận 403**.

Dữ liệu test lấy từ **một bảng được export duy nhất** — cùng bảng mà `@Roles()`
đọc. Ma trận và test do đó **không thể trôi khỏi nhau**. Một dòng thêm vào tài
liệu mà không có dòng test tương ứng là một lỗ hổng, và cấu trúc này khiến lỗ
hổng đó không tồn tại được.

Khẳng định chéo realm là riêng biệt và không thương lượng:

```
token khách    → route nhân viên → 403
token nhân viên → route khách    → 403
```

Không phải 401. Token hợp lệ; sai realm.

### 7.3.4 Test chuyển trạng thái bất hợp lệ

Bảng ở chương 5 §5.4.2 có 42 ô. Mỗi ô `✘` là một test khẳng định `409
IllegalTransition`.

Đáng chú ý là các trường hợp *hợp lệ nhưng phản trực giác* cũng phải có test:
`NO_SHOW → CHECKED_IN` **phải** đi qua (chỉ với `MANAGER`), và **phải** thất bại
nếu buồng đã được bán lại.

### 7.3.5 E2E chỉ dùng bàn phím

```
R1#15:  E2E nhận phòng chỉ bằng bàn phím → 0 sự kiện chuột
```

Playwright chạy toàn bộ luồng nhận phòng và **khẳng định số sự kiện chuột bằng
không**. Đây là cách duy nhất để "bàn phím là chính" không suy biến thành "có
thể dùng bàn phím nếu bạn cố".

### 7.3.6 Visual regression — đã hoạt động

Đây là tầng kiểm thử **duy nhất hiện đang chạy thật**. Playwright chụp ảnh xác
định của cả sáu act và commit chúng (`b80e902`). Đó là lưới an toàn khiến
migration React 19 + Next 16 đang chạy trở nên an toàn.

Chỉ tiêu: **0 px** khác biệt không giải thích được so với baseline trước
migration.

## 7.4 Idempotency của webhook

```
R1#6 / R3#8:  phát lại một callback 10 lần → 1 payment được ghi nhận
```

Cơ chế là ràng buộc `UNIQUE` trên `gateway_txn_id`, không phải một câu lệnh
kiểm tra "đã xử lý chưa" ở tầng ứng dụng. Xem chương 5 §5.5.2.

Test này bắt buộc chứ không phòng thủ: VNPay **có thể** gửi lại cùng một IPN
nhiều lần, và đó là hành vi đã xác minh.

## 7.5 Cổng chất lượng trong CI

| Cổng | Kiểm tra gì | Trạng thái |
|---|---|---|
| Lint + format | Biome trên toàn kho mã | 🔶 Biome thay ESLint ở `P-1-09` |
| Typecheck | `tsc --noEmit` trên toàn workspace | ✅ Đang chạy |
| Build | `pnpm build` qua Turborepo | ✅ Đang chạy |
| **Test** | `pnpm test` với Docker khả dụng | ❌ **Chưa có** — `P0-CI-04` |
| **Trôi ERD** | Sinh lại từ lược đồ sống, **fail khi lệch** | ❌ Chưa có — `P0-DOC-01` |
| **Độ phủ OpenAPI** | 100% endpoint có trong `openapi.json` | ❌ Chưa có — `P0-DOC-02` |
| **Ngân sách bundle** | 0 byte `three`/`gsap`/`lenis` trong `/booking` | ❌ Chưa có — P4 |
| **Phá vỡ contract có chủ ý** | Đổi contract mà không đổi hiện thực → **build fail** | ❌ Chưa có — `P0-C-04`, phụ thuộc `G1` |

Ba cổng cuối là loại cổng đáng nói. Chúng không kiểm thử hành vi; chúng khiến
**một số loại sai lầm nhất định trở thành không thể merge được**:

- Đổi lược đồ mà quên sinh lại ERD → CI đỏ. *Một sơ đồ đã trôi còn tệ hơn không có sơ đồ.*
- Vô tình kéo `three` vào đường đặt phòng → CI đỏ, thay vì một tỉ lệ chuyển đổi thấp không ai truy ra nguyên nhân.
- Đổi contract mà quên đổi hiện thực → build fail ở **hai** app, thay vì một lỗi runtime ở một app.

## 7.6 Dữ liệu mẫu

`P1-SEED-01` sinh: **40 buồng, 5 loại, 12 tháng dữ liệu giá, 500 booking tổng
hợp**, dùng `@faker-js/faker` locale `vi` để tên khách trông như tên khách thật.

Toàn bộ tái tạo được từ một câu lệnh. Điều này quan trọng hơn vẻ ngoài của nó:
một bộ dữ liệu tái tạo được là điều kiện để benchmark có nghĩa và để test tương
tranh chạy trên cùng một điểm xuất phát mỗi lần.

## 7.7 Kỷ luật khiến tham vọng trở nên an toàn

P2.5 (bộ tối ưu gán buồng) là phần "bài toán khó" của đồ án. Nó chỉ an toàn nhờ
bốn quy tắc:

1. **Giải thuật ngây thơ ở lại trong kho mã như một oracle tham chiếu.** Mọi đường tối ưu đều được **differential test** với nó trên các trạng thái tồn kho ngẫu nhiên, khẳng định kết quả tương đương hoặc tốt hơn.
2. **Property test** (fast-check) — xem §7.3.2.
3. **Benchmark trước/sau, công bố số liệu.** "p95 340 ms → 22 ms ở 10k booking, kèm flame graph" — chứ không phải "tôi đã tối ưu nó".
4. **Ràng buộc ở chương 5 §5.3 không được đụng tới.** Tối ưu hoá được phép đổi *buồng nào* được chọn — không bao giờ được đổi *việc chồng lấn có khả thi hay không*.

Quy tắc 1 là hiện vật học thuật có giá trị nhất của dự án: nó biến "tôi viết một
thuật toán" thành "tôi chứng minh thuật toán của tôi không sai so với một cài
đặt hiển nhiên đúng".

## 7.8 Kết quả đo

> ⚠ **Chưa có kết quả nào.** Bảng dưới đây liệt kê chỉ tiêu và mốc sinh ra chúng.
> Các ô kết quả được điền khi hiện vật tương ứng được chụp lại theo chương 6 §6.9
> — **không** điền bằng ước lượng.

| # | Chỉ tiêu | Mục tiêu | Sinh ra tại | Kết quả đo |
|---|---|---|---|---|
| 1 | Test tương tranh, buồng cuối cùng | Đúng **1** thành công, N−1 lần 409, **0** bán vượt | `P1-INV-05` | *chưa đo* |
| 2 | Số lần bán vượt trên production | **0** | Vận hành | *chưa đo* |
| 3 | Toàn vẹn night audit | **100%** số đêm | P6 | *chưa đo* |
| 4 | Vãng lai → hoá đơn đã xếp hàng | **< 3 phút**, bấm giờ | P3 | *chưa đo* |
| 5 | Tra cứu phòng trống p95 | **< 300 ms** | `P1-AVL-03` | *chưa đo* |
| 6 | Webhook phát lại 10× | **1** payment | `P0-PAY-03` | *chưa đo* |
| 7 | Độ phủ audit trên endpoint đổi trạng thái | **100%** | P5 | *chưa đo* |
| 8 | Độ phủ `inventory` + `folio` + `pricing` | **≥ 85%** | P1–P3 | *chưa đo* |
| 9 | E2E đặt phòng với gateway | Xanh trong CI; **1** giao dịch production thật | P4 | *chưa đo* |
| 10 | Diễn tập khôi phục | **< 1 giờ**, đã thực hiện và bấm giờ | Cổng `G2` | *chưa đo* |
| 11 | Lưu trữ ảnh giấy tờ | **0** đối tượng cũ hơn N ngày | Cổng `G2` | *chưa đo* |
| 12 | Gạch đầu dòng đề bài → màn hình/endpoint | **12/12** | P6 | *chưa đo* |
| 13 | Bundle `/booking` | **0 byte** `three`/`gsap`/`lenis` | P4 | *chưa đo* |
| 14 | Bộ tối ưu so với tham lam | Không bao giờ tệ hơn, cải thiện định lượng được | P2.5 | *chưa đo* |
| 15 | E2E nhận phòng chỉ bằng bàn phím | Pass; **0** sự kiện chuột | P2 | *chưa đo* |
| 16 | Kiểm tra trôi ERD | Xanh ở mọi lần chạy CI | `P0-DOC-01` | *chưa đo* |
| 17 | Độ phủ HĐĐT | **100%** folio đã đóng có số hoá đơn của nhà cung cấp | P3 | *chưa đo* |
| 18 | Ký số HĐĐT | **0** thao tác cắm dongle thủ công trên đường trả phòng | P3 | *chưa đo* |
| 19 | Boot ấm Testcontainers | **< 5 s** trên Windows | `P0-CI-02` | *chưa đo* |
| 20 | Visual regression 6 act | **0 px** khác biệt không giải thích được | `P-1-06` | 🔶 baseline đã commit, migration đang chạy |

Dòng 20 là dòng duy nhất có tiến triển thật, và ngay cả nó cũng chỉ ghi trạng
thái chứ không ghi một con số chưa đo.
