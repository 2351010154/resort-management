# Chương 3 — Lựa chọn công nghệ

Chương này ghi *lý do* chứ không chỉ ghi *kết quả*. Mỗi quyết định được trình
bày kèm phương án bị loại và điều đánh đổi phải chấp nhận. Phiên bản đã kiểm
chứng trên npm registry ngày 2026-07-26.

## 3.1 Nguyên tắc chọn

Ba nguyên tắc quyết định gần như toàn bộ bảng bên dưới.

**Ràng buộc đúng đắn phải biểu diễn được bằng cơ sở dữ liệu.** Bất kỳ công cụ
nào không diễn đạt nổi `daterange` và `EXCLUDE USING gist` đều bị loại, dù nó
tiện tới đâu. Đây là lý do Prisma bị loại (§3.4).

**Hợp đồng dữ liệu khai báo một lần.** Một kiểu viết tay ở frontend để phản chiếu
response của API là một lần trôi dữ liệu đang chờ xảy ra.

**Ít bộ phận chuyển động.** Ở quy mô 40 buồng và một lập trình viên, mỗi service
thêm vào là một thứ phải sao lưu, phải giám sát, phải nâng cấp.

## 3.2 Runtime và workspace

| Vấn đề | Lựa chọn | Phiên bản | Lý do |
|---|---|---|---|
| Runtime | Node LTS (dòng chẵn) | 24.x | Node 20 đã hết vòng đời từ tháng 4/2026. `.nvmrc`, `engines` và CI đã được ghim **cùng lúc** sang Node 24 trong migration P−1 |
| Trình quản lý gói | pnpm | 11.1.2 | Đã dùng. Kỷ luật `allowBuilds` đã đúng |
| Trình chạy tác vụ | Turborepo | 2.10.7 | Đã dùng |
| Ngôn ngữ | TypeScript | 5.6.3 | Nâng lên bản mới nhất khi Nest 11 vào |

## 3.3 API — `apps/api`

| Vấn đề | Lựa chọn | Phiên bản | Lý do |
|---|---|---|---|
| Framework | NestJS | 11.1.x | `@orpc/nest` yêu cầu peer `>=11` |
| HTTP adapter | Express | 5.2.x | `@orpc/nest` peer `express >=5`. Fastify 5 cũng được; Express là lựa chọn nhàm chán, và nhàm chán là đúng ở đây |
| ORM | drizzle-orm + drizzle-kit | 0.45.x | Migration sinh ra `.sql` thật để sửa tay → `btree_gist` / `EXCLUDE` / `daterange` nằm trong version control |
| Driver DB | `pg` (node-postgres) | 8.22.x | pg-boss dùng `pg` bên trong. Cùng driver = **một** connection pool, không phải hai |
| Contract | `@orpc/contract` | 1.14.10 | Contract-first, đặt trong `packages/shared` |
| Ràng buộc vào Nest | `@orpc/nest` | 1.14.10 | Hiện thực contract bên trong Nest, giữ được DI và guard |
| Cầu nối validation | `@orpc/zod` | 1.14.10 | Peer `zod >=3.25` → **zod v4 được giữ nguyên** |
| OpenAPI | `@orpc/openapi` | 1.14.10 | Tài liệu API cho đồ án được **sinh ra**, không viết tay |
| Job queue | pg-boss | 12.26.x | Hàng đợi nằm trong chính Postgres. Enqueue tham gia được vào transaction |
| Logging | pino + nestjs-pino | 4.6.x | JSON có cấu trúc, gắn theo request |
| Config | zod schema parse lúc boot | — | Chết lúc khởi động, không chết lúc 2 giờ sáng |

## 3.4 Hai quyết định đáng so sánh chi tiết

### 3.4.1 Drizzle so với Prisma

Đây là quyết định quan trọng nhất chương này, vì nó chạm trực tiếp vào tường
chịu lực ở chương 5.

| Tiêu chí | Drizzle | Prisma |
|---|---|---|
| Kiểu `daterange` của Postgres | ✅ Hỗ trợ | ❌ Không có kiểu tương ứng |
| Ràng buộc `EXCLUDE USING gist` | ✅ Migration SQL sửa tay | ❌ Không diễn đạt được trong schema |
| Extension `btree_gist` | ✅ Migration thường | ⚠ Phải dùng SQL thô ngoài luồng |
| Trải nghiệm nhà phát triển | Thô hơn, không có GUI Studio | Tốt hơn đáng kể |
| Tài liệu và cộng đồng | Mỏng hơn | Dày hơn nhiều |
| An toàn kiểu | Tốt | Tốt — **nhưng hỏng đúng ở chỗ quan trọng nhất** |

Dòng cuối là dòng quyết định. Prisma cho an toàn kiểu tốt ở mọi nơi *trừ* tồn
kho và tiền, tức là đúng hai chỗ mà sai sót gây tổn thất thật. Với Drizzle, sẽ
phải đọc nhiều SQL hơn — và đó chính là mục đích.

### 3.4.2 pg-boss so với Redis + BullMQ

| Tiêu chí | pg-boss | Redis + BullMQ |
|---|---|---|
| Hạ tầng thêm vào | **Không** — dùng Postgres sẵn có | Một service phải chạy, sao lưu, giám sát |
| Enqueue trong cùng transaction | ✅ Có | ❌ Không — dẫn tới lỗi ghi kép kinh điển |
| Thông lượng | Đủ dùng ở quy mô 40 buồng, mãi mãi | Cao hơn nhiều, không cần tới |
| Chi phí vận hành | ~0 | Một vendor nữa hoặc một container nữa |

Việc enqueue tham gia transaction là điều đáng nói. Khi folio đóng, ta muốn "ghi
bút toán cuối" và "xếp hàng job phát hành hoá đơn" cùng thành công hoặc cùng
thất bại. Với Redis, hai việc đó nằm ở hai hệ thống và ta phải tự viết cơ chế bù
trừ.

**`@nestjs/schedule` một mình không đủ.** Nó là bộ hẹn giờ, không phải hàng đợi.
Hai instance đang chạy nghĩa là night audit chốt sổ hai lần.

## 3.5 Hợp đồng dữ liệu — `packages/shared`

| Vấn đề | Lựa chọn | Phiên bản | Lý do |
|---|---|---|---|
| Schema | zod | 4.4.x | Giữ nguyên. oRPC gỡ được điểm nghẽn (§3.6) |
| Sinh schema từ bảng | drizzle-zod | 0.8.3 | Bảng → zod, không trôi |
| **Ngày tháng** | **`@internationalized/date`** | 3.12.x | `CalendarDate` ≠ `ZonedDateTime` **ở mức kiểu** |
| Tiền | **không dùng thư viện** | — | `bigint` VND. `Intl.NumberFormat('vi-VN')` để hiển thị |

Hai dòng cuối là hai bất biến được nâng lên thành lỗi biên dịch.

**Ngày lưu trú không phải là thời điểm.** Ranh giới kỳ lưu trú là `date`; sự kiện
là `timestamptz`; cơ sở neo ở `Asia/Ho_Chi_Minh`. Trộn lẫn hai thứ là nguồn số
một của lỗi lệch một đêm. `@internationalized/date` biến việc trộn đó thành lỗi
**compile** thay vì một test có thể quên viết.

**Tiền là số nguyên VND.** Không float, không decimal. Thuế và phí phục vụ là các
dòng bút toán riêng, không bao giờ nướng sẵn vào tổng. `dinero.js` hay
`decimal.js` không mua được gì: VND không có đơn vị phụ.

## 3.6 Một quyết định bị đảo: ts-rest → oRPC

Phần này được ghi lại vì một lý do: **danh sách quyết định có ghi lần đảo thì
đáng tin hơn danh sách trông sạch sẽ.**

Lựa chọn ban đầu cho tầng contract là ts-rest. Nó bị giết bởi một xung đột kiểm
chứng được:

- `@ts-rest/core@3.52.1` (bản latest) khai peer `zod: ^3.22.3` — **chỉ v3**
- `packages/shared` ghim `zod ^4.4.3`
- `@ts-rest/core@3.53.0-rc.1` bỏ peer zod — nhưng là **RC**, không có ngày ổn định kiểm soát được

oRPC hoá giải xung đột trên một bản phát hành ổn định:

| Yêu cầu | ts-rest 3.52.1 | oRPC 1.14.10 |
|---|:-:|:-:|
| zod v4 | ❌ chỉ v3 | ✅ peer `>=3.25.0` |
| Contract-first | ✅ | ✅ |
| OpenAPI cho đồ án | ⚠ thêm việc | ✅ hạng nhất |
| Tích hợp NestJS | ⚠ tự viết | ✅ `@orpc/nest` chính thức |
| Route webhook REST thật | ✅ | ✅ đã kiểm chứng |
| Hook cho admin | ⚠ phải nối thêm | ✅ `@orpc/tanstack-query` |
| Trạng thái phát hành | ✅ ổn định | ✅ ổn định |

Cái giá phải trả: oRPC trẻ hơn, cộng đồng nhỏ hơn. Cả hai đều nhỏ; oRPC là bên
không bắt ta phải đánh đổi tồi.

**Đề xuất đến từ phía chủ đầu tư và nó đúng.** Ghi lại điều này vì nó minh hoạ
một điểm về quy trình: quyết định kỹ thuật nên thắng bằng bằng chứng, chứ không
bằng việc ai nêu ra trước.

**Điều kiện chưa đóng.** Việc `@orpc/nest` có thực sự cưỡng chế contract ở mức
**biên dịch** hay không vẫn chưa được kiểm chứng — tài liệu ở các URL đã thử trả
về 404. Đây là cổng `G1` trong chương 6: một spike 30 phút, và kết quả được ghi
lại **dù đi hay không đi**. Nếu không, oRPC mất lợi thế chính so với
Nest + Swagger và tầng contract phải mở lại trước khi viết endpoint đầu tiên.

## 3.7 Frontend

### 3.7.1 `apps/web` — bề mặt hướng khách

| Vấn đề | Lựa chọn | Lý do |
|---|---|---|
| CSS | **CSS Modules, giữ nguyên** | Rủi ro bằng không cho sáu act CSS đã tinh chỉnh theo cuộn |
| Motion | `motion` 12.42.x | Dùng cho `/booking`. Các act giữ GSAP — không migrate mã đang chạy tốt |
| Nguồn component | React Bits (biến thể CSS) | Chép vào rồi viết lại theo token của Mariva |
| Hiện có | three / @react-three/fiber / gsap / lenis / zustand | **Chỉ trong `(marketing)`.** Không bao giờ trong `(booking)` |

### 3.7.2 `apps/admin` — console vận hành

| Vấn đề | Lựa chọn | Phiên bản | Lý do |
|---|---|---|---|
| Framework | Next.js | khớp với web | Một phiên bản trên toàn kho mã |
| CSS | Tailwind | 4.3.x | `@theme` của v4 đọc CSS custom property → **tiêu thụ trực tiếp token Mariva** |
| Primitive | shadcn/ui (Radix) | CLI | Chép vào, nên quản lý focus là việc của mình |
| Command palette | cmdk | 1.1.x | Ctrl+K |
| Bảng dữ liệu | `@tanstack/react-table` | 8.21.x | Headless, cho lưới dày đặc |
| Biểu đồ | Bklit | shadcn registry | 17+ loại biểu đồ, chép vào dạng mã nguồn |
| Form | react-hook-form + zod resolver | 7.83.x | Dùng lại schema của `packages/shared` |
| Motion | `motion` | 12.42.x | **Chỉ vi tương tác** |

### 3.7.3 Một điều đáng nói thẳng về thiết kế

Trang marketing và quầy lễ tân có mục tiêu thiết kế **ngược nhau**. Một lễ tân
chạy quy trình nhận phòng bốn mươi lần mỗi ngày: hoạt ảnh là độ trễ mà họ *cảm
nhận được*. Hoạt ảnh marketing tồn tại để làm chậm mắt người xem lại; hoạt ảnh
trên console không bao giờ được làm chậm tay người dùng.

Kết luận: **cùng bảng màu, cùng thang chữ, cùng nhịp khoảng cách — khác ngân
sách chuyển động.** Admin dùng Motion cho phản hồi trạng thái (≤ 150 ms,
`--ease-ui`), không bao giờ cho hoạt ảnh xuất hiện. Cơ chế tắt theo
`prefers-reduced-motion` đã có sẵn ở `globals.css` và được mang sang
`tokens.css` để admin thừa hưởng.

## 3.8 Chất lượng và giao hàng

| Vấn đề | Lựa chọn | Phiên bản | Ghi chú |
|---|---|---|---|
| Test runner | Vitest | 4.1.x | Một runner cho toàn kho mã |
| Postgres thật trong test | `@testcontainers/postgresql` | 12.0.x | Cần Docker Desktop trên Windows |
| Property-based test | fast-check | 4.9.x | "Không bản đồ gán buồng nào từng chồng lấn" |
| Dữ liệu mẫu | `@faker-js/faker` | 10.5.x | Locale `vi` cho tên khách Việt thực tế |
| E2E | Playwright | 1.61.x | **Đã có sẵn trong devDependencies** |
| Lint + format | Biome | 2.5.x | Một công cụ, nhanh hơn ~25× |
| Git hook | lefthook | 2.1.x | Một binary |
| ERD | `drizzle-dbml-generator` | 0.10.x | Lược đồ → DBML. **CI fail khi lệch** |
| Xuất Excel | exceljs | 4.4.0 | ⚠ **Phát hành lần cuối 2024-12-20.** Chạy được nhưng cũ; xem lại ở P5 |

## 3.9 Những công nghệ bị loại và lý do

| Bị loại | Lý do |
|---|---|
| **Prisma** | Không diễn đạt được `daterange` / `EXCLUDE`. An toàn kiểu hỏng đúng ở tiền và tồn kho (§3.4.1) |
| **tRPC** | Cần REST thật cho webhook của cổng thanh toán. Sẽ thành hai tầng API |
| **Redis / BullMQ** | Một service phải vận hành, và enqueue không tham gia được transaction (§3.4.2) |
| **`@nestjs/schedule` đơn thuần** | Bộ hẹn giờ, không phải hàng đợi. Hai instance = hai lần chốt sổ |
| **Migrate `apps/web` sang Tailwind** | Viết lại phần CSS mong manh nhất để đổi lấy không gì cả |
| **React Bits trong admin** | Chính tài liệu của nó mô tả nó là vật liệu cho landing page |
| **dinero.js / decimal.js** | `bigint` VND đã đủ |
| **MUI X Pro** | Trả tiền cho tính năng lưới mà TanStack Table cho miễn phí |
| **Một engine sinh PDF cho hoá đơn** | Hoá đơn pháp lý là output của nhà cung cấp HĐĐT, không phải của ta |
| **Node 25** | Dòng Current lẻ, không phải LTS |
| **Hai test runner** | Vitest ở mọi nơi |
| **Tự viết HMAC cho VNPay** | Dùng thư viện `vnpay` được bảo trì. Đây là chỗ ai cũng ship một lỗi chữ ký đúng một lần |
| **Microservice** | Một ứng dụng Nest, chia mô-đun theo miền. Xem chương 4 |
| **Event sourcing toàn bộ** | Sổ cái cho tiền, bảng audit cho thay đổi. Thế là đủ |

## 3.10 Đánh đổi phải chấp nhận

- **Hai idiom CSS.** Chuyển qua lại giữa CSS Modules và Tailwind là ma sát thật. Đổi lấy: rủi ro bằng không cho phần Three.js, và dùng được shadcn/Bklit/React Bits như chúng được phát hành.
- **oRPC còn trẻ.** Ít câu trả lời trên StackOverflow hơn cả ts-rest. Giảm thiểu bằng spike `G1` trước khi commit.
- **Bắt buộc có Docker Desktop** trên máy Windows để chạy Testcontainers. Không thương lượng, vì test tương tranh phải chạy trên Postgres thật.
- **Drizzle thay vì Prisma** — không có Studio GUI, tài liệu mỏng hơn, phải đọc nhiều SQL hơn.
- **pg-boss dùng chung database.** Tải job và tải truy vấn cạnh tranh cùng một Postgres. Không đáng kể ở quy mô này; sẽ đáng kể ở quy mô gấp 10.
- **exceljs đã cũ** (12/2024). Một phụ thuộc không còn được bảo trì nằm trên đường xuất dữ liệu.
- **Component chép vào thì không nhận bản vá thượng nguồn.** Mã của shadcn/Bklit/React Bits trở thành mã của mình ngay khi dán vào — cả lỗi lẫn cải tiến.
- **Biome ≠ hệ sinh thái ESLint.** Vài rule chuyên biệt của Next/React chưa có bản tương đương. Đảo ngược rẻ, nên nó không phải quyết định chặn.

## 3.11 Trạng thái xác minh

Báo cáo phân biệt rõ ba mức, vì trộn lẫn chúng là cách một tài liệu kỹ thuật mất
uy tín.

**Đã kiểm chứng phiên bản trên npm registry (2026-07-26):** toàn bộ số phiên bản
trong các bảng trên; xung đột peer `zod` của ts-rest; peer của `@orpc/*`; ngày
phát hành cuối của exceljs.

**Độ tin cậy cao, thực hành chuẩn, không kiểm chứng trong khoá luận này:** cơ chế
`@theme` của Tailwind v4 đọc CSS custom property; ngữ nghĩa enqueue trong
transaction của pg-boss; việc migration Drizzle sửa tay mang được ràng buộc
`EXCLUDE`.

**Chưa kiểm chứng — phải xác nhận trước khi dựa vào:** `@orpc/nest` có cưỡng chế
contract ở mức biên dịch hay không (cổng `G1`); công nghệ render bên dưới của
Bklit và khả năng tiếp cận bằng bàn phím / trình đọc màn hình của nó; số hiệu
dòng LTS của Node tại ngày cài đặt thực tế.
