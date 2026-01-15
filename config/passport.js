var GoogleStrategy = require("passport-google-oauth20").Strategy;
const { myDocument } = require("../helper/createMyDocument");
const User = require("../model/user.model");
const passport = require("passport");
passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: "/auth/google/callback",
    },
    async (accessToken, refreshToken, profile, cb) => {
      try {
        let user = await User.findOne({ googleId: profile.id });
        if (!user) {
          user = await User.create({
            googleId: profile.id,
            name: profile.displayName,
            email: profile.emails[0].value,
            avatar: profile.photos[0].value,
            verify_email: true,
          });
        }
        //tạo my document nếu chưa có
        const document = await myDocument(user._id);
        return cb(null, {
          user,
          documentId: document._id,
        });
      } catch (error) {
        return cb(error, null);
      }
    }
  )
);
