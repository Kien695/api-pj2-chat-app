# Server Chat API

## Tổng quan

Server Chat API là backend cho ứng dụng nhắn tin thời gian thực `chat-app`. Hệ thống cung cấp REST API, Socket.IO server, WebRTC signaling, lưu trữ dữ liệu MongoDB, trạng thái phân tán trên Redis và upload media qua Cloudinary.

Backend được thiết kế để hỗ trợ xác thực nhiều phương thức, chat cá nhân/nhóm, gọi âm thanh/video, thông báo đẩy, quản lý phiên đăng nhập và các cơ chế bảo vệ cần thiết cho môi trường production.

## Tính năng

### Xác thực và quản lý phiên

- Đăng ký, xác minh email bằng OTP và đăng nhập bằng mật khẩu.
- Google OAuth 2.0 qua Passport.
- Passkey/WebAuthn cho đăng ký và đăng nhập không mật khẩu.
- Đăng nhập bằng mã QR với ticket ngắn hạn và xác nhận từ thiết bị đã đăng nhập.
- Access token và refresh token dùng secret riêng biệt.
- Refresh token rotation và phát hiện token đã bị tái sử dụng.
- Quản lý nhiều thiết bị/phiên đăng nhập.
- Thu hồi một phiên, các phiên khác hoặc toàn bộ phiên liên quan.
- Cookie xác thực được cấu hình theo môi trường.

### Khôi phục mật khẩu

- Gửi OTP qua email cho luồng quên mật khẩu.
- Reset ticket có thời hạn và chỉ lưu dạng hash.
- Reset ticket dùng một lần, chống phát lại.
- Thu hồi toàn bộ refresh token/phiên sau khi đổi mật khẩu thành công.
- Audit log cho các sự kiện reset mật khẩu.

### Chat thời gian thực

- Chat 1-1 và chat nhóm qua Socket.IO.
- Xác thực Socket.IO trước khi thiết lập kết nối.
- Kiểm tra thành viên phòng trước khi join, gửi tin, đọc tin hoặc phát sự kiện.
- Validate payload và rate limit riêng cho sự kiện socket.
- Trạng thái đang nhập và online/offline.
- Theo dõi trạng thái tin nhắn đã nhận và đã đọc.
- Chống tạo tin nhắn trùng bằng định danh phía client.
- Đồng bộ tin nhắn bị bỏ lỡ sau khi reconnect.
- Phân trang lịch sử bằng cursor.
- Tìm kiếm tin nhắn và lấy ngữ cảnh xung quanh kết quả.
- Redis adapter hỗ trợ Socket.IO khi chạy nhiều instance.

### Gọi âm thanh và video

- Socket.IO signaling cho WebRTC/simple-peer.
- Kiểm tra quyền và quan hệ giữa người gọi/người nhận.
- Quản lý trạng thái cuộc gọi đang chờ, đã nhận, từ chối, kết thúc hoặc hết hạn.
- Chống giả mạo signaling và thao tác cuộc gọi trái phép.
- Worker dọn các cuộc gọi quá hạn.

### Người dùng, bạn bè và nhóm

- Xem, tìm kiếm và cập nhật hồ sơ người dùng.
- Upload ảnh đại diện và ảnh bìa.
- Gửi, hủy, chấp nhận và từ chối lời mời kết bạn.
- Hủy kết bạn và quản lý danh sách bạn bè.
- Tạo, sửa và xóa nhóm chat.
- Thêm, xóa thành viên và rời nhóm.
- Phân quyền quản trị viên nhóm và kiểm tra membership ở server.
- Transaction bảo vệ tính nhất quán khi cập nhật phòng, thành viên và dữ liệu liên quan.

### Upload và quản lý media

- Upload hình ảnh và tệp tin qua Multer và Cloudinary.
- Giới hạn số lượng, dung lượng và loại tệp theo từng endpoint.
- Kiểm tra MIME type, phần mở rộng và metadata tệp đã upload.
- Xóa tài nguyên Cloudinary khi request hoặc transaction thất bại.
- Hàng đợi và worker dọn media không còn được tham chiếu.
- Cleanup lease tránh nhiều instance cùng xử lý một công việc.

### Push notification

- Đăng ký và hủy Web Push subscription theo người dùng/thiết bị.
- Mã hóa dữ liệu subscription nhạy cảm trước khi lưu.
- Gửi thông báo tin nhắn mới và cuộc gọi đến bằng VAPID.
- Hàng đợi push có giới hạn concurrency.
- Tự loại bỏ subscription không còn hợp lệ.
- Dọn subscription khi phiên đăng nhập bị thu hồi.

### Bảo mật API

- Helmet security headers và CORS có credentials.
- Authentication và authorization ở REST API lẫn Socket.IO.
- Rate limiting theo nhóm hành động cho auth, REST và socket.
- Input validation cho auth, tìm kiếm, phòng chat, thành viên và tin nhắn.
- Kiểm tra quyền truy cập phòng và quyền quản trị nhóm.
- Chuẩn hóa HTTP error response, không làm lộ chi tiết nội bộ.
- Structured audit log cho sự kiện bảo mật và phiên đăng nhập.
- Kiểm tra cấu hình JWT ngay khi khởi động.

### Độ tin cậy và vận hành

- Health check: liveness và readiness.
- Endpoint metrics được bảo vệ bằng token.
- Request ID, thời gian xử lý và observability middleware.
- Runtime metrics cho HTTP, Socket.IO, worker và kết nối đang hoạt động.
- Tạo và kiểm tra các MongoDB index quan trọng khi khởi động.
- Worker dọn presence, cuộc gọi, media và xử lý push notification.
- Graceful shutdown khi nhận `SIGINT`, `SIGTERM` hoặc lỗi process nghiêm trọng.
- Đóng HTTP server, Socket.IO, Redis, MongoDB và worker theo đúng thứ tự.

## Công nghệ sử dụng

- Node.js và Express .
- Socket.IO 4 và `@socket.io/redis-adapter`.
- Mongoose
- Redis.
- JWT, bcrypt/bcryptjs và cookie-parser.
- Passport và Passport Google OAuth 2.0.
- SimpleWebAuthn Server.
- Multer, Cloudinary và Streamifier.
- Nodemailer.
- Web Push/VAPID.
- Helmet và CORS.
- Node.js Test Runner.
- Nodemon cho môi trường phát triển.
- Docker, Docker Compose và PM2 ecosystem config cho triển khai.

## Yêu cầu hệ thống

- Node.js tương thích với các dependency trong `package.json`.
- Redis đang hoạt động.
- Tài khoản Cloudinary cho upload media.
- SMTP account cho OTP/email.
- VAPID key pair cho Web Push.
- Google OAuth credentials nếu sử dụng đăng nhập Google.

## Cấu hình môi trường

Tạo file `.env` trong thư mục `server-chat-api`:

```env
PORT=3000

MONGOOSE_URL=mongodb://localhost:27017/chat-app?replicaSet=rs0

REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PASSWORD=

FE_URL=http://localhost:5173
CLIENT_URL=http://localhost:5173
CLIENT_ORIGIN=http://localhost:5173

JWT_ACCESS_TOKEN=replace_with_access_secret_at_least_24_chars
JWT_REFRESH_TOKEN=replace_with_different_refresh_secret_at_least_24_chars
JWT_SECRET_KEY=replace_with_password_reset_secret

USER_EMAIL=your_smtp_email
USER_PASS=your_smtp_password

GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
CALLBACK_URL=http://localhost:3000/auth/google/callback

RP_ID=localhost
RP_NAME=Chat App

QR_EXPIRE_TIME=120

CLOUD_NAME=your_cloudinary_cloud_name
CLOUD_KEY=your_cloudinary_api_key
CLOUD_SECRET=your_cloudinary_api_secret

PUSH_VAPID_SUBJECT=mailto:admin@example.com
PUSH_VAPID_PUBLIC_KEY=your_public_vapid_key
PUSH_VAPID_PRIVATE_KEY=your_private_vapid_key
PUSH_SUBSCRIPTION_ENCRYPTION_KEY=your_subscription_encryption_key

METRICS_TOKEN=your_metrics_access_token
```

Lưu ý:

- `JWT_ACCESS_TOKEN` và `JWT_REFRESH_TOKEN` phải khác nhau và mỗi giá trị dài ít nhất 24 ký tự.
- `PUSH_VAPID_SUBJECT` phải bắt đầu bằng `mailto:` hoặc `https://`.
- Không đưa `.env`, private VAPID key, JWT secret, SMTP password hoặc Cloudinary secret vào Git.
- Backend hiện yêu cầu cấu hình Push Notification hợp lệ khi khởi động.

## Chạy local

Cài dependency:

```bash
npm install
```

Chạy development server:

```bash
npm run dev
```

Hoặc chạy trực tiếp:

```bash
npm start
```

Backend phải kết nối thành công MongoDB replica set và Redis trước khi bắt đầu nhận request.

## Kiểm thử

Chạy toàn bộ test:

```bash
npm test
```

Bộ test hiện bao phủ các nhóm chính:

- Authentication, session issuance, refresh token rotation và password reset.
- Room authorization, role/membership và transaction consistency.
- Socket authentication, payload validation và rate limiting.
- Message pagination, search, receipt, persistence và reconnect consistency.
- Call state, signaling security và timeout worker.
- Upload validation, Cloudinary cleanup và media cleanup worker.
- Presence, Redis adapter, health check, metrics và graceful shutdown.
- Push subscription, push queue và vòng đời subscription theo session.

## Endpoint vận hành

- `GET /health/live`: kiểm tra process còn hoạt động.
- `GET /health/ready`: kiểm tra khả năng phục vụ request và dependency.
- `GET /metrics`: runtime metrics; yêu cầu metrics token.

Các API nghiệp vụ được tổ chức dưới:

- `/auth`: xác thực, người dùng, phiên, Passkey, QR, bạn bè, nhóm và push subscription.
- `/chat`: lịch sử, tìm kiếm, đồng bộ và upload tin nhắn; yêu cầu authentication.

## Cấu trúc chính

```text
server-chat-api/
├── config/       # MongoDB, Redis, Passport và email
├── controller/   # HTTP controller
├── middleware/   # Auth, authorization, validation, upload và observability
├── model/        # Mongoose schema
├── router/       # REST route
├── service/      # Nghiệp vụ, bảo mật, worker và tích hợp hạ tầng
├── socket/       # Socket.IO server và event handlers
├── test/         # Node.js test suite
├── utils/        # Token, transaction, audit, error và lifecycle helpers
├── validate/     # Validation cho authentication
└── index.js      # Bootstrap và graceful lifecycle
```

## API production

Địa chỉ từng được cấu hình cho API:

```text
https://apichat.kien.cloud/
```

Khả năng truy cập phụ thuộc vào trạng thái triển khai hiện tại và cấu hình môi trường.
