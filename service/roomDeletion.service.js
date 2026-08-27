const MediaCleanupJob = require("../model/media-cleanup-job.model");
const RoomChat = require("../model/room-chat.model");
const runMongoTransaction = require("../utils/mongoTransaction");
const {
  RoomAuthorizationError,
} = require("./roomAuthorization.service");
const {
  groupAdminMutationFilter,
} = require("./roomMutationAuthorization.service");

const createRoomDeletionJob = async (room, session) => {
  const roomAssets = [];
  if (room.avatar_public_id) {
    roomAssets.push({
      public_id: room.avatar_public_id,
      resource_type: "image",
    });
  }
  await MediaCleanupJob.create(
    [
      {
        kind: "room-deletion",
        roomId: room._id,
        assets: roomAssets,
      },
    ],
    { session },
  );
};

const deleteRoom = (roomId, userId) =>
  runMongoTransaction(async (session) => {
    const adminFilter = groupAdminMutationFilter(roomId, userId);
    const room = await RoomChat.findOne(adminFilter).session(session);
    if (!room) {
      throw new RoomAuthorizationError(
        403,
        "ROOM_ADMIN_REQUIRED",
        "Bạn không còn quyền xóa phòng chat này",
      );
    }

    await createRoomDeletionJob(room, session);
    const deletion = await RoomChat.deleteOne(adminFilter, { session });
    if (deletion.deletedCount !== 1) {
      throw new RoomAuthorizationError(
        403,
        "ROOM_ADMIN_REQUIRED",
        "Quyền xóa phòng đã thay đổi",
      );
    }

    return {
      memberIds: room.users.map((member) => member.user_id.toString()),
      hasCleanupJob: true,
    };
  });

module.exports = { createRoomDeletionJob, deleteRoom };
