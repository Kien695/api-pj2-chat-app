const socketAsyncHandler = (handler, onError) => {
  if (typeof handler !== "function" || typeof onError !== "function") {
    throw new TypeError("Socket handler and error handler must be functions");
  }

  return (...args) => {
    return Promise.resolve()
      .then(() => handler(...args))
      .catch((error) => onError(error, args));
  };
};

module.exports = socketAsyncHandler;
