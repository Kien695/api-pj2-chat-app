const mongoose = require("mongoose");
const User = require("../model/user.model");
const RoomChat = require("../model/room-chat.model");
const bcryptjs = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { sendMail } = require("../config/sendMail");
const { generateAccessToken } = require("../utils/generateAccessToken");
const { generateRefreshToken } = require("../utils/generateRefreshToken");
const searchHelper = require("../helper/search");
const Chat = require("../model/chat.model");
const { myDocument } = require("../helper/createMyDocument");
const cloudinary = require("cloudinary").v2;
cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.CLOUD_KEY,
  api_secret: process.env.CLOUD_SECRET,
  secure: true,
});
//register
module.exports.register = async (req, res) => {
  try {
    const { name, email, password } = req.body;
    let user;
    user = await User.findOne({ email: email });
    if (user) {
      return res.status(400).json({
        error: true,
        success: false,
        message: "Email đã tồn tại!",
      });
    }

    const verifyCode = Math.floor(100000 + Math.random() * 900000).toString();
    const salt = await bcryptjs.genSalt(10);
    const hashPassword = await bcryptjs.hash(password, salt);
    user = new User({
      name: name,
      email: email,
      password: hashPassword,
      otp: verifyCode,
      otp_expiry: Date.now() + 600000,
    });
    user.save();
    //tạo document
    await myDocument(user._id);
    //otp
    const subject = "Mã OTP xác minh";
    const html = `Mã OTP để xác quy Email của bạn là: <b style="color:green">${verifyCode}</b>. Thời hạn sử dụng là: ${Math.ceil(
      600000 / 60000
    )} phút`;
    const verifyEmail = await sendMail(email, subject, html);

    const token = jwt.sign(
      {
        email: user.email,
        id: user._id,
      },
      process.env.JWT_SECRET_KEY
    );
    return res.status(200).json({
      error: false,
      success: true,
      message: "Vui lòng xác minh email của bạn",
      token: token,
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};
//change password
module.exports.changePassword = async (req, res) => {
  try {
    const userId = res.locals.userId;
    const user = await User.findById(userId);
    const { passwordOld, passwordNew, confirmPasswordNew } = req.body;

    if (!user) {
      return res.state(400).json({
        message: "Người dùng không tồn tại",
        error: true,
        success: false,
      });
    }
    const isMatch = await bcryptjs.compare(passwordOld, user.password);
    if (!isMatch) {
      return res.status(400).json({
        message: "Mật khẩu cũ không chính xác",
        error: true,
        success: false,
      });
    }
    const isSameOld = await bcryptjs.compare(passwordNew, user.password);
    if (isSameOld) {
      return res.status(400).json({
        message: "Mật khẩu mới không được trùng mật khẩu cũ",
        error: true,
        success: false,
      });
    }
    if (passwordNew !== confirmPasswordNew) {
      return res.status(400).json({
        error: true,
        success: false,
        message: "Mật khẩu không trùng khớp!",
      });
    }
    const salt = await bcryptjs.genSalt(10);
    const hashPasswordNew = await bcryptjs.hash(passwordNew, salt);
    user.password = hashPasswordNew;
    await user.save();
    return res.status(200).json({
      error: false,
      success: true,
      message: "Đổi mật khẩu thành công!",
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};
//verify email
module.exports.verifyEmail = async (req, res) => {
  try {
    const { email, otp } = req.body;
    const user = await User.findOne({ email: email });
    if (!user) {
      return res.status(400).json({
        error: true,
        success: false,
        message: "Email không chính xác!",
      });
    }
    if (user.otp_expiry > Date.now() && user.otp == otp) {
      user.verify_email = true;
      user.otp = null;
      user.otp_expiry = null;
      await user.save();
      return res.status(200).json({
        error: false,
        success: true,
        message: "Xác minh email thành công",
      });
    }
    if (user.otp !== otp) {
      return res.status(400).json({
        error: true,
        success: false,
        message: "Mã OTP không chính xác",
      });
    } else {
      return res.status(400).json({
        error: true,
        success: false,
        message: "Mã OTP đã hết hạn",
      });
    }
  } catch (error) {
    return res.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};
//login
module.exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email: email });
    if (!user) {
      return res.status(400).json({
        error: true,
        success: false,
        message: "Tài khoản không tồn tại!",
      });
    }
    if (user.verify_email == false) {
      return res.status(400).json({
        error: true,
        success: false,
        message: "Email chưa được xác minh!",
      });
    }
    const checkedPassword = await bcryptjs.compare(password, user.password);
    if (!checkedPassword) {
      return res.status(400).json({
        error: true,
        success: false,
        message: "Mật khẩu không chính xác!",
      });
    }
    const accessToken = await generateAccessToken(user._id);
    const refreshToken = await generateRefreshToken(user._id);

    const cookiesOption = {
      httpOnly: true,
      secure: false, //deloy phải bật lại
      sameSite: "None",
    };
    res.cookie("accessToken", accessToken, cookiesOption);
    res.cookie("refreshToken", refreshToken, cookiesOption);
    //tạo my document nếu chưa có

    const document = await myDocument(user._id);
   
    return res.status(200).json({
      error: false,
      success: true,
      message: "Đăng nhập thành công",
      data: {
        accessToken,
        refreshToken,
        documentId: document._id,
      },
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};
//logout
module.exports.logout = async (req, res) => {
  try {
    const userId = res.locals.userId;
    const cookiesOption = {
      httpOnly: true,
      secure: true,
      samSite: "None",
    };
    res.clearCookie("accessToken", cookiesOption);
    res.clearCookie("refreshToken", cookiesOption);
    await User.findOneAndUpdate(
      { _id: userId },
      {
        refresh_token: "",
      }
    );
    return res.status(200).json({
      success: true,
      error: false,
      message: "Đăng xuất thành công!",
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};
//forgot-password
module.exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email: email });
    if (!user) {
      return res.status(400).json({
        message: "Tài khoản không tồn tại",
        error: true,
        success: false,
      });
    }
    const verifyCode = Math.floor(100000 + Math.random() * 900000);
    await User.findByIdAndUpdate(
      user._id,
      {
        otp: verifyCode,
        otp_expiry: 600000 + Date.now(),
      },
      { new: true }
    );
    const subject = "Mã OTP xác minh";
    const html = `Mã OTP để xác quy Email của bạn là: <b style="color:green">${verifyCode}</b>. Thời hạn sử dụng là: ${Math.ceil(
      600000 / 60000
    )} phút`;
    const verifyEmail = await sendMail(email, subject, html);
    return res.json({
      message: "Kiểm tra email của bạn",
      error: false,
      success: true,
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};
//verify forgot-password
module.exports.verifyForgotPassword = async (req, res) => {
  try {
    const { email, otp } = req.body;
    const user = await User.findOne({ email: email });
    if (!user) {
      return res.status(400).json({
        error: true,
        success: false,
        message: "Email không chính xác!",
      });
    }
    if (user.otp_expiry > Date.now() && user.otp == otp) {
      user.otp = null;
      user.otp_expiry = null;
      await user.save();
      return res.status(200).json({
        error: false,
        success: true,
        message: "Xác minh OTP thành công",
      });
    }
    if (user.otp !== otp) {
      return res.status(400).json({
        error: true,
        success: false,
        message: "Mã OTP không chính xác",
      });
    } else {
      return res.status(400).json({
        error: true,
        success: false,
        message: "Mã OTP đã hết hạn",
      });
    }
  } catch (error) {
    return res.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};
//reset-password
module.exports.resetPassword = async (req, res) => {
  try {
    const { email, newPassword, confirmPassword } = req.body;
    const user = await User.findOne({ email: email });
    if (!user) {
      return res.status(400).json({
        error: true,
        success: false,
        message: "Email không chính xác!",
      });
    }
    if (newPassword !== confirmPassword) {
      return res.status(400).json({
        error: true,
        success: false,
        message: "Mật khẩu không trùng khớp!",
      });
    }
    const salt = await bcryptjs.genSalt(10);
    const hashPassword = await bcryptjs.hash(newPassword, salt);
    user.password = hashPassword;
    await user.save();
    return res.status(200).json({
      error: false,
      success: true,
      message: "Đổi mật khẩu thành công!",
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};
//refreshToken
module.exports.refreshToken = async (req, res) => {
  try {
    const refreshToken =
      req.cookies.refreshToken || req?.headers?.authorization?.split(" ")[1];
    if (!refreshToken) {
      return res.status(400).json({
        message: "Token không hợp lệ",
        error: true,
        success: false,
      });
    }
    const verifyToken = jwt.verify(refreshToken, process.env.JWT_REFRESH_TOKEN);
    if (!verifyToken) {
      return res.status(401).json({
        error: true,
        success: false,
        message: "Token đã hết hạn",
      });
    }
    const userId = verifyToken?.id;
    const newAccessToken = await generateAccessToken(userId);
    const cookiesOption = {
      httpOnly: true,
      secure: true,
      sameSite: "None",
    };
    res.cookie("accessToken", cookiesOption);
    return res.status(200).json({
      error: false,
      success: true,
      message: "Token mới đã được tạo!",
      data: {
        accessToken: newAccessToken,
      },
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};
//user Detail
module.exports.userDetail = async (req, res) => {
  try {
    const userId = res.locals.userId;
    const user = await User.findById(userId).select("-password -refreshToken");
    return res.status(200).json({
      message: "Chi tiết người dùng",
      error: false,
      data: user,
      success: true,
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message || error,
      success: false,
      error: true,
    });
  }
};
//avatar user
module.exports.userImage = async (req, res) => {
  try {
    const userId = res.locals.userId;
    const type = req.body.type;
    const user = await User.findById(userId);
    if (!user) {
      return res.status(400).json({
        error: true,
        success: false,
      });
    }
    if (type == "avatar") {
      if (user.avatar_public_id) {
        cloudinary.uploader.destroy(user.avatar_public_id);
      }
      user.avatar = req.body.image || user.avatar;
      user.avatar_public_id = req.body.image_id || user.avatar_public_id;
    }
    if (type == "background") {
      if (user.background_public_id) {
        cloudinary.uploader.destroy(user.background_public_id);
      }
      user.background = req.body.image || user.background;
      user.background_public_id =
        req.body.image_id || user.background_public_id;
    }
    await user.save();
    return res.status(200).json({
      message: "Cập nhật thành công",
      error: false,
      success: true,
      data: user,
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};
//update user
module.exports.updateUser = async (req, res) => {
  try {
    const userId = res.locals.userId;

    const existUser = await User.findById(userId);
    if (!existUser) {
      return res.status(400).send("Tài khoản không được cập nhật");
    }
    // Cập nhật user
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { $set: req.body },
      { new: true }
    );
    return res.status(200).json({
      message: "Chỉnh sửa tài khoản thành công",
      error: false,
      success: true,
      data: updatedUser,
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};
//get user
module.exports.getUser = async (req, res) => {
  try {
    const userId = res.locals.userId;
    const myUser = await User.findById(userId);

    let find = { _id: { $ne: userId } };

    // Search
    const objectSearch = searchHelper(req.query);
    if (objectSearch.$or) find.$or = objectSearch.$or;

    const users = await User.find(find).select(
      "-password -refresh_token -googleId"
    );

    // Gắn trạng thái pending nếu user có trong requestFriends
    const dataWithStatus = users.map((u) => {
      const isPending = myUser.requestFriends.some(
        (rf) => rf.id.toString() === u._id.toString()
      );
      return { ...u.toObject(), friendStatus: isPending ? "pending" : "none" };
    });

    return res.status(200).json({
      error: false,
      success: true,
      data: dataWithStatus,
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};
//get all users
module.exports.getAllStranger = async (req, res) => {
  try {
    const userId = res.locals.userId;
    const myUser = await User.findById(userId);
    const friendIds = myUser.FriendList.map((item) => item.user_id);
    const requestFriends = myUser.requestFriends.map((item) => item.id);
    const acceptFriends = myUser.acceptFriends.map((item) => item.id);

    const users = await User.find({
      _id: {
        $ne: userId,
        $nin: [...friendIds, ...requestFriends, ...acceptFriends],
      },
    })
      .limit(6)
      .select("name email avatar background date_of_birth gender");
    return res.status(200).json({
      error: false,
      success: true,
      data: users,
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};
//friend invite list
module.exports.friendInvite = async (req, res) => {
  try {
    const userId = res.locals.userId;
    const user = await User.findOne({ _id: userId });
    const acceptFriendIds = user.acceptFriends.map((item) => item.id);
    const users = await User.find({
      _id: { $in: acceptFriendIds },
    }).select(
      "name email avatar background date_of_birth mobile gender requestFriends"
    );

    return res.status(200).json({
      success: true,
      error: false,
      data: users,
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};
//list friend
module.exports.friendList = async (req, res) => {
  try {
    const userId = res.locals.userId;
    const myUser = await User.findOne({ _id: userId });
    const friendList = myUser.FriendList;
    const friendListId = friendList.map((item) => item.user_id);
    const users = await User.find({
      _id: { $in: friendListId },
    }).select("name email avatar background date_of_birth mobile gender");
    const usersWithInfo = users.map((user) => {
      const infoFriend = friendList.find(
        (f) => f.user_id.toString() === user._id.toString()
      );
      return {
        ...user.toObject(),
        infoFriend,
      };
    });

    const countFriend = users.length;
    return res.status(200).json({
      success: true,
      error: false,
      data: usersWithInfo,
      count: countFriend,
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};
//create room chat
module.exports.createRoomChat = async (req, res) => {
  try {
    const userId = res.locals.userId;
    const { title, members } = req.body;

    const dataRoom = {
      title: title || "",
      typeRoom: "group",
      users: [],
    };
    for (const userId of members) {
      dataRoom.users.push({ user_id: userId, role: "member" });
    }
    dataRoom.users.push({ user_id: userId, role: "admin" });

    const roomChat = new RoomChat(dataRoom);
    await roomChat.save();
    return res.status(200).json({
      message: "Phòng chat được tạo thành công",
      error: false,
      success: true,
      data: roomChat,
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};
//get room chat
module.exports.getRoomChat = async (req, res) => {
  try {
    const objectId = new mongoose.Types.ObjectId(res.locals.userId);
    const rooms = await RoomChat.find({
      typeRoom: "group",
      "users.user_id": objectId,
    });

    return res.status(200).json({
      error: false,
      success: true,
      data: rooms,
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};
//get room chat
module.exports.getAllRoomChat = async (req, res) => {
  try {
    const objectId = new mongoose.Types.ObjectId(res.locals.userId);

    const roomChat = await RoomChat.find({
      "users.user_id": objectId,
    })
      .sort({ createdAt: -1 })
      .populate({
        path: "users.user_id",
        select:
          "-password -refresh_token -googleId -FriendList -requestFriends -acceptFriends",
      });

    if (roomChat) {
      return res.status(200).json({
        success: true,
        data: roomChat,
      });
    }
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Lỗi server",
    });
  }
};
//edit room chat
module.exports.editRoomChat = async (req, res) => {
  try {
    const roomChatId = req.params.id;
    const { title } = req.body;
    const roomChat = await RoomChat.findById(roomChatId);
    if (!roomChat) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy phòng chat",
      });
    }
    const updatedData = {};
    if (title) updatedData.title = title;
    if (req.body.image && req.body.image_id) {
      // Xoá ảnh cũ trên Cloudinary nếu có
      if (roomChat.avatar_public_id) {
        cloudinary.uploader.destroy(roomChat.avatar_public_id);
      }
      updatedData.avatar = req.body.image;
      updatedData.avatar_public_id = req.body.image_id;
    }
    const roomChatUpdated = await RoomChat.findByIdAndUpdate(
      roomChatId,
      { $set: updatedData },
      { new: true }
    ).select("title avatar");
    return res.status(200).json({
      success: true,
      error: false,
      data: roomChatUpdated,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Lỗi server",
    });
  }
};
//search user
module.exports.searchUser = async (req, res) => {
  try {
    const keyword = req.query.keyword; // email hoặc mobile
    const userId = res.locals.userId;

    // Tìm user khác userId và email OR mobile khớp
    const user = await User.findOne({
      _id: { $ne: userId },
      $or: [{ email: keyword }, { mobile: keyword }],
    }).select(
      "-password -refresh_token -googleId -requestFriends -acceptFriends -FriendList"
    );

    if (!user) {
      return res.status(404).json({
        error: true,
        success: false,
        message: "Không tìm thấy người dùng",
        data: [],
      });
    }

    return res.status(200).json({
      error: false,
      success: true,
      data: user,
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};
//add member for group
module.exports.addMember = async (req, res) => {
  try {
    const roomChatId = req.params.id;
    const members = req.body.members;

    const room = await RoomChat.findById(roomChatId);
    if (!room) {
      return res.status(404).json({
        error: true,
        success: false,
        message: "Room không tồn tại",
      });
    }
    const existingIds = room.users.map((u) => u.user_id.toString());

    const userObjects = members
      .filter((id) => !existingIds.includes(id.toString()))
      .map((id) => ({
        user_id: id,
        role: "member",
      }));

    if (userObjects.length > 0) {
      await RoomChat.updateOne(
        { _id: roomChatId },
        {
          $push: { users: { $each: userObjects } },
        }
      );
    }

    return res.status(200).json({
      error: false,
      success: true,
    });
  } catch (error) {
    return res.status(500).json({
      error: true,
      success: false,
      message: error.message || error,
    });
  }
};

//remove member
module.exports.removeMember = async (req, res) => {
  try {
    const memberId = req.body.memberId;
    const roomChatId = req.params.id;
    const currentUserId = res.locals.userId; // user đang đăng nhập

    const roomChat = await RoomChat.findById(roomChatId);
    if (!roomChat) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy phòng chat",
      });
    }

    // 1️ Check user hiện tại có phải admin không
    const currentUser = roomChat.users.find(
      (u) => u.user_id.toString() === currentUserId
    );

    if (!currentUser || currentUser.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Bạn không có quyền xóa thành viên",
      });
    }

    // 2️ Kiểm tra thành viên tồn tại trong nhóm
    const member = roomChat.users.find(
      (u) => u.user_id.toString() === memberId
    );

    if (!member) {
      return res.status(404).json({
        success: false,
        message: "Thành viên không tồn tại trong nhóm",
      });
    }

    if (member.role === "admin") {
      return res.status(400).json({
        success: false,
        message: "Không thể xóa trưởng nhóm",
      });
    }

    // 3️ Xóa member khỏi nhóm
    await RoomChat.findByIdAndUpdate(roomChatId, {
      $pull: { users: { user_id: memberId } },
    });

    return res.status(200).json({
      success: true,
      message: "Xóa thành viên khỏi nhóm thành công",
      error: false,
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message || error,
      success: false,
      error: true,
    });
  }
};

//leave group
module.exports.leaveGroup = async (req, res) => {
  try {
    const roomChatId = req.params.id;
    const currentUserId = res.locals.userId; // user đang đăng nhập

    const roomChat = await RoomChat.findById(roomChatId);
    if (!roomChat) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy phòng chat",
      });
    }

    // 1 Kiểm tra thành viên tồn tại trong nhóm
    const member = roomChat.users.find(
      (u) => u.user_id.toString() === currentUserId
    );

    if (!member) {
      return res.status(404).json({
        success: false,
        message: "Bạn không tồn tại trong nhóm",
      });
    }

    if (member.role === "admin") {
      return res.status(400).json({
        success: false,
        message: "Bạn phải ủy quyền nhóm trưởng trước khi rời nhóm",
      });
    }

    // 3️ Xóa member khỏi nhóm
    await RoomChat.findByIdAndUpdate(roomChatId, {
      $pull: { users: { user_id: currentUserId } },
    });

    return res.status(200).json({
      success: true,
      message: "Rời nhóm thành công",
      error: false,
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message || error,
      success: false,
      error: true,
    });
  }
};
//remove roomChat
module.exports.removeRoom = async (req, res) => {
  try {
    const roomChatId = req.params.roomChatId;
    const userId = res.locals.userId;

    const room = await RoomChat.findById(roomChatId);
    if (!room) {
      return res
        .status(404)
        .json({ success: false, message: "Phòng chat không tồn tại" });
    }
    const isAdmin = room.users.some(
      (u) => u.user_id.toString() === userId.toString() && u.role === "admin"
    );

    if (!isAdmin) {
      return res.status(403).json({
        success: false,
        message: "Bạn không có quyền xóa phòng chat",
      });
    }
    // Xóa phòng chat
    await RoomChat.findByIdAndDelete(roomChatId);
    // Lấy tất cả chat trong phòng
    const chats = await Chat.find({ room_chat_id: roomChatId });

    // Tạo mảng tất cả promise xóa ảnh + file của tất cả chat
    const allDestroyPromises = chats.flatMap((item) => {
      const imagePromises = item.images.map((image) =>
        cloudinary.uploader.destroy(image.public_id)
      );
      const filePromises = item.files.map((file) =>
        cloudinary.uploader.destroy(file.public_id)
      );
      return [...imagePromises, ...filePromises];
    });

    // Xóa tất cả cùng lúc
    await Promise.all(allDestroyPromises);

    // Xóa tất cả chat khỏi DB
    await Chat.deleteMany({ room_chat_id: roomChatId });

    return res
      .status(200)
      .json({ success: true, message: "Phòng chat này đã được xóa!" });
  } catch (error) {
    return res.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};
