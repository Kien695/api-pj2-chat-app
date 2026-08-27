module.exports = (query) => {
  const objectSearch = {};

  if (query.keyword && query.keyword.trim() !== "") {
    const keyword = query.keyword.trim();

    const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    objectSearch.mobile = { $regex: `^${escapedKeyword}` };
  }

  return objectSearch;
};
