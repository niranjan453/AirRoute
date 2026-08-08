const { getRoutes } = require("./osrmService");
const { geocode } = require("./nominatimService");

async function getDirections(origin, destination) {
  return getRoutes(origin, destination);
}

module.exports = {
  getDirections,
  geocode,
};