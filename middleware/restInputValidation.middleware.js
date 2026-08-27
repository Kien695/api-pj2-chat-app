const {
  RestInputValidationError,
  validateAddMembersPayload,
  validateCreateRoomPayload,
  validateRemoveMemberPayload,
  validateRoomTitle,
  validateSearchKeyword,
} = require("../service/restInputValidation.service");

const handleValidation = (validate, assign) => (req, res, next) => {
  try {
    assign(req, validate(req));
    return next();
  } catch (error) {
    if (!(error instanceof RestInputValidationError)) return next(error);
    return res.status(400).json({
      success: false,
      error: true,
      code: error.code,
      message: error.message,
    });
  }
};

const validateUserSearch = handleValidation(
  (req) => validateSearchKeyword(req.query.keyword),
  (req, keyword) => { req.query.keyword = keyword; },
);

const validateCreateRoom = handleValidation(
  (req) => validateCreateRoomPayload(req.body),
  (req, body) => { req.body = { ...req.body, ...body }; },
);

const validateAddMembers = handleValidation(
  (req) => validateAddMembersPayload(req.body),
  (req, body) => { req.body = { ...req.body, ...body }; },
);

const validateRemoveMember = handleValidation(
  (req) => validateRemoveMemberPayload(req.body),
  (req, body) => { req.body = { ...req.body, ...body }; },
);

const validateRoomEdit = handleValidation(
  (req) => validateRoomTitle(req.body?.title),
  (req, title) => {
    if (title !== undefined) req.body.title = title;
  },
);

module.exports = {
  validateAddMembers,
  validateCreateRoom,
  validateRemoveMember,
  validateRoomEdit,
  validateUserSearch,
};
