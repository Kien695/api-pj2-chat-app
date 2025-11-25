const User = require("../model/user.model");
const bcryptjs = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { sendMail } = require("../config/sendMail");
const { generateAccessToken } = require("../utils/generateAccessToken");
const { generateRefreshToken } = require("../utils/generateRefreshToken");
const searchHelper = require("../helper/search");
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
    return res.status(200).json({
      error: false,
      success: true,
      message: "Đăng nhập thành công",
      data: {
        accessToken,
        refreshToken,
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
//friend invite list
module.exports.friendInvite = async (req, res) => {
  try {
    const userId = res.locals.userId;
    const user = await User.findOne({ _id: userId });
    const acceptFriendIds = user.acceptFriends.map((item) => item.id);
    const users = await User.find({
      _id: { $in: acceptFriendIds },
    }).select("-password -refresh_token -googleId");
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
