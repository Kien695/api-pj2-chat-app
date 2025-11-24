module.exports = (query) => {
  const objectSearch = {};

  if (query.keyword && query.keyword.trim() !== "" && query.keyword.trim() !== "0") {
    const keyword = query.keyword.trim();

    const orConditions = [
      { name: { $regex: keyword, $options: "i" } },
      { email: { $regex: keyword, $options: "i" } },
    ];

    // Chỉ thêm mobile nếu keyword là 10 số
    if (/^\d{10}$/.test(keyword)) {
      orConditions.push({ mobile: { $regex: `^${keyword}`, $options: "i" } });
    }

    objectSearch.$or = orConditions;
  }

  return objectSearch;
};
