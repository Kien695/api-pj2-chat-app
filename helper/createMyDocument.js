const RoomChat = require("../model/room-chat.model");

module.exports.myDocument = async (userId) => {
  const room = await RoomChat.findOne({
    typeRoom: "system",
    "users.user_id": userId,
  });
  if (!room) {
    await RoomChat.create({
      typeRoom: "system",
      title: "My Document",
      avatar:
        "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSsbwObRWkl5q70ekV7myclXT6zfj2mwAaNAg&s",
      users: [{ user_id: userId }],
      unreadCount: {},
      lastMessage: {},
    });
  }
  return room;
};
