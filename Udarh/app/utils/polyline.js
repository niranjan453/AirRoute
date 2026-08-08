export function decodePolyline(points, precision = 5) {
  if (!points || typeof points !== 'string') return [];
  const results = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  const factor = Math.pow(10, precision);

  while (index < points.length) {
    let b;
    let shift = 0;
    let result = 0;
    do {
      b = points.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += dlat;

    shift = 0;
    result = 0;
    do {
      b = points.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlng = result & 1 ? ~(result >> 1) : result >> 1;
    lng += dlng;

    results.push({
      latitude: lat / factor,
      longitude: lng / factor,
    });
  }

  return results;
}

export function encodePolyline(coordinates, precision = 5) {
  const factor = Math.pow(10, precision);
  let output = '';
  let prevLat = 0;
  let prevLng = 0;

  for (let i = 0; i < coordinates.length; i++) {
    const point = coordinates[i];
    const lat = typeof point.latitude === 'number' ? point.latitude : point[0];
    const lng = typeof point.longitude === 'number' ? point.longitude : point[1];

    const currentLat = Math.round(lat * factor);
    const currentLng = Math.round(lng * factor);
    const dLat = currentLat - prevLat;
    const dLng = currentLng - prevLng;

    prevLat = currentLat;
    prevLng = currentLng;

    output += encodeSignedValue(dLat);
    output += encodeSignedValue(dLng);
  }

  return output;
}

function encodeSignedValue(value) {
  let shifted = value << 1;
  if (value < 0) shifted = ~shifted;
  let output = '';
  while (shifted >= 0x20) {
    output += String.fromCharCode((0x20 | (shifted & 0x1f)) + 63);
    shifted >>= 5;
  }
  output += String.fromCharCode(shifted + 63);
  return output;
}

export default { decodePolyline, encodePolyline };
