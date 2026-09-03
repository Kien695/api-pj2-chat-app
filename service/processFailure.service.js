const { writeLog } = require("../utils/structuredLogger");

const registerProcessFailureHandlers = ({
  processRef = process,
  shutdown,
  logger = writeLog,
}) => {
  if (typeof shutdown !== "function") throw new TypeError("shutdown is required");
  let handlingFailure = false;

  const handleFailure = (event) => (error) => {
    if (handlingFailure) return;
    handlingFailure = true;
    logger("error", event, { error });
    Promise.resolve(shutdown(event, 1)).catch(() => {
      processRef.exitCode = 1;
    });
  };

  processRef.once("uncaughtException", handleFailure("uncaught_exception"));
  processRef.once("unhandledRejection", handleFailure("unhandled_rejection"));
};

module.exports = { registerProcessFailureHandlers };
