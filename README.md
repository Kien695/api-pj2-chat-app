## Tổng quan

Xây dựng RESTful API kết hợp WebSocket Server phục vụ hệ thống mạng xã hội và nhắn tin thời gian thực.

## Tính năng & Công nghệ

- **Authentication & Authorization:**
  - Xây dựng xác thực người dùng bằng JWT.
  - Hỗ trợ OAuth 2.0 với Google.
  - Xử lý luồng quên mật khẩu qua email.

- **Real-time Communication:**
  - Xây dựng WebSocket Server với Socket.io.
  - Xử lý chat 1-1, chat nhóm.
  - Quản lý trạng thái online/offline.

- **User & Social Management:**
  - API quản lý người dùng.
  - Tìm kiếm người dùng.
  - Xử lý logic kết bạn và danh sách bạn bè.

- **Group Management:**
  - API tạo, xóa nhóm.
  - Quản lý thành viên nhóm.

- **Media Management:**
  - Upload hình ảnh, file thông qua Cloudinary.

- **Database Management:**
  - Thiết kế database lưu trữ user, friendship, group, message.
  - Tối ưu truy vấn dữ liệu.

## Công nghệ sử dụng

Node.js, Express.js, MongoDB, Mongoose, Socket.io, JWT, OAuth 2.0, Cloudinary, Docker

## API tổng quan:

https://apichat.kien.cloud/
