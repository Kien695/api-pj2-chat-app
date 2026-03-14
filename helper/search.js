module.exports = (query) => {
  const objectSearch = {};

  if (query.keyword && query.keyword.trim() !== "") {
    const keyword = query.keyword.trim();

    objectSearch.mobile = { $regex: `^${keyword}` };
  }

  return objectSearch;
};
