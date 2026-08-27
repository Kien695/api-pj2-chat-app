const mongoose = require("mongoose");

const supportsTransactions = (hello) =>
  Boolean(
    hello.logicalSessionTimeoutMinutes !== undefined &&
      (hello.setName || hello.msg === "isdbgrid"),
  );

module.exports.connect = async () => {
  await mongoose.connect(process.env.MONGOOSE_URL);
  const hello = await mongoose.connection.db.admin().command({ hello: 1 });

  if (!supportsTransactions(hello)) {
    await mongoose.disconnect();
    throw new Error(
      "MongoDB transactions require a replica set or sharded cluster",
    );
  }
  console.log("MongoDB connected");
};

module.exports.supportsTransactions = supportsTransactions;

module.exports.disconnect = async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
};
