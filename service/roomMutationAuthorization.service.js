const groupAdminMutationFilter = (roomId, userId, additionalConditions = []) => ({
  _id: roomId,
  typeRoom: "group",
  $and: [
    {
      users: {
        $elemMatch: { user_id: userId, role: "admin" },
      },
    },
    ...additionalConditions,
  ],
});

module.exports = {
  groupAdminMutationFilter,
};
