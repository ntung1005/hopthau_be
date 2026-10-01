# Hợp Thầu BE

API server cho [app](../hopthau_app) và [landing](../hopthau_web). Server giữ secret key và làm mọi việc với Supabase (Auth, Postgres).

- Node 22.18 trở lên, TypeScript chạy thẳng bằng Node (type stripping, không cần build).
- [Express 5](https://expressjs.com), `@supabase/supabase-js`.
- Supabase local qua Supabase CLI (cần Docker). Cổng `553xx` để không đụng runclaim.

## Chạy nhanh

```bash
npm install
npm run db:start                 # Supabase local, chạy migration + seed.sql
cp .env.example .env             # điền PUBLISHABLE_KEY, SECRET_KEY từ: npm run db:env
npm run dev                      # http://localhost:8788
npm test                         # test đơn vị (chuẩn hoá số điện thoại, tính giá gói)
npm run e2e                      # cả vòng lead trên BE đang chạy (npm run dev ở terminal khác)
npm run make-admin -- 09xxxxxxxx # cấp vai trò admin cho tài khoản đã đăng ký (đăng nhập web /admin)
npm run db:reset && npm run demo  # dữ liệu demo đầy đủ (BE phải đang chạy), in ra danh sách tài khoản
```

Đổi schema: thêm file vào `supabase/migrations/` rồi `npx supabase migration up` (giữ dữ liệu) hoặc `npm run db:reset` (xoá sạch, nạp lại seed). Studio: http://127.0.0.1:55323.

## Tài khoản

Số điện thoại + mật khẩu. Số được chuẩn hoá về `84xxxxxxxxx` (nhận `09...`, `+849...`, có dấu cách/chấm). Supabase Auth cần email nên server đổi thành email nội bộ `<số>@users.hopthau.vn`, người dùng không thấy. Chưa có OTP: đổi sang `signInWithOtp` khi chọn được nhà cung cấp SMS / Zalo ZNS.

## API

Lỗi trả về `{"error": "<mã>"}`, ví dụ `invalid_phone`, `phone_taken`, `invalid_credentials`, `package_not_found`.

| Nhóm | Route | Đăng nhập |
|---|---|---|
| Tài khoản | `POST /auth/register` `{phone, password, full_name?}` · `POST /auth/login` · `POST /auth/refresh` · `POST /auth/logout` | logout |
| Danh mục | `GET /projects?province=` · `GET /projects/:slug` (kèm mẫu căn) · `GET /unit-types/:id/packages` (sắp theo giá) · `GET /packages/:id` (kèm hạng mục). Dự án, mẫu căn có `min_price` ("từ X triệu") | không |
| Lead | `POST /leads` `{name, phone, project_id?, package_id?, note?, source?}` | không (giới hạn theo IP) |
| Hồ sơ | `GET /me` · `PATCH /me` `{full_name}` | có |
| Yêu cầu báo giá (chủ nhà) | `GET /quote-requests` · `GET /quote-requests/:id` (kèm các báo giá) · `POST /quote-requests` `{unit_type_id?, package_id?, address?, budget?, style?, note?}` · `POST /quote-requests/:id/accept` `{contractor_id}` | có |
| Hồ sơ nhà thầu công khai | `GET /contractors/:id` (chỉ nhà thầu đã xác minh: gói, đánh giá, số căn đã bàn giao) · `GET /unit-types/:id/showcase` (căn đã làm thực tế: ảnh, đánh giá, không giá, không chủ nhà) | không |
| Công trình | `GET /jobs` · `GET /jobs/:id` (mốc, phát sinh, đánh giá, tổng tiền, hạn bảo hành, số điện thoại hai bên) · nhà thầu: `POST /jobs/milestones/:id/submit` `{note?, photos?}` · `POST /jobs/milestones/:id/paid` · `POST /jobs/:id/changes` `{title, description?, amount, days_delta?}` · `POST /jobs/:id/review/reply` · chủ nhà: `POST /jobs/milestones/:id/review` `{approve, feedback?}` · `POST /jobs/changes/:id/decide` `{approve}` · `POST /jobs/:id/review` `{quality, punctuality, price_honesty, attitude, content?, photos?}` | có |
| Ảnh | `POST /uploads` `{content_type}` → `{upload_url, public_url}`: app `PUT` ảnh thẳng lên Storage. API chỉ nhận lại URL ảnh trong bucket `photos` | có |
| Landing | `GET /showcase` (căn đã làm thực tế mới nhất) · `GET /reviews/latest` (đánh giá mới nhất của nhà thầu đã xác minh) | không |
| Admin (vai trò admin) | `GET /admin/stats` · `GET /admin/contractors?status=` · `PATCH /admin/contractors/:id` `{status}` · `GET /admin/packages?status=` · `PATCH /admin/packages/:id` `{status}` · `GET /admin/requests?status=` · `GET /admin/requests/:id/suggestions` · `POST /admin/requests/:id/matches` `{contractor_id}` (tối đa 5) · `GET /admin/leads` · `GET/POST /admin/projects` · `POST /admin/projects/:id/unit-types` · `GET /admin/audit`. Mọi thao tác ghi vào `admin_audit` | có |
| Bản đo nhà | `GET/POST /measurements` · `GET/PUT/DELETE /measurements/:id` `{name, unit_type_id?, note?, data: {rooms: [...]}}`. Trả kèm `summary` (sàn, tường trừ cửa, chu vi từng phòng). Nhà thầu được ghép với yêu cầu có `measurement_id` thì `GET` được | có |
| Xoá tài khoản | `DELETE /me`: ẩn hồ sơ và gói nhà thầu, giữ công trình và đánh giá (ẩn danh) | có |
| Nhà thầu | `GET/POST/PATCH /contractor` (hồ sơ, `GET` trả `null` khi chưa đăng ký) · `GET/POST /contractor/packages` · `PUT/DELETE /contractor/packages/:id` · `POST /contractor/packages/:id/submit` · `GET /contractor/leads` · `POST /contractor/leads/:requestId/quote` `{price, duration_days, message?}` | có |

### Vòng lead

1. Nhà thầu đăng ký hồ sơ (`pending`), tạo gói nháp gồm hạng mục, gửi duyệt (`pending`).
2. Admin (web `/admin`) đặt nhà thầu `verified`, gói `published`. Chỉ khi cả hai đều đạt thì chủ nhà mới thấy gói.
3. Chủ nhà bấm "Nhận tư vấn" ở một gói, yêu cầu tự ghép với nhà thầu của gói (trigger). Yêu cầu tự do theo địa chỉ tự ghép tối đa 5 nhà thầu đã xác minh có khu vực phục vụ nằm trong địa chỉ; không ai khớp thì admin ghép tay ở web `/admin/yeu-cau`.
4. Nhà thầu gửi báo giá (sửa được khi chủ nhà chưa chọn). Chủ nhà chọn một báo giá: báo giá đó `accepted`, các báo giá khác `declined`, yêu cầu `matched`.
5. **Số điện thoại hai bên chỉ hiện sau bước 4.** Trước đó nhà thầu chỉ thấy tên chủ nhà.

Sửa gói đang hiển thị thì gói về `pending` để admin duyệt lại giá mới.

### Công trình (sau bước 4)

- Chọn báo giá tạo `jobs` với 4 mốc: cọc 30%, sản xuất 40%, lắp đặt 25%, nghiệm thu phần còn lại (tổng đúng bằng giá).
- Mốc làm lần lượt: nhà thầu báo xong (ghi chú + ảnh) → chủ nhà nghiệm thu hoặc trả lại (bắt buộc ghi cần sửa gì) → nhà thầu xác nhận đã nhận tiền. Nền tảng chỉ ghi nhận thanh toán, không giữ tiền.
- Phát sinh (tăng hoặc giảm tiền, thêm ngày) chỉ cộng vào tổng khi chủ nhà đồng ý. Bàn giao xong thì phát sinh chưa quyết coi như từ chối.
- Nghiệm thu mốc cuối: công trình `completed`, bảo hành tính từ ngày này. Chủ nhà đánh giá một lần (4 tiêu chí), điểm nhà thầu tự tính lại, nhà thầu trả lời công khai.

## Cơ sở dữ liệu ([supabase/migrations](supabase/migrations))

| Bảng | Nội dung | Ai đọc / ghi |
|---|---|---|
| `profiles` | Số điện thoại, họ tên, vai trò. Trigger tạo khi có tài khoản mới | Chủ tài khoản đọc, chỉ sửa được tên |
| `projects`, `unit_types` | Dự án và mẫu căn | Ai cũng đọc. Admin nhập qua Studio |
| `contractors` | Nhà thầu, trạng thái xác minh | Chỉ thấy nhà thầu đã duyệt. MST chỉ admin xem |
| `packages`, `package_items` | Gói theo mẫu căn và hạng mục | Chỉ thấy gói đã đăng (hoặc gói của mình) |
| `quote_requests` | Yêu cầu báo giá | Chủ nhà đọc / tạo của mình; nhà thầu đọc yêu cầu được ghép |
| `quote_matches` | Ghép yêu cầu với nhà thầu, kèm báo giá | Hai bên đọc; ghi qua hàm `submit_quote`, `accept_quote` |
| `jobs`, `job_milestones`, `job_changes` | Công trình, mốc, phát sinh | Hai bên đọc; ghi qua hàm `submit_milestone`, `review_milestone`, `confirm_payment`, `propose_change`, `decide_change` |
| `reviews` | Đánh giá công trình đã bàn giao | Ai cũng đọc; ghi qua `submit_review`, `reply_review` |
| `measurements` | Bản đo nhà: phòng (x, y, rộng, dài, cao) + góc cắt (`cuts`: cắt vuông / cắt chéo) + cửa trên tường; diện tích, chu vi tính theo đa giác ([src/measurement.ts](src/measurement.ts)) | Chủ nhà đọc; nhà thầu được ghép đọc; chỉ BE ghi sau khi kiểm tra |
| Storage `photos` | Ảnh gói, tiến độ, đánh giá | Bucket công khai, đường dẫn ngẫu nhiên theo người upload |
| `leads` | Form landing | Chỉ BE (service_role) |

Nguyên tắc:
- **Giá không lưu riêng.** Giá gói = tổng hạng mục bắt buộc ([src/pricing.ts](src/pricing.ts)), app dùng cùng công thức.
- **Tiền là `bigint` (đồng)**, không dùng số thực.
- **RLS là lớp bảo vệ cuối.** Người dùng gọi thẳng Supabase bằng token của mình cũng không tự nâng vai trò hay tạo yêu cầu cho người khác được.
