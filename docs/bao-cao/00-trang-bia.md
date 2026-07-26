# Trang bìa và thông tin đồ án

> 🔶 **Còn thiếu ngày tháng nộp.** Phụ thuộc hạn nộp, hiện chưa ấn định. Xem §4.

---

## Bìa

<div align="center">

**TRƯỜNG ĐẠI HỌC MỞ THÀNH PHỐ HỒ CHÍ MINH**

**KHOA CÔNG NGHỆ THÔNG TIN**

<br>

**ĐỒ ÁN MÔN HỌC**

**CÔNG NGHỆ PHẦN MỀM**

<br>

# XÂY DỰNG HỆ THỐNG QUẢN LÝ KHÁCH SẠN MARIVA

### Thiết kế và hiện thực một property management system cho khu nghỉ dưỡng chưa khai trương

<br><br>

| | |
|---|---|
| **Sinh viên thực hiện** | Trương Hưng Phát |
| **Mã số sinh viên** | 2351010154 |
| **Lớp** | DH23CS02 |
| **Giảng viên hướng dẫn** | ThS. Lưu Quang Phương |

<br><br>

**TP. HỒ CHÍ MINH, THÁNG [MM] NĂM [YYYY]**

</div>

---

## Thông tin phân công

Đồ án thực hiện **cá nhân**. Toàn bộ phân tích, thiết kế, hiện thực, kiểm thử và
biên soạn tài liệu do một người thực hiện.

| Hạng mục | Người thực hiện | Ghi chú |
|---|---|---|
| Phân tích yêu cầu và thiết kế kiến trúc | Trương Hưng Phát | |
| Thiết kế cơ sở dữ liệu và các bất biến | Trương Hưng Phát | |
| Hiện thực API (NestJS) | Trương Hưng Phát | |
| Hiện thực giao diện khách và console quản trị | Trương Hưng Phát | |
| Kiểm thử, CI/CD, triển khai | Trương Hưng Phát | |
| Biên soạn báo cáo | Trương Hưng Phát | |

Việc làm một mình có cái giá của nó, và báo cáo này nói thẳng cái giá đó ở
chương 9 §9.4.2: không có người review, không có bus factor. Bù lại bằng kiểm
thử tập trung vào đường đi của tiền và của buồng, cùng tài liệu viết song song
với mã nguồn chứ không lắp ráp ở cuối.

---

## Lời cam đoan

Tôi xin cam đoan đồ án này là công trình do tôi thực hiện. Các số liệu và kết
quả nêu trong báo cáo là trung thực và được đo trực tiếp từ hệ thống; những hạng
mục **chưa được đo** đều được đánh dấu rõ ràng thay vì ước lượng. Các tài liệu
tham khảo, thư viện và dịch vụ bên thứ ba đều được trích dẫn đầy đủ trong phần
Tài liệu tham khảo.

Riêng một điểm cần nói rõ: các quy định pháp lý được viện dẫn trong báo cáo —
đặc biệt là **Nghị định 70/2025/NĐ-CP** về hoá đơn điện tử khởi tạo từ máy tính
tiền — được ghi kèm trạng thái xác minh. Việc nghị định này có ràng buộc *mã
ngành cụ thể của pháp nhân vận hành Mariva* hay không vẫn đang chờ câu trả lời
của đại lý thuế (mã công việc `M0-06`), và báo cáo không trình bày điều đó như
đã kết luận.

<div align="right">

TP. Hồ Chí Minh, ngày [DD] tháng [MM] năm [YYYY]

Sinh viên thực hiện

<br><br>

**Trương Hưng Phát**

</div>

---

## 4. Thông tin còn thiếu

| # | Thông tin | Ai trả lời | Ghi chú |
|---|---|---|---|
| 1 | **Ngày, tháng, năm nộp** | Sinh viên | Phụ thuộc hạn nộp — xem §4.1. Xuất hiện ở bìa và ở lời cam đoan |
| 2 | Ký pháp sơ đồ bắt buộc: UML nghiêm ngặt hay sơ đồ sinh tự động (`D8`) | Giảng viên | Ảnh hưởng chương 2, 4, 5 |

### 4.1 Hạn nộp — đã xác nhận là còn xa

**Trạng thái:** chưa ấn định, và còn xa. Xác nhận ngày 2026-07-26.

Điều này **hợp thức hoá chiến lược "xây trước, viết sau"** ở chương 6 §6.8: báo
cáo là một lượt dịch và lắp ráp trên một tập tài liệu luôn cập nhật, chứ không
phải một tài liệu duy trì song song với một hệ thống đang dịch chuyển.

Ràng buộc duy nhất còn lại: khi hạn nộp được ấn định, hãy kiểm tra nó có rơi
**sau khi mốc P1 hoàn thành** hay không (khoảng 7 tuần công việc kỹ thuật tính
từ hôm nay, theo bảng mốc ở chương 6 §6.2). Nếu sớm hơn, chiến lược đảo ngược:
báo cáo phải viết dựa trên thiết kế thay vì dựa trên kết quả đo, và ranh giới
phạm vi ở chương 1 §1.4 phải thu hẹp tương ứng.
